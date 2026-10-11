import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incomingText, incomingTextRejection, transportCategory, trustedBaseUrl, eventId, getUpdates, sendText, ILinkError } from '../src/weixin.js';
import { authorized, readJson } from '../src/http.js';
import { DEFAULT_MODEL, isInboxEvent } from '../src/types.js';

export const message = {
  message_id: 123, from_user_id: 'allowed', to_user_id: 'bot', message_type: 1, message_state: 2,
  context_token: 'sensitive-context', item_list: [{ type: 1, text_item: { text: '测试 10.5 公斤' } }],
};

test('trusted service origins only, no arbitrary credential destination', () => {
  assert.equal(trustedBaseUrl('https://ilinkai.weixin.qq.com/'), 'https://ilinkai.weixin.qq.com');
  assert.equal(trustedBaseUrl('https://ilinkai2.weixin.qq.com'), 'https://ilinkai2.weixin.qq.com');
  for (const input of ['http://ilinkai.weixin.qq.com', 'https://evil.com', 'https://ilinkai.weixin.qq.com.evil.com',
    'https://user:password@ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com/api', 'https://127.0.0.1',
    'https://ilinkai.weixin.qq.com:8443', 'https://ilinkai.weixin.qq.com/?token=x']) {
    assert.throws(() => trustedBaseUrl(input));
  }
});

test('text validation rejects strangers, own messages, incomplete, group and unsafe IDs', () => {
  assert.equal(incomingText(message, 'bot', ['allowed'])?.text, '测试 10.5 公斤');
  for (const change of [{ from_user_id: 'stranger' }, { message_type: 2 }, { message_state: 1 },
    { group_id: 'group' }, { to_user_id: 'other' }, { context_token: '' }, { message_id: Number.MAX_SAFE_INTEGER + 1 },
    { item_list: [{ type: 2 }] }]) assert.equal(incomingText({ ...message, ...change }, 'bot', ['allowed']), null);
});

test('inbound NEW and omitted states are accepted; rejection diagnostics contain only reason codes', () => {
  for (const state of [0, undefined, 2]) {
    assert.equal(incomingText({ ...message, message_state: state }, 'bot', ['allowed'])?.messageId, '123');
  }
  assert.equal(incomingTextRejection({ ...message, message_state: 1 }, 'bot', ['allowed']), 'incomplete_state');
  assert.equal(incomingTextRejection({ ...message, from_user_id: 'private-stranger' }, 'bot', ['allowed']), 'unauthorized_sender');
  assert.equal(incomingTextRejection({ ...message, to_user_id: 'other' }, 'bot', ['allowed']), 'recipient_mismatch');
  assert.equal(incomingTextRejection({ ...message, message_id: Number.MAX_SAFE_INTEGER + 1 }, 'bot', ['allowed']), 'invalid_message_id');
});

test('portable signal composition does not require AbortSignal.any', async t => {
  t.mock.method(AbortSignal, 'any', () => { throw new Error('not supported'); });
  const external = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.ok(options.signal);
    assert.notEqual(options.signal, external.signal);
    return Response.json({ ret: 0, msgs: [] });
  });
  await getUpdates('https://ilinkai.weixin.qq.com', 'synthetic-token', '', 1000, external.signal);
});

test('request timeout timers are cleared after success and failure', async t => {
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ret: 0, msgs: [] }));
  await getUpdates('https://ilinkai.weixin.qq.com', 'synthetic', '', 1000);
  assert.equal(cleared.mock.callCount(), 1);
  mock.mock.mockImplementation(async () => new Response('', { status: 503 }));
  await assert.rejects(getUpdates('https://ilinkai.weixin.qq.com', 'synthetic', '', 1000));
  assert.equal(cleared.mock.callCount(), 2);
});

test('external cancellation remains classified as cancelled', async t => {
  const external = new AbortController();
  t.mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const pending = getUpdates('https://ilinkai.weixin.qq.com', 'synthetic-token', '', 1000, external.signal);
  external.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof ILinkError && e.category === 'cancelled');
});

test('redirect responses fail closed and transport reasons never contain raw errors', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal(options.redirect, 'manual');
    return Response.redirect('https://evil.invalid', 302);
  });
  await assert.rejects(getUpdates('https://ilinkai.weixin.qq.com', 'synthetic-token', '', 1000),
    (e: unknown) => e instanceof ILinkError && e.category === 'http_302' && !e.retryable);
  assert.equal(transportCategory(new Error('SSL failure synthetic-private-token')), 'network_tls');
  assert.equal(transportCategory(new Error('unrecognized synthetic-private-token')), 'network');
  assert.equal(transportCategory({ message: 'Network connection lost' }), 'network_connection_lost');
});

test('stable ID scoped to bot; queue holds only references; configured future model', async () => {
  const id = await eventId('bot', '123');
  assert.equal(id, await eventId('bot', '123'));
  assert.notEqual(id, await eventId('other-bot', '123'));
  assert.ok(isInboxEvent({ version: 1, eventId: id, generation: 1 }));
  assert.ok(!isInboxEvent({ version: 1, eventId: 'bad', generation: 1 }));
  assert.equal(DEFAULT_MODEL, 'meta/muse-spark-1.3-contributor');
});

test('admin auth fails closed, rejects bad token, body size bounded', async () => {
  const token = 'a'.repeat(64);
  const request = new Request('https://test', { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(await authorized(request, token));
  assert.ok(!await authorized(request, ''));
  assert.ok(!await authorized(request, 'b'.repeat(64)));
  const large = new Request('https://test', { method: 'POST', body: 'x'.repeat(100) });
  await assert.rejects(readJson(large, 20));
});

test('getUpdates and sendText use actual wire fields and no credential redirects', async t => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { ret: 0, msgs: [message], get_updates_buf: 'next', longpolling_timeout_ms: 35_000 } : { ret: 0 });
  });
  const result = await getUpdates('https://ilinkai.weixin.qq.com', 'secret-bot', 'previous', 40_000);
  assert.equal(result.cursor, 'next');
  assert.equal(result.timeoutMs, 40_000);
  assert.equal(JSON.parse(calls[0].options.body as string).get_updates_buf, 'previous');
  assert.equal((calls[0].options.headers as Record<string, string>).Authorization, 'Bearer secret-bot');
  assert.equal(calls[0].options.redirect, 'manual');
  await sendText('https://ilinkai.weixin.qq.com', 'secret-bot', 'allowed', 'context', 'client-stable', 'reply');
  const send = JSON.parse(calls[1].options.body as string);
  assert.equal(send.msg.context_token, 'context');
  assert.equal(send.msg.client_id, 'client-stable');
  assert.equal(send.msg.item_list[0].text_item.text, 'reply');
  assert.equal(send.base_info.bot_agent, 'MyBaby/0.1.0');
});

test('uint64 message IDs remain distinct through wire parsing and dedup keys', async t => {
  const ids = ['18446744073709551614', '18446744073709551615'];
  const frames = ids.map(id => JSON.stringify(message).replace('"message_id":123', `"message_id":${id}`));
  t.mock.method(globalThis, 'fetch', async () => new Response(`{"ret":0,"msgs":[${frames.join(',')}],"get_updates_buf":"next","longpolling_timeout_ms":35000}`));
  const result = await getUpdates('https://ilinkai.weixin.qq.com', 'synthetic', '', 1000);
  const normalized = result.msgs.map(raw => incomingText(raw, 'bot', ['allowed']));
  assert.deepEqual(normalized.map(m => m?.messageId), ids);
  assert.equal(result.timeoutMs, 40000);
  assert.notEqual(await eventId('bot', normalized[0]!.messageId), await eventId('bot', normalized[1]!.messageId));
});

test('wire parser rejects prototype keys and duplicate keys without leaking response data', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('{"ret":0,"__proto__":{"secret":"do-not-log"}}'));
  for (const raw of ['{"ret":0,"__proto__":{"secret":"do-not-log"}}', '{"ret":0,"constructor":{"secret":"do-not-log"}}', '{"ret":0,"ret":-14}']) {
    mock.mock.mockImplementation(async () => new Response(raw));
    await assert.rejects(getUpdates('https://ilinkai.weixin.qq.com', 'synthetic', '', 1000),
      (e: unknown) => e instanceof ILinkError && e.category === 'invalid_json' && !e.message.includes('do-not-log'));
  }
});

test('protocol errors are classified without echoing response secrets', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ret: -14, errmsg: 'token-do-not-log' }));
  await assert.rejects(getUpdates('https://ilinkai.weixin.qq.com', 'secret', '', 1000),
    (e: unknown) => e instanceof ILinkError && e.category === 'auth_expired' && !e.message.includes('token'));
});

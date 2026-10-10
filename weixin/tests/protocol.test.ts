import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incomingText, trustedBaseUrl, eventId, getUpdates, sendText, ILinkError } from '../src/weixin.js';
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
  assert.equal(calls[0].options.redirect, 'error');
  await sendText('https://ilinkai.weixin.qq.com', 'secret-bot', 'allowed', 'context', 'client-stable', 'reply');
  const send = JSON.parse(calls[1].options.body as string);
  assert.equal(send.msg.context_token, 'context');
  assert.equal(send.msg.client_id, 'client-stable');
  assert.equal(send.msg.item_list[0].text_item.text, 'reply');
  assert.equal(send.base_info.bot_agent, 'MyBaby/0.1.0');
});

test('protocol errors are classified without echoing response secrets', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ret: -14, errmsg: 'token-do-not-log' }));
  await assert.rejects(getUpdates('https://ilinkai.weixin.qq.com', 'secret', '', 1000),
    (e: unknown) => e instanceof ILinkError && e.category === 'auth_expired' && !e.message.includes('token'));
});

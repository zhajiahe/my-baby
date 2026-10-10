import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUpdates, ilinkRequest, ILinkError } from '../src/weixin.js';

test('QR acquisition is POST without bot authorization or base_info; status is GET', async t => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls.push(options); return Response.json({ status: 'wait' });
  });
  await ilinkRequest('https://ilinkai.weixin.qq.com', 'ilink/bot/get_bot_qrcode?bot_type=3', { body: { local_token_list: [] } });
  await ilinkRequest('https://ilinkai.weixin.qq.com', 'ilink/bot/get_qrcode_status?qrcode=test');
  assert.equal(calls[0].method, 'POST');
  assert.equal((calls[0].headers as Record<string, string>).Authorization, undefined);
  assert.equal(JSON.parse(calls[0].body as string).base_info, undefined);
  assert.equal(calls[1].method, 'GET');
  assert.equal((calls[1].headers as Record<string, string>).AuthorizationType, undefined);
});

test('empty server cursor does not overwrite a stored cursor', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ret: 0, msgs: [], get_updates_buf: '' }));
  const result = await getUpdates('https://ilinkai.weixin.qq.com', 'secret', 'persisted', 40_000);
  assert.equal(result.cursor, undefined);
});

test('malformed messages block cursor advancement; error text has no response data', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ret: 0, msgs: { token: 'sensitive' }, get_updates_buf: 'must-not-save' }));
  await assert.rejects(getUpdates('https://ilinkai.weixin.qq.com', 'secret', '', 40_000),
    (error: unknown) => error instanceof ILinkError && error.category === 'invalid_messages' && !error.message.includes('sensitive'));
});

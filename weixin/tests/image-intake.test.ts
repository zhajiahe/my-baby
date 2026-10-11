import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { archiveChannelImage, imageAesKey, imageContentType, imageIntakeReply } from '../src/image-intake.js';

const identity = { source: 'weixin' as const, botId: 'bot', userId: 'allowed', messageId: '123456789' };
const config = { origin: 'https://mybaby.example', token: 't'.repeat(64), date: '2026-10-11', index: 0 };
const referenceEncrypt = (plaintext: Uint8Array, key: Uint8Array) =>
  Uint8Array.from(Buffer.concat([(c => [c.update(plaintext), c.final()])(createCipheriv('aes-128-ecb', key, null))].flat()));
const jpeg = (size = 400) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(size)]);

test('the AES key is read from the nested media field the official client uses', () => {
  assert.equal(imageAesKey({ image_item: { media: { aes_key: 'abc' } } }), 'abc');
  // The top-level field is a different value and must not be used as the key.
  assert.equal(imageAesKey({ image_item: { aeskey: 'top', media: {} } }), null);
  for (const bad of [{}, { image_item: {} }, { image_item: { media: { aes_key: '' } } },
    { image_item: { media: { aes_key: 42 } } }, { image_item: { media: null } }]) {
    assert.equal(imageAesKey(bad as Record<string, unknown>), null);
  }
});

test('the container decides the declared content type', () => {
  assert.equal(imageContentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])), 'image/png');
  assert.equal(imageContentType(Uint8Array.from([...'GIF89a'].map(c => c.charCodeAt(0)))), 'image/gif');
  assert.equal(imageContentType(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), null);
});

test('a real photo is downloaded, decrypted and uploaded with its identity', async t => {
  const key = Uint8Array.from(randomBytes(16));
  const original = jpeg();
  const ciphertext = referenceEncrypt(original, key);
  let posted: FormData | null = null;
  let authorization: string | null = null;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    if (url.includes('/api/agent/media')) {
      posted = init.body as FormData; authorization = (init.headers as Record<string, string>).authorization;
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 201 });
    }
    assert.equal(url, 'https://mmbiz.qpic.cn/photo');
    assert.equal(init.redirect, 'manual');
    return new Response(ciphertext, { status: 200 });
  });
  const result = await archiveChannelImage('https://mmbiz.qpic.cn/photo', Buffer.from(key).toString('base64'), identity, config);
  assert.deepEqual(result, { status: 201, bytes: original.length, contentType: 'image/jpeg' });
  assert.equal(authorization, `Bearer ${config.token}`);
  assert.equal(posted!.get('botId'), 'bot');
  assert.equal(posted!.get('userId'), 'allowed');
  assert.equal(posted!.get('messageId'), '123456789');
  assert.equal(posted!.get('date'), '2026-10-11');
  assert.equal(posted!.get('index'), '0');
  const file = posted!.get('file') as File;
  assert.equal(file.type, 'image/jpeg');
  assert.equal(file.size, original.length, 'the decrypted bytes, not the ciphertext, are uploaded');
});

test('a wrong key or a non-image payload is refused instead of archived', async t => {
  const key = Uint8Array.from(randomBytes(16));
  const ciphertext = referenceEncrypt(jpeg(), key);
  t.mock.method(globalThis, 'fetch', async () => new Response(ciphertext, { status: 200 }));
  await assert.rejects(archiveChannelImage('https://mmbiz.qpic.cn/p', Buffer.from(randomBytes(16)).toString('base64'), identity, config),
    /image_decrypt_failed/);
  // A key that decrypts to something that is not an image is refused too: padding
  // can pass by chance, the container check is what stops a broken file.
  const wrong = Uint8Array.from(randomBytes(16));
  const garbage = referenceEncrypt(Uint8Array.from(randomBytes(400)), wrong);
  t.mock.method(globalThis, 'fetch', async () => new Response(garbage, { status: 200 }));
  await assert.rejects(archiveChannelImage('https://mmbiz.qpic.cn/p', Buffer.from(wrong).toString('base64'), identity, config),
    /image_decrypt_failed|invalid_padding/);
});

test('download and upload failures stay classified and never leak internals', async t => {
  const key = Uint8Array.from(randomBytes(16));
  const ciphertext = referenceEncrypt(jpeg(), key);
  const encoded = Buffer.from(key).toString('base64');
  // A host outside the allowlist is refused before any request.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not be attempted'); });
  await assert.rejects(archiveChannelImage('https://evil.com/p', encoded, identity, config), /image_host_not_allowed/);
  // A non-2xx from the intake endpoint is classified by status.
  t.mock.method(globalThis, 'fetch', async (url: string) => url.includes('/api/agent/media')
    ? new Response(null, { status: 403 }) : new Response(ciphertext, { status: 200 }));
  await assert.rejects(archiveChannelImage('https://mmbiz.qpic.cn/p', encoded, identity, config), /media_intake_http_403/);
  // A transport failure is classified too.
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('/api/agent/media')) throw new Error('socket closed');
    return new Response(ciphertext, { status: 200 });
  });
  await assert.rejects(archiveChannelImage('https://mmbiz.qpic.cn/p', encoded, identity, config), /media_intake_network/);

  for (const code of ['image_too_large', 'image_decrypt_failed', 'media_intake_http_403', 'media_intake_http_409',
    'image_host_not_allowed', 'media_intake_network', 'anything_else']) {
    const reply = imageIntakeReply(code);
    assert.ok(reply.length > 0 && !/http|_|key|token|aes|cipher|url/i.test(reply), `internal detail leaked for ${code}`);
  }
});

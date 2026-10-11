import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMAGE_BYTES, allowedImageHost, imageSignature, imageURL, probeImage, registrableHost } from '../src/image-probe.js';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const item = { type: 2, image_item: { media: { full_url: 'https://mmbiz.qpic.cn/path/abc?wx_fmt=jpeg' }, aeskey: 'k' } };

test('the image URL is read from the measured path and must be https', () => {
  assert.equal(imageURL(item), 'https://mmbiz.qpic.cn/path/abc?wx_fmt=jpeg');
  for (const bad of [{}, { image_item: {} }, { image_item: { media: {} } }, { image_item: { media: { full_url: '' } } },
    { image_item: { media: { full_url: 'http://mmbiz.qpic.cn/a' } } }, { image_item: { media: { full_url: 'not a url' } } },
    { image_item: { media: { full_url: 42 } } }, { image_item: { media: { full_url: `https://a.cn/${'x'.repeat(3000)}` } } },
    { image_item: { media: { url: 'https://mmbiz.qpic.cn/a' } } }]) {
    assert.equal(imageURL(bad as Record<string, unknown>), null, `must not accept ${JSON.stringify(bad).slice(0, 60)}`);
  }
});

test('the host allowlist blocks lookalikes before any request leaves the Worker', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fetch must not be attempted'); });
  for (const host of ['mmbiz.qpic.cn', 'wx.qlogo.cn', 'a.gtimg.cn', 'ilinkai.weixin.qq.com', 'x.wechat.com']) {
    assert.ok(allowedImageHost(`https://${host}/p`), `${host} should be allowed`);
  }
  for (const url of ['http://mmbiz.qpic.cn/p', 'https://mmbiz.qpic.cn.evil.com/p', 'https://evil.com/mmbiz.qpic.cn/p',
    'https://notqpic.cn/p', 'https://qpic.cn.evil.io/p', 'https://127.0.0.1/p', 'file:///etc/passwd', 'not-a-url']) {
    assert.ok(!allowedImageHost(url), `${url} must be refused`);
    const result = await probeImage(url);
    assert.equal(result.error, 'image_host_not_allowed');
  }
  // Only the registrable suffix is reported, never a full channel URL.
  assert.equal(registrableHost('https://mmbiz.qpic.cn/secret/path?token=abc'), 'qpic.cn');
  assert.ok(!JSON.stringify(await probeImage('https://evil.com/x', async () => { throw new Error('nope'); })).includes('/x'));
});

test('signatures separate directly storable images from encrypted payloads', () => {
  assert.equal(imageSignature(jpeg), 'jpeg');
  assert.equal(imageSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])), 'png');
  assert.equal(imageSignature(Uint8Array.from([...'GIF89a'].map(c => c.charCodeAt(0)))), 'gif');
  assert.equal(imageSignature(Uint8Array.from([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0))))), 'webp');
  // AES output or any other container lands here, which is the whole signal.
  assert.equal(imageSignature(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), 'unknown');
  assert.equal(imageSignature(new Uint8Array(0)), 'unknown');
});

test('the probe summarises the response and refuses redirects, oversize and failures', async () => {
  const response = (init: ResponseInit & { body?: Uint8Array }) => new Response(init.body ?? jpeg, init);
  const ok = await probeImage('https://mmbiz.qpic.cn/p', async () => response({ status: 200, headers: { 'content-type': 'image/jpeg' } }));
  assert.deepEqual(ok, { status: 200, contentType: 'image/jpeg', bytes: jpeg.length, signature: 'jpeg', host: 'qpic.cn' });
  // A 3xx is refused rather than followed to an unverified host.
  const redirect = await probeImage('https://mmbiz.qpic.cn/p', async () => response({ status: 302, headers: { location: 'https://evil.com/x' } }));
  assert.equal(redirect.error, 'image_redirect_refused');
  // A declared oversize body is rejected before reading.
  const large = await probeImage('https://mmbiz.qpic.cn/p', async () => new Response(jpeg, { status: 200, headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } }));
  assert.equal(large.error, 'image_too_large');
  // An undeclared oversize body is cut off while streaming.
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(chunk); } });
  const unbounded = await probeImage('https://mmbiz.qpic.cn/p', async () => new Response(stream, { status: 200 }));
  assert.equal(unbounded.error, 'image_too_large');
  const network = await probeImage('https://mmbiz.qpic.cn/p', async () => { throw new Error('boom'); });
  assert.equal(network.error, 'image_fetch_failed');
  // Errors never carry a full URL or raw transport message.
  for (const result of [redirect, large, unbounded, network]) assert.ok(!JSON.stringify(result).includes('http'));
});

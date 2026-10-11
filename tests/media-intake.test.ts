import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, validateRequest } from '../shared/agent';
import { MAX_INTAKE_BYTES, mediaIntakeFormat, mediaIntakeKey, mediaIntakeRequest } from '../src/lib/agent/media-intake';

const identity = { source: 'weixin' as const, botId: 'bot', userId: 'allowed', messageId: '123456789' };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const mp4 = (() => { const bytes = new Uint8Array(32); bytes.set([0, 0, 0, 0x18], 0);
  bytes.set([...'ftyp'].map(character => character.charCodeAt(0)), 4);
  bytes.set([...'isom'].map(character => character.charCodeAt(0)), 8); return bytes; })();
const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);

test('the object key is derived from the identity and never taken from the caller', () => {
  const key = mediaIntakeKey(identity, 0, 'jpg');
  assert.ok(key.startsWith('uploads/wx/'));
  assert.ok(key.endsWith('123456789-0.jpg'));
  // Two identities can never collide into one namespace.
  assert.notEqual(mediaIntakeKey({ ...identity, userId: 'other' }, 0, 'jpg'), key);
  assert.notEqual(mediaIntakeKey({ ...identity, botId: 'other' }, 0, 'jpg'), key);
  // The grammar requires a numeric message id, so a non-numeric one fails here.
  assert.throws(() => mediaIntakeKey({ ...identity, messageId: 'abc' }, 0, 'jpg'), /invalid_message_id/);
  assert.throws(() => mediaIntakeKey({ ...identity, messageId: '' }, 0, 'jpg'), /invalid_message_id/);
  assert.throws(() => mediaIntakeKey(identity, 0, '../etc'), /invalid_media_format/);
});

test('intake refuses unsupported types, empty, oversize and out-of-range indices', () => {
  const base = { contentType: 'image/jpeg', bytes: jpeg, index: 0 };
  assert.deepEqual(mediaIntakeFormat(base), { ext: 'jpg', mediaType: 'IMAGE' });
  assert.deepEqual(mediaIntakeFormat({ contentType: 'image/png', bytes: png, index: 0 }), { ext: 'png', mediaType: 'IMAGE' });
  assert.deepEqual(mediaIntakeFormat({ contentType: 'video/mp4', bytes: mp4, index: 1 }), { ext: 'mp4', mediaType: 'VIDEO' });
  assert.deepEqual(mediaIntakeFormat({ contentType: 'video/webm', bytes: webm, index: 1 }), { ext: 'webm', mediaType: 'VIDEO' });
  for (const [input, status] of [
    [{ ...base, contentType: 'image/svg+xml' }, 415], [{ ...base, contentType: 'application/octet-stream' }, 415],
    [{ ...base, contentType: 'video/quicktime' }, 415], [{ ...base, bytes: new Uint8Array(0) }, 400],
    [{ ...base, bytes: new Uint8Array(MAX_INTAKE_BYTES + 1) }, 413],
    [{ ...base, index: -1 }, 400], [{ ...base, index: 5 }, 400], [{ ...base, index: 1.5 }, 400],
  ] as const) {
    assert.throws(() => mediaIntakeFormat(input as never), (error: unknown) => error instanceof ContractError && error.status === status);
  }
});

test('a wrong-key decrypt is rejected instead of being archived as a broken file', () => {
  // AES output for a mismatched key is arbitrary bytes: it must never pass.
  const garbage = Uint8Array.from({ length: 512 }, (_, i) => (i * 37 + 11) & 0xff);
  assert.throws(() => mediaIntakeFormat({ contentType: 'image/jpeg', bytes: garbage, index: 0 }), /invalid_media_signature/);
  // A payload whose container disagrees with the declared type is also refused.
  assert.throws(() => mediaIntakeFormat({ contentType: 'image/jpeg', bytes: png, index: 0 }), /invalid_media_signature/);
  // A video whose container is actually a still image is refused as well.
  assert.throws(() => mediaIntakeFormat({ contentType: 'video/mp4', bytes: jpeg, index: 0 }), /invalid_media_signature/);
});

test('the derived request satisfies the create_media_record contract unchanged', () => {
  const request = mediaIntakeRequest({ identity, date: '2026-10-11', index: 0, contentType: 'image/jpeg', bytes: jpeg, title: '满月' });
  const validated = validateRequest(request);
  assert.equal(validated.operation, 'create_media_record');
  assert.equal(validated.args.mediaType, 'IMAGE');
  assert.equal(validated.args.title, '满月');
  assert.equal(validated.operationKey, 'media_0');
  // A video keeps its optional duration, and the index distinguishes two objects
  // from the same message.
  const video = mediaIntakeRequest({ identity, date: '2026-10-11', index: 1, contentType: 'video/mp4', bytes: mp4, duration: 9.6 });
  assert.equal(validateRequest(video).args.duration, 10);
  assert.notEqual(validateRequest(video).args.key, validated.args.key);
  assert.throws(() => validateRequest(mediaIntakeRequest({ identity, date: '2026-02-30', index: 0, contentType: 'image/jpeg', bytes: jpeg })), /invalid_date/);
});

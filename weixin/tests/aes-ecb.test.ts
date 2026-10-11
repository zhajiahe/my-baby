import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { decryptCdnMedia, decryptEcb, decryptEcbPadded, expandKey, parseAesKey, stripPkcs7 } from '../src/aes-ecb.js';

const hex = (value: string) => Uint8Array.from(value.match(/../g)!.map(byte => parseInt(byte, 16)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
// The reference implementation used by the official client (node:crypto), so the
// tests are differential rather than self-referential.
const referenceEncrypt = (plaintext: Uint8Array, key: Uint8Array) => {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Uint8Array.from(Buffer.concat([cipher.update(plaintext), cipher.final()]));
};

test('matches the FIPS-197 AES-128 known-answer vector', () => {
  const key = hex('000102030405060708090a0b0c0d0e0f');
  const plaintext = hex('00112233445566778899aabbccddeeff');
  const ciphertext = hex('69c4e0d86a7b0430d8cdb78070b4c55a');
  assert.equal(toHex(decryptEcb(ciphertext, key)), toHex(plaintext));
  assert.equal(expandKey(key).length, 176);
});

test('decrypts exactly like the reference AES-128-ECB for many random inputs', () => {
  for (const size of [16, 32, 48, 64, 160]) {
    for (let round = 0; round < 8; round++) {
      const key = Uint8Array.from(randomBytes(16));
      const plaintext = Uint8Array.from(randomBytes(size - 1)); // room for padding
      const ciphertext = referenceEncrypt(plaintext, key);
      assert.equal(toHex(decryptEcbPadded(ciphertext, key)), toHex(plaintext), `size ${size} failed`);
    }
  }
});

test('a wrong key is rejected by padding validation instead of yielding broken media', () => {
  const key = Uint8Array.from(randomBytes(16));
  const ciphertext = referenceEncrypt(Uint8Array.from(randomBytes(64)), key);
  let rejected = 0;
  for (let attempt = 0; attempt < 32; attempt++) {
    const wrong = Uint8Array.from(randomBytes(16));
    if (toHex(wrong) === toHex(key)) continue;
    try { decryptEcbPadded(ciphertext, wrong); } catch { rejected++; }
  }
  // PKCS#7 padding makes an accidental silent success extremely unlikely.
  assert.equal(rejected, 32, 'every wrong key must fail loudly');
});

test('PKCS#7 padding is validated, not ignored', () => {
  const block = new Uint8Array(16).fill(0x41);
  block[15] = 0x01;
  assert.equal(stripPkcs7(block).length, 15);
  const full = new Uint8Array(16).fill(0x10);
  assert.equal(stripPkcs7(full).length, 0);
  const four = new Uint8Array(16).fill(0x41);
  for (let i = 12; i < 16; i++) four[i] = 0x04;
  assert.equal(stripPkcs7(four).length, 12);
  for (const bad of [() => { const b = new Uint8Array(16).fill(0x41); b[15] = 0x00; return stripPkcs7(b); },
    () => { const b = new Uint8Array(16).fill(0x41); b[15] = 0x11; return stripPkcs7(b); },
    () => { const b = new Uint8Array(16).fill(0x41); b[15] = 0x04; return stripPkcs7(b); },
    () => stripPkcs7(new Uint8Array(15)), () => stripPkcs7(new Uint8Array(0))]) {
    assert.throws(bad, /invalid_padding|invalid_padded_length/);
  }
  assert.throws(() => decryptEcb(new Uint8Array(20), new Uint8Array(16)), /invalid_ciphertext_length/);
  assert.throws(() => expandKey(new Uint8Array(8)), /invalid_aes_key_length/);
});

test('both in-the-wild aes_key encodings parse to the same raw key', () => {
  const key = Uint8Array.from(randomBytes(16));
  // images: base64 of the raw 16 bytes
  const raw = Buffer.from(key).toString('base64');
  assert.equal(toHex(parseAesKey(raw)), toHex(key));
  // file/voice/video: base64 of a 32-character hex string
  const hexEncoded = Buffer.from(toHex(key), 'ascii').toString('base64');
  assert.equal(toHex(parseAesKey(hexEncoded)), toHex(key));
  // a decoded 32-byte value that is not hex must not be silently accepted
  assert.throws(() => parseAesKey(Buffer.from('z'.repeat(32), 'ascii').toString('base64')), /invalid_aes_key/);
  assert.throws(() => parseAesKey(Buffer.from(randomBytes(20)).toString('base64')), /invalid_aes_key/);
  assert.throws(() => parseAesKey(''), /invalid_aes_key/);
  assert.throws(() => parseAesKey(undefined as unknown as string), /invalid_aes_key/);
});

test('decryptCdnMedia combines key parsing and unpadding end to end', () => {
  const key = Uint8Array.from(randomBytes(16));
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(500)]);
  const ciphertext = referenceEncrypt(jpeg, key);
  const plaintext = decryptCdnMedia(ciphertext, Buffer.from(key).toString('base64'));
  assert.equal(toHex(plaintext), toHex(jpeg));
  assert.equal(plaintext[0], 0xff);
  assert.equal(plaintext[1], 0xd8);
  assert.equal(plaintext[2], 0xff);
});

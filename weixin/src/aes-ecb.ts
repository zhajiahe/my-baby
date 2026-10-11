// AES-128-ECB decryption with PKCS#7 unpadding.
//
// The official client uses node:crypto ("aes-128-ecb"), which does not exist in
// Workers, and WebCrypto has no ECB mode. Deriving ECB from WebCrypto AES-CBC is
// also impossible: CBC validates and strips PKCS#7 padding, so every non-final
// block is rejected. AES itself is a public standard, so a self-contained
// implementation is written here and proven against the FIPS-197 known-answer
// vector in tests. The surrounding scheme (ECB, no IV, PKCS#7, key encodings) is
// copied from the official client, never invented.
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function xtime(a: number): number { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }
function gmul(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return result;
}
function inverse(a: number): number {
  if (a === 0) return 0;
  for (let i = 1; i < 256; i++) if (gmul(a, i) === 1) return i;
  return 0;
}
function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}
// The S-box is generated rather than transcribed: the forward table is
// multiplicative inverse followed by the affine transform, and the inverse table
// is its mirror. Table literals are easy to mistype silently; generation is not.
const SBOX = (() => {
  const table = new Uint8Array(256);
  for (let a = 0; a < 256; a++) {
    const b = inverse(a);
    table[a] = (b ^ rotateLeft(b, 1) ^ rotateLeft(b, 2) ^ rotateLeft(b, 3) ^ rotateLeft(b, 4) ^ 0x63) & 0xff;
  }
  return table;
})();
const INV_SBOX = (() => {
  const table = new Uint8Array(256);
  for (let a = 0; a < 256; a++) table[SBOX[a]] = a;
  return table;
})();

export function expandKey(key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error('invalid_aes_key_length');
  const roundKeys = new Uint8Array(176);
  roundKeys.set(key, 0);
  for (let i = 16; i < 176; i += 4) {
    const previous = roundKeys.subarray(i - 4, i);
    if (i % 16 === 0) {
      const rotated = [previous[1], previous[2], previous[3], previous[0]];
      for (let j = 0; j < 4; j++) roundKeys[i + j] = roundKeys[i - 16 + j] ^ SBOX[rotated[j]] ^ (j === 0 ? RCON[i / 16 - 1] : 0);
    } else {
      for (let j = 0; j < 4; j++) roundKeys[i + j] = roundKeys[i - 16 + j] ^ previous[j];
    }
  }
  return roundKeys;
}

function addRoundKey(state: Uint8Array, roundKeys: Uint8Array, round: number): void {
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[round * 16 + i];
}
function inverseShiftRows(state: Uint8Array): void {
  const copy = state.slice();
  // Row r is rotated right by r; state index is column * 4 + row.
  for (let row = 1; row < 4; row++) {
    for (let column = 0; column < 4; column++) state[column * 4 + row] = copy[((column - row + 4) % 4) * 4 + row];
  }
}
function inverseMixColumns(state: Uint8Array): void {
  for (let column = 0; column < 4; column++) {
    const i = column * 4;
    const a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
    state[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    state[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    state[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    state[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

export function decryptBlock(block: Uint8Array, roundKeys: Uint8Array, offset = 0): Uint8Array {
  const state = block.slice(offset, offset + 16);
  addRoundKey(state, roundKeys, 10);
  for (let round = 9; round >= 1; round--) {
    inverseShiftRows(state);
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
    addRoundKey(state, roundKeys, round);
    inverseMixColumns(state);
  }
  inverseShiftRows(state);
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
  addRoundKey(state, roundKeys, 0);
  return state;
}

export function decryptEcb(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (!ciphertext.length || ciphertext.length % 16 !== 0) throw new Error('invalid_ciphertext_length');
  const roundKeys = expandKey(key);
  const plaintext = new Uint8Array(ciphertext.length);
  for (let offset = 0; offset < ciphertext.length; offset += 16) plaintext.set(decryptBlock(ciphertext, roundKeys, offset), offset);
  return plaintext;
}

// PKCS#7 padding is validated, not ignored: accepting a wrong key would produce a
// file that stores fine and cannot be opened, which is the failure mode this whole
// path exists to avoid.
export function stripPkcs7(plaintext: Uint8Array): Uint8Array {
  if (!plaintext.length || plaintext.length % 16 !== 0) throw new Error('invalid_padded_length');
  const padding = plaintext[plaintext.length - 1];
  if (padding < 1 || padding > 16 || padding > plaintext.length) throw new Error('invalid_padding');
  for (let i = plaintext.length - padding; i < plaintext.length; i++) {
    if (plaintext[i] !== padding) throw new Error('invalid_padding');
  }
  return plaintext.slice(0, plaintext.length - padding);
}

export function decryptEcbPadded(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  return stripPkcs7(decryptEcb(ciphertext, key));
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Copied from the official client's parseAesKey: two encodings are seen in the
// wild, and a key that fails to parse must fail loudly rather than produce
// unreadable media.
export function parseAesKey(aesKeyBase64: string): Uint8Array {
  if (typeof aesKeyBase64 !== 'string' || !aesKeyBase64) throw new Error('invalid_aes_key');
  const decoded = base64Bytes(aesKeyBase64);
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32) {
    const ascii = String.fromCharCode(...decoded);
    if (/^[0-9a-fA-F]{32}$/.test(ascii)) {
      const key = new Uint8Array(16);
      for (let i = 0; i < 16; i++) key[i] = parseInt(ascii.slice(i * 2, i * 2 + 2), 16);
      return key;
    }
  }
  throw new Error('invalid_aes_key');
}

export function decryptCdnMedia(ciphertext: Uint8Array, aesKeyBase64: string): Uint8Array {
  return decryptEcbPadded(ciphertext, parseAesKey(aesKeyBase64));
}

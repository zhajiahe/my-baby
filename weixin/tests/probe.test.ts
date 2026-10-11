import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_MARKER, describeStructure, recordStructure } from '../src/probe.js';

const payload = {
  type: 3,
  voice_item: { duration: 3000, media: { encrypt_type: 1, aeskey: 'SUPERSECRETKEY', url: 'https://cdn.invalid/voice?token=abc' },
    format: 'amr', size: 2048 },
  context_token: 'sensitive-context',
};

test('the probe records field paths and types but never any value', () => {
  const paths = describeStructure(payload);
  assert.ok(paths.includes('type:number'));
  assert.ok(paths.includes('voice_item.media.aeskey:string'));
  assert.ok(paths.includes('voice_item.media.url:string'));
  assert.ok(paths.includes('voice_item.format:string'));
  const serialized = JSON.stringify(paths);
  for (const secret of ['SUPERSECRETKEY', 'cdn.invalid', 'token=abc', 'sensitive-context', 'amr', '3000', '2048']) {
    assert.ok(!serialized.includes(secret), `value leaked into probe output: ${secret}`);
  }
  assert.ok(serialized.includes('voice_item.media.aeskey:string'), 'paths must still be usable for parser design');
});

test('empty strings are flagged without exposing length or content', () => {
  const paths = describeStructure({ image_item: { url: '', aeskey: 'x' } });
  assert.ok(paths.includes('image_item.url:string(empty)'));
  assert.ok(paths.includes('image_item.aeskey:string'));
  assert.ok(!JSON.stringify(paths).includes('length'));
});

test('a value used as an object key cannot be smuggled out', () => {
  const paths = describeStructure({ voice_item: { 'https://cdn.invalid/secret': 1, ['a'.repeat(200)]: 2 } });
  assert.ok(paths.some(path => path.includes(PROBE_MARKER)));
  assert.ok(!JSON.stringify(paths).includes('cdn.invalid'));
  assert.ok(!JSON.stringify(paths).includes('a'.repeat(64)));
});

test('arrays, depth and path counts stay bounded', () => {
  const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
  assert.ok(!describeStructure(deep).some(path => path.includes('f')));
  assert.ok(describeStructure(deep, { maxDepth: 8 }).some(path => path.includes('f')));
  const wide: Record<string, number> = {};
  for (let i = 0; i < 200; i++) wide[`k${i}`] = i;
  assert.equal(describeStructure(wide, { maxPaths: 10 }).length, 10);
  const list = describeStructure({ item_list: [{ type: 3 }, { type: 3 }, { type: 3 }, { type: 3 }] });
  assert.ok(list.includes('item_list[many]'), 'a long list is reported as many, not enumerated');
  assert.ok(list.includes('item_list[].type:number'));
  // Only the first `maxItems` array entries are sampled, so a long list cannot flood the report.
  assert.equal(list.filter(path => path === 'item_list[].type:number').length, 2);
  assert.ok(describeStructure({ item_list: [{ type: 3 }] }).includes('item_list[1]'));
  assert.ok(describeStructure({ item_list: new Array(50).fill(0) }, { maxItems: 2 }).includes('item_list[many]'));
});

test('structure samples are bounded and de-duplicated', () => {
  const first = recordStructure(undefined, 'voice', payload);
  assert.equal(first.length, 1); assert.equal(first[0].kind, 'voice');
  assert.deepEqual(recordStructure(first, 'voice', payload), first, 'an identical shape must not consume a slot');
  const second = recordStructure(first, 'voice', { type: 3, voice_item: { media: { aeskey: 'x' } } });
  assert.equal(second.length, 2);
  const third = recordStructure(second, 'image', { type: 2, image_item: { media: { aeskey: 'y' } } });
  const capped = recordStructure(third, 'image', { type: 2, image_item: { thumb_media: { aeskey: 'z' } } }, 3);
  assert.equal(capped.length, 3, 'sample count must never exceed the cap');
  assert.deepEqual(recordStructure([], 'voice', 'not-an-object'), [], 'a non-object item yields no sample');
  assert.deepEqual(recordStructure([], 'voice', {}), [], 'an empty object yields no paths');
  assert.deepEqual(recordStructure(second, 'voice', null), second);
  assert.equal(recordStructure(undefined, 'image', { image_item: { media: { aeskey: 'k' } } })[0].kind, 'image');
});

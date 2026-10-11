import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsrError, DEFAULT_ASR_MODEL, TRANSCRIPT_MARK, transcribeVoice, validateVoice, voiceFailureReply } from '../src/asr.js';
import { classifyMediaItems, markTranscript, mediaRejectionReason, unverifiedVoiceSource, voiceToTranscript,
  voiceTranscript, voiceUnavailableReply } from '../src/media.js';
import { incomingMedia, incomingText, incomingTextRejection } from '../src/weixin.js';

const message = {
  message_id: 456, from_user_id: 'allowed', to_user_id: 'bot', message_type: 1, message_state: 2,
  context_token: 'sensitive-context', item_list: [{ type: 1, text_item: { text: '测试' } }],
};
const voiceMessage = { ...message, item_list: [{ type: 3, voice_item: { duration: 3000 } }] };
const imageMessage = { ...message, item_list: [{ type: 2, image_item: { aeskey: 'AAAA' } }] };
const config = { apiKey: 'synthetic-key' };

test('non-text messages get distinct reception reasons instead of one opaque bucket', () => {
  assert.equal(incomingTextRejection(voiceMessage, 'bot', ['allowed']), 'voice_message');
  assert.equal(incomingTextRejection(imageMessage, 'bot', ['allowed']), 'image_message');
  assert.equal(incomingTextRejection({ ...message, item_list: [{ type: 4 }] }, 'bot', ['allowed']), 'unsupported_media_type');
  assert.equal(incomingTextRejection({ ...message, item_list: [{ type: 2 }, { type: 3 }] }, 'bot', ['allowed']), 'unsupported_media_combination');
  assert.equal(incomingTextRejection(message, 'bot', ['allowed']), null);
});

test('media extraction reuses the text envelope checks and never trusts the payload shape', () => {
  const media = incomingMedia(voiceMessage, 'bot', ['allowed']);
  assert.equal(media?.kind, 'voice'); assert.equal(media?.messageId, '456');
  assert.equal(media?.contextToken, 'sensitive-context');
  assert.equal(incomingMedia(imageMessage, 'bot', ['allowed'])?.kind, 'image');
  assert.equal(incomingMedia(message, 'bot', ['allowed']), null, 'text is not media');
  assert.equal(incomingMedia({ ...voiceMessage, from_user_id: 'stranger' }, 'bot', ['allowed']), null);
  assert.equal(incomingMedia({ ...voiceMessage, message_type: 2 }, 'bot', ['allowed']), null);
  assert.equal(incomingMedia({ ...voiceMessage, message_id: Number.MAX_SAFE_INTEGER + 1 }, 'bot', ['allowed']), null);
  assert.equal(incomingText(voiceMessage, 'bot', ['allowed']), null);
  // Classification must not invent fields it has not observed.
  const classified = classifyMediaItems([{ type: 3, voice_item: { unknown_field: 1 } }]);
  assert.ok('media' in classified && classified.media.kind === 'voice');
  assert.deepEqual(Object.keys(classified.media.item), ['type', 'voice_item']);
  assert.equal(mediaRejectionReason(classified.media), 'voice_message');
});

test('voice limits fail closed before any network call or decode', async () => {
  for (const [input, code] of [
    [{ audioBase64: '', format: 'amr' }, 'voice_empty'],
    [{ audioBase64: 'AAA', format: 'avi' }, 'voice_format_unsupported'],
    [{ audioBase64: 'AAA', format: 'mp4' }, 'voice_format_unsupported'],
    [{ audioBase64: 'A'.repeat(7_000_000), format: 'amr' }, 'voice_too_large'],
    [{ audioBase64: 'AAA', format: 'amr', durationMs: 61_000 }, 'voice_too_long'],
    [{ audioBase64: 'AAA', format: 'amr', durationMs: 0 }, 'voice_too_long'],
  ] as const) assert.throws(() => validateVoice(input), (error: unknown) => error instanceof AsrError && error.code === code);
  assert.doesNotThrow(() => validateVoice({ audioBase64: 'AAA', format: 'SILK', durationMs: 59_000 }));
});

test('transcription uses a fixed endpoint, never forwards identity and classifies retries', async t => {
  let requested: { url: string; body: Record<string, unknown>; redirect?: string; auth?: string } | null = null;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    requested = { url, body: JSON.parse(options.body as string), redirect: options.redirect,
      auth: (options.headers as Record<string, string>).Authorization };
    assert.ok(!JSON.stringify(options.body).includes('allowed'), 'sender identity must not reach the model');
    return Response.json({ text: '  今天 体重 6.5 公斤  ' });
  });
  const transcript = await transcribeVoice({ audioBase64: 'AAAA', format: 'amr', durationMs: 3_000 }, config);
  assert.equal(transcript, '今天 体重 6.5 公斤');
  assert.equal(requested!.url, 'https://openrouter.ai/api/v1/audio/transcriptions');
  assert.equal(requested!.redirect, 'manual');
  assert.equal(requested!.body.model, DEFAULT_ASR_MODEL);
  assert.deepEqual(requested!.body.audio, { data: 'AAAA', format: 'amr' });
});

test('transcription failures are classified: 429/5xx retryable, 4xx and empty text terminal', async t => {
  const run = async (status: number, body: unknown): Promise<AsrError> => {
    t.mock.method(globalThis, 'fetch', async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
    try { await transcribeVoice({ audioBase64: 'AAAA', format: 'amr' }, config); }
    catch (error) { return error as AsrError; }
    throw new Error('expected_failure');
  };
  assert.equal((await run(413, { error: 'too_large' })).code, 'asr_http_413');
  assert.equal((await run(413, {})).retryable, false);
  assert.equal((await run(429, {})).retryable, true);
  assert.equal((await run(503, {})).retryable, true);
  assert.equal((await run(200, 'not-json')).code, 'invalid_asr_response');
  assert.equal((await run(200, { text: '   ' })).code, 'voice_not_recognized');
  assert.equal((await run(200, { text: 42 })).code, 'invalid_asr_response');
  await assert.rejects(transcribeVoice({ audioBase64: 'AAAA', format: 'amr' }, { apiKey: 'UNCONFIGURED' }),
    (error: unknown) => error instanceof AsrError && error.code === 'missing_openrouter_key');
});

test('the voice pipeline is wired end to end and the unverified download fails closed', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ text: '身高 70 厘米' }));
  const source = { async fetchClip() { return { audioBase64: 'AAAA', format: 'silk', durationMs: 2_000 }; } };
  const media = incomingMedia(voiceMessage, 'bot', ['allowed'])!;
  const transcript = await voiceToTranscript(source, media, { botId: 'bot', userId: 'allowed' }, config);
  assert.equal(transcript, '身高 70 厘米');
  await assert.rejects(voiceToTranscript(unverifiedVoiceSource, media, { botId: 'bot', userId: 'allowed' }, config),
    (error: unknown) => error instanceof AsrError && error.code === 'voice_download_unimplemented');
  await assert.rejects(voiceToTranscript(source, { kind: 'image', type: 2, item: {} }, { botId: 'bot', userId: 'allowed' }, config),
    (error: unknown) => error instanceof AsrError && error.code === 'not_a_voice_message');
});

test('the channel transcript is preferred over ASR and is the only field carried forward', () => {
  const item = { type: 3, voice_item: { text: '  今天 体重 6.5 公斤  ', playtime: 3000,
    media: { full_url: 'https://cdn.invalid/v', encrypt_query_param: 'cipher', aes_key: 'SUPERSECRET' } } };
  assert.equal(voiceTranscript(item), '今天 体重 6.5 公斤');
  for (const missing of [{}, { voice_item: {} }, { voice_item: { text: '' } }, { voice_item: { text: '   ' } },
    { voice_item: { text: 42 } }, { voice_item: { text: 'x'.repeat(8_001) } }, { voice_item: null }]) {
    assert.equal(voiceTranscript(missing as Record<string, unknown>), null, `unusable transcript must not be forwarded: ${JSON.stringify(missing)}`);
  }
  // Only the transcript travels; the media reference and AES key stay unread.
  const carried = JSON.stringify(voiceTranscript(item));
  assert.ok(!carried.includes('SUPERSECRET') && !carried.includes('cipher') && !carried.includes('cdn.invalid'));
  // A voice reply always carries the transcript marker even when the echo is dropped.
  const safe = markTranscript('文本', '已处理');
  assert.ok(safe.startsWith(TRANSCRIPT_MARK) && safe.includes('已处理'));
});

test('transcripts are marked, failures stay family-readable and nothing leaks internals', () => {
  const marked = markTranscript('今天 体重 6.5 公斤', '已记录 6.5 kg。记录 ID：abc');
  assert.ok(marked.startsWith(TRANSCRIPT_MARK)); assert.ok(marked.includes('今天 体重 6.5 公斤'));
  assert.ok(markTranscript('长'.repeat(200), '已处理').startsWith(`${TRANSCRIPT_MARK}\n`), 'long transcripts are not echoed back');
  assert.equal(markTranscript('x'.repeat(500), 'y'.repeat(5000)).length, 3500);
  for (const code of ['voice_too_long', 'voice_format_unsupported', 'voice_not_recognized', 'voice_download_unimplemented', 'anything_else']) {
    for (const text of [voiceFailureReply(code), voiceUnavailableReply(code)]) {
      assert.ok(text.length > 0 && !/http|Error|_|silk|AES|key/i.test(text), `internal detail leaked for ${code}`);
    }
  }
});

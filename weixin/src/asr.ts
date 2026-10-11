// Voice understanding. The transcript re-enters the same validated planning
// pipeline as typed text, so this module never plans or writes anything itself.
export const DEFAULT_ASR_MODEL = 'qwen/qwen3-asr-0.6b';
export const MAX_VOICE_MS = 60_000;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
// Replies must mark transcripts so a mishearing is visible to the family.
export const TRANSCRIPT_MARK = '（语音转写）';
// Container names the official client is known to reference. AMR/Silk is the
// expected WeChat default but has NOT been observed from a real message yet, and
// this Worker cannot transcode, so an unsupported container fails closed with a
// user-visible message instead of being forwarded as if it were valid audio.
const FORMATS = new Set(['amr', 'silk', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'webm']);

export class AsrError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) { super(code); }
}

export interface VoiceInput { audioBase64: string; format: string; durationMs?: number }
export interface AsrConfig { apiKey: string; model?: string }

export function validateVoice(input: VoiceInput): void {
  if (!input || typeof input.audioBase64 !== 'string' || !input.audioBase64) throw new AsrError('voice_empty');
  const format = String(input.format ?? '').toLowerCase();
  if (!FORMATS.has(format)) throw new AsrError('voice_format_unsupported');
  // Derived from base64 length so no decode is needed before rejecting.
  if (Math.floor(input.audioBase64.length * 3 / 4) > MAX_VOICE_BYTES) throw new AsrError('voice_too_large');
  if (input.durationMs !== undefined
    && (!Number.isFinite(input.durationMs) || input.durationMs <= 0 || input.durationMs > MAX_VOICE_MS)) throw new AsrError('voice_too_long');
}

export async function transcribeVoice(input: VoiceInput, config: AsrConfig, fetcher?: typeof fetch): Promise<string> {
  validateVoice(input);
  if (!config.apiKey || config.apiKey === 'UNCONFIGURED') throw new AsrError('missing_openrouter_key');
  let response: Response;
  try {
    response = await (fetcher ?? fetch)('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      // Request shape follows the researched OpenRouter transcription contract.
      // It is not yet confirmed against the live endpoint with a real WeChat clip.
      body: JSON.stringify({ model: config.model ?? DEFAULT_ASR_MODEL,
        audio: { data: input.audioBase64, format: String(input.format).toLowerCase() } }),
    });
  } catch { throw new AsrError('asr_timeout_or_network', true); }
  if (!response.ok) {
    await response.body?.cancel();
    // A 4xx means this audio or container was rejected: resending identical bytes is pointless.
    throw new AsrError(`asr_http_${response.status}`, response.status === 429 || response.status >= 500);
  }
  let body: { text?: unknown };
  try { body = await response.json() as { text?: unknown }; } catch { throw new AsrError('invalid_asr_response'); }
  if (typeof body.text !== 'string') throw new AsrError('invalid_asr_response');
  const text = body.text.trim();
  if (!text) throw new AsrError('voice_not_recognized');
  if (text.length > 8_000) throw new AsrError('voice_transcript_too_long');
  return text;
}

// Every failure maps to a fixed, family-readable sentence. Never a stack trace,
// never a raw vendor error, and never a silent drop.
export function voiceFailureReply(code: string): string {
  if (code === 'voice_too_long') return '这条语音太长了，请分两条发，或直接打文字。';
  if (code === 'voice_format_unsupported') return '这条语音的格式我还读不了，请用微信自带的长按转文字后发给我。';
  if (['voice_empty', 'voice_too_large', 'voice_not_recognized', 'invalid_asr_response'].includes(code)) return '没听清，请把内容转成文字发我，或重新录一条。';
  return '语音处理暂时没成功，请把内容转成文字发我。';
}

import { AsrError, TRANSCRIPT_MARK, transcribeVoice, type AsrConfig } from './asr.js';

// Official client item types. Only the type numbers are trusted from the wire;
// the inner payload layout is treated as unverified until a real message proves it.
export const IMAGE_ITEM_TYPE = 2;
export const VOICE_ITEM_TYPE = 3;
export type MediaKind = 'image' | 'voice';
export interface ClassifiedMedia { kind: MediaKind; type: number; item: Record<string, unknown> }

// Classification never guesses a payload shape. It only groups items by the
// declared type so reception counters and rejection reasons become diagnostic
// instead of collapsing every non-text message into one bucket.
export function classifyMediaItems(items: unknown[]): { media: ClassifiedMedia } | { reason: string } {
  const media: ClassifiedMedia[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as { type?: unknown };
    if (item.type !== IMAGE_ITEM_TYPE && item.type !== VOICE_ITEM_TYPE) continue;
    media.push({ kind: item.type === VOICE_ITEM_TYPE ? 'voice' : 'image', type: item.type,
      item: entry as Record<string, unknown> });
  }
  if (!media.length) return { reason: 'unsupported_media_type' };
  // One message carrying several attachments has no defined record shape yet.
  if (media.length > 1) return { reason: 'unsupported_media_combination' };
  return { media: media[0] };
}

export function mediaRejectionReason(media: ClassifiedMedia): string {
  return media.kind === 'voice' ? 'voice_message' : 'image_message';
}

// The channel supplies its own transcript on voice items, so ASR is a fallback
// rather than the default path. Bounded to the same limit as typed text. Only the
// transcript is carried forward: media references and AES keys are never persisted.
export function voiceTranscript(item: Record<string, unknown>): string | null {
  const voice = item?.voice_item as { text?: unknown } | undefined;
  if (typeof voice?.text !== 'string') return null;
  const trimmed = voice.text.trim();
  return trimmed && trimmed.length <= 8_000 ? trimmed : null;
}

export interface VoiceClip { audioBase64: string; format: string; durationMs?: number }
export interface VoiceSourceContext { botId: string; userId: string }

// Downloading a WeChat voice clip needs the real voice_item layout (CDN reference
// plus AES key) and AES-128 decryption. Neither is implemented, because neither
// can be validated without a real inbound voice message. This seam exists so the
// entire downstream path is real and testable today, while the missing piece
// fails closed with a family-readable message rather than a guessed parse.
export interface VoiceSource {
  fetchClip(media: ClassifiedMedia, context: VoiceSourceContext): Promise<VoiceClip>;
}

export const unverifiedVoiceSource: VoiceSource = {
  async fetchClip() { throw new AsrError('voice_download_unimplemented'); },
};

export function voiceUnavailableReply(code: string): string {
  if (code === 'voice_download_unimplemented') return '收到你的语音了，但目前这个版本还读不了语音内容，请把要记的内容打成文字发我。';
  return '收到你的语音了，但没能转成文字，请打成文字发我。';
}

export async function voiceToTranscript(source: VoiceSource, media: ClassifiedMedia, context: VoiceSourceContext,
  config: AsrConfig, fetcher?: typeof fetch): Promise<string> {
  if (media.kind !== 'voice') throw new AsrError('not_a_voice_message');
  const clip = await source.fetchClip(media, context);
  return transcribeVoice(clip, config, fetcher);
}

// The transcript is echoed back so a mishearing is visible, and it is never
// presented as if the family had typed it.
export function markTranscript(transcript: string, reply: string, limit = 3500): string {
  const echo = transcript.length <= 120 ? `${TRANSCRIPT_MARK}${transcript}\n` : `${TRANSCRIPT_MARK}\n`;
  return (echo + reply).slice(0, limit);
}

import { decryptCdnMedia } from './aes-ecb.js';
import { downloadImage, imageSignature } from './image-probe.js';

// Channel image archiving: download, decrypt, upload to the MyBaby intake
// endpoint. The channel never holds storage credentials and never chooses a
// destination; it only forwards bytes plus its identity.
export interface ArchiveIdentity { source: 'weixin'; botId: string; userId: string; messageId: string }
export interface ArchiveConfig { origin: string; token: string; date: string; index: number; fetcher?: typeof fetch }

// The key lives on image_item.media.aes_key (the nested field the official client
// uses), not the top-level image_item.aeskey.
export function imageAesKey(item: Record<string, unknown>): string | null {
  const media = (item?.image_item as { media?: { aes_key?: unknown } } | undefined)?.media;
  const key = media?.aes_key;
  return typeof key === 'string' && key ? key : null;
}

// The probe measured an empty content type, so the type is decided from the
// decrypted container instead of being trusted from the response.
export function imageContentType(plaintext: Uint8Array): string | null {
  switch (imageSignature(plaintext)) {
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return null;
  }
}

export interface ArchiveResult { status: number; bytes: number; contentType: string }

export async function archiveChannelImage(url: string, aesKey: string, identity: ArchiveIdentity,
  config: ArchiveConfig): Promise<ArchiveResult> {
  const ciphertext = await downloadImage(url, config.fetcher);
  let plaintext: Uint8Array;
  try {
    // ECB with validated PKCS#7: a wrong key fails here rather than later.
    plaintext = decryptCdnMedia(ciphertext, aesKey);
  } catch { throw new Error('image_decrypt_failed'); }
  // A wrong key can still pass padding by chance, so the container is checked too.
  // Without this a broken decrypt would be archived as an unopenable photo.
  const contentType = imageContentType(plaintext);
  if (!contentType) throw new Error('image_decrypt_failed');
  const form = new FormData();
  form.set('botId', identity.botId);
  form.set('userId', identity.userId);
  form.set('messageId', identity.messageId);
  form.set('date', config.date);
  form.set('index', String(config.index));
  form.set('file', new Blob([plaintext as unknown as ArrayBuffer], { type: contentType }), `image.${contentType.split('/')[1]}`);
  let response: Response;
  try {
    response = await (config.fetcher ?? fetch)(`${config.origin}/api/agent/media`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${config.token}` }, body: form,
    });
  } catch { throw new Error('media_intake_network'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`media_intake_http_${response.status}`); }
  return { status: response.status, bytes: plaintext.length, contentType };
}

// Fixed, family-readable outcomes. Never a raw code, a URL or a key.
export function imageIntakeReply(code: string): string {
  if (code === 'image_too_large') return '这张照片太大了，请到网页上传原图。';
  if (code === 'image_decrypt_failed') return '这张照片没能正确读取，请到网页上传一次。';
  if (code === 'media_intake_http_403' || code === 'media_intake_http_409') return '相册暂时不接受这张照片，请到网页上传。';
  return '照片暂时没能存进相册，请稍后再试或到网页上传。';
}

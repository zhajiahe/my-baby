// Image download probe.
//
// The open question is whether image_item.media.full_url returns a ready-to-store
// image or an AES-128 payload. Getting that wrong is the worst failure mode: a
// file that stores fine and cannot be opened. So before any decryption is written
// (which must copy the official client, never be invented) this probe fetches the
// URL once and reports only a summary.
//
// Fetching a channel-supplied URL is an SSRF surface, so the host is checked
// against an allowlist before any request, redirects are refused rather than
// followed, and the body read is bounded.
const ALLOWED_HOST = /(^|\.)(qpic\.cn|qlogo\.cn|gtimg\.cn|weixin\.qq\.com|weixin\.qq\.com\.cn|wechat\.com|wx\.qq\.com)$/i;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ImageProbe { status?: number; contentType?: string; bytes?: number; signature?: string; host?: string; error?: string }

export function imageURL(item: Record<string, unknown>): string | null {
  const media = (item?.image_item as { media?: { full_url?: unknown } } | undefined)?.media;
  const url = media?.full_url;
  if (typeof url !== 'string' || !url || url.length > 2_000) return null;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.toString() : null; } catch { return null; }
}

export function allowedImageHost(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && ALLOWED_HOST.test(parsed.hostname); }
  catch { return false; }
}

// Only the registrable suffix is reported: enough to correct the allowlist,
// without recording a full channel URL.
export function registrableHost(url: string): string {
  try { return new URL(url).hostname.split('.').slice(-2).join('.'); } catch { return ''; }
}

// A plain, ready-to-store image starts with a known container header. Anything
// else means the payload is not directly usable, which is exactly the signal that
// decides whether AES-128 decryption is required.
export function imageSignature(bytes: Uint8Array): string {
  const text = (start: number, end: number) => String.fromCharCode(...Array.from(bytes.slice(start, end)));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (text(0, 4) === '\x89PNG') return 'png';
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return 'gif';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  return 'unknown';
}

async function readBounded(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { await response.body?.cancel(); throw new Error('image_too_large'); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    if (size > max) { await reader.cancel(); throw new Error('image_too_large'); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function probeImage(url: string, fetcher: typeof fetch = fetch): Promise<ImageProbe> {
  // The allowlist is enforced before any request leaves the Worker.
  if (!allowedImageHost(url)) return { error: 'image_host_not_allowed', host: registrableHost(url) };
  let response: Response;
  try {
    // Workers rejects redirect:'error'; manual lets a 3xx be refused below rather
    // than followed to an unverified host.
    response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  } catch { return { error: 'image_fetch_failed', host: registrableHost(url) }; }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return { status: response.status, error: 'image_redirect_refused', host: registrableHost(url) }; }
  let bytes: Uint8Array;
  try { bytes = await readBounded(response, MAX_IMAGE_BYTES); }
  catch (error) { return { status: response.status, error: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'image_read_failed', host: registrableHost(url) }; }
  return { status: response.status, contentType: (response.headers.get('content-type') ?? '').slice(0, 60),
    bytes: bytes.length, signature: imageSignature(bytes), host: registrableHost(url) };
}

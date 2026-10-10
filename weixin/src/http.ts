export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 32) return false; // Fail closed if not configured.
  const provided = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const encode = (s: string) => new TextEncoder().encode(s);
  const [a, b] = await Promise.all([token, provided].map(s => crypto.subtle.digest('SHA-256', encode(s))));
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  if (!request.body) throw new Error('invalid_body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new Error('invalid_body'); }
}

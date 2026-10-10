import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const localDir = fileURLToPath(new URL('../.local/', import.meta.url).href);
export const workerName = 'mybaby-weixin';
export interface ClientConfig { origin?: string; adminToken: string }

export async function saveLocal(name: string, data: unknown): Promise<void> {
  await mkdir(localDir, { recursive: true, mode: 0o700 });
  const temp = join(localDir, `.${name}.${crypto.randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, join(localDir, name));
}

export async function loadLocal<T>(name: string): Promise<T> {
  const path = join(localDir, name);
  const info = await stat(path);
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('local_file_permissions_must_be_0600');
  const content = await readFile(path, 'utf8');
  try { return JSON.parse(content) as T; } catch { throw new Error('local_file_invalid_json'); }
}

export function workerOrigin(input: string): string {
  const u = new URL(input);
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
    || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('invalid_worker_origin');
  return u.origin;
}

export async function admin(action: string, body?: unknown): Promise<unknown> {
  const config = await loadLocal<ClientConfig>('client.json');
  if (!config.origin) throw new Error('run_session_url_first');
  const response = await fetch(`${workerOrigin(config.origin)}/admin/session/${action}`, {
    method: action === 'status' ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${config.adminToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`admin_http_${response.status}`);
  return response.json();
}

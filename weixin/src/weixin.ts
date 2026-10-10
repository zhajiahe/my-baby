// Independently implemented against Tencent/openclaw-weixin protocol at
// c6643f6f0ac03574eb126f2d69569ea4267cc3c6 (channel version 2.4.10).
export const API_BASE = 'https://ilinkai.weixin.qq.com';
export const CHANNEL_VERSION = '2.4.10';
const CLIENT_VERSION = String((2 << 16) | (4 << 8) | 10);

export class ILinkError extends Error {
  constructor(public readonly category: string, public readonly retryable: boolean,
    public readonly uncertain = false) { super(category); }
}

// Restrict credential-bearing requests to the observed service domain family.
export function trustedBaseUrl(input: string): string {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^ilinkai(?:[a-z0-9-]*\.)?weixin\.qq\.com$/.test(host)
    || url.pathname !== '/' || url.search || url.hash) throw new Error('untrusted_api_base');
  return url.origin;
}

function headers(post: boolean, token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': CLIENT_VERSION,
  };
  if (post) {
    h['Content-Type'] = 'application/json';
    h.AuthorizationType = 'ilink_bot_token';
    h['X-WECHAT-UIN'] = btoa(String(crypto.getRandomValues(new Uint32Array(1))[0]));
  }
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function ilinkRequest(base: string, path: string, options: {
  body?: unknown; token?: string; timeoutMs?: number; signal?: AbortSignal;
} = {}): Promise<Record<string, unknown>> {
  const post = options.body !== undefined;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  let response: Response;
  try {
    response = await fetch(`${trustedBaseUrl(base)}/${path}`, {
      method: post ? 'POST' : 'GET', headers: headers(post, options.token),
      body: post ? JSON.stringify(options.body) : undefined,
      redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch {
    throw new ILinkError(options.signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'network', true, true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new ILinkError('auth_expired', false);
    throw new ILinkError(`http_${response.status}`, response.status === 429 || response.status >= 500, response.status >= 500);
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new ILinkError('invalid_json', true, true); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ILinkError('invalid_response', true, true);
  const result = data as Record<string, unknown>;
  if (result.ret === -14 || result.errcode === -14) throw new ILinkError('auth_expired', false);
  for (const code of [result.ret, result.errcode]) {
    if (code !== undefined && code !== 0) throw new ILinkError('protocol_rejected', false);
  }
  return result;
}

const baseInfo = () => ({ channel_version: CHANNEL_VERSION, bot_agent: 'MyBaby/0.1.0' });

export interface Updates {
  msgs: unknown[];
  cursor?: string;
  timeoutMs?: number;
}

export async function getUpdates(base: string, token: string, cursor: string,
  timeoutMs: number, signal?: AbortSignal): Promise<Updates> {
  const result = await ilinkRequest(base, 'ilink/bot/getupdates', {
    token, body: { get_updates_buf: cursor, base_info: baseInfo() }, timeoutMs, signal,
  });
  if (result.msgs !== undefined && !Array.isArray(result.msgs)) throw new ILinkError('invalid_messages', true);
  return {
    msgs: (result.msgs ?? []) as unknown[],
    cursor: typeof result.get_updates_buf === 'string' && result.get_updates_buf ? result.get_updates_buf : undefined,
    timeoutMs: typeof result.longpolling_timeout_ms === 'number'
      ? Math.min(60_000, Math.max(5_000, result.longpolling_timeout_ms + 5_000)) : undefined,
  };
}

export async function sendText(base: string, token: string, userId: string,
  contextToken: string, clientId: string, text: string): Promise<void> {
  await ilinkRequest(base, 'ilink/bot/sendmessage', {
    token, body: {
      msg: { from_user_id: '', to_user_id: userId, client_id: clientId,
        message_type: 2, message_state: 2, context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }] },
      base_info: baseInfo(),
    },
  });
}

export interface IncomingText {
  messageId: string; userId: string; text: string; contextToken: string;
}

export function incomingText(value: unknown, botId: string, allowed: string[]): IncomingText | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (m.message_type !== 1 || m.message_state !== 2 || m.group_id
    || typeof m.from_user_id !== 'string' || !allowed.includes(m.from_user_id)
    || m.from_user_id === botId || (m.to_user_id && m.to_user_id !== botId)
    || typeof m.context_token !== 'string' || !m.context_token
    || !Array.isArray(m.item_list)) return null;
  const id = m.message_id;
  // Fail closed on unsafe numeric IDs rather than deduplicating rounded values.
  if (!(typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
    && !(typeof id === 'string' && /^\d{1,30}$/.test(id))) return null;
  const texts: string[] = [];
  for (const item of m.item_list) {
    if (!item || typeof item !== 'object' || item.type !== 1) continue;
    if (typeof item.text_item?.text === 'string') texts.push(item.text_item.text);
  }
  const text = texts.join('\n').trim();
  if (!text || text.length > 8_000 || m.context_token.length > 8_000) return null;
  return { messageId: String(id), userId: m.from_user_id, text, contextToken: m.context_token };
}

export async function eventId(botId: string, messageId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([botId, messageId])));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

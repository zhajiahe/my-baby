// Independently implemented against Tencent/openclaw-weixin protocol at
// c6643f6f0ac03574eb126f2d69569ea4267cc3c6 (channel version 2.4.10).
import JSONBig from 'json-bigint';

// Parse the wire text before JS can round uint64 IDs. Never attempt to repair
// an already rounded Number: two distinct messages could share a dedup key.
const wireJSON = JSONBig({ storeAsString: true, strict: true, protoAction: 'error', constructorAction: 'error' });

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

// Map transport diagnostics to a fixed vocabulary; never log raw errors,
// which may embed the credential-bearing request URL or headers.
export function transportCategory(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : '';
  if (/network connection lost|connection reset|ECONNRESET/i.test(message)) return 'network_connection_lost';
  if (/TLS|SSL|certificate/i.test(message)) return 'network_tls';
  if (/DNS|resolve host|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'network_dns';
  if (/invalid|unsupported|header|not a function/i.test(message)) return 'network_request_invalid';
  if (/fetch failed/i.test(message)) return 'network_fetch_failed';
  return 'network';
}

// Some deployed compatibility dates do not implement AbortSignal.any even
// when the newest workers-types declares it. Use portable event composition.
function combineSignals(timeout: AbortSignal, external?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!external) return { signal: timeout, dispose: () => {} };
  const controller = new AbortController();
  const onTimeout = () => controller.abort(timeout.reason);
  const onExternal = () => controller.abort(external.reason);
  if (timeout.aborted) onTimeout(); else timeout.addEventListener('abort', onTimeout, { once: true });
  if (external.aborted) onExternal(); else external.addEventListener('abort', onExternal, { once: true });
  return { signal: controller.signal, dispose: () => {
    timeout.removeEventListener('abort', onTimeout); external.removeEventListener('abort', onExternal);
  } };
}

export async function ilinkRequest(base: string, path: string, options: {
  body?: unknown; token?: string; timeoutMs?: number; signal?: AbortSignal; fetcher?: typeof fetch;
} = {}): Promise<Record<string, unknown>> {
  const post = options.body !== undefined;
  // A native timeout signal cannot be cancelled after a successful fetch.
  // Clear our timer explicitly so completed requests leave no pending timers.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? 15_000);
  const timeout = timeoutController.signal;
  const joined = combineSignals(timeout, options.signal);
  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(`${trustedBaseUrl(base)}/${path}`, {
        method: post ? 'POST' : 'GET', headers: headers(post, options.token),
        body: post ? JSON.stringify(options.body) : undefined,
        redirect: 'manual', signal: joined.signal,
      });
    } catch (error) {
      throw new ILinkError(options.signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : transportCategory(error), true, true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new ILinkError('auth_expired', false);
      throw new ILinkError(`http_${response.status}`, response.status === 429 || response.status >= 500, response.status >= 500);
    }
    let data: unknown;
    try { data = wireJSON.parse(await response.text()); } catch { throw new ILinkError('invalid_json', true, true); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ILinkError('invalid_response', true, true);
    const result = data as Record<string, unknown>;
    if (result.ret === -14 || result.errcode === -14) throw new ILinkError('auth_expired', false);
    for (const code of [result.ret, result.errcode]) {
      if (code !== undefined && code !== 0) throw new ILinkError('protocol_rejected', false);
    }
    return result;
  } finally { joined.dispose(); clearTimeout(timer); }
}

const baseInfo = () => ({ channel_version: CHANNEL_VERSION, bot_agent: 'MyBaby/0.1.0' });

export interface Updates {
  msgs: unknown[];
  cursor?: string;
  timeoutMs?: number;
}

export async function getUpdates(base: string, token: string, cursor: string,
  timeoutMs: number, signal?: AbortSignal, fetcher?: typeof fetch): Promise<Updates> {
  const result = await ilinkRequest(base, 'ilink/bot/getupdates', {
    token, body: { get_updates_buf: cursor, base_info: baseInfo() }, timeoutMs, signal, fetcher,
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
  contextToken: string, clientId: string, text: string, fetcher?: typeof fetch): Promise<void> {
  await ilinkRequest(base, 'ilink/bot/sendmessage', {
    token, fetcher, body: {
      msg: { from_user_id: '', to_user_id: userId, client_id: clientId,
        message_type: 2, message_state: 2, context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }] },
      base_info: baseInfo(),
    },
  });
}

export interface IncomingText {
  messageId: string; userId: string; text: string; contextToken: string; receivedAt: number;
}

// Fixed reason codes provide reception diagnostics without storing sender IDs,
// message text or context credentials for rejected messages.
export function incomingTextRejection(value: unknown, botId: string, allowed: string[]): string | null {
  if (!value || typeof value !== 'object') return 'invalid_message';
  const m = value as Record<string, unknown>;
  if (m.message_type !== 1) return 'not_user_message';
  // NEW (0) and omitted state are valid inbound text. FINISH (2) is the
  // outbound bot convention, not an inbound requirement. Ignore streaming (1).
  if (m.message_state !== undefined && m.message_state !== 0 && m.message_state !== 2) return 'incomplete_state';
  if (m.group_id) return 'unsupported_group';
  if (typeof m.from_user_id !== 'string' || !allowed.includes(m.from_user_id)) return 'unauthorized_sender';
  if (m.from_user_id === botId) return 'self_message';
  if (m.to_user_id && m.to_user_id !== botId) return 'recipient_mismatch';
  if (typeof m.context_token !== 'string' || !m.context_token) return 'missing_context';
  if (!Array.isArray(m.item_list)) return 'invalid_items';
  const id = m.message_id;
  if (!(typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
    && !(typeof id === 'string' && /^\d{1,30}$/.test(id))) return 'invalid_message_id';
  const text = textItems(m.item_list);
  if (!text) return 'non_text_message';
  if (text.length > 8_000 || m.context_token.length > 8_000) return 'message_too_large';
  return null;
}

function textItems(items: unknown[]): string {
  return items.flatMap(item => {
    const value = item as { type?: number; text_item?: { text?: unknown } } | null;
    return value?.type === 1 && typeof value.text_item?.text === 'string' ? [value.text_item.text] : [];
  }).join('\n').trim();
}

export function incomingText(value: unknown, botId: string, allowed: string[]): IncomingText | null {
  if (incomingTextRejection(value, botId, allowed)) return null;
  const m = value as { message_id: string | number; from_user_id: string; context_token: string; item_list: unknown[]; create_time_ms?: number };
  const id = m.message_id;
  const text = textItems(m.item_list);
  const receivedAt = typeof m.create_time_ms === 'number' && Number.isSafeInteger(m.create_time_ms)
    && m.create_time_ms > 0 && m.create_time_ms <= Date.now() + 60_000 ? m.create_time_ms : Date.now();
  return { messageId: String(id), userId: m.from_user_id, text, contextToken: m.context_token, receivedAt };
}

export async function eventId(botId: string, messageId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([botId, messageId])));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

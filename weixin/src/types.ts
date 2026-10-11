export const SESSION_NAME = 'personal';
export const DEFAULT_MODEL = 'meta/muse-spark-1.3-contributor';

export interface Env {
  WEIXIN_SESSION: DurableObjectNamespace;
  INBOX: Queue<InboxEvent>;
  WEIXIN_ADMIN_TOKEN: string;
  WEIXIN_BOT_TOKEN: string;
  OPENROUTER_MODEL: string;
  AGENT_MODE?: 'bridge' | 'agent';
  OPENROUTER_API_KEY?: string;
  MYBABY_API_ORIGIN?: string;
  MYBABY_AGENT_TOKEN?: string;
  AGENT_WRITES_ENABLED?: string;
  AGENT_TIME_ZONE?: string;
  // ASR model override for voice understanding.
  // Structural probe is off unless a deploy explicitly enables it. It records
  // protocol field paths only, never values.
  MEDIA_PROBE_ENABLED?: string;
  // Only the separately named synthetic acceptance Worker supplies this.
  DEPLOYMENT_KIND?: 'synthetic-acceptance';
  ILINK_ACCEPTANCE?: DurableObjectNamespace;
}

// Queue contains references only, never message text or context credentials.
export interface InboxEvent {
  version: 1;
  eventId: string;
  generation: number;
}

export interface SessionConfig {
  botId: string;
  apiBaseUrl: string;
  allowedUserIds: string[];
  generation: number;
  state: 'paused' | 'running' | 'backoff' | 'auth_expired';
  cursor: string;
  pollTimeoutMs: number;
  failures: number;
  lastPollAt?: number;
  lastError?: string;
}

export type StoredEvent = {
  id: string;
  generation: number;
  user_id: string;
  message_id: string;
  text: string;
  context_token: string;
  received_at: number;
  state: 'pending' | 'queued' | 'processing' | 'sending' | 'done' | 'failed' | 'unknown' | 'stale';
  lease_until: number;
};

export function isInboxEvent(value: unknown): value is InboxEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<InboxEvent>;
  return e.version === 1 && typeof e.eventId === 'string' && /^[a-f0-9]{64}$/.test(e.eventId)
    && Number.isSafeInteger(e.generation) && (e.generation ?? 0) > 0;
}

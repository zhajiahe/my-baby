import { authorized, json, readJson } from './http.js';
import { getUpdates, sendText, incomingText, incomingTextRejection, eventId, trustedBaseUrl, ILinkError } from './weixin.js';
import { isInboxEvent, type Env, type SessionConfig, type StoredEvent } from './types.js';
import { prepareAgentReply, type AgentCheckpoint } from './agent-run.js';
import { AgentError } from './agent.js';
import { formatResults } from './tools.js';

const RETENTION_MS = 30 * 86_400_000;
const LEASE_MS = 60_000;
const ACTIVE = new Set(['running', 'backoff']);

export class WeixinSession {
  private pollController?: AbortController;
  private readonly consumers = new Map<string, AbortController>();
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, generation INTEGER NOT NULL, user_id TEXT NOT NULL,
      text TEXT NOT NULL, context_token TEXT NOT NULL, received_at INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', lease_until INTEGER NOT NULL DEFAULT 0,
      error TEXT
    )`);
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS events_state ON events(state, received_at)');
    const columns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(events)').toArray();
    if (!columns.some(column => column.name === 'message_id')) {
      ctx.storage.sql.exec("ALTER TABLE events ADD COLUMN message_id TEXT NOT NULL DEFAULT ''");
    }
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
      event_id TEXT PRIMARY KEY, checkpoint TEXT NOT NULL
    )`);
  }

  private config(): SessionConfig | undefined { return this.ctx.storage.kv.get<SessionConfig>('config'); }
  private save(config: SessionConfig): void { this.ctx.storage.kv.put('config', config); }
  private current(generation: number): SessionConfig | undefined {
    const c = this.config();
    return c?.generation === generation && ACTIVE.has(c.state) ? c : undefined;
  }
  private terminal(id: string, state: string, error?: string): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`UPDATE events SET state=?, text='', context_token='', user_id='',
        lease_until=0, error=? WHERE id=?`, state, error ?? null, id);
      this.ctx.storage.sql.exec('DELETE FROM agent_runs WHERE event_id=?', id);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!await authorized(request, this.env.WEIXIN_ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
    const path = new URL(request.url).pathname;
    if (path === '/status' && request.method === 'GET') return this.status();
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (path === '/bind') {
      if (ACTIVE.has(this.config()?.state ?? '')) return json({ error: 'pause_before_binding' }, 409);
      let data: Record<string, unknown>;
      try {
        data = await readJson(request) as Record<string, unknown>;
        if (!data || typeof data.botId !== 'string' || !data.botId.trim() || data.botId.length > 256
          || !Array.isArray(data.allowedUserIds) || !data.allowedUserIds.length || data.allowedUserIds.length > 10
          || !data.allowedUserIds.every(x => typeof x === 'string' && x.trim() && x.length <= 256)
          || typeof data.apiBaseUrl !== 'string') throw new Error();
        data.apiBaseUrl = trustedBaseUrl(data.apiBaseUrl);
      } catch { return json({ error: 'invalid_binding' }, 400); }
      // Re-check after body IO: a concurrent start must not get overwritten.
      if (ACTIVE.has(this.config()?.state ?? '')) return json({ error: 'pause_before_binding' }, 409);
      const unresolved = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE state IN ('pending','queued','processing','sending')").toArray()[0].count;
      if (unresolved && data.discardPending !== true) {
        return json({ error: 'unresolved_events_require_explicit_discard', count: unresolved }, 409);
      }
      this.pollController?.abort();
      for (const controller of this.consumers.values()) controller.abort();
      const previous = this.config();
      const next: SessionConfig = {
        botId: data.botId as string, apiBaseUrl: data.apiBaseUrl as string,
        allowedUserIds: [...new Set(data.allowedUserIds as string[])],
        generation: (previous?.generation ?? 0) + 1, state: 'paused',
        cursor: previous?.botId === data.botId ? previous.cursor : '', pollTimeoutMs: 40_000, failures: 0,
      };
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(`UPDATE events SET state='stale', text='', context_token='', user_id='',
          error='rebound' WHERE state IN ('pending','queued','processing','sending')`);
        this.ctx.storage.sql.exec('DELETE FROM agent_runs');
        this.save(next);
        this.ctx.storage.deleteAlarm();
      });
      return json({ bound: true, generation: next.generation, state: next.state });
    }
    if (path === '/start' || path === '/pause') {
      const c = this.config();
      if (!c) return json({ error: 'not_bound' }, 409);
      if (path === '/start' && (!this.env.WEIXIN_BOT_TOKEN || this.env.WEIXIN_BOT_TOKEN === 'UNBOUND')) {
        return json({ error: 'missing_bot_token' }, 409);
      }
      if (path === '/pause') {
        c.state = 'paused'; this.save(c); this.pollController?.abort();
        for (const controller of this.consumers.values()) controller.abort();
        await this.ctx.storage.deleteAlarm();
      } else {
        c.state = 'running'; c.failures = 0; delete c.lastError; this.save(c);
        await this.ctx.storage.setAlarm(Date.now() + 1_000);
      }
      return json({ state: c.state });
    }
    if (path === '/consume') {
      const value = await readJson(request).catch(() => null);
      if (!isInboxEvent(value)) return json({ error: 'invalid_event' }, 400);
      return this.consume(value.eventId, value.generation);
    }
    return json({ error: 'not_found' }, 404);
  }

  private async status(): Promise<Response> {
    const c = this.config();
    const counts = Object.fromEntries(Array.from(this.ctx.storage.sql.exec<{ state: string; count: number }>(
      'SELECT state, COUNT(*) AS count FROM events GROUP BY state')).map(row => [row.state, row.count]));
    return json({ adapterVersion: '0.1.3', state: c?.state ?? 'unbound', generation: c?.generation ?? 0,
      lastPollAt: c?.lastPollAt ?? null, lastError: c?.lastError ?? null,
      failures: c?.failures ?? 0, cursorSaved: Boolean(c?.cursor),
      nextAlarmAt: await this.ctx.storage.getAlarm(), events: counts,
      reception: this.ctx.storage.kv.get('reception') ?? { received: 0, accepted: 0, rejected: {} },
      observation: this.ctx.storage.kv.get('observation') ?? null });
  }

  private observe(success: boolean, category?: string): void {
    const now = Date.now();
    const metrics = this.ctx.storage.kv.get<{ startedAt: number; completedPolls: number; failedCycles: number;
      lastSuccessAt: number | null; maxSuccessGapMs: number; lastFailureAt: number | null; lastFailureCategory: string | null }>('observation')
      ?? { startedAt: now, completedPolls: 0, failedCycles: 0, lastSuccessAt: null, maxSuccessGapMs: 0,
        lastFailureAt: null, lastFailureCategory: null };
    if (success) {
      metrics.completedPolls++;
      if (metrics.lastSuccessAt !== null) metrics.maxSuccessGapMs = Math.max(metrics.maxSuccessGapMs, now - metrics.lastSuccessAt);
      metrics.lastSuccessAt = now;
    } else {
      metrics.failedCycles++; metrics.lastFailureAt = now; metrics.lastFailureCategory = category ?? 'internal_or_queue';
    }
    this.ctx.storage.kv.put('observation', metrics);
  }

  private async flush(generation: number): Promise<void> {
    const rows = Array.from(this.ctx.storage.sql.exec<StoredEvent>(
      "SELECT * FROM events WHERE state='pending' AND generation=? ORDER BY received_at LIMIT 50", generation));
    for (const row of rows) {
      if (!this.current(generation)) return;
      await this.env.INBOX.send({ version: 1, eventId: row.id, generation });
      // Queue can consume before send resolves; don't overwrite a newer state.
      this.ctx.storage.sql.exec("UPDATE events SET state='queued' WHERE id=? AND state='pending' AND generation=?", row.id, generation);
    }
  }

  async alarm(): Promise<void> {
    const c = this.config();
    if (!c || !ACTIVE.has(c.state)) return;
    const generation = c.generation;
    // Cloudflare serializes alarms. This flag additionally protects manual restarts.
    if (this.pollController) return;
    const controller = new AbortController();
    this.pollController = controller;
    try {
      // Durable watchdog is set before external IO; crash recovery retains a wakeup.
      await this.ctx.storage.setAlarm(Date.now() + 90_000);
      await this.flush(generation);
      if (!this.current(generation)) return;
      const result = await getUpdates(c.apiBaseUrl, this.env.WEIXIN_BOT_TOKEN,
        c.cursor, c.pollTimeoutMs, controller.signal);
      const messages: Array<{ id: string; messageId: string; userId: string; text: string; contextToken: string; receivedAt: number }> = [];
      const reception = this.ctx.storage.kv.get<{ received: number; accepted: number; rejected: Record<string, number> }>('reception')
        ?? { received: 0, accepted: 0, rejected: {} };
      for (const raw of result.msgs) {
        reception.received++;
        const reason = incomingTextRejection(raw, c.botId, c.allowedUserIds);
        if (reason) {
          reception.rejected[reason] = (reception.rejected[reason] ?? 0) + 1;
          // An otherwise authorized text with an unusable ID must not be
          // acknowledged by advancing the cursor: retain it for recovery.
          if (reason === 'invalid_message_id') {
            this.ctx.storage.kv.put('reception', reception);
            throw new ILinkError('invalid_message_id', true);
          }
          continue;
        }
        reception.accepted++;
        const m = incomingText(raw, c.botId, c.allowedUserIds);
        if (m) messages.push({ ...m, id: await eventId(c.botId, m.messageId) });
      }
      const live = this.current(generation);
      if (!live || controller.signal.aborted) return; // Pause/rebind invalidates in-flight response.
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.kv.put('reception', reception);
        this.observe(true);
        for (const m of messages) {
          this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO events
            (id,generation,user_id,text,context_token,received_at,message_id) VALUES (?,?,?,?,?,?,?)`,
          m.id, generation, m.userId, m.text, m.contextToken, m.receivedAt, m.messageId);
        }
        live.cursor = result.cursor ?? live.cursor;
        live.pollTimeoutMs = result.timeoutMs ?? live.pollTimeoutMs;
        live.lastPollAt = Date.now(); live.state = 'running'; live.failures = 0; delete live.lastError;
        this.save(live);
        this.ctx.storage.sql.exec("DELETE FROM events WHERE state IN ('done','failed','unknown','stale') AND received_at<?", Date.now() - RETENTION_MS);
      });
      await this.flush(generation);
      if (this.current(generation) && !controller.signal.aborted) await this.ctx.storage.setAlarm(Date.now() + 1_000);
    } catch (error) {
      const live = this.current(generation);
      if (!live || controller.signal.aborted) return;
      const category = error instanceof ILinkError ? error.category : 'internal_or_queue';
      live.lastError = category; live.failures++;
      this.observe(false, category);
      if (category === 'auth_expired' || category === 'protocol_rejected') {
        live.state = 'auth_expired'; this.save(live); await this.ctx.storage.deleteAlarm();
      } else {
        live.state = 'backoff'; this.save(live);
        const delay = Math.min(300_000, 2_000 * 2 ** Math.min(live.failures, 8)) + Math.floor(Math.random() * 1_000);
        await this.ctx.storage.setAlarm(Date.now() + delay);
      }
      console.warn(JSON.stringify({ event: 'poll_error', category }));
    } finally { this.pollController = undefined; }
  }

  private async consume(id: string, generation: number): Promise<Response> {
    const row = this.ctx.storage.sql.exec<StoredEvent>('SELECT * FROM events WHERE id=?', id).toArray()[0];
    if (!row) return json({ error: 'event_not_found' }, 404); // Dead-letter, never silently lose an unknown event.
    if (['done','failed','unknown','stale'].includes(row.state)) return json({ state: row.state });
    const c = this.current(generation);
    if (!c) return json({ error: 'session_not_running' }, 503);
    if (row.generation !== generation || !c.allowedUserIds.includes(row.user_id)) {
      this.terminal(id, 'stale', 'authorization_changed'); return json({ state: 'stale' });
    }
    if (row.state === 'sending') {
      if (row.lease_until > Date.now()) return json({ error: 'in_flight' }, 503);
      this.terminal(id, 'unknown', 'send_interrupted'); return json({ state: 'unknown' });
    }
    if (row.state === 'processing' && row.lease_until > Date.now()) return json({ error: 'in_flight' }, 503);
    const controller = new AbortController(); this.consumers.set(id, controller);
    const guard = () => {
      if (controller.signal.aborted || !this.current(generation)) throw new AgentError('session_not_running', true);
    };
    const agentMode = this.env.AGENT_MODE === 'agent';
    // Planning/tool phases are resumable; only the external send has an ambiguous outcome.
    this.ctx.storage.sql.exec("UPDATE events SET state=?, lease_until=? WHERE id=?",
      agentMode ? 'processing' : 'sending', Date.now() + (agentMode ? 150_000 : LEASE_MS), id);
    try {
      let reply = `微信桥接测试成功，已收到：${row.text.slice(0, 500)}\n当前尚未接入 AI 或成长记录写入。`;
      if (agentMode) {
        const saved = this.ctx.storage.sql.exec<{ checkpoint: string }>('SELECT checkpoint FROM agent_runs WHERE event_id=?', id).toArray()[0];
        const checkpoint: AgentCheckpoint = saved ? JSON.parse(saved.checkpoint) : { results: [] };
        const persist = async (value: AgentCheckpoint) => {
          // Persist already-completed tool results even after pause, but never after rebind/discard.
          const live = this.config();
          if (live?.generation !== generation) throw new AgentError('session_rebound', true);
          this.ctx.storage.sql.exec('INSERT OR REPLACE INTO agent_runs (event_id,checkpoint) VALUES (?,?)', id, JSON.stringify(value));
        };
        try {
          reply = await prepareAgentReply({ identity: { source: 'weixin', botId: c.botId,
            userId: row.user_id, messageId: row.message_id || id }, text: row.text, receivedAt: row.received_at }, {
            apiKey: this.env.OPENROUTER_API_KEY ?? '', model: this.env.OPENROUTER_MODEL,
            origin: this.env.MYBABY_API_ORIGIN ?? '', token: this.env.MYBABY_AGENT_TOKEN ?? '',
            writesEnabled: this.env.AGENT_WRITES_ENABLED === 'true', timeZone: this.env.AGENT_TIME_ZONE ?? 'Asia/Shanghai',
          }, checkpoint, persist, guard);
        } catch (error) {
          if (!(error instanceof AgentError) || error.retryable) throw error;
          // Do not claim all operations succeeded after a partial failure. Only
          // acknowledged results are reported, and revoked access exposes none.
          const forbidden = ['business_http_401','business_http_403'].includes(error.code);
          const completed = !forbidden && checkpoint.results.length && checkpoint.plan
            ? formatResults({ version: 1, operations: checkpoint.plan.operations.slice(0, checkpoint.results.length) }, checkpoint.results) : '';
          reply = `${completed ? completed + '\n' : ''}本次处理未全部完成，请检查权限、配置或重新说明需求。`;
          checkpoint.reply = reply; await persist(checkpoint);
        }
        guard();
        this.ctx.storage.sql.exec("UPDATE events SET state='sending', lease_until=? WHERE id=?", Date.now() + LEASE_MS, id);
      }
      guard();
      await sendText(c.apiBaseUrl, this.env.WEIXIN_BOT_TOKEN, row.user_id,
        row.context_token, `mybaby_${id}`, reply);
      this.terminal(id, 'done');
      return json({ state: 'done' });
    } catch (error) {
      if (error instanceof AgentError) {
        this.ctx.storage.sql.exec("UPDATE events SET state='queued', lease_until=0, error=? WHERE id=? AND state='processing'", error.code, id);
        return json({ error: error.code }, 503);
      }
      const e = error instanceof ILinkError ? error : new ILinkError('internal', true, true);
      if (e.category === 'auth_expired') {
        const live = this.current(generation);
        if (live) { live.state = 'auth_expired'; live.lastError = e.category; this.save(live);
          this.pollController?.abort(); await this.ctx.storage.deleteAlarm(); }
      }
      if (e.uncertain) {
        // Stable client_id alone is not proof of server deduplication. Don't auto-resend an ambiguous send.
        this.terminal(id, 'unknown', e.category); return json({ state: 'unknown' });
      }
      if (e.retryable) {
        this.ctx.storage.sql.exec("UPDATE events SET state='queued', lease_until=0, error=? WHERE id=? AND state='sending'", e.category, id);
        return json({ error: e.category }, 503);
      }
      this.terminal(id, 'failed', e.category); return json({ state: 'failed' });
    } finally { this.consumers.delete(id); }
  }
}

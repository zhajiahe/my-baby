import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { WeixinSession } from '../src/session.js';
import worker from '../src/index.js';
import { eventId } from '../src/weixin.js';
import type { Env, InboxEvent, StoredEvent } from '../src/types.js';

const adminToken = 'a'.repeat(64);
const inbound = { message_id: 123, from_user_id: 'allowed', to_user_id: 'bot', message_type: 1,
  message_state: 2, context_token: 'sensitive-context', item_list: [{ type: 1, text_item: { text: 'hello' } }] };

// Real SQLite + synchronous KV/transaction adapter, not a workerd integration test.
// This host's macOS version is below workerd's supported minimum; cloud smoke
// and workerd tests must be reported separately, never inferred from this suite.
function harness() {
  const db = new DatabaseSync(':memory:');
  const kv = new Map<string, unknown>();
  let alarmAt: number | null = null;
  let queueFails = false;
  const queued: InboxEvent[] = [];
  const storage = {
    sql: { exec(query: string, ...bindings: (string | number | null)[]) {
      const rows = db.prepare(query).all(...bindings);
      return { [Symbol.iterator]: () => rows[Symbol.iterator](), toArray: () => rows };
    } },
    kv: { get: (key: string) => structuredClone(kv.get(key)), put: (key: string, value: unknown) => kv.set(key, structuredClone(value)) },
    transactionSync(fn: () => unknown) {
      const copy = structuredClone(kv);
      const alarmCopy = alarmAt;
      db.exec('SAVEPOINT tx');
      try { const result = fn(); db.exec('RELEASE tx'); return result; }
      catch (e) { db.exec('ROLLBACK TO tx; RELEASE tx'); kv.clear(); for (const [k, v] of copy) kv.set(k, v); alarmAt = alarmCopy; throw e; }
    },
    async setAlarm(time: number) { alarmAt = time; },
    async getAlarm() { return alarmAt; },
    async deleteAlarm() { alarmAt = null; },
  };
  const ctx = { storage } as unknown as DurableObjectState;
  const env = { WEIXIN_ADMIN_TOKEN: adminToken, WEIXIN_BOT_TOKEN: 'bot-secret',
    INBOX: { async send(value: InboxEvent) { if (queueFails) throw new Error('queue_down'); queued.push(value); } },
  } as unknown as Env;
  let session = new WeixinSession(ctx, env);
  async function call(path: string, body?: unknown) {
    return session.fetch(new Request(`https://session.internal/${path}`, {
      method: path === 'status' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }
  async function bind() {
    assert.equal((await call('bind', { botId: 'bot', apiBaseUrl: 'https://ilinkai.weixin.qq.com', allowedUserIds: ['allowed'] })).status, 200);
    assert.equal((await call('start')).status, 200);
  }
  return { db, kv, queued, env, ctx, call, bind, get session() { return session; },
    get alarmAt() { return alarmAt; }, failQueue(value: boolean) { queueFails = value; },
    restart() { session = new WeixinSession(ctx, env); },
    row(id: string) { return db.prepare('SELECT * FROM events WHERE id=?').get(id) as unknown as StoredEvent; },
    close() { db.close(); },
  };
}

function mockUpdates(t: TestContext, response: unknown) {
  return t.mock.method(globalThis, 'fetch', async () => Response.json(response));
}

test('persistent cursor/outbox, restart, duplicate updates and queue delivery execute one reply', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  const requests: Record<string, unknown>[] = [];
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string); requests.push(body);
    if (url.endsWith('/sendmessage')) { sends++; return Response.json({ ret: 0 }); }
    return Response.json({ ret: 0, msgs: [inbound, inbound], get_updates_buf: 'cursor-one' });
  });
  await h.session.alarm();
  assert.equal(h.queued.length, 1);
  assert.deepEqual(Object.keys(h.queued[0]).sort(), ['eventId', 'generation', 'version']);
  const id = await eventId('bot', '123');
  assert.equal(h.row(id).state, 'queued');
  h.restart();
  await h.session.alarm();
  assert.equal(requests[1].get_updates_buf, 'cursor-one');
  assert.equal(h.queued.length, 1);
  await h.call('consume', h.queued[0]);
  await h.call('consume', h.queued[0]);
  assert.equal(sends, 1);
  assert.equal(h.row(id).state, 'done');
  assert.equal(h.row(id).context_token, '');
  assert.equal(h.row(id).text, '');
});

test('Queue outage after reception retains event and cursor; next alarm flushes before polling', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  mockUpdates(t, { ret: 0, msgs: [inbound], get_updates_buf: 'saved-cursor' });
  h.failQueue(true); await h.session.alarm();
  const id = await eventId('bot', '123');
  assert.equal(h.row(id).state, 'pending');
  const state = await (await h.call('status')).json() as { state: string; cursorSaved: boolean };
  assert.equal(state.state, 'backoff'); assert.ok(state.cursorSaved); assert.ok(h.alarmAt);
  h.restart(); h.failQueue(false); await h.session.alarm();
  assert.equal(h.queued.length, 1); assert.equal(h.row(id).state, 'queued');
});

test('unauthorized senders and bot messages never enqueue; admin endpoints are protected', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  mockUpdates(t, { ret: 0, msgs: [{ ...inbound, from_user_id: 'stranger' }, { ...inbound, message_type: 2 }] });
  await h.session.alarm(); assert.equal(h.queued.length, 0);
  assert.equal((await h.session.fetch(new Request('https://internal/status'))).status, 401);
  assert.equal((await h.call('bind', {})).status, 409);
  const result = await (await h.call('status')).text();
  assert.ok(!result.includes('bot-secret')); assert.ok(!result.includes('allowed'));
  assert.deepEqual(JSON.parse(result).reception, {
    received: 2, accepted: 0, rejected: { unauthorized_sender: 1, not_user_message: 1 },
  });
  h.restart();
  assert.deepEqual((await (await h.call('status')).json() as { reception: unknown }).reception, JSON.parse(result).reception);
});

test('authorized text with an unusable ID does not advance the cursor', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  mockUpdates(t, { ret: 0, msgs: [{ ...inbound, message_id: 'not-a-decimal-id' }], get_updates_buf: 'must-not-ack' });
  await h.session.alarm();
  const state = await (await h.call('status')).json() as { state: string; cursorSaved: boolean; lastError: string };
  assert.equal(state.state, 'backoff');
  assert.equal(state.cursorSaved, false);
  assert.equal(state.lastError, 'invalid_message_id');
  assert.equal(h.queued.length, 0);
});

test('expired credentials stop alarms; transient HTTP failure backs off', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await h.session.alarm(); assert.ok(h.alarmAt);
  assert.equal((await (await h.call('status')).json() as { state: string }).state, 'backoff');
  mock.mock.mockImplementation(async () => Response.json({ ret: -14 }));
  await h.session.alarm(); assert.equal(h.alarmAt, null);
  assert.equal((await (await h.call('status')).json() as { state: string }).state, 'auth_expired');
});

test('observation counters survive restart and retain failures after recovery', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ret: 0, msgs: [] }));
  await h.session.alarm();
  mock.mock.mockImplementation(async () => new Response('', { status: 503 }));
  await h.session.alarm();
  h.restart();
  mock.mock.mockImplementation(async () => Response.json({ ret: 0, msgs: [] }));
  await h.session.alarm();
  const state = await (await h.call('status')).json() as { observation: {
    completedPolls: number; failedCycles: number; lastFailureCategory: string; maxSuccessGapMs: number;
  } };
  assert.equal(state.observation.completedPolls, 2);
  assert.equal(state.observation.failedCycles, 1);
  assert.equal(state.observation.lastFailureCategory, 'http_503');
  assert.ok(state.observation.maxSuccessGapMs >= 0);
});

test('pause while polling prevents stale response persistence and rearming', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  t.mock.method(globalThis, 'fetch', async () => {
    entered(); await new Promise<void>(r => { release = r; });
    return Response.json({ ret: 0, msgs: [inbound], get_updates_buf: 'stale' });
  });
  const poll = h.session.alarm(); await started;
  await h.call('pause'); release(); await poll;
  assert.equal(h.queued.length, 0); assert.equal(h.alarmAt, null);
});

test('ambiguous send is terminal unknown, not blindly retried', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/sendmessage')) { sends++; throw new Error('response-lost'); }
    return Response.json({ ret: 0, msgs: [inbound] });
  });
  await h.session.alarm();
  await h.call('consume', h.queued[0]); await h.call('consume', h.queued[0]);
  assert.equal(sends, 1);
  assert.equal(h.row(h.queued[0].eventId).state, 'unknown');
});

test('confirmed 429 retries safely using the same client ID', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  const clientIds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (url.endsWith('/sendmessage')) {
      clientIds.push(JSON.parse(options.body as string).msg.client_id);
      return clientIds.length === 1 ? new Response('', { status: 429 }) : Response.json({ ret: 0 });
    }
    return Response.json({ ret: 0, msgs: [inbound] });
  });
  await h.session.alarm();
  assert.equal((await h.call('consume', h.queued[0])).status, 503);
  assert.equal((await h.call('consume', h.queued[0])).status, 200);
  assert.equal(clientIds[0], clientIds[1]);
});

test('message persistence failure rolls back cursor and leaves a retry alarm', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  h.db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'fault'); END");
  mockUpdates(t, { ret: 0, msgs: [inbound], get_updates_buf: 'must-not-save' });
  await h.session.alarm();
  assert.equal((h.kv.get('config') as { cursor: string }).cursor, '');
  assert.equal(h.queued.length, 0); assert.ok(h.alarmAt);
  h.db.exec('DROP TRIGGER fail_insert');
  await h.session.alarm();
  assert.equal((h.kv.get('config') as { cursor: string }).cursor, 'must-not-save');
  assert.equal(h.queued.length, 1);
});

test('rebind requires explicit discard of unresolved events and invalidates old generation', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  mockUpdates(t, { ret: 0, msgs: [inbound], get_updates_buf: 'keep-for-same-bot' });
  await h.session.alarm(); await h.call('pause');
  const binding = { botId: 'bot', apiBaseUrl: 'https://ilinkai.weixin.qq.com', allowedUserIds: ['allowed'] };
  assert.equal((await h.call('bind', binding)).status, 409);
  assert.equal((await h.call('bind', { ...binding, discardPending: true })).status, 200);
  assert.equal(h.row(h.queued[0].eventId).state, 'stale');
  assert.equal((h.kv.get('config') as { cursor: string }).cursor, 'keep-for-same-bot');
  assert.equal((await h.call('consume', h.queued[0])).status, 200);
});

test('persisted send lease protects duplicate consumers and restart does not resend unknown outcome', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  mockUpdates(t, { ret: 0, msgs: [inbound] }); await h.session.alarm();
  const id = h.queued[0].eventId;
  h.db.prepare("UPDATE events SET state='sending', lease_until=? WHERE id=?").run(Date.now() + 60_000, id);
  h.restart(); assert.equal((await h.call('consume', h.queued[0])).status, 503);
  h.db.prepare('UPDATE events SET lease_until=0 WHERE id=?').run(id);
  await h.call('consume', h.queued[0]); assert.equal(h.row(id).state, 'unknown');
});

test('Agent checkpoints survive restart and reply retry without new model calls or mutations', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  Object.assign(h.env, { AGENT_MODE: 'agent', AGENT_WRITES_ENABLED: 'true', OPENROUTER_API_KEY: 'synthetic',
    MYBABY_API_ORIGIN: 'https://mybaby.example', MYBABY_AGENT_TOKEN: 't'.repeat(64) });
  let models = 0, writes = 0, sends = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (url.includes('/getupdates')) return Response.json({ ret: 0, msgs: [inbound] });
    if (url.includes('openrouter')) {
      models++;
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
        function: { name: 'create_growth_record', arguments: JSON.stringify({ date: '2026-10-10', weight: 10.5 }) } }] } }] });
    }
    if (url.includes('/sendmessage')) {
      sends++; return sends === 1 ? new Response('', { status: 429 }) : Response.json({ ret: 0 });
    }
    const body = JSON.parse(options.body as string);
    assert.equal(body.messageId, '123');
    if (body.operation === 'create_growth_record') writes++;
    return Response.json({ operation: body.operation, baby: { name: '测试宝宝', birthDate: '2025-01-01' },
      data: body.operation === 'create_growth_record' ? { id: 'record-once', ...body.args } : {} });
  });
  await h.session.alarm();
  assert.equal((await h.call('consume', h.queued[0])).status, 503);
  assert.equal(h.row(h.queued[0].eventId).state, 'queued');
  h.restart(); await h.call('consume', h.queued[0]);
  assert.equal(models, 1); assert.equal(writes, 1); assert.equal(sends, 2);
  assert.equal(h.row(h.queued[0].eventId).state, 'done');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM agent_runs').get()?.count, 0);
});

test('pausing during model inference prevents business writes and keeps event resumable', async t => {
  const h = harness(); t.after(() => h.close()); await h.bind();
  Object.assign(h.env, { AGENT_MODE: 'agent', AGENT_WRITES_ENABLED: 'true', OPENROUTER_API_KEY: 'synthetic',
    MYBABY_API_ORIGIN: 'https://mybaby.example', MYBABY_AGENT_TOKEN: 't'.repeat(64) });
  let release!: () => void, entered!: () => void, writes = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (url.includes('/getupdates')) return Response.json({ ret: 0, msgs: [inbound] });
    if (url.includes('openrouter')) {
      entered(); await new Promise<void>(resolve => { release = resolve; });
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
        function: { name: 'create_growth_record', arguments: JSON.stringify({ date: '2026-10-10', weight: 10.5 }) } }] } }] });
    }
    const body = JSON.parse(options.body as string);
    if (body.operation?.startsWith('create')) writes++;
    return Response.json({ operation: body.operation, baby: { name: '测试宝宝', birthDate: '2025-01-01' }, data: {} });
  });
  await h.session.alarm(); const consume = h.call('consume', h.queued[0]); await started;
  await h.call('pause'); release(); assert.equal((await consume).status, 503);
  assert.equal(writes, 0); assert.equal(h.row(h.queued[0].eventId).state, 'queued');
});

test('unbound sentinel can never start polling', async () => {
  const h = harness();
  try {
    await h.bind(); await h.call('pause'); h.env.WEIXIN_BOT_TOKEN = 'UNBOUND';
    assert.equal((await h.call('start')).status, 409); assert.equal(h.alarmAt, null);
  } finally { h.close(); }
});

test('Worker health is public, management fails closed, missing references retry into DLQ', async () => {
  const env = {} as Env;
  assert.equal((await worker.fetch(new Request('https://test/health'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://test/admin/session/status'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://test/consume'), env)).status, 404);
  let retries = 0;
  await worker.queue({ messages: [{ body: { eventId: 'invalid' }, retry() { retries++; } }] } as unknown as MessageBatch<InboxEvent>, env);
  assert.equal(retries, 1);
});

test('a voice message with a channel transcript becomes a marked event, never a silent drop', async t => {
  const h = harness(); t.after(() => h.close());
  (h.env as unknown as Record<string, unknown>).MEDIA_INGEST_ENABLED = 'true';
  await h.bind();
  const voice = { ...inbound, message_id: 987,
    item_list: [{ type: 3, voice_item: { text: '今天身高83cm', media: { full_url: 'https://mmbiz.qpic.cn/v', aes_key: 'k' } } }] };
  mockUpdates(t, { ret: 0, msgs: [voice], get_updates_buf: 'c1' });
  await h.session.alarm();
  const id = await eventId('bot', '987');
  const row = h.row(id);
  assert.ok(row, 'a voice with a usable transcript must create an event, not vanish');
  assert.equal(row.source_kind, 'voice');
  assert.equal(row.text, '今天身高83cm');
  console.log('voice event created, queued:', h.queued.length, 'state:', row.state);
});

test('a voice message without a transcript still produces a reply notice', async t => {
  const h = harness(); t.after(() => h.close());
  (h.env as unknown as Record<string, unknown>).MEDIA_INGEST_ENABLED = 'true';
  await h.bind();
  const voice = { ...inbound, message_id: 988, item_list: [{ type: 3, voice_item: { playtime: 2000 } }] };
  mockUpdates(t, { ret: 0, msgs: [voice], get_updates_buf: 'c2' });
  await h.session.alarm();
  const id = await eventId('bot', '988');
  const row = h.row(id);
  assert.ok(row, 'an unusable voice must still answer instead of staying silent');
  assert.equal(row.source_kind, 'notice');
  console.log('notice event created, queued:', h.queued.length, 'text:', row.text.slice(0, 20));
});

test('reception counters stay consistent for media that is accepted', async t => {
  const h = harness(); t.after(() => h.close());
  (h.env as unknown as Record<string, unknown>).MEDIA_INGEST_ENABLED = 'true';
  await h.bind();
  const voice = { ...inbound, message_id: 989, item_list: [{ type: 3, voice_item: { text: '今天体重6.5公斤' } }] };
  mockUpdates(t, { ret: 0, msgs: [voice, { ...inbound, message_id: 990 }], get_updates_buf: 'c3' });
  await h.session.alarm();
  const reception = h.kv.get('reception') as { received: number; accepted: number; rejected: Record<string, number> };
  const rejected = Object.values(reception.rejected).reduce((sum, n) => sum + n, 0);
  console.log('reception', JSON.stringify(reception));
  assert.equal(reception.accepted + rejected, reception.received,
    'accepted + rejected must equal received; a double count means one message was booked twice');
});

// Read-only assessment. Elapsed time is never equivalent to acceptance.
export type WindowHours = 24 | 72;
const MAX_GAP_MS = 300_000;
const CLOCK_SKEW_MS = 30_000;
const eventStates = ['pending', 'queued', 'processing', 'sending', 'done', 'failed', 'unknown', 'stale'] as const;
const states = ['unbound', 'paused', 'running', 'backoff', 'auth_expired'] as const;
const unchecked = ['numbered_text_10', 'queue_dlq_age_and_depth', 'resource_costs', 'end_to_end_latency',
  'uninterrupted_hot_upgrade', 'window_generation_scope', 'external_alert_delivery'];
const errors = new Set(['network', 'network_connection_lost', 'network_tls', 'network_dns', 'network_request_invalid',
  'network_fetch_failed', 'timeout', 'cancelled', 'auth_expired', 'protocol_rejected', 'invalid_json',
  'invalid_response', 'invalid_messages', 'invalid_message_id', 'internal_or_queue']);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown, now: number): v is number => count(v) && v > 0 && v <= now + CLOCK_SKEW_MS;
const category = (v: unknown): string | null => v === null || v === undefined ? null
  : typeof v === 'string' && (errors.has(v) || /^http_[1-5]\d\d$/.test(v)) ? v : 'unrecognized';

export function observeArgs(args: string[]): { hours: WindowHours; save: boolean } {
  let hours: WindowHours = 24, save = false, seenHours = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hours' && !seenHours && ['24', '72'].includes(args[i + 1])) {
      hours = Number(args[++i]) as WindowHours; seenHours = true;
    } else if (args[i] === '--save' && !save) save = true;
    else throw new Error('usage_observe_hours_24_or_72_optional_save');
  }
  return { hours, save };
}

export function observationReport(value: unknown, now = Date.now(), hours: WindowHours = 24) {
  if (!Number.isFinite(now) || now <= 0 || now > 8_640_000_000_000_000 || ![24, 72].includes(hours)) throw new Error('invalid_report_options');
  const base = { version: 1, sampledAt: new Date(now).toISOString(), requestedHours: hours,
    acceptance: 'not_automatically_verified', unverifiedChecks: [...unchecked] };
  const invalid = () => ({ ...base, phase: 'attention', issues: ['invalid_status'], runtime: null, observation: null });
  if (!record(value) || !states.includes(value.state as typeof states[number]) || !count(value.generation)
    || typeof value.cursorSaved !== 'boolean' || typeof value.adapterVersion !== 'string'
    || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.adapterVersion) || !record(value.events)
    || (value.lastPollAt !== null && !time(value.lastPollAt, now))
    || (value.nextAlarmAt !== null && !time(value.nextAlarmAt, now + 300_000))) return invalid();
  const counts: Record<string, number> = {};
  for (const [key, n] of Object.entries(value.events)) {
    if (!eventStates.includes(key as typeof eventStates[number]) || !count(n)) return invalid();
    counts[key] = n;
  }
  const issues: string[] = [];
  if (value.state !== 'running') issues.push('runtime_not_running');
  if (!value.cursorSaved) issues.push('cursor_not_saved');
  if (value.lastPollAt === null || now - (value.lastPollAt as number) > MAX_GAP_MS) issues.push('poll_stale');
  if (value.nextAlarmAt === null) issues.push('alarm_missing');
  else if (now - (value.nextAlarmAt as number) > MAX_GAP_MS) issues.push('alarm_overdue');
  if (['pending', 'queued', 'processing', 'sending'].some(key => counts[key] > 0)) issues.push('unfinished_events_need_review');
  if (counts.stale > 0) issues.push('stale_events_need_review');
  if (counts.failed > 0 || counts.unknown > 0) issues.push('terminal_errors_need_review');
  const lastError = category(value.lastError);
  if (lastError) issues.push('last_poll_error');
  const runtime = { state: value.state, adapterVersion: value.adapterVersion, generation: value.generation,
    cursorSaved: value.cursorSaved, lastPollAt: value.lastPollAt, nextAlarmAt: value.nextAlarmAt, events: counts, lastError };
  if (value.observation === null || value.observation === undefined) return { ...base, phase: 'attention',
    issues: [...issues, 'observation_unavailable'], runtime, observation: null };
  const o = value.observation;
  if (!record(o) || !time(o.startedAt, now) || !count(o.completedPolls) || !count(o.failedCycles)
    || !count(o.maxSuccessGapMs) || (o.lastSuccessAt !== null && !time(o.lastSuccessAt, now))
    || (o.lastFailureAt !== null && !time(o.lastFailureAt, now))) return invalid();
  if (o.lastSuccessAt !== null && o.lastSuccessAt < o.startedAt
    || o.lastFailureAt !== null && o.lastFailureAt < o.startedAt) return invalid();
  if (!o.completedPolls || o.lastSuccessAt === null || now - (o.lastSuccessAt as number) > MAX_GAP_MS) issues.push('observation_success_stale');
  if (o.failedCycles > 0) issues.push('historical_failures_need_review');
  if (o.maxSuccessGapMs > MAX_GAP_MS) issues.push('historical_poll_gap_need_review');
  const lastFailureCategory = category(o.lastFailureCategory);
  if (lastFailureCategory === 'unrecognized') issues.push('unrecognized_error_category');
  const elapsedMs = Math.max(0, now - o.startedAt);
  const observation = { startedAt: o.startedAt, elapsedHours: Math.round(elapsedMs / 36_000) / 100,
    completedPolls: o.completedPolls, failedCycles: o.failedCycles, maxSuccessGapMs: o.maxSuccessGapMs,
    lastSuccessAt: o.lastSuccessAt, lastFailureAt: o.lastFailureAt, lastFailureCategory };
  return { ...base, phase: issues.length ? 'attention' : elapsedMs >= hours * 3_600_000 ? 'window_ready_for_review' : 'observing',
    issues, runtime, observation };
}

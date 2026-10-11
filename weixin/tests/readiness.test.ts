import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationReport, observeArgs } from '../src/readiness.js';

const now = Date.parse('2026-10-12T10:00:00Z');
function status(hours = 1) {
  return { adapterVersion: '0.1.3', state: 'running', generation: 1, cursorSaved: true,
    lastPollAt: now - 1000, nextAlarmAt: now + 90_000, lastError: null, events: { done: 4 },
    observation: { startedAt: now - hours * 3_600_000, completedPolls: 1000, failedCycles: 0,
      lastSuccessAt: now - 1000, maxSuccessGapMs: 110_000, lastFailureAt: null, lastFailureCategory: null } };
}

test('elapsed windows are observing or review-ready, never automatically accepted', () => {
  assert.equal(observationReport(status(), now).phase, 'observing');
  const ready = observationReport(status(25), now);
  assert.equal(ready.phase, 'window_ready_for_review');
  assert.equal(ready.acceptance, 'not_automatically_verified');
  assert.ok(ready.unverifiedChecks.includes('queue_dlq_age_and_depth'));
  assert.ok(ready.unverifiedChecks.includes('window_generation_scope'));
  assert.equal(observationReport(status(25), now, 72).phase, 'observing');
  assert.equal(observationReport(status(73), now, 72).phase, 'window_ready_for_review');
});

test('stale polling, missing or overdue alarm and non-running states need attention', () => {
  for (const change of [{ lastPollAt: now - 301_000 }, { nextAlarmAt: null }, { nextAlarmAt: now - 301_000 },
    { state: 'paused' }, { state: 'auth_expired' }, { cursorSaved: false }]) {
    assert.equal(observationReport({ ...status(25), ...change }, now).phase, 'attention');
  }
  // A legitimate backoff alarm can be five minutes in the future.
  const backoff = observationReport({ ...status(), state: 'backoff', nextAlarmAt: now + 300_000 }, now);
  assert.ok(backoff.issues.includes('runtime_not_running')); assert.ok(!backoff.issues.includes('invalid_status'));
});

test('historical failures and gaps are not hidden by current success', () => {
  const base = status(25);
  for (const change of [{ failedCycles: 1, lastFailureAt: now - 5000, lastFailureCategory: 'http_503' },
    { maxSuccessGapMs: 301_000 }, { lastSuccessAt: now - 301_000 }, { completedPolls: 0, lastSuccessAt: null }]) {
    assert.equal(observationReport({ ...base, observation: { ...base.observation, ...change } }, now).phase, 'attention');
  }
});

test('unfinished, failed, unknown and stale events require manual review', () => {
  for (const state of ['pending', 'queued', 'processing', 'sending', 'failed', 'unknown', 'stale']) {
    assert.equal(observationReport({ ...status(25), events: { [state]: 1 } }, now).phase, 'attention');
  }
});

test('missing observation data cannot pass a time window', () => {
  const report = observationReport({ ...status(25), observation: null }, now);
  assert.equal(report.phase, 'attention'); assert.ok(report.issues.includes('observation_unavailable'));
});

test('invalid timestamps, counters and clock skew fail closed', () => {
  for (const value of [null, {}, { ...status(), generation: -1 }, { ...status(), events: { done: NaN } },
    { ...status(), lastPollAt: now + 31_000 }, { ...status(), observation: { ...status().observation, startedAt: now + 31_000 } },
    { ...status(), observation: { ...status().observation, completedPolls: Number.MAX_SAFE_INTEGER + 1 } }]) {
    assert.equal(observationReport(value, now).phase, 'attention');
  }
  assert.throws(() => observationReport(status(), NaN));
});

test('only selected fields and fixed error categories are emitted, never raw secrets', () => {
  const secret = 'private-context-or-token-do-not-echo';
  const base = status();
  const report = observationReport({ ...base, botId: secret, allowedUserIds: [secret], cursor: secret,
    lastError: secret, observation: { ...base.observation, lastFailureCategory: secret } }, now);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.phase, 'attention');
  assert.equal(JSON.stringify(observationReport({ ...base, events: { [secret]: 1 } }, now)).includes(secret), false);
});

test('arguments are restricted and reject mutation flags before any status read', () => {
  assert.deepEqual(observeArgs([]), { hours: 24, save: false });
  assert.deepEqual(observeArgs(['--hours', '72', '--save']), { hours: 72, save: true });
  for (const args of [['--pause'], ['--replay'], ['--hours', '1'], ['--hours'], ['--save', '--save'],
    ['--hours', '24', '--hours', '72']]) assert.throws(() => observeArgs(args));
});

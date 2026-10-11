// Operator verification for the channel media intake endpoint.
//
// A bare 403 is ambiguous: it can mean the code is wrong, or that a concurrent
// deploy of the shared isolated Worker wiped the agent grants. This script
// resolves that ambiguity before it reports anything, then runs the full
// positive and negative matrix and cleans up after itself.
//
// Read-only against production. Only the fixed isolated test resources are used.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mediaNamespace } from '../shared/agent';

const directory = '.migration';
const target = JSON.parse(readFileSync(`${directory}/target.json`, 'utf8'));
const secrets = JSON.parse(readFileSync(`${directory}/secrets.json`, 'utf8'));
const [grant] = JSON.parse(readFileSync(`${directory}/live-weixin-grant.json`, 'utf8'));
if (target.workerName !== 'mybaby-web-migration-test' || new URL(target.origin).hostname.split('.')[0] !== target.workerName) {
  throw new Error('isolated_target_required');
}

const run = (args: string[]) => JSON.parse(execFileSync('cf', args, { encoding: 'utf8', timeout: 90_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Control plane and TLS both fail intermittently on this network, so every call
// retries before it is allowed to report a failure.
async function attempt<T>(label: string, action: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await action(); } catch (error) { last = error; await sleep(3_000 * (i + 1)); }
  }
  const cause = (last as { cause?: { code?: string }; message?: string })?.cause?.code
    ?? (last as { message?: string })?.message ?? 'unknown';
  throw new Error(`${label}_unreachable:${cause}`);
}

// The ambiguity this script exists to remove.
function deployedState() {
  const deployments = run(['workers', 'deployments', 'list', '--worker', target.workerName]).deployments;
  const version = run(['workers', 'versions', 'get', deployments[0].versions[0].version_id, '--worker-id', target.workerName]);
  const value = (name: string) => version.bindings.find((binding: { name: string }) => binding.name === name)?.text;
  const grants = JSON.parse(value('MYBABY_AGENT_GRANTS') || '[]') as { botId?: string; userId?: string; babyId?: string }[];
  return { versionId: deployments[0].versions[0].version_id as string, deployedAt: deployments[0].created_on as string,
    grantsPresent: grants.some(item => item.botId === grant.botId && item.userId === grant.userId),
    writesEnabled: value('MYBABY_AGENT_WRITES_ENABLED'), frozen: value('MYBABY_WRITES_FROZEN') };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cFt8AAAAASUVORK5CYII=', 'base64');
const messageId = String(Date.now());
function form(overrides: Record<string, string> = {}, file?: Blob) {
  const body = new FormData();
  body.set('botId', grant.botId); body.set('userId', grant.userId); body.set('messageId', messageId);
  body.set('date', '2026-10-11'); body.set('index', '0');
  body.set('file', file ?? new Blob([png], { type: 'image/png' }), 'image.png');
  for (const [key, value] of Object.entries(overrides)) body.set(key, value);
  return body;
}
const post = (body: FormData, token: string | null = `Bearer ${secrets.MYBABY_AGENT_TOKEN}`) =>
  attempt('intake_post', () => fetch(`${target.origin}/api/agent/media`, { method: 'POST', headers: token ? { authorization: token } : {}, body, signal: AbortSignal.timeout(60_000) }));

async function main() {
  // The control plane fails intermittently too, so a transport error here is
  // reported as unreachable rather than as a mysterious private failure.
  const state = await attempt('deployed_state', async () => deployedState());
  console.log('deployed', state.versionId.slice(0, 8), 'at', state.deployedAt,
    '| grants present:', state.grantsPresent, '| writes:', state.writesEnabled, '| frozen:', state.frozen);
  if (!state.grantsPresent) throw new Error('deployed_grants_wiped_by_a_concurrent_deploy_rerun_the_deploy_first');
  if (state.writesEnabled !== 'true') throw new Error('agent_writes_disabled_on_target');
  if (state.frozen === 'true') throw new Error('target_is_write_frozen');

  const first = await post(form());
  const created = await first.json().catch(() => ({})) as { data?: { id?: string; format?: string }; replayed?: boolean };
  if (first.status !== 201 || typeof created.data?.id !== 'string') throw new Error(`intake_create_failed_${first.status}`);
  console.log('create 201 id', created.data.id.slice(0, 8), 'format', created.data.format);

  const replay = await post(form());
  const replayed = await replay.json().catch(() => ({})) as { data?: { id?: string }; replayed?: boolean };
  if (replay.status !== 200 || replayed.data?.id !== created.data.id || replayed.replayed !== true) throw new Error('intake_replay_not_idempotent');
  console.log('replay 200 same id, replayed true');

  const negatives: [string, Promise<Response>, number][] = [
    ['unauthorized identity', post(form({ userId: 'stranger' })), 403],
    ['missing token', post(form(), null), 401],
    ['spoofed png bytes', post(form({ messageId: String(Date.now()) }, new Blob([Buffer.alloc(64, 60)], { type: 'image/png' }))), 415],
    ['unsupported type', post(form({ messageId: String(Date.now()) }, new Blob([png], { type: 'image/svg+xml' }))), 415],
  ];
  for (const [label, pending, expected] of negatives) {
    const response = await pending;
    if (response.status !== expected) throw new Error(`intake_negative_${label.replace(/ /g, '_')}_expected_${expected}_got_${response.status}`);
    await response.body?.cancel();
    console.log('negative', label, response.status);
  }

  // Reading the object back proves it really landed and is served privately. The
  // key is derived exactly as the server derives it, so this also checks that the
  // namespace contract is stable between the two sides.
  const login = await attempt('login', () => fetch(`${target.origin}/api/auth/login`, { method: 'POST',
    headers: { origin: target.origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.MYBABY_VERIFY_PASSWORD ?? '' }) }));
  if (login.status !== 200) throw new Error('family_login_failed_set_MYBABY_VERIFY_PASSWORD');
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const objectKey = `${mediaNamespace(grant.botId, grant.userId)}${messageId}-0.png`;
  const object = await attempt('object_read', () => fetch(`${target.origin}/api/media/${objectKey}`,
    { headers: { cookie }, signal: AbortSignal.timeout(30_000) }));
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (object.status !== 200) throw new Error(`object_not_readable_${object.status}`);
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) throw new Error('stored_object_is_not_a_png');
  if (object.headers.get('cache-control') !== 'private, no-store') throw new Error('stored_object_not_private');
  console.log('read back', bytes.length, 'bytes, png header intact, cache-control private');
  const anonymous = await attempt('object_anonymous', () => fetch(`${target.origin}/api/media/${objectKey}`));
  if (anonymous.status !== 401) throw new Error(`anonymous_object_read_expected_401_got_${anonymous.status}`);
  console.log('anonymous read refused', anonymous.status);

  const album = await attempt('album', () => fetch(`${target.origin}/api/agent/v1`, { method: 'POST',
    headers: { authorization: `Bearer ${secrets.MYBABY_AGENT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'weixin', botId: grant.botId, userId: grant.userId, messageId,
      operation: 'get_album_summary', operationKey: 'op_verify', args: {} }) }));
  const summary = await album.json().catch(() => ({})) as { data?: { total?: number } };
  console.log('album total after create', summary.data?.total, '| family session', login.status);
  writeFileSync(`${directory}/intake-verification.json`, JSON.stringify({ verifiedAt: new Date().toISOString(),
    versionId: state.versionId, recordId: created.data.id, replayIdempotent: true,
    negatives: negatives.map(([label, , expected]) => ({ label, expected })), objectRead: object.status,
    anonymousRead: anonymous.status, objectBytes: bytes.length, albumTotal: summary.data?.total }, null, 1), { mode: 0o600 });

  // Leave no test record or receipt behind.
  const cleanup = { batch: [
    { sql: 'DELETE FROM media_items WHERE id=?', params: [created.data.id] },
    { sql: 'DELETE FROM agent_operations WHERE messageId=?', params: [messageId] }] };
  writeFileSync(`${directory}/intake-cleanup.json`, JSON.stringify(cleanup), { mode: 0o600 });
  run(['d1', 'query', target.databaseId, '--body', `@${directory}/intake-cleanup.json`]);
  console.log('cleaned up the test record and its receipt; the uploaded object is left for maintenance-window orphan cleanup');
  console.log('PASS: channel media intake verified end to end on the isolated target.');
}
main().catch(error => {
  const code = error instanceof Error && /^[a-z0-9_:]+$/i.test(error.message) ? error.message : 'private_or_unexpected_error';
  console.error('Media intake verification stopped:', code);
  process.exitCode = 1;
});

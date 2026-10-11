// Bridge deploy that verifies what actually landed.
//
// bindings.text() values are fixed when the build runs, so a deploy that reuses
// build output produced without these variables silently reverts every switch to
// its default. That happened three times: a media probe that was off, an agent
// mode that was off, and a voice path that therefore answered nothing. Setting
// the variables in the shell and remembering to rebuild is not a control.
//
// This script sets the integration switches for the build and the deploy in one
// process, then asserts the deployed version's bindings and fails if they differ
// from intent.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const mode = process.argv.includes('--restore') ? 'bridge' : 'agent';
const target = JSON.parse(readFileSync('.migration/target.json', 'utf8'));
const bridge = target.bridge ?? { workerName: 'mybaby-weixin', origin: target.origin };
if (bridge.workerName !== 'mybaby-weixin') throw new Error('unexpected_bridge_worker');

// Exactly what the deploy must end up with. 'restore' returns to the accepted
// stage-A bridge: no agent, no model calls, no media ingest.
const intent = mode === 'agent'
  ? { AGENT_MODE: 'agent', AGENT_WRITES_ENABLED: 'true', AGENT_TIME_ZONE: 'Asia/Shanghai',
    MYBABY_API_ORIGIN: target.origin, MEDIA_INGEST_ENABLED: 'true', MEDIA_PROBE_ENABLED: 'true' }
  : { AGENT_MODE: 'bridge', AGENT_WRITES_ENABLED: 'false', AGENT_TIME_ZONE: 'Asia/Shanghai',
    MYBABY_API_ORIGIN: '', MEDIA_INGEST_ENABLED: 'false', MEDIA_PROBE_ENABLED: 'false' };

const env: NodeJS.ProcessEnv = { ...process.env,
  MYBABY_AGENT_MODE: intent.AGENT_MODE, MYBABY_AGENT_WRITES_ENABLED: intent.AGENT_WRITES_ENABLED,
  MYBABY_AGENT_ORIGIN: intent.MYBABY_API_ORIGIN, MYBABY_MEDIA_INGEST: intent.MEDIA_INGEST_ENABLED,
  MYBABY_MEDIA_PROBE: intent.MEDIA_PROBE_ENABLED };

const run = (command: string, args: string[], cwd = '.') => execFileSync(command, args,
  { cwd, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

console.log(`bridge deploy mode=${mode}: building with the integration switches set`);
run('npm', ['run', 'build'], 'weixin');
for (let attempt = 1; attempt <= 3; attempt++) {
  try { run('cf', ['deploy', '--prebuilt', '--secrets-file', '.local/secrets.json'], 'weixin'); break; }
  catch (error) {
    if (attempt === 3) throw new Error('bridge_deploy_failed');
    console.log(`deploy attempt ${attempt} failed, retrying`);
  }
}

// Verify the deployed version rather than the deploy command's exit code.
const cli = (args: string[]) => JSON.parse(run('cf', args));
const deployments = cli(['workers', 'deployments', 'list', '--worker', bridge.workerName]).deployments;
if (deployments[0].versions.length !== 1 || deployments[0].versions[0].percentage !== 100) throw new Error('single_version_required');
const version = cli(['workers', 'versions', 'get', deployments[0].versions[0].version_id, '--worker-id', bridge.workerName]);
const actual = Object.fromEntries(version.bindings
  .filter((binding: { type: string }) => binding.type === 'plain_text')
  .map((binding: { name: string; text: string }) => [binding.name, binding.text]));
for (const [name, expected] of Object.entries(intent)) {
  if (actual[name] !== expected) throw new Error(`deployed_binding_mismatch:${name}:expected:${expected}:got:${actual[name] ?? 'missing'}`);
}
console.log(`deployed ${deployments[0].versions[0].version_id.slice(0, 8)} with verified bindings:`, JSON.stringify(intent));
console.log('now run pause, wait for the old isolate to exit, then start so the Durable Object picks up the build');

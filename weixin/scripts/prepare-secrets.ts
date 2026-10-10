import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadLocal, saveLocal } from './local.js';

async function main() {
  const env = parseEnv(await readFile(fileURLToPath(new URL('../.env', import.meta.url).href), 'utf8'));
  if (!env.OPENROUTER_API_KEY?.trim()) throw new Error('missing_openrouter_key');
  const secrets = await loadLocal<Record<string, string>>('secrets.json');
  if (env.MYBABY_AGENT_TOKEN && env.MYBABY_AGENT_TOKEN.length < 32) throw new Error('invalid_agent_token');
  const token = env.MYBABY_AGENT_TOKEN || (secrets.MYBABY_AGENT_TOKEN?.length >= 32
    ? secrets.MYBABY_AGENT_TOKEN : randomBytes(32).toString('hex'));
  await saveLocal('secrets.json', { ...secrets, OPENROUTER_API_KEY: env.OPENROUTER_API_KEY.trim(), MYBABY_AGENT_TOKEN: token });
  await saveLocal('agent-server.json', { MYBABY_AGENT_TOKEN: token, MYBABY_AGENT_WRITES_ENABLED: 'false', MYBABY_AGENT_GRANTS: '[]' });
  console.log('Prepared local secrets with 0600 permissions. No token was printed or uploaded. Keep the API server token in sync and configure grants separately.');
}
main().catch(() => { console.error('prepare_secrets_failed_check_local_configuration'); process.exitCode = 1; });

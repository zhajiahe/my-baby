import { fileURLToPath } from 'node:url';
import { planMessage, AgentError } from '../src/agent.js';
import { DEFAULT_MODEL } from '../src/types.js';

async function main() {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url).href));
  if (!process.env.OPENROUTER_API_KEY) throw new AgentError('missing_openrouter_key');
  // Synthetic input only: no production Baby, database, user ID, or message content.
  const plan = await planMessage({ text: '测试宝宝今天体重10.5公斤，请记录。',
    receivedAt: Date.parse('2026-10-10T09:00:00Z'), baby: { name: '测试宝宝', birthDate: '2025-01-01' },
    writesEnabled: true }, { apiKey: process.env.OPENROUTER_API_KEY, model: DEFAULT_MODEL });
  const record = plan.operations.find(op => op.name === 'create_growth_record');
  if (record?.args.weight !== 10.5 || record?.args.date !== '2026-10-10') throw new AgentError('synthetic_plan_did_not_match');
  console.log(JSON.stringify({ model: DEFAULT_MODEL, test: 'synthetic_weight_tool_plan', passed: true,
    operations: plan.operations, businessWrites: 0 }, null, 2));
}
main().catch(error => { console.error(error instanceof AgentError ? error.code : 'model_smoke_failed'); process.exitCode = 1; });

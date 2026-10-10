import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate } from '../../shared/agent.js';
import { planMessage, AgentError } from '../src/agent.js';
import { prepareAgentReply, type AgentCheckpoint } from '../src/agent-run.js';
import { executePlan, formatResults } from '../src/tools.js';

const config = { apiKey: 'synthetic-key', model: 'meta/muse-spark-1.3-contributor', origin: 'https://mybaby.example',
  token: 't'.repeat(64), writesEnabled: true, timeZone: 'Asia/Shanghai' };
const input = { text: '测试宝宝今天10.5公斤', receivedAt: Date.parse('2026-10-09T17:00:00Z'),
  identity: { source: 'weixin' as const, botId: 'bot', userId: 'allowed', messageId: '123' } };
const baby = { name: '测试宝宝', birthDate: '2025-01-01' };
const writePlan = { version: 1 as const, operations: [{ name: 'create_growth_record' as const, args: { date: '2026-10-10', weight: 10.5 } }] };
const modelResponse = (name = 'create_growth_record', args: unknown = { date: '2026-10-10', weight: 10.5 }) => ({ choices: [{ finish_reason: 'tool_calls',
  message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

test('calendar dates use message time and configured timezone, not retry time', () => {
  assert.equal(calendarDate(input.receivedAt), '2026-10-10');
  assert.equal(calendarDate(input.receivedAt, 'UTC'), '2026-10-09');
});

test('model request is bounded, fixed provider URL and never contains authorization identity', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body as string);
    assert.equal(body.model, config.model); assert.equal(body.max_tokens, 2048);
    assert.ok(body.messages[0].content.includes('2026-10-10'));
    assert.ok(!JSON.stringify(body).includes('synthetic-key')); assert.ok(!JSON.stringify(body).includes('messageId'));
    return Response.json(modelResponse());
  });
  const result = await planMessage({ ...input, baby, writesEnabled: true }, config);
  assert.deepEqual(result, writePlan);
});

test('unknown or malicious tool args, too many calls and truncated output never execute', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(modelResponse('delete_baby')));
  await assert.rejects(planMessage({ ...input, baby, writesEnabled: true }, config), (e: unknown) => e instanceof AgentError && e.code === 'invalid_tool_arguments');
  mock.mock.mockImplementation(async () => Response.json(modelResponse('create_growth_record', { date: '2026-10-10', weight: 10.5, babyId: 'evil' })));
  await assert.rejects(planMessage({ ...input, baby, writesEnabled: true }, config));
  mock.mock.mockImplementation(async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '已记录' } }] }));
  await assert.rejects(planMessage({ ...input, baby, writesEnabled: true }, config));
});

test('plan is persisted before writing; response-lost retry reuses plan/key and only one mutation', async t => {
  let modelCalls = 0, mutations = 0, failed = false;
  const keys: string[] = [];
  const cp: AgentCheckpoint = { results: [] };
  const saved: AgentCheckpoint[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (url.includes('openrouter.ai')) { modelCalls++; return Response.json(modelResponse()); }
    if (body.operation === 'get_baby_summary') return Response.json({ operation: body.operation, baby, data: baby });
    assert.ok(saved[0].plan); keys.push(body.operationKey);
    if (!failed) { failed = true; mutations++; throw new Error('response_lost_after_commit'); }
    return Response.json({ operation: body.operation, baby, data: { id: 'record-once', ...body.args }, replayed: true });
  });
  const save = async (state: AgentCheckpoint) => { saved.push(structuredClone(state)); };
  await assert.rejects(prepareAgentReply(input, config, cp, save, () => {}));
  assert.equal(cp.results.length, 0); assert.ok(cp.plan);
  const reply = await prepareAgentReply(input, config, cp, save, () => {});
  assert.equal(modelCalls, 1); assert.equal(mutations, 1); assert.deepEqual(keys, ['op_0', 'op_0']);
  assert.ok(reply.includes('record-once')); assert.ok(reply.includes('10.5 kg'));
});

test('both runtime and API can disable writes; clarification never claims an execution', async t => {
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (url.includes('openrouter')) return Response.json(modelResponse());
    const body = JSON.parse(options.body as string);
    if (body.operation.startsWith('create')) writes++;
    return Response.json({ operation: body.operation, baby, data: baby });
  });
  const reply = await prepareAgentReply(input, { ...config, writesEnabled: false }, { results: [] }, async () => {}, () => {});
  assert.equal(writes, 0); assert.ok(reply.includes('没有保存'));
  assert.ok(formatResults({ version: 1, operations: [], clarification: '请确认单位。' }, []).startsWith('尚未执行'));
  await assert.rejects(executePlan(input.identity, writePlan, { ...config, writesEnabled: false }, [], async () => {}));
});

test('cached reply still revalidates grants and revoked identity never receives saved health data', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  const checkpoint: AgentCheckpoint = { results: [], reply: 'private saved result' };
  await assert.rejects(prepareAgentReply(input, config, checkpoint, async () => {}, () => {}),
    (e: unknown) => e instanceof AgentError && e.code === 'business_http_403');
});

test('resume partial success executes only remaining stable operation', async t => {
  const plan = { version: 1 as const, operations: [...writePlan.operations, { name: 'create_milestone' as const, args: { date: '2026-10-10', title: '第一次走路' } }] };
  const previous = [{ operation: 'create_growth_record', baby, data: { id: 'first', date: '2026-10-10', weight: 10.5 } }];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string); assert.equal(body.operationKey, 'op_1');
    return Response.json({ operation: body.operation, baby, data: { id: 'second', ...body.args } });
  });
  const results = await executePlan(input.identity, plan, config, previous, async () => {});
  assert.equal(results.length, 2); assert.ok(formatResults(plan, results).includes('第一次走路'));
});

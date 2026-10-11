import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, isModelOperation } from '../../shared/agent.js';
import { planMessage, AgentError } from '../src/agent.js';
import { prepareAgentReply, type AgentCheckpoint } from '../src/agent-run.js';
import { callTool, executePlan, failureReply, formatResults } from '../src/tools.js';

const config = { apiKey: 'synthetic-key', model: 'meta/muse-spark-1.3-contributor', origin: 'https://mybaby.example',
  token: 't'.repeat(64), writesEnabled: true, timeZone: 'Asia/Shanghai' };
const input = { text: '测试宝宝今天10.5公斤', receivedAt: Date.parse('2026-10-09T17:00:00Z'),
  identity: { source: 'weixin' as const, botId: 'bot', userId: 'allowed', messageId: '123' } };
const baby = { name: '测试宝宝', birthDate: '2025-01-01' };
const writePlan = { version: 1 as const, operations: [{ name: 'create_growth_record' as const, args: { date: '2026-10-10', weight: 10.5 } }] };
const modelResponse = (name = 'create_growth_record', args: unknown = { date: '2026-10-10', weight: 10.5 }) => ({ choices: [{ finish_reason: 'tool_calls',
  message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

test('Workers-compatible manual redirects fail closed without forwarding credentials',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(_url:string,options:RequestInit)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}});});
 await assert.rejects(planMessage({...input,baby,writesEnabled:true},config),(e:unknown)=>e instanceof AgentError&&e.code==='model_http_302'&&!e.retryable);
 await assert.rejects(callTool(input.identity,'get_baby_summary',{},'scope',config),(e:unknown)=>e instanceof AgentError&&e.code==='business_http_302'&&!e.retryable);
 assert.equal(calls,2);
});

test('calendar dates use message time and configured timezone, not retry time', () => {
  assert.equal(calendarDate(input.receivedAt), '2026-10-10');
  assert.equal(calendarDate(input.receivedAt, 'UTC'), '2026-10-09');
});

test('model request is bounded, fixed provider URL and never contains authorization identity', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.redirect, 'manual');
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

test('growth replies never drop a stored measurement and failures stay family-readable', () => {
  // Regression: head circumference was written but omitted from query replies, so
  // the family believed it had not been saved.
  const plan = { version: 1 as const, operations: [{ name: 'list_growth_records' as const, args: { limit: 5 } }] };
  const record = { date: '2026-10-11T00:00:00.000Z', weight: 9.5, height: 72, headCircumference: 45 };
  const listed = formatResults(plan, [{ operation: 'list_growth_records', baby, data: { records: [record] } }]);
  for (const expected of ['9.5 kg', '72 cm', '45 cm']) assert.ok(listed.includes(expected), `list reply lost ${expected}`);
  // Create and list replies are generated from one field table, so they agree.
  const created = formatResults({ version: 1 as const, operations: [{ name: 'create_growth_record' as const, args: {} }] },
    [{ operation: 'create_growth_record', baby, data: { ...record, id: 'record-1' } }]);
  for (const value of ['9.5', '72', '45']) assert.ok(created.includes(value));
  assert.ok(listed.includes('45 cm') && created.includes('头围 45 cm'), 'labelled and unlabelled replies must both carry head circumference');
  const partial = formatResults(plan, [{ operation: 'list_growth_records', baby, data: { records: [{ date: record.date, weight: 9.5 }] } }]);
  assert.ok(partial.includes('9.5 kg') && !partial.includes('undefined'));

  assert.ok(failureReply('forbidden').includes('权限'));
  assert.ok(failureReply('business_http_403').includes('权限'));
  assert.ok(failureReply('writes_disabled').includes('没有保存'));
  assert.ok(failureReply('anything_unknown').includes('重发'));
  for (const code of ['forbidden', 'writes_disabled', 'session_rebound', 'internal_or_queue', 'unknown']) {
    const text = failureReply(code);
    assert.ok(text.length > 0 && !/http_|Error|_|writes_enabled|token/i.test(text), `internal detail leaked for ${code}`);
  }
});

test('planner prompt pins unit conversion and confirmation rules', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const system = JSON.parse(options.body as string).messages[0].content as string;
    assert.ok(system.includes('1 斤 = 0.5 kg'), 'jin to kg conversion must be stated explicitly');
    assert.ok(system.includes('不要猜'), 'missing units must be clarified, never guessed');
    assert.ok(system.includes('20kg'), 'implausible measurements must be confirmed first');
    assert.ok(system.includes('list_growth_records'), 'same-day duplicates must be checked before writing');
    return Response.json(modelResponse());
  });
  await planMessage({ ...input, baby, writesEnabled: true }, config);
});

test('the planner cannot propose channel-driven media archiving', async t => {
  assert.equal(isModelOperation('create_media_record'), false);
  assert.equal(isModelOperation('create_growth_record'), true);
  assert.equal(isModelOperation('delete_baby'), false);
  // Even if a model emits the tool name, planning must refuse it: the channel, not
  // the model, decides when a photo is archived.
  t.mock.method(globalThis, 'fetch', async () => Response.json(modelResponse('create_media_record',
    { date: '2026-10-11', key: `uploads/wx/${'a'.repeat(16)}/1-0.jpg`, mediaType: 'IMAGE' })));
  await assert.rejects(planMessage({ ...input, baby, writesEnabled: true }, config),
    (e: unknown) => e instanceof AgentError && e.code === 'invalid_tool_arguments');
  assert.ok(!JSON.stringify(await import('../src/agent.js').then(m => m.TOOLS)).includes('create_media_record'),
    'media archiving must not be offered to the model');
});

test('album replies summarise server-side and never leak private media links', () => {
  const listPlan = { version: 1 as const, operations: [{ name: 'list_media_items' as const, args: { limit: 2 } }] };
  const rows = { operation: 'list_media_items', baby, data: { records: [
    { date: '2026-10-11T00:00:00.000Z', mediaType: 'IMAGE', format: 'jpg', title: '满月' },
    { date: '2026-10-10T00:00:00.000Z', mediaType: 'VIDEO', format: 'mp4', title: '' }] } };
  const text = formatResults(listPlan, [rows]);
  assert.ok(text.includes('照片') && text.includes('视频') && text.includes('满月') && text.includes('2 项'));
  assert.ok(!text.includes('/api/media') && !text.includes('http'), 'private media links must never reach the channel');
  assert.ok(formatResults(listPlan, [{ ...rows, data: { records: [] } }]).includes('暂无'));

  const summaryPlan = { version: 1 as const, operations: [{ name: 'get_album_summary' as const, args: {} }] };
  const summary = formatResults(summaryPlan, [{ operation: 'get_album_summary', baby,
    data: { total: 3, images: 2, videos: 1, firstDate: '2026-08-01', latestDate: '2026-10-11', months: [{ month: '2026-10', count: 2 }] } }]);
  assert.ok(summary.includes('3 项') && summary.includes('照片 2 张') && summary.includes('视频 1 个'));
  assert.ok(summary.includes('2026-10-11') && summary.includes('2026-10：2 项'));
  assert.ok(formatResults(summaryPlan, [{ operation: 'get_album_summary', baby,
    data: { total: 0, images: 0, videos: 0, firstDate: null, latestDate: null, months: [] } }]).includes('还是空的'));
});

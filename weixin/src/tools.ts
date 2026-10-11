import { isWrite, type AgentIdentity, type AgentPlan, type BabySummary } from '../../shared/agent.js';
import { AgentError } from './agent.js';

export interface ToolConfig { origin: string; token: string; writesEnabled: boolean; fetcher?: typeof fetch }
export interface ToolResult { operation: string; baby: BabySummary; data: Record<string, unknown>; replayed?: boolean }

function apiUrl(origin: string): string {
  let url: URL;
  try { url = new URL(origin); } catch { throw new AgentError('invalid_mybaby_origin'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new AgentError('invalid_mybaby_origin');
  return `${url.origin}/api/agent/v1`;
}

export async function callTool(identity: AgentIdentity, operation: string, args: unknown,
  operationKey: string, config: ToolConfig): Promise<ToolResult> {
  if (!config.token || config.token.length < 32) throw new AgentError('missing_mybaby_token');
  let response: Response;
  try {
    response = await (config.fetcher ?? fetch)(apiUrl(config.origin), {
      // Workers accepts manual/follow, not Node's redirect:'error'. Reject 3xx
      // below without forwarding the service bearer to a redirect target.
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ ...identity, operation, operationKey, args }),
    });
  } catch (e) { if (e instanceof AgentError) throw e; throw new AgentError('business_timeout_or_network', true); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AgentError(`business_http_${response.status}`, response.status === 429 || response.status >= 500);
  }
  let result: ToolResult;
  try { result = await response.json() as ToolResult; } catch { throw new AgentError('invalid_business_result', true); }
  if (!result || result.operation !== operation || typeof result.baby?.name !== 'string'
    || typeof result.baby.birthDate !== 'string' || !result.data || typeof result.data !== 'object'
    || Array.isArray(result.data)
    || (operation.startsWith('create_') && (typeof result.data.id !== 'string' || typeof result.data.date !== 'string'))) {
    throw new AgentError('invalid_business_result', true);
  }
  return result;
}

export async function babyScope(identity: AgentIdentity, config: ToolConfig): Promise<BabySummary> {
  const result = await callTool(identity, 'get_baby_summary', {}, 'scope', config);
  return result.baby;
}

// Progress is saved after each successful operation. A response-lost write can be
// retried with its original arguments/key because the business API is transactional.
export async function executePlan(identity: AgentIdentity, plan: AgentPlan, config: ToolConfig,
  previous: ToolResult[], persist: (results: ToolResult[]) => Promise<void>, guard: () => void = () => {}): Promise<ToolResult[]> {
  if (!config.writesEnabled && plan.operations.some(op => isWrite(op.name))) throw new AgentError('writes_disabled');
  const results = [...previous];
  for (let i = results.length; i < plan.operations.length; i++) {
    guard();
    const op = plan.operations[i];
    results.push(await callTool(identity, op.name, op.args, `op_${i}`, config));
    await persist(results);
  }
  return results;
}

// One field table feeds both the create and list replies so a newly added
// measurement cannot be written but silently omitted from query results, which
// is exactly how head circumference was lost before.
const MEASUREMENTS = [['weight', '体重', 'kg'], ['height', '身高', 'cm'], ['headCircumference', '头围', 'cm']] as const;
function measurements(data: Record<string, unknown>, labelled: boolean): string {
  return MEASUREMENTS.flatMap(([field, label, unit]) => data[field] === null || data[field] === undefined
    ? [] : [`${labelled ? `${label} ` : ''}${data[field]} ${unit}`]).join('，');
}

// Fixed, family-readable failure sentences. Never a raw error code, never a stack
// trace, and never a silent drop.
export function failureReply(code: string): string {
  if (['forbidden', 'business_http_401', 'business_http_403'].includes(code)) return '这个微信号还没有操作权限，请先让管理员授权。';
  if (code === 'writes_disabled') return '当前还没开启写入，这条没有保存。';
  if (code === 'session_rebound' || code === 'session_not_running') return '刚才会话状态变了，请重发一次。';
  return '没处理成功，请把内容重发一句，比如：今天 体重6.5kg 身高70cm';
}

export function formatResults(plan: AgentPlan, results: ToolResult[]): string {
  if (plan.operations.length === 0) return `尚未执行查询或写入。\n${plan.clarification ?? '请说明要查询或记录的内容。'}`;
  if (results.length !== plan.operations.length) throw new AgentError('incomplete_results');
  return results.map(r => {
    const d = r.data;
    if (r.operation === 'get_baby_summary') return `${r.baby.name}的出生日期：${r.baby.birthDate.slice(0, 10)}。`;
    if (r.operation === 'create_growth_record') {
      return `已记录${r.baby.name} ${String(d.date).slice(0, 10)}：${measurements(d, true)}。记录 ID：${d.id}`;
    }
    if (r.operation === 'create_milestone') return `已记录${r.baby.name} ${String(d.date).slice(0, 10)}的里程碑：${d.title}。记录 ID：${d.id}`;
    if (r.operation === 'list_media_items') {
      const items = Array.isArray(d.records) ? d.records : [];
      if (!items.length) return `${r.baby.name}在这个时间范围暂无照片或视频。`;
      return `${r.baby.name}的相册（${items.length} 项）：\n` + items.map(item => [String(item.date).slice(0, 10),
        item.mediaType === 'VIDEO' ? '视频' : '照片', item.format ? String(item.format) : '', item.title ? String(item.title) : ''].filter(Boolean).join('，')).join('\n');
    }
    if (r.operation === 'get_album_summary') {
      if (!d.total) return `${r.baby.name}的相册还是空的。`;
      const months = Array.isArray(d.months) ? d.months : [];
      const head = `${r.baby.name}的相册共有 ${d.total} 项：照片 ${d.images} 张、视频 ${d.videos} 个。最近一次：${String(d.latestDate).slice(0, 10)}。`;
      return months.length ? head + '\n' + months.map(month => `${month.month}：${month.count} 项`).join('\n') : head;
    }
    const records = Array.isArray(d.records) ? d.records : [];
    if (!records.length) return `${r.baby.name}在这个时间范围暂无成长记录。`;
    return `${r.baby.name}的成长记录：\n` + records.map(record =>
      [String(record.date).slice(0, 10), measurements(record, false)].filter(Boolean).join('，')).join('\n');
  }).join('\n');
}

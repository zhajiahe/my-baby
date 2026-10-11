// Channel-independent contract. Never allow the model to choose authentication,
// babyId, message identity or an idempotency key.
export type OperationName = 'get_baby_summary' | 'list_growth_records' | 'list_media_items' | 'get_album_summary' | 'create_growth_record' | 'create_milestone';
export type ToolArgs = Record<string, string | number | string[]>;
export interface PlannedOperation { name: OperationName; args: ToolArgs }
export interface AgentPlan { version: 1; operations: PlannedOperation[]; clarification?: string }
export interface AgentIdentity { source: 'weixin'; botId: string; userId: string; messageId: string }
export interface AgentRequest extends AgentIdentity { operation: OperationName; operationKey: string; args: ToolArgs }
export interface AgentGrant { source: 'weixin'; botId: string; userId: string; babyId: string }
export interface BabySummary { name: string; birthDate: string }

export class ContractError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('invalid_object');
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ContractError('invalid_string');
  return value.trim();
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ContractError('invalid_date');
  return value;
}
function exact(args: Record<string, unknown>, keys: string[]) {
  if (Object.keys(args).some(k => !keys.includes(k))) throw new ContractError('unexpected_argument');
}

export function validateOperation(name: unknown, input: unknown): PlannedOperation {
  const args = object(input);
  const result: ToolArgs = {};
  if (name === 'get_baby_summary') exact(args, []);
  else if (name === 'list_growth_records') {
    exact(args, ['from', 'to', 'limit']);
    if (args.from !== undefined) result.from = date(args.from);
    if (args.to !== undefined) result.to = date(args.to);
    if (result.from && result.to && result.from > result.to) throw new ContractError('invalid_date_range');
    const limit = args.limit ?? 10;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 30) throw new ContractError('invalid_limit');
    result.limit = limit as number;
  } else if (name === 'list_media_items') {
    exact(args, ['from', 'to', 'limit', 'mediaType']);
    if (args.from !== undefined) result.from = date(args.from);
    if (args.to !== undefined) result.to = date(args.to);
    if (result.from && result.to && result.from > result.to) throw new ContractError('invalid_date_range');
    if (args.mediaType !== undefined) {
      if (args.mediaType !== 'IMAGE' && args.mediaType !== 'VIDEO') throw new ContractError('invalid_media_type');
      result.mediaType = args.mediaType;
    }
    const mediaLimit = args.limit ?? 10;
    if (!Number.isInteger(mediaLimit) || (mediaLimit as number) < 1 || (mediaLimit as number) > 30) throw new ContractError('invalid_limit');
    result.limit = mediaLimit as number;
  } else if (name === 'get_album_summary') {
    // No arguments: the rollup is computed server-side so the model never does arithmetic.
    exact(args, []);
  } else if (name === 'create_growth_record') {
    exact(args, ['date', 'weight', 'height', 'headCircumference', 'notes']);
    result.date = date(args.date);
    for (const [field, min, max] of [['weight', 0.1, 100], ['height', 10, 250], ['headCircumference', 10, 100]] as const) {
      const value = args[field];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ContractError('invalid_measurement');
      result[field] = value;
    }
    if (result.weight === undefined && result.height === undefined && result.headCircumference === undefined) throw new ContractError('missing_measurement');
    const notes = string(args.notes, 2000, false); if (notes) result.notes = notes;
  } else if (name === 'create_milestone') {
    exact(args, ['date', 'title', 'description', 'tags']);
    result.date = date(args.date); result.title = string(args.title, 120)!;
    const description = string(args.description, 2000, false); if (description) result.description = description;
    if (args.tags !== undefined) {
      if (!Array.isArray(args.tags) || args.tags.length > 10) throw new ContractError('invalid_tags');
      result.tags = [...new Set(args.tags.map(tag => string(tag, 40)!))];
    }
  } else throw new ContractError('unsupported_operation');
  return { name: name as OperationName, args: result };
}

export function validateRequest(value: unknown): AgentRequest {
  const data = object(value);
  exact(data, ['source', 'botId', 'userId', 'messageId', 'operation', 'operationKey', 'args']);
  if (data.source !== 'weixin') throw new ContractError('unsupported_source');
  const op = validateOperation(data.operation, data.args);
  const operationKey = string(data.operationKey, 80)!;
  if (!/^[a-zA-Z0-9_-]+$/.test(operationKey)) throw new ContractError('invalid_operation_key');
  return { source: 'weixin', botId: string(data.botId, 256)!, userId: string(data.userId, 256)!,
    messageId: string(data.messageId, 80)!, operationKey, operation: op.name, args: op.args };
}

export function resolveGrant(identity: AgentIdentity, config: string | undefined): AgentGrant {
  let grants: unknown;
  try { grants = JSON.parse(config ?? ''); } catch { throw new ContractError('grants_not_configured', 503); }
  if (!Array.isArray(grants)) throw new ContractError('grants_not_configured', 503);
  const matches = grants.filter(g => g && typeof g === 'object' && g.source === identity.source
    && g.botId === identity.botId && g.userId === identity.userId);
  if (matches.length !== 1 || typeof matches[0].babyId !== 'string' || !matches[0].babyId) throw new ContractError('forbidden', 403);
  return matches[0] as AgentGrant;
}

export function isWrite(name: OperationName): boolean { return name.startsWith('create_'); }

export function calendarDate(timeMs: number, timeZone = 'Asia/Shanghai'): string {
  if (!Number.isFinite(timeMs)) throw new ContractError('invalid_timestamp');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timeMs));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

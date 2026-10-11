import { createHash } from 'node:crypto'
import { ContractError, isWrite, resolveGrant, validateRequest, type AgentGrant, type AgentRequest, type BabySummary } from '../../../shared/agent'

export interface AgentResult { operation: string; baby: BabySummary; data: Record<string, unknown>; replayed?: boolean }
export interface ReceiptKey { source: string; botId: string; messageId: string; operationKey: string }
export interface Receipt { payloadHash: string; result: AgentResult }
export interface AgentTransaction {
  findReceipt(key: ReceiptKey): Promise<Receipt | null>
  mutate(request: AgentRequest, babyId: string): Promise<Record<string, unknown>>
  saveReceipt(key: ReceiptKey, receipt: Receipt): Promise<void>
}
export interface AlbumSummary {
  total: number; images: number; videos: number;
  firstDate: string | null; latestDate: string | null;
  months: { month: string; count: number }[];
}
export interface AgentStore {
  baby(babyId: string): Promise<BabySummary | null>
  growth(babyId: string, args: AgentRequest['args']): Promise<Record<string, unknown>[]>
  // Album reads never return media URLs: private links are unusable from the channel and must not leak.
  media(babyId: string, args: AgentRequest['args']): Promise<Record<string, unknown>[]>
  album(babyId: string): Promise<AlbumSummary>
  findReceipt(key: ReceiptKey): Promise<Receipt | null>
  transaction<T>(fn: (tx: AgentTransaction) => Promise<T>): Promise<T>
  isUniqueConflict(error: unknown): boolean
  // D1 cannot run an interactive callback transaction. Its implementation
  // prepares a receipt and mutation offline and commits both in one batch.
  atomicWrite?(request: AgentRequest, babyId: string, key: ReceiptKey, payloadHash: string, baby: BabySummary):
    Promise<{ receipt: Receipt; replayed: boolean }>
}

export async function executeOperation(value: unknown, options: {
  store: AgentStore; grants?: string; writesEnabled: boolean
}): Promise<AgentResult> {
  const request = validateRequest(value)
  const grant: AgentGrant = resolveGrant(request, options.grants)
  if (isWrite(request.operation) && !options.writesEnabled) throw new ContractError('writes_disabled', 403)
  const baby = await options.store.baby(grant.babyId)
  if (!baby) throw new ContractError('baby_not_found', 404)
  if (request.operation === 'get_baby_summary') return { operation: request.operation, baby, data: { ...baby } }
  if (request.operation === 'list_growth_records') return { operation: request.operation, baby, data: { records: await options.store.growth(grant.babyId, request.args) } }
  if (request.operation === 'list_media_items') return { operation: request.operation, baby, data: { records: await options.store.media(grant.babyId, request.args) } }
  if (request.operation === 'get_album_summary') return { operation: request.operation, baby, data: { ...await options.store.album(grant.babyId) } }
  // Authorize before examining any stored result; hash binds identity, baby and
  // normalized parameters so a reused key cannot expose someone else's data.
  const key: ReceiptKey = { source: request.source, botId: request.botId, messageId: request.messageId, operationKey: request.operationKey }
  const payloadHash = createHash('sha256').update(JSON.stringify({ request, babyId: grant.babyId })).digest('hex')
  const replay = (receipt: Receipt): AgentResult => {
    if (receipt.payloadHash !== payloadHash) throw new ContractError('idempotency_conflict', 409)
    return { ...receipt.result, replayed: true }
  }
  const existing = await options.store.findReceipt(key)
  if (existing) return replay(existing)
  if (options.store.atomicWrite) {
    const committed = await options.store.atomicWrite(request, grant.babyId, key, payloadHash, baby)
    if (committed.receipt.payloadHash !== payloadHash) throw new ContractError('idempotency_conflict', 409)
    return committed.replayed ? replay(committed.receipt) : committed.receipt.result
  }
  try {
    return await options.store.transaction(async tx => {
      const prior = await tx.findReceipt(key)
      if (prior) return replay(prior)
      const data = await tx.mutate(request, grant.babyId)
      const result: AgentResult = { operation: request.operation, baby, data }
      await tx.saveReceipt(key, { payloadHash, result })
      return result
    })
  } catch (error) {
    if (!options.store.isUniqueConflict(error)) throw error
    // Concurrent losing transaction is rolled back (including its business write).
    const committed = await options.store.findReceipt(key)
    if (committed) return replay(committed)
    throw error
  }
}

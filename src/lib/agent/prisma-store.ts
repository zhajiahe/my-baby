import { Prisma, type PrismaClient } from '@prisma/client'
import type { AgentRequest } from '../../../shared/agent'
import type { AgentResult, AgentStore, Receipt, ReceiptKey } from './service'

// Return only the fields needed by the channel, not notes/allergies/media URLs.
const growthSelect = { id: true, date: true, weight: true, height: true, headCircumference: true } as const
function plain<T>(value: unknown): T { return JSON.parse(JSON.stringify(value)) as T }
const receiptWhere = (key: ReceiptKey) => ({ source_botId_messageId_operationKey: key })

export function prismaStore(db: PrismaClient): AgentStore {
  async function findReceipt(client: PrismaClient | Prisma.TransactionClient, key: ReceiptKey): Promise<Receipt | null> {
    const row = await client.agentOperation.findUnique({ where: receiptWhere(key) })
    return row ? { payloadHash: row.payloadHash, result: row.result as unknown as AgentResult } : null
  }
  return {
    async baby(id) {
      const row = await db.baby.findUnique({ where: { id }, select: { name: true, birthDate: true } })
      return row ? { name: row.name, birthDate: row.birthDate.toISOString() } : null
    },
    async growth(babyId, args) {
      return plain(await db.growthRecord.findMany({ where: {
        babyId, date: {
          ...(args.from ? { gte: new Date(`${args.from}T00:00:00.000Z`) } : {}),
          ...(args.to ? { lt: new Date(new Date(`${args.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
        },
      }, take: args.limit as number, orderBy: [{ date: 'desc' }, { id: 'desc' }], select: growthSelect }))
    },
    findReceipt: key => findReceipt(db, key),
    transaction: fn => db.$transaction(async tx => fn({
      findReceipt: key => findReceipt(tx, key),
      async mutate(request: AgentRequest, babyId: string) {
        const a = request.args
        if (request.operation === 'create_growth_record') {
          return plain(await tx.growthRecord.create({ data: { babyId, date: new Date(`${a.date}T00:00:00.000Z`),
            weight: a.weight as number | undefined, height: a.height as number | undefined,
            headCircumference: a.headCircumference as number | undefined, notes: a.notes as string | undefined,
          }, select: growthSelect }))
        }
        return plain(await tx.milestone.create({ data: { babyId, date: new Date(`${a.date}T00:00:00.000Z`),
          title: a.title as string, description: a.description as string | undefined, tags: a.tags as string[] ?? [],
        }, select: { id: true, date: true, title: true } }))
      },
      async saveReceipt(key, receipt) {
        await tx.agentOperation.create({ data: { ...key, payloadHash: receipt.payloadHash,
          result: plain<Prisma.InputJsonValue>(receipt.result) } })
      },
    })),
    isUniqueConflict: error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
  }
}

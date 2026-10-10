import { prisma } from '@/lib/prisma'
import { agentHandler } from '@/lib/agent/handler'
import { prismaStore } from '@/lib/agent/prisma-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  return agentHandler({ store: prismaStore(prisma), token: process.env.MYBABY_AGENT_TOKEN,
    grants: process.env.MYBABY_AGENT_GRANTS, writesEnabled: process.env.MYBABY_AGENT_WRITES_ENABLED === 'true',
  })(request)
}

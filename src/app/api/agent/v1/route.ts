import { database } from '@/lib/db'
import { agentHandler } from '@/lib/agent/handler'
import { d1Store } from '@/lib/agent/d1-store'
import { mediaWriteVerifier } from '@/lib/agent/media-verify'
export async function POST(request: Request) {
 return agentHandler({store:d1Store(await database()),token:process.env.MYBABY_AGENT_TOKEN,
   grants:process.env.MYBABY_AGENT_GRANTS,writesEnabled:process.env.MYBABY_AGENT_WRITES_ENABLED==='true',
   verifyWrite:mediaWriteVerifier()})(request)
}

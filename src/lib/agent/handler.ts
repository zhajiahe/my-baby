import { equalSecret, limitedJson } from '../auth'
import { ContractError } from '../../../shared/agent'
import { executeOperation, type AgentStore } from './service'

export function agentHandler(options: { store: AgentStore; token?: string; grants?: string; writesEnabled: boolean }) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'private, no-store' }
    const reply = (data: unknown, status: number) => Response.json(data, { status, headers })
    if (!options.token || options.token.length < 32) return reply({ error: 'agent_not_configured' }, 503)
    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ') || !equalSecret(authorization.slice(7), options.token)) return reply({ error: 'unauthorized' }, 401)
    let body: unknown
    try { body = await limitedJson(request) } catch { return reply({ error: 'invalid_body' }, 400) }
    try { return reply(await executeOperation(body, options), 200) }
    catch (error) {
      if (error instanceof ContractError) return reply({ error: error.code }, error.status)
      // Do not log Prisma exceptions: they can contain arguments/health data.
      console.error(JSON.stringify({ event: 'agent_operation_error', category: 'database_or_internal' }))
      return reply({ error: 'internal_error' }, 500)
    }
  }
}

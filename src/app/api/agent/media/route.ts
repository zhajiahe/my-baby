import { NextResponse } from 'next/server'
import { bindings, database } from '@/lib/db'
import { equalSecret } from '@/lib/auth'
import { ContractError, resolveGrant, validateRequest, type AgentIdentity } from '../../../../../shared/agent'
import { MAX_INTAKE_BYTES, mediaIntakeFormat, mediaIntakeKey, mediaIntakeRequest } from '@/lib/agent/media-intake'
import { executeOperation } from '@/lib/agent/service'
import { d1Store } from '@/lib/agent/d1-store'
import { mediaWriteVerifier } from '@/lib/agent/media-verify'

export const runtime = 'nodejs'

// Channel media intake, authenticated by the service token rather than a family
// cookie. The channel sends bytes and its identity; the destination key, the URL
// and the record are all derived server-side.
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const fail = (code: string, status: number) => NextResponse.json({ error: code }, { status, headers })
  const token = process.env.MYBABY_AGENT_TOKEN
  if (!token || token.length < 32) return fail('agent_not_configured', 503)
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !equalSecret(authorization.slice(7), token)) return fail('unauthorized', 401)
  // Bound the body before parsing so an oversized upload is refused early.
  const declared = Number(request.headers.get('content-length'))
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_INTAKE_BYTES + 1024 * 1024) return fail('use_bounded_upload', 413)
  let form: FormData
  try { form = await request.formData() } catch { return fail('invalid_body', 400) }
  const file = form.get('file')
  if (!(file instanceof File)) return fail('file_required', 400)
  const identity: AgentIdentity = { source: 'weixin', botId: String(form.get('botId') ?? ''),
    userId: String(form.get('userId') ?? ''), messageId: String(form.get('messageId') ?? '') }
  const index = Number(form.get('index') ?? 0)
  const date = String(form.get('date') ?? '')
  try {
    // Authorize before anything reaches storage: an unauthorized caller must never
    // be able to write an object even if the record would be refused afterwards.
    resolveGrant(identity, process.env.MYBABY_AGENT_GRANTS)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { ext } = mediaIntakeFormat({ contentType: file.type, bytes, index })
    const key = mediaIntakeKey(identity, index, ext)
    const { MEDIA } = await bindings()
    // Content type is set from the validated request so the later object check
    // compares like for like.
    await MEDIA.put(key, bytes, { httpMetadata: { contentType: file.type } })
    const duration = form.get('duration')
    const title = form.get('title')
    const result = await executeOperation(validateRequest(mediaIntakeRequest({ identity, date, index,
      contentType: file.type, bytes, ...(title ? { title: String(title) } : {}),
      ...(duration === null ? {} : { duration: Number(duration) }) })), {
      store: d1Store(await database()), grants: process.env.MYBABY_AGENT_GRANTS,
      writesEnabled: process.env.MYBABY_AGENT_WRITES_ENABLED === 'true', verifyWrite: mediaWriteVerifier(),
    })
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers })
  } catch (error) {
    if (error instanceof ContractError) return fail(error.code, error.status)
    console.error(JSON.stringify({ event: 'media_intake_error', category: 'storage_or_internal' }))
    return fail('media_intake_failed', 500)
  }
}

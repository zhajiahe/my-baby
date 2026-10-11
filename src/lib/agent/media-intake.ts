import { ContractError, mediaNamespace, type AgentIdentity, type AgentRequest } from '../../../shared/agent'
import { MAX_MEDIA_BYTES, matchesSignature } from '../media-validation'

// Channel media intake. The caller sends bytes, never a destination: the object key
// is derived here from the verified identity and the inbound message, so nothing
// outside this process chooses where an object lands or which record it becomes.
const ALLOWED: Record<string, { ext: string; mediaType: 'IMAGE' | 'VIDEO' }> = {
  'image/jpeg': { ext: 'jpg', mediaType: 'IMAGE' }, 'image/png': { ext: 'png', mediaType: 'IMAGE' },
  'image/gif': { ext: 'gif', mediaType: 'IMAGE' }, 'image/webp': { ext: 'webp', mediaType: 'IMAGE' },
  'video/mp4': { ext: 'mp4', mediaType: 'VIDEO' }, 'video/webm': { ext: 'webm', mediaType: 'VIDEO' },
}
export const MAX_INTAKE_BYTES = MAX_MEDIA_BYTES
export const MAX_MEDIA_INDEX = 4

export interface MediaIntake {
  identity: AgentIdentity;
  date: string;
  index: number;
  contentType: string;
  bytes: Uint8Array;
  title?: string;
  duration?: number;
}

export function mediaIntakeFormat(input: { contentType: string; bytes: Uint8Array; index: number }): { ext: string; mediaType: 'IMAGE' | 'VIDEO' } {
  const allowed = ALLOWED[input.contentType]
  if (!allowed) throw new ContractError('unsupported_media_type', 415)
  if (!input.bytes.length) throw new ContractError('empty_media', 400)
  if (input.bytes.length > MAX_INTAKE_BYTES) throw new ContractError('invalid_actual_size', 413)
  if (!Number.isInteger(input.index) || input.index < 0 || input.index > MAX_MEDIA_INDEX) throw new ContractError('invalid_media_index', 400)
  // The container must match the declared type. A wrong AES key produces bytes that
  // are not an image, so a bad decrypt can never reach the album as a broken file.
  if (!matchesSignature(input.bytes, allowed.ext)) throw new ContractError('invalid_media_signature', 415)
  return allowed
}

export function mediaIntakeKey(identity: AgentIdentity, index: number, ext: string): string {
  // The object-key grammar requires a numeric message id, so it is enforced here
  // rather than producing a key the contract would later reject.
  if (!/^\d{1,30}$/.test(identity.messageId)) throw new ContractError('invalid_message_id', 400)
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new ContractError('invalid_media_format', 400)
  return `${mediaNamespace(identity.botId, identity.userId)}${identity.messageId}-${index}.${ext}`
}

export function mediaIntakeRequest(input: MediaIntake): AgentRequest {
  const { ext, mediaType } = mediaIntakeFormat(input)
  const key = mediaIntakeKey(input.identity, input.index, ext)
  return {
    ...input.identity, operation: 'create_media_record', operationKey: `media_${input.index}`,
    args: { date: input.date, key, mediaType, ...(input.title ? { title: input.title } : {}),
      ...(input.duration === undefined ? {} : { duration: input.duration }) },
  }
}

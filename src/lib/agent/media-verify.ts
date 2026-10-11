import { bindings } from '../db'
import { validateObject } from '../media-validation'
import type { WriteVerifier } from './service'

// Channel media records reference objects the channel already uploaded. Before a
// record is committed, existence, actual size, MIME and container signature are
// verified against the private bucket, and the URL is derived from the key rather
// than accepted from the caller. This runs only on the first attempt, so deleting
// an object later cannot turn an already-committed write into a failure.
export function mediaWriteVerifier(): WriteVerifier {
  return async request => {
    if (request.operation !== 'create_media_record') return
    const { MEDIA } = await bindings()
    const key = String(request.args.key)
    await validateObject(MEDIA, `/api/media/${key}`, key.slice(key.lastIndexOf('.') + 1))
    const thumbnail = request.args.thumbnailKey
    if (thumbnail !== undefined) await validateObject(MEDIA, `/api/media/${String(thumbnail)}`, 'jpg')
  }
}

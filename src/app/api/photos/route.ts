import { NextRequest, NextResponse } from 'next/server'
import { db, database, bindings } from '@/lib/db'
import { createMediaOnce, UploadError } from '@/lib/media-upload'
import { validateMedia } from '@/lib/media-validation'
import { limitedJson } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const babyId = searchParams.get('babyId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    if (!babyId) {
      return NextResponse.json({ error: 'Baby ID is required' }, { status: 400 })
    }

    // 支持分页，默认返回最近 50 条
    const skip = (page - 1) * limit
    
    const [mediaItems, total] = await Promise.all([
      db.mediaItem.findMany({
        where: { babyId },
        orderBy: { date: 'desc' },
        take: limit,
        skip: skip,
      }),
      db.mediaItem.count({ where: { babyId } })
    ])

    return NextResponse.json({
      items: mediaItems,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + mediaItems.length < total
      }
    }, {
      headers: {
        // Family data must never be stored in shared CDN caches.
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('Error fetching media items:', error)
    return NextResponse.json({ error: 'Failed to fetch media items' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await limitedJson(request) as Record<string, any>
    
    // Validate required fields
    if (!data.babyId) {
      console.error('Missing babyId')
      return NextResponse.json({ error: 'Baby ID is required' }, { status: 400 })
    }
    // title is now optional - will use empty string if not provided
    if (!data.url) {
      console.error('Missing url')
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }
    if (!data.mediaType) {
      console.error('Missing mediaType')
      return NextResponse.json({ error: 'Media type is required' }, { status: 400 })
    }

    const value = {
        babyId: data.babyId,
        date: new Date(data.date),
        title: data.title || '', // title is optional, default to empty string
        description: data.description || null,
        url: data.url, // URL of the main media (image or video)
        mediaType: data.mediaType, // "IMAGE" or "VIDEO"
        format: data.format || null, // e.g., "jpeg", "mp4"
        thumbnailUrl: data.thumbnailUrl || null, // URL of video thumbnail
        duration: data.duration ? Math.round(data.duration) : null, // Video duration in seconds, ensure integer
    }
    const {MEDIA}=await bindings()
    await validateMedia(MEDIA,data)
    const mediaItem=data.uploadId?await createMediaOnce(await database(),data.uploadId,value):await db.mediaItem.create({data:value})
    return NextResponse.json(mediaItem, { status: mediaItem.replayed?200:201 }) // Changed from photo
  } catch (error) {
    if(error instanceof UploadError)return NextResponse.json({error:error.code},{status:error.status})
    console.error('media_create_failed')
    return NextResponse.json({ error: 'Failed to create media item' }, { status: 500 }) // Changed from photo
  }
} 
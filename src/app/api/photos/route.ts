import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
      prisma.mediaItem.findMany({
        where: { babyId },
        orderBy: { date: 'desc' },
        take: limit,
        skip: skip,
      }),
      prisma.mediaItem.count({ where: { babyId } })
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
        // 照片列表缓存 30 秒
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
      },
    })
  } catch (error) {
    console.error('Error fetching media items:', error)
    return NextResponse.json({ error: 'Failed to fetch media items' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    console.log('Received data for media item creation:', data)
    
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

    const mediaItem = await prisma.mediaItem.create({ // Changed from prisma.photo.create
      data: {
        babyId: data.babyId,
        date: new Date(data.date),
        title: data.title || '', // title is optional, default to empty string
        description: data.description || null,
        url: data.url, // URL of the main media (image or video)
        mediaType: data.mediaType, // "IMAGE" or "VIDEO"
        format: data.format || null, // e.g., "jpeg", "mp4"
        thumbnailUrl: data.thumbnailUrl || null, // URL of video thumbnail
        duration: data.duration ? Math.round(data.duration) : null, // Video duration in seconds, ensure integer
      },
    })

    console.log('Successfully created media item:', mediaItem)
    return NextResponse.json(mediaItem, { status: 201 }) // Changed from photo
  } catch (error) {
    console.error('Error creating media item:', error) // Changed from photo
    console.error('Error details:', error instanceof Error ? error.message : 'Unknown error')
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json({ error: 'Failed to create media item' }, { status: 500 }) // Changed from photo
  }
} 
import { NextRequest, NextResponse } from 'next/server'
import { db, bindings } from '@/lib/db'
import { limitedJson } from '@/lib/auth'
import { validateMedia } from '@/lib/media-validation'
import { UploadError } from '@/lib/media-upload'

interface BatchMediaItemInput {
  babyId: string
  date: string
  title?: string  // Optional title
  description?: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
  format?: string
  thumbnailUrl?: string
  duration?: number
}

export async function POST(request: NextRequest) {
  try {
    const data = await limitedJson(request) as {items: BatchMediaItemInput[]}
    
    // Validate that we have an array of items
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 50) {
      return NextResponse.json(
        { error: 'Items array is required and must not be empty' },
        { status: 400 }
      )
    }

    const items: BatchMediaItemInput[] = data.items

    // Validate each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.babyId) {
        return NextResponse.json(
          { error: `Item ${i + 1}: Baby ID is required` },
          { status: 400 }
        )
      }
      if (!item.url) {
        return NextResponse.json(
          { error: `Item ${i + 1}: URL is required` },
          { status: 400 }
        )
      }
      if (!item.mediaType) {
        return NextResponse.json(
          { error: `Item ${i + 1}: Media type is required` },
          { status: 400 }
        )
      }
    }

    const {MEDIA}=await bindings()
    for(const item of items)await validateMedia(MEDIA,item)
    // Create all media items in a transaction
    const createdItems = await db.createMediaBatch(items.map(item => ({
      babyId: item.babyId, date: new Date(item.date), title: item.title || '',
      description: item.description || null, url: item.url, mediaType: item.mediaType,
      format: item.format || null, thumbnailUrl: item.thumbnailUrl || null,
      duration: item.duration ? Math.round(item.duration) : null,
    })))

    
    return NextResponse.json(
      {
        success: true,
        count: createdItems.length,
        items: createdItems,
      },
      { status: 201 }
    )
  } catch (error) {
    if(error instanceof UploadError)return NextResponse.json({error:error.code},{status:error.status})
    console.error('media_batch_failed')
    return NextResponse.json(
      { error: 'Failed to create media items' },
      { status: 500 }
    )
  }
}


import { NextRequest, NextResponse } from 'next/server'
import { db, bindings } from '@/lib/db'
import { validateObject } from '@/lib/media-validation'
import { UploadError } from '@/lib/media-upload'

export async function GET() {
  try {
    // For now, we'll get the first baby (single baby app)
    // In a multi-user app, you'd filter by user ID
    const baby = await db.baby.findFirst({
      include: {
        _count: {
          select: {
            growthRecords: true,
            milestones: true,
            mediaItems: true,
          },
        },
      },
    })

    return NextResponse.json(baby, {
      headers: {
        // Family data must never be stored in shared CDN caches.
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('Error fetching baby:', error)
    return NextResponse.json({ error: 'Failed to fetch baby data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    
    if(data.avatar){
      const format=data.avatar.split('.').pop()
      if(!['jpg','png','gif','webp'].includes(format))throw new UploadError('invalid_avatar_type',415)
      await validateObject((await bindings()).MEDIA,data.avatar,format)
    }
    const baby = await db.baby.create({
      data: {
        name: data.name,
        birthDate: new Date(data.birthDate),
        birthTime: data.birthTime,
        gender: data.gender,
        avatar: data.avatar,
        birthWeight: data.birthWeight ? parseFloat(data.birthWeight) : null,
        birthHeight: data.birthHeight ? parseFloat(data.birthHeight) : null,
        birthHeadCircumference: data.birthHeadCircumference ? parseFloat(data.birthHeadCircumference) : null,
        bloodType: data.bloodType,
        allergies: data.allergies,
        notes: data.notes,
      },
    })

    return NextResponse.json(baby, { status: 201 })
  } catch (error) {
    if(error instanceof UploadError)return NextResponse.json({error:error.code},{status:error.status})
    console.error('baby_create_failed')
    return NextResponse.json({ error: 'Failed to create baby' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const data = await request.json()
    
    if (!data.id) {
      return NextResponse.json({ error: 'Baby ID is required' }, { status: 400 })
    }

    const updateData: Partial<{
      name: string
      birthDate: Date
      birthTime: string
      gender: string
      avatar: string
      birthWeight: number | null
      birthHeight: number | null
      birthHeadCircumference: number | null
      bloodType: string
      allergies: string
      notes: string
      updatedAt: Date
    }> = {}
    
    // 只更新传入的字段
    if (data.name !== undefined) updateData.name = data.name
    if (data.birthDate !== undefined) updateData.birthDate = new Date(data.birthDate)
    if (data.birthTime !== undefined) updateData.birthTime = data.birthTime
    if (data.gender !== undefined) updateData.gender = data.gender
    if (data.avatar !== undefined) {
      const current=await db.baby.findUnique({where:{id:data.id}})
      if(data.avatar&&data.avatar!==current?.avatar){
        const format=data.avatar.split('.').pop()
        if(!['jpg','png','gif','webp'].includes(format))throw new UploadError('invalid_avatar_type',415)
        await validateObject((await bindings()).MEDIA,data.avatar,format)
      }
      updateData.avatar = data.avatar
    }
    if (data.birthWeight !== undefined) updateData.birthWeight = data.birthWeight ? parseFloat(data.birthWeight) : null
    if (data.birthHeight !== undefined) updateData.birthHeight = data.birthHeight ? parseFloat(data.birthHeight) : null
    if (data.birthHeadCircumference !== undefined) updateData.birthHeadCircumference = data.birthHeadCircumference ? parseFloat(data.birthHeadCircumference) : null
    if (data.bloodType !== undefined) updateData.bloodType = data.bloodType
    if (data.allergies !== undefined) updateData.allergies = data.allergies
    if (data.notes !== undefined) updateData.notes = data.notes

    updateData.updatedAt = new Date()

    const baby = await db.baby.update({
      where: { id: data.id },
      data: updateData,
      include: {
        _count: {
          select: {
            growthRecords: true,
            milestones: true,
            mediaItems: true,
          }
        }
      }
    })

    return NextResponse.json(baby)
  } catch (error) {
    if(error instanceof UploadError)return NextResponse.json({error:error.code},{status:error.status})
    console.error('baby_update_failed')
    return NextResponse.json({ error: 'Failed to update baby' }, { status: 500 })
  }
} 
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const record = await db.growthRecord.findUnique({
      where: { id },
      include: {
        baby: {
          select: {
            name: true,
          },
        },
      },
    })

    if (!record) {
      return NextResponse.json({ error: 'Growth record not found' }, { status: 404 })
    }

    return NextResponse.json(record)
  } catch (error) {
    console.error('Error fetching growth record:', error)
    return NextResponse.json({ error: 'Failed to fetch growth record' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const data = await request.json()
    
    const record = await db.growthRecord.update({
      where: { id },
      data: {
        date: data.date ? new Date(data.date) : undefined,
        weight: data.weight ? parseFloat(data.weight) : undefined,
        height: data.height ? parseFloat(data.height) : undefined,
        headCircumference: data.headCircumference ? parseFloat(data.headCircumference) : undefined,
        notes: data.notes,
      },
    })

    return NextResponse.json(record)
  } catch (error) {
    console.error('Error updating growth record:', error)
    return NextResponse.json({ error: 'Failed to update growth record' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.growthRecord.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Growth record deleted successfully' })
  } catch (error) {
    console.error('Error deleting growth record:', error)
    return NextResponse.json({ error: 'Failed to delete growth record' }, { status: 500 })
  }
} 
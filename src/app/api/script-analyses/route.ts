import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const scriptId = searchParams.get('script_id')
    const latest = searchParams.get('latest')
    if (!scriptId) {
      return NextResponse.json({ error: 'script_id is required' }, { status: 400 })
    }
    const db = await getDb()
    const col = db.collection('script_analyses')

    if (latest === '1' || latest === 'true') {
      const item = await col
        .find({ script_id: scriptId })
        .sort({ created_at: -1 })
        .limit(1)
        .toArray()
      return NextResponse.json({ item: item[0] || null })
    }

    const items = await col
      .find({ script_id: scriptId })
      .sort({ created_at: -1 })
      .toArray()
    return NextResponse.json({ items })
  } catch (error: any) {
    console.error('GET /api/script-analyses failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
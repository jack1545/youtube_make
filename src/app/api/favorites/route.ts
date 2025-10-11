import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() })
}

// POST /api/favorites
// body: { image_url: string, page_url?: string, category?: string, note?: string, screenshot_data_url?: string }
export async function POST(req: Request) {
  try {
    const user = getCurrentUser()
    const body = await req.json().catch(() => ({})) as any
    const imageUrl = typeof body.image_url === 'string' ? body.image_url : ''
    const pageUrl = typeof body.page_url === 'string' ? body.page_url : null
    const category = typeof body.category === 'string' ? body.category : null
    const note = typeof body.note === 'string' ? body.note : null
    const screenshotDataUrl = typeof body.screenshot_data_url === 'string' ? body.screenshot_data_url : null

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少 image_url' }, { status: 400, headers: corsHeaders() })
    }

    const db = await getDb()
    const col = db.collection('image_favorites')
    const nowIso = new Date().toISOString()
    const doc = {
      user_id: user.id,
      image_url: imageUrl,
      page_url: pageUrl,
      category,
      note,
      screenshot_data_url: screenshotDataUrl,
      created_at: nowIso
    }
    const result = await col.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : (doc as any).id
    const item = { id, ...doc }
    return NextResponse.json({ item }, { headers: corsHeaders() })
  } catch (err: any) {
    console.error('POST /api/favorites failed', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500, headers: corsHeaders() })
  }
}
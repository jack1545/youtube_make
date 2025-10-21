import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/mongodb'
import { getCurrentUser } from '@/lib/auth'
import { ObjectId } from 'mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const ck = cookies().get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const scriptId = searchParams.get('script_id')
    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('generated_videos')
    // 当传入 script_id 时，兼容 Mongo _id 与 legacy UUID 两种脚本ID
    let filter: any
    if (scriptId) {
      const scriptsCol = db.collection('scripts')
      const scriptDoc = await scriptsCol.findOne(
        ObjectId.isValid(scriptId)
          ? { $or: [{ _id: new ObjectId(scriptId) }, { id: scriptId }] }
          : { id: scriptId }
      )
      const idsToMatch = Array.from(
        new Set([
          scriptId,
          (scriptDoc as any)?.id as string | undefined,
          (scriptDoc as any)?._id ? String((scriptDoc as any)._id) : undefined
        ].filter(Boolean) as string[])
      )
      filter = idsToMatch.length > 1 ? { $or: idsToMatch.map(sid => ({ script_id: sid })) } : { script_id: scriptId }
    } else {
      filter = { user_id: user.id }
    }

    const items = await col
      .find(filter)
      .sort({ shot_number: 1, created_at: 1 })
      .toArray()
    return NextResponse.json({ items })
  } catch (error: any) {
    console.error('GET /api/generated-videos failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

// POST /api/generated-videos
// body: { image_url: string, prompt: string, script_id?: string | null, shot_number?: number, status?: string, video_url?: string }
export async function POST(req: Request) {
  const ck = cookies().get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { image_url, prompt, script_id, shot_number, status, video_url } = payload as {
      image_url?: string
      prompt?: string
      script_id?: string | null
      shot_number?: number
      status?: string
      video_url?: string
    }

    if (!image_url || typeof image_url !== 'string' || !prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 image_url/prompt' }, { status: 400 })
    }

    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('generated_videos')

    const nowIso = new Date().toISOString()
    const doc: any = {
      user_id: user.id,
      script_id: typeof script_id === 'string' ? script_id : null,
      image_url,
      prompt,
      video_url: typeof video_url === 'string' ? video_url : '',
      status: typeof status === 'string' ? status : 'pending',
      shot_number: typeof shot_number === 'number' ? shot_number : undefined,
      created_at: nowIso
    }

    const result = await col.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    const item = { ...doc, id }

    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('POST /api/generated-videos failed', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

// PATCH /api/generated-videos
// body: { id: string, status?: string, video_url?: string }
export async function PATCH(req: Request) {
  const ck = cookies().get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { id, status, video_url } = payload as { id?: string; status?: string; video_url?: string }
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 id' }, { status: 400 })
    }

    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('generated_videos')

    let _id: ObjectId | null = null
    try {
      _id = new ObjectId(id)
    } catch {
      _id = null
    }

    const filter: any = _id ? { _id, user_id: user.id } : { id, user_id: user.id }
    const update: any = {}
    if (typeof status === 'string') update.status = status
    if (typeof video_url === 'string') update.video_url = video_url

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 })
    }

    const res = await col.updateOne(filter, { $set: update })
    if (!res.matchedCount) {
      return NextResponse.json({ error: '记录不存在或无权限' }, { status: 404 })
    }

    const doc = await col.findOne(filter)
    if (!doc) {
      return NextResponse.json({ error: '记录不存在或已被删除' }, { status: 404 })
    }

    const item = {
      id: doc.id || (doc._id ? String(doc._id) : undefined),
      user_id: doc.user_id,
      script_id: doc.script_id,
      image_url: doc.image_url,
      prompt: doc.prompt,
      video_url: doc.video_url,
      status: doc.status,
      shot_number: doc.shot_number,
      created_at: typeof doc.created_at === 'string' ? doc.created_at : new Date(doc.created_at).toISOString()
    }

    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('PATCH /api/generated-videos failed', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
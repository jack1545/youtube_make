import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/reference-videos?user_id=...&limit=10&before=ISO8601&script_id=...
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before')
    const scriptId = url.searchParams.get('script_id')
    const limit = Math.max(1, Math.min(Number(limitStr) || 10, 50))

    if (!userId) {
      return NextResponse.json({ error: '缺少 user_id 参数' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_videos')
    const filter: any = { user_id: userId }
    if (scriptId) filter.script_id = scriptId
    if (before) filter.created_at = { $lt: before }

    const docs = await coll
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()

    const items = (docs || []).map((d: any) => ({
      id: d.id || (d._id ? String(d._id) : undefined),
      user_id: d.user_id,
      url: d.url,
      label: d.label ?? null,
      script_id: d.script_id ?? null,
      created_at: typeof d.created_at === 'string' ? d.created_at : new Date(d.created_at).toISOString()
    }))

    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('API:get reference_videos exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// POST /api/reference-videos
// body: { url: string, label?: string, user_id: string, script_id?: string }
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { url, label, user_id, script_id } = payload as { url?: string; label?: string; user_id?: string; script_id?: string }
    if (!url || typeof url !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 url 或 user_id' }, { status: 400 })
    }

    // 简单校验：只允许 http/https，并且需包含 youtube 相关域名或 youtu.be
    const isHttp = /^https?:\/\//i.test(url)
    const isYouTube = /youtube\.com|youtu\.be/i.test(url)
    if (!isHttp || !isYouTube) {
      return NextResponse.json({ error: '仅支持 YouTube http/https 链接' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_videos')
    const nowIso = new Date().toISOString()
    const doc: any = { user_id, url, label: label ?? null, script_id: script_id ?? null, created_at: nowIso }

    const result = await coll.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    const item = { id, user_id, url, label: label ?? null, script_id: script_id ?? null, created_at: nowIso }
    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:insert reference_videos exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// PATCH /api/reference-videos
// body: { id: string, label: string, user_id: string }
export async function PATCH(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { id, label, user_id } = payload as { id?: string; label?: string; user_id?: string }
    if (!id || typeof id !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 id 或 user_id' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_videos')
    const { ObjectId } = await import('mongodb')

    const candidates: any[] = []
    if (ObjectId.isValid(id)) candidates.push({ _id: new ObjectId(id), user_id })
    candidates.push({ id, user_id })

    const doc = await coll.findOne({ $or: candidates as any })
    if (!doc) {
      return NextResponse.json({ error: '参考视频不存在或不属于该用户' }, { status: 404 })
    }

    await coll.updateOne({ _id: doc._id }, { $set: { label: label ?? null } })
    const updated = await coll.findOne({ _id: doc._id })
    const item = {
      id: updated?.id || String(updated?._id),
      user_id: updated?.user_id,
      url: updated?.url,
      label: updated?.label ?? null,
      script_id: updated?.script_id ?? null,
      created_at: typeof updated?.created_at === 'string' ? updated?.created_at : new Date(updated?.created_at).toISOString()
    }

    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:update reference_videos exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// DELETE /api/reference-videos
// body: { id: string, user_id: string }
export async function DELETE(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { id, user_id } = payload as { id?: string; user_id?: string }
    if (!id || typeof id !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 id 或 user_id' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_videos')
    const { ObjectId } = await import('mongodb')

    const candidates: any[] = []
    if (ObjectId.isValid(id)) candidates.push({ _id: new ObjectId(id), user_id })
    candidates.push({ id, user_id })

    const doc = await coll.findOne({ $or: candidates as any })
    if (!doc) {
      return NextResponse.json({ error: '参考视频不存在或不属于该用户' }, { status: 404 })
    }

    await coll.deleteOne({ _id: doc._id })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('API:delete reference_videos exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}
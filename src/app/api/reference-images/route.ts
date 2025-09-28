import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/reference-images?user_id=...&limit=10&before=ISO8601
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before') // created_at 游标
    const limit = Math.max(1, Math.min(Number(limitStr) || 10, 50))

    if (!userId) {
      return NextResponse.json({ error: '缺少 user_id 参数' }, { status: 400 })
    }

    // 仅使用 MongoDB
    const db = await getDb()
    const coll = db.collection('reference_images')
    const filter: any = { user_id: userId }
    if (before) {
      filter.created_at = { $lt: before }
    }
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
      created_at: typeof d.created_at === 'string' ? d.created_at : new Date(d.created_at).toISOString()
    }))

    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('API:get reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// POST /api/reference-images
// body: { url: string, label?: string, user_id: string }
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { url, label, user_id } = payload as { url?: string; label?: string; user_id?: string }
    if (!url || typeof url !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 url 或 user_id' }, { status: 400 })
    }

    // 仅写入 MongoDB，支持公开图片 URL 或本地 data:image Data URL
    const isHttp = /^https?:\/\//i.test(url)
    const isDataImage = /^data:image\//i.test(url)
    if (!isHttp && !isDataImage) {
      return NextResponse.json({ error: '仅支持 http/https 或 data:image 图片链接' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_images')
    const nowIso = new Date().toISOString()
    const doc: any = { user_id, url, label: label ?? null, created_at: nowIso }

    // 若已有唯一 id 字段，使用；否则让 Mongo 生成 _id
    const result = await coll.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    const item = { id, user_id, url, label: label ?? null, created_at: nowIso }
    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:insert reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// PATCH /api/reference-images
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
    const coll = db.collection('reference_images')

    // 支持通过 _id 或 id 查询
    const filter = [{ _id: new (await import('mongodb')).ObjectId(id), user_id }, { id, user_id }]
    const doc = await coll.findOne({ $or: filter as any })
    if (!doc) {
      return NextResponse.json({ error: '参考图不存在或不属于该用户' }, { status: 404 })
    }

    await coll.updateOne({ _id: doc._id }, { $set: { label: label ?? null } })
    const updated = await coll.findOne({ _id: doc._id })
    const item = {
      id: updated?.id || String(updated?._id),
      user_id: updated?.user_id,
      url: updated?.url,
      label: updated?.label ?? null,
      created_at: typeof updated?.created_at === 'string' ? updated?.created_at : new Date(updated?.created_at).toISOString()
    }

    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:update reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/reference-images?user_id=...&limit=10&before=ISO8601&label=xxx
export async function GET(req: Request) {
  const ck = cookies().get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before') // created_at 游标
    const labelParam = url.searchParams.get('label') // 目录名；'__none__' 表示未归类
    const limit = Math.max(1, Math.min(Number(limitStr) || 10, 50))

    if (!userId) {
      return NextResponse.json({ error: '缺少 user_id 参数' }, { status: 400 })
    }

    // 仅使用 MongoDB
    const db = await getDb()
    const coll = db.collection('reference_images')

    // 构造支持多标签的过滤：
    // - 指定 label 时，labels 数组包含或旧字段 label 等于该值
    // - '__none__' 时，labels 为空或不存在，且旧字段 label 为空或不存在
    const baseFilter: any = { user_id: userId }
    if (before) baseFilter.created_at = { $lt: before }

    let filter: any = baseFilter
    if (labelParam) {
      if (labelParam === '__none__') {
        filter = {
          ...baseFilter,
          $and: [
            { $or: [
              { labels: { $exists: false } },
              { $expr: { $eq: [ { $size: { $ifNull: [ '$labels', [] ] } }, 0 ] } }
            ] },
            { $or: [ { label: null }, { label: { $exists: false } } ] }
          ]
        }
      } else {
        filter = { ...baseFilter, $or: [ { labels: labelParam }, { label: labelParam } ] }
      }
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
      labels: Array.isArray(d.labels) ? d.labels : undefined,
      created_at: typeof d.created_at === 'string' ? d.created_at : new Date(d.created_at).toISOString()
    }))

    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('API:get reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// POST /api/reference-images
// body: { url: string, label?: string, labels?: string[], user_id: string }
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

    const { url, label, labels, user_id } = payload as { url?: string; label?: string; labels?: string[]; user_id?: string }
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
    const normalizedLabels = Array.isArray(labels)
      ? labels.filter(l => typeof l === 'string' && l.trim()).map(l => l.trim())
      : (typeof label === 'string' && label.trim() ? [label.trim()] : [])
    const doc: any = { user_id, url, label: (typeof label === 'string' ? label.trim() : null), labels: normalizedLabels, created_at: nowIso }

    // 若已有唯一 id 字段，使用；否则让 Mongo 生成 _id
    const result = await coll.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    const item = { id, user_id, url, label: (typeof label === 'string' ? label.trim() : null), labels: normalizedLabels, created_at: nowIso }
    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:insert reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// PATCH /api/reference-images
// body: { id: string, label?: string | null, user_id: string, op?: 'add'|'remove' }
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

    const { id, label, user_id, op } = payload as { id?: string; label?: string | null; user_id?: string; op?: string }
    if (!id || typeof id !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 id 或 user_id' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_images')

    // 支持通过 _id 或 id 查询，且在构造 ObjectId 前先校验合法性
    const { ObjectId } = await import('mongodb')
    const candidates: any[] = []
    if (ObjectId.isValid(id)) {
      candidates.push({ _id: new ObjectId(id), user_id })
    }
    candidates.push({ id, user_id })
    const doc = await coll.findOne({ $or: candidates as any })
    if (!doc) {
      return NextResponse.json({ error: '参考图不存在或不属于该用户' }, { status: 404 })
    }

    // 根据 op 决定更新逻辑：
    // - op='add'：向 labels 添加（去重），不改动旧 label 字段
    // - op='remove'：从 labels 移除，不改动旧 label 字段
    // - 未指定 op：兼容旧逻辑，设置单一 label，并同时同步 labels
    let update: any = {}
    const trimmed = typeof label === 'string' ? label.trim() : null
    if (op === 'add') {
      if (!trimmed) return NextResponse.json({ error: 'add 操作需要非空 label' }, { status: 400 })
      update = { $addToSet: { labels: trimmed } }
    } else if (op === 'remove') {
      if (!trimmed) return NextResponse.json({ error: 'remove 操作需要非空 label' }, { status: 400 })
      update = { $pull: { labels: trimmed } }
    } else {
      // 旧逻辑：设为未归类或单一目录
      if (trimmed === null) {
        update = { $set: { label: null, labels: [] } }
      } else {
        update = { $set: { label: trimmed }, $addToSet: { labels: trimmed } }
      }
    }

    await coll.updateOne({ _id: doc._id }, update)
    const updated = await coll.findOne({ _id: doc._id })
    const item = {
      id: updated?.id || String(updated?._id),
      user_id: updated?.user_id,
      url: updated?.url,
      label: updated?.label ?? null,
      labels: Array.isArray(updated?.labels) ? updated?.labels : undefined,
      created_at: typeof updated?.created_at === 'string' ? updated?.created_at : new Date(updated?.created_at).toISOString()
    }

    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:update reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// DELETE /api/reference-images
// body: { id: string, user_id: string }
export async function DELETE(req: Request) {
  const ck = cookies().get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
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
    const coll = db.collection('reference_images')

    // 支持通过 _id 或 id 查询并校验归属
    const { ObjectId } = await import('mongodb')
    const candidates: any[] = []
    if (ObjectId.isValid(id)) {
      candidates.push({ _id: new ObjectId(id), user_id })
    }
    candidates.push({ id, user_id })

    const doc = await coll.findOne({ $or: candidates as any })
    if (!doc) {
      return NextResponse.json({ error: '参考图不存在或不属于该用户' }, { status: 404 })
    }

    await coll.deleteOne({ _id: doc._id })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('API:delete reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}
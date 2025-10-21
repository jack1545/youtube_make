import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { id, user_id, url } = payload as { id?: string; user_id?: string; url?: string }
    if (!id || !user_id || !url || typeof id !== 'string' || typeof user_id !== 'string' || typeof url !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 id、user_id 或 url' }, { status: 400 })
    }

    const isHttp = /^https?:\/\//i.test(url)
    const isDataImage = /^data:image\//i.test(url)
    if (!isHttp && !isDataImage) {
      return NextResponse.json({ error: '仅支持 http/https 或 data:image 图片链接' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_images')

    const { ObjectId } = await import('mongodb')
    const candidates: any[] = []
    if (ObjectId.isValid(id)) candidates.push({ _id: new ObjectId(id), user_id })
    candidates.push({ id, user_id })

    const doc = await coll.findOne({ $or: candidates as any })
    if (!doc) {
      return NextResponse.json({ error: '参考图不存在或归属不匹配' }, { status: 404 })
    }

    await coll.updateOne({ _id: doc._id }, { $set: { url } })
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
    console.error('API:/api/reference-images/update-url error', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}
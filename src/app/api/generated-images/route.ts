import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/generated-images?script_id=...
export async function GET(req: Request) {
  const ck = cookies().get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const url = new URL(req.url)
    const scriptId = url.searchParams.get('script_id')
    if (!scriptId) {
      return NextResponse.json({ error: '缺少 script_id 参数' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('generated_images')
    const scriptsCol = db.collection('scripts')
    const { ObjectId } = await import('mongodb')
    const scriptDoc = await scriptsCol.findOne(
      ObjectId.isValid(scriptId)
        ? { $or: [{ _id: new ObjectId(scriptId) }, { id: scriptId }] }
        : { id: scriptId }
    )
    const idsToMatch = Array.from(
      new Set([
        scriptId,
        scriptDoc?.id as string | undefined,
        scriptDoc?._id ? String(scriptDoc._id) : undefined
      ].filter(Boolean) as string[])
    )
    const filter = idsToMatch.length > 1 ? { $or: idsToMatch.map(sid => ({ script_id: sid })) } : { script_id: scriptId }

    const docs = await coll
      .find(filter)
      .sort({ shot_number: 1, created_at: 1 })
      .toArray()

    const items = (docs || []).map((d: any) => ({
      id: d.id || (d._id ? String(d._id) : undefined),
      script_id: d.script_id,
      prompt: d.prompt,
      image_url: d.image_url,
      status: d.status ?? 'completed',
      shot_number: d.shot_number,
      created_at: typeof d.created_at === 'string' ? d.created_at : new Date(d.created_at).toISOString()
    }))

    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('API:get generated_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// POST /api/generated-images
// body: { script_id: string, prompt: string, image_url: string, shot_number?: number, status?: string }
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

    const { script_id, prompt, image_url, shot_number, status } = payload as {
      script_id?: string
      prompt?: string
      image_url?: string
      shot_number?: number
      status?: string
    }

    if (!script_id || typeof script_id !== 'string' || !prompt || typeof prompt !== 'string' || !image_url || typeof image_url !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 script_id/prompt/image_url' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    const db = await getDb()
    const coll = db.collection('generated_images')
    // 避免某些环境在 generated_images 上的 unique 索引 id_1 因 id 为 null 导致重复键错误
    const uniqueId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${script_id}-${Date.now()}`
    const doc: any = {
      id: uniqueId,
      script_id,
      prompt,
      image_url,
      status: typeof status === 'string' ? status : 'completed',
      shot_number: typeof shot_number === 'number' ? shot_number : undefined,
      created_at: nowIso
    }

    const result = await coll.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    const item = {
      id,
      script_id,
      prompt,
      image_url,
      status: doc.status,
      shot_number: doc.shot_number,
      created_at: nowIso
    }
    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:insert generated_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// PATCH /api/generated-images
// body: { id: string, shot_number?: number }
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

    const { id, shot_number } = payload as { id?: string; shot_number?: number }
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 id' }, { status: 400 })
    }

    const update: any = {}
    if (typeof shot_number === 'number') update.shot_number = shot_number
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('generated_images')
    const { ObjectId } = await import('mongodb')

    // 支持通过 _id 或 id 更新
    let filter: any = { id }
    if (ObjectId.isValid(id)) {
      filter = { $or: [{ _id: new ObjectId(id) }, { id }] }
    }

    const res = await coll.updateOne(filter, { $set: update })
    if (!res.matchedCount) {
      return NextResponse.json({ error: '记录不存在或已被删除' }, { status: 404 })
    }

    const doc = await coll.findOne(filter)
    if (!doc) {
      return NextResponse.json({ error: '记录不存在或已被删除' }, { status: 404 })
    }

    const item = {
      id: doc.id || (doc._id ? String(doc._id) : undefined),
      script_id: doc.script_id,
      prompt: doc.prompt,
      image_url: doc.image_url,
      status: doc.status ?? 'completed',
      shot_number: doc.shot_number,
      created_at: typeof doc.created_at === 'string' ? doc.created_at : new Date(doc.created_at).toISOString()
    }

    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:update generated_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}
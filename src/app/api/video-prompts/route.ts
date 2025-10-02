import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'
import { getCurrentUser } from '@/lib/auth'

// GET /api/video-prompts?script_id=... -> list saved prompts for a script
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const scriptId = url.searchParams.get('script_id') || undefined

    const db = await getDb()
    const col = db.collection('video_prompts')

    const query: Record<string, unknown> = {}
    if (scriptId) query.script_id = scriptId

    const items = await col
      .find(query, { sort: { shot_number: 1, created_at: -1 } })
      .toArray()

    const mapped = items.map((doc: any) => ({
      id: doc._id ? String(doc._id) : (doc.id || undefined),
      user_id: doc.user_id,
      script_id: doc.script_id,
      shot_number: doc.shot_number,
      text: doc.text,
      created_at: typeof doc.created_at === 'string' ? doc.created_at : new Date(doc.created_at).toISOString()
    }))

    return NextResponse.json({ items: mapped })
  } catch (err: any) {
    console.error('GET /api/video-prompts failed', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

// POST /api/video-prompts
// body: { script_id: string, prompts: Array<{ shot_number: number; text: string }> }
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { script_id, prompts } = payload as {
      script_id?: string
      prompts?: Array<{ shot_number?: number; text?: string }>
    }

    if (!script_id || typeof script_id !== 'string') {
      return NextResponse.json({ error: '缺少 script_id' }, { status: 400 })
    }
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return NextResponse.json({ error: '缺少 prompts 列表' }, { status: 400 })
    }

    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('video_prompts')

    // ensure index for upsert performance
    try {
      await col.createIndex({ script_id: 1, shot_number: 1 })
    } catch {}

    const nowIso = new Date().toISOString()
    const ops = prompts
      .filter(p => typeof p.shot_number === 'number' && typeof p.text === 'string' && p.text!.trim().length > 0)
      .map(p => ({
        updateOne: {
          filter: { script_id, shot_number: p.shot_number },
          update: {
            $set: {
              user_id: user.id,
              script_id,
              shot_number: p.shot_number,
              text: String(p.text),
              created_at: nowIso
            }
          },
          upsert: true
        }
      }))

    if (!ops.length) {
      return NextResponse.json({ error: '无有效 prompts 数据' }, { status: 400 })
    }

    const result = await col.bulkWrite(ops, { ordered: false })
    return NextResponse.json({ ok: true, upserted: result.upsertedCount, modified: result.modifiedCount })
  } catch (err: any) {
    console.error('POST /api/video-prompts failed', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
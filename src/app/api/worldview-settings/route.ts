import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const name = url.searchParams.get('name')
    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('worldview_settings')

    if (name) {
      const doc = await col.findOne({ user_id: user.id, name })
      if (!doc) return NextResponse.json({ item: null })
      const item = {
        id: doc._id ? String(doc._id) : (doc.id || undefined),
        user_id: doc.user_id,
        name: doc.name,
        core: doc.core || '',
        elements: doc.elements || '',
        references: doc.references || '',
        updated_at: typeof doc.updated_at === 'string' ? doc.updated_at : new Date(doc.updated_at || Date.now()).toISOString()
      }
      return NextResponse.json({ item })
    }

    const docs = await col.find({ user_id: user.id }).sort({ updated_at: -1 }).toArray()
    const items = (docs || []).map((d: any) => ({
      id: d._id ? String(d._id) : (d.id || undefined),
      user_id: d.user_id,
      name: d.name,
      core: d.core || '',
      elements: d.elements || '',
      references: d.references || '',
      updated_at: typeof d.updated_at === 'string' ? d.updated_at : new Date(d.updated_at || Date.now()).toISOString()
    }))
    return NextResponse.json({ items })
  } catch (error: any) {
    console.error('GET /api/worldview-settings failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const name: string = String(body?.name || '')
    const core: string = String(body?.core || '')
    const elements: string = String(body?.elements || '')
    const references: string = String(body?.references || '')
    if (!name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('worldview_settings')
    const now = new Date().toISOString()
    await col.updateOne(
      { user_id: user.id, name },
      { $set: { user_id: user.id, name, core, elements, references, updated_at: now } },
      { upsert: true }
    )
    const doc = await col.findOne({ user_id: user.id, name })
    const item = {
      id: doc?._id ? String(doc._id) : (doc?.id || undefined),
      user_id: user.id,
      name,
      core,
      elements,
      references,
      updated_at: now
    }
    return NextResponse.json({ item })
  } catch (error: any) {
    console.error('POST /api/worldview-settings failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const name: string = String(body?.name || '')
    const oldName: string = String(body?.old_name || '')
    const core: string | undefined = body?.core
    const elements: string | undefined = body?.elements
    const references: string | undefined = body?.references
    if (!name.trim() && !oldName.trim()) {
      return NextResponse.json({ error: 'name or old_name is required' }, { status: 400 })
    }
    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('worldview_settings')
    const now = new Date().toISOString()

    const filter: any = { user_id: user.id }
    if (oldName.trim()) filter.name = oldName
    else filter.name = name

    const update: any = { $set: { updated_at: now } }
    if (name.trim()) update.$set.name = name
    if (typeof core === 'string') update.$set.core = core
    if (typeof elements === 'string') update.$set.elements = elements
    if (typeof references === 'string') update.$set.references = references

    const result = await col.updateOne(filter, update)
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'setting not found' }, { status: 404 })
    }

    const doc = await col.findOne({ user_id: user.id, name })
    return NextResponse.json({ item: doc })
  } catch (error: any) {
    console.error('PATCH /api/worldview-settings failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const name: string = String(body?.name || '')
    if (!name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('worldview_settings')
    await col.deleteOne({ user_id: user.id, name })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('DELETE /api/worldview-settings failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
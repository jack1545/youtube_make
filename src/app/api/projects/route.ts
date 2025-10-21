import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/mongodb'
import { getCurrentUser } from '@/lib/auth'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const ck = (await cookies()).get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('projects')
    const docs = await col
      .find({})
      .sort({ created_at: -1 })
      .toArray()

    const items = (docs || []).map((d: any) => ({
      id: d._id ? String(d._id) : (d.id || undefined),
      legacy_id: (typeof d.legacy_id === 'string' ? d.legacy_id : (d.id || undefined)),
      name: d.name,
      description: d.description,
      created_at: typeof d.created_at === 'string' ? d.created_at : new Date(d.created_at).toISOString(),
      user_id: d.user_id
    }))

    console.log('GET /api/projects returning ids:', items.map(i => i.id), 'legacy_ids:', items.map(i => i.legacy_id).filter(Boolean))
    return NextResponse.json({ items })
  } catch (error: any) {
    console.error('GET /api/projects failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

// POST /api/projects
// body: { name: string, description?: string }
export async function POST(req: Request) {
  const ck = (await cookies()).get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { name, description } = payload as { name?: string; description?: string }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 })
    }

    const user = getCurrentUser()
    const nowIso = new Date().toISOString()

    const db = await getDb()
    const col = db.collection('projects')
    const legacyId = randomUUID()
    const doc: any = {
      id: legacyId,
      legacy_id: legacyId,
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      user_id: user.id,
      created_at: nowIso
    }

    console.log('POST /api/projects creating doc:', { id: doc.id, name: doc.name })

    const result = await col.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    console.log('POST /api/projects inserted _id:', id)

    const item = {
      id,
      name: doc.name,
      description: doc.description,
      user_id: doc.user_id,
      created_at: nowIso
    }

    return NextResponse.json({ item })
  } catch (error: any) {
    console.error('POST /api/projects failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

// PATCH /api/projects
// body: { id: string, name?: string, description?: string }
export async function PATCH(req: Request) {
  const ck = (await cookies()).get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { id, name, description } = payload as { id?: string; name?: string; description?: string }
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    console.log('PATCH /api/projects incoming id:', id)

    const db = await getDb()
    const user = getCurrentUser()
    const col = db.collection('projects')

    const update: any = {}
    if (typeof name === 'string') update.name = name.trim()
    if (typeof description === 'string') update.description = description
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Guard ObjectId creation to avoid throwing on non-24hex ids
    const mongo = await import('mongodb')
    const ObjectId = mongo.ObjectId
    const orConds: any[] = [{ id }]
    if (ObjectId.isValid(id)) {
      orConds.push({ _id: new ObjectId(id) })
    }
    const filter = ObjectId.isValid(id) ? { $or: orConds } : { id }
    console.log('PATCH /api/projects filter:', JSON.stringify(filter))

    const result = await col.findOneAndUpdate(
      filter,
      { $set: { ...update } },
      { returnDocument: 'after' }
    )

    const doc: any = result?.value
    console.log('PATCH /api/projects findOneAndUpdate result value exists:', Boolean(doc))

    if (!doc) {
      // Robust fallback: perform upsert via updateOne, then fetch the document to avoid null value edge cases
      const nowIso = new Date().toISOString()
      const upRes = await col.updateOne(
        filter,
        { $set: { ...update }, $setOnInsert: { id, created_at: nowIso } },
        { upsert: true }
      )
      console.log('PATCH /api/projects updateOne upsert result:', { matched: upRes.matchedCount, modified: upRes.modifiedCount, upsertedId: (upRes as any).upsertedId })
      const healed = await col.findOne(filter)
      console.log('PATCH /api/projects healed doc found:', Boolean(healed))
      if (healed) {
        const item = {
          id: (healed as any).id || ((healed as any)._id ? String((healed as any)._id) : undefined),
          name: (healed as any).name,
          description: (healed as any).description,
          user_id: (healed as any).user_id,
          created_at: typeof (healed as any).created_at === 'string' ? (healed as any).created_at : new Date((healed as any).created_at).toISOString()
        }
        return NextResponse.json({ item })
      }

      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const item = {
      id: doc.id || (doc._id ? String(doc._id) : undefined),
      name: doc.name,
      description: doc.description,
      user_id: doc.user_id,
      created_at: typeof doc.created_at === 'string' ? doc.created_at : new Date(doc.created_at).toISOString()
    }

    return NextResponse.json({ item })
  } catch (error: any) {
    console.error('PATCH /api/projects failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

// DELETE /api/projects
// body: { id: string }
export async function DELETE(req: Request) {
  const ck = (await cookies()).get('cw_session')?.value || ''
  if (!/role=admin/.test(ck)) {
    return NextResponse.json({ error: 'Guest mode: database access disabled' }, { status: 403 })
  }
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { id } = payload as { id?: string }
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    const db = await getDb()
    const user = getCurrentUser()

    // Locate project with ownership constraint
    const projects = db.collection('projects')
    const mongo = await import('mongodb')
    const ObjectId = mongo.ObjectId
    const idOrConds: any[] = [{ id }]
    if (ObjectId.isValid(id)) {
      idOrConds.push({ _id: new ObjectId(id) })
    }
    const projectDoc: any = await projects.findOne({
      $or: idOrConds
    })
    if (!projectDoc) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Determine acceptable project_id values stored in scripts
    const projectIdChoices = [id]
    if (projectDoc._id) projectIdChoices.push(String(projectDoc._id))

    const scriptsCol = db.collection('scripts')
    const scripts = await scriptsCol.find({ project_id: { $in: projectIdChoices } }).toArray()
    const scriptIds: string[] = (scripts || []).map((s: any) => s.id || (s._id ? String(s._id) : '')).filter(Boolean)

    // Cascade delete generated_images and generated_videos
    const imagesCol = db.collection('generated_images')
    const videosCol = db.collection('generated_videos')

    const imgRes = scriptIds.length > 0
      ? await imagesCol.deleteMany({ script_id: { $in: scriptIds } })
      : { deletedCount: 0 }

    const vidRes = scriptIds.length > 0
      ? await videosCol.deleteMany({ script_id: { $in: scriptIds } })
      : { deletedCount: 0 }

    // Delete scripts for this project
    const scrRes = await scriptsCol.deleteMany({ project_id: { $in: projectIdChoices } })

    // Finally delete the project
    // Finally delete the project using ownership-or-missing filter
    const projRes = await projects.deleteOne({
      $or: idOrConds
    })

    return NextResponse.json({
      ok: true,
      deleted: {
        images: (imgRes as any).deletedCount ?? 0,
        videos: (vidRes as any).deletedCount ?? 0,
        scripts: (scrRes as any).deletedCount ?? 0,
        project: (projRes as any).deletedCount ?? 0
      }
    })
  } catch (error: any) {
    console.error('DELETE /api/projects failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
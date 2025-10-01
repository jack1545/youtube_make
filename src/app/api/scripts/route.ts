import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'
import { randomUUID } from 'crypto'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('project_id')
    const legacyProjectIdParam = searchParams.get('legacy_project_id')
    if (!projectId && !legacyProjectIdParam) {
      return NextResponse.json({ error: 'project_id or legacy_project_id is required' }, { status: 400 })
    }
    const db = await getDb()
    const col = db.collection('scripts')

    // 兼容旧数据与双路径查询：支持通过项目的 Mongo _id 或 legacy UUID 进行过滤，同时匹配脚本中的 project_id 与 legacy_project_id 字段
    const { ObjectId } = await import('mongodb')
    const projCol = db.collection('projects')
    let legacyProjectUuid: string | undefined
    let mongoProjectIdStr: string | undefined

    if (projectId) {
      const projDoc = await projCol.findOne(
        ObjectId.isValid(projectId)
          ? { $or: [{ _id: new ObjectId(projectId) }, { id: projectId }] }
          : { id: projectId }
      )
      if (projDoc) {
        legacyProjectUuid = typeof (projDoc as any).id === 'string' ? (projDoc as any).id : undefined
        mongoProjectIdStr = (projDoc as any)._id ? String((projDoc as any)._id) : undefined
      }
    }

    if (legacyProjectIdParam) {
      const projDoc2 = await projCol.findOne({ id: legacyProjectIdParam })
      if (projDoc2) {
        legacyProjectUuid = legacyProjectUuid || (typeof (projDoc2 as any).id === 'string' ? (projDoc2 as any).id : undefined)
        mongoProjectIdStr = mongoProjectIdStr || ((projDoc2 as any)._id ? String((projDoc2 as any)._id) : undefined)
      } else {
        // 若找不到项目文档，也允许直接使用传入的 legacyProjectIdParam 进行 legacy_project_id 字段匹配
      }
    }

    const projectIdsToMatch = Array.from(
      new Set([
        projectId,
        legacyProjectUuid,
        mongoProjectIdStr
      ].filter(Boolean) as string[])
    )

    const filterOrs: any[] = projectIdsToMatch.length
      ? projectIdsToMatch.map(pid => ({ project_id: pid }))
      : []

    if (legacyProjectIdParam) {
      filterOrs.push({ legacy_project_id: legacyProjectIdParam })
    }

    const filter = filterOrs.length > 1
      ? { $or: filterOrs }
      : (filterOrs[0] || (projectId ? { project_id: projectId } : { legacy_project_id: legacyProjectIdParam! }))

    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .toArray()

    const items = (docs || []).map((d: any) => ({
      id: d._id ? String(d._id) : (d.id || undefined),
      project_id: d.project_id,
      legacy_project_id: d.legacy_project_id,
      content: d.content,
      status: d.status,
      created_at: typeof d.created_at === 'string' ? d.created_at : new Date(d.created_at).toISOString(),
      raw_text: d.raw_text
    }))

    console.log('GET /api/scripts returning ids:', items.map(i => i.id))
    return NextResponse.json({ items })
  } catch (error: any) {
    console.error('GET /api/scripts failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

// POST /api/scripts
// body: { project_id: string, content: any[], status?: 'draft'|'editing'|'completed', raw_text?: string }
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { project_id, content, status, raw_text } = payload as { project_id?: string; content?: any[]; status?: string; raw_text?: string }
    if (!project_id || typeof project_id !== 'string') {
      return NextResponse.json({ error: 'Missing required field: project_id' }, { status: 400 })
    }
    if (!Array.isArray(content)) {
      return NextResponse.json({ error: 'Missing required field: content (array)' }, { status: 400 })
    }

    const db = await getDb()
    const col = db.collection('scripts')
    // Normalize project_id to Mongo _id while keeping legacy UUID as reference
    const projectsCol = db.collection('projects')
    const { ObjectId } = await import('mongodb')
    const projDoc: any = await projectsCol.findOne(
      ObjectId.isValid(project_id)
        ? { $or: [{ _id: new ObjectId(project_id) }, { id: project_id }] }
        : { id: project_id }
    )
    if (!projDoc) {
      return NextResponse.json({ error: 'Invalid project_id: project not found' }, { status: 400 })
    }
    const normalizedProjectId: string = projDoc._id ? String(projDoc._id) : project_id
    const legacyProjectId: string | undefined = typeof projDoc.id === 'string' ? projDoc.id : undefined

    const nowIso = new Date().toISOString()
    const doc: any = {
      id: randomUUID(),
      project_id: normalizedProjectId,
      legacy_project_id: legacyProjectId,
      content,
      status: (status === 'editing' || status === 'completed') ? status : 'draft',
      raw_text: typeof raw_text === 'string' ? raw_text : undefined,
      created_at: nowIso
    }

    console.log('POST /api/scripts creating doc:', { id: doc.id, project_id: doc.project_id, legacy_project_id: doc.legacy_project_id })

    const result = await col.insertOne(doc)
    const id = result.insertedId ? String(result.insertedId) : doc.id
    console.log('POST /api/scripts inserted _id:', id)

    const item = { id: id, project_id: doc.project_id, content, status: doc.status, created_at: nowIso, raw_text: doc.raw_text }
    return NextResponse.json({ item })
  } catch (error: any) {
    console.error('POST /api/scripts failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

// PATCH /api/scripts
// body: { id: string, content?: any[], status?: 'draft'|'editing'|'completed', raw_text?: string }
export async function PATCH(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { id, content, status, raw_text } = payload as { id?: string; content?: any[]; status?: string; raw_text?: string }
    console.log('PATCH /api/scripts payload:', { id })
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    const db = await getDb()
    const col = db.collection('scripts')

    const update: any = {}
    if (Array.isArray(content)) update.content = content
    if (typeof status === 'string') update.status = status
    if (typeof raw_text === 'string') update.raw_text = raw_text
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // 构造健壮的查询过滤：优先尝试 _id（仅当是合法 24 位十六进制），否则使用自定义 id 字段
    const filters: any[] = [{ id }]
    const { ObjectId } = await import('mongodb')
    const isValidObjectId = ObjectId.isValid(id)
    if (isValidObjectId) {
      filters.push({ _id: new ObjectId(id) })
    }

    const filterObj = isValidObjectId ? { $or: filters } : { id }
    console.log('PATCH /api/scripts filters:', JSON.stringify(filterObj))

    const result = await col.findOneAndUpdate(
      filterObj,
      { $set: update },
      { returnDocument: 'after' }
    )

    let docRes: any = result?.value
    if (!docRes) {
      console.warn('PATCH /api/scripts findOneAndUpdate returned null, attempting fallback updateOne')
      const upRes = await col.updateOne(filterObj, { $set: update }, { upsert: false })
      console.log('PATCH /api/scripts updateOne result:', { matched: upRes.matchedCount, modified: upRes.modifiedCount })
      docRes = await col.findOne(filterObj)
      console.log('PATCH /api/scripts fallback findOne success:', Boolean(docRes))
      if (!docRes) {
        console.warn('PATCH /api/scripts not found for id:', id)
        return NextResponse.json({ error: 'Script not found' }, { status: 404 })
      }
    }

    const item = {
      id: docRes._id ? String(docRes._id) : (docRes.id || undefined),
      project_id: docRes.project_id,
      content: docRes.content,
      status: docRes.status,
      created_at: typeof docRes.created_at === 'string' ? docRes.created_at : new Date(docRes.created_at).toISOString(),
      raw_text: docRes.raw_text
    }

    return NextResponse.json({ item })
  } catch (error: any) {
    console.error('PATCH /api/scripts failed', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
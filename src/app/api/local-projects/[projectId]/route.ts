import { NextRequest } from 'next/server'
import path from 'path'
import fsp from 'fs/promises'
import { getDb } from '@/lib/mongodb'
import { getLocalRootPath, normalizeWindowsPath } from '@/lib/local-settings'

const LOCAL_PROJECTS = 'local_projects'
const LOCAL_ASSETS = 'local_assets'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const body = await req.json().catch(() => ({})) as { newName?: string }
    const newName = (body.newName || '').trim()
    if (!newName) {
      return Response.json({ error: 'newName is required' }, { status: 400 })
    }
    if (/[\\/:*?"<>|]/.test(newName)) {
      return Response.json({ error: '非法项目名，不能包含 \\ / : * ? " < > |' }, { status: 400 })
    }

    const root = await getLocalRootPath()
    const oldPath = path.join(root, projectId)
    const newPath = path.join(root, newName)

    // conflict
    try { await fsp.access(newPath); return Response.json({ error: '目标项目已存在' }, { status: 409 }) } catch {}

    // rename folder
    await fsp.rename(oldPath, newPath)

    const db = await getDb()
    // update project record
    await db.collection(LOCAL_PROJECTS).updateOne(
      { id: projectId },
      { $set: { id: newName, name: newName, full_path: normalizeWindowsPath(newPath), updated_at: new Date() } },
      { upsert: true }
    )

    // update all assets project_id and full_path prefix
    const assets = await db.collection(LOCAL_ASSETS).find({ project_id: projectId }).toArray()
    for (const a of assets) {
      const oldFull = String(a.full_path)
      const rel = path.relative(oldPath, oldFull)
      const updatedFull = normalizeWindowsPath(path.join(newPath, rel))
      const filename = path.basename(updatedFull)
      await db.collection(LOCAL_ASSETS).updateOne(
        { _id: a._id },
        { $set: { project_id: newName, full_path: updatedFull, id: filename, filename } }
      )
    }

    return Response.json({ ok: true, item: { id: newName, name: newName, full_path: normalizeWindowsPath(newPath) } })
  } catch (error: any) {
    console.error('PATCH /api/local-projects/[projectId] rename failed', error)
    return Response.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
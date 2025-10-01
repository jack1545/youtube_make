import { NextRequest } from "next/server"
import { getDb } from "@/lib/mongodb"
import path from "path"
import fs from "fs"
import fsp from "fs/promises"

const LOCAL_ASSETS = "local_assets"

export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || ''
  const { assetId } = await params
  const db = await getDb()
  const filter = projectId ? { project_id: projectId, id: assetId } : { id: assetId }
  const asset = await db.collection(LOCAL_ASSETS).findOne(filter)
  if (!asset) return new Response("Not Found", { status: 404 })

  const filePath = asset.full_path as string
  const ext = path.extname(filePath).toLowerCase()
  const isVideo = [".mp4", ".mov", ".webm", ".mkv"].includes(ext)

  if (isVideo) {
    const stat = fs.statSync(filePath)
    const range = req.headers.get("range")
    const mime = getContentTypeByExt(ext)
    if (!range) {
      return new Response(fs.readFileSync(filePath), {
        headers: {
          "Content-Type": mime,
          "Content-Length": stat.size.toString(),
        },
      })
    }
    const parts = range.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
    const chunkSize = end - start + 1
    const file = fs.createReadStream(filePath, { start, end })
    return new Response(file as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize.toString(),
        "Content-Type": mime,
      },
    })
  }

  // Image or other binary: stream to avoid buffering
  const mime = getContentTypeByExt(ext)
  const stream = fs.createReadStream(filePath)
  return new Response(stream as any, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=3600",
    },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId') || ''
    const { assetId } = await params
    const db = await getDb()

    const oldAsset = await db.collection(LOCAL_ASSETS).findOne({ project_id: projectId, id: assetId })
    if (!oldAsset) {
      return Response.json({ error: 'Asset not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({})) as { newFilename?: string; newName?: string }
    let requested = (body.newFilename || body.newName || '').trim()
    if (!requested) {
      return Response.json({ error: 'newFilename is required' }, { status: 400 })
    }

    // Validate filename (Windows reserved chars)
    if (/[\\/:*?"<>|]/.test(requested)) {
      return Response.json({ error: '非法文件名，不能包含 \\ / : * ? " < > |' }, { status: 400 })
    }

    const oldPath = String(oldAsset.full_path)
    const dir = path.dirname(oldPath)
    const oldExt = path.extname(oldPath)
    // If user provided name without extension, keep original extension
    if (!path.extname(requested)) requested = requested + oldExt

    const newPath = path.join(dir, requested)

    // Check conflict
    try {
      await fsp.access(newPath)
      return Response.json({ error: '目标文件已存在' }, { status: 409 })
    } catch {}

    // Perform rename
    await fsp.rename(oldPath, newPath)

    const updated = {
      ...oldAsset,
      id: requested,
      filename: requested,
      full_path: newPath,
      mtime: new Date(),
      updated_at: new Date(),
    }
    await db.collection(LOCAL_ASSETS).updateOne(
      { project_id: projectId, id: assetId },
      { $set: updated }
    )

    return Response.json({ ok: true, item: updated })
  } catch (error: any) {
    console.error('PATCH /api/local-projects/asset rename failed', error)
    return Response.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

function getContentTypeByExt(ext: string): string {
  switch (ext) {
    case ".png": return "image/png"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".gif": return "image/gif"
    case ".webp": return "image/webp"
    case ".mp4": return "video/mp4"
    case ".mov": return "video/quicktime"
    case ".webm": return "video/webm"
    case ".mkv": return "video/x-matroska"
    default: return "application/octet-stream"
  }
}
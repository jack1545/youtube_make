import { NextResponse } from 'next/server'
import { mkdir, writeFile, readFile, access } from 'fs/promises'
import { constants } from 'fs'

interface BulkItem {
  shotNumber: number
  prompt?: string
  imageUrl: string
}

interface BulkPayload {
  projectSlug: string
  items: BulkItem[]
}

function normalizeWinPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/,'')
}

function getExtFromContentType(ct?: string | null): string {
  if (!ct) return 'jpg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('jpeg')) return 'jpeg'
  if (ct.includes('jpg')) return 'jpg'
  if (ct.includes('webp')) return 'webp'
  return 'jpg'
}

// 提取 action 文本：优先解析 JSON，其次用正则匹配，最后回退为原始文本
function extractActionFromPrompt(raw?: string): string {
  const text = (raw || '').trim()
  if (!text) return ''
  // Try JSON parse
  try {
    const obj = JSON.parse(text)
    const action = obj?.prompt?.subject?.action ?? obj?.subject?.action ?? obj?.action
    if (typeof action === 'string' && action.trim()) {
      return action.trim()
    }
  } catch {}
  // Try JSON-like key with quotes
  const m1 = text.match(/"action"\s*:\s*"([\s\S]*?)"/)
  if (m1 && m1[1]) return m1[1].trim()
  // Try non-quoted line after action: or action：
  const m2 = text.match(/action\s*[:：]\s*([^\n]+)/i)
  if (m2 && m2[1]) return m2[1].trim()
  return text
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as BulkPayload
    const slug = (payload?.projectSlug || 'project').trim()
    const items = Array.isArray(payload?.items) ? payload.items : []

    if (!slug || !items.length) {
      return NextResponse.json({ error: 'Invalid payload: require projectSlug and items' }, { status: 400 })
    }

    // Absolute paths for Windows environment
    const baseDir = `G:/Downloads/doubao_project/${slug}`
    const tasksDir = `F:/2025/youtube/doubao/API_Guide/doubao_video/tasks`
    const storageStatePath = `F:/2025/youtube/doubao/API_Guide/doubao_video/storage_state.json`

    // Ensure directories exist
    await mkdir(baseDir, { recursive: true })
    await mkdir(tasksDir, { recursive: true })

    const shots: { id: number; prompt: string; image_path: string }[] = []

    for (const item of items) {
      const url = item.imageUrl
      const shotNo = Number(item.shotNumber) || 0
      if (!url || !shotNo) continue

      // Fetch image from upstream
      const resp = await fetch(url, { cache: 'no-store' })
      if (!resp.ok || !resp.body) {
        throw new Error(`Upstream image fetch failed: ${resp.status}`)
      }
      const contentType = resp.headers.get('content-type')
      const ext = getExtFromContentType(contentType)

      const filename = `shot_${shotNo}.${ext}`
      const filePath = `${baseDir}/${filename}`

      const arrayBuffer = await resp.arrayBuffer()
      await writeFile(filePath, Buffer.from(arrayBuffer))

      shots.push({
        id: shotNo,
        prompt: (item.prompt || '').trim(),
        image_path: normalizeWinPath(filePath)
      })
    }

    const ts = Date.now()
    const taskJson = {
      doubao_task: [
        {
          task_id: ts,
          project_dir: normalizeWinPath(baseDir),
          shots
        }
      ]
    }

    const taskFile = `${tasksDir}/task_${ts}.json`
    await writeFile(taskFile, JSON.stringify(taskJson, null, 2), 'utf-8')

    // "Update" storage_state.json by rewriting the same content to refresh mtime
    try {
      await access(storageStatePath, constants.F_OK)
      const text = await readFile(storageStatePath, 'utf-8')
      await writeFile(storageStatePath, text, 'utf-8')
    } catch {
      await writeFile(storageStatePath, '{}', 'utf-8')
    }

    return NextResponse.json({
      saved: shots.length,
      project_dir: normalizeWinPath(baseDir),
      task_file: normalizeWinPath(taskFile)
    })
  } catch (error: any) {
    console.error('bulk-save-images error:', error)
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 })
  }
}
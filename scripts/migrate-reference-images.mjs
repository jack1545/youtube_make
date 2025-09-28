// One-time migration script: Convert data:image URLs in reference_images to Supabase Storage public HTTP URLs
// Usage:
//   node scripts/migrate-reference-images.mjs [--limit=100] [--user-id=USER_ID] [--dry-run]
//
// This script loads environment variables from .env.local if not present.

import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf-8')
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}
loadEnvLocal()

const args = process.argv.slice(2)
const argMap = Object.fromEntries(args.map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
}))
const pageSize = Math.max(1, Math.min(Number(argMap.limit) || 100, 500))
const filterUserId = argMap['user-id'] || argMap.userId || null
// Fix boolean parsing: allow --dry-run (no value) and --dry-run=false
const dryRun = (() => {
  if (argMap['dry-run'] === undefined && argMap.dryRun === undefined) return false
  const val = argMap['dry-run'] ?? argMap.dryRun
  if (val === 'true' || val === '1' || val === '' || val === undefined) return true
  if (val === 'false' || val === '0') return false
  return Boolean(val)
})()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Supabase 未配置：请在 .env.local 或环境变量中设置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(supabaseUrl, serviceRoleKey)

async function ensureBucketPublic(bucketName) {
  try {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
    if (listErr) {
      console.warn('列出存储桶失败，尝试直接创建：', listErr?.message || listErr)
    }
    const exists = Array.isArray(buckets) && buckets.some(b => b.name === bucketName)
    if (!exists) {
      const { error: createErr } = await supabase.storage.createBucket(bucketName, { public: true })
      if (createErr && !String(createErr?.message || '').toLowerCase().includes('already exists')) {
        console.warn('创建存储桶失败：', createErr?.message || createErr)
      } else {
        console.log(`存储桶 ${bucketName} 已创建或已存在。`)
      }
    } else {
      // 尝试设置为 public（如果已是 public，后续请求会忽略）
      try {
        await supabase.storage.updateBucket(bucketName, { public: true })
      } catch (e) {
        // 某些项目不支持 updateBucket 或需额外权限，忽略
      }
    }
  } catch (e) {
    console.warn('ensureBucketPublic 异常：', e)
  }
}

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase()
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  return 'bin'
}

function parseDataUrl(dataUrl) {
  if (!dataUrl.startsWith('data:')) throw new Error('Invalid data URL: not start with data:')
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) throw new Error('Invalid data URL: missing comma')
  const meta = dataUrl.slice(5, commaIdx) // after 'data:'
  const payload = dataUrl.slice(commaIdx + 1)
  const isBase64 = /;base64/i.test(meta)
  const mime = (meta.match(/^([^;]+)/)?.[1]) || 'application/octet-stream'
  let bytes
  if (isBase64) {
    const b = Buffer.from(payload.trim(), 'base64')
    bytes = new Uint8Array(b)
  } else {
    // Percent-decoded string; rarely used for images, but handle gracefully
    const decoded = decodeURIComponent(payload.trim())
    bytes = new TextEncoder().encode(decoded)
  }
  const ext = mimeToExt(mime)
  return { mime, bytes, ext }
}

async function countDataUrls() {
  let query = supabase
    .from('reference_images')
    .select('id', { count: 'exact', head: true })
    .like('url', 'data:%')
  if (filterUserId) query = query.eq('user_id', filterUserId)
  const { count, error } = await query
  if (error) {
    console.warn('统计 data:URL 数量失败：', error?.message || error)
    return null
  }
  return count ?? null
}

async function migrateBatchByCursor(cursorIso) {
  let query = supabase
    .from('reference_images')
    .select('id,user_id,url,label,created_at')
    .like('url', 'data:%')
    .order('created_at', { ascending: true })
    .limit(pageSize)
  if (filterUserId) query = query.eq('user_id', filterUserId)
  if (cursorIso) query = query.gt('created_at', cursorIso)
  const { data: rows, error } = await query
  if (error) throw error
  return rows || []
}

async function main() {
  console.log('开始迁移参考图：data:image -> Supabase Storage 公共 URL')
  console.log(`pageSize=${pageSize} filterUserId=${filterUserId ?? 'ALL'} dryRun=${dryRun}`)
  const total = await countDataUrls()
  if (typeof total === 'number') {
    console.log(`待迁移 data:URL 记录数：${total}`)
  }

  await ensureBucketPublic('reference-images')

  let cursor = null
  let batchNum = 0
  let totalMigrated = 0
  let totalErrors = 0
  while (true) {
    const rows = await migrateBatchByCursor(cursor)
    if (!rows || rows.length === 0) break
    batchNum += 1

    const out = []
    for (const row of rows) {
      try {
        if (typeof row.url !== 'string' || !row.url.startsWith('data:')) {
          out.push({ id: row.id, status: 'skip' })
          continue
        }
        const { mime, bytes, ext } = parseDataUrl(row.url)
        const random = Math.random().toString(36).slice(2)
        const filename = `${row.id}-${Date.now()}-${random}.${ext}`
        const pathInBucket = `migrate/${row.user_id}/${filename}`
        if (dryRun) {
          console.log(`[dry-run] 会上传 -> reference-images/${pathInBucket} (${mime}, ${bytes.byteLength} bytes)`) 
          out.push({ id: row.id, status: 'dry-run' })
        } else {
          const { error: uploadErr } = await supabase.storage
            .from('reference-images')
            .upload(pathInBucket, bytes, { contentType: mime, upsert: false })
          if (uploadErr) {
            console.error('上传失败', uploadErr)
            out.push({ id: row.id, status: 'upload-error' })
          } else {
            const { data: publicData } = supabase.storage.from('reference-images').getPublicUrl(pathInBucket)
            const publicUrl = publicData?.publicUrl
            if (!publicUrl) {
              out.push({ id: row.id, status: 'no-public-url' })
            } else {
              const { error: updateErr } = await supabase
                .from('reference_images')
                .update({ url: publicUrl })
                .eq('id', row.id)
                .eq('user_id', row.user_id)
              if (updateErr) {
                console.error('更新数据库失败', updateErr)
                out.push({ id: row.id, status: 'update-error' })
              } else {
                console.log(`✔ 已迁移 id=${row.id} -> ${publicUrl}`)
                out.push({ id: row.id, status: 'migrated' })
                totalMigrated += 1
              }
            }
          }
        }
      } catch (e) {
        console.error('迁移单条记录异常', e)
        out.push({ id: row.id, status: 'exception' })
      } finally {
        cursor = row.created_at // advance cursor
      }
    }

    const errors = out.filter(b => b.status.endsWith('error') || b.status === 'exception').length
    totalErrors += errors
    console.log(`批次#${batchNum} 完成：处理=${rows.length}, 成功=${out.filter(b=>b.status==='migrated').length}, 错误=${errors}`)
    if (rows.length < pageSize) break
  }

  console.log(`迁移完成：成功=${totalMigrated}, 错误=${totalErrors}`)
}

main().catch(err => {
  console.error('迁移脚本异常：', err)
  process.exit(1)
})
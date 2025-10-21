// Batch migrate: Convert data:image URLs in MongoDB reference_images to Cloudflare R2 public URLs
// Usage:
//   node scripts/migrate-reference-images-to-r2.mjs [--limit=100] [--user-id=USER_ID] [--dry-run]
// Env: loads .env.local. Requires MONGODB_URI, MONGODB_DBNAME; and R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (when not dry-run)

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
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
const dryRun = (() => {
  if (argMap['dry-run'] === undefined && argMap.dryRun === undefined) return false
  const val = argMap['dry-run'] ?? argMap.dryRun
  if (val === 'true' || val === '1' || val === '' || val === undefined) return true
  if (val === 'false' || val === '0') return false
  return Boolean(val)
})()

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase()
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  return 'bin'
}

function parseDataUrl(dataUrl) {
  if (!dataUrl.startsWith('data:')) throw new Error('Invalid data URL')
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) throw new Error('Invalid data URL: missing comma')
  const meta = dataUrl.slice(5, commaIdx)
  const payload = dataUrl.slice(commaIdx + 1)
  const isBase64 = /;base64/i.test(meta)
  const mime = (meta.match(/^([^;]+)/)?.[1]) || 'application/octet-stream'
  let buf
  if (isBase64) buf = Buffer.from(payload.trim(), 'base64')
  else buf = Buffer.from(decodeURIComponent(payload.trim()))
  const ext = mimeToExt(mime)
  return { mime, buf, ext }
}

function requiredEnv(name) {
  const v = process.env[name] || ''
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function normalizeEndpoint(ep) {
  return String(ep).replace(/[`]/g, '').trim()
}

function getMongoUri() {
  const uri = process.env.MONGODB_URI || ''
  if (!uri) throw new Error('未配置 MONGODB_URI')
  return uri
}
function getDbName() {
  return process.env.MONGODB_DBNAME || 'creative_workbench'
}

const { MongoClient, ObjectId } = await import('mongodb')
const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

async function connectMongo() {
  const client = new MongoClient(getMongoUri(), { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 })
  await client.connect()
  const db = client.db(getDbName())
  return { client, db }
}

async function main() {
  console.log('开始批量迁移：MongoDB reference_images 的 data:image -> R2 公共 URL')
  console.log(`pageSize=${pageSize} filterUserId=${filterUserId ?? 'ALL'} dryRun=${dryRun}`)

  const { client, db } = await connectMongo()
  const coll = db.collection('reference_images')

  let s3 = null
  let bucket = null
  let endpoint = null
  if (!dryRun) {
    bucket = requiredEnv('R2_BUCKET')
    endpoint = normalizeEndpoint(requiredEnv('R2_ENDPOINT'))
    const accessKeyId = requiredEnv('R2_ACCESS_KEY_ID')
    const secretAccessKey = requiredEnv('R2_SECRET_ACCESS_KEY')
    s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } })
  }

  // 用 created_at 游标分批处理；未设置 created_at 的记录也处理，但建议数据完整
  let cursorIso = null
  let batchNum = 0
  let totalMigrated = 0
  let totalErrors = 0

  try {
    while (true) {
      const filter = { url: { $regex: '^data:image/' } }
      if (filterUserId) filter.user_id = filterUserId
      if (cursorIso) filter.created_at = { $gt: cursorIso }
      const docs = await coll
        .find(filter, { projection: { _id: 1, id: 1, user_id: 1, url: 1, created_at: 1 } })
        .sort({ created_at: 1 })
        .limit(pageSize)
        .toArray()
      if (!docs || docs.length === 0) break
      batchNum += 1

      for (const d of docs) {
        try {
          if (typeof d.url !== 'string' || !d.url.startsWith('data:image/')) {
            continue
          }
          const { mime, buf, ext } = parseDataUrl(d.url)
          const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
          const key = `reference-images/${String(d.user_id)}/${String(d.id || d._id)}-${sha}.${ext}`

          if (dryRun) {
            console.log(`[dry-run] would upload -> ${bucket ?? 'R2_BUCKET'}/${key} (${mime}, ${buf.length} bytes)`) 
          } else {
            const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, Body: buf })
            await s3.send(command)
            const publicBase = (process.env.R2_PUBLIC_BASE || '').trim().replace(/\/$/, '')
            const publicUrl = publicBase
              ? `${publicBase}/${key}`
              : `${normalizeEndpoint(endpoint).replace(/\/$/, '')}/${bucket}/${key}`
            await coll.updateOne({ _id: d._id }, { $set: { url: publicUrl } })
            totalMigrated += 1
            console.log(`✔ migrated ${String(d.id || d._id)} -> ${publicUrl}`)
          }
        } catch (e) {
          totalErrors += 1
          console.error('迁移单条记录异常：', e?.message || e)
        } finally {
          cursorIso = d.created_at || cursorIso
        }
      }

      console.log(`批次#${batchNum} 完成：处理=${docs.length}, 累计成功=${totalMigrated}, 累计错误=${totalErrors}`)
      if (docs.length < pageSize) break
    }
  } finally {
    try { await client.close() } catch {}
  }

  console.log(`迁移完成：成功=${totalMigrated}, 错误=${totalErrors}`)
}

main().catch(err => {
  console.error('迁移脚本异常：', err)
  process.exit(1)
})
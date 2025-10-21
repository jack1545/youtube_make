// Fix previously backfilled R2 URLs to use public r2.dev base instead of internal endpoint
// Usage:
//   node scripts/fix-r2-public-urls.mjs [--dry-run]
// Env: loads .env.local. Requires MONGODB_URI, MONGODB_DBNAME; and R2_PUBLIC_BASE

import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnvLocal()

const args = process.argv.slice(2)
const argMap = Object.fromEntries(args.map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
}))
const dryRun = (() => {
  const v = argMap['dry-run'] ?? argMap.dryRun
  if (v === undefined) return false
  if (v === 'true' || v === '1' || v === '' || v === undefined) return true
  if (v === 'false' || v === '0') return false
  return Boolean(v)
})()

function requiredEnv(name) {
  const v = process.env[name] || ''
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

const WRONG_BASE = 'https://4d4779425c66ec7b1be8e168124753a2.r2.cloudflarestorage.com/ytb/'

const { MongoClient } = await import('mongodb')

function getMongoUri() {
  const uri = process.env.MONGODB_URI || ''
  if (!uri) throw new Error('未配置 MONGODB_URI')
  return uri
}
function getDbName() {
  return process.env.MONGODB_DBNAME || 'creative_workbench'
}

async function main() {
  const publicBase = (requiredEnv('R2_PUBLIC_BASE') || '').trim().replace(/\/$/, '')
  const client = new MongoClient(getMongoUri(), { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 })
  await client.connect()
  const db = client.db(getDbName())
  const coll = db.collection('reference_images')

  try {
    const cursor = coll.find({ url: { $regex: `^${WRONG_BASE.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`)}` } }, { projection: { _id: 1, url: 1 } })
    let count = 0
    const updates = []
    while (await cursor.hasNext()) {
      const doc = await cursor.next()
      const old = doc.url
      const remainder = old.slice(WRONG_BASE.length)
      const fixed = `${publicBase}/${remainder}`
      updates.push({ _id: doc._id, old, fixed })
    }

    if (updates.length === 0) {
      console.log('没有需要修复的 URL。')
      return
    }

    console.log(`将修复 ${updates.length} 条 URL。dryRun=${dryRun}`)

    if (dryRun) {
      for (const u of updates.slice(0, 20)) {
        console.log(`[dry-run] ${String(u._id)}\n  old: ${u.old}\n  new: ${u.fixed}`)
      }
      if (updates.length > 20) console.log(`... 其余 ${updates.length - 20} 条略`) 
    } else {
      for (const u of updates) {
        await coll.updateOne({ _id: u._id }, { $set: { url: u.fixed } })
        count += 1
      }
      console.log(`修复完成：${count} 条 URL 已更新。`)
    }
  } finally {
    try { await client.close() } catch {}
  }
}

main().catch(err => {
  console.error('修复脚本异常：', err)
  process.exit(1)
})
#!/usr/bin/env node
// Migration: Fill reference_videos.project_id based on script_id -> scripts.project_id
// Usage:
//   node scripts/migrate-reference-videos.mjs [--dry-run] [--batch=500] [--user-id=admin_001]

import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'

// Load env from .env.local for local runs
dotenv.config({ path: '.env.local' })

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { dryRun: false, batch: 500, userId: null }
  for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, '']
    switch (k) {
      case '--dry-run': out.dryRun = true; break
      case '--batch': out.batch = Math.max(50, Math.min(Number(v)||500, 1000)); break
      case '--user-id': out.userId = v || null; break
    }
  }
  return out
}

async function getMongo() {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DBNAME || 'creative_workbench'
  if (!uri) throw new Error('缺少 MONGODB_URI')
  const client = new MongoClient(uri, { maxPoolSize: 10 })
  await client.connect()
  const db = client.db(dbName)
  return { client, db }
}

async function ensureIndexes(db) {
  const refs = db.collection('reference_videos')
  await refs.createIndex({ script_id: 1 }).catch(()=>{})
  await refs.createIndex({ project_id: 1 }).catch(()=>{})
}

function isHex24(str) {
  return typeof str === 'string' && /^[0-9a-fA-F]{24}$/.test(str)
}

async function resolveProjectId(db, scriptIdLike) {
  const scripts = db.collection('scripts')
  const projects = db.collection('projects')

  // Find script by _id(ObjectId) or legacy id
  const orConds = []
  if (scriptIdLike && typeof scriptIdLike === 'object') {
    try { orConds.push({ _id: new ObjectId(scriptIdLike) }) } catch {}
  }
  if (typeof scriptIdLike === 'string') {
    if (ObjectId.isValid(scriptIdLike)) orConds.push({ _id: new ObjectId(scriptIdLike) })
    orConds.push({ id: scriptIdLike })
  }
  if (orConds.length === 0) return null

  const script = await scripts.findOne({ $or: orConds }, { projection: { _id: 1, project_id: 1, legacy_project_id: 1 } })
  if (!script) return null

  // Prefer normalized project_id, else try legacy_project_id
  const pid = script.project_id || script.legacy_project_id
  if (!pid) return null

  // Normalize to projects._id string
  const projOrConds = [{ id: pid }, { legacy_id: pid }]
  if (ObjectId.isValid(pid)) projOrConds.unshift({ _id: new ObjectId(pid) })
  const proj = await projects.findOne({ $or: projOrConds }, { projection: { _id: 1 } })
  if (proj) return String(proj._id)

  // If not matched, but looks like hex24, use as-is
  if (isHex24(pid)) return pid
  return null
}

async function migrate({ dryRun, batch, userId }) {
  const { client, db } = await getMongo()
  try {
    await ensureIndexes(db)
    const refs = db.collection('reference_videos')

    const baseFilter = { $and: [ { $or: [ { project_id: null }, { project_id: { $exists: false } } ] }, { script_id: { $ne: null } } ] }
    if (userId) baseFilter.$and.push({ user_id: userId })

    const cursor = refs.find(baseFilter, { projection: { _id: 1, id: 1, user_id: 1, script_id: 1, project_id: 1 } })
    const ops = []
    let scanned = 0, updated = 0, skipped = 0

    while (await cursor.hasNext()) {
      const doc = await cursor.next()
      scanned += 1
      const targetPid = await resolveProjectId(db, doc.script_id)
      if (!targetPid) { skipped += 1; continue }

      if (dryRun) {
        console.log('[dry-run] set reference_videos.project_id', { _id: String(doc._id), from: doc.project_id ?? null, to: targetPid, user_id: doc.user_id })
      } else {
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { project_id: targetPid } } } })
        if (ops.length >= batch) {
          const res = await refs.bulkWrite(ops, { ordered: false })
          updated += (res.modifiedCount || 0)
          ops.length = 0
        }
      }
    }

    if (!dryRun && ops.length) {
      const res = await refs.bulkWrite(ops, { ordered: false })
      updated += (res.modifiedCount || 0)
    }

    console.log(`reference_videos 迁移完成：扫描=${scanned} 更新=${updated} 跳过=${skipped}`)
  } finally {
    await client.close().catch(()=>{})
  }
}

const args = parseArgs()
console.log('开始迁移 reference_videos.project_id：', args)
migrate(args).catch(err => { console.error('迁移脚本异常：', err); process.exit(1) })
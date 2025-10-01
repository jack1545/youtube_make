#!/usr/bin/env node
// Lightweight migration/cleanup:
// 1) Add projects.legacy_id from doc.id when missing
// 2) Create index on scripts.project_id
// 3) Optional: Normalize scripts.project_id to project's Mongo _id, preserve legacy_project_id
// Usage:
//   node scripts/migrate-projects-and-scripts.mjs [--dry-run] [--normalize] [--batch=500]
//   npm run migrate:light -- --normalize --dry-run

import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

// Load env from .env.local for local runs
dotenv.config({ path: '.env.local' })

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { dryRun: false, normalize: false, batch: 500 }
  for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, '']
    switch (k) {
      case '--dry-run': out.dryRun = true; break
      case '--normalize': out.normalize = true; break
      case '--batch': out.batch = Math.max(50, Math.min(Number(v)||500, 1000)); break
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
  const projects = db.collection('projects')
  const scripts = db.collection('scripts')
  // projects.legacy_id 非唯一索引（legacy id 来自 Supabase UUID，可能为空或重复）
  await projects.createIndex({ legacy_id: 1 }).catch(()=>{})
  // scripts.project_id 普通索引；如常按时间排序，可加复合索引
  await scripts.createIndex({ project_id: 1 }).catch(()=>{})
  await scripts.createIndex({ project_id: 1, created_at: -1 }).catch(()=>{})
}

async function migrateProjectsLegacyId(db, { dryRun, batch }) {
  const projects = db.collection('projects')
  const cursor = projects.find({}, { projection: { _id: 1, id: 1, legacy_id: 1, name: 1 } })
  const ops = []
  let scanned = 0, updated = 0, skipped = 0
  while (await cursor.hasNext()) {
    const doc = await cursor.next()
    scanned += 1
    const legacy = doc.legacy_id ?? doc.id
    if (!legacy) { skipped += 1; continue }
    if (doc.legacy_id === legacy) { skipped += 1; continue }
    if (dryRun) {
      console.log('[dry-run] set projects.legacy_id', { _id: String(doc._id), legacy_id: legacy, name: doc.name })
    } else {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { legacy_id: legacy } } } })
      if (ops.length >= batch) {
        const res = await projects.bulkWrite(ops, { ordered: false })
        updated += (res.modifiedCount || 0)
        ops.length = 0
      }
    }
  }
  if (!dryRun && ops.length) {
    const res = await projects.bulkWrite(ops, { ordered: false })
    updated += (res.modifiedCount || 0)
  }
  console.log(`projects legacy_id 结果：扫描=${scanned} 更新=${updated} 跳过=${skipped}`)
}

async function normalizeScriptsProjectId(db, { dryRun, batch }) {
  const scripts = db.collection('scripts')
  const projects = db.collection('projects')
  const { ObjectId } = await import('mongodb')

  const cursor = scripts.find({}, { projection: { _id: 1, id: 1, project_id: 1, legacy_project_id: 1, created_at: 1 } })
  const ops = []
  let scanned = 0, changed = 0, skipped = 0, notFound = 0

  while (await cursor.hasNext()) {
    const doc = await cursor.next()
    scanned += 1
    const currentPid = doc.project_id
    if (!currentPid || typeof currentPid !== 'string') { skipped += 1; continue }

    // 根据现有值查询项目：支持 _id（24hex）或 legacy id（projects.id/legacy_id）
    const orConds = [{ id: currentPid }, { legacy_id: currentPid }]
    if (ObjectId.isValid(currentPid)) {
      orConds.unshift({ _id: new ObjectId(currentPid) })
    }
    const proj = await projects.findOne({ $or: orConds }, { projection: { _id: 1, id: 1, legacy_id: 1 } })
    if (!proj) { notFound += 1; continue }

    const normalized = String(proj._id)
    if (normalized === currentPid) { skipped += 1; continue }

    const legacyProjectId = doc.legacy_project_id || currentPid

    if (dryRun) {
      console.log('[dry-run] normalize scripts.project_id', { _id: String(doc._id), from: currentPid, to: normalized, legacy_project_id: legacyProjectId })
    } else {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { project_id: normalized, legacy_project_id: legacyProjectId } }
        }
      })
      if (ops.length >= batch) {
        const res = await scripts.bulkWrite(ops, { ordered: false })
        changed += (res.modifiedCount || 0)
        ops.length = 0
      }
    }
  }

  if (!dryRun && ops.length) {
    const res = await scripts.bulkWrite(ops, { ordered: false })
    changed += (res.modifiedCount || 0)
  }

  console.log(`scripts 归一化结果：扫描=${scanned} 变更=${changed} 跳过=${skipped} 未匹配项目=${notFound}`)
}

async function run() {
  const args = parseArgs()
  console.log('开始轻量迁移/整理：', args)
  const { client, db } = await getMongo()

  try {
    await ensureIndexes(db)
    await migrateProjectsLegacyId(db, { dryRun: args.dryRun, batch: args.batch })
    if (args.normalize) {
      await normalizeScriptsProjectId(db, { dryRun: args.dryRun, batch: args.batch })
    }
    console.log('迁移完成')
  } finally {
    await client.close().catch(()=>{})
  }
}

run().catch(err => { console.error('迁移脚本异常：', err); process.exit(1) })
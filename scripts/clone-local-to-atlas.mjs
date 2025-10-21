#!/usr/bin/env node
// Clone all collections from local MongoDB -> MongoDB Atlas
// Usage:
//   node scripts/clone-local-to-atlas.mjs [--batch=500] [--collections=projects,scripts,...] [--drop-before]
//   npm run clone:mongo -- --batch=500

import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import fs from 'node:fs'

dotenv.config({ path: '.env.local' })

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { batch: 500, collections: null, dropBefore: false }
  for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, '']
    switch (k) {
      case '--batch': out.batch = Math.max(1, Math.min(Number(v)||500, 2000)); break
      case '--collections': out.collections = v.split(',').map(s => s.trim()).filter(Boolean); break
      case '--drop-before': out.dropBefore = true; break
    }
  }
  return out
}

function requireEnv(key, hint) {
  const val = process.env[key]
  if (!val) throw new Error(`缺少环境变量 ${key}${hint ? ' - ' + hint : ''}`)
  return val
}

async function connectPair() {
  const srcUri = requireEnv('MONGODB_LOCAL_URI', '例如 mongodb://localhost:2641')
  const srcDbName = process.env.MONGODB_LOCAL_DBNAME || 'creative_workbench'
  const dstUri = requireEnv('MONGODB_URI', 'Atlas 连接字符串')
  const dstDbName = process.env.MONGODB_DBNAME || 'creative_workbench'

  const src = new MongoClient(srcUri, { maxPoolSize: 10 })
  const dst = new MongoClient(dstUri, { maxPoolSize: 10 })
  await src.connect()
  await dst.connect()
  return { srcClient: src, dstClient: dst, srcDb: src.db(srcDbName), dstDb: dst.db(dstDbName) }
}

async function ensureIndexesFromSource(srcColl, dstColl) {
  try {
    const indexes = await srcColl.indexes()
    for (const idx of indexes) {
      if (!idx || !idx.key) continue
      if (idx.name === '_id_') continue // default
      // Skip unique id on reference_images to avoid duplicate key interruptions during clone
      if (dstColl.collectionName === 'reference_images' && idx.name === 'id_1') continue
      const opts = { name: idx.name }
      if (typeof idx.unique !== 'undefined') opts.unique = idx.unique
      if (typeof idx.sparse !== 'undefined') opts.sparse = idx.sparse
      if (typeof idx.expireAfterSeconds !== 'undefined') opts.expireAfterSeconds = idx.expireAfterSeconds
      try { await dstColl.createIndex(idx.key, opts) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

async function copyCollection(srcDb, dstDb, name, batchSize, dropBefore) {
  const srcColl = srcDb.collection(name)
  const dstColl = dstDb.collection(name)

  if (dropBefore) {
    try { await dstColl.drop() } catch { /* ignore */ }
  }

  const total = await srcColl.countDocuments({})
  console.log(`开始复制集合 ${name}，总数=${total}`)

  const cursor = srcColl.find({}, { sort: { _id: 1 } })
  let copied = 0
  let errors = 0
  let batch = []
  for await (const doc of cursor) {
    batch.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })
    if (batch.length >= batchSize) {
      try {
        const res = await dstColl.bulkWrite(batch, { ordered: false })
        copied += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0)
        console.log(`集合 ${name} 进度：${copied}/${total}`)
      } catch (err) {
        const res = err?.result
        if (res) {
          copied += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0)
        }
        const errCount = Array.isArray(err?.writeErrors) ? err.writeErrors.length : 1
        errors += errCount
        console.error(`集合 ${name} 批次写入错误：`, err?.code || err?.message || 'unknown', `错误数=${errCount}`)
      }
      batch.length = 0
    }
  }
  if (batch.length) {
    try {
      const res = await dstColl.bulkWrite(batch, { ordered: false })
      copied += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0)
    } catch (err) {
      const res = err?.result
      if (res) {
        copied += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0)
      }
      const errCount = Array.isArray(err?.writeErrors) ? err.writeErrors.length : 1
      errors += errCount
      console.error(`集合 ${name} 末批写入错误：`, err?.code || err?.message || 'unknown', `错误数=${errCount}`)
    }
  }

  console.log(`完成集合 ${name}：复制=${copied} 总数=${total} 错误=${errors}`)
  // After copying, replicate indexes from source
  await ensureIndexesFromSource(srcColl, dstColl)
  // Write summary to file for later inspection
  try { fs.appendFileSync('__clone_result.txt', `[${new Date().toISOString()}] ${name}: total=${total} copied=${copied} errors=${errors}\n`) } catch {}
}

async function run() {
  const args = parseArgs()
  const { srcClient, dstClient, srcDb, dstDb } = await connectPair()
  try {
    const colls = await srcDb.listCollections().toArray()
    let names = colls.map(c => c.name).filter(n => !n.startsWith('system.'))
    if (args.collections) {
      const set = new Set(args.collections)
      names = names.filter(n => set.has(n))
    }

    console.log('将复制以下集合：', names.join(', '))
    for (const n of names) {
      await copyCollection(srcDb, dstDb, n, args.batch, args.dropBefore)
    }
    console.log('所有集合复制完成。')
  } finally {
    await srcClient.close().catch(()=>{})
    await dstClient.close().catch(()=>{})
  }
}

run().catch(err => { console.error('克隆脚本异常：', err); process.exit(1) })
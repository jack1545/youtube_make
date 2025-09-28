#!/usr/bin/env node
// Sync Supabase Postgres table -> MongoDB collection (reference_images)
// Usage:
//   node scripts/sync-reference-images-to-mongo.mjs --limit=100 --user-id=USER --dry-run
//   npm run sync:refs -- --limit=100 --dry-run

import { createClient } from '@supabase/supabase-js'
import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'

// Load env from .env.local
dotenv.config({ path: '.env.local' })

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { limit: 100, userId: null, dryRun: false, since: null, until: null }
  for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, '']
    switch (k) {
      case '--limit': out.limit = Math.max(1, Math.min(Number(v) || 100, 500)); break
      case '--user-id': out.userId = v || null; break
      case '--dry-run': out.dryRun = true; break
      case '--since': out.since = v || null; break
      case '--until': out.until = v || null; break
    }
  }
  return out
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('缺少 Supabase 服务器端凭证 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key)
}

async function getMongoCollection() {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DBNAME || 'creative_workbench'
  if (!uri) throw new Error('缺少 MONGODB_URI')
  const client = new MongoClient(uri, { maxPoolSize: 10 })
  await client.connect()
  const db = client.db(dbName)
  const coll = db.collection('reference_images')
  // indices
  await coll.createIndex({ id: 1 }, { unique: true })
  await coll.createIndex({ user_id: 1, created_at: -1 })
  return { client, db, coll }
}

async function fetchBatch(supabase, { userId, limit, before }) {
  let q = supabase
    .from('reference_images')
    .select('id,user_id,url,label,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (userId) q = q.eq('user_id', userId)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) {
    const code = error?.code
    const message = error?.message
    if (code === '57014' || /statement timeout/i.test(message || '')) {
      console.warn('Supabase 查询超时，建议减小 limit 或稍后重试')
      return []
    }
    throw error
  }
  return data || []
}

async function run() {
  const args = parseArgs()
  console.log('开始同步 Supabase -> MongoDB reference_images', {
    limit: args.limit, userId: args.userId, dryRun: args.dryRun, since: args.since, until: args.until
  })

  const supabase = getSupabaseClient()
  const { client: mongoClient, coll } = await getMongoCollection()

  try {
    let before = args.until || undefined
    let total = 0
    while (true) {
      const batch = await fetchBatch(supabase, { userId: args.userId, limit: args.limit, before })
      if (!batch.length) break

      const ops = []
      for (const item of batch) {
        const doc = {
          id: item.id,
          user_id: item.user_id,
          url: item.url,
          label: item.label ?? null,
          created_at: item.created_at,
          _source: 'supabase',
          _migrated_at: new Date().toISOString()
        }
        if (args.dryRun) {
          console.log('[dry-run] upsert', doc.id, doc.user_id, doc.created_at)
        } else {
          ops.push({ updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true } })
        }
      }

      if (ops.length) {
        const res = await coll.bulkWrite(ops, { ordered: false })
        console.log(`写入 Mongo：matched=${res.matchedCount} upserted=${res.upsertedCount} modified=${res.modifiedCount}`)
      }

      total += batch.length
      before = batch[batch.length - 1]?.created_at
      console.log(`进度：累计 ${total} 条，下一游标 before=${before}`)
      if (!before) break

      // 若指定 since，则在到达 since 之后停止
      if (args.since && before <= args.since) break
    }
    console.log('同步完成，总计处理', total, '条')
  } finally {
    await mongoClient.close().catch(() => {})
  }
}

run().catch(err => {
  console.error('同步失败：', err)
  process.exit(1)
})
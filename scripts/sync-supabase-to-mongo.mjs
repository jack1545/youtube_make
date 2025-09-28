#!/usr/bin/env node
// Full sync: migrate all Supabase tables -> MongoDB collections
// Usage:
//   node scripts/sync-supabase-to-mongo.mjs [--limit=100] [--dry-run]
//   npm run sync:all -- --limit=200 --dry-run

import { createClient } from '@supabase/supabase-js'
import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { limit: 200, dryRun: false }
  for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, '']
    switch (k) {
      case '--limit': out.limit = Math.max(1, Math.min(Number(v)||200, 500)); break
      case '--dry-run': out.dryRun = true; break
    }
  }
  return out
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺少 Supabase 服务端凭证 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

async function getMongo(dbNameOverride) {
  const uri = process.env.MONGODB_URI
  const dbName = dbNameOverride || process.env.MONGODB_DBNAME || 'creative_workbench'
  if (!uri) throw new Error('缺少 MONGODB_URI')
  const client = new MongoClient(uri, { maxPoolSize: 10 })
  await client.connect()
  const db = client.db(dbName)
  return { client, db }
}

async function upsertMany(coll, docs, dryRun) {
  if (dryRun) {
    for (const d of docs) console.log('[dry-run] upsert', coll.collectionName, d.id || d._id)
    return { upsertedCount: docs.length, matchedCount: 0, modifiedCount: 0 }
  }
  if (!docs.length) return { upsertedCount: 0, matchedCount: 0, modifiedCount: 0 }
  const ops = docs.map(doc => ({ updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true } }))
  return await coll.bulkWrite(ops, { ordered: false })
}

async function syncTable(supabase, db, table, selectCols, mapRow, orderCol = 'created_at') {
  const args = parseArgs()
  const limit = args.limit
  const dryRun = args.dryRun
  const coll = db.collection(table)
  await coll.createIndex({ id: 1 }, { unique: true }).catch(()=>{})
  if (orderCol) {
    await coll.createIndex({ [orderCol]: -1 }).catch(()=>{})
  }

  let before = undefined
  let total = 0
  while (true) {
    let q = supabase.from(table).select(selectCols).order(orderCol, { ascending: false }).limit(limit)
    if (before) q = q.lt(orderCol, before)
    const { data, error } = await q
    if (error) throw error
    const docs = (data||[]).map(mapRow)
    const res = await upsertMany(coll, docs, dryRun)
    total += docs.length
    console.log(`sync ${table}: batch=${docs.length} matched=${res.matchedCount||0} upserted=${res.upsertedCount||0}`)
    if (!data || data.length < limit) break
    before = data[data.length-1]?.[orderCol]
    if (!before) break
  }
  console.log(`sync ${table} done, total=${total}`)
}

async function run() {
  const supabase = getSupabaseClient()
  const { client, db } = await getMongo()
  try {
    await syncTable(
      supabase, db,
      'projects',
      'id,name,description,created_at,user_id',
      r => ({ id: r.id, name: r.name, description: r.description ?? null, created_at: r.created_at, user_id: r.user_id, _source: 'supabase', _migrated_at: new Date().toISOString() })
    )

    await syncTable(
      supabase, db,
      'scripts',
      'id,project_id,content,status,created_at',
      r => ({ id: r.id, project_id: r.project_id, content: r.content, status: r.status, created_at: r.created_at, _source: 'supabase', _migrated_at: new Date().toISOString() })
    )

    await syncTable(
      supabase, db,
      'script_analyses',
      'id,script_id,analysis,created_at',
      r => ({ id: r.id, script_id: r.script_id, analysis: r.analysis, created_at: r.created_at, _source: 'supabase', _migrated_at: new Date().toISOString() })
    )

    await syncTable(
      supabase, db,
      'generated_images',
      'id,script_id,prompt,image_url,status,shot_number,created_at',
      r => ({ id: r.id, script_id: r.script_id, prompt: r.prompt, image_url: r.image_url, status: r.status, shot_number: r.shot_number ?? null, created_at: r.created_at, _source: 'supabase', _migrated_at: new Date().toISOString() })
    )

    await syncTable(
      supabase, db,
      'reference_images',
      'id,user_id,url,label,created_at',
      r => ({ id: r.id, user_id: r.user_id, url: r.url, label: r.label ?? null, created_at: r.created_at, _source: 'supabase', _migrated_at: new Date().toISOString() })
    )

    await syncTable(
      supabase, db,
      'api_key_settings',
      'user_id,gemini_api_key,doubao_api_key,veo3_api_key,updated_at',
      r => ({ id: r.user_id, user_id: r.user_id, gemini_api_key: r.gemini_api_key ?? null, doubao_api_key: r.doubao_api_key ?? null, veo3_api_key: r.veo3_api_key ?? null, updated_at: r.updated_at, _source: 'supabase', _migrated_at: new Date().toISOString() }),
      'updated_at'
    )

    await syncTable(
      supabase, db,
      'generated_videos',
      'id,user_id,script_id,image_url,prompt,video_url,status,created_at',
      r => ({ id: r.id, user_id: r.user_id, script_id: r.script_id, image_url: r.image_url, prompt: r.prompt, video_url: r.video_url ?? null, status: r.status, shot_number: (typeof r.shot_number !== 'undefined' ? r.shot_number : null), created_at: r.created_at, _source: 'supabase', _migrated_at: new Date().toISOString() })
    )
  } finally {
    await client.close().catch(()=>{})
  }
}

run().catch(err => { console.error('全库同步失败：', err); process.exit(1) })
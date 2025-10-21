#!/usr/bin/env node
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

dotenv.config({ path: '.env.local' })

async function main() {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DBNAME || 'creative_workbench'
  if (!uri) throw new Error('缺少 MONGODB_URI')
  const client = new MongoClient(uri, { maxPoolSize: 5 })
  await client.connect()
  const db = client.db(dbName)

  const names = (await db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.'))
  for (const n of names) {
    const idxs = await db.collection(n).indexes()
    console.log(`集合 ${n} 索引：`)
    for (const idx of idxs) {
      console.log(' -', idx.name, JSON.stringify(idx.key), idx.unique ? 'unique' : '', typeof idx.expireAfterSeconds !== 'undefined' ? `TTL=${idx.expireAfterSeconds}` : '')
    }
  }
  await client.close()
}

main().catch(err => { console.error('list-indexes 失败：', err); process.exit(1) })
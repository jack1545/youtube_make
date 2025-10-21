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
    const count = await db.collection(n).countDocuments({})
    console.log(`${n}: ${count}`)
  }
  await client.close()
}

main().catch(err => { console.error('count-collections 失败：', err); process.exit(1) })
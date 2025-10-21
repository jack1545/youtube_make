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
  const coll = db.collection('reference_images')
  try {
    const res = await coll.dropIndex('id_1')
    console.log('已删除 reference_images 索引 id_1：', res)
  } catch (err) {
    console.error('删除索引失败（可能不存在或权限不足）：', err?.code || err?.message)
    process.exitCode = 1
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error('drop-index 脚本异常：', err); process.exit(1) })
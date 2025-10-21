#!/usr/bin/env node
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

async function main() {
  dotenv.config({ path: '.env.local' })
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DBNAME || 'creative_workbench'
  if (!uri) {
    console.error('缺少 MONGODB_URI')
    process.exit(1)
  }
  const client = new MongoClient(uri, { maxPoolSize: 5 })
  try {
    await client.connect()
    const db = client.db(dbName)
    const coll = db.collection('__heartbeat')
    const docs = await coll.find({}).sort({ _id: -1 }).limit(1).toArray()
    if (!docs.length) {
      console.log('__heartbeat 集合为空')
    } else {
      const d = docs[0]
      console.log(`读取成功：id=${d._id.toString()} created_at=${d.created_at} machine=${d.machine}`)
    }
  } catch (err) {
    console.error('读取失败：', err)
    process.exit(1)
  } finally {
    await client.close().catch(()=>{})
  }
}

main()
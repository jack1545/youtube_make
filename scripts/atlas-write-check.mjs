#!/usr/bin/env node
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import fs from 'fs'
import path from 'path'

async function main() {
  dotenv.config({ path: '.env.local' })
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DBNAME || 'creative_workbench'
  if (!uri) {
    console.error('缺少 MONGODB_URI，请在 .env.local 设置')
    process.exit(1)
  }
  const client = new MongoClient(uri, { maxPoolSize: 5 })
  try {
    await client.connect()
    const db = client.db(dbName)
    const coll = db.collection('__heartbeat')
    const doc = { tag: 'atlas-write-check', created_at: new Date().toISOString(), machine: process.env.COMPUTERNAME || process.env.HOSTNAME || 'local' }
    const res = await coll.insertOne(doc)
    const msg = `写入成功：collection=__heartbeat id=${res.insertedId.toString()}\n`
    const outPath = path.resolve(process.cwd(), '__heartbeat_result.txt')
    fs.appendFileSync(outPath, msg)
    console.log(msg.trim())
  } catch (err) {
    const outPath = path.resolve(process.cwd(), '__heartbeat_result.txt')
    fs.appendFileSync(outPath, `写入失败：${err?.message || err}\n`)
    console.error('写入失败：', err)
    process.exit(1)
  } finally {
    await client.close().catch(()=>{})
  }
}

main()
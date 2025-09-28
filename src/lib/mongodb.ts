// MongoDB connection helper with global caching to survive Next.js dev hot reloads
import { MongoClient, Db } from 'mongodb'

let cachedClient: MongoClient | null = null
let cachedDb: Db | null = null

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI || ''
  if (!uri || uri.includes('your_mongodb_uri')) {
    throw new Error('MONGODB_URI 未配置或无效')
  }
  return uri
}

function getDbName(): string {
  return process.env.MONGODB_DBNAME || 'creative_workbench'
}

export async function getDb(): Promise<Db> {
  if (cachedDb && cachedClient) {
    return cachedDb
  }

  const uri = getMongoUri()
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000
  })
  await client.connect()
  cachedClient = client
  cachedDb = client.db(getDbName())
  return cachedDb
}

export async function closeMongo(): Promise<void> {
  if (cachedClient) {
    try { await cachedClient.close() } catch {}
    cachedClient = null
    cachedDb = null
  }
}
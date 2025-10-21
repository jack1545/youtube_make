import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'
import crypto from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const runtime = 'nodejs'

function parseDataUrl(dataUrl: string) {
  if (!dataUrl.startsWith('data:')) throw new Error('Invalid data URL')
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Invalid data URL: missing comma')
  const meta = dataUrl.slice(5, comma)
  const payload = dataUrl.slice(comma + 1)
  const isBase64 = /;base64/i.test(meta)
  const mime = (meta.match(/^([^;]+)/)?.[1]) || 'application/octet-stream'
  const buf = isBase64 ? Buffer.from(payload.trim(), 'base64') : Buffer.from(decodeURIComponent(payload.trim()))
  const ext = mime.toLowerCase().includes('png') ? 'png'
    : mime.toLowerCase().includes('jpeg') || mime.toLowerCase().includes('jpg') ? 'jpg'
    : mime.toLowerCase().includes('webp') ? 'webp'
    : mime.toLowerCase().includes('gif') ? 'gif'
    : 'bin'
  return { mime, buf, ext, base64: isBase64 ? payload.trim() : undefined }
}

function requiredEnv(name: string): string {
  const v = process.env[name] || ''
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { id, user_id } = payload as { id?: string; user_id?: string }
    if (!id || !user_id) {
      return NextResponse.json({ error: '缺少必要字段 id 或 user_id' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_images')

    // 支持通过 _id 或 id 查询
    const { ObjectId } = await import('mongodb')
    const candidates: any[] = []
    if (ObjectId.isValid(id)) candidates.push({ _id: new ObjectId(id), user_id })
    candidates.push({ id, user_id })

    const doc: any = await coll.findOne({ $or: candidates as any })
    if (!doc) {
      return NextResponse.json({ error: '参考图不存在或归属不匹配' }, { status: 404 })
    }

    const url: string = doc.url
    if (!url || typeof url !== 'string' || !/^data:image\//i.test(url)) {
      return NextResponse.json({ error: '该参考图不是 data:image 格式' }, { status: 400 })
    }

    const parsed = parseDataUrl(url)
    const { mime, buf, ext } = parsed

    // 根据内容生成稳定 key，避免重复上传；亦可包含用户与文档ID
    const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const bucket = requiredEnv('R2_BUCKET')
    const endpoint = requiredEnv('R2_ENDPOINT')
    const accessKeyId = requiredEnv('R2_ACCESS_KEY_ID')
    const secretAccessKey = requiredEnv('R2_SECRET_ACCESS_KEY')

    const key = `reference-images/${String(doc.user_id || user_id)}/${String(doc.id || id)}-${sha}.${ext}`

    const s3 = new S3Client({
      region: 'auto',
      endpoint: endpoint.trim().replace(/`/g, ''),
      credentials: { accessKeyId, secretAccessKey }
    })

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mime
      // 不再使用 ContentMD5，避免与 R2 校验策略冲突
    })

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 }) // 10 分钟有效

    // 优先使用 R2_PUBLIC_BASE 构造公网可访问地址；否则回退到 endpoint/bucket 形式
    const publicBase = (process.env.R2_PUBLIC_BASE || '').trim().replace(/\/$/, '')
    const publicUrl = publicBase
      ? `${publicBase}/${key}`
      : `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`

    return NextResponse.json({
      upload_url: uploadUrl,
      bucket,
      key,
      content_type: mime,
      size: buf.length,
      public_url: publicUrl,
      body_base64: parsed.base64
    })
  } catch (err: any) {
    console.error('API:/api/r2/upload-url error', err)
    const msg = err?.message || '服务端错误'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
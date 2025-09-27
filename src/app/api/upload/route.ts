import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const first = formData.get('first') as File | null
    const last = formData.get('last') as File | null
    const single = formData.get('file') as File | null

    // Validate Supabase server-side credentials
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Supabase 未配置，请改用公开图片 URL 提交（例如 CDN 或公开站点）' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Ensure bucket exists and is public
    const ensureBucket = async () => {
      const { data: bucketInfo } = await (supabase.storage as any).getBucket?.('uploads')
      if (!bucketInfo) {
        await supabase.storage.createBucket('uploads', {
          public: true,
          fileSizeLimit: '50MB'
        })
      }
    }
    await ensureBucket()

    const uploadOne = async (file: File, keyHint: string) => {
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const ext = (() => {
        const name = file.name || ''
        const idx = name.lastIndexOf('.')
        return idx >= 0 ? name.slice(idx + 1) : 'png'
      })()
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const path = `veo3/${unique}-${keyHint}.${ext}`

      const { error: uploadErr } = await supabase.storage.from('uploads').upload(path, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      })
      if (uploadErr) {
        throw new Error(`上传失败：${uploadErr.message}`)
      }
      const { data: pub } = supabase.storage.from('uploads').getPublicUrl(path)
      return pub.publicUrl
    }

    const result: Record<string, string | null> = { first: null, last: null, file: null }

    if (first) result.first = await uploadOne(first, 'first')
    if (last) result.last = await uploadOne(last, 'last')
    if (single) result.file = await uploadOne(single, 'single')

    return NextResponse.json({ urls: result })
  } catch (error: any) {
    console.error('Upload route error', error)
    return NextResponse.json({ error: error?.message || '上传失败' }, { status: 500 })
  }
}
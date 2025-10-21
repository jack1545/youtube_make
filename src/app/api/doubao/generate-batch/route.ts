import { NextResponse } from 'next/server'
import { BatchImageRequest, generateImage } from '@/lib/doubao'
import { createClient } from '@supabase/supabase-js'
import { getDb } from '@/lib/mongodb'

interface DoubaoBatchPayload {
  requests: BatchImageRequest[]
  options?: {
    size?: string
    responseFormat?: 'url' | 'b64_json'
  }
  // 新增：当提供脚本ID时，服务端将生成结果持久化到 MongoDB
  script_id?: string
  // 新增：允许访客模式传入 Doubao API Key 覆盖
  doubao_api_key_override?: string
}

async function resolveDoubaoApiKey(): Promise<string | null> {
  const directKey = process.env.DOUBAO_API_KEY
  if (directKey && directKey !== 'your_doubao_api_key' && directKey.length >= 20) {
    return directKey
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const adminId = process.env.ADMIN_ID || 'admin_001'

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await supabase
      .from('api_key_settings')
      .select('doubao_api_key')
      .eq('user_id', adminId)
      .maybeSingle()

    if (error) {
      console.error('Failed to retrieve Doubao API key from Supabase', error)
      return null
    }

    const storedKey = data?.doubao_api_key
    if (storedKey && storedKey !== 'your_doubao_api_key' && storedKey.length >= 20) {
      return storedKey
    }
  } catch (lookupError) {
    console.error('Doubao key lookup failed', lookupError)
  }

  return null
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as DoubaoBatchPayload

    if (!payload?.requests || !Array.isArray(payload.requests)) {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
    }

    // 优先使用访客提供的覆盖密钥（仅当格式看起来有效时）
    const override = (payload.doubao_api_key_override || '').trim()
    let apiKey: string | null = null
    if (override && override.length >= 20 && override !== 'your_doubao_api_key') {
      apiKey = override
      process.env.DOUBAO_API_KEY = apiKey
    }

    // Ensure the Doubao API key is available on the server. If we fetch a key from
    // Supabase, temporarily assign it to process.env so the shared helper can use it.
    if (!apiKey) {
      let envKey = process.env.DOUBAO_API_KEY
      if (!envKey || envKey === 'your_doubao_api_key' || envKey.length < 20) {
        const resolvedKey = await resolveDoubaoApiKey()
        if (!resolvedKey) {
          return NextResponse.json({ error: 'Doubao API key not configured' }, { status: 401 })
        }
        process.env.DOUBAO_API_KEY = resolvedKey
        envKey = resolvedKey
      }
      apiKey = envKey
    }

    const defaultSize = payload.options?.size
    const defaultFormat = payload.options?.responseFormat

    // 若传入 script_id，则准备持久化集合
    const scriptId = payload.script_id || (payload as any).scriptId || null
    const nowIso = new Date().toISOString()
    let imagesColl: any = null
    if (scriptId) {
      const db = await getDb()
      imagesColl = db.collection('generated_images')
    }

    // 并发优化：按批次并发生成，减少整体等待时间
    const results: any[] = new Array(payload.requests.length)
    const concurrency = Math.max(1, Math.min(8, Number(process.env.DOUBAO_CONCURRENCY || 4)))

    for (let start = 0; start < payload.requests.length; start += concurrency) {
      const slice = payload.requests.slice(start, start + concurrency)
      const tasks = slice.map(async (req) => {
        try {
          const image = await generateImage({
            prompt: req.prompt,
            referenceImageUrl: req.referenceImageUrl,
            referenceImageUrls: req.referenceImageUrls,
            size: req.size || defaultSize,
            responseFormat: defaultFormat || 'url'
          })

          // 可选：持久化到 MongoDB
          if (imagesColl && scriptId) {
            await imagesColl.insertOne({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              script_id: scriptId,
              prompt: image.prompt,
              image_url: image.url,
              status: 'completed',
              shot_number: typeof req.shot_number === 'number' ? req.shot_number : undefined,
              created_at: nowIso
            })
          }

          return image
        } catch (err) {
          console.error('generateImage error', err)
          return {
            url: 'https://via.placeholder.com/1024x1024?text=Generation+Error',
            prompt: req?.prompt || 'Generation error',
            referenceImageUrl: req?.referenceImageUrl
          }
        }
      })

      const settled = await Promise.allSettled(tasks)
      settled.forEach((res, offset) => {
        const idx = start + offset
        if (res.status === 'fulfilled') {
          results[idx] = res.value
        } else {
          console.error('generateImage failed', res.reason)
          const req = slice[offset]
          results[idx] = {
            url: 'https://via.placeholder.com/1024x1024?text=Generation+Error',
            prompt: req?.prompt || 'Generation error',
            referenceImageUrl: req?.referenceImageUrl
          }
        }
      })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Doubao batch generation failed', error)
    return NextResponse.json({ error: 'Failed to generate images via Doubao' }, { status: 500 })
  }
}

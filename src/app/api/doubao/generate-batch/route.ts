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

    // Ensure the Doubao API key is available on the server. If we fetch a key from
    // Supabase, temporarily assign it to process.env so the shared helper can use it.
    let apiKey = process.env.DOUBAO_API_KEY
    if (!apiKey || apiKey === 'your_doubao_api_key' || apiKey.length < 20) {
      const resolvedKey = await resolveDoubaoApiKey()
      if (!resolvedKey) {
        return NextResponse.json({ error: 'Doubao API key not configured' }, { status: 401 })
      }
      process.env.DOUBAO_API_KEY = resolvedKey
      apiKey = resolvedKey
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
      const tasks = slice.map((request, offset) => (async () => {
        const index = start + offset
        if (!request?.prompt) {
          return {
            url: 'https://via.placeholder.com/1024x1024?text=Invalid+Prompt',
            prompt: 'Invalid prompt payload',
            referenceImageUrl: request?.referenceImageUrl
          }
        }

        const image = await generateImage({
          prompt: request.prompt,
          referenceImageUrl: request.referenceImageUrl,
          referenceImageUrls: request.referenceImageUrls,
          size: request.size || defaultSize,
          responseFormat: defaultFormat
        })

        // 持久化到 MongoDB（可选）
        if (imagesColl && scriptId) {
          try {
            const uniqueId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${scriptId}-${Date.now()}-${index}`
            await imagesColl.insertOne({
              id: uniqueId,
              script_id: scriptId,
              prompt: image.prompt || request.prompt,
              image_url: image.url,
              shot_number: request.shot_number,
              status: 'completed',
              created_at: nowIso
            })
          } catch (persistErr) {
            console.error('Failed to persist generated image', persistErr)
          }
        }
        return image
      })())

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

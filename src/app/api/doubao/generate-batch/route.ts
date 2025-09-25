import { NextResponse } from 'next/server'
import { BatchImageRequest, generateImage } from '@/lib/doubao'
import { createClient } from '@supabase/supabase-js'

interface DoubaoBatchPayload {
  requests: BatchImageRequest[]
  options?: {
    size?: string
    responseFormat?: 'url' | 'b64_json'
  }
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

    const results = []
    for (let index = 0; index < payload.requests.length; index += 1) {
      const request = payload.requests[index]
      if (!request?.prompt) {
        results.push({
          url: 'https://via.placeholder.com/1024x1024?text=Invalid+Prompt',
          prompt: 'Invalid prompt payload',
          referenceImageUrl: request?.referenceImageUrl
        })
        continue
      }

      const image = await generateImage({
        prompt: request.prompt,
        referenceImageUrl: request.referenceImageUrl,
        referenceImageUrls: request.referenceImageUrls,
        size: request.size || defaultSize,
        responseFormat: defaultFormat
      })
      results.push(image)
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Doubao batch generation failed', error)
    return NextResponse.json({ error: 'Failed to generate images via Doubao' }, { status: 500 })
  }
}

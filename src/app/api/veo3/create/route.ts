import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

interface Veo3CreateOptions {
  model?: string
  images?: string[]
  enhancePrompt?: boolean
  enableUpsample?: boolean
  aspectRatio?: '16:9' | '9:16'
}

interface Veo3CreatePayload {
  prompt: string
  options?: Veo3CreateOptions
}

async function resolveVeo3ApiKey(): Promise<string | null> {
  const directKey = process.env.VEO3_API_KEY
  if (directKey && directKey !== 'your_veo3_api_key' && directKey.length >= 30) {
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
      .select('veo3_api_key')
      .eq('user_id', adminId)
      .maybeSingle()

    if (error) {
      console.error('Failed to retrieve Veo3 API key from Supabase', error)
      return null
    }

    const storedKey = data?.veo3_api_key
    if (storedKey && storedKey !== 'your_veo3_api_key' && storedKey.length >= 30) {
      return storedKey
    }
  } catch (lookupError) {
    console.error('Veo3 key lookup failed', lookupError)
  }

  return null
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Veo3CreatePayload

    if (!payload?.prompt || typeof payload.prompt !== 'string') {
      return NextResponse.json({ error: 'Invalid request payload: prompt is required' }, { status: 400 })
    }

    // Resolve API key securely on the server
    const apiKey = await resolveVeo3ApiKey()
    if (!apiKey) {
      return NextResponse.json({ error: 'Veo3 API key not configured' }, { status: 401 })
    }

    const opts = payload.options || {}
    const body: Record<string, unknown> = {
      model: opts.model ?? 'veo3-fast-frames',
      prompt: payload.prompt,
      enhance_prompt: opts.enhancePrompt ?? true,
      enable_upsample: opts.enableUpsample ?? false,
      aspect_ratio: opts.aspectRatio ?? '16:9'
    }

    if (opts.images && Array.isArray(opts.images) && opts.images.length) {
      body.images = opts.images
    }

    const response = await fetch('https://yunwu.ai/v1/video/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorPayload = await response.text()
      return NextResponse.json({ error: `Veo3 API error: ${response.status} ${errorPayload}` }, { status: response.status })
    }

    const data = await response.json()
    const jobId = data?.id ?? data?.choices?.[0]?.message?.content ?? `veo3-${Date.now()}`
    const status = data?.choices?.[0]?.finish_reason ?? 'submitted'

    return NextResponse.json({ id: jobId, status, response: data })
  } catch (error) {
    console.error('Veo3 create route error', error)
    return NextResponse.json({ error: 'Failed to submit Veo3 job' }, { status: 500 })
  }
}
export interface Veo3Options {
  model?: string
  images?: string[]
  enhancePrompt?: boolean
  enableUpsample?: boolean
  aspectRatio?: '16:9' | '9:16'
}

export interface Veo3JobResult {
  id: string
  status: string
  response: unknown
}

export async function createVeo3Job(prompt: string, options: Veo3Options = {}): Promise<Veo3JobResult> {
  const apiKey = process.env.VEO3_API_KEY

  const isMissingKey = !apiKey || apiKey === 'your_veo3_api_key'
  const isLikelyWrongProviderKey = typeof apiKey === 'string' && apiKey.startsWith('sk-')
  const isTooShort = typeof apiKey === 'string' && apiKey.length < 30

  if (isMissingKey || isLikelyWrongProviderKey || isTooShort) {
    console.warn('Veo3 API key appears invalid or missing. Returning a mock job response for demo purposes.')
    return {
      id: `mock-veo3-job-${Date.now()}`,
      status: 'mock',
      response: {
        prompt,
        options
      }
    }
  }

  const payload: Record<string, unknown> = {
    model: options.model ?? 'veo3-fast',
    prompt,
    enhance_prompt: options.enhancePrompt ?? true,
    enable_upsample: options.enableUpsample ?? false,
    aspect_ratio: options.aspectRatio ?? '16:9'
  }

  if (options.images && options.images.length) {
    payload.images = options.images
  }

  const response = await fetch('https://yunwu.ai/v1/video/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const errorPayload = await response.text()
    throw new Error(`Veo3 API error: ${response.status} ${errorPayload}`)
  }

  const data = await response.json()
  const jobId = data?.id ?? data?.choices?.[0]?.message?.content ?? `veo3-${Date.now()}`
  const status = data?.choices?.[0]?.finish_reason ?? 'submitted'

  return {
    id: jobId,
    status,
    response: data
  }
}

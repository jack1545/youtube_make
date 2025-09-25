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
  // Call server-side route to handle API key and external request
  const response = await fetch('/api/veo3/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, options })
  })

  if (!response.ok) {
    const errorPayload = await response.text()
    throw new Error(`Veo3 create route error: ${response.status} ${errorPayload}`)
  }

  const data = await response.json()
  return {
    id: data.id,
    status: data.status,
    response: data.response
  }
}

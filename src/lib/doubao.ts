const buildPlaceholderUrl = (label: string) => `https://via.placeholder.com/1024x1024?text=${encodeURIComponent(label)}`

export interface ImageGenerationParams {
  prompt: string
  size?: string
  responseFormat?: 'url' | 'b64_json'
  referenceImageUrl?: string
  referenceImageUrls?: string[]
}

export interface GeneratedImage {
  url: string
  prompt: string
  referenceImageUrl?: string
  referenceImageUrls?: string[]
}

export interface BatchImageRequest {
  prompt: string
  referenceImageUrl?: string
  referenceImageUrls?: string[]
  size?: string
}

export interface BatchGenerationOptions {
  onProgress?: (completed: number, total: number) => void
  size?: string
  responseFormat?: 'url' | 'b64_json'
}

export async function generateImage(params: ImageGenerationParams): Promise<GeneratedImage> {
  const apiKey = process.env.DOUBAO_API_KEY
  // Compute reference URLs early so all return paths can include them
  const referenceUrls = params.referenceImageUrls ?? (params.referenceImageUrl ? [params.referenceImageUrl] : undefined)
  const isMissingKey = !apiKey || apiKey === 'your_doubao_api_key' || (typeof apiKey === 'string' && apiKey.length < 20)

  if (isMissingKey) {
    console.warn('Doubao API key not configured, returning placeholder image')
    return {
      url: buildPlaceholderUrl('Doubao Placeholder'),
      prompt: params.prompt,
      referenceImageUrl: params.referenceImageUrl,
      referenceImageUrls: referenceUrls
    }
  }

  try {
    // 调用 Doubao Seedream 4.0 图像生成接口
    const payload: Record<string, unknown> = {
      model: 'doubao-seedream-4-0-250828',
      prompt: params.prompt,
      size: params.size || '1024x1024',
      response_format: params.responseFormat || 'url'
    }

    if (referenceUrls && referenceUrls.length) {
      // 根据用户提供的请求格式，使用 image 数组，并保留 image_urls 以兼容不同网关
      ;(payload as any).image = referenceUrls
      ;(payload as any).image_urls = referenceUrls
      ;(payload as any).sequential_image_generation = 'auto'
      ;(payload as any).sequential_image_generation_options = { max_images: 1 }
    }

    const response = await fetch('https://yunwu.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`Image generation failed: ${response.status}`)
    }

    const data = await response.json()
    const imageUrl = data?.data?.[0]?.url || buildPlaceholderUrl('Generated Image')

    return {
      url: imageUrl,
      prompt: params.prompt,
      referenceImageUrl: params.referenceImageUrl,
      referenceImageUrls: referenceUrls
    }
  } catch (error) {
    console.error('Error generating image:', error)
    return {
      url: buildPlaceholderUrl('Generated Image Error'),
      prompt: params.prompt,
      referenceImageUrl: params.referenceImageUrl,
      referenceImageUrls: referenceUrls
    }
  }
}

export async function generateBatchImages(
  entries: (string | BatchImageRequest)[],
  options: BatchGenerationOptions = {}
): Promise<GeneratedImage[]> {
  const requests: BatchImageRequest[] = entries.map(entry =>
    typeof entry === 'string' ? { prompt: entry } : entry
  )

  // When running in the browser, defer to the Next.js API route so the server-side
  // environment (or Supabase stored key) can supply the Doubao credential safely.
  if (typeof window !== 'undefined') {
    const response = await fetch('/api/doubao/generate-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests,
        options: {
          size: options.size,
          responseFormat: options.responseFormat
        }
      })
    })

    if (!response.ok) {
      const errorPayload = await response.text()
      throw new Error(`Doubao batch API failed: ${response.status} ${errorPayload}`)
    }

    const data: { results: GeneratedImage[] } = await response.json()
    data.results.forEach((result, index) => {
      options.onProgress?.(index + 1, data.results.length)
    })
    return data.results
  }

  const results: GeneratedImage[] = []

  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i]
    try {
      const image = await generateImage({
        prompt: request.prompt,
        referenceImageUrl: request.referenceImageUrl,
        referenceImageUrls: request.referenceImageUrls,
        size: request.size || options.size,
        responseFormat: options.responseFormat
      })
      results.push(image)
      options.onProgress?.(i + 1, requests.length)
    } catch (error) {
      console.error(`Failed to generate image ${i + 1}:`, error)
      results.push({
        url: buildPlaceholderUrl('Doubao Error'),
        prompt: request.prompt,
        referenceImageUrl: request.referenceImageUrl,
        referenceImageUrls: request.referenceImageUrls
      })
    }
  }

  return results
}

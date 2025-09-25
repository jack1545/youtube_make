import { NextResponse } from 'next/server'
import { getApiKeySettings } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}))
    const taskId: string | undefined = payload?.taskId || payload?.task_id || payload?.id
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
    }

    // Resolve API key from environment or database settings
    const envKey = process.env.VEO3_API_KEY || ''
    let apiKey = envKey
    if (!apiKey || apiKey.length < 16) {
      try {
        const settings = await getApiKeySettings()
        apiKey = settings.veo3_api_key || ''
      } catch (e) {
        // ignore and keep empty
      }
    }

    if (!apiKey || apiKey.length < 16) {
      return NextResponse.json({
        id: taskId,
        status: 'pending',
        response: { message: 'Missing VEO3 API key; cannot fetch task detail yet.' }
      }, { status: 200 })
    }

    const url = 'https://yunwu.ai/v1/task/detail'
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ task_id: taskId })
    })

    const text = await response.text()
    if (!response.ok) {
      return NextResponse.json({ error: `Task detail error: ${response.status} ${text}` }, { status: response.status })
    }

    let data: any
    try { data = JSON.parse(text) } catch { data = text }

    return NextResponse.json({
      id: data?.data?.id || data?.id || taskId,
      status: data?.data?.status || data?.status || data?.detail?.status || 'unknown',
      response: data,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('id') || searchParams.get('taskId') || searchParams.get('task_id') || ''
    if (!q) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Clean raw id (remove backticks and spaces)
    const rawId = q.replace(/[`\s]/g, '')

    // Prepare ID variants for video/query
    const suffix = rawId.includes(':') ? rawId.split(':', 2)[1] : rawId
    const idVariants = Array.from(new Set([
      `veo3:${suffix}`,
      rawId,
      `veo3-fast-frames:${suffix}`,
    ]))

    // Resolve API key
    const envKey = process.env.VEO3_API_KEY || ''
    let apiKey = envKey
    if (!apiKey || apiKey.length < 16) {
      try {
        const settings = await getApiKeySettings()
        apiKey = settings.veo3_api_key || ''
      } catch (e) {
        // ignore
      }
    }

    if (!apiKey || apiKey.length < 16) {
      return NextResponse.json({
        id: idVariants[0],
        status: 'pending',
        response: { message: 'Missing VEO3 API key; cannot fetch task detail yet.' }
      }, { status: 200 })
    }

    // Try video/query with variants
    let lastErrorText = ''
    for (const vid of idVariants) {
      const yunwuUrl = `https://yunwu.ai/v1/video/query?id=${encodeURIComponent(vid)}`
      const resp = await fetch(yunwuUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      })
      const text = await resp.text()
      if (resp.ok) {
        let data: any
        try { data = JSON.parse(text) } catch { data = text }
        const status = data?.status ?? data?.data?.status ?? data?.detail?.status ?? 'unknown'
        const video_url: string | undefined = data?.video_url ?? data?.data?.video_url ?? data?.detail?.video_url
        return NextResponse.json({
          id: data?.id ?? data?.data?.id ?? vid,
          status,
          video_url,
          response: data
        })
      }
      lastErrorText = `video/query ${resp.status} ${text}`
    }

    // All variants failed -> fallback to task/detail with rawId as task_id
    const detailResp = await fetch('https://yunwu.ai/v1/task/detail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ task_id: rawId })
    })
    const detailText = await detailResp.text()
    if (!detailResp.ok) {
      return NextResponse.json({ error: `All video/query variants failed: ${lastErrorText}; fallback error: ${detailResp.status} ${detailText}` }, { status: detailResp.status })
    }

    let data: any
    try { data = JSON.parse(detailText) } catch { data = detailText }
    const status = data?.status ?? data?.data?.status ?? data?.detail?.status ?? 'unknown'
    const video_url: string | undefined = data?.video_url ?? data?.data?.video_url ?? data?.detail?.video_url

    return NextResponse.json({
      id: data?.id ?? data?.data?.id ?? idVariants[0],
      status,
      video_url,
      response: data
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 })
  }
}
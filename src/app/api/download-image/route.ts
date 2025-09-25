import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetUrl = searchParams.get('url')
  const filename = searchParams.get('filename') || 'download'

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    const upstream = await fetch(targetUrl, { cache: 'no-store' })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Upstream fetch failed: ${upstream.status}` }, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)

    // Stream the body directly to the client
    return new Response(upstream.body, {
      status: 200,
      headers
    })
  } catch (err) {
    console.error('download-image route error:', err)
    return NextResponse.json({ error: 'Failed to fetch resource' }, { status: 500 })
  }
}
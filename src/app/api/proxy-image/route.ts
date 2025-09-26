export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const target = url.searchParams.get('url')
    if (!target) {
      return new Response('Missing url parameter', { status: 400 })
    }

    // 基本校验，仅允许 http/https
    const targetUrl = new URL(target)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return new Response('Invalid protocol', { status: 400 })
    }

    // 服务器端拉取图片
    const resp = await fetch(target, { redirect: 'follow' })
    if (!resp.ok) {
      return new Response(`Upstream fetch failed: ${resp.status}`, { status: 502 })
    }

    const contentType = resp.headers.get('content-type') || 'image/png'
    const arrayBuffer = await resp.arrayBuffer()

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    // 允许跨域访问此代理资源，便于前端使用 clipboard
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cache-Control', 'public, max-age=60')

    return new Response(arrayBuffer, { status: 200, headers })
  } catch (error) {
    console.error('[proxy-image] error', error)
    return new Response('Internal error', { status: 500 })
  }
}
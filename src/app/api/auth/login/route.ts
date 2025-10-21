import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { username?: string; password?: string }
    const username = (body.username || '').trim()
    const password = (body.password || '').trim()

    const expectedUser = process.env.ADMIN_USERNAME || 'admin'
    const expectedPass = process.env.ADMIN_PASSWORD || 'admin123'

    if (!username || !password) {
      return NextResponse.json({ ok: false, error: '缺少用户名或密码' }, { status: 400 })
    }

    if (username === expectedUser && password === expectedPass) {
      const res = NextResponse.json({ ok: true, role: 'admin' })
      // Cookie 简单存储角色信息；生产环境建议使用签名/加密
      res.cookies.set('cw_session', 'role=admin', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      })
      return res
    }

    return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || '服务器错误' }, { status: 500 })
  }
}
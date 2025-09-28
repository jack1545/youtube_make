import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/reference-images?user_id=...&limit=10&before=ISO8601
export async function GET(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Supabase 未配置' }, { status: 400 })
    }

    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before') // created_at 游标
    const limit = Math.max(1, Math.min(Number(limitStr) || 10, 50))

    if (!userId) {
      return NextResponse.json({ error: '缺少 user_id 参数' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    let query = supabase
      .from('reference_images')
      .select('id,user_id,url,label,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (before) {
      query = query.lt('created_at', before)
    }

    const { data, error } = await query

    if (error) {
      const code = (error as any)?.code
      const message = (error as any)?.message
      console.error('API:get reference_images error', { code, message })
      // 若为 Postgres statement_timeout（57014），避免前端报错，返回空列表
      if (code === '57014' || /statement timeout/i.test(message || '')) {
        return NextResponse.json({ items: [], warning: 'statement_timeout' }, { status: 200 })
      }
      return NextResponse.json({ error: '查询参考图失败' }, { status: 500 })
    }

    return NextResponse.json({ items: data || [] })
  } catch (err: any) {
    console.error('API:get reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// POST /api/reference-images
// body: { url: string, label?: string, user_id: string }
export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Supabase 未配置' }, { status: 400 })
    }

    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }

    const { url, label, user_id } = payload as { url?: string; label?: string; user_id?: string }
    if (!url || typeof url !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 url 或 user_id' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await supabase
      .from('reference_images')
      .insert([{ url, label: label ?? null, user_id }])
      .select()
      .single()

    if (error) {
      console.error('API:insert reference_images error', { code: (error as any)?.code, message: (error as any)?.message })
      return NextResponse.json({ error: '新增参考图失败' }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (err: any) {
    console.error('API:insert reference_images exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}
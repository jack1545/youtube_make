import { NextResponse, NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 })
  }

  const supabase = createClient(url, key)
  const { data, error } = await supabase
    .from('script_analyses')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })
  }

  return NextResponse.json(data, { status: 200 })
}
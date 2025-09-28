import { NextResponse } from 'next/server'
import { getApiKeySettings } from '@/lib/db'

interface AnalyzeRequestBody {
  scriptText?: string
  scriptId?: string | null
}

function buildAnalyzePrompt(scriptText: string): string {
  const userPrompt = `原始脚本：\n${scriptText}\n\n[任务]: 深度分析原始脚本，提炼出其独特的：📜 故事框架、🔥 核心元素 、 📈 情绪曲线、改编思路。\n输出: 将你的分析结果清晰地呈现给用户，并推荐2-3个经过验证的爆款叙事公式，以及细化到特定分镜的改编思路**。`
  return userPrompt
}

function fallbackAnalysis(scriptText: string): string {
  const trimmed = (scriptText || '').slice(0, 800)
  return [
    '【离线分析（示例）】由于未配置 Gemini API Key，下面为基于启发式的分析模板：',
    '— 原始脚本摘要 —',
    trimmed || '（未提供脚本内容）',
    '',
    '— 故事框架 —',
    '开端：设定世界观与主冲突\n发展：角色推动事件，情绪逐步累积\n高潮：核心矛盾爆发，触达主题\n结尾：反转或余韵收束',
    '',
    '— 核心元素 —',
    '角色：主角/对手/关键助力\n场景：1-3个高记忆点场景\n意象：贯穿全片的视觉/听觉母题',
    '',
    '— 情绪曲线 —',
    '平稳→好奇→紧张→释怀/振奋（示意）',
    '',
    '— 爆款叙事公式（示例） —',
    '1) 三段式钩子（钩子-信息差-兑现）\n2) 问题-方案-转变\n3) 反预期-验证-扩展',
    '',
    '— 分镜改编思路（示例） —',
    'Shot 1：以强钩子开场，制造信息差\nShot 2-3：连续视觉线索推进，埋下悬念\nShot 4-6：对比/反转，提升张力\nShot 7-8：主题兑现与行动号召',
  ].join('\n')
}

export async function POST(req: Request) {
  let body: AnalyzeRequestBody | null = null
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const scriptText = (body?.scriptText || '').trim()
  const scriptId = (body?.scriptId || null) as string | null
  if (!scriptText) {
    return NextResponse.json({ error: 'Missing scriptText' }, { status: 400 })
  }

  // Resolve API key from env or Supabase settings
  let apiKey = process.env.GEMINI_API_KEY || ''
  if (!apiKey || apiKey === 'your_gemini_api_key' || apiKey.length < 16) {
    try {
      const settings = await getApiKeySettings()
      apiKey = settings.gemini_api_key || ''
    } catch (e) {
      // ignore
    }
  }

  if (!apiKey || apiKey.length < 16) {
    const analysis = fallbackAnalysis(scriptText)
    let saved = false
    let id: string | undefined
    try {
      if (scriptId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (supabaseUrl && serviceRoleKey) {
          const { createClient } = await import('@supabase/supabase-js')
          const supabase = createClient(supabaseUrl, serviceRoleKey)
          const { data: inserted, error } = await supabase
            .from('script_analyses')
            .insert({ script_id: scriptId, analysis })
            .select()
            .single()
          if (!error && inserted?.id) {
            saved = true
            id = inserted.id
          }
        }
      }
    } catch (persistErr) {
      console.warn('Failed to persist script analysis (demo):', persistErr)
    }
    return NextResponse.json({ analysis, demo: true, saved, id }, { status: 200 })
  }

  const url = 'https://yunwu.ai/v1/chat/completions'
  const prompt = buildAnalyzePrompt(scriptText)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        top_p: 1,
        stream: false
      })
    })

    const text = await response.text()
    if (!response.ok) {
      const analysis = fallbackAnalysis(scriptText)
      let saved = false
      let id: string | undefined
      try {
        if (scriptId) {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
          const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (supabaseUrl && serviceRoleKey) {
            const { createClient } = await import('@supabase/supabase-js')
            const supabase = createClient(supabaseUrl, serviceRoleKey)
            const { data: inserted, error } = await supabase
              .from('script_analyses')
              .insert({ script_id: scriptId, analysis })
              .select()
              .single()
            if (!error && inserted?.id) {
              saved = true
              id = inserted.id
            }
          }
        }
      } catch (persistErr) {
        console.warn('Failed to persist script analysis (Gemini error):', persistErr)
      }
      return NextResponse.json({ analysis, error: `Gemini error: ${response.status} ${text}` , saved, id }, { status: 200 })
    }

    let data: any = {}
    try { data = JSON.parse(text) } catch { /* keep empty */ }

    const content: string = data?.choices?.[0]?.message?.content || ''
    if (!content) {
      const analysis = fallbackAnalysis(scriptText)
      let saved = false
      let id: string | undefined
      try {
        if (scriptId) {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
          const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (supabaseUrl && serviceRoleKey) {
            const { createClient } = await import('@supabase/supabase-js')
            const supabase = createClient(supabaseUrl, serviceRoleKey)
            const { data: inserted, error } = await supabase
              .from('script_analyses')
              .insert({ script_id: scriptId, analysis })
              .select()
              .single()
            if (!error && inserted?.id) {
              saved = true
              id = inserted.id
            }
          }
        }
      } catch (persistErr) {
        console.warn('Failed to persist script analysis (empty response):', persistErr)
      }
      return NextResponse.json({ analysis, error: 'Empty response', saved, id }, { status: 200 })
    }

    // Attempt to persist analysis if scriptId is provided and server-side Supabase creds exist
    let saved = false
    let id: string | undefined
    try {
      if (scriptId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (supabaseUrl && serviceRoleKey) {
          const { createClient } = await import('@supabase/supabase-js')
          const supabase = createClient(supabaseUrl, serviceRoleKey)
          const { data: inserted, error } = await supabase
            .from('script_analyses')
            .insert({ script_id: scriptId, analysis: content })
            .select()
            .single()
          if (!error && inserted?.id) {
            saved = true
            id = inserted.id
          }
        }
      }
    } catch (persistErr) {
      console.warn('Failed to persist script analysis, will still return content:', persistErr)
    }

    return NextResponse.json({ analysis: content, saved, id }, { status: 200 })
  } catch (err) {
    console.error('analyze-script error', err)
    const analysis = fallbackAnalysis(scriptText)
    let saved = false
    let id: string | undefined
    try {
      if (scriptId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (supabaseUrl && serviceRoleKey) {
          const { createClient } = await import('@supabase/supabase-js')
          const supabase = createClient(supabaseUrl, serviceRoleKey)
          const { data: inserted, error } = await supabase
            .from('script_analyses')
            .insert({ script_id: scriptId, analysis })
            .select()
            .single()
          if (!error && inserted?.id) {
            saved = true
            id = inserted.id
          }
        }
      }
    } catch (persistErr) {
      console.warn('Failed to persist script analysis (catch):', persistErr)
    }
    return NextResponse.json({ analysis, saved, id }, { status: 200 })
  }
}
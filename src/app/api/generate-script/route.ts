import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { generateScript as generateScriptWithGemini } from '@/lib/gemini'
import type { ScriptSegment } from '@/lib/types'

interface GeneratedScript {
  id: string
  title: string
  segments: ScriptSegment[]
  type: 'generated' | 'persisted'
}

function generateFallbackScript(outline: string, count: number): ScriptSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `segment_${i + 1}`,
    scene: `静态瞬间${i + 1}: ${outline.slice(0, 30)}...`,
    prompt: `专业视觉分镜：${outline.slice(0, 50)}... 角色A站立在画面中央，表情平静，平视角度，中景构图。环境简洁，光线自然。`,
    characters: i === 0 ? ['角色A'] : i === 1 ? ['角色A', '角色B'] : ['角色A'],
    setting: i % 2 === 0 ? '室内环境' : '室外环境',
    mood: ['平静', '思考', '期待', '专注', '疑惑'][i % 5],
    prompt_detail: {
      subject: {
        characters_present: i === 1 ? '角色A, 角色B' : '角色A',
        expression: '角色A：平静',
        action: '角色A静止站立，捕捉一个凝固瞬间'
      },
      environment: i % 2 === 0 ? '室内简洁环境' : '室外自然环境',
      time_of_day: '白天',
      weather: '晴天',
      camera_angle: '平视',
      shot_size: '中景'
    }
  }))
}

function buildFallbackScripts(outline: string, scriptCount: number, segmentsPerScript: number): GeneratedScript[] {
  return Array.from({ length: scriptCount }, (_, i) => ({
    id: `fallback_${Date.now()}_${i + 1}`,
    title: `脚本草稿 ${i + 1}`,
    segments: generateFallbackScript(outline, segmentsPerScript),
    type: 'generated'
  }))
}

export async function POST(req: Request) {
  let outline = ''
  let count = 1
  const segmentsPerScript = Number(process.env.SEGMENTS_PER_SCRIPT || 8)

  try {
    const { storyOutline, segmentCount: requestedSegments, scriptCount } = await req.json()
    if (!storyOutline || typeof storyOutline !== 'string') {
      return NextResponse.json({ error: 'Invalid storyOutline' }, { status: 400 })
    }

    outline = storyOutline
    const segCount = typeof requestedSegments === 'number' && requestedSegments > 0 ? requestedSegments : segmentsPerScript
    count = typeof scriptCount === 'number' && scriptCount > 0 ? scriptCount : 1

    let apiKey = process.env.GEMINI_API_KEY

    if (!apiKey || apiKey === 'your_gemini_api_key' || apiKey.length < 10) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      const adminId = process.env.ADMIN_ID || 'admin_001'

      if (supabaseUrl && serviceRoleKey) {
        try {
          const supabase = createClient(supabaseUrl, serviceRoleKey)
          const { data, error } = await supabase
            .from('api_key_settings')
            .select('gemini_api_key')
            .eq('user_id', adminId)
            .maybeSingle()

          if (!error && data?.gemini_api_key) {
            apiKey = data.gemini_api_key
          }
        } catch (lookupError) {
          console.error('Failed to retrieve Gemini API key from Supabase', lookupError)
        }
      }
    }

    if (!apiKey || apiKey === 'your_gemini_api_key' || apiKey.length < 10) {
      // Client currently expects array of ScriptSegment, so return one draft's segments directly
      return NextResponse.json(generateFallbackScript(outline, segCount), { status: 200 })
    }

    // If client requests multiple scripts, we still return segments for the first one to match client expectations
    try {
      const segments = await generateScriptWithGemini(outline, {
        scriptNumber: 1,
        totalScripts: count,
        segmentCount: segCount,
        apiKey
      })
      return NextResponse.json(segments, { status: 200 })
    } catch (generationError) {
      console.error('Failed to generate script with Gemini', generationError)
      return NextResponse.json(generateFallbackScript(outline, segCount), { status: 200 })
    }
  } catch (error) {
    console.error('generate-script error', error)
    return NextResponse.json(generateFallbackScript(outline || '故事大纲', Number(process.env.SEGMENTS_PER_SCRIPT || 8)), { status: 200 })
  }
}
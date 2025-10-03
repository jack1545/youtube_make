import { NextResponse } from 'next/server'
import { getApiKeySettings } from '@/lib/db'

interface RequestBody {
  scriptText?: string
  worldview?: string
  core?: string
  elements?: string
  references?: string
}

function buildPrompt(scriptText: string): string {
  // 根据需求：在原始脚本后追加赛博朋克（含蒸汽动力与维多利亚美学）的环境改写指令，并保持CSV格式输出。
  const instruction = `将原始脚本中的[环境]根据赛博朋克的世界观进行修改，保留原核心场景，以原脚本的csv格式返回\n赛博朋克的设定：核心设定：科技基于「蒸汽动力」，融合维多利亚时代美学，呈现“复古科技的浪漫”；关键元素：黄铜机械、蒸汽引擎、齿轮结构、飞艇、贵族与工匠的阶级对比、复古服饰；参考案例：《哈尔的移动城堡》《差分机》`

  const formatGuide = `【输出格式要求】：\n- 严格按CSV文本，首行是表头：分镜数,分镜提示词。\n- 每行一条分镜，分镜提示词使用以下中文标签并置于双引号内，且每个标签独立为一行：\n  [主体]\\n角色：...\\n表情：...\\n动作：...\\n[环境]\\n...\\n[时间]\\n...\\n[天气]\\n...\\n[视角]\\n平视/仰视/俯视/鸟瞰视角\\n[景别]\\n远景/全景/中景/近景/特写`

  return `${scriptText}\n${instruction}\n${formatGuide}`
}

function tryJsonToCsv(scriptText: string): string | null {
  try {
    const normalized = (scriptText || '').trim()
    if (normalized.startsWith('[')) {
      const arr = JSON.parse(normalized) as Array<any>
      const lines = arr.map((item, idx) => {
        const num = Number(item?.shot_number ?? idx + 1)
        const text = (item?.prompt_text ?? item?.prompt ?? '').toString().trim().replace(/\n/g, ' ')
        const clean = text || '固定镜头, 主体静止瞬间描写'
        return `${num},"${clean.replace(/"/g, '"')}"`
      })
      return ['分镜数,分镜提示词', ...lines].join('\n')
    }
  } catch {}
  return null
}

function fallbackCsv(scriptText: string): string {
  const fromJson = tryJsonToCsv(scriptText)
  if (fromJson) return fromJson
  return [
    '分镜数,分镜提示词',
    '1,"平视中景, 一只悲伤的小猫坐在空荡的金属食盆旁, 低头凝视"',
    '2,"平视中景, 角色A失落地站在厨房里, 目光向下看着画外的小猫"'
  ].join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const scriptText = (body.scriptText || '').trim()
    const worldview = (body.worldview || '').trim() || '赛博朋克'
    if (!scriptText) {
      return NextResponse.json({ error: 'Missing scriptText' }, { status: 400 })
    }

    const settings = await getApiKeySettings()
    const apiKey = settings.gemini_api_key

    if (!apiKey || apiKey.length < 10) {
      const csv = fallbackCsv(scriptText)
      return NextResponse.json({ csv, demo: true }, { status: 200 })
    }

    const url = 'https://yunwu.ai/v1/chat/completions'
    const prompt = buildPrompt(scriptText)

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
      const csv = fallbackCsv(scriptText)
      return NextResponse.json({ csv, demo: true }, { status: 200 })
    }

    let content: string
    try {
      const data: any = JSON.parse(text)
      content = data?.choices?.[0]?.message?.content ?? text
    } catch {
      content = text
    }
    return NextResponse.json({ csv: content }, { status: 200 })
  } catch (error) {
    console.error('worldview-rewrite error', error)
    return NextResponse.json({ csv: fallbackCsv('') }, { status: 200 })
  }
}
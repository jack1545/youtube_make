import { NextResponse } from 'next/server'
import { getApiKeySettings } from '@/lib/db'

interface RequestBody {
  scriptText?: string
  worldview?: string
  core?: string
  elements?: string
  references?: string
}

function buildPrompt(scriptText: string, worldview: string, core?: string, elements?: string, references?: string): string {
  const details = [
    core ? `【核心设定】：${core}` : null,
    elements ? `【关键元素】：${elements}` : null,
    references ? `【参考案例】：${references}` : null
  ].filter(Boolean).join('\n')

  const template = `你是一名资深编剧与世界观架构师。
【任务】：基于下面的原始脚本，应用“${worldview}”世界观进行改写；保持核心叙事骨架与镜头顺序不变，但用符合该世界观的元素、场景、情绪重写文本。
${details ? details + '\n' : ''}
【输出格式要求】：
- 严格按CSV文本，首行是表头：分镜数,分镜提示词。
- 每行一条分镜，分镜提示词使用以下中文标签并置于双引号内，且每个标签独立为一行：
  [主体]\n角色：...\n表情：...\n动作：...\n[环境]\n...\n[时间]\n...\n[天气]\n...\n[视角]\n平视/仰视/俯视/鸟瞰视角\n[景别]\n远景/全景/中景/近景/特写

【CSV示例】
分镜数,分镜提示词
1,"[主体]\n角色：角色A\n表情：开心\n动作：角色A坐在桌前，双手放在桌上。\n[环境]\n一个现代风格的厨房，背景是橱柜和灶台。\n[时间]\n白天\n[天气]\n无\n[视角]\n平视\n[景别]\n中景"
2,"[主体]\n角色：角色B\n表情：愤怒\n动作：角色B站在角色A的后面，举起一只手。\n[环境]\n一个现代风格的厨房，角色A坐在前景的桌子旁。\n[时间]\n白天\n[天气]\n无\n[视角]\n平视\n[景别]\n全景"

【原始脚本】：
${scriptText}
`
  return template
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
    const prompt = buildPrompt(scriptText, worldview, body.core, body.elements, body.references)

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
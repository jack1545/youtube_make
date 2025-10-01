import { NextResponse } from 'next/server'
import { getApiKeySettings } from '@/lib/db'

interface RequestBody {
  scriptText?: string
}

function buildPrompt(scriptText: string): string {
  const template = `你是一名世界顶级的生成式视频AI提示词工程师，是拥有专业艺术直觉的“虚拟导演”。
【任务】：将下面的原始脚本解析为“视频分镜提示词”，每条分镜仅包含精炼的运镜与动作表达。
【输出格式】：严格文本，每行一条，格式为：<编号>. <分镜提示词>。不要CSV，不要表头，不要引号，不要额外解释。
示例：
1. 平视中景, 一只悲伤的小猫坐在空荡的金属食盆旁, 低头凝视
2. 平视中景, 角色A失落地站在厨房里, 目光向下看着画外的小猫

【原始脚本】:
${scriptText}
`
  return template
}

function transformToText(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  // 若模型返回了CSV，尝试转换为纯文本行：n."xxx" -> n. xxx
  if (/分镜数\s*,\s*分镜提示词/.test(s)) {
    const lines = s.split(/\r?\n/).filter(Boolean)
    const body = lines.slice(1)
    const mapped = body.map(line => {
      const m = line.match(/^\s*(\d+)\s*,\s*"?(.*?)"?\s*$/)
      if (m) return `${m[1]}. ${m[2]}`
      const m2 = line.match(/^\s*(\d+)\s*,\s*(.*)$/)
      if (m2) return `${m2[1]}. ${m2[2]}`
      return line.replace(/^\s*\d+\s*,\s*/, (num) => `${num.replace(/,\s*$/, '')}. `)
    })
    return mapped.join('\n')
  }
  // 若已是纯文本，直接返回；但去掉可能的引号与多余空白
  return s.replace(/^\d+\s*,/gm, (num) => `${num.replace(/,\s*$/, '')}. `)
}

function fallbackText(scriptText: string): string {
  // 尝试从JSON数组中读取分镜并生成纯文本行
  try {
    const normalized = scriptText.trim()
    const isJsonArray = normalized.startsWith('[')
    if (isJsonArray) {
      const arr = JSON.parse(normalized) as Array<any>
      const lines = arr.map((item, idx) => {
        const num = Number(item?.shot_number ?? idx + 1)
        const text = (item?.prompt_text ?? item?.prompt ?? '').toString().trim()
        const clean = text ? text.replace(/\n/g, ' ') : '固定镜头, 主体静止瞬间描写'
        return `${num}. ${clean}`
      })
      return lines.join('\n')
    }
  } catch {}
  // 非JSON或解析失败时，输出两条示例（纯文本行）
  return [
    '1. 平视中景, 一只悲伤的小猫坐在空荡的金属食盆旁, 低头凝视',
    '2. 平视中景, 角色A失落地站在厨房里, 目光向下看着画外的小猫'
  ].join('\n')
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const scriptText = (body.scriptText || '').trim()
    if (!scriptText) {
      return NextResponse.json({ error: 'Missing scriptText' }, { status: 400 })
    }

    const settings = await getApiKeySettings()
    const apiKey = settings.gemini_api_key

    if (!apiKey || apiKey.length < 10) {
      const textOut = fallbackText(scriptText)
      return NextResponse.json({ text: textOut, demo: true }, { status: 200 })
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
      const textOut = fallbackText(scriptText)
      return NextResponse.json({ text: textOut, demo: true }, { status: 200 })
    }

    let content: string
    try {
      const data: any = JSON.parse(text)
      content = data?.choices?.[0]?.message?.content ?? text
    } catch {
      content = text
    }
    const textOut = transformToText(content)
    return NextResponse.json({ text: textOut }, { status: 200 })
  } catch (error) {
    console.error('storyboard-prompts error', error)
    return NextResponse.json({ text: fallbackText('') }, { status: 200 })
  }
}
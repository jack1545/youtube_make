import { NextResponse } from 'next/server'

interface ScriptSegment {
  id: string
  scene: string
  prompt: string
  characters: string[]
  setting: string
  mood: string
}

function createFallbackRevision(segments: ScriptSegment[] = [], instructions: string): ScriptSegment[] {
  const note = instructions.trim()
  return segments.map((segment, index) => ({
    ...segment,
    id: segment.id || `segment_${index + 1}`,
    scene: note ? `${segment.scene}（调整：${note.slice(0, 40)}）` : segment.scene,
    mood: segment.mood || '待补充'
  }))
}

export async function POST(req: Request) {
  let parsed: { instructions?: string; segments?: ScriptSegment[] }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const instructions = typeof parsed.instructions === 'string' ? parsed.instructions : ''
  const segments = Array.isArray(parsed.segments) ? parsed.segments : []

  if (!segments.length) {
    return NextResponse.json({ error: 'Invalid segments' }, { status: 400 })
  }

  if (!instructions.trim()) {
    return NextResponse.json({ error: 'Invalid instructions' }, { status: 400 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey === 'your_gemini_api_key' || apiKey.length < 10) {
    return NextResponse.json(createFallbackRevision(segments, instructions), { status: 200 })
  }

  const prompt = `ROLE: Lyra v2 - Script Revision Specialist
\nYou are Lyra v2, a professional production assistant. Revise the given script segments based on the producer's instructions while keeping IDs stable.
\nREVISION INSTRUCTIONS:\n${instructions}
\nCURRENT SCRIPT SEGMENTS (JSON):\n${JSON.stringify(segments, null, 2)}
\nEXPECTATIONS:\n- Return JSON array with the same segment IDs.\n- Every segment must remain a static visual moment.\n- Update scene/prompt/setting/mood/characters to follow the instructions precisely.\n- Ensure each prompt remains production ready.
`

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          topP: 1,
          topK: 1,
          maxOutputTokens: 2048
        }
      })
    })

    if (!response.ok) {
      return NextResponse.json(createFallbackRevision(segments, instructions), { status: 200 })
    }

    const data = await response.json()
    const generatedText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const jsonMatch = generatedText.match(/\[[\s\S]*\]/)

    if (!jsonMatch) {
      return NextResponse.json(createFallbackRevision(segments, instructions), { status: 200 })
    }

    const revisedSegments = JSON.parse(jsonMatch[0]) as ScriptSegment[]
    return NextResponse.json(revisedSegments, { status: 200 })
  } catch (error) {
    console.error('refine-script error', error)
    return NextResponse.json(createFallbackRevision(segments, instructions), { status: 200 })
  }
}

import type { PromptDetail, ScriptSegment } from '@/lib/types'

interface GenerateScriptOptions {
  scriptNumber?: number
  totalScripts?: number
  segmentCount?: number
  apiKey?: string
}

const DEFAULT_SEGMENT_COUNT = 8

const MICRO_PROMPT_TEMPLATE = `
# ROLE: Lyra v2 - The Professional Production Engine

You are Lyra v2, an AI "blockbuster blueprint architect" optimised for professional creative workflows. Analyse the provided story outline to extract emotional arcs, narrative structure, and key elements. Apply opening-shot curation and Tree-of-Thought planning to deliver an adapted script without breaking the original storyline.

---

### STORY OUTLINE

\`\`\`
{{STORY_OUTLINE}}
\`\`\`

### PHASE 1: SCRIPT ARCHITECTURE WORKFLOW (Planning)

**STEP 1: DECONSTRUCTION & ANALYSIS**
- Analyse the source script, extracting narrative structure, key events, and emotional beats.

**STEP 2: SYNTHESIS & GENERATION**
- Rewrite the script while obeying every production rule below:
  1. Memory-free generation: each shot must read as a self-contained static moment.
  2. Static instant principle: describe a single frozen instant; avoid sequential motion.
  3. Preserve core storyline order unless explicitly instructed otherwise.
  4. Only perform like-for-like noun substitutions (same category replacements).
  5. Apply Tree-of-Thought planning to build a coherent visual sequence.
  6. Evaluate at least three opening shots and choose the strongest option.
  7. Refer to main roles as "Character A" / "Character B"; minor roles may use generic descriptions.
  8. Keep characters anonymous; avoid unrelated physical details.
  9. Describe poses and blocking objectively; clarify relative positions.
  10. Be decisive and directive in phrasing.
  11. Ensure 100% safety compliance.
  12. Honour the JSON template fields exactly.
  13. Mood field must use one term from: joyful, resigned, excited, angry, irritated, sad, disappointed, surprised, scared, shocked.
  14. camera_angle must be one of {eye-level, low-angle, high-angle, bird's-eye}; shot_size must be one of {long shot, wide shot, mid shot, close-up, extreme close-up}.

### PHASE 2: SELF-VERIFICATION & REWRITE (Quality gate)
- Count check: output exactly {{SEGMENT_COUNT}} shots.
- Opening check: the first shot must hook the audience.
- Narrative check: follow the original linear story logic.
- Rhythm check: align shot pacing with emotional progression.
- Compliance check: content must be fully safe and policy aligned.

---

## EXECUTION INSTRUCTIONS
- This is script {{SCRIPT_NUMBER}} of {{TOTAL_SCRIPTS}}; adapt the story while preserving the narrative skeleton.
- Output the character roster first, followed by the storyboard JSON block.
- The JSON must follow the template below with exactly {{SEGMENT_COUNT}} entries:
\`\`\`json
[
  {
    "id": "segment_1",
    "scene": "Clear, concise scene summary (static moment)",
    "prompt": "Aggregated prompt for image generation (may be composed from prompt_detail)",
    "characters": ["Character A", "Character B"],
    "setting": "Environment and location",
    "mood": "Select from the approved mood list",
    "prompt_detail": {
      "subject": {
        "characters_present": "Character A, mechanical bird",
        "expression": "Character A: excited",
        "action": "A sunlit alley: Character A rolls forward, looking up while a repaired mechanical bird tests brand-new rotor wings overhead."
      },
      "environment": "Futuristic city alley with long morning shadows.",
      "time_of_day": "Morning",
      "weather": "Clear",
      "camera_angle": "low-angle",
      "shot_size": "wide shot"
    }
  }
]
\`\`\`
- Do not output any commentary besides the character list and JSON block.
`;

function buildPrompt(storyOutline: string, scriptNumber: number, totalScripts: number, segmentCount: number): string {
  return MICRO_PROMPT_TEMPLATE
    .replace('{{STORY_OUTLINE}}', storyOutline)
    .replace('{{SCRIPT_NUMBER}}', String(scriptNumber))
    .replace('{{TOTAL_SCRIPTS}}', String(totalScripts))
    .replace(/{{SEGMENT_COUNT}}/g, String(segmentCount))
}

export async function generateScript(
  storyOutline: string,
  options: GenerateScriptOptions = {}
): Promise<ScriptSegment[]> {
  const {
    scriptNumber = 1,
    totalScripts = 1,
    segmentCount = DEFAULT_SEGMENT_COUNT,
    apiKey: overrideKey
  } = options

  const apiKey = overrideKey ?? process.env.GEMINI_API_KEY

  const isMissingKey = !apiKey || apiKey === 'your_gemini_api_key'
  const isLikelyWrongProviderKey = typeof apiKey === 'string' && apiKey.startsWith('sk-')
  const isTooShort = typeof apiKey === 'string' && apiKey.length < 30
  const isDemoMode = isMissingKey || isLikelyWrongProviderKey || isTooShort

  if (isDemoMode) {
    console.warn('Gemini API key appears invalid or is not configured, using demo fallback script')
    return generateFallbackScript(storyOutline, segmentCount)
  }

  const prompt = buildPrompt(storyOutline, scriptNumber, totalScripts, segmentCount)

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          role: 'system',
          parts: [{ text: prompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: `Generate script ${scriptNumber}/${totalScripts} following the system instructions with ${segmentCount} shots.` }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048
        }
      })
    })

    if (!response.ok) {
      const errorPayload = await response.text()
      throw new Error(`Gemini API error: ${response.status} ${errorPayload}`)
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts ?? []
    const generatedText = parts
      .map((part: { text?: string }) => part.text ?? '')
      .join('\n')
    const jsonMatch = generatedText.match(/```json[\s\S]*?```|\[[\s\S]*\]/)

    if (!jsonMatch) {
      throw new Error('Invalid response format')
    }

    const jsonString = jsonMatch[0].startsWith('```')
      ? jsonMatch[0].replace(/```json\n?/i, '').replace(/```$/, '')
      : jsonMatch[0]

    const segments = JSON.parse(jsonString) as ScriptSegment[]
    return segments.map((segment) => ({
      ...segment,
      prompt_detail: segment.prompt_detail ?? undefined
    }))
  } catch (error) {
    console.error('Error generating script:', error)
    return generateFallbackScript(storyOutline, segmentCount)
  }
}

function buildFallbackPromptDetail(index: number): PromptDetail {
  return {
    subject: {
      characters_present: index === 1 ? 'Character A, Character B' : 'Character A',
      expression: 'Character A: calm',
      action: 'Character A stands at the centre of the frame, captured in a frozen instant.'
    },
    environment: index % 2 === 0 ? 'Minimal indoor set' : 'Outdoor street environment',
    time_of_day: 'Daytime',
    weather: 'Clear',
    camera_angle: 'eye-level',
    shot_size: 'mid shot'
  }
}

function generateFallbackScript(outline: string, count: number): ScriptSegment[] {
  const fallbackMoods = ['calm', 'thoughtful', 'anticipating', 'focused', 'curious']

  return Array.from({ length: count }, (_, index) => ({
    id: `segment_${index + 1}`,
    scene: `Static moment ${index + 1}: ${outline.slice(0, 30)}...`,
    prompt: `Professional storyboard frame: ${outline.slice(0, 50)}... Character A stands centre frame with a neutral pose. Eye-level, mid shot, natural lighting.`,
    characters: index === 0 ? ['Character A'] : index === 1 ? ['Character A', 'Character B'] : ['Character A'],
    setting: index % 2 === 0 ? 'Interior environment' : 'Exterior environment',
    mood: fallbackMoods[index % fallbackMoods.length],
    prompt_detail: buildFallbackPromptDetail(index)
  }))
}

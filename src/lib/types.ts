export interface Project {
  id: string
  // 旧项目 UUID（来自 Supabase），用于逐步迁移期间的兼容与查询优化
  legacy_id?: string
  name: string
  description: string
  created_at: string
  user_id: string
}

export interface Script {
  id: string
  project_id: string
  content: ScriptSegment[]
  status: 'draft' | 'editing' | 'completed'
  created_at: string
  // 原始脚本文本（JSON/CSV 粘贴内容），用于加载与更新
  raw_text?: string
}

// Structured prompt detail for each segment
export interface PromptSubject {
  characters_present: string
  expression: string
  action: string
}

export interface PromptDetail {
  subject: PromptSubject
  environment: string
  time_of_day: string
  weather: string
  camera_angle: '平视' | '仰视' | '俯视' | '鸟瞰视角' | string
  shot_size: '远景' | '全景' | '中景' | '近景' | '特写' | string
}

export interface ScriptSegment {
  id: string
  scene: string
  prompt: string
  characters: string[]
  setting: string
  mood: string
  // Optional structured prompt details extracted from model JSON
  prompt_detail?: PromptDetail
}

export interface GeneratedImage {
  id: string
  script_id: string
  prompt: string
  image_url: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  shot_number?: number
  created_at: string
}

export interface ReferenceImage {
  id: string
  user_id: string
  url: string
  label?: string
  created_at: string
}

export interface ReferenceVideo {
  id: string
  user_id: string
  url: string
  label?: string
  script_id?: string | null
  created_at: string
}

export interface ApiKeySettings {
  user_id: string
  gemini_api_key: string
  doubao_api_key: string
  veo3_api_key: string
  updated_at: string
}

export interface GeneratedVideo {
  id: string
  user_id: string
  script_id: string | null
  image_url: string
  prompt: string
  video_url: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  shot_number?: number
  created_at: string
}

export interface ScriptAnalysis {
  id: string
  script_id: string
  analysis: string
  created_at: string
}

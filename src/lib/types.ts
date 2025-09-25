export interface Project {
  id: string
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
  created_at: string
}

export interface ReferenceImage {
  id: string
  user_id: string
  url: string
  label?: string
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
  created_at: string
}

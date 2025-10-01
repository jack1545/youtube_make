import { supabase, isDemoMode } from './supabase'
import { getCurrentUser } from './auth'
import { Project, Script, ScriptSegment, GeneratedImage, ReferenceImage, ApiKeySettings, GeneratedVideo, ReferenceVideo } from './types'

// Demo mode data storage
const demoProjects: Project[] = [
  {
    id: 'demo_project_1',
    name: 'Sample Creative Project',
    description: 'A demo project to showcase the creative workbench functionality',
    created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    user_id: 'admin_001'
  }
]
const demoScripts: Script[] = [
  {
    id: 'demo_script_1',
    project_id: 'demo_project_1',
    content: [
      {
        id: 'segment_1',
        scene: 'A peaceful forest clearing at dawn',
        prompt: 'A serene forest clearing bathed in golden morning light, with mist rising from the ground, tall pine trees surrounding the clearing, wildflowers scattered across the grass, a small stream flowing through the center',
        characters: ['narrator', 'forest creatures'],
        setting: 'Enchanted forest',
        mood: 'Peaceful and magical'
      },
      {
        id: 'segment_2',
        scene: 'A mysterious cave entrance',
        prompt: 'A dark, mysterious cave entrance hidden behind hanging vines, ancient runes carved into the stone walls, glowing crystals providing dim illumination, shadows suggesting unknown depths',
        characters: ['explorer', 'ancient spirit'],
        setting: 'Ancient cave',
        mood: 'Mysterious and adventurous'
      }
    ],
    status: 'draft',
    created_at: new Date(Date.now() - 43200000).toISOString() // 12 hours ago
  }
]
const demoImages: GeneratedImage[] = []
let demoReferenceImages: ReferenceImage[] = [
  {
    id: 'demo_ref_1',
    user_id: 'admin_001',
    url: '/reference-sample.svg',
    label: '参考图示例',
    created_at: new Date(Date.now() - 3600000).toISOString()
  }
]
let demoApiKeySettings: ApiKeySettings = {
  user_id: 'admin_001',
  gemini_api_key: '',
  doubao_api_key: '',
  veo3_api_key: '',
  updated_at: new Date().toISOString()
}
const demoVideos: GeneratedVideo[] = []

// 项目相关操作
export async function createProject(name: string, description: string): Promise<Project> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const project: Project = {
      id: `demo_${Date.now()}`,
      name,
      description,
      user_id: user.id,
      created_at: new Date().toISOString()
    }
    demoProjects.unshift(project)
    return project
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:create project failed', err)
      throw new Error(`Create project failed: ${res.status}`)
    }
    const data = await res.json()
    const item = data.item as Project
    return item
  } catch (error) {
    console.error('Failed to create project via API', error)
    // 兼容回退：若 API 不可用，避免阻断流程，创建一个本地占位项目
    const project: Project = {
      id: `local_${Date.now()}`,
      name,
      description,
      user_id: user.id,
      created_at: new Date().toISOString()
    }
    demoProjects.unshift(project)
    return project
  }
}

export async function getProjects(): Promise<Project[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return demoProjects.filter(p => p.user_id === user.id)
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/projects`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:get projects failed', err)
      return []
    }
    const data = await res.json()
    return (data.items as Project[]) || []
  } catch (error) {
    console.error('Failed to load projects via API', error)
    return []
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const user = getCurrentUser()

  if (isDemoMode) {
    // Remove project (mutate const arrays via splice)
    for (let i = demoProjects.length - 1; i >= 0; i--) {
      if (demoProjects[i].id === projectId && demoProjects[i].user_id === user.id) {
        demoProjects.splice(i, 1)
      }
    }
    // Collect related script ids
    const scriptIds = demoScripts.filter(s => s.project_id === projectId).map(s => s.id)
    // Remove scripts
    for (let i = demoScripts.length - 1; i >= 0; i--) {
      if (demoScripts[i].project_id === projectId) {
        demoScripts.splice(i, 1)
      }
    }
    // Remove generated images linked to scripts
    for (let i = demoImages.length - 1; i >= 0; i--) {
      if (scriptIds.includes(demoImages[i].script_id)) {
        demoImages.splice(i, 1)
      }
    }
    // Remove generated videos linked to scripts
    for (let i = demoVideos.length - 1; i >= 0; i--) {
      const scriptId = demoVideos[i].script_id
      if (scriptId && scriptIds.includes(scriptId)) {
        demoVideos.splice(i, 1)
      }
    }
    return
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/projects`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to delete project (HTTP ${res.status})`)
    }
    // Optionally, we could use returned deleted counts
    await res.json().catch(() => null)
  } catch (error) {
    console.error('Failed to delete project via API', error)
    throw error
  }
}

// 脚本相关操作
export async function createScript(projectId: string, content: ScriptSegment[], rawText?: string): Promise<Script> {
  if (isDemoMode) {
    const script: Script = {
      id: `demo_script_${Date.now()}`,
      project_id: projectId,
      content,
      status: 'draft',
      created_at: new Date().toISOString(),
      raw_text: rawText
    }
    demoScripts.unshift(script)
    return script
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, content, status: 'draft', raw_text: rawText })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to create script (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as Script
  } catch (error) {
    console.error('Failed to create script via API', error)
    throw error
  }
}

export async function getScripts(projectId: string): Promise<Script[]> {
  if (isDemoMode) {
    return demoScripts.filter(s => s.project_id === projectId)
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const params = new URLSearchParams({ project_id: projectId })
    const res = await fetch(`${baseOrigin}/api/scripts?${params.toString()}`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:get scripts failed', err)
      return []
    }
    const data = await res.json()
    return (data.items as Script[]) || []
  } catch (error) {
    console.error('Failed to load scripts via API', error)
    return []
  }
}

export async function updateScript(id: string, content: ScriptSegment[], rawText?: string): Promise<Script> {
  if (isDemoMode) {
    const index = demoScripts.findIndex(s => s.id === id)
    if (index !== -1) {
      demoScripts[index].content = content
      demoScripts[index].raw_text = rawText
      return demoScripts[index]
    }
    throw new Error('Script not found')
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/scripts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, content, raw_text: rawText })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to update script (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as Script
  } catch (error) {
    console.error('Failed to update script via API', error)
    throw error
  }
}

// 图片相关操作
export async function createGeneratedImage(
  scriptId: string,
  prompt: string,
  imageUrl: string,
  shotNumber?: number
): Promise<GeneratedImage> {
  // 改为始终尝试通过服务端 API 写入 MongoDB，失败时回退到本地 demo 存储
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/generated-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: scriptId, prompt, image_url: imageUrl, shot_number: shotNumber, status: 'completed' })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to add generated image (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as GeneratedImage
  } catch (error) {
    console.error('Failed to add generated image via API, falling back to local demo storage', error)
    const image: GeneratedImage = {
      id: `demo_img_${Date.now()}`,
      script_id: scriptId,
      prompt,
      image_url: imageUrl,
      status: 'completed',
      shot_number: shotNumber,
      created_at: new Date().toISOString()
    }
    demoImages.unshift(image)
    return image
  }
}

export async function getGeneratedImages(scriptId: string): Promise<GeneratedImage[]> {
  // 始终优先从服务端 API 读取，失败时回退到本地 demo 数据
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const params = new URLSearchParams({ script_id: scriptId })
    const res = await fetch(`${baseOrigin}/api/generated-images?${params.toString()}`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:get generated_images failed', err)
      return demoImages.filter(img => img.script_id === scriptId)
    }
    const data = await res.json()
    const items = (data.items as GeneratedImage[]) || []
    return items
  } catch (error) {
    console.error('Failed to load generated images via API, falling back to local demo data', error)
    return demoImages.filter(img => img.script_id === scriptId)
  }
}

export async function updateGeneratedImage(
  id: string,
  updates: { shotNumber?: number }
): Promise<GeneratedImage> {
  // 优先通过服务端 API 更新，失败时回退到本地 demo 数据
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/generated-images`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, shot_number: updates.shotNumber })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to update generated image (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as GeneratedImage
  } catch (error) {
    console.error('Failed to update generated image via API, falling back to local demo storage', error)
    const target = demoImages.find(img => img.id === id)
    if (!target) throw error
    const updated: GeneratedImage = { ...target, shot_number: updates.shotNumber ?? target.shot_number }
    const idx = demoImages.findIndex(img => img.id === id)
    if (idx >= 0) demoImages[idx] = updated
    return updated
  }
}
// 参考图相关操作
// Local cache helpers for reference images (client-side, TTL-based)
const REF_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const makeRefKey = (userId: string, before?: string, limit?: number) => `refimgs:${userId}:${before || 'latest'}:${limit ?? 10}`
function readRefCache(key: string): ReferenceImage[] | null {
  try {
    if (!isBrowser()) return null
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || !Array.isArray(obj.items) || typeof obj.ts !== 'number') return null
    if (Date.now() - obj.ts > REF_CACHE_TTL_MS) return null
    return obj.items as ReferenceImage[]
  } catch {
    return null
  }
}
function writeRefCache(key: string, items: ReferenceImage[]) {
  try {
    if (!isBrowser()) return
    window.localStorage.setItem(key, JSON.stringify({ items, ts: Date.now() }))
  } catch {}
}
function invalidateRefCaches(userId: string) {
  try {
    if (!isBrowser()) return
    const prefix = `refimgs:${userId}:`
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(prefix)) keys.push(k)
    }
    keys.forEach(k => window.localStorage.removeItem(k))
  } catch {}
}
export async function addReferenceImage(url: string, label?: string): Promise<ReferenceImage> {
  const user = getCurrentUser()

  if (isDemoMode) {
    console.warn("Supabase table 'public.reference_images' missing; using local demo storage.")
    const image: ReferenceImage = {
      id: `demo_ref_${Date.now()}`,
      user_id: user.id,
      url,
      label,
      created_at: new Date().toISOString()
    }
    demoReferenceImages.unshift(image)
    invalidateRefCaches(user.id)
    return image
  }

  // 改为服务端 API 写入，使用 service role key
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, label, user_id: user.id })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to add reference image (HTTP ${res.status})`)
    }
    const data = await res.json()
    invalidateRefCaches(user.id)
    return data.item as ReferenceImage
  } catch (error) {
    console.error('Failed to add reference image via API', error)
    throw error
  }
}

export async function getReferenceImages(limit = 10, before?: string): Promise<ReferenceImage[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const mine = demoReferenceImages.filter(img => img.user_id === user.id)
    const sortedMine = [...mine].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    if (before) {
      return sortedMine.filter(img => new Date(img.created_at).getTime() < new Date(before).getTime()).slice(0, limit)
    }
    return sortedMine.slice(0, limit)
  }

  try {
    const key = makeRefKey(user.id, before, limit)
    const cached = readRefCache(key)
    if (cached) return cached

    const params = new URLSearchParams({ user_id: user.id, limit: String(limit) })
    if (before) params.set('before', before)
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-images?${params.toString()}`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:get reference_images failed', err)
      return []
    }
    const data = await res.json()
    const items = (data.items as ReferenceImage[]) || []
    writeRefCache(key, items)
    return items
  } catch (error) {
    console.error('Failed to load reference images via API', error)
    return []
  }
}

export async function removeReferenceImage(id: string): Promise<void> {
  const user = getCurrentUser()

  if (isDemoMode) {
    demoReferenceImages = demoReferenceImages.filter(
      img => !(img.id === id && img.user_id === user.id)
    )
    invalidateRefCaches(user.id)
    return
  }

  // 改为调用服务端 API，经由 MongoDB 统一删除
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-images`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, user_id: user.id })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to delete reference image (HTTP ${res.status})`)
    }
    invalidateRefCaches(user.id)
  } catch (error) {
    console.error('Failed to delete reference image via API', error)
    throw error
  }
}

// API Key 设置
export async function getApiKeySettings(): Promise<ApiKeySettings> {
  const user = getCurrentUser()

  if (isDemoMode) {
    if (demoApiKeySettings.user_id !== user.id) {
      demoApiKeySettings = {
        user_id: user.id,
        gemini_api_key: '',
        doubao_api_key: '',
        veo3_api_key: '',
        updated_at: new Date().toISOString()
      }
    }
    return demoApiKeySettings
  }

  const { data, error } = await supabase
    .from('api_key_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.api_key_settings' missing; using local demo storage.")
    return getApiKeySettingsDemo(user.id)
  }

  if (error) throw error

  if (!data) {
    return {
      user_id: user.id,
      gemini_api_key: '',
      doubao_api_key: '',
      veo3_api_key: '',
      updated_at: new Date().toISOString()
    }
  }

  return data as ApiKeySettings
}

function getApiKeySettingsDemo(userId: string): ApiKeySettings {
  if (demoApiKeySettings.user_id !== userId) {
    demoApiKeySettings = {
      user_id: userId,
      gemini_api_key: '',
      doubao_api_key: '',
      veo3_api_key: '',
      updated_at: new Date().toISOString()
    }
  }
  return demoApiKeySettings
}

export async function saveApiKeySettings(settings: Partial<ApiKeySettings>): Promise<ApiKeySettings> {
  const user = getCurrentUser()
  const timestamp = new Date().toISOString()

  if (isDemoMode) {
    demoApiKeySettings = {
      ...demoApiKeySettings,
      ...settings,
      user_id: user.id,
      updated_at: timestamp
    }
    return demoApiKeySettings
  }

  const current = await getApiKeySettings()
  const payload: ApiKeySettings = {
    user_id: user.id,
    gemini_api_key: settings.gemini_api_key ?? current.gemini_api_key ?? '',
    doubao_api_key: settings.doubao_api_key ?? current.doubao_api_key ?? '',
    veo3_api_key: settings.veo3_api_key ?? current.veo3_api_key ?? '',
    updated_at: timestamp
  }

  const { data, error } = await supabase
    .from('api_key_settings')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.api_key_settings' missing; using local demo storage.")
    demoApiKeySettings = payload
    return demoApiKeySettings
  }

  if (error) throw error
  return data as ApiKeySettings
}

// Veo3 视频生成记录
export async function createGeneratedVideo(
  imageUrl: string,
  prompt: string,
  scriptId?: string | null,
  shotNumber?: number,
  status: string = 'pending',
  videoUrl?: string
): Promise<GeneratedVideo> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const video: GeneratedVideo = {
      id: `demo_video_${Date.now()}`,
      user_id: user.id,
      script_id: scriptId,
      image_url: imageUrl,
      prompt,
      video_url: typeof videoUrl === 'string' ? videoUrl : '',
      status,
      shot_number: shotNumber,
      created_at: new Date().toISOString()
    }
    demoVideos.unshift(video)
    return video
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/generated-videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, prompt, script_id: scriptId ?? null, shot_number: shotNumber, status, video_url: videoUrl })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to add generated video (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as GeneratedVideo
  } catch (error) {
    console.error('Failed to add generated video via API, falling back to local demo storage', error)
    const user = getCurrentUser()
    const video: GeneratedVideo = {
      id: `demo_video_${Date.now()}`,
      user_id: user.id,
      script_id: typeof scriptId === 'string' ? scriptId : null,
      image_url: imageUrl,
      prompt,
      video_url: typeof videoUrl === 'string' ? videoUrl : '',
      status,
      shot_number: shotNumber,
      created_at: new Date().toISOString()
    }
    demoVideos.unshift(video)
    return video
  }
}

export async function updateGeneratedVideoStatus(
  id: string,
  updates: Partial<Pick<GeneratedVideo, 'status' | 'video_url'>>
): Promise<GeneratedVideo> {
  if (isDemoMode) {
    const index = demoVideos.findIndex(video => video.id === id)
    if (index === -1) throw new Error('Video not found')
    demoVideos[index] = {
      ...demoVideos[index],
      ...updates
    }
    return demoVideos[index]
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/generated-videos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to update generated video (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as GeneratedVideo
  } catch (error) {
    console.error('Failed to update generated video via API', error)
    throw error
  }
}

export async function getGeneratedVideos(scriptId?: string): Promise<GeneratedVideo[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const videos = demoVideos.filter(video => video.user_id === user.id)
    return scriptId ? videos.filter(video => video.script_id === scriptId) : videos
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const params = new URLSearchParams()
    if (scriptId) params.set('script_id', scriptId)
    const url = `${baseOrigin}/api/generated-videos${params.size ? `?${params.toString()}` : ''}`
    const res = await fetch(url)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:get generated_videos failed', err)
      const user = getCurrentUser()
      const videos = demoVideos.filter(video => video.user_id === user.id)
      return scriptId ? videos.filter(video => video.script_id === scriptId) : videos
    }
    const data = await res.json()
    return (data.items as GeneratedVideo[]) || []
  } catch (error) {
    console.error('Failed to load generated videos via API', error)
    const user = getCurrentUser()
    const videos = demoVideos.filter(video => video.user_id === user.id)
    return scriptId ? videos.filter(video => video.script_id === scriptId) : videos
  }
}

export async function updateProjectName(projectId: string, name: string): Promise<Project> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const idx = demoProjects.findIndex(p => p.id === projectId && p.user_id === user.id)
    if (idx !== -1) {
      demoProjects[idx].name = name
      return demoProjects[idx]
    }
    throw new Error('Project not found')
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/projects`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to update project name (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as Project
  } catch (error) {
    console.error('Failed to update project via API', error)
    throw error
  }
}

export async function updateReferenceImageLabel(id: string, label: string): Promise<ReferenceImage> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const idx = demoReferenceImages.findIndex(img => img.id === id && img.user_id === user.id)
    if (idx >= 0) {
      demoReferenceImages[idx] = { ...demoReferenceImages[idx], label }
      invalidateRefCaches(user.id)
      return demoReferenceImages[idx]
    }
    throw new Error('Reference image not found in demo mode')
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-images`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label, user_id: user.id })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to update reference image label (HTTP ${res.status})`)
    }
    const data = await res.json()
    invalidateRefCaches(user.id)
    return data.item as ReferenceImage
  } catch (error) {
    console.error('Failed to update reference image via API', error)
    throw error
  }
}

// 参考视频：新增/获取/删除/更新标签
export async function addReferenceVideo(url: string, label?: string, scriptId?: string | null): Promise<ReferenceVideo> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return {
      id: `demo_ref_video_${Date.now()}`,
      user_id: user.id,
      url,
      label,
      script_id: scriptId ?? null,
      created_at: new Date().toISOString()
    }
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, label, user_id: user.id, script_id: scriptId ?? null })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to add reference video (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as ReferenceVideo
  } catch (error) {
    console.error('Failed to add reference video via API', error)
    throw error
  }
}

export async function getReferenceVideos(limit = 10, before?: string, scriptId?: string): Promise<ReferenceVideo[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return []
  }

  try {
    const params = new URLSearchParams({ user_id: user.id, limit: String(limit) })
    if (before) params.set('before', before)
    if (scriptId) params.set('script_id', scriptId)
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-videos?${params.toString()}`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      console.error('API:get reference_videos failed', err)
      return []
    }
    const data = await res.json()
    const items = (data.items as ReferenceVideo[]) || []
    return items
  } catch (error) {
    console.error('Failed to load reference videos via API', error)
    return []
  }
}

export async function removeReferenceVideo(id: string): Promise<void> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-videos`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, user_id: user.id })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to delete reference video (HTTP ${res.status})`)
    }
  } catch (error) {
    console.error('Failed to delete reference video via API', error)
    throw error
  }
}

export async function updateReferenceVideoLabel(id: string, label: string): Promise<ReferenceVideo> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return {
      id,
      user_id: user.id,
      url: '',
      label,
      script_id: null,
      created_at: new Date().toISOString()
    }
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${baseOrigin}/api/reference-videos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label, user_id: user.id })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error || `Failed to update reference video label (HTTP ${res.status})`)
    }
    const data = await res.json()
    return data.item as ReferenceVideo
  } catch (error) {
    console.error('Failed to update reference video via API', error)
    throw error
  }
}

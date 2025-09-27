import { supabase, isDemoMode } from './supabase'
import { getCurrentUser } from './auth'
import { Project, Script, ScriptSegment, GeneratedImage, ReferenceImage, ApiKeySettings, GeneratedVideo } from './types'

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
    url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee',
    label: '森林晨光',
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

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      description,
      user_id: user.id,
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.projects' missing; using local demo storage.")
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

  if (error) throw error
  return data
}

export async function getProjects(): Promise<Project[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return demoProjects.filter(p => p.user_id === user.id)
  }

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.projects' missing; using local demo storage.")
    return demoProjects.filter(p => p.user_id === user.id)
  }

  if (error) throw error
  return data || []
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

  // Supabase delete cascade: images -> videos -> scripts -> project
  // Fetch script ids for project
  const { data: scriptRows, error: scriptQueryErr } = await supabase
    .from('scripts')
    .select('id')
    .eq('project_id', projectId)

  if (scriptQueryErr?.code === 'PGRST205') {
    console.warn("Supabase table 'public.scripts' missing; using local demo storage.")
    // Fallback to demo mutation
    const scriptIds = demoScripts.filter(s => s.project_id === projectId).map(s => s.id)
    for (let i = demoProjects.length - 1; i >= 0; i--) {
      if (demoProjects[i].id === projectId && demoProjects[i].user_id === user.id) {
        demoProjects.splice(i, 1)
      }
    }
    for (let i = demoScripts.length - 1; i >= 0; i--) {
      if (demoScripts[i].project_id === projectId) {
        demoScripts.splice(i, 1)
      }
    }
    for (let i = demoImages.length - 1; i >= 0; i--) {
      if (scriptIds.includes(demoImages[i].script_id)) {
        demoImages.splice(i, 1)
      }
    }
    for (let i = demoVideos.length - 1; i >= 0; i--) {
      const sid = demoVideos[i].script_id
      if (sid && scriptIds.includes(sid)) {
        demoVideos.splice(i, 1)
      }
    }
    return
  }

  if (scriptQueryErr) throw scriptQueryErr

  const scriptIds = (scriptRows || []).map((r: { id: string }) => r.id)

  if (scriptIds.length > 0) {
    const { error: imgDelErr } = await supabase
      .from('generated_images')
      .delete()
      .in('script_id', scriptIds)
    if (imgDelErr && imgDelErr.code !== 'PGRST205') throw imgDelErr

    const { error: vidDelErr } = await supabase
      .from('generated_videos')
      .delete()
      .in('script_id', scriptIds)
    if (vidDelErr && vidDelErr.code !== 'PGRST205') throw vidDelErr

    const { error: scriptsDelErr } = await supabase
      .from('scripts')
      .delete()
      .eq('project_id', projectId)
    if (scriptsDelErr && scriptsDelErr.code !== 'PGRST205') throw scriptsDelErr
  }

  const { error: projDelErr } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('user_id', user.id)

  if (projDelErr?.code === 'PGRST205') {
    console.warn("Supabase table 'public.projects' missing; using local demo storage.")
    // Fallback mutate local demo
    for (let i = demoProjects.length - 1; i >= 0; i--) {
      if (demoProjects[i].id === projectId && demoProjects[i].user_id === user.id) {
        demoProjects.splice(i, 1)
      }
    }
    return
  }

  if (projDelErr) throw projDelErr
}

// 脚本相关操作
export async function createScript(projectId: string, content: ScriptSegment[]): Promise<Script> {
  if (isDemoMode) {
    const script: Script = {
      id: `demo_script_${Date.now()}`,
      project_id: projectId,
      content,
      status: 'draft',
      created_at: new Date().toISOString()
    }
    demoScripts.unshift(script)
    return script
  }

  const { data, error } = await supabase
    .from('scripts')
    .insert({
      project_id: projectId,
      content,
      status: 'draft',
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.scripts' missing; using local demo storage.")
    const script: Script = {
      id: `demo_script_${Date.now()}`,
      project_id: projectId,
      content,
      status: 'draft',
      created_at: new Date().toISOString()
    }
    demoScripts.unshift(script)
    return script
  }

  if (error) throw error
  return data
}

export async function getScripts(projectId: string): Promise<Script[]> {
  if (isDemoMode) {
    return demoScripts.filter(s => s.project_id === projectId)
  }

  const { data, error } = await supabase
    .from('scripts')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.scripts' missing; using local demo storage.")
    return demoScripts.filter(s => s.project_id === projectId)
  }

  if (error) throw error
  return data || []
}

export async function updateScript(id: string, content: ScriptSegment[]): Promise<Script> {
  if (isDemoMode) {
    const index = demoScripts.findIndex(s => s.id === id)
    if (index !== -1) {
      demoScripts[index].content = content
      return demoScripts[index]
    }
    throw new Error('Script not found')
  }

  const { data, error } = await supabase
    .from('scripts')
    .update({ content })
    .eq('id', id)
    .select()
    .single()

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.scripts' missing; using local demo storage.")
    const index = demoScripts.findIndex(s => s.id === id)
    if (index !== -1) {
      demoScripts[index].content = content
      return demoScripts[index]
    }
    throw new Error('Script not found')
  }

  if (error) throw error
  return data
}

// 图片相关操作
export async function createGeneratedImage(
  scriptId: string,
  prompt: string,
  imageUrl: string,
  shotNumber?: number
): Promise<GeneratedImage> {
  if (isDemoMode) {
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

  const { data, error } = await supabase
    .from('generated_images')
    .insert({
      script_id: scriptId,
      prompt,
      image_url: imageUrl,
      status: 'completed',
      shot_number: shotNumber,
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.generated_images' missing; using local demo storage.")
    const image: GeneratedImage = {
      id: `demo_img_${Date.now()}`,
      script_id: scriptId,
      prompt,
      image_url: imageUrl,
      status: 'completed',
      created_at: new Date().toISOString()
    }
    demoImages.unshift(image)
    return image
  }

  if (error) throw error
  return data
}

export async function getGeneratedImages(scriptId: string): Promise<GeneratedImage[]> {
  if (isDemoMode) {
    return demoImages.filter(img => img.script_id === scriptId)
  }

  const { data, error } = await supabase
    .from('generated_images')
    .select('*')
    .eq('script_id', scriptId)
    .order('shot_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  // Fallback to demo storage if table missing
  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.generated_images' missing; using local demo storage.")
    return demoImages.filter(img => img.script_id === scriptId)
  }

  // Column missing fallback: Supabase returns 42703 when 'shot_number' column isn't yet migrated
  if (error?.code === '42703') {
    const { data: data2, error: err2 } = await supabase
      .from('generated_images')
      .select('*')
      .eq('script_id', scriptId)
      .order('created_at', { ascending: true })
    if (err2) throw err2
    return data2 || []
  }

  if (error) throw error
  return data || []
}
// 参考图相关操作
export async function addReferenceImage(url: string, label?: string): Promise<ReferenceImage> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const image: ReferenceImage = {
      id: `demo_ref_${Date.now()}`,
      user_id: user.id,
      url,
      label,
      created_at: new Date().toISOString()
    }
    demoReferenceImages.unshift(image)
    return image
  }

  const { data, error } = await supabase
    .from('reference_images')
    .insert({
      user_id: user.id,
      url,
      label,
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.reference_images' missing; using local demo storage.")
    const image: ReferenceImage = {
      id: `demo_ref_${Date.now()}`,
      user_id: user.id,
      url,
      label,
      created_at: new Date().toISOString()
    }
    demoReferenceImages.unshift(image)
    return image
  }

  if (error) throw error
  return data as ReferenceImage
}

export async function getReferenceImages(): Promise<ReferenceImage[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    return demoReferenceImages.filter(img => img.user_id === user.id)
  }

  try {
    const { data, error } = await supabase
      .from('reference_images')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error?.code === 'PGRST205') {
      console.warn("Supabase table 'public.reference_images' missing; using local demo storage.")
      return demoReferenceImages.filter(img => img.user_id === user.id)
    }

    if (error) {
      // Be tolerant to unexpected error shapes (e.g., empty object {}) and avoid throwing to not break UI
      console.warn('Supabase error while fetching reference_images, returning empty list instead of throwing:', error)
      return []
    }

    return data || []
  } catch (e) {
    // Catch-all safeguard to prevent empty-object throws from bubbling to UI
    console.warn('Exception while fetching reference_images, returning empty list:', e)
    return []
  }
}

export async function removeReferenceImage(id: string): Promise<void> {
  const user = getCurrentUser()

  if (isDemoMode) {
    demoReferenceImages = demoReferenceImages.filter(
      img => !(img.id === id && img.user_id === user.id)
    )
    return
  }

  const { error } = await supabase
    .from('reference_images')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.reference_images' missing; using local demo storage.")
    demoReferenceImages = demoReferenceImages.filter(
      img => !(img.id === id && img.user_id === user.id)
    )
    return
  }

  if (error) throw error
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
  scriptId: string | null = null,
  shotNumber?: number,
  status: GeneratedVideo['status'] = 'pending',
  videoUrl = ''
): Promise<GeneratedVideo> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const video: GeneratedVideo = {
      id: `demo_video_${Date.now()}`,
      user_id: user.id,
      script_id: scriptId,
      image_url: imageUrl,
      prompt,
      video_url: videoUrl,
      status,
      shot_number: shotNumber,
      created_at: new Date().toISOString()
    }
    demoVideos.unshift(video)
    return video
  }

  const { data, error } = await supabase
    .from('generated_videos')
    .insert({
      user_id: user.id,
      script_id: scriptId,
      image_url: imageUrl,
      prompt,
      video_url: videoUrl,
      status,
      shot_number: shotNumber,
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.generated_videos' missing; using local demo storage.")
    const video: GeneratedVideo = {
      id: `demo_video_${Date.now()}`,
      user_id: user.id,
      script_id: scriptId,
      image_url: imageUrl,
      prompt,
      video_url: videoUrl,
      status,
      created_at: new Date().toISOString()
    }
    demoVideos.unshift(video)
    return video
  }

  if (error) throw error
  return data as GeneratedVideo
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

  const { data, error } = await supabase
    .from('generated_videos')
    .update({
      ...updates
    })
    .eq('id', id)
    .select()
    .single()

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.generated_videos' missing; using local demo storage.")
    const index = demoVideos.findIndex(video => video.id === id)
    if (index === -1) throw new Error('Video not found')
    demoVideos[index] = {
      ...demoVideos[index],
      ...updates
    }
    return demoVideos[index]
  }

  if (error) throw error
  return data as GeneratedVideo
}

export async function getGeneratedVideos(scriptId?: string): Promise<GeneratedVideo[]> {
  const user = getCurrentUser()

  if (isDemoMode) {
    const videos = demoVideos.filter(video => video.user_id === user.id)
    return scriptId ? videos.filter(video => video.script_id === scriptId) : videos
  }

  let query = supabase
    .from('generated_videos')
    .select('*')
    .eq('user_id', user.id)
    .order('shot_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (scriptId) {
    query = query.eq('script_id', scriptId)
  }

  const { data, error } = await query

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.generated_videos' missing; using local demo storage.")
    const videos = demoVideos.filter(video => video.user_id === user.id)
    return scriptId ? videos.filter(video => video.script_id === scriptId) : videos
  }

  // Column missing fallback: Supabase returns 42703 when 'shot_number' column isn't yet migrated
  if (error?.code === '42703') {
    let query2 = supabase
      .from('generated_videos')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (scriptId) {
      query2 = query2.eq('script_id', scriptId)
    }
    const { data: data2, error: err2 } = await query2
    if (err2) throw err2
    return data2 || []
  }

  if (error) throw error
  return data || []
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

  const { data, error } = await supabase
    .from('projects')
    .update({ name })
    .eq('id', projectId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error?.code === 'PGRST205') {
    console.warn("Supabase table 'public.projects' missing; using local demo storage.")
    const idx = demoProjects.findIndex(p => p.id === projectId && p.user_id === user.id)
    if (idx !== -1) {
      demoProjects[idx].name = name
      return demoProjects[idx]
    }
    throw new Error('Project not found')
  }

  if (error) throw error
  return data as Project
}

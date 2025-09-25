'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  addReferenceImage,
  createGeneratedImage,
  createGeneratedVideo,
  createProject,
  createScript,
  getApiKeySettings,
  getGeneratedImages,
  getGeneratedVideos,
  getProjects,
  getReferenceImages,
  getScripts,
  removeReferenceImage,
  saveApiKeySettings,
  updateScript
} from '@/lib/db'
import { generateBatchImages } from '@/lib/doubao'
import type {
  GeneratedImage as StoredImage,
  GeneratedVideo,
  Project,
  ReferenceImage,
  Script,
  ScriptSegment
} from '@/lib/types'

const KEY_PLACEHOLDER = '••••••••••'

const VIDEO_STATUS_STYLES: Record<GeneratedVideo['status'], string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200'
}

const VIDEO_STATUS_LABEL: Record<GeneratedVideo['status'], string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败'
}

function maskKey(value: string) {
  if (!value) return ''
  if (value.length <= 6) return KEY_PLACEHOLDER.slice(0, value.length)
  return `${value.slice(0, 3)}${'•'.repeat(Math.max(0, value.length - 6))}${value.slice(-3)}`
}

function normalizeCharacters(value: string[]): string {
  return value.join(', ')
}

function parseCharacters(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
export default function Home() {
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [apiKeyForm, setApiKeyForm] = useState({
    gemini_api_key: '',
    doubao_api_key: '',
    veo3_api_key: ''
  })
  const [apiKeyUpdatedAt, setApiKeyUpdatedAt] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [isSavingKeys, setIsSavingKeys] = useState(false)

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [newReferenceUrl, setNewReferenceUrl] = useState('')
  const [newReferenceLabel, setNewReferenceLabel] = useState('')
  const [isAddingReference, setIsAddingReference] = useState(false)
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([])

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)

  const [scripts, setScripts] = useState<Script[]>([])
  const [, setActiveScript] = useState<Script | null>(null)
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null)
  const [scriptSegments, setScriptSegments] = useState<ScriptSegment[]>([])
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([])
  const [scriptImages, setScriptImages] = useState<StoredImage[]>([])
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([])
  const [selectedImageIdsForVideo, setSelectedImageIdsForVideo] = useState<string[]>([])
  const [generatedScripts, setGeneratedScripts] = useState<Array<{ id: string; title: string; segments: ScriptSegment[]; type: 'generated' }>>([])

  const [storyOutline, setStoryOutline] = useState('')
  const [scriptCount, setScriptCount] = useState(3)
  const [isGeneratingScript, setIsGeneratingScript] = useState(false)
  const [isSavingScript, setIsSavingScript] = useState(false)

  const [bulkFind, setBulkFind] = useState('')
  const [bulkReplaceValue, setBulkReplaceValue] = useState('')
  const [revisionNote, setRevisionNote] = useState('')
  const [isRequestingRevision, setIsRequestingRevision] = useState(false)

  const [isGeneratingImages, setIsGeneratingImages] = useState(false)
  const [imageProgress, setImageProgress] = useState(0)
  const [isQueueingVideo, setIsQueueingVideo] = useState(false)
  const [expandedScriptIds, setExpandedScriptIds] = useState<string[]>([])

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([
          loadApiKeys(),
          loadReferenceLibrary(),
          loadProjectList()
        ])
      } catch (error) {
        console.error('Failed to initialize workbench', error)
        setStatus({ type: 'error', message: '初始化工作台数据失败，请检查控制台提示。' })
      } finally {
        setIsLoading(false)
      }
    }

    void init()
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 5000)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (editingScriptId) {
      setExpandedScriptIds(prev => (prev.includes(editingScriptId) ? prev : [...prev, editingScriptId]))
    }
  }, [editingScriptId])

  useEffect(() => {
    if (!editingScriptId && generatedScripts.length) {
      const first = generatedScripts[0]
      setEditingScriptId(first.id)
      setScriptSegments(first.segments)
      setSelectedSegmentIds(first.segments.map(segment => segment.id))
      setScriptImages([])
      setGeneratedVideos([])
      setSelectedImageIdsForVideo([])
    }
  }, [generatedScripts, editingScriptId])

  const selectedReferenceImages = useMemo(
    () => referenceImages.filter(image => selectedReferenceIds.includes(image.id)),
    [referenceImages, selectedReferenceIds]
  )

  const currentProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const allSegmentsSelected = scriptSegments.length > 0 && selectedSegmentIds.length === scriptSegments.length

  type ScriptCard = {
    id: string
    title: string
    created_at: string
    content: ScriptSegment[]
    type: 'generated' | 'persisted'
  }

  const scriptsToDisplay: ScriptCard[] = [
    ...generatedScripts.map((script, index) => ({
      id: script.id,
      title: script.title || `脚本草稿 ${index + 1}`,
      created_at: '',
      content: script.segments,
      type: 'generated' as const
    })),
    ...scripts.map((script, index) => ({
      id: script.id,
      title: `脚本 ${index + 1}（${script.id.slice(0, 8)}）`,
      created_at: script.created_at,
      content: (script.content as ScriptSegment[]) ?? [],
      type: 'persisted' as const
    }))
  ]

  const loadApiKeys = async () => {
    try {
      const settings = await getApiKeySettings()
      setApiKeyForm({
        gemini_api_key: settings.gemini_api_key || '',
        doubao_api_key: settings.doubao_api_key || '',
        veo3_api_key: settings.veo3_api_key || ''
      })
      setApiKeyUpdatedAt(settings.updated_at)
    } catch (error) {
      console.error('Failed to load API keys', error)
      setStatus({ type: 'error', message: '无法读取 API Key 配置。' })
    }
  }

  const loadReferenceLibrary = async () => {
    try {
      const items = await getReferenceImages()
      setReferenceImages(items)
      setSelectedReferenceIds(prev => prev.filter(id => items.some(item => item.id === id)))
    } catch (error) {
      console.error('Failed to load reference images', error)
      setStatus({ type: 'error', message: '加载参考图失败。' })
    }
  }

  const loadProjectList = async () => {
    try {
      const data = await getProjects()
      setProjects(data)
      setSelectedProjectId(prev => {
        if (prev && data.some(project => project.id === prev)) {
          return prev
        }
        return data[0]?.id ?? null
      })
    } catch (error) {
      console.error('Failed to load projects', error)
      setStatus({ type: 'error', message: '加载项目列表失败。' })
    }
  }

  const loadScriptAssets = useCallback(async (scriptId: string) => {
    try {
      const [images, videos] = await Promise.all([
        getGeneratedImages(scriptId),
        getGeneratedVideos(scriptId)
      ])
      setScriptImages(images)
      setGeneratedVideos(videos)
      setSelectedImageIdsForVideo(prev => prev.filter(id => images.some(image => image.id === id)))
    } catch (error) {
      console.error('Failed to load script assets', error)
      setStatus({ type: 'error', message: '加载脚本关联资源失败。' })
    }
  }, [])

  const activateScript = useCallback((script: Script | null) => {
    if (!script) {
      setActiveScript(null)
      setEditingScriptId(null)
      setScriptSegments([])
      setSelectedSegmentIds([])
      setScriptImages([])
      setGeneratedVideos([])
      setSelectedImageIdsForVideo([])
      return
    }

    setActiveScript(script)
    setEditingScriptId(script.id)
    setExpandedScriptIds(prev => (prev.includes(script.id) ? prev : [...prev, script.id]))
    const segments = (script.content as ScriptSegment[]) || []
    setScriptSegments(segments)
    setSelectedSegmentIds(segments.map(segment => segment.id))
    void loadScriptAssets(script.id)
  }, [loadScriptAssets])

  const loadProjectData = useCallback(async (projectId: string, preferredScriptId?: string) => {
    try {
      const list = await getScripts(projectId)
      setScripts(list)
      if (!list.length) {
        activateScript(null)
        return
      }
      const target = preferredScriptId
        ? list.find(script => script.id === preferredScriptId) ?? list[0]
        : list[0]
      activateScript(target)
    } catch (error) {
      console.error('Failed to load scripts', error)
      setStatus({ type: 'error', message: '加载脚本数据失败。' })
    }
  }, [activateScript])


  useEffect(() => {
    if (selectedProjectId) {
      void loadProjectData(selectedProjectId)
    } else {
      setScripts([])
      activateScript(null)
    }
  }, [selectedProjectId, loadProjectData, activateScript])

  const toggleScriptExpansion = (id: string) => {
    setExpandedScriptIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleToggleReferenceSelection = (id: string) => {
    setSelectedReferenceIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleToggleSegmentSelection = (id: string) => {
    setSelectedSegmentIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleSelectAllSegments = () => {
    if (allSegmentsSelected) {
      setSelectedSegmentIds([])
    } else {
      setSelectedSegmentIds(scriptSegments.map(segment => segment.id))
    }
  }

  const handleToggleImageSelection = (id: string) => {
    setSelectedImageIdsForVideo(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleSegmentFieldChange = (index: number, field: keyof ScriptSegment, value: string) => {
    setScriptSegments(prev => {
      const next = [...prev]
      const segment = { ...next[index] }
      if (field === 'characters') {
        segment.characters = parseCharacters(value)
      } else {
        ;(segment as Record<string, unknown>)[field] = value
      }
      next[index] = segment
      return next
    })
  }

  const handleAddSegment = () => {
    const newSegment: ScriptSegment = {
      id: `segment_${Date.now()}`,
      scene: '新的场景描述',
      prompt: '新的提示词',
      characters: [],
      setting: '',
      mood: ''
    }
    setScriptSegments(prev => [...prev, newSegment])
    setSelectedSegmentIds(prev => [...prev, newSegment.id])
  }

  const handleRemoveSegment = (segmentId: string) => {
    setScriptSegments(prev => prev.filter(segment => segment.id !== segmentId))
    setSelectedSegmentIds(prev => prev.filter(id => id !== segmentId))
  }

  const handleCreateProject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newProjectName.trim()) return

    setIsCreatingProject(true)
    try {
      const project = await createProject(newProjectName.trim(), newProjectDescription.trim())
      setStatus({ type: 'success', message: '项目创建成功。' })
      setNewProjectName('')
      setNewProjectDescription('')
      setShowProjectForm(false)
      await loadProjectList()
      setSelectedProjectId(project.id)
    } catch (error) {
      console.error('Failed to create project', error)
      setStatus({ type: 'error', message: '创建项目失败。' })
    } finally {
      setIsCreatingProject(false)
    }
  }

  const handleGenerateScript = async () => {
    if (!storyOutline.trim()) {
      setStatus({ type: 'info', message: '请先填写故事梗概。' })
      return
    }

    setIsGeneratingScript(true)
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyOutline, scriptCount })
      })

      if (!response.ok) {
        throw new Error('generate-script request failed')
      }

      const scriptsResponse: Array<{ id: string; title: string; segments: ScriptSegment[]; type: 'generated' }> = await response.json()

      if (!scriptsResponse.length) {
        setStatus({ type: 'info', message: '未生成脚本，请调整梗概后重试。' })
        return
      }

      const prevGeneratedIds = new Set(generatedScripts.map(script => script.id))
      const newIds = scriptsResponse.map(script => script.id)
      setGeneratedScripts(scriptsResponse)
      const firstScript = scriptsResponse[0]
      setEditingScriptId(firstScript.id)
      setScriptSegments(firstScript.segments)
      setSelectedSegmentIds(firstScript.segments.map(segment => segment.id))
      setActiveScript(null)
      setScriptImages([])
      setGeneratedVideos([])
      setSelectedImageIdsForVideo([])
      setExpandedScriptIds(prev => {
        const persistedIds = prev.filter(id => !prevGeneratedIds.has(id))
        return Array.from(new Set([...persistedIds, ...newIds]))
      })
      setStatus({ type: 'success', message: '已生成新的脚本草稿，请逐个检查并保存。' })
    } catch (error) {
      console.error('Failed to generate script', error)
      setStatus({ type: 'error', message: '调用 Gemini 生成功能失败。已保留现有草稿。' })
    } finally {
      setIsGeneratingScript(false)
    }
  }

  const handleSaveScript = async () => {
    if (!selectedProjectId) {
      setStatus({ type: 'info', message: '请先选择一个项目。' })
      return
    }
    if (!scriptSegments.length) {
      setStatus({ type: 'info', message: '没有可以保存的脚本内容。' })
      return
    }

    const isGeneratedScript = generatedScripts.some(script => script.id === editingScriptId)

    setIsSavingScript(true)
    try {
      if (editingScriptId && !isGeneratedScript) {
        const persistedId = editingScriptId
        const updated = await updateScript(persistedId, scriptSegments)
        setStatus({ type: 'success', message: '脚本已更新。' })
        await loadProjectData(selectedProjectId, updated.id)
        setExpandedScriptIds(prev => Array.from(new Set(prev.filter(id => id !== persistedId).concat(updated.id))))
      } else {
        const generatedId = editingScriptId
        const created = await createScript(selectedProjectId, scriptSegments)
        setStatus({ type: 'success', message: '脚本已保存。' })
        await loadProjectData(selectedProjectId, created.id)
        setGeneratedScripts(prev => prev.filter(script => script.id !== generatedId))
        setEditingScriptId(created.id)
        setExpandedScriptIds(prev => Array.from(new Set(prev.filter(id => id !== generatedId).concat(created.id))))
      }
    } catch (error) {
      console.error('Failed to save script', error)
      setStatus({ type: 'error', message: '保存脚本失败。' })
    } finally {
      setIsSavingScript(false)
    }
  }

  const handleBulkReplaceAction = () => {
    if (!bulkFind) {
      setStatus({ type: 'info', message: '请填写需要替换的关键词。' })
      return
    }

    setScriptSegments(prev =>
      prev.map(segment => ({
        ...segment,
        scene: segment.scene.split(bulkFind).join(bulkReplaceValue),
        prompt: segment.prompt.split(bulkFind).join(bulkReplaceValue),
        setting: segment.setting.split(bulkFind).join(bulkReplaceValue),
        mood: segment.mood.split(bulkFind).join(bulkReplaceValue)
      }))
    )
    setStatus({ type: 'success', message: '已完成批量替换，请检查脚本内容。' })
  }

  const handleDownloadScript = (segmentsToExport?: ScriptSegment[], scriptIdForName?: string) => {
    const segments = segmentsToExport ?? scriptSegments

    if (!segments.length) {
      setStatus({ type: 'info', message: '没有可导出的脚本内容。' })
      return
    }

    const data = {
      projectId: selectedProjectId,
      updatedAt: new Date().toISOString(),
      segments
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const filename = scriptIdForName
      ? `script-${scriptIdForName}.json`
      : editingScriptId
        ? `script-${editingScriptId}.json`
        : `script-draft-${Date.now()}.json`
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleRequestRevision = async () => {
    if (!revisionNote.trim()) {
      setStatus({ type: 'info', message: '请填写要提交给 Gemini 的修改意见。' })
      return
    }
    if (!scriptSegments.length) {
      setStatus({ type: 'info', message: '当前没有脚本内容。' })
      return
    }

    setIsRequestingRevision(true)
    try {
      const response = await fetch('/api/refine-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: revisionNote,
          segments: scriptSegments
        })
      })

      if (!response.ok) {
        throw new Error('refine-script request failed')
      }

      const updatedSegments: ScriptSegment[] = await response.json()
      setScriptSegments(updatedSegments)
      setSelectedSegmentIds(updatedSegments.map(segment => segment.id))
      setRevisionNote('')
      setEditingScriptId(null)
      setActiveScript(null)
      setStatus({ type: 'success', message: 'Gemini 已返回修改后的脚本草稿。' })
    } catch (error) {
      console.error('Failed to request revision', error)
      setStatus({ type: 'error', message: '提交修改意见失败。' })
    } finally {
      setIsRequestingRevision(false)
    }
  }

  const handleAddReferenceImage = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newReferenceUrl.trim()) return

    setIsAddingReference(true)
    try {
      const image = await addReferenceImage(newReferenceUrl.trim(), newReferenceLabel.trim() || undefined)
      setReferenceImages(prev => [image, ...prev])
      setSelectedReferenceIds(prev => [image.id, ...prev])
      setNewReferenceUrl('')
      setNewReferenceLabel('')
      setStatus({ type: 'success', message: '参考图已添加。' })
    } catch (error) {
      console.error('Failed to add reference image', error)
      setStatus({ type: 'error', message: '添加参考图失败。' })
    } finally {
      setIsAddingReference(false)
    }
  }

  const handleRemoveReferenceImage = async (id: string) => {
    try {
      await removeReferenceImage(id)
      setReferenceImages(prev => prev.filter(image => image.id !== id))
      setSelectedReferenceIds(prev => prev.filter(item => item !== id))
    } catch (error) {
      console.error('Failed to remove reference image', error)
      setStatus({ type: 'error', message: '删除参考图失败。' })
    }
  }

  const handleSaveKeys = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSavingKeys(true)
    try {
      const saved = await saveApiKeySettings(apiKeyForm)
      setApiKeyUpdatedAt(saved.updated_at)
      setStatus({ type: 'success', message: 'API Key 配置已保存。' })
    } catch (error) {
      console.error('Failed to save API keys', error)
      setStatus({ type: 'error', message: '保存 API Key 失败。' })
    } finally {
      setIsSavingKeys(false)
    }
  }

  const handleGenerateImages = async () => {
    if (!editingScriptId) {
      setStatus({ type: 'info', message: '请先保存脚本以便绑定生成结果。' })
      return
    }

    const segmentsToUse = scriptSegments.filter(segment =>
      !selectedSegmentIds.length || selectedSegmentIds.includes(segment.id)
    )

    if (!segmentsToUse.length) {
      setStatus({ type: 'info', message: '请选择至少一个片段。' })
      return
    }

    setIsGeneratingImages(true)
    setImageProgress(0)
    try {
      const selectedRefs = referenceImages.filter(image => selectedReferenceIds.includes(image.id))
      const requests = segmentsToUse.map((segment, index) => ({
        prompt: segment.prompt,
        referenceImageUrl: selectedRefs.length ? selectedRefs[index % selectedRefs.length].url : undefined
      }))

      const images = await generateBatchImages(requests, {
        onProgress: (completed, total) => {
          setImageProgress(Math.round((completed / total) * 100))
        }
      })

      for (const image of images) {
        await createGeneratedImage(editingScriptId, image.prompt, image.url)
      }

      await loadScriptAssets(editingScriptId)
      setStatus({ type: 'success', message: `已生成 ${images.length} 张图片。` })
    } catch (error) {
      console.error('Failed to generate images', error)
      setStatus({ type: 'error', message: '批量生成图片失败。' })
    } finally {
      setIsGeneratingImages(false)
      setImageProgress(0)
    }
  }

  const handleQueueVideoGeneration = async () => {
    if (!editingScriptId) {
      setStatus({ type: 'info', message: '请先保存脚本。' })
      return
    }

    const imagesToQueue = scriptImages.filter(image => selectedImageIdsForVideo.includes(image.id))
    if (!imagesToQueue.length) {
      setStatus({ type: 'info', message: '请选择至少一张图片提交给 Veo3。' })
      return
    }

    setIsQueueingVideo(true)
    try {
      for (const image of imagesToQueue) {
        await createGeneratedVideo(image.image_url, image.prompt, editingScriptId)
      }
      setStatus({ type: 'success', message: `已提交 ${imagesToQueue.length} 个视频任务。` })
      setSelectedImageIdsForVideo([])
      await loadScriptAssets(editingScriptId)
    } catch (error) {
      console.error('Failed to queue video generation', error)
      setStatus({ type: 'error', message: '提交 Veo3 视频任务失败。' })
    } finally {
      setIsQueueingVideo(false)
    }
  }
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
          正在加载创意工作台...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {status && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            status.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : status.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
        >
          {status.message}
        </div>
      )}

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Storyboard workflow</h2>
            <p className="text-sm text-gray-600">Launch the prompt-focused storyboard flow for Doubao and Veo3.</p>
          </div>
          <Link
            href="/workflows/storyboard"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Open storyboard workflow
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">API Key 设置</h2>
            <p className="mt-1 text-sm text-gray-500">
              将 Gemini / Doubao / Veo3 的 API Key 统一保存在 Supabase，便于在工作流中安全调用。
            </p>
          </div>
          <div className="text-sm text-gray-500">
            {apiKeyUpdatedAt && (
              <p className="text-xs text-gray-400">
                最近保存：{new Date(apiKeyUpdatedAt).toLocaleString()}
              </p>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={showKeys}
                onChange={event => setShowKeys(event.target.checked)}
              />
              显示明文
            </label>
          </div>
        </div>

        <form onSubmit={handleSaveKeys} className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Gemini API Key</label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={apiKeyForm.gemini_api_key}
              onChange={event =>
                setApiKeyForm(prev => ({ ...prev, gemini_api_key: event.target.value }))
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={showKeys ? '请输入 Gemini API Key' : maskKey(apiKeyForm.gemini_api_key)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Doubao API Key</label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={apiKeyForm.doubao_api_key}
              onChange={event =>
                setApiKeyForm(prev => ({ ...prev, doubao_api_key: event.target.value }))
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={showKeys ? '请输入 Doubao API Key' : maskKey(apiKeyForm.doubao_api_key)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Veo3 API Key</label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={apiKeyForm.veo3_api_key}
              onChange={event =>
                setApiKeyForm(prev => ({ ...prev, veo3_api_key: event.target.value }))
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={showKeys ? '请输入 Veo3 API Key' : maskKey(apiKeyForm.veo3_api_key)}
            />
          </div>
          <div className="md:col-span-3 flex justify-end gap-3">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              onClick={() => {
                void loadApiKeys()
                setStatus({ type: 'info', message: '已恢复上次保存的配置。' })
              }}
            >
              恢复
            </button>
            <button
              type="submit"
              disabled={isSavingKeys}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingKeys ? '保存中…' : '保存配置'}
            </button>
          </div>
        </form>
      </section>
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">参考图素材库</h2>
            <p className="mt-1 text-sm text-gray-500">
              维护用于 Doubao 批量生图的参考图 URL，可在工作流中勾选使用。
            </p>
          </div>
        </div>

        <form
          onSubmit={handleAddReferenceImage}
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
        >
          <input
            type="url"
            required
            value={newReferenceUrl}
            onChange={event => setNewReferenceUrl(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="粘贴参考图 URL (支持 CDN、OSS、Supabase Storage 等)"
          />
          <input
            type="text"
            value={newReferenceLabel}
            onChange={event => setNewReferenceLabel(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="参考图备注 (选填)"
          />
          <button
            type="submit"
            disabled={isAddingReference}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAddingReference ? '添加中…' : '添加参考图'}
          </button>
        </form>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {referenceImages.map(image => (
            <div
              key={image.id}
              className={`space-y-3 rounded-lg border p-3 ${
                selectedReferenceIds.includes(image.id)
                  ? 'border-blue-500 shadow-sm ring-2 ring-blue-200'
                  : 'border-gray-200'
              }`}
            >
              <div className="aspect-square overflow-hidden rounded-md bg-gray-100">
                <img src={image.url} alt={image.label ?? '参考图'} className="h-full w-full object-cover" />
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{image.label ?? '未命名参考图'}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(image.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveReferenceImage(image.id)}
                  className="text-xs text-red-500 hover:text-red-600"
                >
                  删除
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={selectedReferenceIds.includes(image.id)}
                  onChange={() => handleToggleReferenceSelection(image.id)}
                />
                用于本次批量
              </label>
            </div>
          ))}
        </div>

        {referenceImages.length === 0 && (
          <p className="mt-4 text-sm text-gray-500">
            暂无参考图，粘贴一个图片 URL 即可开始构建素材库。
          </p>
        )}
      </section>
      <section className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">项目管理</h3>
                  <p className="mt-1 text-sm text-gray-500">选择一个项目作为脚本与生成内容的归属。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProjectForm(prev => !prev)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {showProjectForm ? '收起' : '新建项目'}
                </button>
              </div>

              {showProjectForm && (
                <form onSubmit={handleCreateProject} className="space-y-3 rounded-md border border-gray-200 p-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">项目名称</label>
                    <input
                      type="text"
                      required
                      value={newProjectName}
                      onChange={event => setNewProjectName(event.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="例如：童话故事改编"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">项目描述</label>
                    <textarea
                      value={newProjectDescription}
                      onChange={event => setNewProjectDescription(event.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="补充项目用途、风格等信息 (选填)"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowProjectForm(false)
                        setNewProjectName('')
                        setNewProjectDescription('')
                      }}
                      className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={isCreatingProject}
                      className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isCreatingProject ? '创建中…' : '创建项目'}
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2">
                {projects.map(project => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`w全 rounded-md border px-3 py-3 text-left text-sm ${
                      selectedProjectId === project.id
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{project.name}</span>
                      <span className="text-xs text-gray-400">{new Date(project.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                      {project.description || '暂无描述'}
                    </p>
                  </button>
                ))}
                {projects.length === 0 && (
                  <p className="text-sm text-gray-500">尚未创建项目，先添加一个项目即可开始。</p>
                )}
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">脚本列表</h3>
                {selectedProjectId && (
                  <Link
                    href={`/projects/${selectedProjectId}`}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    打开项目工作台 ↗
                  </Link>
                )}
              </div>
              <div className="space-y-2">
                {scripts.map(script => (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => activateScript(script)}
                    className={`w-full rounded-md border px-3 py-3 text-left text-sm ${
                      editingScriptId === script.id
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">脚本 {script.id.slice(0, 8)}</span>
                      <span className="text-xs text-gray-400">{new Date(script.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">片段：{(script.content as ScriptSegment[]).length}</p>
                  </button>
                ))}
                {scripts.length === 0 && (
                  <p className="text-sm text-gray-500">当前项目还没有脚本。</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveScript(null)
                    setEditingScriptId(null)
                    setScriptSegments([])
                    setSelectedSegmentIds([])
                    setScriptImages([])
                    setGeneratedVideos([])
                    setSelectedImageIdsForVideo([])
                    if (generatedScripts.length) {
                      setGeneratedScripts([])
                      setExpandedScriptIds(prev => prev.filter(id => !generatedScripts.some(script => script.id === id)))
                    }
                  }}
                  className="w-full rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-600"
                >
                  新建空白脚本草稿
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">创意脚本工作台</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    输入故事梗概后由 Gemini 批量生成片段，可在此处编辑、替换与保存。
                  </p>
                </div>
                {currentProject && (
                  <span className="text-xs text-gray-500">当前项目：{currentProject.name}</span>
                )}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <textarea
                  value={storyOutline}
                  onChange={event => setStoryOutline(event.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入故事梗概、品牌 Brief 或角色设定，Gemini 将基于此生成分镜脚本。"
                />
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-600">脚本数量：{scriptCount}</label>
                  <input
                    type="range"
                    min={3}
                    max={12}
                    value={scriptCount}
                    onChange={event => setScriptCount(Number(event.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>3</span>
                    <span>12</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript}
                  className="h-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingScript ? '生成中…' : '批量生成脚本'}
                </button>
              </div>

            </div>

            {scriptsToDisplay.map((scriptCard) => {
              const isGenerated = scriptCard.type === 'generated'
              const isActive = editingScriptId === scriptCard.id
              const isExpanded = expandedScriptIds.includes(scriptCard.id)
              const segmentsForCard = isActive ? scriptSegments : scriptCard.content
              const createdLabel = isGenerated
                ? '未保存的脚本草稿'
                : scriptCard.created_at
                ? new Date(scriptCard.created_at).toLocaleString()
                : ''

              const handleSetCurrent = () => {
                if (isGenerated) {
                  const target = generatedScripts.find(script => script.id === scriptCard.id)
                  if (target) {
                    setEditingScriptId(target.id)
                    setScriptSegments(target.segments)
                    setSelectedSegmentIds(target.segments.map(segment => segment.id))
                    setScriptImages([])
                    setGeneratedVideos([])
                    setSelectedImageIdsForVideo([])
                  }
                } else {
                  const target = scripts.find(item => item.id === scriptCard.id)
                  if (target) {
                    activateScript(target)
                  }
                }
              }

              return (
                <div key={scriptCard.id} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {scriptCard.title}（{segmentsForCard.length} 个片段）
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">{createdLabel}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleScriptExpansion(scriptCard.id)}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        {isExpanded ? '收起' : '展开'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadScript(segmentsForCard, scriptCard.id)}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        下载 JSON
                      </button>
                      {isActive && (
                        <button
                          type="button"
                          onClick={handleSaveScript}
                          disabled={isSavingScript}
                          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingScript ? '保存中…' : '保存脚本'}
                        </button>
                      )}
                      {!isActive && (
                        <button
                          type="button"
                          onClick={handleSetCurrent}
                          className="rounded-md border border-blue-200 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          设为当前
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-4">
                      {isActive ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                              <span>已选片段：{selectedSegmentIds.length || scriptSegments.length}</span>
                              <span>参考图：{selectedReferenceImages.length || '未选择'}</span>
                            </div>
                            <button
                              type="button"
                              onClick={handleSelectAllSegments}
                              className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              {allSegmentsSelected ? '取消全选' : '全选片段'}
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">批量替换 - 目标词</label>
                              <input
                                type="text"
                                value={bulkFind}
                                onChange={event => setBulkFind(event.target.value)}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="例如：角色A"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">批量替换 - 新词</label>
                              <input
                                type="text"
                                value={bulkReplaceValue}
                                onChange={event => setBulkReplaceValue(event.target.value)}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="例如：角色B"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleBulkReplaceAction}
                              className="self-end rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              批量替换
                            </button>
                          </div>
                          <div className="max-h-[480px] space-y-4 overflow-y-auto pr-2">
                            {scriptSegments.map((segment, index) => (
                              <div key={segment.id} className="space-y-3 rounded-lg border border-gray-200 p-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      className="rounded border-gray-300"
                                      checked={selectedSegmentIds.includes(segment.id)}
                                      onChange={() => handleToggleSegmentSelection(segment.id)}
                                    />
                                    <span className="text-sm font-medium text-gray-900">片段 {index + 1}</span>
                                    <span className="text-xs text-gray-400">{segment.id}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSegment(segment.id)}
                                    className="text-xs text-red-500 hover:text-red-600"
                                  >
                                    删除
                                  </button>
                                </div>
                                <div className="space-y-3">
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-medium text-gray-600">场景描述</span>
                                    <input
                                      type="text"
                                      value={segment.scene}
                                      onChange={event => handleSegmentFieldChange(index, 'scene', event.target.value)}
                                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-medium text-gray-600">提示词</span>
                                    <textarea
                                      value={segment.prompt}
                                      onChange={event => handleSegmentFieldChange(index, 'prompt', event.target.value)}
                                      rows={3}
                                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  </label>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <label className="block">
                                      <span className="mb-1 block text-xs font-medium text-gray-600">环境设定</span>
                                      <input
                                        type="text"
                                        value={segment.setting}
                                        onChange={event => handleSegmentFieldChange(index, 'setting', event.target.value)}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="mb-1 block text-xs font-medium text-gray-600">情绪氛围</span>
                                      <input
                                        type="text"
                                        value={segment.mood}
                                        onChange={event => handleSegmentFieldChange(index, 'mood', event.target.value)}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </label>
                                  </div>
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-medium text-gray-600">角色（逗号分隔）</span>
                                    <input
                                      type="text"
                                      value={normalizeCharacters(segment.characters)}
                                      onChange={event => handleSegmentFieldChange(index, 'characters', event.target.value)}
                                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      placeholder="例如：角色A, 角色B"
                                    />
                                  </label>
                                </div>
                              </div>
                            ))}
                            {scriptSegments.length === 0 && (
                              <p className="text-sm text-gray-500">暂无脚本内容，请先填写故事梗概并生成脚本。</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={handleAddSegment}
                            className="mt-4 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-blue-300 hover:text-blue-700"
                          >
                            新增片段
                          </button>
                        </>
                      ) : (
                        <div className="space-y-3">
                          {segmentsForCard.map((segment, index) => (
                            <div key={segment.id} className="rounded-lg border border-gray-200 p-4">
                              <p className="text-sm font-medium text-gray-900">片段 {index + 1} · {segment.scene}</p>
                              <p className="mt-2 text-xs text-gray-600">{segment.prompt}</p>
                            </div>
                          ))}
                          {segmentsForCard.length === 0 && (
                            <p className="text-sm text-gray-500">该脚本暂无片段。</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Gemini 修改意见</h3>
              <p className="mt-1 text-sm text-gray-500">
                将当前脚本与修改要求交给 Gemini，生成新的草稿。保存前不会覆盖现有脚本。
              </p>
              <textarea
                value={revisionNote}
                onChange={event => setRevisionNote(event.target.value)}
                rows={3}
                className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例如：让第 2 个片段更具悬念感，将角色 B 的情绪改为兴奋。"
              />
              <div className="mt-3 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRevisionNote('')}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={handleRequestRevision}
                  disabled={isRequestingRevision || !revisionNote.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRequestingRevision ? '提交中…' : '提交修改意见'}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Doubao 批量生图</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    勾选片段与参考图后，一键调用 Doubao 接口批量生成图片并自动入库。
                  </p>
                </div>
                <div className="text-xs text-gray-500">
                  <span className="mr-3">已选片段：{selectedSegmentIds.length || scriptSegments.length}</span>
                  <span>参考图：{selectedReferenceImages.length || '未选择'}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {selectedReferenceImages.map(image => (
                  <span key={image.id} className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                    <span className="block h-6 w-6 overflow-hidden rounded-full bg-white">
                      <img src={image.url} alt={image.label ?? '参考图'} className="h-full w-full object-cover" />
                    </span>
                    {image.label ?? image.url.slice(0, 24)}
                  </span>
                ))}
                {!selectedReferenceImages.length && (
                  <span className="text-xs text-gray-500">未选择参考图，将使用纯提示词生成。</span>
                )}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleGenerateImages}
                  disabled={isGeneratingImages || !scriptSegments.length}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingImages ? `生成中 ${imageProgress}%` : '批量生成图片'}
                </button>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {scriptImages.map(image => (
                  <label key={image.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <div className="aspect-video overflow-hidden rounded-md bg-gray-100">
                      <img src={image.image_url} alt="生成图片" className="h-full w-full object-cover" />
                    </div>
                    <p className="line-clamp-2 text-xs text-gray-600">{image.prompt}</p>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{new Date(image.created_at).toLocaleString()}</span>
                      <span>#{image.id.slice(0, 6)}</span>
                    </div>
                    <span className="flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={selectedImageIdsForVideo.includes(image.id)}
                        onChange={() => handleToggleImageSelection(image.id)}
                      />
                      提交至 Veo3
                    </span>
                  </label>
                ))}
              </div>
              {scriptImages.length === 0 && (
                <p className="mt-4 text-sm text-gray-500">当前脚本尚未生成图片。</p>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleQueueVideoGeneration}
                  disabled={isQueueingVideo || !selectedImageIdsForVideo.length}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isQueueingVideo ? '提交中…' : `提交 Veo3（${selectedImageIdsForVideo.length}）`}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Veo3 任务监控</h3>
              <p className="mt-1 text-sm text-gray-500">
                查看已提交的视频生成任务，支持对接本地后期流程。
              </p>
              <div className="mt-4 space-y-3">
                {generatedVideos.map(video => (
                  <div key={video.id} className="flex items-start justify-between rounded-lg border border-gray-200 p-3">
                    <div className="pr-4">
                      <p className="text-sm font-medium text-gray-900 line-clamp-2">{video.prompt}</p>
                      <p className="mt-1 text-xs text-gray-500">{new Date(video.created_at).toLocaleString()}</p>
                      {video.video_url && (
                        <a
                          href={video.video_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex text-xs text-blue-600 hover:text-blue-700"
                        >
                          查看视频链接 ↗
                        </a>
                      )}
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${VIDEO_STATUS_STYLES[video.status]}`}>
                      {VIDEO_STATUS_LABEL[video.status]}
                    </span>
                  </div>
                ))}
                {generatedVideos.length === 0 && (
                  <p className="text-sm text-gray-500">暂未提交 Veo3 任务。</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

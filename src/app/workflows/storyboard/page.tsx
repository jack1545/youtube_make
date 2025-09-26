'use client'

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateBatchImages } from '@/lib/doubao'
import { createVeo3Job } from '@/lib/veo3'
import { addReferenceImage, getReferenceImages, removeReferenceImage, createProject, createScript, createGeneratedImage, createGeneratedVideo, updateGeneratedVideoStatus } from '@/lib/db'
import type { ReferenceImage, ScriptSegment as DbScriptSegment } from '@/lib/types'
import { supabase, isDemoMode } from '@/lib/supabase'

// 查询 Veo3 任务详情，返回可能包含 video_url 的结构
async function fetchVeo3Detail(taskId: string) {
  const res = await fetch(`/api/veo3/detail?id=${encodeURIComponent(taskId)}`)
  if (!res.ok) throw new Error(`Fetch detail failed: ${res.status}`)
  return res.json() as Promise<{ id: string; status: string; detail?: any; video_url?: string; data?: any }>
}

interface StoryboardSubject {
  characters_present?: string
  expression?: string
  action?: string
}

interface StoryboardPrompt {
  subject?: StoryboardSubject
  environment?: string
  time_of_day?: string
  weather?: string
  camera_angle?: string
  shot_size?: string
}

interface StoryboardRawSegment {
  id?: string
  shot_number?: number
  duration?: string
  prompt?: StoryboardPrompt | Record<string, unknown> | string | null
  prompt_detail?: StoryboardPrompt | Record<string, unknown> | string | null
  promptDetail?: StoryboardPrompt | Record<string, unknown> | string | null
  promptDetails?: StoryboardPrompt | Record<string, unknown> | string | null
  prompt_json?: StoryboardPrompt | Record<string, unknown> | string | null
  promptJson?: StoryboardPrompt | Record<string, unknown> | string | null
  prompt_text?: string | null
  promptText?: string | null
  [key: string]: unknown
}

interface StoryboardSegment extends StoryboardRawSegment {
  id: string
  shotNumber: number
  prompt?: StoryboardPrompt
  promptText: string
}

interface StatusMessage {
  type: 'success' | 'error' | 'info'
  text: string
}

interface ImageResult {
  url: string
  prompt: string
  referenceImageUrl?: string
  referenceImageUrls?: string[]
}

interface VideoJobState {
  status: 'idle' | 'pending' | 'success' | 'error'
  jobId?: string
  error?: string
  videoUrl?: string
  dbId?: string
}

type DoubaoSizeMode = 'preset' | 'custom'
type DoubaoResolution = '1K' | '2K' | '4K'
const ASPECT_OPTIONS = ['9:16', '16:9', '1:1', '3:4'] as const
const RESOLUTION_OPTIONS: { value: DoubaoResolution; label: string }[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' }
]
type AspectOption = (typeof ASPECT_OPTIONS)[number]

const MIN_DOUDAO_DIMENSION = 1024
const MAX_DOUDAO_DIMENSION = 4096

const RESOLUTION_DIMENSIONS: Record<DoubaoResolution, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096
}

const CUSTOM_DEFAULT_DIMENSIONS: Record<AspectOption, { width: number; height: number }> = {
  '9:16': { width: 1152, height: 2048 },
  '16:9': { width: 2048, height: 1152 },
  '1:1': { width: 2048, height: 2048 },
  '3:4': { width: 1536, height: 2048 }
}

function parseAspect(value: string) {
  const [wStr, hStr] = value.split(':')
  const width = Number(wStr)
  const height = Number(hStr)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height, ratio: width / height }
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pickFirstString(sources: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const candidate = sanitizeString(source[key])
      if (candidate) {
        return candidate
      }
    }
  }
  return undefined
}

function normalizeSubject(subjectValue: unknown, fallbackSource: Record<string, unknown>): StoryboardSubject | undefined {
  const sources: Array<Record<string, unknown>> = []

  if (subjectValue && typeof subjectValue === 'object' && !Array.isArray(subjectValue)) {
    sources.push(subjectValue as Record<string, unknown>)
  }

  sources.push(fallbackSource)

  const characters = pickFirstString(sources, [
    'characters_present',
    'charactersPresent',
    'characters',
    'roles',
    'cast'
  ])

  const expression = pickFirstString(sources, [
    'expression',
    'facial_expression',
    'mood',
    'emotion'
  ])

  const action = pickFirstString(sources, ['action', 'pose', 'movement'])

  const subject: StoryboardSubject = {}
  if (characters) {
    subject.characters_present = characters
  }
  if (expression) {
    subject.expression = expression
  }
  if (action) {
    subject.action = action
  }

  return Object.keys(subject).length > 0 ? subject : undefined
}

function normalizePromptValue(raw: unknown): StoryboardPrompt | undefined {
  if (raw == null) {
    return undefined
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      return undefined
    }

    try {
      return normalizePromptValue(JSON.parse(trimmed))
    } catch {
      return undefined
    }
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }

  const source = raw as Record<string, unknown>

  const subject = normalizeSubject(
    source['subject'] ?? source['Subject'] ?? source['subject_detail'] ?? source['subjectDetail'],
    source
  )

  const prompt: StoryboardPrompt = {}
  if (subject) {
    prompt.subject = subject
  }

  const environment = pickFirstString([source], ['environment', 'Environment', 'setting', 'location'])
  if (environment) {
    prompt.environment = environment
  }

  const timeOfDay = pickFirstString([source], ['time_of_day', 'timeOfDay', 'time', 'day_part', 'dayTime'])
  if (timeOfDay) {
    prompt.time_of_day = timeOfDay
  }

  const weather = pickFirstString([source], ['weather', 'Weather', 'conditions', 'climate'])
  if (weather) {
    prompt.weather = weather
  }

  const cameraAngle = pickFirstString([source], ['camera_angle', 'cameraAngle', 'angle', 'shot_angle'])
  if (cameraAngle) {
    prompt.camera_angle = cameraAngle
  }

  const shotSize = pickFirstString([source], ['shot_size', 'shotSize', 'framing', 'frame'])
  if (shotSize) {
    prompt.shot_size = shotSize
  }

  return Object.keys(prompt).length > 0 ? prompt : undefined
}

function stringifyPromptDetails(prompt?: StoryboardPrompt): string {
  if (!prompt) {
    return ''
  }
  return JSON.stringify({ prompt }, null, 2)
}

function resolvePromptText(
  prompt: StoryboardPrompt | undefined,
  rawPrompt: unknown,
  shotNumber?: number
): string {
  // 优先使用原始字符串，不再把结构化提示词自动转为 JSON
  if (typeof rawPrompt === 'string') {
    const trimmed = rawPrompt.trim()
    if (trimmed) {
      return trimmed
    }
  }

  // 不再将对象序列化为 JSON 作为展示文本，避免干扰手动编辑
  if (typeof shotNumber === 'number') {
    return `Shot ${shotNumber}`
  }

  return 'Prompt unavailable'
}

function formatPromptForModel(segment: StoryboardSegment): string {
  // 优先使用用户编辑的纯文本
  if (segment.promptText && segment.promptText.trim().length > 0) {
    return segment.promptText.trim()
  }

  // 纯文本为空时，回退到结构化提示词
  if (segment.prompt) {
    return stringifyPromptDetails(segment.prompt)
  }

  // 最后回退到基础信息
  const lines = [`Shot ${segment.shotNumber}`]
  if (segment.duration) {
    lines.push(`Duration: ${segment.duration}`)
  }

  return lines.join('\n')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function extractFileExtension(url: string): string {
  try {
    const { pathname } = new URL(url)
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/)
    if (match) {
      const ext = match[1].toLowerCase()
      if (ext.length > 0 && ext.length <= 5) {
        return ext
      }
    }
  } catch {
    // ignore invalid URLs
  }
  return 'png'
}

// 辅助函数：只提取 prompt 中的 subject.action 文本，用于 Veo3 的 Video prompt
function safeParseJSON<T = any>(text?: string | null): T | null {
  if (!text || typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
function extractActionValue(action?: string): string | undefined {
  if (!action || typeof action !== 'string') return undefined

  const trimmed = action.trim()
  if (!trimmed) {
    return undefined
  }

  const parts = trimmed.split(':')
  if (parts.length > 1) {
    return parts.slice(1).join(':').trim()
  }

  return trimmed
}


function readActionFromPromptObject(obj: any): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const container = obj.prompt && typeof obj.prompt === 'object' ? obj.prompt : obj
  const subject = container && typeof container === 'object' ? (container as any).subject : undefined
  const action = subject && typeof subject === 'object' ? (subject as any).action : undefined
  const value = extractActionValue(action)
  if (value) {
    return value
  }
  return undefined
}

function extractActionText(segment: StoryboardSegment, imagePromptText?: string): string {
  // 1) 优先使用已结构化的 prompt
  const fromStructured = extractActionValue(segment.prompt?.subject?.action)
  if (fromStructured) return fromStructured

  // 2) 尝试从 promptText（若为 JSON 且包含 prompt.subject.action）中解析
  if (typeof segment.promptText === 'string') {
    const parsed = safeParseJSON(segment.promptText)
    const fromText = readActionFromPromptObject(parsed)
    if (fromText) return fromText
  }

  // 3) 尝试从 Doubao 的 image.prompt（通常为 JSON 字符串）中解析
  if (typeof imagePromptText === 'string') {
    const parsed = safeParseJSON(imagePromptText)
    const fromImagePrompt = readActionFromPromptObject(parsed)
    if (fromImagePrompt) return fromImagePrompt
  }

  return ''
}

// 解析 CSV 中的分镜提示块（中文标签）为结构化 StoryboardPrompt
function parsePromptBlock(block: string): StoryboardPrompt {
  const lines = block
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  const takeAfterLabel = (label: string): string | undefined => {
    const line = lines.find(l => l.startsWith(label))
    if (!line) return undefined
    const value = line.slice(label.length).trim()
    return value || undefined
  }

  const subject: StoryboardSubject = {}
  subject.characters_present = takeAfterLabel('角色：')
  const expression = takeAfterLabel('表情：')
  if (expression) subject.expression = expression
  subject.action = takeAfterLabel('动作：')

  // 按段落标题抓取下一行内容
  const valueAfterSection = (section: string): string | undefined => {
    const idx = lines.findIndex(l => l === section)
    if (idx === -1) return undefined
    // 找到该段落后的第一条非空行
    for (let i = idx + 1; i < lines.length; i++) {
      const v = lines[i]
      if (v && !v.startsWith('[')) return v
      if (v.startsWith('[')) break
    }
    return undefined
  }

  const prompt: StoryboardPrompt = {}
  if (subject.characters_present || subject.expression || subject.action) {
    prompt.subject = subject
  }
  prompt.environment = valueAfterSection('[环境]')
  prompt.time_of_day = valueAfterSection('[时间]')
  prompt.weather = valueAfterSection('[天气]')
  prompt.camera_angle = valueAfterSection('[视角]')
  prompt.shot_size = valueAfterSection('[景别]')

  return prompt
}

// 将 CSV 文本解析为 StoryboardSegment 数组（格式：分镜数,分镜提示词）
function parseStoryboardCsv(csvText: string): StoryboardSegment[] {
  const text = (csvText || '').trim()
  if (!text) return []

  // 支持包含多行引号字段的简单解析：匹配 行首/换行 + 数字 + 逗号 + "块"
  const re = /(\n|^)\s*(\d+)\s*,\s*"([\s\S]*?)"/g
  const segments: StoryboardSegment[] = []
  let idx = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const shotNumber = Number(match[2])
    const block = match[3].replace(/""/g, '"').trim()
    const prompt = parsePromptBlock(block)
    const promptText = block // 保留原始块文本（即三引号内容）

    segments.push({
      id: `shot-${shotNumber}-${idx}`,
      shotNumber: Number.isFinite(shotNumber) ? shotNumber : idx + 1,
      prompt,
      promptText
    })
    idx++
  }

  return segments
}

export default function StoryboardWorkflowPage() {
  const [projectName, setProjectName] = useState('Storyboard Project')
  const [rawJson, setRawJson] = useState('')
  const [segments, setSegments] = useState<StoryboardSegment[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusMessage | null>(null)

  const [selectedForImages, setSelectedForImages] = useState<string[]>([])
  const [selectedForVideo, setSelectedForVideo] = useState<string[]>([])
  const [imageResults, setImageResults] = useState<Record<string, ImageResult>>({})
  const [videoPromptOverrides, setVideoPromptOverrides] = useState<Record<string, string>>({})
  const [videoBulkFind, setVideoBulkFind] = useState('')
  const [videoBulkReplace, setVideoBulkReplace] = useState('')
  const [isGeneratingImages, setIsGeneratingImages] = useState(false)
  const [imageProgress, setImageProgress] = useState(0)
  const [generatingShotIds, setGeneratingShotIds] = useState<Record<string, boolean>>({})

const [doubaoSizeMode, setDoubaoSizeMode] = useState<DoubaoSizeMode>('preset')
  const [doubaoResolution, setDoubaoResolution] = useState<DoubaoResolution>('4K')
  const [doubaoAspect, setDoubaoAspect] = useState<AspectOption>('9:16')
  const [customWidth, setCustomWidth] = useState('2048')
  const [customHeight, setCustomHeight] = useState('2048')
  const [hasEditedCustomSize, setHasEditedCustomSize] = useState(false)

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([])
  const [newReferenceUrl, setNewReferenceUrl] = useState('')
  const [newReferenceLabel, setNewReferenceLabel] = useState('')
  const [isAddingReference, setIsAddingReference] = useState(false)
  const [isStep2Stuck, setIsStep2Stuck] = useState(false)
  const step2SentinelRef = useRef<HTMLDivElement | null>(null)
  const step2SectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const sentinel = step2SentinelRef.current
    if (!sentinel) return
    const topOffsetPx = 64 // 对应 top-16
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        setIsStep2Stuck(!entry.isIntersecting)
      },
      {
        root: null,
        threshold: 0,
        rootMargin: `-${topOffsetPx}px 0px 0px 0px`
      }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])
  const [newReferenceFile, setNewReferenceFile] = useState<File | null>(null)
  const [isUploadingReference, setIsUploadingReference] = useState(false)

  const [bulkFind, setBulkFind] = useState('')
  const [bulkReplaceValue, setBulkReplaceValue] = useState('')
  // 默认替换选项与批量替换规则
  const [bulkRules, setBulkRules] = useState<Array<{ id: string; find: string; replace: string }>>([
    { id: 'rule_default_1', find: '角色A', replace: '参考图1' },
    { id: 'rule_default_2', find: '角色B', replace: '参考图2' },
    { id: 'rule_default_3', find: '角色C', replace: '参考图3' }
  ])
  const [videoJobs, setVideoJobs] = useState<Record<string, VideoJobState>>({})
  const [veoModel, setVeoModel] = useState('veo3-fast-frames')
  const [veoAspectRatio, setVeoAspectRatio] = useState<'16:9' | '9:16'>('9:16')
  const [veoEnhancePrompt, setVeoEnhancePrompt] = useState(true)
  const [veoUpsample, setVeoUpsample] = useState(false)
  const [useImageAsKeyframe, setUseImageAsKeyframe] = useState(true)
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false)
  const [isDownloadingImages, setIsDownloadingImages] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [scriptId, setScriptId] = useState<string | null>(null)

  // 图片放大预览（模态框）
  const [imagePreview, setImagePreview] = useState<{ url: string; alt: string } | null>(null)
  useEffect(() => {
    if (!imagePreview) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImagePreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [imagePreview])

  const hasSegments = segments.length > 0

  const selectedReferenceImages = useMemo(
    () =>
      selectedReferenceIds
        .map(id => referenceImages.find(img => img.id === id))
        .filter(Boolean) as ReferenceImage[],
    [referenceImages, selectedReferenceIds]
  )

  const projectSlug = useMemo(() => slugify(projectName || 'storyboard'), [projectName])

  useEffect(() => {
    if (doubaoSizeMode !== 'custom') {
      return
    }
    if (hasEditedCustomSize) {
      return
    }
    const defaults = CUSTOM_DEFAULT_DIMENSIONS[doubaoAspect]
    if (!defaults) {
      return
    }
    setCustomWidth(String(defaults.width))
    setCustomHeight(String(defaults.height))
  }, [doubaoAspect, doubaoSizeMode, hasEditedCustomSize])

  useEffect(() => {
    if (doubaoSizeMode === 'preset') {
      setHasEditedCustomSize(false)
    }
  }, [doubaoSizeMode])

  useEffect(() => {
    const loadReferences = async () => {
      try {
        const items = await getReferenceImages()
        setReferenceImages(items)
        setSelectedReferenceIds(prev => prev.filter(id => items.some(item => item.id === id)))
      } catch (error) {
        console.error('Failed to load reference images', error)
        setStatus({ type: 'error', text: 'Failed to load reference images.' })
      }
    }
    loadReferences()
  }, [])

  // moved handleBulkDownloadImages below downloadImage to avoid ReferenceError due to dependency on downloadImage


  const {
    sizeValue: doubaoSizeValue,
    displayLabel: doubaoSizeLabel,
    error: doubaoSizeError
  } = useMemo(() => {
    const aspectInfo = parseAspect(doubaoAspect)
    if (!aspectInfo) {
      return { sizeValue: null, displayLabel: '', error: 'Invalid aspect selection.' }
    }

    const ratio = aspectInfo.ratio
    if (ratio < 1 / 16 || ratio > 16) {
      return { sizeValue: null, displayLabel: '', error: 'Aspect ratio must be between 1/16 and 16.' }
    }

    const formatLabel = (width: number, height: number, extra?: string) => {
      const base = `${width}x${height}`
      return extra ? `${base} (${extra})` : base
    }

    if (doubaoSizeMode === 'preset') {
      const base = RESOLUTION_DIMENSIONS[doubaoResolution]
      if (!base) {
        return { sizeValue: null, displayLabel: '', error: 'Select a resolution.' }
      }

      let width: number
      let height: number

      if (ratio >= 1) {
        width = base
        height = Math.round(width / ratio)
        if (height < MIN_DOUDAO_DIMENSION) {
          height = MIN_DOUDAO_DIMENSION
          width = Math.round(height * ratio)
        }
      } else {
        height = base
        width = Math.round(height * ratio)
        if (width < MIN_DOUDAO_DIMENSION) {
          width = MIN_DOUDAO_DIMENSION
          height = Math.round(width / ratio)
        }
      }

      if (
        width < MIN_DOUDAO_DIMENSION ||
        width > MAX_DOUDAO_DIMENSION ||
        height < MIN_DOUDAO_DIMENSION ||
        height > MAX_DOUDAO_DIMENSION
      ) {
        return {
          sizeValue: null,
          displayLabel: '',
          error: `Resolution ${width}x${height} with aspect ${doubaoAspect} is outside 1024-4096.`
        }
      }

      return {
        sizeValue: `${width}x${height}`,
        displayLabel: formatLabel(width, height, `${doubaoResolution} | ${doubaoAspect}`)
      }
    }

    const width = Number.parseInt(customWidth, 10)
    const height = Number.parseInt(customHeight, 10)

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return { sizeValue: null, displayLabel: '', error: 'Enter numeric width and height.' }
    }

    if (
      width < MIN_DOUDAO_DIMENSION ||
      width > MAX_DOUDAO_DIMENSION ||
      height < MIN_DOUDAO_DIMENSION ||
      height > MAX_DOUDAO_DIMENSION
    ) {
      return {
        sizeValue: null,
        displayLabel: '',
        error: `Width and height must be within ${MIN_DOUDAO_DIMENSION}-${MAX_DOUDAO_DIMENSION}.`
      }
    }

    const expectedRatio = ratio
    const currentRatio = width / height
    if (Math.abs(currentRatio - expectedRatio) > 0.01) {
      return {
        sizeValue: null,
        displayLabel: '',
        error: `Pixels ${width}x${height} do not match ${doubaoAspect}.`
      }
    }

    return {
      sizeValue: `${width}x${height}`,
      displayLabel: formatLabel(width, height, doubaoAspect)
    }
  }, [customHeight, customWidth, doubaoAspect, doubaoResolution, doubaoSizeMode])

  const isDoubaoSizeValid = Boolean(doubaoSizeValue)
  const handleParseJson = useCallback(async () => {
    if (!rawJson.trim()) {
      setParseError('Please provide storyboard JSON data.')
      setSegments([])
      return
    }

    try {
      const parsed = JSON.parse(rawJson) as StoryboardRawSegment[]
      if (!Array.isArray(parsed)) {
        throw new Error('Root must be an array.')
      }

      const normalised: StoryboardSegment[] = parsed.map((item, index) => {
        const record = (item ?? {}) as StoryboardRawSegment
        const shotNumber = typeof record.shot_number === 'number' ? record.shot_number : index + 1
        const recordMap = record as Record<string, unknown>

        const rawPromptValue =
          recordMap['prompt'] ??
          recordMap['prompt_detail'] ??
          recordMap['promptDetail'] ??
          recordMap['promptDetails'] ??
          recordMap['prompt_json'] ??
          recordMap['promptJson'] ??
          recordMap['prompt_text'] ??
          recordMap['promptText']

        const prompt = normalizePromptValue(rawPromptValue)
        const promptText = resolvePromptText(prompt, rawPromptValue, shotNumber)

        return {
          ...record,
          id: record.id ? String(record.id) : `shot-${shotNumber}-${index}`,
          shotNumber,
          prompt,
          promptText
        }
      })

      setSegments(normalised)
      setSelectedForImages(normalised.map(segment => segment.id))
      setSelectedForVideo([])
      setImageResults({})
      setVideoJobs({})
      setVideoPromptOverrides({})
      setParseError(null)
      setStatus({ type: 'success', text: `Parsed ${normalised.length} storyboard shots.` })

      // Create Supabase project and script for persistence
      try {
        const project = await createProject(projectName || 'Storyboard Project', 'Storyboard parsed in workbench')
        setProjectId(project.id)
        const scriptSegments: DbScriptSegment[] = normalised.map(s => ({
          id: s.id,
          scene: s.prompt?.subject?.action || s.prompt?.environment || '',
          prompt: s.promptText,
          characters: [],
          setting: s.prompt?.environment || '',
          mood: s.prompt?.time_of_day || ''
        }))
        const script = await createScript(project.id, scriptSegments)
        setScriptId(script.id)
      } catch (e) {
        console.error('Failed to create project/script for Supabase', e)
      }
    } catch (error) {
      console.error('Failed to parse storyboard JSON', error)
      setParseError('Failed to parse JSON. Please check the format.')
      setSegments([])
      setSelectedForImages([])
      setSelectedForVideo([])
      setImageResults({})
      setVideoJobs({})
      setVideoPromptOverrides({})
    }
  }, [rawJson, projectName])

  const handleParseCsv = useCallback(async () => {
    const input = rawJson.trim()
    if (!input) {
      setParseError('请提供 CSV 文本或上传 CSV 文件。')
      setSegments([])
      return
    }

    try {
      const normalised = parseStoryboardCsv(input)
      if (!normalised.length) {
        throw new Error('未解析到任何分镜。请检查 CSV 格式（分镜数,分镜提示词）。')
      }

      setSegments(normalised)
      setSelectedForImages(normalised.map(segment => segment.id))
      setSelectedForVideo([])
      setImageResults({})
      setVideoJobs({})
      setVideoPromptOverrides({})
      setParseError(null)
      setStatus({ type: 'success', text: `Parsed ${normalised.length} storyboard shots from CSV.` })

      // Supabase 持久化（与 JSON 逻辑一致）
      try {
        const project = await createProject(projectName || 'Storyboard Project', 'Storyboard parsed from CSV in workbench')
        setProjectId(project.id)
        const scriptSegments: DbScriptSegment[] = normalised.map(s => ({
          id: s.id,
          scene: s.prompt?.subject?.action || s.prompt?.environment || '',
          prompt: s.promptText,
          characters: [],
          setting: s.prompt?.environment || '',
          mood: s.prompt?.time_of_day || ''
        }))
        const script = await createScript(project.id, scriptSegments)
        setScriptId(script.id)
      } catch (e) {
        console.error('Failed to create project/script for Supabase (CSV)', e)
      }
    } catch (error) {
      console.error('Failed to parse storyboard CSV', error)
      setParseError('CSV 解析失败。请检查格式或尝试 JSON 解析。')
      setSegments([])
      setSelectedForImages([])
      setSelectedForVideo([])
      setImageResults({})
      setVideoJobs({})
      setVideoPromptOverrides({})
    }
  }, [rawJson, projectName])

  const handleFileImport = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setRawJson(text)
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const toggleSelection = useCallback(
    (id: string, selected: string[], setter: (ids: string[]) => void) => {
      setter(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id])
    },
    []
  )

  const handleBulkReplaceSegments = useCallback(() => {
    // 组合所有有效规则：来自单次输入与批量规则列表
    const rules: { find: string; replace: string }[] = []
    if (bulkFind.trim().length > 0) {
      rules.push({ find: bulkFind, replace: bulkReplaceValue })
    }
    bulkRules.forEach(rule => {
      if (rule.find.trim().length > 0) {
        rules.push({ find: rule.find, replace: rule.replace })
      }
    })

    if (!rules.length) {
      setStatus({ type: 'info', text: '请输入查找文本，或在替换选项中至少添加一条有效规则。' })
      return
    }

    const applyRules = (value?: string) => {
      if (typeof value !== 'string' || value.length === 0) return value
      return rules.reduce((acc, rule) => acc.split(rule.find).join(rule.replace), value)
    }

    setSegments(prev =>
      prev.map(segment => {
        const next: StoryboardSegment = {
          ...segment,
          promptText: applyRules(segment.promptText) ?? ''
        }

        if (segment.prompt) {
          const prompt: StoryboardPrompt = { ...segment.prompt }
          prompt.environment = applyRules(prompt.environment)
          prompt.time_of_day = applyRules(prompt.time_of_day)
          prompt.weather = applyRules(prompt.weather)
          prompt.camera_angle = applyRules(prompt.camera_angle)
          prompt.shot_size = applyRules(prompt.shot_size)
          if (prompt.subject) {
            const subject: StoryboardSubject = { ...prompt.subject }
            subject.characters_present = applyRules(subject.characters_present)
            subject.expression = applyRules(subject.expression)
            subject.action = applyRules(subject.action)
            prompt.subject = subject
          }
          next.prompt = prompt
        }

        return next
      })
    )

    setStatus({ type: 'success', text: `已对所有预览镜头应用批量替换，共执行 ${rules.length} 条规则。` })
  }, [bulkFind, bulkReplaceValue, bulkRules])

  const handleAddReferenceImage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newReferenceUrl.trim()) {
      return
    }

    setIsAddingReference(true)
    try {
      const image = await addReferenceImage(newReferenceUrl.trim(), newReferenceLabel.trim() || undefined)
      setReferenceImages(prev => [image, ...prev])
      setSelectedReferenceIds(prev => [image.id, ...prev])
      setNewReferenceUrl('')
      setNewReferenceLabel('')
      setStatus({ type: 'success', text: 'Reference image added.' })
    } catch (error) {
      console.error('Failed to add reference image', error)
      setStatus({ type: 'error', text: 'Failed to add reference image.' })
    } finally {
      setIsAddingReference(false)
    }
  }, [newReferenceUrl, newReferenceLabel])

  const handleRemoveReferenceImage = useCallback(async (id: string) => {
    try {
      await removeReferenceImage(id)
      setReferenceImages(prev => prev.filter(image => image.id !== id))
      setSelectedReferenceIds(prev => prev.filter(item => item !== id))
    } catch (error) {
      console.error('Failed to remove reference image', error)
      setStatus({ type: 'error', text: 'Failed to remove reference image.' })
    }
  }, [])

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleUploadReferenceImage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const file = newReferenceFile
    if (!file) {
      setStatus({ type: 'error', text: '请选择要上传的图片文件。' })
      return
    }
    setIsUploadingReference(true)
    try {
      let finalUrl: string | null = null
      let usedDataUrlFallback = false
      if (!isDemoMode && (supabase as any)?.storage) {
        try {
          const ext = (file.name.split('.').pop() || 'png').toLowerCase()
          const path = `reference-images/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
          const { error: uploadError } = await supabase.storage
            .from('reference-images')
            .upload(path, file, { upsert: false, contentType: file.type || `image/${ext}` })
          if (uploadError) {
            throw uploadError
          }
          const { data: publicData } = supabase.storage.from('reference-images').getPublicUrl(path)
          finalUrl = publicData?.publicUrl || null
        } catch (err) {
          console.warn('Supabase Storage upload failed (bucket missing?), falling back to Data URL.', err)
        }
      }
      if (!finalUrl) {
        finalUrl = await fileToDataUrl(file)
        usedDataUrlFallback = true
      }
      const image = await addReferenceImage(finalUrl, newReferenceLabel.trim() || undefined)
      setReferenceImages(prev => [image, ...prev])
      setSelectedReferenceIds(prev => [image.id, ...prev])
      setNewReferenceFile(null)
      setNewReferenceLabel('')
      setStatus({ type: 'success', text: usedDataUrlFallback ? '参考图已上传（使用本地 Data URL）。' : '参考图已上传。' })
    } catch (error) {
      console.error('Failed to upload reference image', error)
      setStatus({ type: 'error', text: '上传参考图失败。' })
    } finally {
      setIsUploadingReference(false)
    }
  }, [newReferenceFile, newReferenceLabel])

  const toggleReferenceSelection = useCallback((id: string) => {
    setSelectedReferenceIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]))
  }, [])

  const handleGenerateImageForShot = useCallback(
    async (segment: StoryboardSegment) => {
      if (!doubaoSizeValue) {
        setStatus({
          type: 'error',
          text: doubaoSizeError ?? 'Configure a valid size before generating images.'
        })
        return
      }

      setGeneratingShotIds(prev => ({ ...prev, [segment.id]: true }))
      try {
        const referenceUrls = selectedReferenceImages.map(image => image.url)

        const [result] = await generateBatchImages(
          [
            {
              prompt: formatPromptForModel(segment),
              size: doubaoSizeValue,
              referenceImageUrls: referenceUrls.length ? referenceUrls : undefined
            }
          ],
          { size: doubaoSizeValue }
        )

        if (result) {
          setImageResults(prev => ({
            ...prev,
            [segment.id]: {
              url: result.url,
              prompt: result.prompt ?? formatPromptForModel(segment),
              referenceImageUrl: result.referenceImageUrl,
              referenceImageUrls: result.referenceImageUrls
            }
          }))
          const marker = doubaoSizeLabel ? ` at ${doubaoSizeLabel}` : ''
          setStatus({ type: 'success', text: `Generated image for shot ${segment.shotNumber}${marker}.` })

          // Persist image to Supabase if scriptId is available
          if (scriptId) {
            try {
              await createGeneratedImage(
                scriptId,
                result.prompt ?? formatPromptForModel(segment),
                result.url
              )
            } catch (e) {
              console.error('Failed to save generated image to Supabase', e)
            }
          }
        }
      } catch (error) {
        console.error(`Failed to generate image for shot ${segment.id}`, error)
        setStatus({ type: 'error', text: `Failed to generate image for shot ${segment.shotNumber}.` })
      } finally {
        setGeneratingShotIds(prev => {
          const next = { ...prev }
          delete next[segment.id]
          return next
        })
      }
    },
    [doubaoSizeValue, doubaoSizeError, doubaoSizeLabel, selectedReferenceImages, setImageResults, setStatus]
  )

  const handleGenerateImages = useCallback(async () => {
    if (!segments.length) {
      setStatus({ type: 'info', text: 'Parse storyboard JSON before generating images.' })
      return
    }

    const targets = segments.filter(segment =>
      !selectedForImages.length || selectedForImages.includes(segment.id)
    )

    if (!targets.length) {
      setStatus({ type: 'info', text: 'Select at least one shot for Doubao images.' })
      return
    }

    if (!doubaoSizeValue) {
      setStatus({ type: 'error', text: doubaoSizeError ?? 'Configure a valid size before generating images.' })
      return
    }

    const prompts = targets.map(segment => formatPromptForModel(segment))
    const selectedRefs = selectedReferenceImages

    setIsGeneratingImages(true)
    setImageProgress(0)
    try {
      const requests = targets.map((segment, index) => {
        const refUrls = Array.isArray((segment as any).referenceImages)
          ? ((segment as any).referenceImages as { url: string }[]).map(img => img.url)
          : undefined
        return {
          prompt: prompts[index],
          size: doubaoSizeValue,
          referenceImageUrls: refUrls ?? selectedRefs.map(image => image.url)
        }
      })

      const results = await generateBatchImages(requests, {
        size: doubaoSizeValue,
        onProgress: (completed, total) => {
          setImageProgress(Math.round((completed / total) * 100))
        }
      })

      const merged: Record<string, ImageResult> = { ...imageResults }
      results.forEach((result, index) => {
        const segmentId = targets[index]?.id
        if (segmentId) {
          merged[segmentId] = {
            url: result.url,
            prompt: result.prompt ?? prompts[index],
            referenceImageUrl: result.referenceImageUrl,
            referenceImageUrls: result.referenceImageUrls
          }
        }
      })

      setImageResults(merged)

      // Persist batch images to Supabase if scriptId is available
      if (scriptId) {
        try {
          await Promise.all(
            results.map((result, index) =>
              createGeneratedImage(
                scriptId,
                result.prompt ?? prompts[index],
                result.url
              )
            )
          )
        } catch (e) {
          console.error('Failed to save batch images to Supabase', e)
        }
      }

      setStatus({
        type: 'success',
        text: `Generated ${results.length} reference images${doubaoSizeLabel ? ` at ${doubaoSizeLabel}` : ''}.`
      })
    } catch (error) {
      console.error('Failed to generate images via Doubao', error)
      setStatus({ type: 'error', text: 'Doubao image generation failed. Check API settings.' })
    } finally {
      setIsGeneratingImages(false)
      setImageProgress(0)
    }
  }, [segments, selectedForImages, doubaoSizeValue, doubaoSizeError, doubaoSizeLabel, selectedReferenceImages, imageResults])

  const downloadImage = useCallback(async (url: string, filename: string) => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      // Prefer server-side proxy to avoid CORS/opaque response issues
      const proxyUrl = `/api/download-image?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
      const response = await fetch(proxyUrl)
      if (!response.ok) {
        // Fallback: try direct fetch in browser (may fail due to CORS)
        const direct = await fetch(url)
        if (!direct.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`)
        }
        const blob = await direct.blob()
        const objectUrl = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(objectUrl)
        return
      }

      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(objectUrl)
    } catch (error) {
      console.error('Download failed', error)
    }
  }, [])

  const handleSubmitVideos = useCallback(async () => {
    if (!segments.length) {
      setStatus({ type: 'info', text: 'Parse storyboard JSON before submitting Veo jobs.' })
      return
    }

    const targets = segments.filter(segment => selectedForVideo.includes(segment.id) && imageResults[segment.id])
    if (!targets.length) {
      setStatus({ type: 'info', text: 'Select at least one shot with a generated image.' })
      return
    }

    setIsSubmittingVideo(true)
    try {
      const nextJobs: Record<string, VideoJobState> = { ...videoJobs }
      for (const target of targets) {
        const image = imageResults[target.id]
        if (!image) {
          continue
        }

        const customPrompt = videoPromptOverrides[target.id]?.trim()
        const actionOnly = extractActionText(target, image.prompt)
        const promptForVideo = customPrompt && customPrompt.length > 0
          ? customPrompt
          : (actionOnly || image.prompt || formatPromptForModel(target))

        nextJobs[target.id] = { status: 'pending' }
        setVideoJobs({ ...nextJobs })

        try {
          const response = await createVeo3Job(promptForVideo, {
            model: veoModel,
            aspectRatio: veoAspectRatio,
            enhancePrompt: veoEnhancePrompt,
            enableUpsample: veoUpsample,
            images: useImageAsKeyframe ? [image.url] : undefined
          })

          nextJobs[target.id] = {
            status: 'success',
            jobId: response.id
          }
          setVideoJobs({ ...nextJobs })

          // Persist Veo3 submission to Supabase
          try {
            const saved = await createGeneratedVideo(
              image.url,
              promptForVideo,
              scriptId,
              'pending',
              ''
            )
            nextJobs[target.id] = { ...nextJobs[target.id], dbId: saved.id }
            setVideoJobs({ ...nextJobs })
          } catch (e) {
            console.error('Failed to save video record to Supabase', e)
          }
        } catch (error) {
          console.error('Failed to submit Veo3 job', error)
          nextJobs[target.id] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Submission failed'
          }
          setVideoJobs({ ...nextJobs })
        }
      }

      const submittedCount = targets.length
      setStatus({
        type: 'success',
        text: `Submitted ${submittedCount} Veo3 task${submittedCount === 1 ? '' : 's'}.`
      })
    } finally {
      setIsSubmittingVideo(false)
    }
  }, [segments, selectedForVideo, imageResults, videoPromptOverrides, veoModel, veoAspectRatio, veoEnhancePrompt, veoUpsample, useImageAsKeyframe, projectSlug, downloadImage, videoJobs])

  // 新增：批量替换 Video prompt 文本
  const handleApplyVideoBulkReplace = useCallback((scope: any) => {
    const find = videoBulkFind
    const replace = videoBulkReplace
    if (!find || find.length === 0) {
      setStatus({ type: 'info', text: '请输入要查找的文本。' })
      return
    }

    const targets = scope === 'selected'
      ? segments.filter(s => selectedForVideo.includes(s.id))
      : segments

    if (!targets.length) {
      setStatus({ type: 'info', text: scope === 'selected' ? '请先勾选要提交至 Veo3 的镜头。' : '没有可处理的镜头。' })
      return
    }

    const nextOverrides: Record<string, string> = { ...videoPromptOverrides }
    targets.forEach(seg => {
      const img = imageResults[seg.id]
      const base = (videoPromptOverrides[seg.id]?.trim())
        || extractActionText(seg, img?.prompt)
        || img?.prompt
        || formatPromptForModel(seg)
      nextOverrides[seg.id] = (base || '').split(find).join(replace)
    })

    setVideoPromptOverrides(nextOverrides)
    setStatus({ type: 'success', text: `已对 ${targets.length} 个镜头的 Video prompt 执行批量替换。` })
  }, [segments, selectedForVideo, imageResults, videoPromptOverrides, videoBulkFind, videoBulkReplace])
   const handleBulkDownloadImages = useCallback(async () => {
    const slug = projectSlug || 'storyboard'
    const items = segments
      .map(s => ({ s, img: imageResults[s.id] }))
      .filter(item => Boolean(item.img))

    if (items.length === 0) {
      setStatus({ type: 'error', text: 'No generated images to download.' })
      return
    }

    setIsDownloadingImages(true)
    try {
      const payload = {
        projectSlug: slug,
        items: items.map(({ s, img }) => {
          const customPrompt = videoPromptOverrides[s.id]?.trim()
          const actionOnly = extractActionText(s, img?.prompt)
          const promptForVideo = customPrompt && customPrompt.length > 0
            ? customPrompt
            : (actionOnly || img?.prompt || formatPromptForModel(s))
          return {
            shotNumber: s.shotNumber,
            prompt: promptForVideo,
            imageUrl: img?.url
          }
        })
      }

      const resp = await fetch('/api/bulk-save-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Bulk save failed: ${resp.status} ${text}`)
      }

      const data = await resp.json()
      setStatus({ type: 'success', text: `Saved ${data.saved} images to ${data.project_dir}. Task: ${data.task_file}` })
    } catch (e) {
      console.error('Bulk save images failed', e)
      setStatus({ type: 'error', text: 'Bulk save images failed.' })
    } finally {
      setIsDownloadingImages(false)
    }
  }, [segments, imageResults, projectSlug, videoPromptOverrides])

  const selectableSegments = useMemo(
    () =>
      segments.map(segment => ({
        ...segment,
        hasImage: Boolean(imageResults[segment.id])
      })),
    [segments, imageResults]
  )

  const hasVideoSelection = selectedForVideo.some(id => imageResults[id])
  return (
    <div className="space-y-8">
      <header className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Storyboard prompt workflow</h1>
        <p className="mt-2 text-sm text-gray-600">
          Parse a storyboard JSON file, generate Doubao references, and optionally submit Veo3 jobs.
        </p>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
          <label className="text-sm text-gray-600 md:w-80">
            Project name
            <input
              type="text"
              value={projectName}
              onChange={event => setProjectName(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Storyboard Project"
            />
          </label>
          <p className="text-xs text-gray-500">
            The project name is used when downloading images and preparing Veo prompts.
          </p>
        </div>
      </header>

      {/* Floating right-side step tabs */}
      <nav className="fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col space-y-2 md:flex">
        <a href="#step-1" className="rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 1 解析提示词</a>
        <a href="#step-2" className="rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 2 参考图 | 分镜图</a>
        <a href="#step-3" className="rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 3 设置图片</a>
        <a href="#step-4" className="rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 4 生成视频</a>
      </nav>

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
          {status.text}
        </div>
      )}
      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="step-1" className="text-lg font-semibold text-gray-900">Step 1 - Load storyboard JSON/CSV</h2>
            <p className="text-sm text-gray-500">Paste the JSON array or CSV text (shots,prompt), or upload a file, then parse to preview each shot.</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
              <input type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={handleFileImport} />
              Upload JSON/CSV file
            </label>
            <button
              type="button"
              onClick={handleParseJson}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Parse JSON
            </button>
            <button
              type="button"
              onClick={handleParseCsv}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Parse CSV
            </button>
          </div>
        </div>
        <textarea
          value={rawJson}
          onChange={event => setRawJson(event.target.value)}
          className="h-64 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Paste storyboard JSON array or CSV text here"
        />
        {parseError && <p className="text-sm text-red-600">{parseError}</p>}
      </section>

      <div ref={step2SentinelRef} aria-hidden className="h-16" />
 
       <section ref={step2SectionRef} className={`sticky top-16 z-30 rounded-lg border border-gray-200 bg-white p-6 shadow-sm ${isStep2Stuck ? 'opacity-90' : ''}`}>
         <div className="flex items-center justify-between">
           <h2 id="step-2" className="text-lg font-semibold text-gray-900">Step 2 - Preview shots</h2>
           {hasSegments && <span className="text-xs text-gray-500">{segments.length} shots</span>}
         </div>

        {/* Reference images (选择与预览) */}
        {referenceImages.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">Reference images（按顺序使用）</p>
            <div className="flex flex-wrap gap-2">
              {referenceImages.map((image, idx) => {
                const isSelected = selectedReferenceIds.includes(image.id)
                const orderedIndex = isSelected
                  ? selectedReferenceIds.findIndex(id => id === image.id) + 1
                  : null
                return (
                  <div
                    key={image.id}
                    className={`group relative flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                      isSelected ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                    }`}
                    title={image.label ?? image.url}
                  >
                    <button
                      type="button"
                      onClick={() => toggleReferenceSelection(image.id)}
                      className="flex items-center gap-2"
                    >
                      <span className="relative h-8 w-8 overflow-hidden rounded bg-gray-100">
                        <img
                          src={image.url}
                          alt={image.label ?? 'Reference'}
                          className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-110"
                        />
                        {orderedIndex && (
                          <span className="absolute left-0 top-0 rounded-br bg-blue-600 px-1 text-[10px] text-white">
                            {orderedIndex}
                          </span>
                        )}
                      </span>
                      <span className="max-w-[180px] truncate text-left">
                        {image.label ?? image.url}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
            {selectedReferenceImages.length > 0 && (
              <p className="text-xs text-gray-500">
                已选择 {selectedReferenceImages.length} 张参考图，使用顺序：{' '}
                {selectedReferenceImages.map((img, i) => `${i + 1}`).join(' → ')}
              </p>
            )}
          </div>
        )}
        {hasSegments && !isStep2Stuck && (
          <div className="mt-4 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-medium text-gray-700">Bulk replace text in the preview shots</p>
              <button
                type="button"
                onClick={handleBulkReplaceSegments}
                className="self-start rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
              >
                Apply replace
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
              <input
                type="text"
                value={bulkFind}
                onChange={event => setBulkFind(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Find text"
              />
              <input
                type="text"
                value={bulkReplaceValue}
                onChange={event => setBulkReplaceValue(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Replace with"
              />
              <p className="text-xs text-gray-500 md:col-span-1">
                Fields inside the structured prompt will be updated when possible.
              </p>
            </div>
            {/* 替换选项（默认提供角色A>参考图1、角色B>参考图2、角色C>参考图3） */}
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-700">替换选项（按顺序执行，可编辑并可新增）</p>
              <div className="space-y-2">
                {bulkRules.map((rule, idx) => (
                  <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                    <input
                      type="text"
                      value={rule.find}
                      onChange={e => setBulkRules(prev => prev.map(r => (r.id === rule.id ? { ...r, find: e.target.value } : r)))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Find（例如：角色${String.fromCharCode(65 + idx)})`}
                    />
                    <input
                      type="text"
                      value={rule.replace}
                      onChange={e => setBulkRules(prev => prev.map(r => (r.id === rule.id ? { ...r, replace: e.target.value } : r)))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Replace with（例如：参考图${idx + 1})`}
                    />
                    <button
                      type="button"
                      onClick={() => setBulkRules(prev => prev.filter(r => r.id !== rule.id))}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkRules(prev => [...prev, { id: `rule_${Date.now()}_${prev.length + 1}`, find: '', replace: '' }])}
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  新增选项
                </button>
                <span className="text-xs text-gray-500">默认已提供：角色A→参考图1、角色B→参考图2、角色C→参考图3</span>
              </div>
            </div>
          </div>
          )}
      </section>

      {selectableSegments.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {selectableSegments.map(segment => {
            const imageRecord = imageResults[segment.id]
            const isShotGenerating = Boolean(generatingShotIds[segment.id])
            const hasGeneratedImage = Boolean(imageRecord)
            const buttonLabel = isShotGenerating ? 'Generating...' : hasGeneratedImage ? 'Regenerate' : 'Generate image'

            return (
              <div key={segment.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Shot {segment.shotNumber}</p>
                    {segment.duration && (
                      <p className="text-xs text-gray-500">Duration: {segment.duration}</p>
                    )}
                  </div>
                  <div className="space-y-1 text-right text-xs text-gray-500">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={selectedForImages.includes(segment.id)}
                        onChange={() => toggleSelection(segment.id, selectedForImages, setSelectedForImages)}
                        className="rounded border-gray-300"
                      />
                      Doubao
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={selectedForVideo.includes(segment.id)}
                        onChange={() => toggleSelection(segment.id, selectedForVideo, setSelectedForVideo)}
                        className="rounded border-gray-300"
                      />
                      Veo3
                    </label>
                  </div>
                </div>
                <div className="rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 whitespace-pre-wrap">
                  {segment.promptText}
                </div>
                <details className="group">
                  <summary className="cursor-pointer select-none text-xs text-blue-600 hover:underline">编辑 Shot 文本</summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <label htmlFor={`shot-text-${segment.id}`} className="block text-xs font-medium text-gray-600">Shot 文本</label>
                      <textarea
                        id={`shot-text-${segment.id}`}
                        value={segment.promptText}
                        onChange={e => {
                          const updated = { ...segment, promptText: e.target.value }
                          setSegments(prev => prev.map(s => (s.id === segment.id ? updated : s)))
                        }}
                        className="h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="可直接编辑文本"
                      />
                    </div>
                    <div>
                      <label htmlFor={`shot-characters-${segment.id}`} className="block text-xs font-medium text-gray-600">Characters（角色）</label>
                      <input
                        id={`shot-characters-${segment.id}`}
                        type="text"
                        value={segment.prompt?.subject?.characters_present ?? ''}
                        onChange={e => {
                          const updated = {
                            ...segment,
                            prompt: {
                              ...(segment.prompt ?? {}),
                              subject: {
                                ...(segment.prompt?.subject ?? {}),
                                characters_present: e.target.value
                              }
                            }
                          }
                          setSegments(prev => prev.map(s => (s.id === segment.id ? updated : s)))
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="例如：角色A，角色B（可逗号分隔）"
                      />
                    </div>
                  </div>
                </details>
                {segment.prompt?.subject?.characters_present && (
                  <p className="text-xs text-gray-500">Characters: {segment.prompt.subject.characters_present}</p>
                )}
                {imageRecord ? (
                  <div className="space-y-2">
                    <div className="flex h-56 items-center justify-center overflow-hidden rounded-md bg-gray-100">
                      <img
                        src={imageRecord.url}
                        alt={`Shot ${segment.shotNumber}`}
                        className="max-h-56 w-full object-contain"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500">Doubao prompt: {imageRecord.prompt}</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">No image generated yet.</p>
                )}
                <button
                  type="button"
                  onClick={() => handleGenerateImageForShot(segment)}
                  disabled={isShotGenerating || isGeneratingImages || !isDoubaoSizeValid}
                  className="self-start rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {buttonLabel}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!hasSegments && (
        <p className="mt-4 text-sm text-gray-500">Shots will appear here after parsing your JSON.</p>
      )}

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="step-3" className="text-lg font-semibold text-gray-900">Step 3 - Generate Doubao images</h2>
            <p className="text-sm text-gray-500">Choose aspect ratio, resolution, and optional reference images before generating.</p>
          </div>
          <div className="text-sm text-gray-600">
            {isDoubaoSizeValid ? (
              <p>Current size: <span className="font-mono">{doubaoSizeLabel}</span></p>
            ) : (
              <p className="text-red-600">{doubaoSizeError ?? 'Set a valid size before generating.'}</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium text-gray-700">Aspect ratio</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {ASPECT_OPTIONS.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setDoubaoAspect(option)
                      setHasEditedCustomSize(false)
                    }}
                    className={`inline-flex items-center gap-2 rounded border px-3 py-1 text-sm ${
                      doubaoAspect === option ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-gray-700">Size mode</span>
              <div className="flex flex-wrap gap-3 text-sm text-gray-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="doubao-size-mode"
                    value="preset"
                    checked={doubaoSizeMode === 'preset'}
                    onChange={() => setDoubaoSizeMode('preset')}
                    className="rounded border-gray-300"
                  />
                  Resolution (1K / 2K / 4K)
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="doubao-size-mode"
                    value="custom"
                    checked={doubaoSizeMode === 'custom'}
                    onChange={() => {
                      setDoubaoSizeMode('custom')
                      setHasEditedCustomSize(false)
                    }}
                    className="rounded border-gray-300"
                  />
                  Custom width x height
                </label>
              </div>
            </div>

            {doubaoSizeMode === 'preset' ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-600">
                  Resolution
                  <select
                    value={doubaoResolution}
                    onChange={event => setDoubaoResolution(event.target.value as DoubaoResolution)}
                    className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  >
                    {RESOLUTION_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-gray-500">
                  Short side baseline: {RESOLUTION_DIMENSIONS[doubaoResolution]} px
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm text-gray-600">
                  Width (px)
                  <input
                    type="number"
                    min={MIN_DOUDAO_DIMENSION}
                    max={MAX_DOUDAO_DIMENSION}
                    value={customWidth}
                    onChange={event => {
                      setCustomWidth(event.target.value)
                      setHasEditedCustomSize(true)
                    }}
                    className="mt-1 w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Height (px)
                  <input
                    type="number"
                    min={MIN_DOUDAO_DIMENSION}
                    max={MAX_DOUDAO_DIMENSION}
                    value={customHeight}
                    onChange={event => {
                      setCustomHeight(event.target.value)
                      setHasEditedCustomSize(true)
                    }}
                    className="mt-1 w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <span className="text-xs text-gray-500">
                  Per side range: {MIN_DOUDAO_DIMENSION}-{MAX_DOUDAO_DIMENSION} px (max 4096x4096)
                </span>
              </div>
            )}

            <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-gray-800">Reference images</h3>
                <p className="text-xs text-gray-500">
                  Selected references are cycled when generating Doubao images.
                </p>
                <p className="text-xs text-gray-500">
                  Selected: {selectedReferenceImages.length}
                </p>
              </div>
              <form onSubmit={handleAddReferenceImage} className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <input
                  type="url"
                  required
                  value={newReferenceUrl}
                  onChange={event => setNewReferenceUrl(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Paste reference image URL"
                />
                <input
                  type="text"
                  value={newReferenceLabel}
                  onChange={event => setNewReferenceLabel(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional label"
                />
                <button
                  type="submit"
                  disabled={isAddingReference}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAddingReference ? 'Saving...' : 'Add reference'}
                </button>
              </form>

              <form onSubmit={handleUploadReferenceImage} className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setNewReferenceFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={newReferenceLabel}
                  onChange={event => setNewReferenceLabel(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional label"
                />
                <button
                  type="submit"
                  disabled={isUploadingReference}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploadingReference ? 'Uploading…' : 'Upload local image'}
                </button>
              </form>
              <div className="flex flex-wrap gap-2">
                {referenceImages.length ? (
                  referenceImages.map(image => {
                    const isSelected = selectedReferenceIds.includes(image.id)
                    return (
                      <div
                        key={image.id}
                        className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                          isSelected ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleReferenceSelection(image.id)}
                          className="flex items-center gap-2"
                        >
                          <span className="h-8 w-8 overflow-hidden rounded bg-gray-100">
                            <img src={image.url} alt={image.label ?? 'Reference'} className="h-full w-full object-cover" />
                          </span>
                          <span className="max-w-[160px] truncate text-left">
                            {image.label ?? image.url}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveReferenceImage(image.id)}
                          className="rounded border border-transparent px-2 py-1 text-[11px] text-gray-500 hover:border-red-300 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    )
                  })
                  ) : (
                  <p className="text-xs text-gray-500">No reference images yet.</p>
                )}
              </div>
            </div>
            {doubaoSizeError && (
              <p className="text-xs text-red-600">{doubaoSizeError}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            <button
              type="button"
              onClick={handleGenerateImages}
              disabled={isGeneratingImages || !isDoubaoSizeValid}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGeneratingImages ? `Generating ${imageProgress}%` : 'Generate images'}
            </button>
          </div>
        </div>
      </section>
      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="step-4" className="text-lg font-semibold text-gray-900">Step 4 - Submit Veo3 videos</h2>
            <p className="text-sm text-gray-500">Select the shots you want to convert to video. Unselected images will be downloaded using the project name.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <label>
              Model
              <select
                value={veoModel}
                onChange={event => setVeoModel(event.target.value)}
                className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="veo3-fast">veo3-fast</option>
                <option value="veo3">veo3</option>
                <option value="veo3-pro">veo3-pro</option>
                <option value="veo3-fast-frames">veo3-fast-frames</option>
              </select>
            </label>
            <label>
              Aspect ratio
              <select
                value={veoAspectRatio}
                onChange={event => setVeoAspectRatio(event.target.value as '16:9' | '9:16')}
                className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="16:9">16 : 9</option>
                <option value="9:16">9 : 16</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={veoEnhancePrompt}
                onChange={event => setVeoEnhancePrompt(event.target.checked)}
                className="rounded border-gray-300"
              />
              Auto translate prompt
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={veoUpsample}
                onChange={event => setVeoUpsample(event.target.checked)}
                className="rounded border-gray-300"
              />
              Enable upsample
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useImageAsKeyframe}
                onChange={event => setUseImageAsKeyframe(event.target.checked)}
                className="rounded border-gray-300"
              />
              Use image as first frame
            </label>
            <button
              type="button"
              onClick={handleSubmitVideos}
              disabled={isSubmittingVideo || !hasVideoSelection}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingVideo ? 'Submitting...' : `Submit Veo3 (${selectedForVideo.length})`}
            </button>
            <button
              type="button"
              onClick={handleBulkDownloadImages}
              disabled={isDownloadingImages || Object.keys(imageResults).length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDownloadingImages ? 'Downloading...' : `Download images (${Object.keys(imageResults).length})`}
            </button>
          </div>
        </div>

        {/* 新增：Veo3 区域的批量替换控件 */}
         <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
           <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
             <label className="text-sm text-gray-700">
               查找
               <input
                 type="text"
                 value={videoBulkFind}
                 onChange={e => setVideoBulkFind(e.target.value)}
                 className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 placeholder="要查找的文本（作用于 Video prompt）"
               />
             </label>
             <label className="text-sm text-gray-700">
               替换为
               <input
                 type="text"
                 value={videoBulkReplace}
                 onChange={e => setVideoBulkReplace(e.target.value)}
                 className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 placeholder="替换文本"
               />
             </label>
             <div className="flex gap-2">
               <button
                 type="button"
                 onClick={() => handleApplyVideoBulkReplace('selected')}
                 disabled={!videoBulkFind}
                 className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
               >
                 仅应用于已选镜头
               </button>
               <button
                 type="button"
                 onClick={() => handleApplyVideoBulkReplace('all')}
                 disabled={!videoBulkFind}
                 className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
               >
                 应用于全部镜头
               </button>
             </div>
           </div>
         </div>
         <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
           {segments.map(segment => {
            const image = imageResults[segment.id]
            const job = videoJobs[segment.id]
            const actionPrompt = extractActionText(segment, image?.prompt)
            const promptFallback = actionPrompt || image?.prompt || formatPromptForModel(segment)
            const promptValue = videoPromptOverrides[segment.id] ?? promptFallback
            const isSelected = selectedForVideo.includes(segment.id)
            const checkboxDisabled = !image
            return (
              <div key={segment.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-800">Shot {segment.shotNumber}</p>
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={checkboxDisabled}
                      onChange={() => toggleSelection(segment.id, selectedForVideo, setSelectedForVideo)}
                      className="rounded border-gray-300"
                    />
                    Use in Veo3
                  </label>
                </div>
                <div className={`group relative overflow-hidden rounded-md bg-gray-100 ${image ? '' : 'flex items-center justify-center p-6'}`}>
                  {image ? (
                    <>
                      <img
                        src={image.url}
                        alt={`Shot ${segment.shotNumber}`}
                        className="max-h-64 w-full cursor-zoom-in object-contain"
                        onClick={() => setImagePreview({ url: image.url, alt: `Shot ${segment.shotNumber}` })}
                      />
                      <button
                        type="button"
                        className="absolute bottom-2 right-2 rounded-full bg-black/60 p-2 text-white shadow hover:bg-black/70"
                        onClick={(e) => { e.stopPropagation(); setImagePreview({ url: image.url, alt: `Shot ${segment.shotNumber}` }) }}
                        aria-label="放大预览"
                        title="放大预览"
                      >
                        🔍
                      </button>
                    </>
                    ) : (
                    <span className="text-xs text-gray-500">Generate a Doubao image first.</span>
                  )}
                </div>
                <label className="text-xs font-medium text-gray-600" htmlFor={`video-prompt-${segment.id}`}>
                  Video prompt
                </label>
                <textarea
                  id={`video-prompt-${segment.id}`}
                  value={promptValue}
                  onChange={event => setVideoPromptOverrides(prev => ({ ...prev, [segment.id]: event.target.value }))}
                  disabled={!image}
                  className={`h-24 w-full rounded-md border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    image ? 'border-gray-300' : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                  }`}
                  placeholder="Video prompt"
                />
                {image && (
                  <p className="text-[11px] text-gray-500">Doubao prompt: {image.prompt}</p>
                )}

                {/* 新增：打开 Doubao 的按钮，携带当前 Shot 的图片与提示词 */}
                <div className="mt-2 space-y-2">
                  <button
                    type="button"
                    className="rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!image}
                    onClick={async () => {
                      if (!image) return
                      // 1) 将分镜图片写入系统剪贴板（Blob），便于到豆包后按 Ctrl+V 粘贴
                      try {
                        const res = await fetch(image.url, { mode: 'cors' })
                        const blob = await res.blob()
                        await navigator.clipboard.write([
                          new ClipboardItem({ [blob.type]: blob })
                        ])
                        console.log('Copied storyboard image blob to clipboard')
                      } catch (err) {
                        console.warn('Failed to copy image blob to clipboard, falling back to URL text', err)
                        try {
                          await navigator.clipboard.writeText(image.url)
                          console.log('Copied image URL to clipboard as fallback')
                        } catch (err2) {
                          console.warn('Clipboard writeText failed', err2)
                        }
                      }

                      // 2) 组织提示词并打开豆包，扩展负责输入 / 激活视频生成与粘贴提示词
                      const actionPrompt = extractActionText(segment, image?.prompt)
                      const promptFallback = actionPrompt || image?.prompt || formatPromptForModel(segment)
                      const pv = videoPromptOverrides[segment.id] ?? promptFallback
                      const payload = {
                        source: 'creative-workbench',
                        shotId: segment.id,
                        shotNumber: segment.shotNumber,
                        imageUrl: image.url,
                        prompt: pv,
                        semiAuto: true
                      }
                      const encoded = encodeURIComponent(
                        btoa(
                          Array.from(new TextEncoder().encode(JSON.stringify(payload)))
                            .map(b => String.fromCharCode(b))
                            .join('')
                        )
                      )
                      const targetUrl = `https://www.doubao.com/?cw=${encoded}`
                      window.open(targetUrl, '_blank', 'noopener')
                    }}
                    title="打开 Doubao 并由浏览器扩展自动提交视频生成（需安装扩展）"
                  >
                    Doubao video
                  </button>

                </div>

                {/* Veo3 任务状态与视频播放 */}
                {job && (
                  <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-700">
                    <div className="flex items-center justify-between">
                      <span>Status: {job.status}{job.error ? ` (${job.error})` : ''}</span>
                      {job.jobId && <span>Job ID: {job.jobId}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-100"
                        disabled={!job.jobId}
                        onClick={async () => {
                          if (!job.jobId) return
                          try {
                            const detail = await fetchVeo3Detail(job.jobId)
                            const rawUrl = detail.video_url || detail?.detail?.video_url || detail?.data?.video_url
                            const videoUrl = typeof rawUrl === 'string' ? rawUrl.trim().replace(/^`|`$/g, '').replace(/^"|"$/g, '') : undefined
                            if (videoUrl) {
                              setVideoJobs(prev => ({
                                ...prev,
                                [segment.id]: { ...(prev[segment.id] || { status: 'success' }), ...job, videoUrl }
                              }))
                              if (job.dbId) {
                                try {
                                  await updateGeneratedVideoStatus(job.dbId, { status: 'completed', video_url: videoUrl })
                                } catch (e) {
                                  console.error('Failed to persist video_url', e)
                                }
                              }
                            }
                          } catch (e) {
                            console.error('Refresh video detail failed', e)
                            setStatus({ type: 'error', text: 'Refresh video detail failed.' })
                          }
                        }}
                      >
                        查询进度/刷新链接
                      </button>
                      {job.videoUrl && (
                        <a href={job.videoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          打开视频链接
                        </a>
                      )}
                    </div>
                    {job.videoUrl && (
                      <div className="mt-2">
                        <video src={job.videoUrl} controls className="w-full rounded" />
                      </div>
                    )}
                  </div>
                )}

                {/* ---- Shot 片段文本编辑 ---- */}
                  <details className="group">
                  <summary className="cursor-pointer select-none text-xs text-blue-600 hover:underline">
                    Edit shot text
                  </summary>
                  <div className="mt-2">
                    <label htmlFor={`shot-text-${segment.id}`} className="block text-xs font-medium text-gray-600">Shot text (JSON)</label>
                    <textarea
                      id={`shot-text-${segment.id}`}
                      value={segment.promptText ?? ''}
                      onChange={e => {
                        const updated = { ...segment, promptText: e.target.value }
                        setSegments(prev => prev.map(s => s.id === segment.id ? updated : s))
                      }}
                      className="h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Edit the raw prompt text for this shot"
                    />
                  </div>
                </details>
                {job && (
                  <p className="text-xs text-gray-500">
                    Status: {job.status}
                    {job.jobId ? ` | Job ID: ${job.jobId}` : ''}
                    {job.error ? ` | ${job.error}` : ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>
      {/* 预览模态框 */}
      {imagePreview && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/70" role="dialog" aria-modal="true" onClick={() => setImagePreview(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw] p-2" onClick={e => e.stopPropagation()}>
            <img src={imagePreview.url} alt={imagePreview.alt} className="max-h-[88vh] max-w-[88vw] rounded-md object-contain shadow-xl" />
            <button type="button" className="absolute right-3 top-3 rounded bg-black/70 px-2 py-1 text-xs text-white shadow hover:bg-black/80" onClick={() => setImagePreview(null)} aria-label="关闭预览">关闭</button>
          </div>
        </div>
      )}
    </div>
  )
}

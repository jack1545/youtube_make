'use client'

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateBatchImages } from '@/lib/doubao'
import { createVeo3Job } from '@/lib/veo3'
import { addReferenceImage, getReferenceImages, removeReferenceImage, createProject, createScript, createGeneratedImage, createGeneratedVideo, updateGeneratedVideoStatus, getProjects, getScripts, getGeneratedImages, getGeneratedVideos, updateProjectName, deleteProject, updateReferenceImageLabel, addReferenceImageLabel, removeReferenceImageLabel, updateScript, updateGeneratedImage, addReferenceVideo, getReferenceVideos, removeReferenceVideo, updateReferenceVideoLabel, addReferenceFolder, getReferenceFolders, getReferenceImagesByLabel, deleteReferenceFolder, renameReferenceFolder, deleteScript } from '@/lib/db'
import type { ReferenceImage, ScriptSegment as DbScriptSegment, Project, Script, GeneratedImage, GeneratedVideo, ReferenceVideo, ReferenceFolder } from '@/lib/types'
import { supabase, isDemoMode } from '@/lib/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

// 提取 YouTube 视频ID（支持 watch?v=、youtu.be、embed、shorts 等常见格式）
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const pathParts = u.pathname.split('/').filter(Boolean)

    // youtube.com（含子域，如 www/m）
    if (host.endsWith('youtube.com')) {
      // 1) 标准 watch?v=
      const v = u.searchParams.get('v')
      if (v) return v

      // 2) shorts/<id>
      const shortsIdx = pathParts.indexOf('shorts')
      if (shortsIdx >= 0 && pathParts[shortsIdx + 1]) return pathParts[shortsIdx + 1]

      // 3) embed/<id>
      const embedIdx = pathParts.indexOf('embed')
      if (embedIdx >= 0 && pathParts[embedIdx + 1]) return pathParts[embedIdx + 1]
    }

    // youtu.be/<id>
    if (host.endsWith('youtu.be')) {
      const id = pathParts[0]
      return id || null
    }

    return null
  } catch {
    return null
  }
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
    'cast',
    // Chinese synonyms
    '角色',
    '人物',
    '人物角色',
    '出场角色',
    '角色出现',
    '角色名'
  ])

  const expression = pickFirstString(sources, [
    'expression',
    'facial_expression',
    'mood',
    'emotion',
    // Chinese synonyms
    '表情',
    '神情',
    '情绪',
    '心情'
  ])

  const action = pickFirstString(sources, [
    'action',
    'pose',
    'movement',
    // Chinese synonyms
    '动作',
    '行为',
    '姿势',
    '举止',
    '动作描述'
  ])

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
    source['subject'] ??
      source['Subject'] ??
      source['subject_detail'] ??
      source['subjectDetail'] ??
      // Chinese synonyms
      source['主体'] ??
      source['人物'] ??
      source['角色'] ??
      source['主角'] ??
      source['对象'] ??
      source['被摄体'] ??
      source['被摄主体'],
    source
  )

  const prompt: StoryboardPrompt = {}
  if (subject) {
    prompt.subject = subject
  }

  const environment = pickFirstString([source], [
    'environment',
    'Environment',
    'setting',
    'location',
    // Chinese synonyms
    '环境',
    '场景',
    '背景',
    '地点',
    '位置'
  ])
  if (environment) {
    prompt.environment = environment
  }

  const timeOfDay = pickFirstString([source], [
    'time_of_day',
    'timeOfDay',
    'time',
    'day_part',
    'dayTime',
    // Chinese synonyms
    '时间',
    '时段',
    '一天中的时间'
  ])
  if (timeOfDay) {
    prompt.time_of_day = timeOfDay
  }

  const weather = pickFirstString([source], [
    'weather',
    'Weather',
    'conditions',
    'climate',
    // Chinese synonyms
    '天气',
    '气候'
  ])
  if (weather) {
    prompt.weather = weather
  }

  const cameraAngle = pickFirstString([source], [
    'camera_angle',
    'cameraAngle',
    'angle',
    'shot_angle',
    // Chinese synonyms
    '机位',
    '镜头角度',
    '拍摄角度',
    '视角'
  ])
  if (cameraAngle) {
    prompt.camera_angle = cameraAngle
  }

  const shotSize = pickFirstString([source], [
    'shot_size',
    'shotSize',
    'framing',
    'frame',
    // Chinese synonyms
    '景别',
    '镜头远近',
    '画面大小'
  ])
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

// 新增：将结构化提示词格式化为中文分段文本，便于在 Preview shots 展示
function formatPromptChinese(prompt?: StoryboardPrompt): string {
  if (!prompt) {
    return '[主体]\n角色：无\n表情：无\n动作：无\n[环境]\n无\n[时间]\n无\n[天气]\n无\n[视角]\n无\n[景别]\n无'
  }
  const subject = prompt.subject || {}
  const characters = (subject.characters_present || '').trim() || '无'
  const expression = (subject.expression || '').trim() || '无'
  const action = (subject.action || '').trim() || '无'
  const environment = (prompt.environment || '').trim() || '无'
  const time = (prompt.time_of_day || '').trim() || '无'
  const weather = (prompt.weather || '').trim() || '无'
  const angle = (prompt.camera_angle || '').trim() || '无'
  const size = (prompt.shot_size || '').trim() || '无'
  return `[主体]\n角色：${characters}\n表情：${expression}\n动作：${action}\n[环境]\n${environment}\n[时间]\n${time}\n[天气]\n${weather}\n[视角]\n${angle}\n[景别]\n${size}`
}

function resolvePromptText(
  prompt: StoryboardPrompt | undefined,
  rawPrompt: unknown,
  shotNumber?: number
): string {
  // 优先使用原始字符串
  if (typeof rawPrompt === 'string') {
    const trimmed = rawPrompt.trim()
    if (trimmed) {
      return trimmed
    }
  }

  // 如果有结构化 prompt，则格式化为中文分段文本
  if (prompt) {
    return formatPromptChinese(prompt)
  }

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

// 兼容性解析辅助：去掉 Markdown 代码块包裹
function stripMarkdownCodeFences(text?: string | null): string {
  if (!text || typeof text !== 'string') return ''
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    t = t.replace(/\s*```$/, '')
  }
  return t
}

// 兼容性解析辅助：将“类 JSON”文本修正为严格 JSON
function normalizeJsonLike(text: string): string {
  let t = text
  // 移除 BOM
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  // 替换中文全角括号/标点/引号为半角或标准
  t = t
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[「」『』《》]/g, '"')
  // 去除注释
  t = t.replace(/\/\/.*$/gm, '').replace(/\/*[\s\S]*?\*\//g, '')
  // 替换智能引号为标准引号
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  // 将单引号字符串转为双引号字符串
  t = t.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
  // 为未加引号的键名补充双引号（更宽松，支持中文/连字符等）
  t = t.replace(/([,{]\s*)([^\s"'{}\[\],:]+)(\s*):/g, '$1"$2"$3:')
  // 移除结尾多余逗号
  t = t.replace(/,\s*([}\]])/g, '$1')
  return t.trim()
}

// 将任意解析结果尽量规范为分镜数组
function coerceToSegments(val: any): StoryboardRawSegment[] | null {
  if (Array.isArray(val)) return val as StoryboardRawSegment[]
  if (val && typeof val === 'object') {
    // 常见容器字段
    if (Array.isArray((val as any).segments)) return (val as any).segments
    if (Array.isArray((val as any).shots)) return (val as any).shots
    // 对象字典形式
    const values = Object.values(val as Record<string, unknown>)
    if (values.length > 0 && values.every(v => v && typeof v === 'object')) {
      return values as StoryboardRawSegment[]
    }
    // 单个分镜对象
    if ('prompt' in (val as any) || 'shot_number' in (val as any)) {
      return [val as StoryboardRawSegment]
    }
  }
  return null
}

// 更宽容的分镜解析：依次尝试 JSON、规范化 JSON、JSON5、逗号修复、YAML
async function parseStoryboardFlexible(input: string): Promise<StoryboardRawSegment[] | null> {
  const stripped = stripMarkdownCodeFences(input)

  // 1) 直接 JSON
  const j1 = safeParseJSON<unknown>(stripped)
  let arr = coerceToSegments(j1)
  if (arr) return arr

  // 2) 规范化后 JSON
  const normalized = normalizeJsonLike(stripped)
  const j2 = safeParseJSON<unknown>(normalized)
  arr = coerceToSegments(j2)
  if (arr) return arr

  // 3) JSON5（若可用）
  try {
    const mod: any = await import('json5')
    const JSON5 = (mod && (mod.default ?? mod)) as { parse: (s: string) => unknown }
    const j5a = JSON5.parse(stripped)
    arr = coerceToSegments(j5a)
    if (arr) return arr
    const j5b = JSON5.parse(normalized)
    arr = coerceToSegments(j5b)
    if (arr) return arr
  } catch {
    // ignore if json5 not available
  }

  // 4) 逗号修复：将多对象换行相邻的情况包裹为数组并补逗号
  const joined = `[${stripped.replace(/}\s*[\r\n]+\s*{/g, '},\n{')}]`
  const j3 = safeParseJSON<unknown>(joined)
  arr = coerceToSegments(j3)
  if (arr) return arr
  const joinedNorm = `[${normalized.replace(/}\s*[\r\n]+\s*{/g, '},\n{')}]`
  const j4 = safeParseJSON<unknown>(joinedNorm)
  arr = coerceToSegments(j4)
  if (arr) return arr

  // 5) YAML（若可用）
  try {
    const mod: any = await import('js-yaml')
    const yaml = (mod && (mod.default ?? mod)) as { load: (s: string) => unknown }
    const y1 = yaml.load(stripped)
    arr = coerceToSegments(y1)
    if (arr) return arr
  } catch {
    // ignore if js-yaml not available
  }

  return null
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

// 清洗分镜文本前缀序号：移除类似“1. ”、“2、”、“3:” 的编号
function stripLeadingOrder(text: string): string {
  return String(text || '').replace(/^\s*\d+[\.、:：]\s*/, '').trim()
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
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<string>('')
  const [analysisId, setAnalysisId] = useState<string>('')
  const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  // Gemini 新功能（分镜提示词CSV & 世界观改写）
  const [isPrompting, setIsPrompting] = useState(false)
const [promptCsv, setPromptCsv] = useState('')
const [customPromptLine, setCustomPromptLine] = useState('')
const [customPromptBulk, setCustomPromptBulk] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const [isRewriting, setIsRewriting] = useState(false)
  const [worldview, setWorldview] = useState('赛博朋克')
  const [worldviewResult, setWorldviewResult] = useState('')
  const [worldviewError, setWorldviewError] = useState<string | null>(null)
  // 世界观结构化字段：核心设定 / 关键元素 / 参考案例
  const [worldviewCore, setWorldviewCore] = useState('')
  const [worldviewElements, setWorldviewElements] = useState('')
  const [worldviewReferences, setWorldviewReferences] = useState('')
  const [isSavingWorldview, setIsSavingWorldview] = useState(false)
  const [worldviewSavedInfo, setWorldviewSavedInfo] = useState('')
  const [isSavingChild, setIsSavingChild] = useState(false)
  // 自定义子脚本（CSV）输入
  const [customChildName, setCustomChildName] = useState('')
  const [customChildCsv, setCustomChildCsv] = useState('')
  const [isSavingCustomChild, setIsSavingCustomChild] = useState(false)
  const [customChildError, setCustomChildError] = useState<string | null>(null)
  // 世界观预设管理
  const DEFAULT_WORLDVIEWS = ['赛博朋克', '克苏鲁', '蒸汽朋克', '生物朋克']
  const [worldviews, setWorldviews] = useState<string[]>(DEFAULT_WORLDVIEWS)
  // 避免 SSR 与客户端初始渲染不一致：
  // 将 localStorage 读取放到挂载后执行，确保首屏标记与内容一致，再进行客户端更新。
  useEffect(() => {
    try {
      const saved = localStorage.getItem('storyboard_worldviews')
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr) && arr.every(x => typeof x === 'string')) {
          setWorldviews(arr as string[])
        }
      }
    } catch { /* ignore */ }
  }, [])
  const [newWorldview, setNewWorldview] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  useEffect(() => {
    try {
      localStorage.setItem('storyboard_worldviews', JSON.stringify(worldviews))
    } catch { /* ignore */ }
  }, [worldviews])

  const [selectedForImages, setSelectedForImages] = useState<string[]>([])
  const [selectedForVideo, setSelectedForVideo] = useState<string[]>([])
  const [imageResults, setImageResults] = useState<Record<string, ImageResult>>({})
  const [videoPromptOverrides, setVideoPromptOverrides] = useState<Record<string, string>>({})
  const [videoBulkFind, setVideoBulkFind] = useState('')
  const [videoBulkReplace, setVideoBulkReplace] = useState('')
  const [isGeneratingImages, setIsGeneratingImages] = useState(false)
  const [imageProgress, setImageProgress] = useState(0)
  const [generatingShotIds, setGeneratingShotIds] = useState<Record<string, boolean>>({})
  // 右侧参考图悬浮面板折叠状态
  const [isRefPanelOpen, setIsRefPanelOpen] = useState(true)
  // 右侧“批量替换预览文本”悬浮面板折叠状态（默认折叠）
  const [isBulkPanelOpen, setIsBulkPanelOpen] = useState(false)
  // 子脚本相关辅助定义移动到 existingScripts 初始化之后

const [doubaoSizeMode, setDoubaoSizeMode] = useState<DoubaoSizeMode>('preset')
  const [doubaoResolution, setDoubaoResolution] = useState<DoubaoResolution>('4K')
  const [doubaoAspect, setDoubaoAspect] = useState<AspectOption>('9:16')
  const [customWidth, setCustomWidth] = useState('2048')
  const [customHeight, setCustomHeight] = useState('2048')
  const [hasEditedCustomSize, setHasEditedCustomSize] = useState(false)

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([])
  // 新增：解析后的参考图 URL 映射（data: → blob:）
  const [resolvedRefUrlMap, setResolvedRefUrlMap] = useState<Record<string, string>>({})
  const [newReferenceUrl, setNewReferenceUrl] = useState('')
  const [newReferenceLabel, setNewReferenceLabel] = useState('')
  const [isAddingReference, setIsAddingReference] = useState(false)
  const [isStep2Stuck, setIsStep2Stuck] = useState(false)
  const step2SentinelRef = useRef<HTMLDivElement | null>(null)
  const step2SectionRef = useRef<HTMLElement | null>(null)

  // 参考图分页状态
  const [refCursor, setRefCursor] = useState<string | null>(null)
  const [refHasMore, setRefHasMore] = useState<boolean>(true)
  const [isLoadingRefs, setIsLoadingRefs] = useState<boolean>(false)
  const [isLoadingMoreRefs, setIsLoadingMoreRefs] = useState<boolean>(false)

  // 参考图目录分页状态
  const [folders, setFolders] = useState<ReferenceFolder[]>([])
  const [folderCursor, setFolderCursor] = useState<string | null>(null)
  const [folderHasMore, setFolderHasMore] = useState<boolean>(true)
  const [isLoadingFolders, setIsLoadingFolders] = useState<boolean>(false)
  const [isLoadingMoreFolders, setIsLoadingMoreFolders] = useState<boolean>(false)
  const [newFolderName, setNewFolderName] = useState('')
  // 目录重命名编辑状态
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState<string>('')
  // 当前选中的目录（null 表示未归类）
  const [selectedFolderLabel, setSelectedFolderLabel] = useState<string | null>(null)

  const handleAddFolder = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name) return
    try {
      const folder = await addReferenceFolder(name)
      setFolders(prev => {
        // 去重：按 name
        if (prev.some(f => f.name === folder.name)) return prev
        return [folder, ...prev]
      })
      setNewFolderName('')
      setStatus({ type: 'success', text: '目录已创建。' })
    } catch (err: any) {
      console.error('创建目录失败', err)
      setStatus({ type: 'error', text: err?.message || '创建目录失败' })
    }
  }, [newFolderName])

  // 当 referenceImages 变化时，将其中的 data:URL 转换为 blob: URL，以稳定渲染
  useEffect(() => {
    let isCancelled = false
    const revokeList: string[] = []

    async function resolveAll() {
      const entries = await Promise.all(
        referenceImages.map(async (img) => {
          const url = img.url || ''
          try {
            if (typeof url === 'string' && url.startsWith('data:')) {
              const resp = await fetch(url)
              const blob = await resp.blob()
              const objectUrl = URL.createObjectURL(blob)
              revokeList.push(objectUrl)
              return [img.id, objectUrl] as const
            }
            return [img.id, url] as const
          } catch {
            return [img.id, url] as const
          }
        })
      )
      if (!isCancelled) {
        const nextMap: Record<string, string> = {}
        for (const [id, u] of entries) nextMap[id] = u
        setResolvedRefUrlMap(nextMap)
      }
    }

    resolveAll()
    return () => {
      isCancelled = true
      revokeList.forEach(u => URL.revokeObjectURL(u))
    }
  }, [referenceImages])

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
    { id: 'rule_default_1', find: '角色A', replace: '图1' },
    { id: 'rule_default_2', find: '角色B', replace: '图2' },
    { id: 'rule_default_3', find: '角色C', replace: '图3' }
  ])
  const [videoJobs, setVideoJobs] = useState<Record<string, VideoJobState>>({})
  const [veoModel, setVeoModel] = useState('veo3-fast-frames')
  const [veoAspectRatio, setVeoAspectRatio] = useState<'16:9' | '9:16'>('9:16')
  const [veoEnhancePrompt, setVeoEnhancePrompt] = useState(true)
  const [veoUpsample, setVeoUpsample] = useState(false)
  const [useImageAsKeyframe, setUseImageAsKeyframe] = useState(true)
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false)
  const [isDownloadingImages, setIsDownloadingImages] = useState(false)
  // 新增：Step 4 折叠隐藏开关
  const [isStep4Collapsed, setIsStep4Collapsed] = useState(true)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [scriptId, setScriptId] = useState<string | null>(null)
  // 历史项目/脚本选择相关状态
  const [existingProjects, setExistingProjects] = useState<Project[]>([])
  const [existingScripts, setExistingScripts] = useState<Script[]>([])
  const [selectedExistingProjectId, setSelectedExistingProjectId] = useState<string>('')
  const [selectedExistingScriptId, setSelectedExistingScriptId] = useState<string>('')
  const [isLoadingExisting, setIsLoadingExisting] = useState<boolean>(false)
const [isRenamingProject, setIsRenamingProject] = useState<boolean>(false)
const [isDeletingProject, setIsDeletingProject] = useState<boolean>(false)

  // 子脚本（世界观）辅助：从 raw_text 提取世界观名，并过滤子脚本列表
  const extractWorldviewName = useCallback((raw?: string): string => {
    const firstLine = ((raw || '').split(/\r?\n/)[0] || '').trim()
    const m = firstLine.match(/^(世界观|Worldview)[：:]\s*(.+)$/)
    return m ? m[2] : ''
  }, [])
  const childScripts = useMemo(() => {
    return existingScripts.filter(s => {
      const name = extractWorldviewName(s.raw_text)
      return !!name
    })
  }, [existingScripts, extractWorldviewName])

  // 子脚本编辑状态：用于重命名与快捷保存
  const [editingChildId, setEditingChildId] = useState<string | null>(null)
  const [editingChildName, setEditingChildName] = useState<string>('')

  // 从 textarea 原始脚本中解析分镜编号用于高亮预览
  const shotNumberPreview = useMemo(() => {
    const lines = String(rawJson || '').replace(/\r\n/g, '\n').split('\n')
    const items: Array<{ num: string; text: string }> = []
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)[\.、:：]\s*(.*)$/)
      if (m) {
        items.push({ num: m[1], text: m[2] })
      }
    }
    return items
  }, [rawJson])

  const loadScriptIntoStoryboard = useCallback(async (script: Script) => {
    const mapped: StoryboardSegment[] = (script.content || []).map((seg, idx) => {
      const pd = (seg as DbScriptSegment).prompt_detail
      const promptObj = pd
        ? {
            subject: pd.subject
              ? {
                  characters_present: pd.subject.characters_present,
                  expression: pd.subject.expression,
                  action: pd.subject.action
                }
              : undefined,
            environment: pd.environment,
            time_of_day: pd.time_of_day,
            weather: pd.weather,
            camera_angle: pd.camera_angle,
            shot_size: pd.shot_size
          }
        : undefined
      const promptText = (seg as DbScriptSegment).prompt?.trim().length ? (seg as DbScriptSegment).prompt : formatPromptChinese(promptObj)
      return {
        id: (seg as DbScriptSegment).id || `shot-${idx + 1}`,
        shotNumber: idx + 1,
        prompt: promptObj,
        promptText: promptText || `Shot ${idx + 1}`
      }
    })

    const wvName = extractWorldviewName(script.raw_text)
    setSegments(mapped)
    setSelectedForImages(mapped.map(s => s.id))
    setSelectedForVideo([])
    setImageResults({})
    setVideoJobs({})
    setVideoPromptOverrides({})
    setParseError(null)
    setProjectId(script.project_id)
    setScriptId(script.id)
    setRawJson(script.raw_text || '')

    try {
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
      const params = new URLSearchParams({ script_id: script.id, latest: '1' })
      const res = await fetch(`${baseOrigin}/api/script-analyses?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        const item = data.item
        if (item) {
          setAnalysis(item.analysis || '')
          setAnalysisId(item.id || '')
        } else {
          setAnalysis('')
          setAnalysisId('')
        }
      } else {
        setAnalysis('')
        setAnalysisId('')
      }
    } catch {
      setAnalysis('')
      setAnalysisId('')
    }

    if (wvName) setWorldview(wvName)
    setStatus({ type: 'success', text: wvName ? `已加载子脚本：${wvName}` : '已加载脚本。' })
  }, [extractWorldviewName])

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

  // 历史记录模块：当回填未完全成功时显示所有图片与视频，并支持复制提示词
const [historyImages, setHistoryImages] = useState<GeneratedImage[]>([])
const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([])
const [editingHistoryShot, setEditingHistoryShot] = useState<Record<string, string>>({})
const [updatingHistoryShot, setUpdatingHistoryShot] = useState<Record<string, boolean>>({})

const toggleHistorySelection = useCallback((id: string) => {
  setSelectedHistoryIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [id, ...prev]))
}, [])

const handleUpdateHistoryShot = useCallback(async (img: GeneratedImage) => {
  try {
    const val = (editingHistoryShot[img.id] ?? (typeof img.shot_number === 'number' ? String(img.shot_number) : '')).trim()
    if (!val) {
      setStatus({ type: 'error', text: '请输入镜头号。' })
      return
    }
    const shotNumber = Number(val)
    if (!Number.isFinite(shotNumber) || shotNumber <= 0) {
      setStatus({ type: 'error', text: '镜头号需为正整数。' })
      return
    }
    setUpdatingHistoryShot(prev => ({ ...prev, [img.id]: true }))
    const updated = await updateGeneratedImage(img.id, { shotNumber })
    setHistoryImages(prev => prev.map(it => (it.id === img.id ? { ...it, shot_number: updated.shot_number } : it)))
    setStatus({ type: 'success', text: '镜头号已更新。' })
  } catch (error) {
    console.error('Failed to update shot number for history image', error)
    setStatus({ type: 'error', text: '更新镜头号失败。' })
  } finally {
    setUpdatingHistoryShot(prev => ({ ...prev, [img.id]: false }))
  }
}, [editingHistoryShot])
  const [historyVideos, setHistoryVideos] = useState<GeneratedVideo[]>([])
  const [showHistoryModule, setShowHistoryModule] = useState<boolean>(false)
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState<boolean>(true)
  const [historyAspect, setHistoryAspect] = useState<'9:16' | '16:9'>('9:16')
  // 参考图点击放大遮罩
  const [refZoomUrl, setRefZoomUrl] = useState<string | null>(null)

  // 参考视频（YouTube）模块状态
  const [newYoutubeUrl, setNewYoutubeUrl] = useState('')
  const [newYoutubeLabel, setNewYoutubeLabel] = useState('')
  const [isAddingYoutube, setIsAddingYoutube] = useState(false)
  const [referenceVideos, setReferenceVideos] = useState<ReferenceVideo[]>([])
  const [isLoadingRefVideos, setIsLoadingRefVideos] = useState(false)
  // 历史图片：支持上传与粘贴补充
  const [newHistoryUrl, setNewHistoryUrl] = useState('')
  const [newHistoryPrompt, setNewHistoryPrompt] = useState('')
  const [newHistoryShotNumber, setNewHistoryShotNumber] = useState<string>('')
  const [newHistoryFile, setNewHistoryFile] = useState<File | null>(null)
  const [isAddingHistory, setIsAddingHistory] = useState(false)
  const [isUploadingHistory, setIsUploadingHistory] = useState(false)

  // 初始化：从 URL 查询参数恢复当前项目，避免刷新后丢失 projectId
  useEffect(() => {
    const restoreByQuery = async () => {
      try {
        const pid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('project') : null
        if (!pid) return
        setProjectId(pid)
        setSelectedExistingProjectId(pid)
        const projects = await getProjects()
        setExistingProjects(projects)
        const match = projects.find(p => p.id === pid)
        if (match) {
          setProjectName(match.name || 'Storyboard Project')
        }
      } catch (err) {
        console.warn('Restore project by query failed', err)
      }
    }
    restoreByQuery()
  }, [])

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ type: 'success', text: '已复制提示词到剪贴板。' })
    } catch (err) {
      setStatus({ type: 'error', text: '复制失败，请手动复制。' })
    }
  }, [])

  const selectedReferenceImages = useMemo(
    () =>
      selectedReferenceIds
        .map(id => referenceImages.find(img => img.id === id))
        .filter(Boolean) as ReferenceImage[],
    [referenceImages, selectedReferenceIds]
  )

  const projectSlug = useMemo(() => slugify(projectName || 'storyboard'), [projectName])

  // 任务队列（MVP：前端本地持久化）
  type TaskStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled'
  interface TaskItem {
    id: string
    type: 'image' | 'video'
    projectId?: string | null
    scriptId?: string | null
    scriptName?: string
    shotCount: number
    status: TaskStatus
    progress: number // 0..1
    createdAt: number
    updatedAt: number
    params?: Record<string, any>
    outputs?: Record<string, any>
    error?: string
  }

  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('storyboard_tasks') : null
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        // 仅保留最近 50 条
        const trimmed = tasks.slice(0, 50)
        localStorage.setItem('storyboard_tasks', JSON.stringify(trimmed))
      }
    } catch {}
  }, [tasks])
  const enqueueTask = useCallback((payload: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'progress'> & { status?: TaskStatus }) => {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    const item: TaskItem = {
      id,
      type: payload.type,
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      scriptName: payload.scriptName,
      shotCount: payload.shotCount,
      status: payload.status ?? 'running',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      params: payload.params,
      outputs: payload.outputs
    }
    setTasks(prev => [item, ...prev])
    return id
  }, [])
  const updateTask = useCallback((id: string, patch: Partial<TaskItem>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t))
  }, [])
  const completeTask = useCallback((id: string, outputs?: Record<string, any>) => {
    updateTask(id, { status: 'success', progress: 1, outputs })
  }, [updateTask])
  const failTask = useCallback((id: string, error?: string) => {
    updateTask(id, { status: 'error', error })
  }, [updateTask])
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false)
  const activeTaskCount = useMemo(() => tasks.filter(t => t.status === 'running' || t.status === 'pending').length, [tasks])
  const currentScriptName = useMemo(() => {
    try {
      // existingScripts 可能在上文定义并维护；Script 不含 name 字段，使用 id 或时间作为展示
      const s = (existingScripts || []).find((x: any) => x.id === scriptId)
      if (!s) return undefined
      // 优先显示短 id，避免过长
      const shortId = typeof s.id === 'string' ? s.id.slice(0, 8) : String(s.id)
      return `Script ${shortId}`
    } catch {
      return undefined
    }
  }, [scriptId, existingScripts])

  // 加载更多参考图（基于 created_at 游标）
  const loadMoreReferences = useCallback(async () => {
    if (isLoadingMoreRefs || !refHasMore) return
    setIsLoadingMoreRefs(true)
    try {
      const items = await getReferenceImagesByLabel(selectedFolderLabel ?? '__none__', 10, refCursor ?? undefined)
      const dedup = items.filter(item => !referenceImages.some(exist => exist.id === item.id))
      const next = [...referenceImages, ...dedup]
      setReferenceImages(next)
      setSelectedReferenceIds(prev => prev.filter(id => next.some(item => item.id === id)))
      const lastCreatedAt = items.length > 0 ? items[items.length - 1].created_at : refCursor
      setRefCursor(lastCreatedAt ?? null)
      if (items.length < 10) {
        setRefHasMore(false)
      }
    } catch (error) {
      console.error('Failed to load more reference images', error)
      setStatus({ type: 'error', text: '加载更多参考图失败。' })
    } finally {
      setIsLoadingMoreRefs(false)
    }
  }, [isLoadingMoreRefs, refHasMore, refCursor, referenceImages, selectedFolderLabel])

  // 刷新目录列表（用于拖拽归类或删除目录后更新视图）
  const reloadFolders = useCallback(async () => {
    try {
      setIsLoadingFolders(true)
      const items = await getReferenceFolders(10)
      setFolders(items)
      const last = items.length ? items[items.length - 1] : null
      setFolderCursor(last?.created_at ?? null)
      setFolderHasMore(items.length >= 10)
    } catch (error) {
      console.error('Failed to reload folders', error)
      setStatus({ type: 'error', text: '刷新目录失败。' })
    } finally {
      setIsLoadingFolders(false)
    }
  }, [])

  // 全部参考图（用于“参考图模块”拖拽归类）
  const [allRefImages, setAllRefImages] = useState<ReferenceImage[]>([])
  const [allRefCursor, setAllRefCursor] = useState<string | null>(null)
  const [allRefHasMore, setAllRefHasMore] = useState<boolean>(true)
  const [isLoadingMoreAllRefs, setIsLoadingMoreAllRefs] = useState<boolean>(false)

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const items = await getReferenceImages(10)
        setAllRefImages(items)
        const lastCreatedAt = items.length ? items[items.length - 1].created_at : null
        setAllRefCursor(lastCreatedAt)
        setAllRefHasMore(items.length >= 10)
      } catch (error) {
        console.error('加载参考图模块失败', error)
        setStatus({ type: 'error', text: '加载参考图模块失败。' })
      }
    }
    loadInitial()
  }, [])

  const loadMoreAllReferences = useCallback(async () => {
    if (isLoadingMoreAllRefs || !allRefHasMore) return
    setIsLoadingMoreAllRefs(true)
    try {
      const items = await getReferenceImages(10, allRefCursor ?? undefined)
      const dedup = items.filter(item => !allRefImages.some(exist => exist.id === item.id))
      const next = [...allRefImages, ...dedup]
      setAllRefImages(next)
      const lastCreatedAt = items.length ? items[items.length - 1].created_at : allRefCursor
      setAllRefCursor(lastCreatedAt ?? null)
      setAllRefHasMore(items.length >= 10)
    } catch (error) {
      console.error('加载更多参考图模块失败', error)
      setStatus({ type: 'error', text: '加载更多参考图失败。' })
    } finally {
      setIsLoadingMoreAllRefs(false)
    }
  }, [isLoadingMoreAllRefs, allRefHasMore, allRefCursor, allRefImages])

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

  // 首次加载目录列表，并默认选中第一个显式目录（不再显示未归类）
  useEffect(() => {
    const loadFoldersOnce = async () => {
      setIsLoadingFolders(true)
      try {
        const first = await getReferenceFolders(10)
        setFolders(first)
        const before = first.length ? first[first.length - 1].created_at : null
        setFolderCursor(before)
        setFolderHasMore(first.length >= 10)
        // 默认选中第一个有标签的目录
        const initialLabel = first.find(f => f.label != null)?.label ?? null
        setSelectedFolderLabel(initialLabel)
      } catch (error) {
        console.error('Failed to load reference folders', error)
        setStatus({ type: 'error', text: '加载参考图目录失败。' })
      } finally {
        setIsLoadingFolders(false)
      }
    }
    loadFoldersOnce()
  }, [])

  // 当选择目录变化时，加载该目录下参考图（不再支持未归类）
  useEffect(() => {
    const loadReferencesByFolder = async () => {
      setIsLoadingRefs(true)
      try {
        const limit = 10
        if (!selectedFolderLabel) {
          setReferenceImages([])
          setSelectedReferenceIds(prev => [])
          setRefCursor(null)
          setRefHasMore(false)
          return
        }
        const first = await getReferenceImagesByLabel(selectedFolderLabel, limit)
        setReferenceImages(first)
        setSelectedReferenceIds(prev => prev.filter(id => first.some(item => item.id === id)))
        const before = first.length ? first[first.length - 1].created_at : null
        setRefCursor(before)
        setRefHasMore(first.length >= limit)
      } catch (error) {
        console.error('Failed to load reference images by folder', error)
        setStatus({ type: 'error', text: '加载目录下参考图失败。' })
      } finally {
        setIsLoadingRefs(false)
      }
    }
    loadReferencesByFolder()
  }, [selectedFolderLabel])

  const loadMoreFolders = useCallback(async () => {
    if (isLoadingMoreFolders || !folderHasMore) return
    setIsLoadingMoreFolders(true)
    try {
      const items = await getReferenceFolders(10, folderCursor ?? undefined)
      const dedup = items.filter(item => !folders.some(exist => exist.name === item.name))
      const next = [...folders, ...dedup]
      setFolders(next)
      const lastCreatedAt = items.length > 0 ? items[items.length - 1].created_at : folderCursor
      setFolderCursor(lastCreatedAt ?? null)
      if (items.length < 10) setFolderHasMore(false)
    } catch (error) {
      console.error('Failed to load more folders', error)
      setStatus({ type: 'error', text: '加载更多目录失败。' })
    } finally {
      setIsLoadingMoreFolders(false)
    }
  }, [isLoadingMoreFolders, folderHasMore, folderCursor, folders])

  // 加载历史项目列表
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const projects = await getProjects()
        setExistingProjects(projects)
        // 若尚未选择项目且存在项目，默认选择第一个项目，后续将自动加载脚本与历史记录
        // 默认不自动选择项目，保持空选择，符合“首次进入不选中项目”的需求
      } catch (error) {
        console.error('Failed to load projects', error)
        setStatus({ type: 'error', text: '加载项目列表失败。' })
      }
    }
    loadProjects()
  }, [])

  // 当选择了项目后，加载对应脚本列表
  useEffect(() => {
    const loadScripts = async () => {
      if (!selectedExistingProjectId) {
        setExistingScripts([])
        return
      }
      setIsLoadingExisting(true)
      try {
        const scripts = await getScripts(selectedExistingProjectId)
        setExistingScripts(scripts)
        setSelectedExistingScriptId(scripts.length > 0 ? scripts[0].id : '')
      } catch (error) {
        console.error('Failed to load scripts', error)
        setStatus({ type: 'error', text: '加载脚本列表失败。' })
      } finally {
        setIsLoadingExisting(false)
      }
    }
    loadScripts()
  }, [selectedExistingProjectId])

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
      const parsed = await parseStoryboardFlexible(rawJson)
      if (!parsed) {
        throw new Error('Invalid JSON: 请检查是否存在未加引号的键名、单引号、中文标点或注释。')
      }
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

      // 在 Step 1 中不再自动创建项目和脚本，改为点击“新建项目”按钮后再保存脚本。
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

      // 在 Step 1 中不再自动创建项目和脚本，改为点击“新建项目”按钮后再保存脚本。
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

  const handleAnalyzeScript = useCallback(async () => {
    setAnalyzeError(null)
    const input = rawJson.trim()
    if (!input) {
      setStatus({ type: 'error', text: '请先在文本框粘贴脚本或JSON/CSV内容后再点击分析。' })
      return
    }
    setIsAnalyzing(true)
    try {
      const res = await fetch('/api/analyze-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptText: input, scriptId })
      })
      const data = await res.json()
      if (data?.analysis) {
        setAnalysis(data.analysis as string)
        setAnalysisId((data.id as string) || '')
        if (data?.demo) {
          setStatus({ type: 'info', text: '已使用离线示例分析（未配置 Gemini API Key）。' })
        } else {
          setStatus({ type: 'success', text: '分析完成。' })
        }
      } else {
        setAnalyzeError(data?.error || '分析失败，请稍后重试。')
      }
    } catch (e) {
      setAnalyzeError('网络错误，分析失败。')
    } finally {
      setIsAnalyzing(false)
    }
  }, [rawJson, scriptId])

  // 载入选中的历史脚本，将其内容映射为分镜进行继续编辑
  const handleLoadExistingScript = useCallback(async () => {
    try {
      if (!selectedExistingProjectId) {
        setStatus({ type: 'info', text: '请先选择项目。' })
        return
      }
      if (!selectedExistingScriptId) {
        const project = existingProjects.find(p => p.id === selectedExistingProjectId) || null
        if (project) {
          setProjectName(project.name)
        }
        setProjectId(selectedExistingProjectId)
        setScriptId('')
        setSegments([])
        setSelectedForImages([])
        setSelectedForVideo([])
        setImageResults({})
        setVideoJobs({})
        setVideoPromptOverrides({})
        setRawJson('')
        setParseError(null)
        setAnalysis('')
        setAnalysisId('')
        setStatus({ type: 'info', text: '该项目暂无脚本，请粘贴原始脚本并点击“保存原始脚本”创建脚本。' })
        return
      }
      const project = existingProjects.find(p => p.id === selectedExistingProjectId) || null
      const script = existingScripts.find(s => s.id === selectedExistingScriptId) || null
      if (!script) {
        setStatus({ type: 'error', text: '未找到所选脚本。' })
        return
      }

      const mapped: StoryboardSegment[] = (script.content || []).map((seg, idx) => {
        const pd = seg.prompt_detail
        const promptObj = pd
          ? {
              subject: pd.subject
                ? {
                    characters_present: pd.subject.characters_present,
                    expression: pd.subject.expression,
                    action: pd.subject.action
                  }
                : undefined,
              environment: pd.environment,
              time_of_day: pd.time_of_day,
              weather: pd.weather,
              camera_angle: pd.camera_angle,
              shot_size: pd.shot_size
            }
          : undefined
        const promptText = seg.prompt?.trim().length ? seg.prompt : formatPromptChinese(promptObj)
        return {
          id: seg.id || `shot-${idx + 1}`,
          shotNumber: idx + 1,
          prompt: promptObj,
          promptText: promptText || `Shot ${idx + 1}`
        }
      })

      setSegments(mapped)
      setSelectedForImages(mapped.map(s => s.id))
      setSelectedForVideo([])
      setImageResults({})
      setVideoJobs({})
      setVideoPromptOverrides({})
      setParseError(null)
      if (project) {
        setProjectName(project.name)
      }
      setProjectId(selectedExistingProjectId)
      setScriptId(selectedExistingScriptId)
      setRawJson(script.raw_text || '')

      // 加载最新脚本分析（若存在）
      try {
        const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
        const params = new URLSearchParams({ script_id: selectedExistingScriptId, latest: '1' })
        const res = await fetch(`${baseOrigin}/api/script-analyses?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          const item = data.item
          if (item) {
            setAnalysis(item.analysis || '')
            setAnalysisId(item.id || '')
          } else {
            setAnalysis('')
            setAnalysisId('')
          }
        } else {
          setAnalysis('')
          setAnalysisId('')
        }
      } catch {
        setAnalysis('')
        setAnalysisId('')
      }

      // 回填历史生成图片和视频
      try {
        const [images, videos] = await Promise.all([
          getGeneratedImages(selectedExistingScriptId),
          getGeneratedVideos(selectedExistingScriptId)
        ])

        // 建立 shotNumber 到分镜的映射，优先使用数据库中的 shot_number
        const byShot = new Map<number, StoryboardSegment>()
        mapped.forEach(seg => {
          if (typeof seg.shotNumber === 'number') {
            byShot.set(seg.shotNumber, seg)
          }
        })

        // 回填图片
        const nextImageResults: Record<string, ImageResult> = {}
        images.forEach(img => {
          let target: StoryboardSegment | undefined
          if (typeof img.shot_number === 'number') {
            target = byShot.get(img.shot_number)
          }
          if (!target) {
            // 退化为以 promptText 精确匹配
            target = mapped.find(seg => (seg.promptText || '').trim() === (img.prompt || '').trim())
          }
          if (target) {
            nextImageResults[target.id] = {
              url: img.image_url,
              prompt: img.prompt
            }
          }
        })
        setImageResults(nextImageResults)

        // 回填视频
        const nextVideoJobs: Record<string, VideoJobState> = {}
        videos.forEach(v => {
          let target: StoryboardSegment | undefined
          if (typeof v.shot_number === 'number') {
            target = byShot.get(v.shot_number)
          }
          if (!target) {
            target = mapped.find(seg => (seg.promptText || '').trim() === (v.prompt || '').trim())
          }
          if (target) {
            let status: VideoJobState['status'] = 'idle'
            if (v.status === 'completed') status = 'success'
            else if (v.status === 'failed') status = 'error'
            else status = 'pending'

            nextVideoJobs[target.id] = {
              status,
              jobId: undefined,
              error: undefined,
              videoUrl: v.video_url || undefined,
              dbId: v.id
            }
          }
        })
        setVideoJobs(nextVideoJobs)

        // 回填保存的 Video Prompt（MongoDB）用于覆盖 Step 4 文本
        try {
          if (selectedExistingScriptId) {
            const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
            const res = await fetch(`${baseOrigin}/api/video-prompts?script_id=${encodeURIComponent(selectedExistingScriptId)}`)
            if (res.ok) {
              const data = await res.json().catch(() => ({}))
              const items: Array<{ shot_number?: number; text?: string }> = data?.items || []
              const nextOverrides: Record<string, string> = { ...videoPromptOverrides }
              items.forEach(item => {
                if (typeof item.shot_number === 'number' && typeof item.text === 'string') {
                  const seg = byShot.get(item.shot_number)
                  if (seg) nextOverrides[seg.id] = item.text
                }
              })
              setVideoPromptOverrides(nextOverrides)
            }
          }
        } catch (e) {
          console.error('读取保存的 Video Prompt 失败', e)
        }

        // 统计未映射的历史记录数量，并缓存全部历史用于展示
        const unmatchedImages = images.filter(img => {
          let target: StoryboardSegment | undefined
          if (typeof img.shot_number === 'number') target = byShot.get(img.shot_number)
          if (!target) target = mapped.find(seg => (seg.promptText || '').trim() === (img.prompt || '').trim())
          return !target
        })
        const unmatchedVideos = videos.filter(v => {
          let target: StoryboardSegment | undefined
          if (typeof v.shot_number === 'number') target = byShot.get(v.shot_number)
          if (!target) target = mapped.find(seg => (seg.promptText || '').trim() === (v.prompt || '').trim())
          return !target
        })
        setHistoryImages(images)
        setHistoryVideos(videos)
        // 显示历史模块：只要存在历史图片或视频即显示；如果存在未映射项则默认展开，否则默认折叠
        const hasUnmatched = unmatchedImages.length > 0 || unmatchedVideos.length > 0 ||
          (images.length > 0 && Object.keys(nextImageResults).length === 0) ||
          (videos.length > 0 && Object.keys(nextVideoJobs).length === 0)
        const shouldShowHistory = images.length > 0 || videos.length > 0
        setShowHistoryModule(shouldShowHistory)
        setIsHistoryCollapsed(!hasUnmatched)
      } catch (err) {
        console.warn('回填历史生成记录失败', err)
      }

      // 参考视频改为项目级关联，脚本加载时不再按脚本ID拉取
      // 依赖于下方基于 projectId 的 useEffect 统一加载
    } catch (error) {
      console.error('Failed to load existing script', error)
      setStatus({ type: 'error', text: '载入历史脚本失败。' })
    }
  }, [selectedExistingProjectId, selectedExistingScriptId, existingProjects, existingScripts])

  // 当选择了项目与脚本后，自动载入历史脚本与生成记录，避免遗漏点击导致历史模块不显示
  useEffect(() => {
    if (selectedExistingProjectId && selectedExistingScriptId) {
      handleLoadExistingScript()
    }
  }, [selectedExistingProjectId, selectedExistingScriptId, handleLoadExistingScript])

  // 当项目ID变更时，拉取参考视频列表（项目级关联）
  useEffect(() => {
    let cancelled = false
    async function loadRefVideosByProject() {
      if (!projectId) return
      try {
        setIsLoadingRefVideos(true)
        const videos = await getReferenceVideos(50, undefined, undefined, projectId)
        if (!cancelled) setReferenceVideos(videos)
      } catch (e) {
        console.warn('基于项目ID加载参考视频失败', e)
      } finally {
        if (!cancelled) setIsLoadingRefVideos(false)
      }
    }
    loadRefVideosByProject()
    return () => { cancelled = true }
  }, [projectId])

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
    setRawJson(prev => applyRules(prev) ?? prev)
    setStatus({ type: 'success', text: `已对原始脚本文本执行批量替换，共执行 ${rules.length} 条规则。` })
  }, [bulkFind, bulkReplaceValue, bulkRules])

  const handleAddReferenceImage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newReferenceUrl.trim()) {
      return
    }

    setIsAddingReference(true)
    try {
      const effectiveLabel = (selectedFolderLabel && selectedFolderLabel !== '__none__')
        ? selectedFolderLabel
        : (newReferenceLabel.trim() || undefined)
      const image = await addReferenceImage(newReferenceUrl.trim(), effectiveLabel)
      setReferenceImages(prev => [image, ...prev])
      setSelectedReferenceIds(prev => [image.id, ...prev])
      setAllRefImages(prev => [image, ...(prev || [])])
      setNewReferenceUrl('')
      setNewReferenceLabel('')
      await reloadFolders()
      setStatus({ type: 'success', text: 'Reference image added.' })
    } catch (error) {
      console.error('Failed to add reference image', error)
      setStatus({ type: 'error', text: 'Failed to add reference image.' })
    } finally {
      setIsAddingReference(false)
    }
  }, [newReferenceUrl, newReferenceLabel, selectedFolderLabel, reloadFolders])

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
      const effectiveLabel = (selectedFolderLabel && selectedFolderLabel !== '__none__')
        ? selectedFolderLabel
        : (newReferenceLabel.trim() || undefined)
      const image = await addReferenceImage(finalUrl, effectiveLabel)
      setReferenceImages(prev => [image, ...prev])
      setSelectedReferenceIds(prev => [image.id, ...prev])
      setAllRefImages(prev => [image, ...(prev || [])])
      setNewReferenceFile(null)
      setNewReferenceLabel('')
      await reloadFolders()
      setStatus({ type: 'success', text: usedDataUrlFallback ? '参考图已上传（使用本地 Data URL）。' : '参考图已上传。' })
    } catch (error) {
      console.error('Failed to upload reference image', error)
      setStatus({ type: 'error', text: '上传参考图失败。' })
    } finally {
      setIsUploadingReference(false)
    }
  }, [newReferenceFile, newReferenceLabel, selectedFolderLabel, reloadFolders])

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

      // 入列单镜头图片任务
      const singleTaskId = enqueueTask({
        type: 'image',
        projectId,
        scriptId,
        scriptName: currentScriptName,
        shotCount: 1,
        params: { size: doubaoSizeValue, shot: segment.shotNumber }
      })

      setGeneratingShotIds(prev => ({ ...prev, [segment.id]: true }))
      try {
        const referenceUrls = selectedReferenceImages.map(image => image.url)

        const [result] = await generateBatchImages(
          [
            {
              prompt: formatPromptForModel(segment),
              size: doubaoSizeValue,
              referenceImageUrls: referenceUrls.length ? referenceUrls : undefined,
              shot_number: segment.shotNumber
            }
          ],
          { size: doubaoSizeValue, scriptId: scriptId ?? undefined }
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

          // 任务进度与完成
          updateTask(singleTaskId, { progress: 1, status: 'success', outputs: { url: result.url } })

          // 若未提供 scriptId，则前端调用 API 写库；提供了 scriptId 时已由服务端持久化，避免重复写入
          if (!scriptId) {
            try {
              await createGeneratedImage(
                scriptId || '',
                result.prompt ?? formatPromptForModel(segment),
                result.url,
                segment.shotNumber
              )
            } catch (e) {
              console.error('Failed to save generated image via API', e)
            }
          }
        }
      } catch (error) {
        console.error(`Failed to generate image for shot ${segment.id}`, error)
        setStatus({ type: 'error', text: `Failed to generate image for shot ${segment.shotNumber}.` })
        failTask(singleTaskId, error instanceof Error ? error.message : 'Generate image failed')
      } finally {
        setGeneratingShotIds(prev => {
          const next = { ...prev }
          delete next[segment.id]
          return next
        })
      }
    },
    [doubaoSizeValue, doubaoSizeError, doubaoSizeLabel, selectedReferenceImages, setImageResults, setStatus, enqueueTask, updateTask, failTask, currentScriptName]
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

    // 入列批量图片任务
    const batchTaskId = enqueueTask({
      type: 'image',
      projectId,
      scriptId,
      scriptName: currentScriptName,
      shotCount: targets.length,
      params: { size: doubaoSizeValue, refs: selectedReferenceImages.length }
    })

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

      const results = await generateBatchImages(
        requests.map((req, idx) => ({ ...req, shot_number: targets[idx]?.shotNumber })),
        {
          size: doubaoSizeValue,
          onProgress: (completed, total) => {
            setImageProgress(Math.round((completed / total) * 100))
            updateTask(batchTaskId, { progress: completed / total, status: 'running' })
          },
          scriptId: scriptId ?? undefined
        }
      )

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

      // 若未提供 scriptId，则前端调用 API 写库；提供了 scriptId 时已由服务端持久化，避免重复写入
      if (!scriptId) {
        try {
          await Promise.all(
            results.map((result, index) =>
              createGeneratedImage(
                scriptId || '',
                result.prompt ?? prompts[index],
                result.url,
                targets[index]?.shotNumber
              )
            )
          )
        } catch (e) {
          console.error('Failed to save batch images via API', e)
        }
      }

      setStatus({
        type: 'success',
        text: `Generated ${results.length} reference images${doubaoSizeLabel ? ` at ${doubaoSizeLabel}` : ''}.`
      })
      completeTask(batchTaskId, { count: results.length })
    } catch (error) {
      console.error('Failed to generate images via Doubao', error)
      setStatus({ type: 'error', text: 'Doubao image generation failed. Check API settings.' })
      failTask(batchTaskId, error instanceof Error ? error.message : 'Doubao image generation failed')
    } finally {
      setIsGeneratingImages(false)
      setImageProgress(0)
    }
  }, [segments, selectedForImages, doubaoSizeValue, doubaoSizeError, doubaoSizeLabel, selectedReferenceImages, imageResults, enqueueTask, updateTask, completeTask, failTask, currentScriptName])

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

    // 入列批量视频任务
    const videoTaskId = enqueueTask({
      type: 'video',
      projectId,
      scriptId,
      scriptName: currentScriptName,
      shotCount: targets.length,
      params: { model: veoModel, aspectRatio: veoAspectRatio, enhancePrompt: veoEnhancePrompt, upsample: veoUpsample, useImageAsKeyframe }
    })

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

          // 任务进度更新
          const completedIndex = targets.findIndex(t => t.id === target.id)
          const ratio = Math.max(0, Math.min(1, (completedIndex + 1) / targets.length))
          updateTask(videoTaskId, { progress: ratio, status: 'running' })

          // Persist Veo3 submission to Supabase
          try {
            const saved = await createGeneratedVideo(
              image.url,
              promptForVideo,
              scriptId,
              target.shotNumber,
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
      completeTask(videoTaskId, { count: submittedCount })
    } finally {
      setIsSubmittingVideo(false)
    }
  }, [segments, selectedForVideo, imageResults, videoPromptOverrides, veoModel, veoAspectRatio, veoEnhancePrompt, veoUpsample, useImageAsKeyframe, projectSlug, downloadImage, videoJobs, enqueueTask, updateTask, completeTask, currentScriptName])

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
    // 提示词文本是否已生成
    const promptText = (promptCsv || '').trim()
    if (!promptText) {
      setStatus({ type: 'info', text: '请先生成“Gemini：生成视频分镜提示词（文本）”。' })
      try {
        const el = document.getElementById('gemini-prompt-text')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch {}
      return
    }

    const items = segments
      .map(s => ({ s, img: imageResults[s.id] }))
      .filter(item => Boolean(item.img))

    if (items.length === 0) {
      setStatus({ type: 'error', text: 'No generated images to download.' })
      return
    }

    setIsDownloadingImages(true)
    try {
      // 并发下载，文件名按分镜号命名：shot_1.png / shot_2.jpeg ...
      await Promise.all(items.map(async ({ s, img }) => {
        const url = String(img?.url || '')
        let ext = 'png'
        try {
          const pathname = new URL(url).pathname
          const m = pathname.match(/\.([a-zA-Z0-9]+)$/)
          if (m && m[1]) ext = m[1].toLowerCase()
        } catch {}
        const filename = `shot_${s.shotNumber}.${ext}`
        await downloadImage(url, filename)
      }))

      // 下载 prompt.txt（移除每行前缀序号）
      const sanitized = promptText.split(/\r?\n/).map(l => stripLeadingOrder(l)).join('\n')
      const blob = new Blob([sanitized], { type: 'text/plain;charset=utf-8' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'prompt.txt'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)

      setStatus({ type: 'success', text: `已开始下载 ${items.length} 张图片和 prompt.txt` })
    } catch (e) {
      console.error('Bulk download images failed', e)
      setStatus({ type: 'error', text: '下载图片失败，请稍后重试。' })
    } finally {
      setIsDownloadingImages(false)
    }
  }, [segments, imageResults, promptCsv, downloadImage])

  const selectableSegments = useMemo(
    () =>
      segments.map(segment => ({
        ...segment,
        hasImage: Boolean(imageResults[segment.id])
      })),
    [segments, imageResults]
  )

  const hasVideoSelection = selectedForVideo.some(id => imageResults[id])
  // ESC 关闭参考图放大遮罩
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRefZoomUrl(null)
    }
    if (refZoomUrl) {
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [refZoomUrl])
  return (
    <div className="space-y-8">
      {/* 左侧悬浮任务队列面板 */}
      <div className="fixed left-4 top-24 z-50 hidden md:block">
        <div className="flex flex-col items-start">
          <button
            type="button"
            onClick={() => setIsTaskPanelOpen(v => !v)}
            className="relative rounded-full bg-white shadow border border-gray-200 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
            title="任务队列"
          >
            {isTaskPanelOpen ? '隐藏任务' : '显示任务'}
            {activeTaskCount > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
                {activeTaskCount}
              </span>
            )}
          </button>
          {isTaskPanelOpen && (
            <div className="mt-3 w-80 max-h-[420px] overflow-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-800">任务队列</div>
                <button
                  type="button"
                  onClick={() => setTasks(prev => prev.filter((_, idx) => idx < 50))}
                  className="text-xs text-gray-500 hover:text-gray-700"
                  title="仅保留最近 50 条"
                >
                  清理
                </button>
              </div>
              {tasks.length === 0 ? (
                <div className="text-xs text-gray-500">暂无任务</div>
              ) : (
                <div className="space-y-2">
                  {tasks.map(t => {
                    const pct = Math.round((t.progress || 0) * 100)
                    const statusColor = t.status === 'success'
                      ? 'text-green-600'
                      : t.status === 'error'
                        ? 'text-red-600'
                        : t.status === 'running'
                          ? 'text-blue-600'
                          : 'text-gray-600'
                    return (
                      <div key={t.id} className="rounded border border-gray-200 p-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <div className="font-medium text-gray-800">
                            {t.type === 'image' ? '图片生成' : '视频提交'}
                          </div>
                          <div className={statusColor}>{t.status}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-600">
                          {t.scriptName || '未命名脚本'} · {t.shotCount} 条
                        </div>
                        <div className="mt-2 h-2 w-full rounded bg-gray-200">
                          <div
                            className="h-2 rounded bg-blue-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {t.error && (
                          <div className="mt-1 text-[11px] text-red-600">{t.error}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              disabled={!projectId}
              placeholder="Storyboard Project"
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              const name = (projectName || '').trim()
              if (!projectId) {
                setStatus({ type: 'info', text: '请先创建或载入一个项目后再重命名。' })
                return
              }
              if (!name) {
                setStatus({ type: 'info', text: '项目名称不能为空。' })
                return
              }
              setIsRenamingProject(true)
              try {
                const updated = await updateProjectName(projectId, name)
                setExistingProjects(prev => prev.map(p => (p.id === projectId ? { ...p, name: updated.name } : p)))
                setStatus({ type: 'success', text: '项目名称已更新。' })
              } catch (e) {
                console.error('Rename project failed', e)
                setStatus({ type: 'error', text: '项目重命名失败。' })
              } finally {
                setIsRenamingProject(false)
              }
            }}
            disabled={!projectId || isRenamingProject || !(projectName || '').trim()}
            className="mt-6 h-10 rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-600"
          >
            {isRenamingProject ? '重命名中…' : '重命名'}
          </button>
          <button
            type="button"
            style={{ display: 'none' }}
          />
          <p className="text-xs text-gray-500">
            The project name is used when downloading images and preparing Veo prompts.
          </p>
        </div>
      </header>

      {/* 载入历史项目/脚本 */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Load existing project/script</h2>
          {isLoadingExisting && (
            <span className="text-xs text-gray-500">加载中…</span>
          )}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
          <label className="text-sm text-gray-600">
            Project
            <select
              value={selectedExistingProjectId}
              onChange={e => {
                const val = e.target.value
                if (val === '__new__') {
                  ;(async () => {
                    try {
                      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                      const defaultName = `Storyboard Project ${stamp}`
                      const project = await createProject(defaultName, 'Storyboard created via selector')
                      setProjectId(project.id)
                      setProjectName(project.name)
                      setSelectedExistingProjectId(project.id)
                      setStatus({ type: 'success', text: `项目已创建：${project.name}` })
                      if (typeof window !== 'undefined') {
                        window.location.href = `/workflows/storyboard?project=${project.id}`
                      }
                    } catch (e) {
                      console.error('Create project from selector failed', e)
                      setStatus({ type: 'error', text: '新建项目失败。' })
                    }
                  })()
                  return
                }
                setSelectedExistingProjectId(val)
                setSelectedExistingScriptId('')
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">选择一个项目</option>
              <option value="__new__" style={{ color: '#16a34a', fontWeight: '600' }}>🟩 新建项目</option>
              {existingProjects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-600">
            Script
            <select
              value={selectedExistingScriptId}
              onChange={e => setSelectedExistingScriptId(e.target.value)}
              disabled={!selectedExistingProjectId}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{selectedExistingProjectId ? '选择一个脚本' : '请先选择项目'}</option>
              {existingScripts.map(s => (
                <option key={s.id} value={s.id}>
                  {new Date(s.created_at).toLocaleString()} · {s.status}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={handleLoadExistingScript}
              disabled={!selectedExistingProjectId}
              className="h-10 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600"
            >
              加载并继续编辑
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!selectedExistingProjectId) return
                let ok = typeof window !== 'undefined' ? window.confirm('确认删除该项目及其所有脚本与生成内容？此操作不可恢复。') : false
                if (!ok) return
                setIsDeletingProject(true)
                try {
                  await deleteProject(selectedExistingProjectId)
                  const projects = await getProjects()
                  setExistingProjects(projects)
                  setSelectedExistingProjectId('')
                  setSelectedExistingScriptId('')
                  setExistingScripts([])
                  if (projectId === selectedExistingProjectId) {
                    setProjectId(null)
                    setScriptId(null)
                  }
                  setStatus({ type: 'success', text: '项目已删除。' })
                } catch (e) {
                  console.error('Delete project failed', e)
                  setStatus({ type: 'error', text: '删除项目失败。' })
                } finally {
                  setIsDeletingProject(false)
                }
              }}
              disabled={!selectedExistingProjectId || isDeletingProject}
              className="h-10 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-600"
            >
              {isDeletingProject ? '删除中…' : '删除项目'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">载入后可以继续进行参考图选择、批量替换、图片生成与 Veo3 视频提交。</p>
      </section>

      {/* 右侧悬浮参考图折叠面板 */}
      {referenceImages.length > 0 && (
        <div className={`fixed right-4 top-[calc(50%-220px)] z-50 hidden md:block ${isRefPanelOpen ? 'w-[28rem]' : 'w-72'}`}>
          {/* 参考图折叠面板 */}
          <div className="rounded-lg border border-gray-200 bg-white/95 shadow">
            <button
              type="button"
              onClick={() => setIsRefPanelOpen(prev => !prev)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              aria-expanded={isRefPanelOpen}
            >
              <span>Reference images（按顺序使用⬇）</span>
              <span className="ml-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{selectedReferenceImages.length}</span>
            </button>
            {isRefPanelOpen && (
              <div className="px-3 pb-3">
                <div className="flex flex-wrap gap-2 max-h-[420px] overflow-y-auto overflow-x-hidden pr-1">
                  {referenceImages.map((image) => {
                    const isSelected = selectedReferenceIds.includes(image.id)
                    const orderedIndex = isSelected ? selectedReferenceIds.findIndex(id => id === image.id) + 1 : null
                    return (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => toggleReferenceSelection(image.id)}
                        className={`group relative flex items-center gap-2 rounded border px-2 py-1 text-xs ${isSelected ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                        title={image.label ?? ''}
                      >
                        <span className="relative h-8 w-8 overflow-hidden rounded bg-gray-100">
                          <img
                            src={resolvedRefUrlMap[image.id] ?? image.url}
                            alt={image.label ?? 'Reference'}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={e => {
                              const imgEl = e.currentTarget as HTMLImageElement
                              imgEl.src = '/file.svg'
                              imgEl.classList.remove('object-cover')
                              imgEl.classList.add('object-contain')
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setRefZoomUrl(resolvedRefUrlMap[image.id] ?? image.url)
                            }}
                            className="h-full w-full cursor-zoom-in object-cover transition-transform duration-150 group-hover:scale-110"
                          />
                          {orderedIndex && (
                            <span className="absolute left-0 top-0 rounded-br bg-blue-600 px-1 text-[10px] text-white">
                              {orderedIndex}
                            </span>
                          )}
                        </span>
                        {image.label && (
                          <span className="max-w-[160px] truncate text-left">
                            {image.label}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {selectedReferenceImages.length > 0 && (
                  <p className="mt-2 text-[11px] text-gray-500">
                    已选择 {selectedReferenceImages.length} 张参考图，使用顺序：{' '}
                    {selectedReferenceImages.map((img, i) => `${i + 1}`).join(' → ')}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadMoreReferences}
                    disabled={!refHasMore || isLoadingMoreRefs}
                    className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoadingMoreRefs ? '加载中…' : '加载更多'}
                  </button>
                  {!refHasMore && referenceImages.length > 0 && (
                    <span className="text-[11px] text-gray-500">没有更多参考图</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 右侧悬浮：预览镜头批量替换（默认折叠） */}
          <div className="mt-2 rounded-lg border border-gray-200 bg-white/95 shadow">
            <button
              type="button"
              onClick={() => setIsBulkPanelOpen(prev => !prev)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              aria-expanded={isBulkPanelOpen}
            >
              <span>批量替换原始脚本文本（仅 textarea）</span>
            </button>
            {isBulkPanelOpen && (
              <div className="px-3 pb-3">
                <div className="space-y-2">
                  <input
                    type="text"
                    value={bulkFind}
                    onChange={event => setBulkFind(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Find text"
                  />
                  <input
                    type="text"
                    value={bulkReplaceValue}
                    onChange={event => setBulkReplaceValue(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Replace with"
                  />
                  <p className="text-[11px] text-gray-500">结构化 prompt 字段在可用时会更新。</p>
                </div>

                {/* 替换选项（按顺序执行，可编辑并可新增） */}
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] text-gray-700">替换选项（按顺序执行，可编辑并可新增）</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {bulkRules.map((rule, idx) => (
                      <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                        <input
                          type="text"
                          value={rule.find}
                          onChange={e => setBulkRules(prev => prev.map(r => (r.id === rule.id ? { ...r, find: e.target.value } : r)))}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={`Find（例如：角色${String.fromCharCode(65 + idx)})`}
                        />
                        <input
                          type="text"
                          value={rule.replace}
                          onChange={e => setBulkRules(prev => prev.map(r => (r.id === rule.id ? { ...r, replace: e.target.value } : r)))}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={`Replace with（例如：参考图${idx + 1})`}
                        />
                        <button
                          type="button"
                          onClick={() => setBulkRules(prev => prev.filter(r => r.id !== rule.id))}
                          className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBulkRules(prev => [...prev, { id: (globalThis.crypto?.randomUUID?.() ?? `rule_${Date.now()}`), find: '', replace: '' }])}
                      className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                    >
                      新增规则
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkReplaceSegments}
                      className="rounded-md bg-gray-800 px-3 py-1 text-[11px] font-medium text-white hover:bg-gray-900"
                    >
                      Apply replace
                    </button>
                  </div>
                </div>

              </div>
            )}
          </div>
          {/* 右侧悬浮按钮容器已添加，这里移除内联按钮 */}
        </div>
      )}

      {/* Floating right-side step tabs（下移以避免与右侧按钮重叠） */}
      <nav className="fixed right-4 top-[calc(50%+140px)] z-40 hidden md:flex md:w-40 md:flex-col md:space-y-2">
        <a href="#step-1" className="block w-full rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 1 解析提示词</a>
        <a href="#step-2" className="block w-full rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 2 参考图 | 分镜图</a>
        <a href="#step-3" className="block w-full rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 3 设置图片</a>
        <a href="#step-4" className="block w-full rounded bg-white/90 px-3 py-2 text-xs shadow ring-1 ring-gray-200 hover:bg-white">Step 4 生成视频</a>
      </nav>

      {/* 右侧悬浮操作按钮（生成与下载） */}
      <div className="fixed right-4 top-24 z-40 hidden md:flex md:flex-col md:gap-3">
        <button
          type="button"
          onClick={handleGenerateImages}
          disabled={isGeneratingImages || !isDoubaoSizeValid}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGeneratingImages ? `Generating ${imageProgress}%` : 'Generate images'}
        </button>
        <button
          type="button"
          onClick={handleBulkDownloadImages}
          disabled={isDownloadingImages || Object.keys(imageResults).length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          title="下载已生成的图片（按分镜号命名）"
        >
          {isDownloadingImages ? 'Downloading...' : `Download images (${Object.keys(imageResults).length})`}
        </button>
      </div>

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
      {/* 参考图放大遮罩：按比例显示，点击关闭 */}
      {refZoomUrl && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80"
          onClick={() => setRefZoomUrl(null)}
        >
          <img
            src={refZoomUrl}
            alt="Reference preview"
            className="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-lg"
          />
          <button
            type="button"
            className="absolute right-4 top-4 rounded bg-white/80 px-3 py-1 text-sm text-gray-800 hover:bg-white"
            onClick={(e) => {
              e.stopPropagation()
              setRefZoomUrl(null)
            }}
          >
            关闭
          </button>
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
            <button
              type="button"
              onClick={handleAnalyzeScript}
              disabled={isAnalyzing || !rawJson.trim()}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
            >
              {isAnalyzing ? '分析中…' : '分析脚本'}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const segmentsMapped = segments.map(s => ({
                    id: s.id,
                    scene: String(s.prompt?.subject?.action ?? s.prompt?.environment ?? ''),
                    prompt: String(s.promptText ?? ''),
                    characters: [] as string[],
                    setting: String(s.prompt?.environment ?? ''),
                    mood: String(s.prompt?.time_of_day ?? '')
                  }))
                  // 若尚未创建项目，则自动创建一个默认项目并继续保存脚本
                  let ensuredProjectId = projectId
                  // 校验当前 projectId 是否真实存在于数据库；若不存在则创建默认项目
                  try {
                    const projects = await getProjects()
                    const exists = ensuredProjectId ? projects.some(p => p.id === ensuredProjectId) : false
                    if (!exists) {
                      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                      const defaultName = `Storyboard Project ${stamp}`
                      const newProject = await createProject(defaultName, 'Auto-created when saving original script')
                      ensuredProjectId = newProject.id
                      setProjectId(newProject.id)
                      setProjectName(newProject.name)
                      setSelectedExistingProjectId(newProject.id)
                      const refreshed = await getProjects()
                      setExistingProjects(refreshed)
                      setStatus({ type: 'success', text: `已自动创建项目：${newProject.name}` })
                    }
                  } catch (verifyErr) {
                    console.warn('校验项目存在性失败，将尝试创建默认项目以继续保存。', verifyErr)
                    if (!ensuredProjectId) {
                      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                      const defaultName = `Storyboard Project ${stamp}`
                      const fallbackProject = await createProject(defaultName, 'Auto-created when saving original script')
                      ensuredProjectId = fallbackProject.id
                      setProjectId(fallbackProject.id)
                      setProjectName(fallbackProject.name)
                      setSelectedExistingProjectId(fallbackProject.id)
                      const refreshed = await getProjects().catch(() => [])
                      if (Array.isArray(refreshed)) setExistingProjects(refreshed)
                      setStatus({ type: 'success', text: `已自动创建项目：${fallbackProject.name}` })
                    }
                  }
                  if (!scriptId) {
                    let script
                    try {
                      script = await createScript(ensuredProjectId!, segmentsMapped, rawJson)
                    } catch (err: any) {
                      const msg = String(err?.message || '')
                      if (msg.includes('Invalid project_id')) {
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                        const defaultName = `Storyboard Project ${stamp}`
                        const newProject = await createProject(defaultName, 'Auto-created on retry when saving original script')
                        ensuredProjectId = newProject.id
                        setProjectId(newProject.id)
                        setProjectName(newProject.name)
                        setSelectedExistingProjectId(newProject.id)
                        const refreshed = await getProjects()
                        setExistingProjects(refreshed)
                        script = await createScript(ensuredProjectId!, segmentsMapped, rawJson)
                      } else {
                        throw err
                      }
                    }
                    setScriptId(script.id)
                    setStatus({ type: 'success', text: '脚本已创建并保存原始脚本与分镜。' })
                    return
                  }
                  const updated = await updateScript(scriptId, segmentsMapped, rawJson)
                  setStatus({ type: 'success', text: '原始脚本与分镜已更新。' })
                  setScriptId(updated.id)
                } catch (e) {
                  console.error('更新/创建脚本失败', e)
                  setStatus({ type: 'error', text: '保存原始脚本失败。' })
                }
              }}
              disabled={!rawJson.trim()}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
            >
              保存原始脚本
            </button>
          </div>
        </div>
        {/* 子脚本（世界观）列表：点击可回填至当前工作区 */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">子脚本（按世界观）</h3>
            <span className="text-xs text-gray-500">{childScripts.length ? `共 ${childScripts.length} 个` : '暂无子脚本'}</span>
          </div>
          <div className="mt-1 flex flex-col gap-2">
            {childScripts.map(s => {
              const name = extractWorldviewName(s.raw_text) || '未命名世界观'
              const isEditing = editingChildId === s.id
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-white"
                    onClick={() => loadScriptIntoStoryboard(s)}
                    title={`加载子脚本：${name}`}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-green-300 px-2 py-1 text-[11px] text-green-700 hover:bg-white"
                    title="将左侧当前原始脚本与分镜保存覆盖到该子脚本"
                    onClick={async () => {
                      try {
                        const segmentsMapped = segments.map((seg, idx) => ({
                          id: seg.id || `shot-${idx + 1}`,
                          scene: String(seg.prompt?.subject?.action ?? seg.prompt?.environment ?? ''),
                          prompt: String(seg.promptText ?? ''),
                          characters: [] as string[],
                          setting: String(seg.prompt?.environment ?? ''),
                          mood: String(seg.prompt?.time_of_day ?? ''),
                          prompt_detail: seg.prompt
                            ? {
                                subject: {
                                  characters_present: String(seg.prompt.subject?.characters_present ?? ''),
                                  expression: String(seg.prompt.subject?.expression ?? ''),
                                  action: String(seg.prompt.subject?.action ?? '')
                                },
                                environment: String(seg.prompt.environment ?? ''),
                                time_of_day: String(seg.prompt.time_of_day ?? ''),
                                weather: String(seg.prompt.weather ?? ''),
                                camera_angle: String(seg.prompt.camera_angle ?? ''),
                                shot_size: String(seg.prompt.shot_size ?? '')
                              }
                            : undefined
                        }))
                        const updated = await updateScript(s.id, segmentsMapped, rawJson)
                        // 刷新脚本列表
                        try {
                          const scripts = await getScripts(updated.project_id)
                          setExistingScripts(scripts)
                        } catch { /* ignore */ }
                        setStatus({ type: 'success', text: '已保存当前内容到该子脚本。' })
                      } catch (err) {
                        console.error('保存到子脚本失败', err)
                        setStatus({ type: 'error', text: '保存到子脚本失败。' })
                      }
                    }}
                  >
                    保存当前到此
                  </button>
                  {!isEditing && (
                    <button
                      type="button"
                      className="rounded border border-yellow-300 px-2 py-1 text-[11px] text-yellow-700 hover:bg-white"
                      title="重命名子脚本（仅修改世界观名称）"
                      onClick={() => {
                        setEditingChildId(s.id)
                        setEditingChildName(name)
                      }}
                    >
                      重命名
                    </button>
                  )}
                  {isEditing && (
                    <>
                      <input
                        type="text"
                        value={editingChildName}
                        onChange={e => setEditingChildName(e.target.value)}
                        className="w-40 rounded border border-yellow-300 px-2 py-1 text-[11px] bg-white"
                        placeholder="世界观名称"
                      />
                      <button
                        type="button"
                        className="rounded border border-yellow-300 px-2 py-1 text-[11px] text-yellow-700 hover:bg-white"
                        onClick={async () => {
                          try {
                            const lines = (s.raw_text || '').split(/\r?\n/)
                            const body = lines.slice(1).join('\n')
                            const nextRaw = `世界观：${editingChildName}\n${body}`
                            const updated = await updateScript(s.id, s.content || [], nextRaw)
                            try {
                              const scripts = await getScripts(updated.project_id)
                              setExistingScripts(scripts)
                            } catch { /* ignore */ }
                            setEditingChildId(null)
                            setEditingChildName('')
                            setStatus({ type: 'success', text: '子脚本已重命名。' })
                          } catch (err) {
                            console.error('重命名子脚本失败', err)
                            setStatus({ type: 'error', text: '重命名子脚本失败。' })
                          }
                        }}
                      >
                        保存名称
                      </button>
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                        onClick={() => {
                          setEditingChildId(null)
                          setEditingChildName('')
                        }}
                      >
                        取消
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-white"
                    title="删除该子脚本"
                    onClick={async () => {
                      try {
                        await deleteScript(s.id)
                        // 刷新脚本列表
                        try {
                          const scripts = await getScripts(s.project_id)
                          setExistingScripts(scripts)
                        } catch { /* ignore */ }
                        setStatus({ type: 'success', text: '已删除子脚本。' })
                      } catch (err) {
                        console.error('删除子脚本失败', err)
                        setStatus({ type: 'error', text: '删除子脚本失败。' })
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              )
            })}
            {!childScripts.length && (
              <div className="rounded border border-dashed px-2 py-1 text-[11px] text-gray-500">保存世界观改写后，将在此显示列表。</div>
            )}
          </div>
          {/* 自定义子脚本（CSV）添加 */}
          <div className="mt-3 rounded border border-dashed p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-gray-700">自定义子脚本（CSV）</h4>
              {isSavingCustomChild && (
                <span className="text-xs text-gray-500">保存中…</span>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_auto]">
              <input
                type="text"
                value={customChildName}
                onChange={e => setCustomChildName(e.target.value)}
                placeholder="世界观/名称"
                className="rounded border border-indigo-200 px-2 py-1 text-[11px] bg-white"
              />
              <textarea
                value={customChildCsv}
                onChange={e => setCustomChildCsv(e.target.value)}
                placeholder="粘贴 CSV 文本（分镜数,分镜提示词）"
                className="h-20 w-full rounded-md border border-indigo-200 px-2 py-1 text-[11px] font-mono bg-white"
              />
              <button
                type="button"
                className="rounded border border-green-300 px-2 py-1 text-[11px] text-green-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                disabled={isSavingCustomChild || !customChildName.trim() || !customChildCsv.trim()}
                onClick={async () => {
                  try {
                    setCustomChildError(null)
                    setIsSavingCustomChild(true)
                    const parsed = parseStoryboardCsv(customChildCsv)
                    if (!parsed.length) {
                      setCustomChildError('CSV 解析失败或为空。')
                      return
                    }
                    const segmentsMapped: DbScriptSegment[] = parsed.map((s, i) => ({
                      id: s.id || `shot-${i + 1}`,
                      scene: String(s.prompt?.subject?.action ?? s.prompt?.environment ?? ''),
                      prompt: String(s.promptText ?? ''),
                      characters: [] as string[],
                      setting: String(s.prompt?.environment ?? ''),
                      mood: String(s.prompt?.time_of_day ?? ''),
                      prompt_detail: {
                        subject: {
                          characters_present: String(s.prompt?.subject?.characters_present ?? ''),
                          expression: String(s.prompt?.subject?.expression ?? ''),
                          action: String(s.prompt?.subject?.action ?? '')
                        },
                        environment: String(s.prompt?.environment ?? ''),
                        time_of_day: String(s.prompt?.time_of_day ?? ''),
                        weather: String(s.prompt?.weather ?? ''),
                        camera_angle: String(s.prompt?.camera_angle ?? ''),
                        shot_size: String(s.prompt?.shot_size ?? '')
                      }
                    }))

                    // 确保项目存在
                    let ensuredProjectId = selectedExistingProjectId || projectId
                    if (!ensuredProjectId) {
                      try {
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                        const defaultName = `Storyboard Project ${stamp}`
                        const fallbackProject = await createProject(defaultName, 'Auto-created when saving custom child script')
                        ensuredProjectId = fallbackProject.id
                        setProjectId(fallbackProject.id)
                        setProjectName(fallbackProject.name)
                        setSelectedExistingProjectId(fallbackProject.id)
                        const refreshed = await getProjects().catch(() => [])
                        if (Array.isArray(refreshed)) setExistingProjects(refreshed)
                        setStatus({ type: 'success', text: `已自动创建项目：${fallbackProject.name}` })
                      } catch (e) {
                        console.error('创建项目失败', e)
                        setCustomChildError('创建项目失败。')
                        return
                      }
                    }

                    const rawText = `世界观：${customChildName}\n${customChildCsv}`
                    let script
                    try {
                      script = await createScript(ensuredProjectId!, segmentsMapped, rawText)
                    } catch (err: any) {
                      const msg = String(err?.message || '')
                      if (msg.includes('Invalid project_id')) {
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                        const defaultName = `Storyboard Project ${stamp}`
                        const newProject = await createProject(defaultName, 'Auto-created on retry when saving custom child script')
                        ensuredProjectId = newProject.id
                        setProjectId(newProject.id)
                        setProjectName(newProject.name)
                        setSelectedExistingProjectId(newProject.id)
                        const refreshed = await getProjects()
                        setExistingProjects(refreshed)
                        script = await createScript(ensuredProjectId!, segmentsMapped, rawText)
                      } else {
                        throw err
                      }
                    }

                    try {
                      const scripts = await getScripts(ensuredProjectId!)
                      setExistingScripts(scripts)
                    } catch { /* ignore */ }
                    await loadScriptIntoStoryboard(script)
                    setCustomChildName('')
                    setCustomChildCsv('')
                    setStatus({ type: 'success', text: '已保存自定义子脚本并加载到工作区。' })
                  } catch (error) {
                    console.error('保存自定义子脚本失败', error)
                    setCustomChildError('保存自定义子脚本失败。')
                  } finally {
                    setIsSavingCustomChild(false)
                  }
                }}
                title="保存为子脚本，不覆盖原始脚本"
              >
                {isSavingCustomChild ? '保存中…' : '保存为子脚本'}
              </button>
            </div>
            {customChildError && (
              <p className="mt-2 text-xs text-red-600">{customChildError}</p>
            )}
          </div>
        </div>
        <textarea
          value={rawJson}
          onChange={event => setRawJson(event.target.value)}
          className="h-64 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Paste storyboard JSON array or CSV text here"
        />
        {/* 分镜编号高亮预览：从 textarea 解析编号并以醒目颜色展示 */}
        {shotNumberPreview.length > 0 && (
          <div className="mt-2 rounded-md border border-yellow-200 bg-yellow-50 p-2">
            <p className="text-xs font-medium text-yellow-800">分镜编号标注预览（来源：左侧 textarea）</p>
            <div className="mt-2 space-y-1 font-mono text-xs">
              {shotNumberPreview.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="inline-flex items-center justify-center rounded bg-yellow-300 px-2 py-0.5 font-bold text-yellow-900">
                    {item.num}
                  </span>
                  <span className="text-gray-800">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        {analyzeError && <p className="text-sm text-red-600">{analyzeError}</p>}

        {/* 参考视频模块（迁移到Step 1分析结果上方） */}
        <div className="mt-4 rounded-md border border-dashed p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">YouTube参考视频</h3>
            {isLoadingRefVideos && <span className="text-xs text-gray-500">加载参考视频…</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
            <input
              type="url"
              value={newYoutubeUrl}
              onChange={e => setNewYoutubeUrl(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="粘贴 YouTube 视频链接，例如 https://youtu.be/xxxx、https://www.youtube.com/watch?v=xxxx 或 https://www.youtube.com/shorts/xxxx"
            />
            <textarea
              value={newYoutubeLabel}
              onChange={e => setNewYoutubeLabel(e.target.value)}
              className="w-full h-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="备注（可选，支持多行）"
            />
            <button
              type="button"
              onClick={async () => {
                const id = extractYouTubeId(newYoutubeUrl.trim())
                if (!id) {
                  setStatus({ type: 'error', text: '请输入有效的 YouTube 链接。' })
                  return
                }
                if (!projectId) {
                  setStatus({ type: 'info', text: '请先创建或选择项目，再保存参考视频。' })
                  return
                }
                setIsAddingYoutube(true)
                try {
                  const composedLabel = (newYoutubeLabel || '').trim() || undefined
                  const item = await addReferenceVideo(newYoutubeUrl.trim(), composedLabel, null, projectId)
                  setReferenceVideos(prev => [item, ...prev])
                  setNewYoutubeUrl('')
                  setNewYoutubeLabel('')
                  setStatus({ type: 'success', text: '参考视频已保存。' })
                } catch (error) {
                  console.error('保存参考视频失败', error)
                  setStatus({ type: 'error', text: '保存参考视频失败。' })
                } finally {
                  setIsAddingYoutube(false)
                }
              }}
              disabled={isAddingYoutube}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAddingYoutube ? '保存中…' : '保存到数据库'}
            </button>
          </div>

          {/* 预览 iframe */}
          {extractYouTubeId(newYoutubeUrl.trim()) && (
            <div className="mt-3">
              <div className="aspect-video w-full overflow-hidden rounded-md border">
                <iframe
                  src={`https://www.youtube.com/embed/${extractYouTubeId(newYoutubeUrl.trim())}`}
                  title="YouTube preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">预览仅根据粘贴的链接生成，不会自动播放。</p>
            </div>
          )}

          {/* 已保存的参考视频列表 */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {referenceVideos.map(video => {
              const vid = extractYouTubeId(video.url)
              const remarkText = (video.label || '')
              return (
                <div key={video.id} className="rounded-md border p-3">
                  {vid ? (
                    <div className="aspect-video w-full overflow-hidden rounded">
                      <iframe
                        src={`https://www.youtube.com/embed/${vid}`}
                        title={remarkText || 'YouTube reference'}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        className="h-full w-full"
                      />
                    </div>
                  ) : (
                    <a href={video.url} target="_blank" rel="noreferrer" className="text-blue-600 text-sm hover:underline">{video.url}</a>
                  )}
                  <div className="mt-2">
                    <label className="text-xs text-gray-700">备注</label>
                    <textarea
                      defaultValue={remarkText}
                      onChange={(e) => {
                        const val = e.target.value
                        setReferenceVideos(prev => prev.map(v => v.id === video.id ? { ...v, label: (val || '').trim() || undefined } : v))
                      }}
                      className="mt-1 h-20 w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="填写或编辑备注（支持多行）"
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const lbl = video.label || ''
                            await updateReferenceVideoLabel(video.id, lbl)
                            setStatus({ type: 'success', text: '备注已保存。' })
                          } catch (err) {
                            console.error('保存备注失败', err)
                            setStatus({ type: 'error', text: '保存备注失败。' })
                          }
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                      >
                        保存备注到数据库
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await removeReferenceVideo(video.id)
                            setReferenceVideos(prev => prev.filter(v => v.id !== video.id))
                          } catch (err) {
                            console.error('删除参考视频失败', err)
                            setStatus({ type: 'error', text: '删除参考视频失败。' })
                          }
                        }}
                        className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-white"
                        aria-label="删除参考视频"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {!referenceVideos.length && (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-gray-500">尚未保存参考视频。</div>
            )}
          </div>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">脚本分析结果（Gemini）</h3>
            <div className="flex items-center gap-2">
              {analysisId && (
                <a
                  href={`/api/script-analysis/${analysisId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-blue-300 px-2 py-1 text-[11px] text-blue-700 hover:bg-white"
                  title="查看已保存的分析 JSON"
                >
                  已保存链接
                </a>
              )}
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                onClick={() => setIsAnalysisCollapsed(v => !v)}
                aria-expanded={!isAnalysisCollapsed}
                title={isAnalysisCollapsed ? '展开分析内容' : '收起分析内容'}
              >
                {isAnalysisCollapsed ? '展开' : '收起'}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                onClick={() => analysis && handleCopy(analysis)}
                disabled={!analysis}
                title={analysis ? '复制分析内容' : '暂无可复制内容'}
              >
                复制
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                onClick={() => { setAnalysis(''); setAnalysisId(''); }}
              >
                清除
              </button>
            </div>
          </div>

          {analysis ? (
            !isAnalysisCollapsed && (
              <div className="prose prose-sm max-w-none text-gray-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
              </div>
            )
          ) : (
            <p className="text-sm text-gray-500">暂未分析脚本</p>
          )}
        </div>

        {/* Gemini: 生成视频分镜提示词（文本） */}
        <div id="gemini-prompt-text" className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Gemini：生成视频分镜提示词（文本）</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-blue-300 px-2 py-1 text-[11px] text-blue-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={async () => {
                  try {
                    if (!rawJson.trim()) {
                      setPromptError('请在上方粘贴原始脚本文本或JSON/CSV。')
                      return
                    }
                    setPromptError(null)
                    setIsPrompting(true)
                    const res = await fetch('/api/storyboard-prompts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ scriptText: rawJson })
                    })
                    const data = await res.json().catch(() => ({}))
                    const text = data?.text ? String(data.text) : ''
                    setPromptCsv(text)
                  } catch (error) {
                    console.error('生成分镜提示词失败', error)
                    setPromptError('生成分镜提示词失败。')
                  } finally {
                    setIsPrompting(false)
                  }
                }}
                disabled={isPrompting || !rawJson.trim()}
              >
                {isPrompting ? '生成中…' : '生成分镜文本'}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={() => promptCsv && handleCopy(promptCsv)}
                disabled={!promptCsv}
              >
                复制
              </button>
              {/* 自定义分镜文本输入并追加 */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customPromptLine}
                  onChange={e => setCustomPromptLine(e.target.value)}
                  placeholder="自定义分镜文本（每行一条）"
                  className="rounded border border-blue-300 px-2 py-1 text-[11px] bg-white"
                />
                <button
                  type="button"
                  className="rounded border border-blue-300 px-2 py-1 text-[11px] text-blue-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                  disabled={!customPromptLine.trim()}
                  onClick={async () => {
                    const line = customPromptLine.trim()
                    if (!line) return
                    // 合并文本
                    const merged = promptCsv ? `${promptCsv}\n${line}` : line
                    setPromptCsv(merged)
                    setCustomPromptLine('')
                    setStatus({ type: 'success', text: '已追加一条自定义分镜文本。' })

                    // 追加后立即保存到 MongoDB
                    try {
                      if (!scriptId) {
                        setStatus({ type: 'info', text: '请先选择或创建脚本。' })
                        return
                      }
                      if (!segments.length) {
                        setStatus({ type: 'info', text: '请先在 Step 1 解析分镜脚本。' })
                        return
                      }
                      const lines = merged.split(/\r?\n/).map(l => stripLeadingOrder(l.trim())).filter(Boolean)
                      const payload: Array<{ shot_number: number; text: string }> = []
                      segments.forEach((seg, i) => {
                        const idx = typeof seg.shotNumber === 'number' ? seg.shotNumber - 1 : i
                        const text = lines[idx] || ''
                        if (text) payload.push({ shot_number: seg.shotNumber || i + 1, text })
                      })
                      if (!payload.length) {
                        setStatus({ type: 'info', text: '当前没有可保存的分镜文本。' })
                        return
                      }
                      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
                      const res = await fetch(`${baseOrigin}/api/video-prompts`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ script_id: scriptId, prompts: payload })
                      })
                      if (!res.ok) {
                        const err = await res.json().catch(() => null)
                        console.error('保存分镜文本失败', err)
                        setStatus({ type: 'error', text: '保存分镜文本失败。' })
                        return
                      }
                      setStatus({ type: 'success', text: `已保存 ${payload.length} 条分镜提示词到数据库。` })
                    } catch (e) {
                      console.error('保存分镜文本异常', e)
                      setStatus({ type: 'error', text: '保存分镜文本异常。' })
                    }
                  }}
                  title="将输入追加为一行分镜文本并保存到 MongoDB"
                >
                  追加一行
                </button>
              </div>
              <button
                type="button"
                className="rounded border border-green-300 px-2 py-1 text-[11px] text-green-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={async () => {
                  try {
                    if (!promptCsv) return
                    const lines = promptCsv.split(/\r?\n/).map(l => stripLeadingOrder(l.trim())).filter(Boolean)
                    if (!scriptId) {
                      setStatus({ type: 'info', text: '请先选择或创建脚本。' })
                      return
                    }
                    if (!segments.length) {
                      setStatus({ type: 'info', text: '请先在 Step 1 解析分镜脚本。' })
                      return
                    }
                    const promptsPayload: Array<{ shot_number: number; text: string }> = []
                    segments.forEach((seg, i) => {
                      const idx = typeof seg.shotNumber === 'number' ? seg.shotNumber - 1 : i
                      const text = lines[idx] || ''
                      if (text) {
                        promptsPayload.push({ shot_number: seg.shotNumber || i + 1, text })
                      }
                    })
                    if (!promptsPayload.length) {
                      setStatus({ type: 'info', text: '当前没有可保存的分镜文本。' })
                      return
                    }
                    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
                    const res = await fetch(`${baseOrigin}/api/video-prompts`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ script_id: scriptId, prompts: promptsPayload })
                    })
                    if (!res.ok) {
                      const err = await res.json().catch(() => null)
                      console.error('保存分镜文本失败', err)
                      setStatus({ type: 'error', text: '保存分镜文本失败。' })
                      return
                    }
                    setStatus({ type: 'success', text: `已保存 ${promptsPayload.length} 条分镜提示词到数据库。` })
                  } catch (e) {
                    console.error('保存分镜文本异常', e)
                    setStatus({ type: 'error', text: '保存分镜文本异常。' })
                  }
                }}
                disabled={!promptCsv}
                title="保存生成视频分镜提示词（每行一条）到 MongoDB"
              >
                保存分镜文本
              </button>
              <button
                type="button"
                className="rounded border border-green-300 px-2 py-1 text-[11px] text-green-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={async () => {
                  if (!promptCsv) return
                  const lines = promptCsv.split(/\r?\n/).map(l => stripLeadingOrder(l.trim())).filter(Boolean)
                  if (!segments.length) {
                    setStatus({ type: 'info', text: '请先在 Step 1 解析分镜脚本。' })
                    return
                  }
                  const nextOverrides: Record<string, string> = { ...videoPromptOverrides }
                  const promptsPayload: Array<{ shot_number: number; text: string }> = []
                  segments.forEach((seg, i) => {
                    const idx = typeof seg.shotNumber === 'number' ? seg.shotNumber - 1 : i
                    const text = lines[idx] || ''
                    if (text) {
                      nextOverrides[seg.id] = text
                      if (scriptId) {
                        promptsPayload.push({ shot_number: seg.shotNumber || i + 1, text })
                      }
                    }
                  })
                  setVideoPromptOverrides(nextOverrides)
                  setStatus({ type: 'success', text: `已覆盖 Step 4 的 Video Prompt（${promptsPayload.length} 条）。` })
                  // 保存到 MongoDB
                  try {
                    if (scriptId && promptsPayload.length) {
                      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
                      const res = await fetch(`${baseOrigin}/api/video-prompts`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ script_id: scriptId, prompts: promptsPayload })
                      })
                      if (!res.ok) {
                        const err = await res.json().catch(() => null)
                        console.error('保存 Video Prompt 失败', err)
                      }
                    }
                  } catch (e) {
                    console.error('保存 Video Prompt 异常', e)
                  }
                }}
                disabled={!promptCsv}
                title="将生成的文本覆盖到 Step 4 的 Video Prompt"
              >
                覆盖到 Step 4 的 Video Prompt
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                onClick={() => { setPromptCsv(''); setPromptError(null) }}
              >
                清除
              </button>
            </div>
          </div>
          {promptError && <p className="text-xs text-red-600">{promptError}</p>}
          {/* 自定义多行分镜文本输入 */}
          <div className="mb-2 rounded-md border border-blue-200 bg-white p-3">
            <label className="text-xs font-semibold text-gray-700" htmlFor="custom-bulk-input">自定义分镜文本（多行，一行一条）</label>
            <textarea
              id="custom-bulk-input"
              value={customPromptBulk}
              onChange={e => setCustomPromptBulk(e.target.value)}
              placeholder={"分镜1文本\n分镜2文本\n..."}
              className="mt-1 h-28 w-full rounded-md border border-blue-200 px-3 py-2 text-xs font-mono"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-blue-300 px-2 py-1 text-[11px] text-blue-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                disabled={!customPromptBulk.trim()}
                onClick={async () => {
                  const bulk = customPromptBulk.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n')
                  if (!bulk) return
                  // 合并文本
                  const merged = promptCsv ? `${promptCsv}\n${bulk}` : bulk
                  setPromptCsv(merged)
                  setCustomPromptBulk('')
                  setStatus({ type: 'success', text: '已追加多行分镜文本。' })

                  // 追加后立即保存到 MongoDB
                  try {
                    if (!scriptId) {
                      setStatus({ type: 'info', text: '请先选择或创建脚本。' })
                      return
                    }
                    if (!segments.length) {
                      setStatus({ type: 'info', text: '请先在 Step 1 解析分镜脚本。' })
                      return
                    }
                    const lines = merged.split(/\r?\n/).map(l => stripLeadingOrder(l.trim())).filter(Boolean)
                    const payload: Array<{ shot_number: number; text: string }> = []
                    segments.forEach((seg, i) => {
                      const idx = typeof seg.shotNumber === 'number' ? seg.shotNumber - 1 : i
                      const text = lines[idx] || ''
                      if (text) payload.push({ shot_number: seg.shotNumber || i + 1, text })
                    })
                    if (!payload.length) {
                      setStatus({ type: 'info', text: '当前没有可保存的分镜文本。' })
                      return
                    }
                    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
                    const res = await fetch(`${baseOrigin}/api/video-prompts`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ script_id: scriptId, prompts: payload })
                    })
                    if (!res.ok) {
                      const err = await res.json().catch(() => null)
                      console.error('保存分镜文本失败', err)
                      setStatus({ type: 'error', text: '保存分镜文本失败。' })
                      return
                    }
                    setStatus({ type: 'success', text: `已保存 ${payload.length} 条分镜提示词到数据库。` })
                  } catch (e) {
                    console.error('保存分镜文本异常', e)
                    setStatus({ type: 'error', text: '保存分镜文本异常。' })
                  }
                }}
                title="将多行内容追加并保存到 MongoDB"
              >
                追加到当前
              </button>
              <button
                type="button"
                className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                disabled={!customPromptBulk.trim()}
                onClick={async () => {
                  const bulk = customPromptBulk.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n')
                  if (!bulk) return
                  setPromptCsv(bulk)
                  setCustomPromptBulk('')
                  setStatus({ type: 'success', text: '已覆盖为自定义多行分镜文本。' })

                  // 覆盖后立即保存到 MongoDB
                  try {
                    if (!scriptId) {
                      setStatus({ type: 'info', text: '请先选择或创建脚本。' })
                      return
                    }
                    if (!segments.length) {
                      setStatus({ type: 'info', text: '请先在 Step 1 解析分镜脚本。' })
                      return
                    }
                    const lines = bulk.split(/\r?\n/).map(l => stripLeadingOrder(l.trim())).filter(Boolean)
                    const payload: Array<{ shot_number: number; text: string }> = []
                    segments.forEach((seg, i) => {
                      const idx = typeof seg.shotNumber === 'number' ? seg.shotNumber - 1 : i
                      const text = lines[idx] || ''
                      if (text) payload.push({ shot_number: seg.shotNumber || i + 1, text })
                    })
                    if (!payload.length) {
                      setStatus({ type: 'info', text: '当前没有可保存的分镜文本。' })
                      return
                    }
                    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
                    const res = await fetch(`${baseOrigin}/api/video-prompts`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ script_id: scriptId, prompts: payload })
                    })
                    if (!res.ok) {
                      const err = await res.json().catch(() => null)
                      console.error('保存分镜文本失败', err)
                      setStatus({ type: 'error', text: '保存分镜文本失败。' })
                      return
                    }
                    setStatus({ type: 'success', text: `已保存 ${payload.length} 条分镜提示词到数据库。` })
                  } catch (e) {
                    console.error('保存分镜文本异常', e)
                    setStatus({ type: 'error', text: '保存分镜文本异常。' })
                  }
                }}
                title="用多行内容覆盖并保存到 MongoDB"
              >
                覆盖当前
              </button>
            </div>
          </div>
          {/* 已保存的分镜提示词（MongoDB）展示 */}
          <div className="mb-2 rounded-md border border-blue-200 bg-white p-3">
            <h4 className="text-xs font-semibold text-gray-700">已保存的分镜提示词（MongoDB）</h4>
            {segments.some(seg => (videoPromptOverrides[seg.id] || '').trim()) ? (
              <textarea
                readOnly
                value={segments
                  .map(seg => (videoPromptOverrides[seg.id] || '').trim())
                  .filter(Boolean)
                  .join('\n')}
                className="mt-1 h-28 w-full rounded-md border border-blue-200 px-3 py-2 text-xs font-mono bg-white"
              />
            ) : (
              <p className="text-xs text-blue-700">暂无已保存的分镜提示词。</p>
            )}
          </div>
          {promptCsv ? (
            <textarea
              value={promptCsv}
              readOnly
              className="h-32 w-full rounded-md border border-blue-200 px-3 py-2 text-xs font-mono bg-white"
            />
          ) : (
            <p className="text-xs text-blue-700">粘贴原始脚本后点击“生成分镜文本”。输出为纯文本，每行一条，不会直接更改分镜预览。</p>
          )}
        </div>

        {/* Gemini: 世界观改写脚本 */}
        <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Gemini：世界观改写脚本（CSV）</h3>
            <div className="flex items-center gap-2">
              <select
                value={worldview}
                onChange={e => setWorldview(e.target.value)}
                className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 bg-white"
              >
                {worldviews.map((wv, idx) => (
                  <option key={idx} value={wv}>{wv}</option>
                ))}
              </select>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                onClick={async () => {
                  try {
                    setWorldviewSavedInfo('')
                    const res = await fetch(`/api/worldview-settings?name=${encodeURIComponent(worldview)}`)
                    const data = await res.json().catch(() => ({}))
                    const item = data?.item
                    if (item) {
                      setWorldviewCore(item.core || '')
                      setWorldviewElements(item.elements || '')
                      setWorldviewReferences(item.references || '')
                      setWorldviewSavedInfo('已加载数据库设定')
                    } else {
                      setWorldviewSavedInfo('数据库无记录')
                    }
                  } catch {
                    setWorldviewSavedInfo('读取失败')
                  }
                }}
              >
                读取设定
              </button>
              <button
                type="button"
                className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={async () => {
                  try {
                    if (!rawJson.trim()) {
                      setWorldviewError('请在上方粘贴原始脚本文本或JSON/CSV。')
                      return
                    }
                    setWorldviewError(null)
                    setIsRewriting(true)
                    const res = await fetch('/api/worldview-rewrite', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ scriptText: rawJson, worldview, core: worldviewCore, elements: worldviewElements, references: worldviewReferences })
                    })
                    const data = await res.json().catch(() => ({}))
                    const csv = data?.csv ? String(data.csv) : ''
                    setWorldviewResult(csv)
                  } catch (error) {
                    console.error('世界观改写失败', error)
                    setWorldviewError('世界观改写失败。')
                  } finally {
                    setIsRewriting(false)
                  }
                }}
                disabled={isRewriting || !rawJson.trim()}
              >
                {isRewriting ? '改写中…' : '应用世界观并改写为CSV'}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={() => worldviewResult && handleCopy(worldviewResult)}
                disabled={!worldviewResult}
              >
                复制
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                onClick={() => { setWorldviewResult(''); setWorldviewError(null) }}
              >
                清除
              </button>
              <button
                type="button"
                className="rounded border border-green-300 px-2 py-1 text-[11px] text-green-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                onClick={async () => {
                  try {
                    if (!worldviewResult.trim()) {
                      setWorldviewError('请先生成世界观改写的CSV。')
                      return
                    }
                    setWorldviewError(null)
                    setIsSavingChild(true)
                    // 解析 CSV 为分镜段
                    const parsed = parseStoryboardCsv(worldviewResult)
                    if (!parsed.length) {
                      setWorldviewError('CSV 解析失败或为空，无法保存为子脚本。')
                      return
                    }
                    // 映射为数据库脚本段结构（确保 PromptDetail 字段为严格字符串类型）
                    const segmentsMapped: DbScriptSegment[] = parsed.map((s, i) => ({
                      id: s.id || `shot-${i + 1}`,
                      scene: (s.prompt?.subject?.action || s.prompt?.environment || ''),
                      prompt: (typeof s.promptText === 'string' ? s.promptText : String(s.promptText ?? '')),
                      characters: Array.isArray((s as any).characters) ? ((s as any).characters as string[]) : [],
                      setting: String(s.prompt?.environment ?? ''),
                      mood: String(s.prompt?.time_of_day ?? ''),
                      prompt_detail: {
                        subject: {
                          characters_present: String(s.prompt?.subject?.characters_present ?? ''),
                          expression: String(s.prompt?.subject?.expression ?? ''),
                          action: String(s.prompt?.subject?.action ?? '')
                        },
                        environment: String(s.prompt?.environment ?? ''),
                        time_of_day: String(s.prompt?.time_of_day ?? ''),
                        weather: String(s.prompt?.weather ?? ''),
                        camera_angle: String(s.prompt?.camera_angle ?? ''),
                        shot_size: String(s.prompt?.shot_size ?? '')
                      }
                    }))
                    // 确保项目存在；若不存在则创建默认项目
                    let ensuredProjectId = projectId
                    try {
                      const projects = await getProjects()
                      const exists = ensuredProjectId ? projects.some(p => p.id === ensuredProjectId) : false
                      if (!exists) {
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                        const defaultName = `Storyboard Project ${stamp}`
                        const newProject = await createProject(defaultName, 'Auto-created when saving worldview child script')
                        ensuredProjectId = newProject.id
                        setProjectId(newProject.id)
                        setProjectName(newProject.name)
                        setSelectedExistingProjectId(newProject.id)
                        const refreshed = await getProjects()
                        setExistingProjects(refreshed)
                        setStatus({ type: 'success', text: `已自动创建项目：${newProject.name}` })
                      }
                    } catch (verifyErr) {
                      console.warn('校验项目存在性失败，将尝试创建默认项目以继续保存子脚本。', verifyErr)
                      if (!ensuredProjectId) {
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                        const defaultName = `Storyboard Project ${stamp}`
                        const fallbackProject = await createProject(defaultName, 'Auto-created when saving worldview child script')
                        ensuredProjectId = fallbackProject.id
                        setProjectId(fallbackProject.id)
                        setProjectName(fallbackProject.name)
                        setSelectedExistingProjectId(fallbackProject.id)
                        const refreshed = await getProjects().catch(() => [])
                        if (Array.isArray(refreshed)) setExistingProjects(refreshed)
                        setStatus({ type: 'success', text: `已自动创建项目：${fallbackProject.name}` })
                      }
                    }
                    // 构造原始文本，便于提取世界观名与回显
                    const rawText = `世界观：${worldview}\n${worldviewResult}`
                    let script
                    try {
                      script = await createScript(ensuredProjectId!, segmentsMapped, rawText)
                    } catch (err: any) {
                      const msg = String(err?.message || '')
                      if (msg.includes('Invalid project_id')) {
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                        const defaultName = `Storyboard Project ${stamp}`
                        const newProject = await createProject(defaultName, 'Auto-created on retry when saving worldview child script')
                        ensuredProjectId = newProject.id
                        setProjectId(newProject.id)
                        setProjectName(newProject.name)
                        setSelectedExistingProjectId(newProject.id)
                        const refreshed = await getProjects()
                        setExistingProjects(refreshed)
                        script = await createScript(ensuredProjectId!, segmentsMapped, rawText)
                      } else {
                        throw err
                      }
                    }
                    // 刷新脚本列表并加载子脚本
                    try {
                      const scripts = await getScripts(ensuredProjectId!)
                      setExistingScripts(scripts)
                    } catch { /* ignore */ }
                    await loadScriptIntoStoryboard(script)
                  } catch (error) {
                    console.error('保存子脚本失败', error)
                    setWorldviewError('保存子脚本失败。')
                  } finally {
                    setIsSavingChild(false)
                  }
                }}
                disabled={isSavingChild || !worldviewResult.trim()}
                title="将改写后的 CSV 另存为子脚本，不覆盖原始脚本"
              >
                {isSavingChild ? '保存中…' : '保存为子脚本'}
              </button>
            </div>
          </div>
          {/* 世界观细节编辑：核心设定 / 关键元素 / 参考案例 */}
          <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] text-gray-600">核心设定</label>
              <textarea
                value={worldviewCore}
                onChange={e => setWorldviewCore(e.target.value)}
                placeholder="例如：世界基调压抑残酷……"
                className="h-20 w-full rounded-md border border-indigo-200 px-2 py-1 text-[11px] bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-600">关键元素（逗号分隔）</label>
              <textarea
                value={worldviewElements}
                onChange={e => setWorldviewElements(e.target.value)}
                placeholder="例如：腐化的魔法, 畸形怪物, …"
                className="h-20 w-full rounded-md border border-indigo-200 px-2 py-1 text-[11px] bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-600">参考案例（逗号分隔）</label>
              <textarea
                value={worldviewReferences}
                onChange={e => setWorldviewReferences(e.target.value)}
                placeholder="例如：《黑暗之魂》,《血源诅咒》, …"
                className="h-20 w-full rounded-md border border-indigo-200 px-2 py-1 text-[11px] bg-white"
              />
            </div>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
              onClick={async () => {
                try {
                  setIsSavingWorldview(true)
                  setWorldviewSavedInfo('')
                  const res = await fetch('/api/worldview-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: worldview, core: worldviewCore, elements: worldviewElements, references: worldviewReferences })
                  })
                  if (!res.ok) throw new Error('save failed')
                  setWorldviewSavedInfo('已保存到数据库')
                } catch {
                  setWorldviewSavedInfo('保存失败')
                } finally {
                  setIsSavingWorldview(false)
                }
              }}
              disabled={isSavingWorldview}
            >
              {isSavingWorldview ? '保存中…' : '保存设定'}
            </button>
            {worldviewSavedInfo && (
              <span className="text-[11px] text-gray-700">{worldviewSavedInfo}</span>
            )}
          </div>
          {/* 世界观预设管理区：新增 / 编辑 / 删除 */}
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newWorldview}
                onChange={e => setNewWorldview(e.target.value)}
                placeholder="新增世界观，例如：魔幻现实主义"
                className="rounded border border-indigo-200 px-2 py-1 text-[11px] bg-white text-gray-800 w-56"
              />
              <button
                type="button"
                className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-700 hover:bg-white"
                onClick={() => {
                  const v = newWorldview.trim()
                  if (!v) return
                  if (worldviews.includes(v)) {
                    setWorldview(v)
                    setNewWorldview('')
                    return
                  }
                  const next = [...worldviews, v]
                  setWorldviews(next)
                  setWorldview(v)
                  setNewWorldview('')
                }}
              >
                添加世界观
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {worldviews.map((wv, idx) => (
                <div key={wv} className="flex items-center gap-2 rounded border border-indigo-200 bg-white px-2 py-1">
                  {editingKey === wv ? (
                    <>
                      <input
                        type="text"
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        className="rounded border border-indigo-200 px-2 py-1 text-[11px] text-gray-800"
                      />
                      <button
                        type="button"
                        className="rounded border border-green-300 px-2 py-1 text-[11px] text-green-700 hover:bg-white"
                        onClick={() => {
                          const v = editingText.trim()
                          if (!v) { setEditingKey(null); setEditingText(''); return }
                          const dup = worldviews.some((x, i) => i !== idx && x === v)
                          if (dup) { setEditingKey(null); setEditingText(''); setWorldview(v); return }
                          const next = [...worldviews]
                          const wasSelected = worldview === next[idx]
                          next[idx] = v
                          setWorldviews(next)
                          if (wasSelected) setWorldview(v)
                          setEditingKey(null)
                          setEditingText('')
                        }}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                        onClick={() => { setEditingKey(null); setEditingText('') }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-[11px] ${worldview === wv ? 'bg-indigo-600 text-white' : 'border border-indigo-300 text-indigo-700 hover:bg-white'}`}
                        onClick={() => setWorldview(wv)}
                        title="选择此世界观"
                      >
                        {wv}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
                        onClick={() => { setEditingKey(wv); setEditingText(wv) }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-white"
                        onClick={() => {
                          const next = worldviews.filter((_, i) => i !== idx)
                          setWorldviews(next)
                          if (worldview === wv) {
                            setWorldview(next[0] ?? '赛博朋克')
                          }
                          fetch('/api/worldview-settings', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: wv })
                          }).catch(() => {})
                        }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          {worldviewError && <p className="text-xs text-red-600">{worldviewError}</p>}
          {worldviewResult ? (
            <textarea
              value={worldviewResult}
              readOnly
              className="h-32 w-full rounded-md border border-indigo-200 px-3 py-2 text-xs font-mono bg-white"
            />
          ) : (
            <p className="text-xs text-indigo-700">选择世界观并填写“核心设定/关键元素/参考案例”，点击“应用世界观并改写为CSV”。输出为CSV文本。</p>
          )}
        </div>

      {/* 历史模块：在回填不完整时显示（可折叠） */}
      {showHistoryModule && (
        <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-yellow-800">历史记录未能完全映射到分镜，以下为从数据库读取的所有历史图片与视频（提示词可复制）</p>
              <p className="text-xs text-yellow-700">{historyImages.length} 张图片 · {historyVideos.length} 个视频</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-yellow-800">图片比例</span>
                <div className="inline-flex overflow-hidden rounded border border-yellow-300">
                  <button
                    type="button"
                    className={`px-2 py-1 text-xs ${historyAspect === '9:16' ? 'bg-yellow-200 text-yellow-900' : 'text-yellow-800 hover:bg-yellow-100'}`}
                    onClick={() => setHistoryAspect('9:16')}
                  >
                    9:16
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-1 text-xs ${historyAspect === '16:9' ? 'bg-yellow-200 text-yellow-900' : 'text-yellow-800 hover:bg-yellow-100'}`}
                    onClick={() => setHistoryAspect('16:9')}
                  >
                    16:9
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
                className="rounded-md border border-yellow-300 px-3 py-1 text-xs text-yellow-800 hover:bg-yellow-100"
              >
                {isHistoryCollapsed ? '展开' : '折叠'}
              </button>
            </div>
          </div>
          {!isHistoryCollapsed && (
            <div className="mt-3 space-y-4">
              {historyImages.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700">历史图片</h4>
                  {/* 历史图片补充：粘贴/URL 添加与本地上传 */}
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault()
                      try {
                        const targetScriptId = selectedExistingScriptId || scriptId
                        if (!targetScriptId) {
                          setStatus({ type: 'error', text: '请先选择或创建脚本，再补充历史图片。' })
                          return
                        }
                        const url = newHistoryUrl.trim()
                        const isValidUrl = /^https?:\/\/\S+/.test(url) || /^data:image\//i.test(url)
                        if (!isValidUrl) {
                          setStatus({ type: 'error', text: '请输入有效的图片 URL（http/https 或 data:image）。' })
                          return
                        }
                        const prompt = (newHistoryPrompt || '').trim() || 'Manual upload'
                        const shotNumber = (newHistoryShotNumber || '').trim() ? Number(newHistoryShotNumber) : undefined
                        setIsAddingHistory(true)
                        const image = await createGeneratedImage(targetScriptId, prompt, url, shotNumber)
                        setHistoryImages(prev => [image, ...prev])
                        setNewHistoryUrl('')
                        setNewHistoryPrompt('')
                        setNewHistoryShotNumber('')
                        setStatus({ type: 'success', text: '已添加到历史图片。' })
                      } catch (err) {
                        console.error('Failed to add history image', err)
                        setStatus({ type: 'error', text: '添加历史图片失败。' })
                      } finally {
                        setIsAddingHistory(false)
                      }
                    }}
                    className="mt-2 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto]"
                  >
                    <input
                      type="url"
                      value={newHistoryUrl}
                      onChange={e => setNewHistoryUrl(e.target.value)}
                      onPaste={async (event) => {
                        try {
                          const targetScriptId = selectedExistingScriptId || scriptId
                          if (!targetScriptId) return
                          const dt = event.clipboardData
                          if (!dt) return
                          // 优先处理剪贴板中的图片文件
                          const items = Array.from(dt.items || [])
                          for (const it of items) {
                            if (it.kind === 'file' && it.type?.startsWith('image/')) {
                              const file = it.getAsFile()
                              if (file) {
                                event.preventDefault()
                                const dataUrl = await fileToDataUrl(file)
                                const prompt = (newHistoryPrompt || '').trim() || 'Manual upload'
                                const shotNumber = (newHistoryShotNumber || '').trim() ? Number(newHistoryShotNumber) : undefined
                                const image = await createGeneratedImage(targetScriptId, prompt, dataUrl, shotNumber)
                                setHistoryImages(prev => [image, ...prev])
                                setNewHistoryUrl('')
                                setNewHistoryPrompt('')
                                setNewHistoryShotNumber('')
                                setStatus({ type: 'success', text: '已从剪贴板图片添加到历史。' })
                                return
                              }
                            }
                          }
                          // 退化为文本 URL（http/https 或 data:image）
                          const text = dt.getData('text')?.trim()
                          if (text && (/^https?:\/\/\S+/.test(text) || /^data:image\//i.test(text))) {
                            event.preventDefault()
                            const prompt = (newHistoryPrompt || '').trim() || 'Manual upload'
                            const shotNumber = (newHistoryShotNumber || '').trim() ? Number(newHistoryShotNumber) : undefined
                            const image = await createGeneratedImage(targetScriptId, prompt, text, shotNumber)
                            setHistoryImages(prev => [image, ...prev])
                            setNewHistoryUrl('')
                            setNewHistoryPrompt('')
                            setNewHistoryShotNumber('')
                            setStatus({ type: 'success', text: '已从剪贴板文本添加到历史。' })
                            return
                          }
                        } catch (err: any) {
                          console.error('处理剪贴板失败', err)
                          setStatus({ type: 'error', text: err?.message || '处理剪贴板失败' })
                        }
                      }}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="粘贴历史图片 URL 或剪贴板图片"
                    />
                    <input
                      type="text"
                      value={newHistoryPrompt}
                      onChange={e => setNewHistoryPrompt(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="提示词（可选）"
                    />
                    <input
                      type="number"
                      value={newHistoryShotNumber}
                      onChange={e => setNewHistoryShotNumber(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="镜头号（可选）"
                    />
                    <button
                      type="submit"
                      disabled={isAddingHistory}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isAddingHistory ? 'Adding…' : '添加到历史'}
                    </button>
                  </form>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const file = newHistoryFile
                      try {
                        const targetScriptId = selectedExistingScriptId || scriptId
                        if (!targetScriptId) {
                          setStatus({ type: 'error', text: '请先选择或创建脚本，再上传历史图片。' })
                          return
                        }
                        if (!file) {
                          setStatus({ type: 'error', text: '请选择要上传的图片文件。' })
                          return
                        }
                        setIsUploadingHistory(true)
                        let finalUrl: string | null = null
                        let usedDataUrlFallback = false
                        if (!isDemoMode && (supabase as any)?.storage) {
                          try {
                            const ext = (file.name.split('.').pop() || 'png').toLowerCase()
                            const path = `generated-images/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
                            const { error: uploadError } = await supabase.storage
                              .from('generated-images')
                              .upload(path, file, { upsert: false, contentType: file.type || `image/${ext}` })
                            if (uploadError) {
                              throw uploadError
                            }
                            const { data: publicData } = supabase.storage.from('generated-images').getPublicUrl(path)
                            finalUrl = publicData?.publicUrl || null
                          } catch (err) {
                            console.warn('Supabase Storage upload failed (bucket missing?), falling back to Data URL.', err)
                          }
                        }
                        if (!finalUrl) {
                          finalUrl = await fileToDataUrl(file)
                          usedDataUrlFallback = true
                        }
                        const shotNumber = (newHistoryShotNumber || '').trim() ? Number(newHistoryShotNumber) : undefined
                        const prompt = (newHistoryPrompt || '').trim() || 'Manual upload'
                        const image = await createGeneratedImage(targetScriptId, prompt, finalUrl!, shotNumber)
                        setHistoryImages(prev => [image, ...prev])
                        setNewHistoryFile(null)
                        setNewHistoryPrompt('')
                        setNewHistoryShotNumber('')
                        setNewHistoryUrl('')
                        setStatus({ type: 'success', text: usedDataUrlFallback ? '历史图片已上传（使用本地 Data URL）。' : '历史图片已上传。' })
                      } catch (error) {
                        console.error('Failed to upload history image', error)
                        setStatus({ type: 'error', text: '上传历史图片失败。' })
                      } finally {
                        setIsUploadingHistory(false)
                      }
                    }}
                    className="mt-2 flex items-center gap-2"
                  >
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => setNewHistoryFile(e.target.files?.[0] || null)}
                      className="text-xs"
                    />
                    <button
                      type="submit"
                      disabled={isUploadingHistory}
                      className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUploadingHistory ? 'Uploading…' : '上传本地图片'}
                    </button>
                  </form>
                  <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
                    {historyImages.map(img => (
                      <div key={img.id} className={`rounded border p-1 ${selectedHistoryIds.includes(img.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                        <div
                          className="relative w-full overflow-hidden rounded bg-gray-100"
                          style={{ paddingTop: historyAspect === '9:16' ? '177.78%' : '56.25%' }}
                        >
                          <div className="absolute left-1 top-1 z-10">
                            <input
                              type="checkbox"
                              checked={selectedHistoryIds.includes(img.id)}
                              onChange={() => toggleHistorySelection(img.id)}
                              className="h-3 w-3 accent-blue-600"
                              title="选择图片"
                              aria-label="选择历史图片"
                            />
                          </div>
                          <img
                            src={img.image_url}
                            alt={img.prompt || 'generated image'}
                            className="absolute inset-0 h-full w-full cursor-zoom-in object-cover"
                            onClick={() => setImagePreview({ url: img.image_url, alt: img.prompt || 'generated image' })}
                            loading="lazy"
                          />
                        </div>
                        <div className="mt-2 flex items-start justify-between gap-2">
                          <p className="flex-1 truncate text-xs text-gray-600" title={img.prompt}>{img.prompt}</p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="whitespace-nowrap rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                              onClick={() => handleCopy(img.prompt || '')}
                            >
                              复制
                            </button>
                            <button
                              type="button"
                              className="whitespace-nowrap rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                              onClick={() => {
                                const ext = extractFileExtension(img.image_url) || 'jpg'
                                const base = slugify(img.prompt || 'image')
                                const name = `${projectSlug || 'storyboard'}-history-${base}.${ext}`
                                downloadImage(img.image_url, name)
                              }}
                              title="下载图片"
                              aria-label="下载历史图片"
                            >
                              下载
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            value={editingHistoryShot[img.id] ?? (typeof img.shot_number === 'number' ? String(img.shot_number) : '')}
                            onChange={e => setEditingHistoryShot(prev => ({ ...prev, [img.id]: e.target.value }))}
                            className="w-20 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="镜头号"
                            aria-label="镜头号"
                          />
                          <button
                            type="button"
                            className="rounded border border-blue-600 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleUpdateHistoryShot(img)}
                            disabled={!!updatingHistoryShot[img.id]}
                          >
                            {updatingHistoryShot[img.id] ? '保存中…' : '设置镜头号'}
                          </button>
                          {typeof img.shot_number === 'number' && (
                            <span className="text-[11px] text-gray-500">当前：{img.shot_number}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {historyVideos.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700">历史视频</h4>
                  <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
                    {historyVideos.map(v => (
                      <div key={v.id} className="rounded border border-gray-200 p-1">
                        <div
                          className="relative w-full overflow-hidden rounded bg-gray-100"
                          style={{ paddingTop: historyAspect === '9:16' ? '177.78%' : '56.25%' }}
                        >
                          {v.video_url ? (
                            <video
                              src={v.video_url}
                              controls
                              playsInline
                              className="absolute inset-0 h-full w-full rounded object-cover"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">暂无视频链接（状态：{v.status}）</div>
                          )}
                        </div>
                        <div className="mt-2 flex items-start justify-between gap-2">
                          <p className="flex-1 truncate text-xs text-gray-600" title={v.prompt}>{v.prompt}</p>
                          <button
                            type="button"
                            className="whitespace-nowrap rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                            onClick={() => handleCopy(v.prompt || '')}
                          >
                            复制
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </section>

      <div ref={step2SentinelRef} aria-hidden />
 
        <section ref={step2SectionRef} className={`rounded-lg border border-gray-200 bg-white p-6 shadow-sm`}>
         <div className="flex items-center justify-between">
           <h2 id="step-2" className="text-lg font-semibold text-gray-900">Step 2 - Preview shots</h2>
           {hasSegments && <span className="text-xs text-gray-500">{segments.length} shots</span>}
         </div>

        {/* Reference images（按顺序使用）已移至右侧悬浮面板 */}
        {hasSegments && (
          <div className="mt-4 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-medium text-gray-700">批量替换原始脚本文本（仅 textarea，分镜不变）</p>
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
              <p className="text-xs text-gray-500 md:col-span-1">不影响分镜预览文本，仅修改左侧原始脚本。</p>
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
                <div className="rounded-md bg-gray-50 p-3 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">
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
                        className="h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="可直接编辑文本"
                      />
                    </div>
                    <div>
                      <label htmlFor={`shot-characters-${segment.id}`} className="block text-xs font-medium text-gray-600">Characters（角色）</label>
                      <input
                        id={`shot-characters-${segment.id}`}
                        type="text"
                        value={segment.prompt?.subject?.characters_present ?? ''}
                        readOnly
                        disabled
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="单个镜头编辑已禁用"
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
                        className="max-h-56 w-full object-contain cursor-zoom-in"
                        onClick={() => setImagePreview({ url: imageRecord.url, alt: `Shot ${segment.shotNumber}` })}
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

                {/* 参考图目录区块 */}
                <div className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Folders</span>
                    <button
                      type="button"
                      onClick={loadMoreFolders}
                      disabled={isLoadingMoreFolders || !folderHasMore}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isLoadingMoreFolders ? 'Loading…' : folderHasMore ? 'Load more' : 'No more'}
                    </button>
                  </div>

                  {/* 新建目录 */}
                  <form onSubmit={handleAddFolder} className="flex gap-2">
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      placeholder="新建目录名称"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      新建目录
                    </button>
                  </form>

                  {/* 目录网格（放大样式并隐藏“未归类”） */}
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {folders.filter(f => f.label != null).map(folder => {
                      const isActive = (folder.label ?? null) === (selectedFolderLabel ?? null)
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          title={folder.name}
                          onClick={() => setSelectedFolderLabel(folder.label ?? null)}
                          onDragOver={e => {
                            e.preventDefault()
                          }}
                          onDrop={async e => {
                            e.preventDefault()
                            const refId = e.dataTransfer.getData('ref-id')
                            if (!refId) return
                            try {
                              let updated: ReferenceImage | null = null
                              if (folder.label) {
                                // 添加标签到目标目录，实现多目录归属
                                updated = await addReferenceImageLabel(refId, folder.label)
                                setStatus({ type: 'success', text: '已添加标签到目录。' })
                              } else {
                                // 未归类：从当前目录移除标签（如果当前视图是具体目录）
                                if (selectedFolderLabel) {
                                  updated = await removeReferenceImageLabel(refId, selectedFolderLabel)
                                  setStatus({ type: 'success', text: '已从当前目录移除标签。' })
                                } else {
                                  setStatus({ type: 'info', text: '已在未归类目录，无需变更。' })
                                }
                              }
                              if (updated) {
                                setReferenceImages(prev => {
                                  const lbl = selectedFolderLabel ?? null
                                  const labels = Array.from(new Set([updated!.label, ...(updated!.labels ?? [])].filter(Boolean)))
                                  const stillMatches = lbl === null
                                    ? !((updated!.labels && updated!.labels.length > 0) || Boolean(updated!.label))
                                    : labels.includes(lbl)
                                  const exists = prev.some(it => it.id === refId)
                                  const next = exists
                                    ? prev.map(it => (it.id === refId ? updated! : it))
                                    : [updated!, ...prev]
                                  return stillMatches ? next : prev.filter(it => it.id !== refId)
                                })
                              }
                            } catch (err: any) {
                              console.error('拖拽归类失败', err)
                              setStatus({ type: 'error', text: err?.message || '拖拽归类失败' })
                            }
                          }}
                          className={`group flex items-center gap-3 rounded border px-3 py-3 text-left text-sm transition ${
                            isActive ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <span className="h-10 w-10 overflow-hidden rounded bg-gray-100" title={folder.name}>
                            {folder.cover_url ? (
                              <img
                                src={folder.cover_url}
                                alt={folder.name}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={e => {
                                  const img = e.currentTarget as HTMLImageElement
                                  img.src = '/file.svg'
                                  img.classList.remove('object-cover')
                                  img.classList.add('object-contain')
                                }}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <img src="/file.svg" alt="folder" className="h-full w-full object-contain" />
                            )}
                          </span>
                          {editingFolderId === folder.id ? (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault()
                                const nextName = editingFolderName.trim()
                                if (!nextName || nextName === folder.name) {
                                  setEditingFolderId(null)
                                  return
                                }
                                try {
                                  await renameReferenceFolder(folder.name, nextName)
                                  // 若重命名的是当前选中目录，更新选中标签
                                  setSelectedFolderLabel(prev => (prev === (folder.name ?? null) ? nextName : prev))
                                  await reloadFolders()
                                  setEditingFolderId(null)
                                  setStatus({ type: 'success', text: '目录已重命名。' })
                                } catch (err: any) {
                                  console.error('重命名目录失败', err)
                                  setStatus({ type: 'error', text: err?.message || '重命名目录失败' })
                                }
                              }}
                              className="flex-1"
                            >
                              <input
                                type="text"
                                value={editingFolderName}
                                onChange={(e) => setEditingFolderName(e.target.value)}
                                onBlur={async () => {
                                  const nextName = editingFolderName.trim()
                                  if (!nextName || nextName === folder.name) {
                                    setEditingFolderId(null)
                                    return
                                  }
                                  try {
                                    await renameReferenceFolder(folder.name, nextName)
                                    setSelectedFolderLabel(prev => (prev === (folder.name ?? null) ? nextName : prev))
                                    await reloadFolders()
                                    setEditingFolderId(null)
                                    setStatus({ type: 'success', text: '目录已重命名。' })
                                  } catch (err: any) {
                                    console.error('重命名目录失败', err)
                                    setStatus({ type: 'error', text: err?.message || '重命名目录失败' })
                                  }
                                }}
                                className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs"
                                autoFocus
                              />
                            </form>
                          ) : (
                            <span className="flex-1 truncate">{folder.name}</span>
                          )}
                          {typeof folder.count === 'number' && (
                            <span className="rounded bg-gray-100 px-2 text-xs text-gray-600">{folder.count}</span>
                          )}
                          {folder.label != null && (
                            <span
                              role="button"
                              tabIndex={0}
                              title="删除目录"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  await deleteReferenceFolder(folder.name)
                                  setSelectedFolderLabel(prev => {
                                    if (prev === (folder.name ?? null)) {
                                      const next = folders.filter(f => f.label != null && f.label !== folder.label)[0]?.label ?? null
                                      return next
                                    }
                                    return prev
                                  })
                                  await reloadFolders()
                                  setStatus({ type: 'success', text: '目录已删除。' })
                                } catch (err: any) {
                                  console.error('删除目录失败', err)
                                  setStatus({ type: 'error', text: err?.message || '删除目录失败' })
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  ;(e.currentTarget as HTMLElement).click()
                                }
                              }}
                              className="ml-1 cursor-pointer rounded border border-red-300 px-1 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                            >
                              删除
                            </span>
                          )}
                          {folder.label != null && editingFolderId !== folder.id && (
                            <span
                              role="button"
                              tabIndex={0}
                              title="重命名目录"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingFolderId(folder.id)
                                setEditingFolderName(folder.name)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  ;(e.currentTarget as HTMLElement).click()
                                }
                              }}
                              className="ml-1 cursor-pointer rounded border border-gray-300 px-1 py-0.5 text-[10px] text-gray-700 hover:bg-gray-100"
                            >
                              重命名
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              <form onSubmit={handleAddReferenceImage} className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <input
                  type="url"
                  required
                  value={newReferenceUrl}
                  onChange={event => setNewReferenceUrl(event.target.value)}
                  onPaste={async (event) => {
                    try {
                      const dt = event.clipboardData
                      if (!dt) return
                      // 优先处理剪贴板中的图片文件
                      const items = Array.from(dt.items || [])
                      for (const it of items) {
                        if (it.kind === 'file' && it.type?.startsWith('image/')) {
                          const file = it.getAsFile()
                          if (file) {
                            event.preventDefault()
                            const dataUrl = await fileToDataUrl(file)
                            const effectiveLabel = (selectedFolderLabel && selectedFolderLabel !== '__none__')
                              ? selectedFolderLabel
                              : (newReferenceLabel.trim() || undefined)
                            const image = await addReferenceImage(dataUrl, effectiveLabel)
                            setReferenceImages(prev => [image, ...prev])
                            setSelectedReferenceIds(prev => [image.id, ...prev])
                            setAllRefImages(prev => [image, ...(prev || [])])
                            setNewReferenceUrl('')
                            setNewReferenceLabel('')
                            await reloadFolders()
                            setStatus({ type: 'success', text: '已从剪贴板图片添加参考图。' })
                            return
                          }
                        }
                      }
                      // 退化为文本 URL（http/https 或 data:image）
                      const text = dt.getData('text')?.trim()
                      if (text && (/^https?:\/\/\S+/.test(text) || /^data:image\//i.test(text))) {
                        event.preventDefault()
                        const effectiveLabel = (selectedFolderLabel && selectedFolderLabel !== '__none__')
                          ? selectedFolderLabel
                          : (newReferenceLabel.trim() || undefined)
                        const image = await addReferenceImage(text, effectiveLabel)
                        setReferenceImages(prev => [image, ...prev])
                        setSelectedReferenceIds(prev => [image.id, ...prev])
                        setAllRefImages(prev => [image, ...(prev || [])])
                        setNewReferenceUrl('')
                        setNewReferenceLabel('')
                        await reloadFolders()
                        setStatus({ type: 'success', text: '已从剪贴板文本添加参考图。' })
                        return
                      }
                    } catch (err: any) {
                      console.error('处理剪贴板失败', err)
                      setStatus({ type: 'error', text: err?.message || '处理剪贴板失败' })
                    }
                  }}
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
              <div
                className="flex flex-wrap gap-2"
                onDragOver={e => {
                  // 允许拖拽悬停到目录视图容器
                  e.preventDefault()
                }}
                onDrop={async e => {
                  e.preventDefault()
                  const refId = e.dataTransfer.getData('ref-id')
                  if (!refId) return
                  try {
                    const currentLabel = selectedFolderLabel ?? null
                    if (!currentLabel) {
                      setStatus({ type: 'info', text: '请先在左侧选择具体目录后再拖拽归类。' })
                      return
                    }
                    const updated = await addReferenceImageLabel(refId, currentLabel)
                    // 更新当前目录列表中的该图片状态，并确保仍在当前视图
                    setReferenceImages(prev => {
                      const labels = Array.from(new Set([updated.label, ...(updated.labels ?? [])].filter(Boolean)))
                      const stillMatches = labels.includes(currentLabel)
                      const exists = prev.some(it => it.id === refId)
                      const next = exists ? prev.map(it => (it.id === refId ? updated : it)) : [updated, ...prev]
                      return stillMatches ? next : prev.filter(it => it.id !== refId)
                    })
                    // 同步“参考图模块”列表状态
                    setAllRefImages(prev => (prev || []).map(it => (it.id === refId ? updated : it)))
                    setStatus({ type: 'success', text: '已归入当前目录。' })
                  } catch (err: any) {
                    console.error('目录视图拖拽归类失败', err)
                    setStatus({ type: 'error', text: err?.message || '拖拽归类失败' })
                  }
                }}
              >
                {referenceImages.length ? (
                  referenceImages.map(image => {
                    const isSelected = selectedReferenceIds.includes(image.id)
                    return (
                      <div
                        key={image.id}
                        className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                          isSelected ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                        }`}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('ref-id', image.id)
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleReferenceSelection(image.id)}
                          className="flex items-center gap-2"
                        >
                          <span className="h-8 w-8 overflow-hidden rounded bg-gray-100">
                            <img
                              src={image.url}
                              alt={image.label ?? 'Reference'}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={e => {
                                const img = e.currentTarget as HTMLImageElement
                                img.src = '/file.svg'
                                img.classList.remove('object-cover')
                                img.classList.add('object-contain')
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setRefZoomUrl(image.url)
                              }}
                              className="h-full w-full cursor-zoom-in object-cover"
                            />
                          </span>
                          {/* 不显示 URL/ID 文本，保持简洁，仅展示标签 */}
                          {(() => {
                            const labels = Array.from(new Set([image.label, ...(image.labels ?? [])].filter(Boolean)))
                            return labels.length ? (
                              <span className="flex flex-wrap gap-1">
                                {labels.map(l => (
                                  <span key={l} className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">{l}</span>
                                ))}
                              </span>
                            ) : null
                          })()}
                          <input
                            type="text"
                            defaultValue={image.label ?? ''}
                            placeholder="编辑分类"
                            onBlur={async (e) => {
                              const newLabel = e.currentTarget.value.trim()
                              if ((image.label ?? '') === newLabel) return
                              try {
                                const updated = await updateReferenceImageLabel(image.id, newLabel === '' ? null : newLabel)
                                setReferenceImages(prev => prev.map(it => it.id === image.id ? updated : it))
                                setStatus({ type: 'success', text: '参考图标签已更新' })
                              } catch (err: any) {
                                console.error('更新参考图标签失败', err)
                                setStatus({ type: 'error', text: err?.message || '更新参考图标签失败' })
                              }
                            }}
                            className="w-[160px] rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-700 focus:border-blue-400 focus:outline-none"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const currentLabel = selectedFolderLabel ?? null
                              let updated: ReferenceImage | null = null
                              if (currentLabel) {
                                // 先移除多标签数组中的当前目录标签
                                updated = await removeReferenceImageLabel(image.id, currentLabel)
                                // 若主标签等于当前目录，一并清空主标签
                                if (image.label === currentLabel) {
                                  updated = await updateReferenceImageLabel(image.id, null)
                                }
                              } else {
                                // 非目录视图兜底：清空主标签
                                updated = await updateReferenceImageLabel(image.id, null)
                              }
                              setReferenceImages(prev => prev.filter(it => it.id !== image.id))
                              setSelectedReferenceIds(prev => prev.filter(item => item !== image.id))
                              await reloadFolders()
                              setStatus({ type: 'success', text: '已移出目录。' })
                            } catch (err: any) {
                              console.error('移出目录失败', err)
                              setStatus({ type: 'error', text: err?.message || '移出目录失败' })
                            }
                          }}
                          className="rounded border border-transparent px-2 py-1 text-[11px] text-gray-500 hover:border-red-300 hover:text-red-600"
                        >
                          移出目录
                        </button>
                      </div>
                    )
                  })
                  ) : (
                  <p className="text-xs text-gray-500">No reference images yet.</p>
                )}
              </div>
              {/* 主参考图区域的“加载更多”按钮 */}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadMoreReferences}
                  disabled={!refHasMore || isLoadingMoreRefs}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoadingMoreRefs ? '加载中…' : '加载更多'}
                </button>
                {!refHasMore && referenceImages.length > 0 && (
                  <span className="text-[11px] text-gray-500">没有更多参考图</span>
                )}
              </div>
            </div>
            {/* 已移除：参考图模块（用于拖拽归类的最近列表）。当前只保留右侧目录视图与主参考图选择。 */}
            {doubaoSizeError && (
              <p className="text-xs text-red-600">{doubaoSizeError}</p>
            )}
          </div>

          {/* 已迁移到右侧悬浮容器，这里移除内联按钮 */}
        </div>

        
      </section>
      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="step-4" className="text-lg font-semibold text-gray-900">Step 4 - Submit Veo3 videos</h2>
            <p className="text-sm text-gray-500">Select the shots you want to convert to video. Unselected images will be downloaded using the project name.</p>
            <button
              type="button"
              className="mt-2 rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white"
              onClick={() => setIsStep4Collapsed(v => !v)}
              aria-expanded={!isStep4Collapsed}
              title={isStep4Collapsed ? '展开' : '收起'}
            >
              {isStep4Collapsed ? '展开' : '收起'}
            </button>
          </div>
          <div className={`flex flex-wrap items-center gap-3 text-sm text-gray-600 ${isStep4Collapsed ? 'hidden' : ''}`}>
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
              className="rounded-md border border-green-300 px-3 py-1 text-sm font-medium text-green-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!scriptId || segments.length === 0}
              title="保存当前 Step 4 的 Video Prompt 到 MongoDB"
              onClick={async () => {
                try {
                  if (!scriptId) {
                    setStatus({ type: 'info', text: '请先选择或创建脚本。' })
                    return
                  }
                  if (!segments.length) {
                    setStatus({ type: 'info', text: '请先在 Step 1 解析分镜脚本。' })
                    return
                  }
                  const payload: Array<{ shot_number: number; text: string }> = []
                  segments.forEach((seg, i) => {
                    const text = (videoPromptOverrides[seg.id] || '').trim()
                    if (text) payload.push({ shot_number: seg.shotNumber || i + 1, text })
                  })
                  if (!payload.length) {
                    setStatus({ type: 'info', text: '当前没有可保存的 Video Prompt。' })
                    return
                  }
                  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : ''
                  const res = await fetch(`${baseOrigin}/api/video-prompts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ script_id: scriptId, prompts: payload })
                  })
                  if (!res.ok) {
                    const err = await res.json().catch(() => null)
                    console.error('保存 Video Prompt 失败', err)
                    setStatus({ type: 'error', text: '保存 Video Prompt 失败。' })
                    return
                  }
                  setStatus({ type: 'success', text: `已保存 ${payload.length} 条 Video Prompt 到 MongoDB。` })
                } catch (e) {
                  console.error('保存 Video Prompt 异常', e)
                  setStatus({ type: 'error', text: '保存 Video Prompt 异常。' })
                }
              }}
            >
              保存当前 Video Prompt
            </button>
            <button
              type="button"
              onClick={handleSubmitVideos}
              disabled={isSubmittingVideo || !hasVideoSelection}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingVideo ? 'Submitting...' : `Submit Veo3 (${selectedForVideo.length})`}
            </button>
          </div>
        </div>

        {/* 新增：Veo3 区域的批量替换控件 */}
         <div className={`mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 ${isStep4Collapsed ? 'hidden' : ''}`}>
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
         <div className={`mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${isStep4Collapsed ? 'hidden' : ''}`}>
           {segments.map(segment => {
            const image = imageResults[segment.id]
            const job = videoJobs[segment.id]
            const geminiText = (segment.promptText || '').trim()
            const actionOnly = extractActionText(segment, image?.prompt)
            const actionLabel = actionOnly ? `动作：${actionOnly}` : ''
            const promptFallback = geminiText || actionLabel || image?.prompt || formatPromptForModel(segment)
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

                {/* 已移除：豆包视频按钮与图片操作按钮；保留点击图片预览 */}

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
                    <label htmlFor={`shot-text-${segment.id}`} className="block text-sm font-medium text-gray-600">Shot text (JSON)</label>
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
// （已修复）此前误将 hook 放在组件外部导致错误，现已移除

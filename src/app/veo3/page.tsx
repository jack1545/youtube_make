'use client'

import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import Link from 'next/link'

interface SubmissionItem {
  id: string
  prompt: string
  images: string[] // up to 2
  aspectRatio: '16:9' | '9:16'
  status?: 'idle' | 'submitting' | 'submitted' | 'error' | 'done'
  jobId?: string
  videoUrl?: string
  errorMsg?: string
  manualQueryReady?: boolean
}

export default function Veo3SubmitPage() {
  const [items, setItems] = useState<SubmissionItem[]>(() => [{
    id: `${Date.now()}`,
    prompt: '',
    images: [],
    aspectRatio: '9:16',
    status: 'idle'
  }])

  // 全局提交控制（参考 Submit Veo3 videos 模块）
  const [globalModel, setGlobalModel] = useState<'veo3-fast' | 'veo3' | 'veo3-pro' | 'veo3-fast-frames'>('veo3-fast-frames')
  const [globalAspectRatio, setGlobalAspectRatio] = useState<'16:9' | '9:16'>('9:16')
  const [autoTranslatePrompt, setAutoTranslatePrompt] = useState(true)
  const [enableUpsample, setEnableUpsample] = useState(false)
  const [useImageAsFirstFrame, setUseImageAsFirstFrame] = useState(true)
  // 预览播放器（仅用于“提交项 #1”）尺寸，按视频原始尺寸等比缩小
  const firstVideoRef = useRef<HTMLVideoElement | null>(null)
  const [firstVideoSize, setFirstVideoSize] = useState<{ w: number; h: number } | null>(null)
  // 新增：页面 Tab 与历史视频状态
  const [activeTab, setActiveTab] = useState<'submit' | 'history'>('submit')
  const [historyVideos, setHistoryVideos] = useState<Array<{ id: string; prompt: string; video_url: string; status: string; created_at: string }>>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  
  async function loadHistoryVideos() {
    try {
      setHistoryLoading(true)
      setHistoryError(null)
      const res = await fetch('/api/history/videos')
      const data = await res.json()
      setHistoryVideos(data?.videos || [])
    } catch (err: any) {
      setHistoryError(err?.message || '加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  const addItem = () => {
    setItems(prev => ([...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      prompt: '',
      images: [],
      aspectRatio: '9:16',
      status: 'idle'
    }]))
  }

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const updateItem = (
    id: string,
    patch: Partial<SubmissionItem> | ((current: SubmissionItem) => Partial<SubmissionItem>)
  ) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i
      const computed = typeof patch === 'function' ? (patch as (cur: SubmissionItem) => Partial<SubmissionItem>)(i) : patch
      return { ...i, ...computed }
    }))
  }

  const handleUpload = async (id: string, which: 'first' | 'last', file: File) => {
    try {
      const form = new FormData()
      form.append(which, file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`上传失败：${res.status} ${errText}`)
      }
      const data = await res.json()
      const url: string | undefined = data?.urls?.[which]
      if (!url) throw new Error('未返回公开URL，请检查上传接口配置。')

      updateItem(id, (current: SubmissionItem) => {
        const imgs = Array.isArray(current.images) ? current.images.slice() : []
        const index = which === 'first' ? 0 : 1
        imgs[index] = url
        return { images: imgs }
      })
    } catch (err: any) {
      updateItem(id, { status: 'error', errorMsg: err?.message || '上传失败' })
    }
  }

  const handleImageUrlInput = (id: string, which: 'first' | 'last', url: string) => {
    updateItem(id, (current: SubmissionItem) => {
      const imgs = Array.isArray(current.images) ? current.images.slice() : []
      const index = which === 'first' ? 0 : 1
      imgs[index] = url
      return { images: imgs }
    })
  }

  // 处理在 URL 输入框中直接粘贴图片（文件或URL）
  const handlePasteImage = (id: string, which: 'first' | 'last') => async (e: ClipboardEvent<HTMLInputElement>) => {
    try {
      const dt = e.clipboardData
      if (!dt) return

      // 优先处理剪贴板中的图片文件
      const items = Array.from(dt.items || [])
      for (const it of items) {
        if (it.kind === 'file' && it.type?.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            await handleUpload(id, which, file)
            return
          }
        }
      }

      // 退化为文本URL
      const text = dt.getData('text')?.trim()
      if (text && /^https?:\/\/\S+/.test(text)) {
        e.preventDefault()
        handleImageUrlInput(id, which, text)
        return
      }
    } catch (err: any) {
      updateItem(id, { status: 'error', errorMsg: err?.message || '粘贴处理失败' })
    }
  }

  const submitOne = async (item: SubmissionItem) => {
    try {
      updateItem(item.id, { status: 'submitting' })
      const rawImages = item.images.filter(Boolean).slice(0, 2)
      const isFramesModel = globalModel.endsWith('-frames')
      const imagesForSubmit = isFramesModel && useImageAsFirstFrame ? rawImages : []
      if (isFramesModel && useImageAsFirstFrame && imagesForSubmit.length < 1) {
        throw new Error('选择了 frames 模型，至少需要提供一张图片作为关键帧。')
      }
      const res = await fetch('/api/veo3/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: item.prompt,
          options: {
            model: globalModel,
            images: imagesForSubmit,
            aspectRatio: item.aspectRatio || globalAspectRatio,
            enhancePrompt: autoTranslatePrompt,
            enableUpsample
          }
        })
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`提交失败：${res.status} ${errText}`)
      }
      const data = await res.json()
      const jobId: string = data?.id
      updateItem(item.id, { status: 'submitted', jobId })
      // 30 秒后自动查询一次
      setTimeout(async () => {
        const ok = await pollDetail(item.id, jobId)
        if (!ok) {
          updateItem(item.id, { status: 'error', errorMsg: '自动查询失败，请点击手动查询', manualQueryReady: true })
        }
      }, 30000)
    } catch (err: any) {
      updateItem(item.id, { status: 'error', errorMsg: err?.message || '提交失败' })
    }
  }

  const manualQuery = async (item: SubmissionItem) => {
    if (!item.jobId) return
    const ok = await pollDetail(item.id, item.jobId)
    if (!ok) {
      updateItem(item.id, { status: 'error', errorMsg: '仍未生成，请稍后重试', manualQueryReady: true })
    }
  }

  const pollDetail = async (id: string, jobId: string) => {
    try {
      const res = await fetch(`/api/veo3/detail?id=${encodeURIComponent(jobId)}`)
      if (!res.ok) return false
      const data = await res.json()
      const url: string | undefined = data?.video_url
      if (url) {
        updateItem(id, { status: 'done', videoUrl: url })
        return true
      }
      return false
    } catch {
      return false
    }
  }

  useEffect(() => {
    // 已禁用轮询：提交后将在 30 秒后自动查询一次。
  }, [])

  useEffect(() => {
    // 当首个提交项的视频地址变化时，重置预览尺寸，等待 metadata 重新计算
    setFirstVideoSize(null)
  }, [items[0]?.videoUrl])

  useEffect(() => {
    if (activeTab === 'history' && historyVideos.length === 0 && !historyLoading && !historyError) {
      void loadHistoryVideos()
    }
  }, [activeTab])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Veo3 独立提交页</h1>
          <p className="mt-1 text-sm text-gray-600">支持上传2张图片（首尾帧），支持添加多个提交项。</p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">返回首页</Link>
      </div>

      {/* Tab 切换 */}
      <div className="mt-4">
        <div className="inline-flex rounded-md shadow-sm border">
          <button
            type="button"
            onClick={() => setActiveTab('submit')}
            className={`px-3 py-1 text-sm ${activeTab === 'submit' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >提交</button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 text-sm border-l ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >历史视频</button>
        </div>
      </div>

      {/* 历史视频：当历史 tab 选中时显示 */}
      {activeTab === 'history' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">历史生成视频</h2>
            <button
              type="button"
              onClick={() => void loadHistoryVideos()}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >刷新</button>
          </div>
          {historyLoading ? (
            <p className="mt-2 text-sm text-gray-600">加载中…</p>
          ) : historyError ? (
            <p className="mt-2 text-sm text-red-600">加载失败：{historyError}</p>
          ) : historyVideos.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">暂无历史视频</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {historyVideos.map(v => (
                <li key={v.id} className="flex items-start justify-between rounded border p-3 hover:bg-gray-50">
                  <div className="min-w-0 pr-4">
                    <p className="text-sm text-gray-800 truncate">{v.prompt}</p>
                    <p className="text-xs text-gray-500 mt-1">状态：{v.status} · {new Date(v.created_at).toLocaleString()}</p>
                  </div>
                  {v.video_url ? (
                    <div className="shrink-0 text-right">
                      <div className="w-60 h-60 rounded-md border border-gray-200 bg-black overflow-hidden flex items-center justify-center ml-auto">
                        <video
                          src={v.video_url}
                          controls
                          preload="metadata"
                          playsInline
                          className="max-w-full max-h-full"
                        />
                      </div>
                      <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-blue-600 hover:underline">打开链接</a>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-gray-400">无链接</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* 提交区：当历史 tab 选中时隐藏 */}
      <div className={activeTab === 'history' ? 'hidden' : ''}>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold">Step 4 - Submit Veo3 videos</h2>
        <p className="mt-1 text-sm text-gray-600">选择模型与参数，未选择的图片将按项目名下载。</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Model</label>
            <select
              value={globalModel}
              onChange={e => setGlobalModel(e.target.value as typeof globalModel)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="veo3-fast">veo3-fast</option>
              <option value="veo3">veo3</option>
              <option value="veo3-pro">veo3-pro</option>
              <option value="veo3-fast-frames">veo3-fast-frames</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Aspect ratio</label>
            <select
              value={globalAspectRatio}
              onChange={e => setGlobalAspectRatio(e.target.value as '16:9' | '9:16')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input id="auto-translate" type="checkbox" className="h-4 w-4" checked={autoTranslatePrompt} onChange={e => setAutoTranslatePrompt(e.target.checked)} />
            <label htmlFor="auto-translate" className="text-sm text-gray-700">Auto translate prompt</label>
          </div>
          <div className="flex items-center gap-2">
            <input id="enable-upsample" type="checkbox" className="h-4 w-4" checked={enableUpsample} onChange={e => setEnableUpsample(e.target.checked)} />
            <label htmlFor="enable-upsample" className="text-sm text-gray-700">Enable upsample</label>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input id="use-first-frame" type="checkbox" className="h-4 w-4" checked={useImageAsFirstFrame} onChange={e => setUseImageAsFirstFrame(e.target.checked)} />
          <label htmlFor="use-first-frame" className="text-sm text-gray-700">Use image as first frame</label>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={addItem}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
        >添加提交项</button>
      </div>

      <div className="space-y-6">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <h2 className="text-base font-semibold">提交项 #{index + 1}</h2>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >删除</button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">提示词</label>
                <textarea
                  value={item.prompt}
                  onChange={e => updateItem(item.id, { prompt: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  rows={3}
                  placeholder="请输入提示词"
                />
              </div>
              <div>
                <label className="block textsm font-medium text-gray-700">纵横比（单项覆盖）</label>
                <select
                  value={item.aspectRatio}
                  onChange={e => updateItem(item.id, { aspectRatio: e.target.value as SubmissionItem['aspectRatio'] })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">首帧</label>
                <div className="mt-1 flex items-center gap-3">
                  <input type="file" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void handleUpload(item.id, 'first', f)
                  }} />
                  <input
                    type="url"
                    value={item.images[0] || ''}
                    onChange={e => handleImageUrlInput(item.id, 'first', e.target.value)}
                    onPaste={handlePasteImage(item.id, 'first')}
                    placeholder="或粘贴图片URL"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                {item.images[0] && (
                  <img src={item.images[0]} alt="first" className="mt-2 h-24 w-24 rounded object-cover border" />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">尾帧</label>
                <div className="mt-1 flex items-center gap-3">
                  <input type="file" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void handleUpload(item.id, 'last', f)
                  }} />
                  <input
                    type="url"
                    value={item.images[1] || ''}
                    onChange={e => handleImageUrlInput(item.id, 'last', e.target.value)}
                    onPaste={handlePasteImage(item.id, 'last')}
                    placeholder="或粘贴图片URL"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                {item.images[1] && (
                  <img src={item.images[1]} alt="last" className="mt-2 h-24 w-24 rounded object-cover border" />
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {item.status === 'error' && <span className="text-red-600">错误：{item.errorMsg}</span>}
                {item.status === 'submitted' && <span>任务已提交，将在 30 秒后自动查询一次…</span>}
                {item.status === 'done' && item.videoUrl && (
                  <div className="space-y-2">
                    <span>
                      已生成：<a href={item.videoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">查看视频链接 ↗</a>
                    </span>
                    {index === 0 && (
                      <video
                        ref={firstVideoRef}
                        src={item.videoUrl}
                        controls
                        preload="metadata"
                        width={firstVideoSize?.w || undefined}
                        height={firstVideoSize?.h || undefined}
                        onLoadedMetadata={e => {
                          const v = e.currentTarget
                          const vw = v.videoWidth || 0
                          const vh = v.videoHeight || 0
                          const maxW = 480
                          const maxH = 480
                          if (vw > 0 && vh > 0) {
                            const scale = Math.min(maxW / vw, maxH / vh, 1)
                            const dw = Math.max(1, Math.round(vw * scale))
                            const dh = Math.max(1, Math.round(vh * scale))
                            setFirstVideoSize({ w: dw, h: dh })
                          } else {
                            const defaultW = 360
                            const defaultH = globalAspectRatio === '9:16'
                              ? Math.round(defaultW * 16 / 9)
                              : Math.round(defaultW * 9 / 16)
                            setFirstVideoSize({ w: defaultW, h: defaultH })
                          }
                        }}
                        className="mt-2 rounded-md border border-gray-200 shadow-sm"
                      />
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void submitOne(item)}
                disabled={item.status === 'submitting'}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >{item.status === 'submitting' ? '提交中…' : '提交 Veo3'}</button>
              {item.manualQueryReady && item.jobId && (
                <button
                  type="button"
                  onClick={() => void manualQuery(item)}
                  className="ml-3 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                >手动查询</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
  )
}
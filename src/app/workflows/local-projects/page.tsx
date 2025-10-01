'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Project = { id: string; name: string; asset_count: number }

type Asset = { id: string; filename: string; type: 'image' | 'video'; full_path: string }

export default function LocalProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16')
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameProjectValue, setRenameProjectValue] = useState('')

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    const res = await fetch('/api/local-projects')
    const data = await res.json()
    setProjects(data.items || [])
    if (data.items?.length) {
      const first = data.items[0]
      setSelectedProject(first)
      await loadAssets(first)
    }
  }

  async function rescan() {
    setLoading(true)
    await fetch('/api/local-projects?rescan=true')
    await loadProjects()
    setLoading(false)
  }

  async function loadAssets(project: Project) {
    const res = await fetch(`/api/local-projects/${project.id}/assets?page=1&pageSize=30`)
    const data = await res.json()
    setAssets(data.items || [])
  }

  function assetSrc(a: Asset) {
    const id = encodeURIComponent(a.id)
    const pid = encodeURIComponent(selectedProject?.id || '')
    return `/api/local-projects/asset/${id}?projectId=${pid}`
  }

  const aspectStyle = { aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9', width: '100%' } as const

  async function startAssetRename(a: Asset) {
    setRenamingAssetId(a.id)
    setRenameValue(a.filename)
  }
  async function submitAssetRename(a: Asset) {
    if (!selectedProject) return
    const pid = encodeURIComponent(selectedProject.id)
    const id = encodeURIComponent(a.id)
    const res = await fetch(`/api/local-projects/asset/${id}?projectId=${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newFilename: renameValue })
    })
    if (res.ok) {
      await loadAssets(selectedProject)
      setRenamingAssetId(null)
    } else {
      const err = await res.json().catch(() => null)
      alert(err?.error || `重命名失败 (HTTP ${res.status})`)
    }
  }

  async function startProjectRename(p: Project) {
    setRenamingProjectId(p.id)
    setRenameProjectValue(p.name)
  }
  async function submitProjectRename(p: Project) {
    const id = encodeURIComponent(p.id)
    const res = await fetch(`/api/local-projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: renameProjectValue })
    })
    if (res.ok) {
      await loadProjects()
      setRenamingProjectId(null)
    } else {
      const err = await res.json().catch(() => null)
      alert(err?.error || `项目重命名失败 (HTTP ${res.status})`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">本地项目管理</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-sm">
            <span className="text-gray-600">比例</span>
            <button
              className={`px-2 py-1 rounded border ${aspect === '9:16' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
              onClick={() => setAspect('9:16')}
            >9:16</button>
            <button
              className={`px-2 py-1 rounded border ${aspect === '16:9' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
              onClick={() => setAspect('16:9')}
            >16:9</button>
          </div>
          <button onClick={rescan} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={loading}>
            {loading ? '扫描中...' : '重新扫描'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-3">
          <div className="bg-white border rounded p-3">
            <h3 className="text-sm font-medium mb-2">项目列表</h3>
            <ul className="space-y-2">
              {projects.map(p => (
                <li key={p.id}>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSelectedProject(p); loadAssets(p); }}
                      className={`flex-1 text-left px-2 py-1 rounded ${selectedProject?.id === p.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{p.name}</span>
                        <span className="text-xs text-gray-500">{p.asset_count}</span>
                      </div>
                    </button>
                    {renamingProjectId === p.id ? (
                      <div className="flex items-center gap-1">
                        <input className="border rounded px-2 py-1 text-sm w-32" value={renameProjectValue} onChange={e => setRenameProjectValue(e.target.value)} />
                        <button className="px-2 py-1 text-xs rounded bg-blue-600 text-white" onClick={() => submitProjectRename(p)}>保存</button>
                        <button className="px-2 py-1 text-xs rounded" onClick={() => setRenamingProjectId(null)}>取消</button>
                      </div>
                    ) : (
                      <button className="px-2 py-1 text-xs rounded border" onClick={() => startProjectRename(p)}>重命名</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="col-span-9">
          <div className="bg-white border rounded p-3">
            <h3 className="text-sm font-medium mb-3">资产列表</h3>
            {!selectedProject && <div className="text-gray-500">请选择左侧项目</div>}
            {selectedProject && (
              <div className="grid grid-cols-4 gap-3">
                {assets.map(a => (
                  <div key={`${selectedProject.id}-${a.id}`} className="border rounded overflow-hidden">
                    <div style={aspectStyle}>
                      {a.type === 'image' ? (
                        <img src={assetSrc(a)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={a.filename} />
                      ) : (
                        <video src={assetSrc(a)} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                    </div>
                    <div className="p-2 text-xs text-gray-600 truncate flex items-center justify-between gap-2">
                      {renamingAssetId === a.id ? (
                        <>
                          <input className="border rounded px-2 py-1 text-xs flex-1" value={renameValue} onChange={e => setRenameValue(e.target.value)} />
                          <button className="px-2 py-1 text-xs rounded bg-blue-600 text-white" onClick={() => submitAssetRename(a)}>保存</button>
                          <button className="px-2 py-1 text-xs rounded" onClick={() => setRenamingAssetId(null)}>取消</button>
                        </>
                      ) : (
                        <>
                          <span className="truncate flex-1">{a.filename}</span>
                          <button className="px-2 py-1 text-xs rounded border" onClick={() => startAssetRename(a)}>重命名</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        可在设置页修改本地根路径：<Link href="/workflows/local-projects/settings" className="text-blue-600">路径设置</Link>
      </div>
    </div>
  )
}
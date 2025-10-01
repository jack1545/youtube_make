'use client'
import { useEffect, useState } from 'react'

export default function LocalSettingsPage() {
  const [root, setRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const res = await fetch('/api/local-settings')
    const data = await res.json()
    setRoot(data.root || '')
  }

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/local-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '保存失败')
      setMessage('已保存并重新扫描')
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setSaving(false)
      load()
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">本地路径设置</h2>
      <div className="bg-white border rounded p-4 space-y-3">
        <label className="text-sm text-gray-600">本地项目根路径（例如 G:\\Downloads\\ytb_project）</label>
        <input value={root} onChange={e => setRoot(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="输入绝对路径" />
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{saving ? '保存中...' : '保存路径并扫描'}</button>
          {message && <span className="text-sm text-gray-600">{message}</span>}
        </div>
      </div>
    </div>
  )
}
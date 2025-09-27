"use client"

import { useRef, useState } from 'react'

export function CopyButton({ text, className = '' }: { text: string, className?: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('复制失败', e)
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className || 'text-xs text-blue-600 hover:underline'}
      title="复制提示词"
    >{copied ? '已复制' : '复制'}</button>
  )
}

export function DeleteProjectButton({
  projectId,
  projectName,
  action,
  className = ''
}: {
  projectId: string,
  projectName: string,
  action: (formData: FormData) => Promise<void>,
  className?: string
}) {
  const formRef = useRef<HTMLFormElement>(null)
  return (
    <div className="inline-flex items-center gap-2">
      <form ref={formRef} action={action} className="hidden">
        <input type="hidden" name="projectId" value={projectId} />
      </form>
      <button
        type="button"
        onClick={() => {
          const ok = window.confirm(`确认删除项目“${projectName}”？此操作不可撤销。`)
          if (ok) formRef.current?.requestSubmit()
        }}
        className={className || 'rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50'}
      >删除项目</button>
    </div>
  )
}
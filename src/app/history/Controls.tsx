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
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="inline-flex items-center gap-2">
      <form ref={formRef} action={action} className="hidden">
        <input type="hidden" name="projectId" value={projectId} />
      </form>
      {/* Default state: show single delete button */}
      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={className || 'rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50'}
        >删除项目</button>
      )}
      {/* Confirming state: show Yes/No explicit options */}
      {confirming && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">确认删除“{projectName}”？</span>
          <button
            type="button"
            onClick={() => {
              formRef.current?.requestSubmit()
              setConfirming(false)
            }}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
          >是</button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >否</button>
        </div>
      )}
    </div>
  )
}
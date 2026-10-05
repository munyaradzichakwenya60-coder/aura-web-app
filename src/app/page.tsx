'use client'

export const dynamic = 'force-dynamic'

import React, { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Role = 'user' | 'assistant'
type Engine = 'auto' | 'local' | 'cloud'
type Attachment = { name: string; size: string; type: string }
type ImageData = { prompt: string; url: string; revisions: string[]; blobUrl?: string; revisionBlobs?: string[] }
type Message = { role: Role; content: string; engine?: string; attachments?: Attachment[]; imageData?: ImageData; createdAt: number; reactions?: { up: boolean; down: boolean } }
type Chat = { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number; cloudId?: string }
type LibraryItem = { id: string; title: string; content: string; type: 'snippet' | 'project'; chatId: string; createdAt: number }
type SupabaseUser = { id: string; email?: string; user_metadata?: { full_name?: string; avatar_url?: string } }
type UserProfile = { id: string; email: string; display_name: string; use_case: string; role: 'user' | 'admin'; onboarded: boolean; agreed_policy: boolean }

const STORAGE_KEY = 'aura_web_conversations_v1'
const SETTINGS_KEY = 'aura_web_settings_v1'
const LIBRARY_KEY = 'aura_web_library_v1'

function imageProxyUrl(prompt: string, seed?: number) {
  // Strip intent prefix — send only the subject to the image API
  const clean = prompt.replace(/^(generate|create|make|draw|paint|show|render|design|produce|give me)\s+(me\s+)?(a|an|the|some)?\s*(image|photo|picture|illustration|artwork|painting|drawing|portrait|wallpaper|poster|logo|icon|banner)\s+(of\s+)?/i, '').trim() || prompt
  const safeSeed = (seed ?? Date.now()) % 2147483647
  const params = new URLSearchParams({ prompt: clean, seed: String(safeSeed), w: '1024', h: '768' })
  return `/api/image?${params}`
}

const initialChat = (): Chat => ({
  id: `chat-${Date.now()}`,
  title: 'AURA-Pro Pre-Training',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [{ role: 'assistant', content: 'AURA Neural Architecture initialized. Ready to assist.', engine: 'AURA', createdAt: Date.now() }],
})

const svg = (path: string, extra = '') => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={extra}>{path.split('|').map((d, i) => <path key={i} d={d} />)}</svg>
)
const Icons = {
  edit:     svg('M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7|M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'),
  search:   svg('m21 21-4.35-4.35|M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z'),
  image:    svg('M21 16V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z|M3 16l5-5 4 4 3-3 4 4|M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'),
  library:  svg('M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14|M4 19a2 2 0 0 1-2-2v-1h18v1a2 2 0 0 1-2 2H4z|M9 3v11l3-2 3 2V3'),
  settings: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'),
  attach:   svg('M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'),
  globe:    svg('M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z|M2 12h20|M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'),
  mic:      svg('M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z|M19 10v2a7 7 0 0 1-14 0v-2|M12 19v4|M8 23h8'),
  send:     svg('M22 2 11 13|M22 2 15 22 11 13 2 9l20-7z'),
  close:    svg('M18 6 6 18|M6 6l12 12'),
  download: svg('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3'),
  trash:    svg('M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
  stop:     svg('M18 6H6v12h12V6z'),
  copy:     svg('M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z|M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'),
  sidebar:  svg('M3 3h18v18H3z|M9 3v18'),
  plus:     svg('M12 5v14|M5 12h14'),
  refresh:  svg('M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'),
  cloud:    svg('M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'),
  check:    svg('M20 6 9 17l-5-5'),
  thumbUp:   svg('M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z|M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'),
  thumbDown: svg('M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z|M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17'),
}

function normaliseChats(value: unknown): Chat[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): Chat[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Partial<Chat>
    if (!raw.id || !raw.title || !Array.isArray(raw.messages)) return []
    const now = Date.now()
    return [{
      id: raw.id,
      title: raw.title,
      createdAt: Number(raw.createdAt) || now,
      updatedAt: Number(raw.updatedAt) || now,
      cloudId: raw.cloudId,
      messages: raw.messages.flatMap((message): Message[] => {
        if (!message || typeof message !== 'object') return []
        const entry = message as Partial<Message>
        if (entry.role !== 'user' && entry.role !== 'assistant') return []
        return [{ role: entry.role, content: String(entry.content || ''), engine: entry.engine, attachments: entry.attachments, createdAt: Number(entry.createdAt) || now }]
      }),
    }]
  })
}

function downloadJson(data: unknown, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

function downloadMarkdown(chat: Chat) {
  const lines: string[] = [`# ${chat.title}`, `_Exported ${new Date().toLocaleString()}_`, '']
  for (const msg of chat.messages) {
    const who = msg.role === 'user' ? '**You**' : '**AURA**'
    lines.push(`${who}  `)
    lines.push(msg.content || `*(image)*`)
    lines.push('')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${chat.title.replace(/[^a-z0-9]/gi, '_')}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

function inlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|!\[[^\]]*\]\([^\s)]+\)|\[[^\]]+\]\([^\s)]+\))/g)
  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index} className="rounded px-1 py-0.5 text-[11px]" style={{ background: 'var(--bg-card-hover)' }}>{token.slice(1, -1)}</code>
    const img = token.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/)
    if (img) return <img key={index} src={img[2]} alt={img[1]} className="mt-2 max-w-full rounded-xl" style={{ maxHeight: 480, display: 'block' }} loading="lazy" />
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/)
    if (link && /^https?:\/\//i.test(link[2])) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="underline">{link[1]}</a>
    return token
  })
}

const LANG_EXT: Record<string, string> = {
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'jsx',
  html: 'html', css: 'css', py: 'py', python: 'py', json: 'json', md: 'md',
  sh: 'sh', bash: 'sh', sql: 'sql', yaml: 'yaml', yml: 'yml', rs: 'rs', go: 'go',
  java: 'java', cpp: 'cpp', c: 'c', rb: 'rb', php: 'php', swift: 'swift', kt: 'kt',
}

function extractFilename(code: string, lang: string): { filename: string; cleanCode: string } {
  const firstLine = code.split('\n')[0] ?? ''
  // Match: // filename.ext  |  # filename.ext  |  <!-- filename.ext -->  |  /* filename.ext */
  const match = firstLine.match(/^(?:\/\/|#|<!--|\/\*)\s*([\w\-.]+\.[\w]+)(?:\s*-->|\s*\*\/)?\s*$/)
  if (match) {
    return { filename: match[1], cleanCode: code.split('\n').slice(1).join('\n').trimStart() }
  }
  const ext = LANG_EXT[lang] ?? lang ?? 'txt'
  return { filename: `code.${ext}`, cleanCode: code }
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

async function downloadZip(files: { filename: string; content: string }[], zipName: string) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  files.forEach(f => zip.file(f.filename, f.content))
  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = zipName
  a.click()
  URL.revokeObjectURL(a.href)
}

function ImageCard({ imageData, narration, onRevise, theme }: { imageData: ImageData; narration?: string; onRevise: (prompt: string) => void; theme: 'dark' | 'light' }) {
  const [revIdx, setRevIdx] = React.useState(0)
  const [editing, setEditing] = React.useState(false)
  const [editInput, setEditInput] = React.useState("")
  const allUrls = [imageData.url, ...imageData.revisions]
  const allBlobs = [imageData.blobUrl ?? null, ...(imageData.revisionBlobs ?? [])]
  const currentBlob = allBlobs[revIdx] ?? null
  const isLoading = !currentBlob
  const totalCount = allBlobs.length

  // Auto-advance to the latest revision when a new blob arrives
  React.useEffect(() => {
    setRevIdx(totalCount - 1)
  }, [totalCount])

  const submitEdit = () => {
    if (!editInput.trim()) return
    onRevise(imageData.prompt + ", " + editInput.trim())
    setEditInput("")
    setEditing(false)
  }
  return (
    React.createElement("div", { className: "mt-1 overflow-hidden rounded-2xl border", style: { borderColor: "var(--border-card)", background: "var(--bg-card)", maxWidth: 520 } },
      // Image area with carousel arrows
      React.createElement("div", { className: "relative", style: { minHeight: isLoading ? 220 : undefined, background: "var(--bg-card-hover)" } },
        isLoading && React.createElement("div", { className: "absolute inset-0 flex flex-col items-center justify-center gap-3" },
          React.createElement("span", { className: "flex gap-1.5" },
            React.createElement("span", { className: "inline-block h-2 w-2 rounded-full animate-bounce", style: { background: "var(--text-dim)", animationDelay: "0ms" } }),
            React.createElement("span", { className: "inline-block h-2 w-2 rounded-full animate-bounce", style: { background: "var(--text-dim)", animationDelay: "150ms" } }),
            React.createElement("span", { className: "inline-block h-2 w-2 rounded-full animate-bounce", style: { background: "var(--text-dim)", animationDelay: "300ms" } })
          ),
          React.createElement("span", { className: "text-xs", style: { color: "var(--text-dim)" } }, "Generating image...")
        ),
        currentBlob && React.createElement("img", { src: currentBlob, alt: imageData.prompt, className: "w-full", style: { maxHeight: 400, objectFit: "cover", display: "block" } }),
        // Carousel arrows (only when multiple versions)
        totalCount > 1 && React.createElement(React.Fragment, null,
          React.createElement("button", {
            onClick: () => setRevIdx(i => Math.max(0, i - 1)),
            disabled: revIdx === 0,
            className: "absolute left-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-sm font-bold disabled:opacity-30",
            style: { background: "rgba(0,0,0,0.5)", color: "#fff" }
          }, "‹"),
          React.createElement("button", {
            onClick: () => setRevIdx(i => Math.min(totalCount - 1, i + 1)),
            disabled: revIdx === totalCount - 1,
            className: "absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-sm font-bold disabled:opacity-30",
            style: { background: "rgba(0,0,0,0.5)", color: "#fff" }
          }, "›"),
          React.createElement("div", {
            className: "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-xs",
            style: { background: "rgba(0,0,0,0.5)", color: "#fff" }
          }, (revIdx + 1) + " / " + totalCount)
        )
      ),
      // Bottom toolbar
      React.createElement("div", { className: "px-3 py-2.5" },
        narration && React.createElement("p", { className: "mb-2 text-sm leading-relaxed", style: { color: "var(--text-main)" } }, narration),
        React.createElement("p", { className: "mb-2 text-xs", style: { color: "var(--text-dim)" } }, imageData.prompt),
        editing
          ? React.createElement("div", { className: "flex gap-2" },
              React.createElement("input", { autoFocus: true, value: editInput, onChange: (e) => setEditInput(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") submitEdit(); if (e.key === "Escape") setEditing(false) }, placeholder: "Describe your edit...", className: "min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none", style: { borderColor: "var(--border-subtle)", color: "var(--text-main)" } }),
              React.createElement("button", { onClick: submitEdit, className: "rounded-lg px-3 py-1.5 text-xs font-medium", style: { background: "var(--accent-primary)", color: theme === "dark" ? "#111" : "#fff" } }, "Generate"),
              React.createElement("button", { onClick: () => setEditing(false), className: "rounded-lg px-2 py-1.5 text-xs", style: { background: "var(--bg-card-hover)" } }, "Cancel")
            )
          : React.createElement("div", { className: "flex gap-2" },
              React.createElement("button", { onClick: () => setEditing(true), className: "rounded-lg px-3 py-1.5 text-xs", style: { background: "var(--bg-card-hover)", border: "1px solid var(--border-card)" } }, "Edit image"),
              React.createElement("button", { onClick: () => { if (currentBlob) { const a = document.createElement("a"); a.href = currentBlob; a.download = "aura-image-" + Date.now() + ".png"; a.click() } }, disabled: !currentBlob, className: "rounded-lg px-3 py-1.5 text-xs disabled:opacity-40", style: { background: "var(--bg-card-hover)", border: "1px solid var(--border-card)" } }, "Download"),
              React.createElement("button", { onClick: () => navigator.clipboard.writeText(allUrls[revIdx] ?? imageData.url), className: "rounded-lg px-2 py-1.5 text-xs", style: { background: "var(--bg-card-hover)", border: "1px solid var(--border-card)" } }, "Copy URL")
            )
      )
    )
  )
}
// ── Sandbox Panel ─────────────────────────────────────────────────────────────
type SandboxFile = { path: string; size: number; isText: boolean }

function SandboxPanel({
  sessionId, theme, onInjectContext,
}: {
  sessionId: string
  theme: 'dark' | 'light'
  onInjectContext: (ctx: string) => void
}) {
  const [cmd, setCmd] = React.useState('')
  const [history, setHistory] = React.useState<{ cmd: string; output: string; err: string; code: number }[]>([])
  const [running, setRunning] = React.useState(false)
  const [files, setFiles] = React.useState<SandboxFile[]>([])
  const [tab, setTab] = React.useState<'terminal' | 'files'>('terminal')
  const [downloading, setDownloading] = React.useState(false)
  const termRef = React.useRef<HTMLDivElement>(null)
  const folderInput = React.useRef<HTMLInputElement>(null)

  // Load file list
  const refreshFiles = React.useCallback(async () => {
    const res = await fetch(`/api/files?session=${encodeURIComponent(sessionId)}`)
    if (res.ok) { const data = await res.json() as { files: SandboxFile[] }; setFiles(data.files) }
  }, [sessionId])

  React.useEffect(() => { refreshFiles() }, [refreshFiles])

  const runCommand = async () => {
    const c = cmd.trim()
    if (!c || running) return
    setRunning(true)
    setCmd('')
    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: c, sessionId }),
      })
      const data = await res.json() as { output: string; error: string; exitCode: number }
      setHistory(h => [...h, { cmd: c, output: data.output, err: data.error, code: data.exitCode }])
      await refreshFiles()
      window.setTimeout(() => termRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50)
    } catch (e) {
      setHistory(h => [...h, { cmd: c, output: '', err: String(e), code: -1 }])
    }
    setRunning(false)
  }

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    const form = new FormData()
    form.append('session', sessionId)
    for (const f of Array.from(fileList)) form.append('file', f)
    await fetch('/api/files', { method: 'POST', body: form })
    await refreshFiles()
  }

  const downloadZipFile = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/files?session=${encodeURIComponent(sessionId)}&action=download`)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `aura-project-${sessionId.slice(0, 8)}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally { setDownloading(false) }
  }

  const injectFileTree = () => {
    if (!files.length) return
    const tree = files.map(f => `  ${f.path} (${Math.ceil(f.size / 1024)} KB)`).join('\n')
    onInjectContext(`[Sandbox session: ${sessionId.slice(0, 8)}]\nFiles available:\n${tree}\n\nYou can read, modify, and create files in this sandbox. When the user asks for changes, apply them and I will package the result as a zip.`)
  }

  const bg = theme === 'light' ? '#f4f4f5' : '#09090b'
  const border = theme === 'light' ? '#e4e4e7' : '#27272a'
  const dim = theme === 'light' ? '#71717a' : '#52525b'
  const txt = theme === 'light' ? '#18181b' : '#e4e4e7'

  return (
    <div className="mt-2 overflow-hidden rounded-xl border" style={{ borderColor: border, background: bg, fontFamily: 'monospace' }}>
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: border }}>
        <div className="flex gap-1">
          {(['terminal', 'files'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="rounded px-2.5 py-1 text-[11px] font-medium capitalize"
              style={{ background: tab === t ? 'var(--accent-primary)' : 'transparent', color: tab === t ? '#111' : dim }}>
              {t === 'terminal' ? '⌨ Terminal' : `📁 Files (${files.length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => folderInput.current?.click()} className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--bg-card-hover)', color: dim }} title="Upload files or zip">
            ↑ Upload
          </button>
          {files.length > 0 && (
            <button onClick={downloadZipFile} disabled={downloading} className="rounded px-2 py-1 text-[10px] disabled:opacity-50" style={{ background: 'var(--accent-primary)', color: '#111' }}>
              {downloading ? '…' : '↓ Download zip'}
            </button>
          )}
          {files.length > 0 && (
            <button onClick={injectFileTree} className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--bg-card-hover)', color: dim }} title="Share file tree with AURA">
              🔗 Share with AURA
            </button>
          )}
        </div>
      </div>

      {/* Terminal */}
      {tab === 'terminal' && (
        <>
          <div ref={termRef} className="overflow-y-auto px-3 py-2 text-[12px]" style={{ maxHeight: 260, minHeight: 120, color: txt }}>
            {history.length === 0 && <span style={{ color: dim }}>Sandbox ready — commands run in your system's PowerShell, scoped to a temp directory.</span>}
            {history.map((entry, i) => (
              <div key={i} className="mb-2">
                <div style={{ color: '#7c3aed' }}>PS› {entry.cmd}</div>
                {entry.output && <pre className="whitespace-pre-wrap break-all" style={{ color: txt }}>{entry.output}</pre>}
                {entry.err && <pre className="whitespace-pre-wrap break-all" style={{ color: '#ef4444' }}>{entry.err}</pre>}
                {entry.code !== 0 && <span style={{ color: dim }}>[exit {entry.code}]</span>}
              </div>
            ))}
            {running && <div style={{ color: dim }}>Running…</div>}
          </div>
          <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: border }}>
            <span style={{ color: '#7c3aed', fontSize: 12 }}>PS›</span>
            <input
              value={cmd} onChange={e => setCmd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runCommand() }}
              placeholder="Type a command…"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              style={{ color: txt }}
              disabled={running}
            />
            <button onClick={runCommand} disabled={running || !cmd.trim()} className="rounded px-2 py-1 text-[11px] disabled:opacity-40" style={{ background: 'var(--accent-primary)', color: '#111' }}>Run</button>
          </div>
        </>
      )}

      {/* File tree */}
      {tab === 'files' && (
        <div className="overflow-y-auto px-3 py-2 text-[12px]" style={{ maxHeight: 300, minHeight: 80, color: txt }}>
          {files.length === 0
            ? <span style={{ color: dim }}>No files yet. Upload a zip or folder, or run commands to create files.</span>
            : files.map(f => (
              <div key={f.path} className="flex items-center justify-between rounded px-1 py-0.5 hover:bg-white/5">
                <span style={{ color: f.isText ? txt : dim }}>{f.path}</span>
                <span style={{ color: dim }}>{Math.ceil(f.size / 1024)} KB</span>
              </div>
            ))
          }
        </div>
      )}

      <input ref={folderInput} type="file" className="hidden" multiple
        // @ts-expect-error webkitdirectory is not in typings
        webkitdirectory=""
        accept=".zip,.ts,.tsx,.js,.jsx,.py,.html,.css,.json,.md,.txt,.env,.sh,.yml,.yaml"
        onChange={e => uploadFiles(e.target.files)} />
    </div>
  )
}

function Markdown({ content, onSave, onSaveToSandbox, theme = 'dark' }: { content: string; onSave?: (code: string, lang: string) => void; onSaveToSandbox?: (filename: string, content: string) => void; theme?: 'dark' | 'light' }) {
  const [previews, setPreviews] = React.useState<Record<number, boolean>>({})
  const [fullscreen, setFullscreen] = React.useState<number | null>(null)
  const blocks = content.split(/(```[\s\S]*?```)/g)

  // Collect all code files in this message for "Download all" — computed once
  const allFiles = React.useMemo(() => {
    return blocks.flatMap((block, index) => {
      if (!block.startsWith('```') || !block.endsWith('```')) return []
      const inner = block.slice(3, -3)
      const lang = inner.match(/^(\w+)\n/)?.[1] ?? 'code'
      const raw = inner.replace(/^\w+\n/, '')
      const { filename, cleanCode } = extractFilename(raw, lang)
      return [{ index, filename, content: cleanCode, lang }]
    })
  }, [blocks])

  // Fast path: entire content is a single image — render as image card
  const soloImg = content.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/)
  if (soloImg) {
    return <div className="mt-1">
      <img src={soloImg[2]} alt={soloImg[1]} className="max-w-full rounded-xl" style={{ maxHeight: 520, display: 'block' }} loading="lazy" />
      <div className="mt-2 flex gap-2">
        <a href={soloImg[2]} download target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)' }}>{Icons.download} Download</a>
        <button onClick={() => navigator.clipboard.writeText(soloImg[2])} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)' }}>{Icons.copy} Copy URL</button>
      </div>
    </div>
  }

  return <>
    {allFiles.length > 1 && (
      <div className="mb-2 flex items-center justify-end gap-2">
        <button
          onClick={() => downloadZip(allFiles, 'aura-project.zip')}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)' }}
        >
          {Icons.download} Download all ({allFiles.length} files)
        </button>
        {onSaveToSandbox && (
          <button
            onClick={() => allFiles.forEach(f => onSaveToSandbox(f.filename, f.content))}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: '#f59e0b20', border: '1px solid #f59e0b60', color: '#f59e0b' }}
          >
            📁 Save all to sandbox
          </button>
        )}
      </div>
    )}
    {blocks.map((block, index) => {
      if (block.startsWith('```') && block.endsWith('```')) {
        const inner = block.slice(3, -3)
        const lang = inner.match(/^(\w+)\n/)?.[1] ?? 'code'
        const raw = inner.replace(/^\w+\n/, '')
        const { filename, cleanCode } = extractFilename(raw, lang)
        const isHtml = lang === 'html' || cleanCode.trimStart().startsWith('<!DOCTYPE') || cleanCode.trimStart().startsWith('<html')
        const isCss = lang === 'css'
        const isJs = lang === 'js' || lang === 'javascript' || lang === 'ts' || lang === 'typescript'
        const isMd = lang === 'md' || lang === 'markdown'
        const isSvg = lang === 'svg' || cleanCode.trimStart().startsWith('<svg')
        const isPy = lang === 'py' || lang === 'python'
        const guiMods = ['tkinter','pygame','wx','PyQt','PySide','kivy','turtle','cv2','tkinter.ttk']
        const usesGui = isPy && guiMods.some(m => cleanCode.includes('import ' + m) || cleanCode.includes('from ' + m))
        const isPreviewable = isHtml || isCss || isJs || isMd || isSvg || isPy
        // GUI blocks auto-show the card; other blocks show on click
        const showPreview = previews[index] ?? (usesGui ? true : false)

        // Build preview doc for CSS/JS/MD
        const previewDoc = isHtml ? cleanCode
          : isCss ? `<!DOCTYPE html><html><head><style>${cleanCode}</style></head><body style="padding:16px;font-family:sans-serif"><p>CSS applied to this document.</p><h2>Sample Heading</h2><p>Sample paragraph text to preview styles.</p><button>Button</button></body></html>`
          : isJs ? `<!DOCTYPE html><html><head></head><body style="padding:16px;font-family:sans-serif"><div id="output" style="font-size:13px;white-space:pre-wrap"></div><script>
const _log = console.log;
const _out = document.getElementById('output');
console.log = (...a) => { _out.textContent += a.join(' ') + '\\n'; _log(...a); };
try { ${cleanCode} } catch(e) { _out.textContent += 'Error: ' + e.message; }
<\/script></body></html>`
          : isMd ? `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;max-width:720px;margin:32px auto;padding:0 16px;line-height:1.6}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto}code{font-family:monospace;font-size:.9em}blockquote{border-left:3px solid #ccc;margin:0;padding-left:16px;color:#555}</style></head><body>${cleanCode.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</body></html>`
          : isSvg ? `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fafafa}</style></head><body>${cleanCode}</body></html>`
          : isPy ? (() => {
          if (usesGui) return `<!DOCTYPE html><html><head><style>
*{box-sizing:border-box;margin:0;padding:0}
body{padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#e4e4e7;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#18181b;border:1px solid #27272a;border-radius:14px;padding:24px;max-width:420px;width:100%;text-align:center}
.icon{font-size:32px;margin-bottom:12px}
h3{font-size:15px;font-weight:600;color:#fafafa;margin-bottom:8px}
p{font-size:13px;color:#a1a1aa;line-height:1.6;margin-bottom:16px}
.badge{display:inline-flex;align-items:center;gap:6px;background:#3b82f620;border:1px solid #3b82f640;color:#3b82f6;border-radius:6px;padding:3px 8px;font-size:11px;font-family:monospace;margin-bottom:16px}
.btn{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:500;cursor:pointer;width:100%;justify-content:center}
.btn:hover{opacity:.9}
.note{margin-top:12px;font-size:11px;color:#52525b}
</style></head><body><div class="card">
<div class="icon">🖥</div>
<h3>GUI App Detected</h3>
<p>This script uses a desktop GUI library that can't run in a browser sandbox directly.</p>
<div class="badge">✓ Convertible to Web App</div>
<p style="font-size:12px;color:#71717a">AURA can rewrite this as a fully interactive browser-based equivalent — same functionality, runs instantly in this chat.</p>
<button class="btn" onclick="window.parent.postMessage({type:'aura-launch-gui',code:${JSON.stringify(JSON.stringify(cleanCode))}}, '*')">🚀 Launch as Interactive Web App</button>
<div class="note">AURA will convert the GUI to HTML/CSS/JS and open it in preview mode</div>
</div></body></html>`
          return `<!DOCTYPE html><html><head><style>body{margin:0;padding:16px;font-family:monospace;font-size:13px}#out{white-space:pre-wrap;line-height:1.6}.loading{color:#71717a}#err{color:#ef4444;margin-top:8px}strong{font-weight:600}</style></head><body><div id="out" class="loading">⏳ Loading Python (Pyodide)…</div><div id="err"></div><script type="module">
const out=document.getElementById('out'),err=document.getElementById('err');
try {
  const {loadPyodide} = await import('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.mjs');
  out.textContent='⏳ Running…';
  const py = await loadPyodide({stdout:(s)=>{out.classList.remove('loading');out.textContent+=s+'\\n'},stderr:(s)=>{err.textContent+=s+'\\n'}});
  out.textContent='';
  await py.runPythonAsync(${JSON.stringify(cleanCode)});
  if(!out.textContent.trim()) out.textContent='(script completed — no output)';
} catch(e) {
  out.textContent='';
  const msg = e.message || String(e);
  const mod = msg.match(/No module named '([^']+)'/)?.[1];
  if (mod) err.innerHTML='<strong>Module unavailable in browser:</strong> <code>'+mod+'</code><br><small>Pyodide only runs pure-Python packages. Ask AURA to rewrite without this dependency.</small>';
  else err.textContent = '✖ ' + msg;
}
<\/script></body></html>`
        })()
          : cleanCode

        return <div key={index} className="my-3 overflow-hidden rounded-xl border" style={{ borderColor: theme === 'light' ? '#e4e4e7' : '#27272a' }}>
          {/* Filename header bar — Claude style */}
          <div className="flex items-center justify-between px-3 py-2" style={{ background: theme === 'light' ? '#f4f4f5' : '#0f0f11', borderBottom: `1px solid ${theme === 'light' ? '#e4e4e7' : '#27272a'}` }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-medium" style={{ color: theme === 'light' ? '#52525b' : '#a1a1aa' }}>{filename}</span>
              {isPy && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium ml-1" style={{ background: '#3b82f620', color: '#3b82f6' }}>Python</span>}
              {isSvg && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium ml-1" style={{ background: '#10b98120', color: '#10b981' }}>SVG</span>}
            </div>
            <div className="flex items-center gap-1">
              {/* Ask AURA about selected code */}
              <button
                onClick={() => { const sel = window.getSelection()?.toString().trim(); const q = sel || ''; if (onSave) onSave(`[Code context from ${filename}]:\n\`\`\`${lang}\n${q || cleanCode.slice(0,300)}\n\`\`\`\nExplain or improve this:`, lang); }}
                className="rounded px-2 py-1 text-[11px]"
                style={{ color: theme === 'light' ? '#52525b' : '#a1a1aa' }}
                title="Select code then click to ask AURA">
                {svg('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')}
              </button>
              {isPreviewable && (
                <button onClick={() => setPreviews(p => ({ ...p, [index]: !p[index] }))}
                  className="rounded px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{ background: showPreview ? 'var(--accent-primary)' : theme === 'light' ? '#e4e4e7' : '#27272a', color: showPreview ? '#111' : theme === 'light' ? '#52525b' : '#a1a1aa' }}>
                  {showPreview ? 'Code' : '▶ Preview'}
                </button>
              )}
              {onSave && (
                <button onClick={() => onSave(cleanCode, lang)}
                  className="rounded px-2 py-1 text-[11px]" style={{ color: theme === 'light' ? '#52525b' : '#a1a1aa' }}>
                  {Icons.library}
                </button>
              )}
              {onSaveToSandbox && (
                <button onClick={() => onSaveToSandbox(filename, cleanCode)}
                  className="rounded px-2 py-1 text-[11px]"
                  style={{ color: '#f59e0b' }}
                  title={`Save ${filename} to sandbox`}>
                  📁
                </button>
              )}
              <button onClick={() => downloadFile(filename, cleanCode)}
                className="rounded px-2 py-1 text-[11px]" style={{ color: theme === 'light' ? '#52525b' : '#a1a1aa' }}
                title={`Download ${filename}`}>
                {Icons.download}
              </button>
              <button onClick={() => navigator.clipboard.writeText(cleanCode)}
                className="rounded px-2 py-1 text-[11px]" style={{ color: theme === 'light' ? '#52525b' : '#a1a1aa' }}>
                {Icons.copy}
              </button>
            </div>
          </div>

          {/* Code or Preview */}
          {showPreview ? (
            <div>
              <div className="flex items-center justify-between px-3 py-1.5 text-xs" style={{ background: theme === 'light' ? '#fafafa' : '#111', borderBottom: `1px solid ${theme === 'light' ? '#e4e4e7' : '#27272a'}` }}>
                <span style={{ color: '#71717a' }}>▶ {isPy ? (usesGui ? '🖥 GUI App' : 'Python · Pyodide') : isSvg ? 'SVG' : isJs ? 'JavaScript' : isCss ? 'CSS' : isMd ? 'Markdown' : 'HTML'} Preview</span>
                <div className="flex items-center gap-2">
                  {usesGui && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: '#7c3aed20', color: '#7c3aed' }}>Click 🚀 to convert</span>}
                  <button onClick={() => setFullscreen(index)} className="flex items-center gap-1 text-xs" style={{ color: '#71717a' }}>{svg('M8 3H5a2 2 0 0 0-2 2v3|M21 8V5a2 2 0 0 0-2-2h-3|M3 16v3a2 2 0 0 0 2 2h3|M16 21h3a2 2 0 0 0 2-2v-3')} Fullscreen</button>
                </div>
              </div>
              <iframe srcDoc={previewDoc} sandbox="allow-scripts allow-same-origin allow-popups" className="w-full bg-white" style={{ height: isPy ? (usesGui ? 320 : 420) : 360, border: 'none', display: 'block' }} title="Preview" />
            </div>
          ) : (
            <pre className="overflow-x-auto p-4 text-xs leading-relaxed" style={{ background: theme === 'light' ? '#fafafa' : '#09090b', color: theme === 'light' ? '#18181b' : '#e4e4e7', margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal' }}><code>{cleanCode}</code></pre>
          )}

          {/* Fullscreen overlay */}
          {fullscreen === index && (
            <div className="fixed inset-0 z-[300] flex flex-col" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={() => setFullscreen(null)}>
              <div className="flex items-center justify-between px-4 py-3" onClick={e => e.stopPropagation()}>
                <span className="font-mono text-sm text-white">{filename}</span>
                <button onClick={() => setFullscreen(null)} className="flex items-center gap-1 text-sm text-white opacity-70 hover:opacity-100">{Icons.close} Close</button>
              </div>
              <iframe srcDoc={previewDoc} sandbox="allow-scripts allow-same-origin" className="mx-4 mb-4 flex-1 rounded-xl bg-white" style={{ border: 'none' }} title="Preview Fullscreen" onClick={(e: React.MouseEvent) => e.stopPropagation()} />
            </div>
          )}
        </div>
      }
      return block.split('\n').map((line, lineIndex) => {
        if (!line) return <br key={`${index}-${lineIndex}`} />
        if (line.startsWith('### ')) return <h4 key={`${index}-${lineIndex}`} className="mt-3 font-semibold">{inlineMarkdown(line.slice(4))}</h4>
        if (line.startsWith('## ')) return <h3 key={`${index}-${lineIndex}`} className="mt-3 text-base font-semibold">{inlineMarkdown(line.slice(3))}</h3>
        if (line.startsWith('# ')) return <h2 key={`${index}-${lineIndex}`} className="mt-3 text-lg font-semibold">{inlineMarkdown(line.slice(2))}</h2>
        if (/^[-*] /.test(line)) return <div key={`${index}-${lineIndex}`} className="pl-3 before:mr-2 before:content-['•']">{inlineMarkdown(line.slice(2))}</div>
        return <p key={`${index}-${lineIndex}`} className="min-h-[1.25em]">{inlineMarkdown(line)}</p>
      })
    })}
  </>
}

export default function AuraPage() {
  const supabase = useMemo(() => createClient(), [])
  const [isMobile, setIsMobile] = useState(false)
  const [mobileTab, setMobileTab] = useState<'chat'|'search'|'images'|'settings'>( 'chat')
  const [chats, setChats] = useState<Chat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string>('')
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [showConversation, setShowConversation] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [engine, setEngine] = useState<Engine>('auto')
  const [model, setModel] = useState('qwen3:0.6b')
  const [temperature, setTemperature] = useState(0.7)
  const [cloudKey, setCloudKey] = useState('')
  const [voice, setVoice] = useState('en-US')
  const [webResearch, setWebResearch] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [engineStatus, setEngineStatus] = useState('Detecting…')
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [modal, setModal] = useState<'settings' | 'search' | 'images' | 'library' | null>(null)
  const [settingsTab, setSettingsTab] = useState<'general' | 'voice'>('general')
  const [libraryTab, setLibraryTab] = useState<'projects' | 'snippets'>('projects')
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardStep, setOnboardStep] = useState(0)
  const [onboardName, setOnboardName] = useState('')
  const [onboardUseCase, setOnboardUseCase] = useState('')
  const [onboardAgreed, setOnboardAgreed] = useState(false)
  const [notice, setNotice] = useState('')
  const [showSandbox, setShowSandbox] = useState(false)
  const [sandboxSessionId] = useState(() => `sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const activeChat = chats.find(chat => chat.id === currentChatId) ?? chats[0]
  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(current => current === message ? '' : current), 3200)
  }, [])

  const detectEngine = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 1500)
      const response = await fetch('http://localhost:11434/api/tags', { signal: controller.signal })
      window.clearTimeout(timer)
      setEngineStatus(response.ok ? 'AURA · Local' : 'AURA · Cloud')
    } catch { setEngineStatus('Gemma (Cloud)') }
  }, [])

  useEffect(() => {
    const stored = normaliseChats(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))
    const ready = stored.length ? stored : [initialChat()]
    setChats(ready)
    setCurrentChatId(ready[0].id)
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<{ theme: 'dark' | 'light'; engine: Engine; model: string; temperature: number; cloudKey: string; voice: string }>
    if (settings.theme) setTheme(settings.theme)
    if (settings.engine) setEngine(settings.engine)
    if (settings.model) setModel(settings.model === 'gemma3:4b' ? 'qwen3:0.6b' : settings.model)
    if (typeof settings.temperature === 'number') setTemperature(settings.temperature)
    if (settings.cloudKey) setCloudKey(settings.cloudKey)
    if (settings.voice) setVoice(settings.voice)
    document.documentElement.dataset.theme = settings.theme || 'dark'
    const savedLib = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]') as LibraryItem[]
    setLibraryItems(savedLib)
    setHydrated(true)
    detectEngine()
  }, [detectEngine])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
  }, [chats, hydrated])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(libraryItems))
  }, [libraryItems, hydrated])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, engine, model, temperature, cloudKey, voice }))
    document.documentElement.dataset.theme = theme
  }, [theme, engine, model, temperature, cloudKey, voice, hydrated])

  useEffect(() => {
    const loadProfile = async (u: SupabaseUser) => {
      try {
        const { data } = await supabase.from('user_profiles').select('*').eq('id', u.id).single()
        if (data) {
          setUserProfile(data as UserProfile)
          if (!data.onboarded) { setOnboardName(data.display_name ?? u.user_metadata?.full_name ?? ''); setShowOnboarding(true) }
        }
      } catch { /* profile table not yet set up */ }
    }
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user as SupabaseUser | null
      setUser(u)
      if (u) loadProfile(u)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user as SupabaseUser | null
      setUser(u)
      if (u) loadProfile(u)
    })
    return () => listener.subscription.unsubscribe()
  }, [supabase])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeChat?.messages, isGenerating])

  // Mobile detection
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768 || ('ontouchstart' in window && window.innerWidth < 1024)
      setIsMobile(mobile)
      if (mobile) setSidebarOpen(false)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Listen for GUI "Launch as Web App" message from preview iframes
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'aura-launch-gui') {
        try {
          const code = typeof event.data.code === 'string' ? JSON.parse(event.data.code) : event.data.code
          const prompt = `Convert this Python GUI script to a fully interactive browser web app using HTML, CSS, and JavaScript. Recreate all the GUI elements (buttons, inputs, labels, layouts) as styled HTML. Make it look polished and modern. Here is the Python code:\n\n\`\`\`python\n${code}\n\`\`\``
          setInput(prompt)
          setShowConversation(true)
          setTimeout(() => inputRef.current?.focus(), 100)
        } catch { /* ignore malformed messages */ }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const updateActiveChat = useCallback((update: (chat: Chat) => Chat) => {
    setChats(current => current.map(chat => chat.id === currentChatId ? update(chat) : chat))
  }, [currentChatId])

  const saveToLibrary = useCallback((code: string, lang: string) => {
    const chat = chats.find(c => c.id === currentChatId)
    const title = `${lang ? lang + ' · ' : ''}${chat?.title ?? 'Snippet'}`
    const item: LibraryItem = { id: `lib-${Date.now()}`, title, content: code, type: 'snippet', chatId: currentChatId, createdAt: Date.now() }
    setLibraryItems(current => [item, ...current])
    showNotice('Saved to Library')
  }, [chats, currentChatId, showNotice])

  const isAdmin = userProfile?.role === 'admin' || (user?.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL)

  const saveOnboarding = async () => {
    if (!user) return
    try {
      await supabase.from('user_profiles').upsert({
        id: user.id,
        email: user.email,
        display_name: onboardName.trim() || userLabel,
        use_case: onboardUseCase || 'personal',
        onboarded: true,
        agreed_policy: onboardAgreed,
        updated_at: new Date().toISOString(),
      })
      setUserProfile(prev => prev ? { ...prev, onboarded: true, display_name: onboardName, use_case: onboardUseCase, agreed_policy: onboardAgreed } : prev)
      setShowOnboarding(false)
    } catch { showNotice('Could not save preferences — you can update them in Settings.'); setShowOnboarding(false) }
  }

  const createNewChat = () => {
    const now = Date.now()
    const chat: Chat = { id: `chat-${now}`, title: 'New conversation', messages: [], createdAt: now, updatedAt: now }
    setChats(current => [chat, ...current])
    setCurrentChatId(chat.id)
    setShowConversation(false)
    setAttachments([])
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const selectFiles = async (files: FileList | null) => {
    if (!files) return
    const regularFiles: File[] = []
    const zipFiles: File[] = []
    for (const f of Array.from(files)) {
      if (f.name.endsWith('.zip') || f.type === 'application/zip') zipFiles.push(f)
      else regularFiles.push(f)
    }
    if (regularFiles.length > 0) {
      const next = regularFiles.map(file => ({ name: file.name, size: `${Math.max(1, Math.round(file.size / 1024))} KB`, type: file.type || 'file' }))
      setAttachments(current => [...current, ...next])
    }
    if (zipFiles.length > 0) {
      // Route zips straight to the sandbox
      const dt = new DataTransfer()
      zipFiles.forEach(f => dt.items.add(f))
      await selectFolderOrZip(dt.files)
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const selectFolderOrZip = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const form = new FormData()
    form.append('session', sandboxSessionId)
    for (const f of Array.from(files)) form.append('file', f)
    showNotice('Uploading to sandbox…')
    try {
      const res = await fetch('/api/files', { method: 'POST', body: form })
      const data = await res.json() as { written?: string[] }
      const count = data.written?.length ?? 0
      showNotice(`${count} file${count !== 1 ? 's' : ''} added to sandbox`)
      setShowSandbox(true)
      // Inject file context into next message
      setInput(prev => prev || 'I\'ve uploaded files to the sandbox. Please review the file tree.')
    } catch {
      showNotice('Upload failed.')
    }
    if (folderInput.current) folderInput.current.value = ''
  }

  const handleVoice = () => {
    type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void }
    const RecognitionConstructor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
    if (!RecognitionConstructor) { showNotice('Speech recognition is not supported by this browser.'); return }
    const recognition = new RecognitionConstructor()
    recognition.lang = voice
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = event => setInput(current => `${current}${current ? ' ' : ''}${event.results[0][0].transcript}`)
    recognition.onerror = () => showNotice('Voice capture could not start.')
    recognition.start()
  }

  const handleSend = useCallback(async (prefill?: string) => {
    const text = (prefill ?? input).trim()
    if ((!text && !attachments.length) || isGenerating || !activeChat) return
    // Auto-detect image generation intent from plain text
    const imageIntentPattern = /^(generate|create|make|draw|paint|show|render|design|produce|give me|can you (make|create|generate|draw))\s+(me\s+)?(a|an|the|some)?\s*(image|photo|picture|illustration|artwork|painting|drawing|portrait|wallpaper|poster|logo|icon|banner)/i
    const isImageIntent = imageMode || text.toLowerCase().startsWith('/imagine ') || imageIntentPattern.test(text.trim())
    if (isImageIntent) {
      const prompt = (text.replace(/^\/imagine\s+/i, '') || text).trim()
      const now = Date.now()
      const userMessage: Message = { role: 'user', content: text, attachments, createdAt: now }
      const imageUrl = imageProxyUrl(prompt, now)
      const assistantMsg: Message = {
        role: 'assistant',
        content: '',
        engine: 'AURA • Image',
        imageData: { prompt, url: imageUrl, revisions: [] },
        createdAt: now + 1,
      }
      const title = activeChat.title === 'New conversation' ? prompt.slice(0, 48) : activeChat.title
      const updatedMsgs = [...activeChat.messages, userMessage, assistantMsg]
      const assistantIndex = updatedMsgs.length - 1
      updateActiveChat(chat => ({ ...chat, title, messages: updatedMsgs, updatedAt: now }))
      setInput('')
      setAttachments([])
      setImageMode(false)
      setShowConversation(true)
      setIsGenerating(true)

      // Stream a short narration from the base model
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const narrationMessages = [{ role: 'user', content: `You just generated an image for the user based on this prompt: "${prompt}". Write a single short, elegant sentence presenting it to them. Do not mention the tool used. Speak as AURA.` }]
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ messages: narrationMessages, engine, model, temperature: 0.7, cloudApiKey: cloudKey }) })
        if (response.ok && response.body) {
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let narration = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
              try {
                const packet = JSON.parse(line.slice(6)) as { text?: string }
                if (packet.text) {
                  narration += packet.text
                  updateActiveChat(chat => {
                    const msgs = [...chat.messages]
                    msgs[assistantIndex] = { ...msgs[assistantIndex], content: narration }
                    return { ...chat, messages: msgs, updatedAt: Date.now() }
                  })
                }
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* narration optional — image still shows */ }

      // Fetch the image blob now that narration is done (no more re-renders during streaming)
      try {
        const imgRes = await fetch(imageUrl)
        if (imgRes.ok) {
          const blob = await imgRes.blob()
          const blobUrl = URL.createObjectURL(blob)
          updateActiveChat(chat => {
            const msgs = [...chat.messages]
            const target = msgs[assistantIndex]
            if (target?.imageData) {
              msgs[assistantIndex] = { ...target, imageData: { ...target.imageData, blobUrl } }
            }
            return { ...chat, messages: msgs, updatedAt: Date.now() }
          })
        }
      } catch { /* image fetch failed — card will show retry */ }

      setIsGenerating(false)
      return
    }

    const now = Date.now()
    const userMessage: Message = { role: 'user', content: text || 'Attached files', attachments, createdAt: now }
    const updated = [...activeChat.messages, userMessage]
    const title = activeChat.title === 'New conversation' ? (text || attachments[0]?.name || 'New conversation').slice(0, 48) : activeChat.title
    updateActiveChat(chat => ({ ...chat, title, messages: updated, updatedAt: now }))
    setInput('')
    setAttachments([])
    setShowConversation(true)
    setIsGenerating(true)
    const assistantIndex = updated.length
    updateActiveChat(chat => ({ ...chat, messages: [...updated, { role: 'assistant', content: '', engine: '', createdAt: Date.now() }], updatedAt: Date.now() }))

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const outbound = updated.slice(-12).map(message => ({
        role: message.role,
        content: message.attachments?.length ? `${message.content}\n\nAttached file metadata: ${message.attachments.map(file => `${file.name} (${file.size})`).join(', ')}` : message.content,
      }))
      // Auto-enable web research for queries about current events, news, or time-sensitive facts
      const needsWebPattern = /\b(today|tonight|this week|this month|this year|right now|currently|latest|recent|news|weather|stock|price|score|result|election|match|game|live|happening|announcement|update|released|launched|died|won|lost|broke|crisis|war|attack|flood|earthquake|hurricane|covid|virus|outbreak)\b/i
      // Also trigger research for coding/technical questions to pull current docs
      const needsCodingResearch = /\b(how (do|does|to|can)|best (way|practice|approach)|difference between|vs\.?|error|fix|debug|not working|deprecated|version|install|setup|configure|api|library|framework|package|module|import|syntax|example|tutorial|documentation|docs)\b/i
      const autoResearch = webResearch || needsWebPattern.test(text) || (needsCodingResearch.test(text) && /\b(react|next|vue|angular|python|javascript|typescript|rust|go|java|css|html|node|npm|git|docker|kubernetes|aws|sql|graphql|tailwind|prisma|supabase|vercel|firebase|openai|api)\b/i.test(text))
    // Auto-open sandbox in bg for coding tasks (non-admin users get read-only view, admin gets full terminal)
    const isCodingTask = /\b(write|create|build|fix|debug|code|function|class|script|program|component|implement|refactor)\b/i.test(text) && /\b(python|javascript|typescript|react|node|html|css|rust|go|java|sql|bash|shell)\b/i.test(text)
    if (isCodingTask && !showSandbox) setShowSandbox(true)
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ messages: outbound, engine, model, temperature, cloudApiKey: cloudKey, webResearch: autoResearch }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({ error: 'Request failed.' }))).error)
      if (!response.body) throw new Error('The model did not return a stream.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      let responseEngine = 'AURA'
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const event = line.trim()
          if (!event.startsWith('data: ') || event === 'data: [DONE]') continue
          try {
            const packet = JSON.parse(event.slice(6)) as { text?: string; engine?: string }
            if (!packet.text) continue
            content += packet.text
            responseEngine = packet.engine || responseEngine
            updateActiveChat(chat => {
              const messages = [...chat.messages]
              messages[assistantIndex] = { role: 'assistant', content, engine: responseEngine, createdAt: messages[assistantIndex]?.createdAt || Date.now() }
              return { ...chat, messages, updatedAt: Date.now() }
            })
          } catch { /* Ignore malformed SSE frames. */ }
        }
      }
    } catch (error) {
      const content = controller.signal.aborted ? 'Generation stopped.' : `Connection error: ${error instanceof Error ? error.message : 'Unknown error.'}`
      updateActiveChat(chat => {
        const messages = [...chat.messages]
        messages[assistantIndex] = { role: 'assistant', content, engine: controller.signal.aborted ? 'Stopped' : 'AURA Fallback', createdAt: messages[assistantIndex]?.createdAt || Date.now() }
        return { ...chat, messages, updatedAt: Date.now() }
      })
    } finally {
      abortRef.current = null
      setIsGenerating(false)
    }
  }, [activeChat, attachments, cloudKey, engine, input, isGenerating, model, showNotice, temperature, updateActiveChat, webResearch])

  const syncToCloud = async () => {
    if (!user) { showNotice('Sign in with Google before syncing.'); return }
    setSyncing(true)
    try {
      let nextChats = [...chats]
      for (const chat of nextChats) {
        let cloudId = chat.cloudId
        if (!cloudId) {
          const { data, error } = await supabase.from('conversations').insert({ user_id: user.id, title: chat.title, model, updated_at: new Date(chat.updatedAt).toISOString() }).select('id').single()
          if (error) throw error
          cloudId = String(data.id)
          nextChats = nextChats.map(item => item.id === chat.id ? { ...item, cloudId } : item)
        } else {
          const { error } = await supabase.from('conversations').update({ title: chat.title, model, updated_at: new Date(chat.updatedAt).toISOString() }).eq('id', cloudId).eq('user_id', user.id)
          if (error) throw error
        }
        const { error: deleteError } = await supabase.from('messages').delete().eq('conversation_id', cloudId).eq('user_id', user.id)
        if (deleteError) throw deleteError
        if (chat.messages.length) {
          const { error: insertError } = await supabase.from('messages').insert(chat.messages.map(message => ({ conversation_id: cloudId, user_id: user.id, role: message.role, content: message.content, created_at: new Date(message.createdAt).toISOString() })))
          if (insertError) throw insertError
        }
      }
      setChats(nextChats)
      showNotice('Conversations synced to Supabase.')
    } catch (error) { showNotice(`Cloud sync failed: ${error instanceof Error ? error.message : 'Unknown error.'}`) }
    finally { setSyncing(false) }
  }

  const loadCloudChats = async () => {
    if (!user) { showNotice('Sign in with Google before loading cloud chats.'); return }
    setSyncing(true)
    try {
      const { data: conversations, error } = await supabase.from('conversations').select('id,title,created_at,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false })
      if (error) throw error
      const cloudChats = await Promise.all((conversations || []).map(async conversation => {
        const { data: messages, error: messageError } = await supabase.from('messages').select('role,content,created_at').eq('conversation_id', conversation.id).eq('user_id', user.id).order('created_at')
        if (messageError) throw messageError
        return { id: `cloud-${conversation.id}`, cloudId: String(conversation.id), title: conversation.title || 'Untitled conversation', createdAt: Date.parse(conversation.created_at || '') || Date.now(), updatedAt: Date.parse(conversation.updated_at || '') || Date.now(), messages: (messages || []).map(message => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.content || '', createdAt: Date.parse(message.created_at || '') || Date.now() })) } as Chat
      }))
      setChats(current => [...cloudChats, ...current.filter(chat => !chat.cloudId)])
      if (cloudChats[0]) { setCurrentChatId(cloudChats[0].id); setShowConversation(Boolean(cloudChats[0].messages.length)) }
      showNotice(`${cloudChats.length} cloud conversation${cloudChats.length === 1 ? '' : 's'} loaded.`)
    } catch (error) { showNotice(`Could not load cloud chats: ${error instanceof Error ? error.message : 'Unknown error.'}`) }
    finally { setSyncing(false) }
  }

  const signIn = async () => { window.location.href = '/auth' }
  const signOut = async () => { const { error } = await supabase.auth.signOut(); if (error) showNotice(error.message); else { setUser(null); window.location.href = '/auth' } }
  const filteredChats = chats.filter(chat => `${chat.title} ${chat.messages.map(message => message.content).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const userLabel = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Munyaradzi'

  // Omnibar rendered inline to keep textarea always mounted with stable ref
  const omnibarJsx = (docked: boolean) => <div className={`w-full rounded-2xl p-3 ${docked ? '' : 'max-w-2xl'}`} style={{ background: 'var(--bg-input)', border: `1px solid ${imageMode ? 'var(--accent-primary)' : showSandbox ? '#f59e0b' : 'var(--border-card)'}`, boxShadow: '0 8px 32px -4px rgba(0,0,0,.25)' }}>
    {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{attachments.map((file, index) => <span key={`${file.name}-${index}`} className="rounded-full px-2 py-1 text-xs" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)' }}>{file.name} <button onClick={() => setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}>{Icons.close}</button></span>)}</div>}
    <textarea ref={inputRef} value={input} onChange={event => { setInput(event.target.value); event.target.style.height = '32px'; event.target.style.height = `${Math.min(event.target.scrollHeight, 130)}px` }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend() } }} placeholder={imageMode ? 'Describe an image for AURA to generate…' : showSandbox ? 'Ask AURA to modify files, run commands, or package the project…' : 'Message AURA…'} rows={1} className="min-h-8 max-h-32 w-full resize-none bg-transparent text-sm outline-none" style={{ color: 'var(--text-main)' }} />
    <div className="mt-2 flex items-center justify-between gap-2"><div className="flex gap-1"><button onClick={() => fileInput.current?.click()} className="tool" title="Attach files">{Icons.attach}</button>{isAdmin && <button onClick={() => folderInput.current?.click()} className="tool" title="Sandbox (Admin)" style={{ color: showSandbox ? '#f59e0b' : undefined }}>⌨ <span className="hidden sm:inline">Sandbox</span></button>}<button onClick={() => { setImageMode(v => !v); setWebResearch(false) }} className={`tool ${imageMode ? 'ring-1 ring-violet-400' : ''}`} title="Image generation mode" style={imageMode ? { color: 'var(--accent-primary)' } : {}}>{Icons.image} <span className="hidden sm:inline">Image</span></button><button onClick={() => { setWebResearch(v => !v); setImageMode(false); showNotice(webResearch ? 'Research mode off.' : 'Research mode on.') }} className={`tool ${webResearch ? 'ring-1 ring-cyan-400' : ''}`}>{Icons.globe} <span className="hidden sm:inline">Research</span></button></div><div className="flex gap-1"><button onClick={handleVoice} className="tool" title="Voice input">{Icons.mic}</button><button onClick={() => handleSend()} disabled={isGenerating || (!input.trim() && !attachments.length)} className="rounded-full px-3 py-1 text-sm disabled:opacity-40" style={{ background: imageMode ? '#7c3aed' : 'var(--accent-primary)', color: '#fff' }}>{Icons.send}</button></div></div>
  </div>

  return <div className="app-root flex" style={{ background: 'var(--bg-app)', color: 'var(--text-main)', height: '100dvh', overflow: 'hidden' }}>
    <input ref={fileInput} type="file" className="hidden" multiple accept="image/*,.txt,.py,.js,.json,.html,.css,.md,.pdf,.csv" onChange={event => selectFiles(event.target.files)} />
    <input ref={folderInput} type="file" className="hidden" multiple
      // @ts-expect-error webkitdirectory not in typings
      webkitdirectory=""
      accept=".zip,.ts,.tsx,.js,.jsx,.py,.html,.css,.json,.md,.txt,.env,.sh,.yml,.yaml,.toml"
      onChange={event => selectFolderOrZip(event.target.files)} />
    <aside className="flex h-full flex-col justify-between overflow-hidden border-r p-3" style={{ width: isMobile ? 0 : (sidebarOpen ? 230 : 0), opacity: isMobile ? 0 : (sidebarOpen ? 1 : 0), pointerEvents: (isMobile || !sidebarOpen) ? 'none' : 'auto', transition: 'width 200ms ease, opacity 150ms ease', willChange: 'width', background: 'var(--bg-sidebar)', borderColor: 'var(--border-subtle)' }}><div className="min-w-[205px]"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><img src="/aura_icon.png" className="h-7 w-7" alt="AURA" /><img src="/aura_text.png" className="h-3 w-auto dark:hidden" alt="AURA" /><span className="hidden text-sm font-bold dark:inline">AURA</span></div><button onClick={() => setSidebarOpen(false)}>{Icons.sidebar}</button></div><nav className="mb-4 space-y-1">{([[Icons.edit, 'New chat', createNewChat], [Icons.search, 'Search chats', () => { setSearch(''); setModal('search') }], [Icons.image, 'Images', () => setModal('images')], [Icons.library, 'Library', () => setModal('library')]] as [React.ReactNode, string, () => void][]).map(([icon, label, action]) => <button key={label} onClick={action} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/10">{icon}<span>{label}</span></button>)}</nav><p className="px-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Recent</p><div className="mt-1 max-h-[52vh] overflow-y-auto" style={{ contain: 'layout style' }}>{chats.map(chat => <div key={chat.id} className="group flex items-center rounded-lg" style={{ background: chat.id === currentChatId ? 'var(--bg-card-hover)' : undefined, marginBottom: 2 }}>{renamingChatId === chat.id ? <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onBlur={() => { if (renameValue.trim()) setChats(c => c.map(ch => ch.id === chat.id ? { ...ch, title: renameValue.trim() } : ch)); setRenamingChatId(null) }} onKeyDown={e => { if (e.key === 'Enter') { if (renameValue.trim()) setChats(c => c.map(ch => ch.id === chat.id ? { ...ch, title: renameValue.trim() } : ch)); setRenamingChatId(null) } if (e.key === 'Escape') setRenamingChatId(null) }} className="min-w-0 flex-1 rounded bg-transparent px-2 py-1.5 text-xs outline-none ring-1 ring-inset" style={{ color: 'var(--text-main)' }} /> : <button onClick={() => { setCurrentChatId(chat.id); setShowConversation(chat.messages.length > 0) }} onDoubleClick={() => { setRenamingChatId(chat.id); setRenameValue(chat.title) }} className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs" title="Double-click to rename">{chat.title}</button>}<button onClick={() => { if (confirm(`Delete “${chat.title}”?`)) { setChats(current => { const remaining = current.filter(item => item.id !== chat.id); if (chat.id === currentChatId) { const next = remaining[0]; if (next) { setCurrentChatId(next.id); setShowConversation(next.messages.length > 0) } else { setShowConversation(false); setCurrentChatId("") } } return remaining }) } }} className="mr-1 hidden text-xs group-hover:block" title="Delete conversation">{Icons.close}</button></div>)}</div></div><div className="flex min-w-[205px] items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}><div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--bg-card-hover)' }}>{userLabel.charAt(0).toUpperCase()}</div><div><p className="max-w-[115px] truncate text-xs font-medium">{userLabel}</p><p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{user ? 'Cloud Sync' : 'Local workspace'}</p></div></div><button onClick={() => { setSettingsTab('general'); setModal('settings') }}>{Icons.settings}</button></div></aside>
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden p-4 md:px-8" style={{ paddingBottom: isMobile ? 72 : undefined }}><header className="flex items-center justify-between" style={{ minHeight: 48, paddingBottom: 8 }}>{isMobile ? (<div className="flex w-full items-center justify-between px-1"><div className="flex items-center gap-2"><img src="/aura_icon.png" className="h-6 w-6" alt="AURA" /><span className="text-sm font-bold">AURA</span></div><div className="flex items-center gap-1"><button onClick={() => setTheme(v => v === 'dark' ? 'light' : 'dark')} className="tool">{theme === 'dark' ? svg('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z') : svg('M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z')}</button><button onClick={() => { setSettingsTab('general'); setModal('settings') }} className="tool">{svg('M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z')}</button></div></div>) : (<><div>{!sidebarOpen && <button onClick={() => setSidebarOpen(true)}>{Icons.sidebar}</button>}</div><div className="flex items-center gap-2"><button onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} className="rounded-full border px-2 py-1" style={{ borderColor: 'var(--border-subtle)' }}>{theme === 'dark' ? svg('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z') : svg('M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z')}</button><button onClick={() => { setSettingsTab('general'); setModal('settings') }} className="rounded-full border px-2 py-1" style={{ borderColor: 'var(--border-subtle)' }}>{svg('M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z')}</button></div></>)}</header>
      {!showConversation ? <section className="flex flex-1 flex-col items-center justify-center text-center"><video src="/orb.mp4" autoPlay loop muted playsInline className="mb-4 h-16 w-16 md:h-20 md:w-20 rounded-full object-cover" /><h1 className="mb-4 text-xl md:text-2xl font-medium px-4">{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {userLabel}.<br />How can I help?</h1>{omnibarJsx(false)}{showSandbox && isAdmin && <div className="mt-3 w-full max-w-2xl"><SandboxPanel sessionId={sandboxSessionId} theme={theme} onInjectContext={(ctx) => { setInput(prev => prev ? prev + '\n\n' + ctx : ctx) }} /></div>}<div className="mt-7 grid w-full max-w-2xl grid-cols-2 gap-3 md:grid-cols-4">{[['🖼 Create Image', 'Create a photorealistic image of a futuristic city at night, neon lights reflecting on wet streets'], ['🐍 Write Python', 'Write a Python script that reads a CSV file, cleans the data, and plots a bar chart using matplotlib'], ['⚛️ React Component', 'Build a responsive React dashboard card component with dark mode support and animated stats'], ['🔍 Research Topic', 'Research the latest advancements in quantum computing and summarize key breakthroughs from 2025-2026']].map(([title, prompt]) => <button key={title} onClick={() => { setInput(prompt); inputRef.current?.focus() }} className="rounded-xl border p-3 text-left" style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card)' }}><p className="mt-1 text-sm font-semibold leading-tight">{title}</p></button>)}</div></section> : <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"><div className="flex items-center justify-end gap-2 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}><button title="Export as JSON" onClick={() => activeChat && downloadJson(activeChat, `${activeChat.title.replace(/[^a-z0-9]/gi, '_')}.json`)}>{Icons.download}</button><button title="Export as Markdown" onClick={() => activeChat && downloadMarkdown(activeChat)} className="text-xs px-1.5 py-1 rounded" style={{ color: 'var(--text-dim)' }}>MD</button><button title="Clear conversation" onClick={() => activeChat && updateActiveChat(chat => ({ ...chat, messages: [], updatedAt: Date.now() }))}>{Icons.trash}</button><button title="Return home" onClick={() => setShowConversation(false)}>{Icons.close}</button></div><div className="flex-1 space-y-6 overflow-y-auto py-6 px-2" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>{activeChat?.messages.map((message, index) => {
                const isUser = message.role === 'user'
                const engineLabel = message.engine ? message.engine.replace(/Qwen/gi, 'AURA') : null
                const isThinking = !isUser && !message.content && !message.imageData
                const isImageMsg = !!message.imageData
                return (
                  <div key={`${message.createdAt}-${index}`} className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    {isUser
                      ? <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-main)' }}>{userLabel.charAt(0).toUpperCase()}</div>
                      : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden" style={{ background: 'var(--bg-card-hover)' }}><img src="/aura_icon.png" alt="AURA" className="h-5 w-5 object-contain" /></div>
                    }
                    {/* Bubble */}
                    <div className={`flex flex-col gap-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`} style={{ maxWidth: isImageMsg ? 540 : '85%' }}>
                      <span className="text-[11px] font-medium px-1" style={{ color: 'var(--text-dim)' }}>{isUser ? userLabel : 'AURA'}</span>
                      {isImageMsg && message.imageData ? (
                        <ImageCard
                          imageData={message.imageData}
                          narration={message.content || undefined}
                          theme={theme}
                          onRevise={async (newPrompt: string) => {
                            const seed = Date.now()
                            const newUrl = imageProxyUrl(newPrompt, seed)
                            // Add the revision URL first
                            updateActiveChat(chat => {
                              const msgs = [...chat.messages]
                              const target = msgs[index]
                              if (!target?.imageData) return chat
                              msgs[index] = { ...target, imageData: { ...target.imageData, revisions: [...target.imageData.revisions, newUrl] } }
                              return { ...chat, messages: msgs, updatedAt: Date.now() }
                            })
                            // Fetch the blob and store it
                            try {
                              const res = await fetch(newUrl)
                              if (res.ok) {
                                const blob = await res.blob()
                                const blobUrl = URL.createObjectURL(blob)
                                updateActiveChat(chat => {
                                  const msgs = [...chat.messages]
                                  const target = msgs[index]
                                  if (!target?.imageData) return chat
                                  const revBlobs = [...(target.imageData.revisionBlobs ?? []), blobUrl]
                                  msgs[index] = { ...target, imageData: { ...target.imageData, revisionBlobs: revBlobs } }
                                  return { ...chat, messages: msgs, updatedAt: Date.now() }
                                })
                              }
                            } catch { /* blob fetch failed */ }
                          }}
                        />
                      ) : (
                        <div className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed" style={isUser
                          ? { background: theme === 'dark' ? '#d4d4d8' : '#18181b', color: theme === 'dark' ? '#18181b' : '#fafafa', borderBottomRightRadius: 4, maxWidth: '72vw' }
                          : { background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderBottomLeftRadius: 4, minWidth: 0, overflow: 'hidden', maxWidth: '100%' }
                        }>
                          {isThinking
                            ? <span className="flex items-center gap-2 py-1">
                                <span className="inline-block h-2 w-2 rounded-full animate-bounce" style={{ background: 'var(--text-dim)', animationDelay: '0ms' }} />
                                <span className="inline-block h-2 w-2 rounded-full animate-bounce" style={{ background: 'var(--text-dim)', animationDelay: '150ms' }} />
                                <span className="inline-block h-2 w-2 rounded-full animate-bounce" style={{ background: 'var(--text-dim)', animationDelay: '300ms' }} />
                                {webResearch && index === (activeChat?.messages.length ?? 0) - 1 && (
                                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Searching the web…</span>
                                )}
                              </span>
                            : <Markdown content={message.content} onSave={!isUser ? saveToLibrary : undefined} onSaveToSandbox={!isUser ? async (filename, fileContent) => {
                                const res = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sandboxSessionId, path: filename, content: fileContent }) })
                                if (res.ok) { showNotice(`Saved ${filename} to sandbox`); setShowSandbox(true) } else showNotice('Failed to save to sandbox')
                              } : undefined} theme={theme} />
                          }
                          {!isUser && !isImageMsg && !isThinking && <div className="mt-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150"><button onClick={() => { navigator.clipboard.writeText(message.content); showNotice('Copied!') }} className="rounded p-1 hover:bg-white/10" title="Copy message" style={{ color: 'var(--text-dim)' }}>{Icons.copy}</button><button onClick={() => updateActiveChat(c => { const msgs = [...c.messages]; const m = msgs[index]; if (m) { const r = m.reactions ?? { up: false, down: false }; msgs[index] = { ...m, reactions: { up: !r.up, down: false } } } return { ...c, messages: msgs } })} className="rounded p-1 text-sm hover:bg-white/10" style={{ color: message.reactions?.up ? 'var(--accent-primary)' : 'var(--text-dim)' }} title="Good response">{Icons.thumbUp}</button><button onClick={() => updateActiveChat(c => { const msgs = [...c.messages]; const m = msgs[index]; if (m) { const r = m.reactions ?? { up: false, down: false }; msgs[index] = { ...m, reactions: { up: false, down: !r.down } } } return { ...c, messages: msgs } })} className="rounded p-1 hover:bg-white/10" style={{ color: message.reactions?.down ? 'var(--accent-primary)' : 'var(--text-dim)' }} title="Bad response">{Icons.thumbDown}</button></div>}
                    {message.attachments?.length ? <div className="mt-2 flex flex-wrap gap-1">{message.attachments.map(file => <span key={file.name} className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--bg-card-hover)' }}>{Icons.attach} {file.name} · {file.size}</span>)}</div> : null}
                        </div>
                      )}
                                          </div>
                  </div>
                )
              })}<div ref={endRef} /></div>{isGenerating && <div className="pb-2 text-center"><button onClick={() => abortRef.current?.abort()} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>{Icons.stop} Stop generating</button></div>}{omnibarJsx(true)}{showSandbox && isAdmin && <SandboxPanel sessionId={sandboxSessionId} theme={theme} onInjectContext={(ctx) => { setInput(prev => prev ? prev + '\n\n' + ctx : ctx) }} />}</section>}
    </main>
    {showOnboarding && <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div className="w-full max-w-md rounded-2xl p-7" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      {onboardStep === 0 && <>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>Step 1 of 3</div>
        <h2 className="mb-1 text-xl font-semibold">Welcome to AURA</h2>
        <p className="mb-5 text-sm" style={{ color: 'var(--text-muted)' }}>Let&apos;s personalize your experience. What should AURA call you?</p>
        <input autoFocus value={onboardName} onChange={e => setOnboardName(e.target.value)} onKeyDown={e => e.key === 'Enter' && onboardName.trim() && setOnboardStep(1)} placeholder="Your name" className="w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none" style={{ borderColor: 'var(--border-card)', color: 'var(--text-main)' }} />
        <button onClick={() => onboardName.trim() && setOnboardStep(1)} disabled={!onboardName.trim()} className="mt-4 w-full rounded-xl py-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--accent-primary)', color: 'var(--bg-app)' }}>Continue</button>
      </>}
      {onboardStep === 1 && <>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>Step 2 of 3</div>
        <h2 className="mb-1 text-xl font-semibold">How will you use AURA?</h2>
        <p className="mb-5 text-sm" style={{ color: 'var(--text-muted)' }}>This helps personalize responses for your context.</p>
        <div className="grid grid-cols-2 gap-3">
          {([['personal', 'Personal use', 'Everyday tasks, creative projects, life planning'], ['developer', 'Developer', 'Coding, debugging, architecture, technical work'], ['student', 'Student', 'Research, essays, studying, learning new topics'], ['business', 'Business', 'Strategy, analysis, productivity, professional tasks']] as [string,string,string][]).map(([val, label, desc]) => (
            <button key={val} onClick={() => setOnboardUseCase(val)} className="rounded-xl border p-3 text-left transition-all" style={{ borderColor: onboardUseCase === val ? 'var(--accent-primary)' : 'var(--border-card)', background: onboardUseCase === val ? 'var(--bg-card-hover)' : 'transparent', borderWidth: onboardUseCase === val ? 2 : 1 }}>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>{desc}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setOnboardStep(0)} className="flex-1 rounded-xl border py-3 text-sm" style={{ borderColor: 'var(--border-card)' }}>Back</button>
          <button onClick={() => onboardUseCase && setOnboardStep(2)} disabled={!onboardUseCase} className="flex-1 rounded-xl py-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--accent-primary)', color: 'var(--bg-app)' }}>Continue</button>
        </div>
      </>}
      {onboardStep === 2 && <>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>Step 3 of 3</div>
        <h2 className="mb-1 text-xl font-semibold">Usage Policy</h2>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>AURA is designed to help, not harm. Please read and agree to our usage policy.</p>
        <div className="mb-4 max-h-40 overflow-y-auto rounded-xl border p-4 text-xs leading-relaxed" style={{ borderColor: 'var(--border-card)', color: 'var(--text-muted)' }}>
          <p className="mb-2 font-semibold" style={{ color: 'var(--text-main)' }}>What AURA will not help with:</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Creating weapons, explosives, or dangerous substances</li>
            <li>Illegal surveillance, stalking, or harassment of others</li>
            <li>Drug synthesis or trafficking</li>
            <li>Child sexual abuse material (CSAM) of any kind</li>
            <li>Cyberattacks on critical infrastructure</li>
            <li>Planning or facilitating violence against people</li>
          </ul>
          <p className="mt-3">Violations are logged and may result in account suspension. By using AURA you agree to use it responsibly and legally.</p>
        </div>
        <label className="flex items-start gap-3 cursor-pointer mb-4">
          <input type="checkbox" checked={onboardAgreed} onChange={e => setOnboardAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>I agree to use AURA responsibly and in accordance with applicable laws.</span>
        </label>
        <div className="flex gap-2">
          <button onClick={() => setOnboardStep(1)} className="flex-1 rounded-xl border py-3 text-sm" style={{ borderColor: 'var(--border-card)' }}>Back</button>
          <button onClick={saveOnboarding} disabled={!onboardAgreed} className="flex-1 rounded-xl py-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--accent-primary)', color: 'var(--bg-app)' }}>Get started</button>
        </div>
      </>}
    </div>
  </div>}
{notice && <div className="fixed bottom-5 left-1/2 z-[200] -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>{notice}</div>}
    {modal && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={event => { if (event.target === event.currentTarget) setModal(null) }}><div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{modal === 'settings' ? 'Preferences & Settings' : modal === 'search' ? 'Search conversations' : modal === 'images' ? 'Image workspace' : 'Library'}</h2><button onClick={() => setModal(null)}>{Icons.close}</button></div>
      {modal === 'search' && <><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search titles and messages…" className="w-full rounded-lg border bg-transparent p-3 text-sm outline-none" style={{ borderColor: 'var(--border-subtle)' }} /> <div className="mt-3 space-y-1">{filteredChats.length ? filteredChats.map(chat => <button key={chat.id} onClick={() => { setCurrentChatId(chat.id); setShowConversation(chat.messages.length > 0); setModal(null) }} className="block w-full rounded-lg p-3 text-left text-sm hover:bg-white/10">{chat.title}<span className="ml-2 text-xs" style={{ color: 'var(--text-dim)' }}>{chat.messages.length} messages</span></button>) : <p className="py-6 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No matching conversations.</p>}</div></>}
      {modal === 'images' && <><form onSubmit={(event: FormEvent) => { event.preventDefault(); if (imagePrompt.trim()) { setImages(current => [imagePrompt.trim(), ...current]); setImagePrompt('') } }} className="flex gap-2"><input value={imagePrompt} onChange={event => setImagePrompt(event.target.value)} placeholder="Describe an image to create…" className="min-w-0 flex-1 rounded-lg border bg-transparent p-2 text-sm" style={{ borderColor: 'var(--border-subtle)' }} /><button className="rounded-lg px-3 text-sm" style={{ background: 'var(--accent-primary)', color: theme === 'dark' ? '#111' : '#fff' }}>Create</button></form><p className="mt-2 text-xs" style={{ color: 'var(--text-dim)' }}>Images use the existing Pollinations-compatible prompt URL. No API key is stored for this workspace.</p><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">{images.map((prompt, index) => <figure key={`${prompt}-${index}`} className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-card)' }}><img src={`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=512&nologo=true`} alt={prompt} className="aspect-video w-full object-cover" /><figcaption className="p-2 text-xs">{prompt}</figcaption></figure>)}</div>{!images.length && <p className="py-8 text-center text-sm" style={{ color: 'var(--text-dim)' }}>Your generated images will appear here.</p>}</>}
      {modal === 'library' && <div className="space-y-3">
        <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          {(['projects', 'snippets'] as const).map(tab => (
            <button key={tab} onClick={() => setLibraryTab(tab)} className="px-3 py-2 text-xs capitalize" style={{ borderBottom: libraryTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent' }}>{tab}</button>
          ))}
        </div>
        {libraryTab === 'projects' && <div className="space-y-2">
          {chats.filter(c => c.messages.length > 1).length === 0 && <p className="py-8 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No projects yet. Start a conversation to see it here.</p>}
          {chats.filter(c => c.messages.length > 1).map(chat => (
            <div key={chat.id} className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{chat.title}</p>
                <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{chat.messages.length} messages · {new Date(chat.updatedAt).toLocaleDateString()}</p>
              </div>
              <button onClick={() => { setCurrentChatId(chat.id); setShowConversation(true); setModal(null) }} className="ml-3 shrink-0 rounded-lg px-3 py-1 text-xs" style={{ background: 'var(--bg-card-hover)' }}>Open</button>
            </div>
          ))}
        </div>}
        {libraryTab === 'snippets' && <div className="space-y-2">
          {libraryItems.length === 0 && <p className="py-8 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No snippets saved yet. Click "Save" on any code block in a chat.</p>}
          {libraryItems.map(item => (
            <div key={item.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">{item.title}</p>
                <div className="flex gap-1">
                  <button onClick={() => { setInput(item.content); setModal(null); window.setTimeout(() => inputRef.current?.focus(), 0) }} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--bg-card-hover)' }}>Insert</button>
                  <button onClick={() => navigator.clipboard.writeText(item.content)} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--bg-card-hover)' }}>{Icons.copy}</button>
                  <button onClick={() => setLibraryItems(current => current.filter(i => i.id !== item.id))} className="rounded px-2 py-1 text-xs text-red-400" style={{ background: 'var(--bg-card-hover)' }}>{Icons.trash}</button>
                </div>
              </div>
              <pre className="overflow-x-auto rounded p-2 text-xs" style={{ background: '#09090b', color: '#e4e4e7', maxHeight: 120 }}><code>{item.content.slice(0, 400)}{item.content.length > 400 ? '\n…' : ''}</code></pre>
            </div>
          ))}
        </div>}
      </div>}
      {modal === 'settings' && (<div><div className="mb-4 flex gap-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>{(['general', 'voice'] as const).map(tab => <button key={tab} onClick={() => setSettingsTab(tab)} className="px-3 py-2 text-xs capitalize" style={{ borderBottom: settingsTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent' }}>{tab === 'voice' ? 'Voice & Audio' : 'General'}</button>)}</div>{settingsTab === 'general' && <div className="space-y-4 text-sm"><label className="flex items-center justify-between">Theme<select value={theme} onChange={event => setTheme(event.target.value as 'dark' | 'light')} className="rounded border bg-transparent p-2" style={{ borderColor: 'var(--border-subtle)' }}><option value="dark">Dark</option><option value="light">Light</option></select></label><div className="rounded-lg border p-3 mt-3" style={{ borderColor: 'var(--border-card)' }}><p className="font-medium">Account</p><p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>{user?.email || 'Not signed in'}</p><button onClick={user ? signOut : signIn} className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--bg-card-hover)' }}>{user ? 'Sign out' : 'Sign in'}</button></div></div>}{settingsTab === 'voice' && <div className="space-y-3 text-sm"><p>Use your browser's Web Speech API for microphone input.</p><label className="block">Recognition language<select value={voice} onChange={event => setVoice(event.target.value)} className="mt-1 w-full rounded border bg-transparent p-2" style={{ borderColor: 'var(--border-subtle)' }}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="fr-FR">French</option><option value="es-ES">Spanish</option></select></label></div>}</div>)}</div></div>}

    {/* Mobile bottom tab bar */}
    {isMobile && <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t px-2" style={{ height: 64, background: 'var(--bg-sidebar)', borderColor: 'var(--border-subtle)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {([
        ['chat', svg('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), 'Chat'],
        ['search', svg('M11 17.25a6.25 6.25 0 1 1 0-12.5 6.25 6.25 0 0 1 0 12.5z|M16 16l4.5 4.5'), 'Search'],
        ['images', svg('M3 9l4-4 4 4 5-5 5 5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z|M3 13l4 4 4-4'), 'Images'],
        ['settings', svg('M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'), 'More'],
      ] as [string, React.ReactNode, string][]).map(([tab, icon, label]) => (
        <button key={tab} onClick={() => {
          if (tab === 'search') { setSearch(''); setModal('search') }
          else if (tab === 'images') setModal('images')
          else if (tab === 'settings') { setSettingsTab('general'); setModal('settings') }
          else { setMobileTab('chat'); setModal(null) }
        }} className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors" style={{ color: (mobileTab === tab || (tab === 'chat' && !modal)) ? 'var(--accent-primary)' : 'var(--text-dim)', background: (mobileTab === tab || (tab === 'chat' && !modal)) ? 'var(--bg-card-hover)' : 'transparent' }}>
          {icon}
          <span className="text-[10px] font-medium">{label}</span>
        </button>
      ))}
      <button onClick={() => { createNewChat(); setMobileTab('chat'); setModal(null) }} className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl" style={{ color: 'var(--text-dim)' }}>
        {svg('M12 5v14|M5 12h14')}
        <span className="text-[10px] font-medium">New</span>
      </button>
    </nav>}
  </div>
}

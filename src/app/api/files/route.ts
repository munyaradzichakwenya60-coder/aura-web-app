export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { join, relative, extname, dirname, basename } from 'path'
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'fs'
import { requireUser, rateLimited } from '@/lib/auth'
import { sessionDir, resolveInside } from '@/lib/sandbox-path'

const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB per file
const MAX_SESSION_SIZE = 50 * 1024 * 1024  // 50MB total

// Text-readable extensions
const TEXT_EXTS = new Set([
  '.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.py', '.css', '.html', '.htm',
  '.json', '.yaml', '.yml', '.toml', '.env', '.sh', '.bash', '.ps1', '.bat',
  '.csv', '.xml', '.svg', '.vue', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.php', '.rb', '.swift', '.kt', '.dart', '.r', '.sql', '.graphql', '.prisma',
  '.config', '.conf', '.ini', '.lock', '.gitignore', '.dockerignore', '.editorconfig',
])

function sessionSize(dir: string): number {
  let size = 0
  try {
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else size += statSync(p).size
      }
    }
    walk(dir)
  } catch { /* ignore */ }
  return size
}

function listFiles(dir: string, base: string): Array<{ path: string; size: number; isText: boolean }> {
  const result: Array<{ path: string; size: number; isText: boolean }> = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const abs = join(d, entry.name)
      const rel = relative(base, abs).replace(/\\/g, '/')
      if (entry.isDirectory()) walk(abs)
      else {
        const stat = statSync(abs)
        result.push({ path: rel, size: stat.size, isText: TEXT_EXTS.has(extname(entry.name).toLowerCase()) })
      }
    }
  }
  walk(dir)
  return result
}

// ── GET /api/files?session=xxx — list files ──────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (auth.response) return auth.response
  const sessionId = req.nextUrl.searchParams.get('session') ?? ''
  const filePath = req.nextUrl.searchParams.get('path') ?? ''
  const action = req.nextUrl.searchParams.get('action') ?? 'list'

  if (!sessionId) return NextResponse.json({ error: 'session required' }, { status: 400 })
  const dir = sessionDir(auth.user.id, sessionId)

  if (action === 'read' && filePath) {
    const abs = resolveInside(dir, filePath)
    if (!abs) return NextResponse.json({ error: 'Path traversal denied' }, { status: 400 })
    if (!existsSync(abs) || !statSync(abs).isFile()) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const ext = extname(abs).toLowerCase()
    if (!TEXT_EXTS.has(ext)) return NextResponse.json({ error: 'Binary file — not readable as text' }, { status: 400 })
    const content = readFileSync(abs, 'utf8')
    return NextResponse.json({ path: filePath, content })
  }

  if (action === 'download') {
    // Build a zip of the whole session dir using adm-zip
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip()
    zip.addLocalFolder(dir)
    const buf = zip.toBuffer()
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="aura-project-${sessionId.slice(0, 8)}.zip"`,
        'Content-Length': String(buf.length),
      },
    })
  }

  const files = listFiles(dir, dir)
  return NextResponse.json({ files, totalSize: sessionSize(dir) })
}

// ── POST /api/files — upload files or write a single file ────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (auth.response) return auth.response
  if (rateLimited(`files:${auth.user.id}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }
  const contentType = req.headers.get('content-type') ?? ''

  // JSON write: { session, path, content }
  if (contentType.includes('application/json')) {
    const body = await req.json() as { session?: string; path?: string; content?: string }
    const { session: sessionId, path: filePath, content } = body
    if (!sessionId || !filePath || content === undefined)
      return NextResponse.json({ error: 'session, path, content required' }, { status: 400 })

    if (typeof sessionId !== 'string' || typeof filePath !== 'string' || typeof content !== 'string')
      return NextResponse.json({ error: 'session, path, content must be strings' }, { status: 400 })
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE)
      return NextResponse.json({ error: 'File too large' }, { status: 413 })

    const dir = sessionDir(auth.user.id, sessionId)
    const abs = resolveInside(dir, filePath)
    if (!abs) return NextResponse.json({ error: 'Path traversal denied' }, { status: 400 })
    if (sessionSize(dir) + Buffer.byteLength(content, 'utf8') > MAX_SESSION_SIZE)
      return NextResponse.json({ error: 'Session storage limit reached' }, { status: 413 })

    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
    return NextResponse.json({ ok: true, path: filePath })
  }

  // Multipart: file uploads (including zips)
  const formData = await req.formData()
  const sessionId = formData.get('session')
  if (typeof sessionId !== 'string' || !sessionId) return NextResponse.json({ error: 'session required' }, { status: 400 })

  const dir = sessionDir(auth.user.id, sessionId)
  const written: string[] = []

  for (const [, value] of formData.entries()) {
    if (typeof value === 'string') continue
    const file = value as File
    if (file.size > MAX_FILE_SIZE) continue
    if (sessionSize(dir) + file.size > MAX_SESSION_SIZE) break

    const bytes = await file.arrayBuffer()
    const buf = Buffer.from(bytes)
    const name = basename(file.name)

    // Unpack zip
    if (name.endsWith('.zip')) {
      try {
        const AdmZip = (await import('adm-zip')).default
        const zip = new AdmZip(buf)
        // Budget on the *uncompressed* size so a small zip cannot expand into gigabytes.
        let unpacked = sessionSize(dir)
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue
          const abs = resolveInside(dir, entry.entryName)
          if (!abs) continue
          const size = entry.header.size
          if (size > MAX_FILE_SIZE || unpacked + size > MAX_SESSION_SIZE) continue
          unpacked += size
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, entry.getData())
          written.push(relative(dir, abs).replace(/\\/g, '/'))
        }
      } catch (e) {
        return NextResponse.json({ error: `Failed to unzip: ${e}` }, { status: 400 })
      }
    } else {
      // Plain file — write directly
      const abs = resolveInside(dir, name)
      if (!abs) continue
      writeFileSync(abs, buf)
      written.push(name)
    }
  }

  const files = listFiles(dir, dir)
  return NextResponse.json({ ok: true, written, files })
}

// ── DELETE /api/files?session=xxx — clear session ────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req)
  if (auth.response) return auth.response
  const sessionId = req.nextUrl.searchParams.get('session') ?? ''
  if (!sessionId) return NextResponse.json({ error: 'session required' }, { status: 400 })
  const dir = sessionDir(auth.user.id, sessionId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  return NextResponse.json({ ok: true })
}

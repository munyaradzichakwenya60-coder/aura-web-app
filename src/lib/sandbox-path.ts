import { join, resolve, relative, isAbsolute, sep } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, existsSync } from 'fs'

const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || '_'

/** Per-user, per-session working directory. Namespaced by user id so one account can never touch another's files. */
export function sessionDir(userId: string, sessionId: string): string {
  const dir = join(tmpdir(), 'aura-sandbox', clean(userId), clean(sessionId))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Resolves `rel` inside `dir`; returns null if it would escape (absolute path, `..`, etc.). */
export function resolveInside(dir: string, rel: string): string | null {
  try {
    const abs = resolve(dir, rel)
    const r = relative(dir, abs)
    if (!r || r === '..' || r.startsWith('..' + sep) || isAbsolute(r)) return null
    return abs
  } catch {
    return null
  }
}

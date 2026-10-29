export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { requireUser, rateLimited } from '@/lib/auth'
import { isProduction } from '@/lib/supabase/config'
import { sessionDir } from '@/lib/sandbox-path'

const MAX_OUTPUT = 20_000   // chars
const TIMEOUT_MS = 15_000   // 15s hard cap per command

// Only these variables reach the child process. The server's own environment holds
// the Supabase service-role key and every API key, none of which a shell may see.
function childEnv(cwd: string): Record<string, string> {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'LANG']
  const env: Record<string, string> = { HOME: cwd, USERPROFILE: cwd, TMPDIR: cwd, TEMP: cwd, TMP: cwd }
  for (const k of keep) { const v = process.env[k]; if (v) env[k] = v }
  return env
}

// Blocked patterns - cross-platform. This list is a speed bump against accidents, NOT a
// security boundary (a shell can always get around a regex). The real protection is that
// the route is owner-only, off by default in production, and runs without the server's secrets. (Windows PowerShell + Linux bash / Vercel)
const BLOCKED: RegExp[] = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~/i,
  /del\s+\/[sS]\s+/i,
  /format\s+[a-z]:/i,
  /rmdir\s+\/[sS]/i,
  /while\s+true\s*;?\s*do/i,
  /(curl|wget|Invoke-WebRequest)\s+.*\|\s*(bash|sh|pwsh|cmd|python|node)/i,
  /sudo\s+(su|bash|sh|passwd|visudo)/i,
  /net\s+(user|localgroup)\s+.*\/add/i,
  /reg\s+(add|delete)\s+hklm/i,
  /\b(xmrig|minerd|cryptonight)\b/i,
  /\b(nc|ncat|netcat)\s+.*-e\s+(bash|sh|cmd)/i,
  /cat\s+~\/\.(aws|ssh|gnupg)/i,
  /Get-Content\s+.*\.(aws|ssh)/i,
]

export async function POST(req: NextRequest) {
  // A shell on the server: owner only, and in production it must be switched on explicitly.
  if (isProduction && process.env.ENABLE_SANDBOX !== 'true') {
    return NextResponse.json({ error: 'The sandbox is disabled on this deployment.', output: '', exitCode: -1 }, { status: 403 })
  }
  const auth = await requireUser(req, { owner: true })
  if (auth.response) return auth.response
  if (rateLimited(`sandbox:${auth.user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many commands. Slow down.', output: '', exitCode: -1 }, { status: 429 })
  }

  try {
    const body = await req.json() as { command: string; sessionId: string; cwd?: string }
    const { command, sessionId } = body

    if (!command || typeof command !== 'string' || command.length > 4000)
      return NextResponse.json({ error: 'Invalid command.' }, { status: 400 })
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64)
      return NextResponse.json({ error: 'Invalid session ID.' }, { status: 400 })

    // Block dangerous patterns
    for (const pattern of BLOCKED) {
      if (pattern.test(command)) {
        return NextResponse.json({ error: 'Command blocked for safety: matches disallowed pattern.', output: '', exitCode: -1 }, { status: 200 })
      }
    }

    const cwd = sessionDir(auth.user.id, sessionId)
    const isWindows = process.platform === 'win32'

    // Run in PowerShell (Windows) or bash (Linux/Vercel)
    const [shell, shellArgs] = isWindows
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
      : ['bash', ['-c', command]]

    const output = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(/*turbopackIgnore: true*/ shell, shellArgs, { cwd, env: childEnv(cwd) as NodeJS.ProcessEnv, timeout: TIMEOUT_MS })

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT) proc.kill() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); if (stderr.length > MAX_OUTPUT) proc.kill() })
      proc.on('close', (code) => resolve({ stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), exitCode: code ?? 0 }))
      proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, exitCode: -1 }))

      const timer = setTimeout(() => { proc.kill(); resolve({ stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) + '\n[Timed out after 15s]', exitCode: 124 }) }, TIMEOUT_MS)
      proc.on('close', () => clearTimeout(timer))
    })

    return NextResponse.json({
      output: output.stdout,
      error: output.stderr,
      exitCode: output.exitCode,
    })
  } catch (err) {
    console.error('[sandbox] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Sandbox error.', output: '', exitCode: -1 }, { status: 500 })
  }
}

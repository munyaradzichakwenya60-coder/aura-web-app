export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, existsSync } from 'fs'

const MAX_OUTPUT = 20_000   // chars
const TIMEOUT_MS = 15_000   // 15s hard cap per command

// Sandbox dir per session — lives in OS temp, cleaned by OS
function sessionDir(sessionId: string): string {
  const dir = join(tmpdir(), 'aura-sandbox', sessionId.replace(/[^a-zA-Z0-9_-]/g, '_'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// Blocked patterns — prevent escaping the sandbox dir
const BLOCKED = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~/i,
  /del\s+\/[sS]\s+/i,
  /format\s+[a-z]:/i,
  /rmdir\s+\/[sS]/i,
  /:\s*\{\s*:\s*\|\s*:\s*\}/,
  /while\s+true\s*;?\s*do/i,
  /(curl|wget|Invoke-WebRequest)\s+.*\|\s*(bash|sh|pwsh|cmd|python|node)/i,
  /sudo\s+(su|bash|sh|passwd|visudo)/i,
  /net\s+(user|localgroup)\s+.*\/add/i,
  /reg\s+(add|delete)\s+hklm/i,
  /\b(xmrig|minerd|cryptonight)\b/i,
  /\b(nc|ncat|netcat)\s+.*-e\s+(bash|sh|cmd)/i,
  /cat\s+~\/\.(aws|ssh|gnupg)/i,
  /Get-Content\s+.*\.(aws|ssh)/i,
]\s+/i, /format\s+[a-z]:/i,
  /rmdir\s+\/[sS]/i, /:\s*{\s*:\s*\|\s*:}/,   // fork bomb
  /(curl|wget|Invoke-WebRequest)\s+.*\|\s*(bash|sh|pwsh|cmd)/i,
  /net\s+(user|localgroup)\s+.*\/add/i,          // add user
  /reg\s+(add|delete)\s+hklm/i,                  // registry writes
]

export async function POST(req: NextRequest) {
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
        return NextResponse.json({ error: `Command blocked for safety: matches disallowed pattern.`, output: '', exitCode: -1 }, { status: 200 })
      }
    }

    const cwd = sessionDir(sessionId)
    const isWindows = process.platform === 'win32'

    // Run in PowerShell (Windows) or bash (Linux/Mac)
    const [shell, shellArgs] = isWindows
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
      : ['bash', ['-c', command]]

    const output = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(shell, shellArgs, { cwd, env: { ...process.env, PATH: process.env.PATH }, timeout: TIMEOUT_MS })

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT) proc.kill() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); if (stderr.length > MAX_OUTPUT) proc.kill() })
      proc.on('close', (code) => resolve({ stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), exitCode: code ?? 0 }))
      proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, exitCode: -1 }))

      setTimeout(() => { proc.kill(); resolve({ stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) + '\n[Timed out after 15s]', exitCode: 124 }) }, TIMEOUT_MS)
    })

    return NextResponse.json({
      output: output.stdout,
      error: output.stderr,
      exitCode: output.exitCode,
      cwd,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err), output: '', exitCode: -1 }, { status: 500 })
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, isProduction } from '@/lib/supabase/config'

export type AuthedUser = {
  id: string
  email: string | null
  /** True only for the deployment owner (ADMIN_EMAIL with a confirmed email address). */
  isOwner: boolean
}

type Guard = { user: AuthedUser; response?: undefined } | { user?: undefined; response: NextResponse }

function ownerEmail(): string {
  return (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL || '').trim().toLowerCase()
}

/**
 * Verifies the caller against Supabase (getUser() validates the JWT with the auth
 * server) and returns the user, or a ready-made error response.
 *
 * Fails closed: in production a deployment without Supabase configured rejects
 * every call. Outside production an unconfigured app runs as a local dev user so
 * the README "local Ollama only" setup keeps working.
 */
export async function requireUser(req: NextRequest, opts: { owner?: boolean } = {}): Promise<Guard> {
  const config = getSupabaseConfig()

  if (!config) {
    if (isProduction) {
      return { response: NextResponse.json({ error: 'Authentication is not configured on this deployment.' }, { status: 503 }) }
    }
    return { user: { id: 'local-dev', email: null, isOwner: true } }
  }

  let id: string | null = null
  let email: string | null = null
  let confirmed = false
  try {
    const supabase = createServerClient(config.url, config.key, {
      cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
    })
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) {
      id = data.user.id
      email = data.user.email ?? null
      confirmed = Boolean(data.user.email_confirmed_at)
    }
  } catch { /* treat as signed out */ }

  if (!id) {
    return { response: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) }
  }

  const owner = ownerEmail()
  const isOwner = Boolean(owner && email && confirmed && email.toLowerCase() === owner)
  if (opts.owner && !isOwner) {
    return { response: NextResponse.json({ error: 'Not allowed.' }, { status: 403 }) }
  }
  return { user: { id, email, isOwner } }
}

// Small in-memory limiter. Serverless instances do not share memory, so this only
// slows down abuse from a single warm instance; it is a safety net, not a quota.
const hits = new Map<string, number[]>()
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k)
  }
  return recent.length > limit
}

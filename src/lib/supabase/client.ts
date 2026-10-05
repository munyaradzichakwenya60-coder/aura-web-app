import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

  // During static build / prerender, env vars are absent.
  // Return a real client anyway -- Supabase SSR handles missing creds gracefully
  // at call time (throws on actual auth calls, not on construction).
  return createBrowserClient(
    url || 'https://placeholder.supabase.co',
    publishableKey || 'placeholder-key',
  )
}

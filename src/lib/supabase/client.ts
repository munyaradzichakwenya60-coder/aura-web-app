import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseConfig } from '@/lib/supabase/config'

export function createClient() {
  const config = getSupabaseConfig()

  // During static build / prerender, env vars are absent.
  // Return a real client anyway -- Supabase SSR handles missing creds gracefully
  // at call time (throws on actual auth calls, not on construction).
  return createBrowserClient(
    config?.url || 'https://placeholder.supabase.co',
    config?.key || 'placeholder-key',
  )
}

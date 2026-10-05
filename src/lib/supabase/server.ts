import { createClient } from '@supabase/supabase-js'

// Service-role client — only used server-side in API routes.
// Never expose this key to the browser.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    // Gracefully degrade: return null so callers can skip DB ops
    return null
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

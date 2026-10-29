// Single place that decides which Supabase URL / key the app uses.
//
// NEXT_PUBLIC_* names are the documented ones. The un-prefixed names are accepted
// too (next.config.ts copies them into the NEXT_PUBLIC_* slots at build time) so a
// deployment that only set SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY still works
// instead of silently running with authentication switched off.
//
// Each variable is referenced literally so Next.js can inline it for the browser.

export type SupabaseConfig = { url: string; key: string }

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim()
  if (!url || !key) return null
  return { url, key }
}

export const isProduction = process.env.NODE_ENV === 'production'

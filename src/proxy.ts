import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, isProduction } from '@/lib/supabase/config'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthRoute = pathname.startsWith('/auth')
  const isApiRoute = pathname.startsWith('/api')
  const config = getSupabaseConfig()

  // Supabase not configured. This used to let every request through, which is how
  // a deployment with mis-named env vars ended up with the app open to everyone.
  // In production we now fail closed. Local development stays open so the app can
  // still be used with just Ollama.
  if (!config) {
    if (!isProduction) return NextResponse.next({ request })
    if (isApiRoute) {
      return NextResponse.json({ error: 'Authentication is not configured on this deployment.' }, { status: 503 })
    }
    if (isAuthRoute) return NextResponse.next({ request })
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth'
    redirectUrl.search = '?error=not_configured'
    return NextResponse.redirect(redirectUrl)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // IMPORTANT: Use getUser() not getSession() -- getUser() validates the JWT
  // with the Supabase auth server on every request, preventing session spoofing
  // or cached sessions leaking to other users on shared edge infrastructure.
  let isAuthenticated = false
  try {
    const { data: { user } } = await supabase.auth.getUser()
    isAuthenticated = Boolean(user)
  } catch {
    // Auth server unreachable: treat as signed out rather than letting the request through.
    isAuthenticated = false
  }

  // Unauthenticated users can only reach /auth pages. API calls get a 401, not a redirect.
  if (!isAuthenticated && !isAuthRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
    }
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  // Authenticated users hitting /auth are sent to the app
  if (isAuthenticated && isAuthRoute && pathname !== '/auth/reset') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // manifest.json is fetched by the browser without cookies, so it must stay public.
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)',
  ],
}

'use client'

export const dynamic = 'force-dynamic'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Mode = 'login' | 'signup'

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
)

export default function AuthPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [focused, setFocused] = useState<string | null>(null)

  useEffect(() => {
    // Client-side redirect: getSession() is fine here — the middleware
    // is the real security gate. This just avoids flashing the form.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/')
    })
  }, [supabase, router])

  const handleGoogle = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })
      if (error) setError(error.message)
      else setSuccess('Check your email to confirm your account, then sign in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.replace('/')
    }
    setLoading(false)
  }

  const switchMode = (m: Mode) => { setMode(m); setError(''); setSuccess('') }

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    background: '#fff',
    border: `1.5px solid ${focused === field ? '#111' : '#E5E5E5'}`,
    color: '#111',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  })

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100%',
      background: '#F7F7F8',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      color: '#111',
      alignItems: 'stretch',
    }}>

      {/* ── Left panel ── */}
      <div style={{
        width: '48%',
        display: 'none',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111116',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflow: 'hidden',
      }} className="auth-left">
        {/* Subtle radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 65% 55% at 50% 52%, rgba(110,50,230,0.22) 0%, transparent 68%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {/* Orb */}
          <video
            src="/orb.mp4"
            autoPlay loop muted playsInline
            style={{
              width: 200, height: 200,
              borderRadius: '50%',
              objectFit: 'cover',
              boxShadow: '0 0 72px -8px rgba(110,50,230,0.6), 0 0 28px rgba(56,189,248,0.18)',
              marginBottom: 36,
              display: 'block',
            }}
          />

          {/* Logo */}
          <img
            src="/aura_text_dark.png"
            alt="AURA"
            style={{ height: 18, marginBottom: 14, opacity: 0.92 }}
          />

          {/* Tagline */}
          <p style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.42)',
            textAlign: 'center',
            lineHeight: 1.65,
            maxWidth: 260,
            margin: '0 0 40px',
          }}>
            Neural intelligence, redefined.<br />Your next-gen AI reasoning platform.
          </p>


        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '48px 24px 48px',
        minHeight: '100vh',
      }}>
        <div style={{ width: '100%', maxWidth: 420 }}>

          {/* Logo (always visible on small; only on small on large) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
            <img src="/aura_icon.png" alt="AURA" style={{ height: 30, width: 30, borderRadius: '50%' }} />
            <img src="/aura_text.png" alt="AURA" style={{ height: 14 }} />
          </div>

          {/* Heading */}
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.4px', color: '#111' }}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p style={{ fontSize: 13, color: '#888', margin: '0 0 28px' }}>
            {mode === 'login' ? 'Sign in to continue to AURA' : 'Join AURA — it takes less than a minute'}
          </p>

          {/* Tab switcher */}
          <div style={{
            display: 'flex',
            background: '#ECECEE',
            borderRadius: 11,
            padding: 4,
            marginBottom: 24,
            gap: 4,
          }}>
            {(['login', 'signup'] as Mode[]).map(m => (
              <button key={m} onClick={() => switchMode(m)} style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                background: mode === m ? '#fff' : 'transparent',
                color: mode === m ? '#111' : '#999',
                border: 'none',
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}>
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>

          {/* Google OAuth */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '11px 0',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              background: '#fff',
              border: '1.5px solid #E5E5E5',
              color: '#111',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'border-color 0.15s, box-shadow 0.15s',
              marginBottom: 20,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#CCC'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.boxShadow = 'none' }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: '#E8E8E8' }} />
            <span style={{ fontSize: 11, color: '#BBB', whiteSpace: 'nowrap' }}>or continue with email</span>
            <div style={{ flex: 1, height: 1, background: '#E8E8E8' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {mode === 'signup' && (
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>
                    Full name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Munyaradzi"
                    required
                    style={inputStyle('name')}
                    onFocus={() => setFocused('name')}
                    onBlur={() => setFocused(null)}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  style={inputStyle('email')}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#444' }}>Password</label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!email) { setError('Enter your email first.'); return }
                        setLoading(true)
                        const { error } = await supabase.auth.resetPasswordForEmail(email, {
                          redirectTo: `${window.location.origin}/auth/reset`,
                        })
                        setLoading(false)
                        if (error) setError(error.message)
                        else setSuccess('Password reset email sent.')
                      }}
                      style={{
                        fontSize: 12,
                        color: '#666',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        padding: 0,
                      }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                  required
                  minLength={mode === 'signup' ? 8 : 1}
                  style={inputStyle('password')}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                />
              </div>

              {/* Feedback */}
              {error && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 9,
                  fontSize: 13,
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#DC2626',
                }}>{error}</div>
              )}
              {success && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 9,
                  fontSize: 13,
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  color: '#16A34A',
                }}>{success}</div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  background: loading ? '#E5E5E5' : '#111',
                  color: loading ? '#999' : '#fff',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                  letterSpacing: '-0.1px',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  marginTop: 4,
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#222' }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#111' }}
              >
                {loading ? 'Please wait…' : mode === 'login' ? 'Sign in to AURA' : 'Create account'}
              </button>
            </div>
          </form>

          {/* Mode switch */}
          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#888' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
              style={{
                color: '#111',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {mode === 'login' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>

          <p style={{ textAlign: 'center', marginTop: 28, fontSize: 11, color: '#C0C0C0', lineHeight: 1.5 }}>
            By continuing you agree to our Terms of Service<br />and Privacy Policy.
          </p>
        </div>
      </div>

      {/* CSS for the left panel (lg breakpoint) */}
      <style>{`
        @media (min-width: 1024px) {
          .auth-left { display: flex !important; }
        }
      `}</style>
    </div>
  )
}

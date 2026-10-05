'use client'

import { FormEvent, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [focused, setFocused] = useState<string | null>(null)

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%', padding: '11px 14px', borderRadius: 10,
    background: '#fff',
    border: `1.5px solid ${focused === field ? '#111' : '#E5E5E5'}`,
    color: '#111', fontSize: 14, outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) setError(error.message)
    else { setSuccess('Password updated. Redirecting…'); setTimeout(() => router.replace('/'), 1500) }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F7F7F8', color: '#111',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Plus Jakarta Sans', sans-serif", padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
          <img src="/aura_icon.png" alt="AURA" style={{ height: 30, width: 30, borderRadius: '50%' }} />
          <img src="/aura_text.png" alt="AURA" style={{ height: 14 }} />
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.4px' }}>Set new password</h1>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 28px' }}>
          Choose a strong password for your AURA account.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>New password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters" required minLength={8}
                style={inputStyle('password')}
                onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>Confirm password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password" required
                style={inputStyle('confirm')}
                onFocus={() => setFocused('confirm')} onBlur={() => setFocused(null)} />
            </div>

            {error && <div style={{ padding: '10px 14px', borderRadius: 9, fontSize: 13, background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>{error}</div>}
            {success && <div style={{ padding: '10px 14px', borderRadius: 9, fontSize: 13, background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#16A34A' }}>{success}</div>}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px 0', borderRadius: 10,
              fontSize: 14, fontWeight: 600,
              background: loading ? '#E5E5E5' : '#111',
              color: loading ? '#999' : '#fff',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              marginTop: 4,
            }}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

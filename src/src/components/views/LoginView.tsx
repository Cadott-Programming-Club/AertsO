'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface Me {
  email: string
  isAdmin: boolean
}

// Email OTP login. In dev (SMTP not configured) the code is shown in the UI.
export function LoginView({ onSuccess, embedded = false }: { onSuccess: (me: Me) => void; embedded?: boolean }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [info, setInfo] = useState('')

  const requestCode = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.')
        return
      }
      setStage('code')
      setDevCode(json.devCode ?? null)
      setInfo(json.emailed ? `Code sent to ${email} — it expires in 10 minutes.` : 'Code generated.')
      if (json.devCode) setInfo(`Dev mode (no SMTP): your code is ${json.devCode}`)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.')
        return
      }
      onSuccess({ email: json.user.email, isAdmin: json.user.isAdmin })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={embedded ? '' : 'card-wrapper'}>
      {!embedded && <h2 className="text-2xl font-bold tracking-tight mb-1">Sign in</h2>}
      {!embedded && <p className="text-sm text-muted-foreground mb-4">No password — we email you a one-time code.</p>}
      <div className="flex flex-col gap-3">
        {stage === 'email' ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={embedded ? 'login-email-2' : 'login-email'}>Email</Label>
              <Input
                id={embedded ? 'login-email-2' : 'login-email'}
                type="email"
                autoComplete="email"
                placeholder="you@school.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && requestCode()}
              />
            </div>
            <Button disabled={busy || !email.includes('@')} onClick={requestCode}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={embedded ? 'login-code-2' : 'login-code'}>6-digit code</Label>
              <Input
                id={embedded ? 'login-code-2' : 'login-code'}
                inputMode="numeric"
                maxLength={6}
                placeholder="••••••"
                className="text-lg tracking-[0.4em] font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
              />
            </div>
            <Button disabled={busy || code.length !== 6} onClick={verify}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <button
              className="text-xs text-muted-foreground hover:underline self-start"
              onClick={() => {
                setStage('email')
                setCode('')
                setDevCode(null)
                setInfo('')
              }}
            >
              Use a different email
            </button>
          </>
        )}
        {info && stage === 'code' && !error && <p className="text-xs text-muted-foreground">{info}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}

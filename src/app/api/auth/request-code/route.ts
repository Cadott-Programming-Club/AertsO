import { NextResponse } from 'next/server'
import { createLoginCode, sendLoginCode, smtpConfigured } from '@/lib/auth'

export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({ email: '' }))
  const normalized = (email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  const code = await createLoginCode(normalized)
  let emailed = false
  try {
    emailed = await sendLoginCode(normalized, code)
  } catch (e) {
    console.error('[aertso] mail send failed', e)
    return NextResponse.json({ error: 'Could not send the email right now. Try again.' }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    emailed,
    // dev convenience: surface the code when SMTP is not configured
    devCode: smtpConfigured() ? undefined : code,
  })
}

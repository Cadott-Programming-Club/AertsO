import { NextResponse } from 'next/server'
import { consumeLoginCode, createSession, findOrCreateUser } from '@/lib/auth'

export async function POST(req: Request) {
  const { email, code } = await req.json().catch(() => ({ email: '', code: '' }))
  const normalized = (email ?? '').trim().toLowerCase()
  if (!normalized || !code) {
    return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 })
  }
  const result = await consumeLoginCode(normalized, code)
  if (result === 'bad') return NextResponse.json({ error: 'That code is not right.' }, { status: 400 })
  if (result === 'expired') return NextResponse.json({ error: 'That code expired — request a new one.' }, { status: 400 })
  if (result === 'locked') return NextResponse.json({ error: 'Too many attempts — request a new code.' }, { status: 429 })

  const user = await findOrCreateUser(normalized)
  await createSession(user.id)
  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, isAdmin: user.isAdmin } })
}

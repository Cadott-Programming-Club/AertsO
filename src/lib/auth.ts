import { db, schemaReady } from '@/lib/db'
import { cookies, headers } from 'next/headers'
import crypto from 'crypto'

const SESSION_COOKIE = 'aertso_session'
const SESSION_DAYS = 30

export interface SessionUser {
  id: string
  email: string
  isAdmin: boolean
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string) {
  return adminEmails().includes(normalizeEmail(email))
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

// ---- login codes -----------------------------------------------------------------------
export async function createLoginCode(email: string) {
  // First DB touch on a fresh deploy — make sure the cold-start schema
  // bootstrap (table creation) has settled before writing.
  await schemaReady()
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await db.aertsOLoginCode.create({
    data: {
      email: normalizeEmail(email),
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  return code
}

export async function consumeLoginCode(email: string, code: string): Promise<'ok' | 'bad' | 'expired' | 'locked'> {
  const normalized = normalizeEmail(email)
  const rec = await db.aertsOLoginCode.findFirst({
    where: { email: normalized, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!rec) return 'bad'
  if (rec.expiresAt < new Date()) return 'expired'
  if (rec.attempts >= 5) return 'locked'
  if (rec.code !== code.trim()) {
    await db.aertsOLoginCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } })
    return 'bad'
  }
  await db.aertsOLoginCode.update({ where: { id: rec.id }, data: { consumedAt: new Date() } })
  return 'ok'
}

// ---- sessions --------------------------------------------------------------------------
export async function createSession(userId: string) {
  const token = randomToken()
  await db.aertsOSession.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  })
  const jar = await cookies()
  // Mark the cookie Secure only on https (Vercel sets x-forwarded-proto);
  // plain-http local prod builds keep a usable session cookie.
  const proto = ((await headers()).get('x-forwarded-proto') ?? 'http').split(',')[0].trim()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
  return token
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    await db.aertsOSession.deleteMany({ where: { token } })
    jar.delete(SESSION_COOKIE)
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE)?.value
    if (!token) return null
    const session = await db.aertsOSession.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!session || session.expiresAt < new Date()) return null
    // env is the source of truth for admin rights
    const isAdmin = isAdminEmail(session.user.email)
    if (session.user.isAdmin !== isAdmin) {
      await db.aertsOUser.update({ where: { id: session.user.id }, data: { isAdmin } })
    }
    return { id: session.user.id, email: session.user.email, isAdmin }
  } catch {
    return null
  }
}

export async function findOrCreateUser(email: string) {
  const normalized = normalizeEmail(email)
  const admin = isAdminEmail(normalized)
  const existing = await db.aertsOUser.findUnique({ where: { email: normalized } })
  if (existing) {
    if (existing.isAdmin !== admin) {
      return db.aertsOUser.update({ where: { id: existing.id }, data: { isAdmin: admin } })
    }
    return existing
  }
  return db.aertsOUser.create({ data: { email: normalized, isAdmin: admin } })
}

// ---- mailer ----------------------------------------------------------------------------
export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT)
}

export async function sendLoginCode(email: string, code: string) {
  if (!smtpConfigured()) {
    // dev fallback: log it; the API also returns devCode when unset
    console.log(`[aertso] login code for ${email}: ${code}`)
    return false
  }
  const nodemailer = await import('nodemailer')
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  })
  await transport.sendMail({
    from: process.env.MAIL_FROM ?? 'AertsO <noreply@ddylongneck.com>',
    to: email,
    subject: 'Your AertsO sign-in code',
    text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif">
      <h2 style="margin-bottom:4px">AertsO sign-in</h2>
      <p style="color:#555">Enter this code to sign in. It expires in 10 minutes.</p>
      <p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:18px 0">${code}</p>
      <p style="color:#888;font-size:12px">Didn't request this? Ignore this email.</p>
    </div>`,
  })
  return true
}

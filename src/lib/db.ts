import { PrismaClient } from '@prisma/client'

// The Vercel<->Supabase integration's POSTGRES_PRISMA_URL can carry
// routing/telemetry query params (e.g. supa=...) that the Prisma query engine
// rejects. Keep only params Prisma understands before the client resolves
// env("POSTGRES_PRISMA_URL") from the schema.
function sanitizePrismaUrl() {
  const raw = process.env.POSTGRES_PRISMA_URL
  if (!raw) return
  try {
    const u = new URL(raw)
    const keep = new URLSearchParams()
    for (const k of ['pgbouncer', 'connection_limit', 'connect_timeout', 'pool_timeout', 'sslmode', 'ssl']) {
      const v = u.searchParams.get(k)
      if (v !== null) keep.set(k, v)
    }
    const cleaned = u.origin + u.pathname + (keep.toString() ? `?${keep.toString()}` : '')
    if (cleaned !== raw) process.env.POSTGRES_PRISMA_URL = cleaned
  } catch {
    // not a parseable URL — leave untouched and let Prisma surface the error
  }
}
sanitizePrismaUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaRls: Promise<void> | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// ---------------------------------------------------------------------------
// Security bootstrap (Postgres only): enable RLS on every AertsO table with no
// policies — deny-by-default for anon/authenticated keys. The app's direct
// connection (postgres role) is unaffected, so nothing changes at runtime.
// Idempotent, fire-and-forget; matches the posture of the other club sites on
// the shared Supabase project. Skipped on SQLite (local dev has no RLS).
// ---------------------------------------------------------------------------
const RLS_TABLES = [
  'AertsOUser',
  'AertsOSession',
  'AertsOLoginCode',
  'AertsOItem',
  'AertsOBoard',
  'AertsOSubmission',
  'AertsOAnswerKey',
]

async function ensureRls() {
  const url = process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL ?? ''
  if (!/^postgres(ql)?:\/\//i.test(url)) return
  for (const t of RLS_TABLES) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`)
    } catch (e) {
      console.error(`[aertso] could not enable RLS on ${t}`, e)
    }
  }
}

globalForPrisma.prismaRls ??= ensureRls().catch((e) => console.error('[aertso] RLS bootstrap failed', e))

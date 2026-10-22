import { PrismaClient } from '@prisma/client'
import { sanitizePrismaUrl } from './prisma-url'
import { ensureSchema } from './bootstrap'

// Hosting integrations can append query params the Prisma engines reject
// (e.g. supa=…). Sanitize before the client resolves env("POSTGRES_PRISMA_URL").
const rawUrl = process.env.POSTGRES_PRISMA_URL
if (rawUrl) {
  const cleaned = sanitizePrismaUrl(rawUrl)
  if (cleaned !== rawUrl) process.env.POSTGRES_PRISMA_URL = cleaned
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchema: Promise<void> | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// ---------------------------------------------------------------------------
// Cold-start bootstrap (Postgres only): create any missing AertsO* tables
// (idempotent) and enable RLS — deny-by-default for anon/authenticated keys;
// the app's direct connection (postgres role) is unaffected.
//
// This runs at module load, fire-and-forget. Login writes to the DB, so the
// tables must exist before anyone can even sign in — this is what makes a
// fresh deploy usable. Routes that touch the DB before login can
// `await schemaReady()` to order themselves after the bootstrap.
// Skipped on SQLite (local dev has no RLS and uses `prisma db push`).
// ---------------------------------------------------------------------------
globalForPrisma.prismaSchema ??= ensureSchema(db).catch((e) =>
  console.error('[aertso] schema bootstrap failed', e),
)

export function schemaReady(): Promise<void> {
  return globalForPrisma.prismaSchema ?? Promise.resolve()
}

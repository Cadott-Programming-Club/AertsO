import type { PrismaClient } from '@prisma/client'

// Shared DB bootstrap: the exact DDL for the AertsO* tables (mirrors
// prisma/schema.prisma — types, defaults, indexes, FK actions) plus RLS enable.
// Single source of truth for both the cold-start bootstrap in lib/db.ts and the
// admin-only /api/admin/setup route.
//
// Why auto-bootstrap: login itself writes to the database (login codes), so on a
// fresh deploy the tables must exist BEFORE anyone can sign in — an
// admin-gated "Initialize" button is unreachable until after login. Creating
// them at cold start breaks the deadlock (same pattern as pep-band's
// import-time create_tables()).
//
// NEVER create these tables with `prisma db push` on the shared Supabase
// project: the AertsO schema doesn't know the other apps' tables and db push
// will demand dropping them.

export const TABLES = [
  'AertsOUser',
  'AertsOSession',
  'AertsOLoginCode',
  'AertsOItem',
  'AertsOBoard',
  'AertsOSubmission',
  'AertsOAnswerKey',
] as const

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "AertsOUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AertsOUser_email_key" ON "AertsOUser"("email")`,

  `CREATE TABLE IF NOT EXISTS "AertsOSession" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AertsOSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AertsOUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "AertsOSession_userId_idx" ON "AertsOSession"("userId")`,

  `CREATE TABLE IF NOT EXISTS "AertsOLoginCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "AertsOLoginCode_email_idx" ON "AertsOLoginCode"("email")`,

  `CREATE TABLE IF NOT EXISTS "AertsOItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AertsOItem_text_key" ON "AertsOItem"("text")`,

  `CREATE TABLE IF NOT EXISTS "AertsOBoard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AertsOBoard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AertsOUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AertsOBoard_code_key" ON "AertsOBoard"("code")`,
  `CREATE INDEX IF NOT EXISTS "AertsOBoard_ownerId_idx" ON "AertsOBoard"("ownerId")`,

  `CREATE TABLE IF NOT EXISTS "AertsOSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marks" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AertsOSubmission_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "AertsOBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AertsOSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AertsOUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AertsOSubmission_boardId_key" ON "AertsOSubmission"("boardId")`,
  `CREATE INDEX IF NOT EXISTS "AertsOSubmission_userId_idx" ON "AertsOSubmission"("userId")`,

  `CREATE TABLE IF NOT EXISTS "AertsOAnswerKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemIds" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
  )`,
]

const RLS: string[] = TABLES.map(
  (t) => `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`,
)

export async function publicTables(db: PrismaClient): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  )
  return new Set(rows.map((r) => r.table_name))
}

// Idempotent: creates any missing AertsO* tables and enables RLS on all of
// them. No-op on SQLite (local dev) and when everything already exists.
export async function ensureSchema(db: PrismaClient): Promise<void> {
  const url = process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL ?? ''
  if (!/^postgres(ql)?:\/\//i.test(url)) return

  let existing: Set<string>
  try {
    existing = await publicTables(db)
  } catch (e) {
    console.error('[aertso] schema bootstrap could not list tables:', (e as Error).message)
    return
  }

  const missing = TABLES.filter((t) => !existing.has(t))
  const statements = [...(missing.length ? DDL : []), ...RLS]
  for (const stmt of statements) {
    try {
      await db.$executeRawUnsafe(stmt)
    } catch (e) {
      console.error('[aertso] schema bootstrap statement failed:', (e as Error).message)
    }
  }
}

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { db } from '@/lib/db'

// Admin: create the AertsO tables on the connected Supabase/Postgres database.
// Idempotent (CREATE TABLE IF NOT EXISTS) — safe to press repeatedly. The build
// script already best-effort runs `prisma db push` (same schema); this route is
// the browser-only fallback so a fresh deploy can be fully initialized with no
// local tooling: log in as admin, press the button, done.

const TABLES = [
  'AertsOUser',
  'AertsOSession',
  'AertsOLoginCode',
  'AertsOItem',
  'AertsOBoard',
  'AertsOSubmission',
  'AertsOAnswerKey',
]

// Mirrors prisma/schema.prisma exactly (types, defaults, indexes, FK actions),
// then enables RLS on every table — deny-by-default for anon/authenticated
// keys, same posture db.ts applies at runtime.
const DDL: string[] = [
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

async function existingTables(): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    TABLES,
  )
  return rows.map((r) => r.table_name)
}

// GET: readiness probe (used by the admin panel banner).
export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  try {
    const existing = await existingTables()
    return NextResponse.json({
      ready: existing.length === TABLES.length,
      existing: existing.length,
      total: TABLES.length,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, ready: false }, { status: 500 })
  }
}

// POST: run the DDL.
export async function POST() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  try {
    const before = await existingTables()
    for (const stmt of DDL) {
      await db.$executeRawUnsafe(stmt)
    }
    for (const t of TABLES) {
      await db.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`)
    }
    const after = await existingTables()
    return NextResponse.json({
      ok: true,
      ready: after.length === TABLES.length,
      created: after.length - before.length,
      existing: after.length,
      total: TABLES.length,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

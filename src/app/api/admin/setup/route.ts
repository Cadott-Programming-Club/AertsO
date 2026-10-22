import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { db, schemaReady } from '@/lib/db'
import { TABLES, DDL } from '@/lib/bootstrap'

// Admin: database status + manual table initialization. The app already
// auto-creates the AertsO* tables at cold start (lib/bootstrap.ts); this route
// exists as an explicit, observable fallback — the admin panel probes GET and
// shows an "Initialize database" button when anything is missing. Idempotent.

async function countAertsTables(): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  )
  const names = new Set(rows.map((r) => r.table_name))
  return TABLES.filter((t) => names.has(t)).length
}

// GET: readiness probe (used by the admin panel banner).
export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  try {
    await schemaReady()
    const existing = await countAertsTables()
    return NextResponse.json({
      ready: existing === TABLES.length,
      existing,
      total: TABLES.length,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, ready: false }, { status: 500 })
  }
}

// POST: run the DDL + RLS (same statements as the cold-start bootstrap).
export async function POST() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  try {
    const before = await countAertsTables()
    for (const stmt of DDL) {
      await db.$executeRawUnsafe(stmt)
    }
    for (const t of TABLES) {
      await db.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`)
    }
    const after = await countAertsTables()
    return NextResponse.json({
      ok: true,
      ready: after === TABLES.length,
      created: after - before,
      existing: after,
      total: TABLES.length,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { createBoard, boardView } from '@/lib/boards'
import type { AertsOBoard } from '@prisma/client'

// Admin: print a batch of unassigned boards (players claim them by scanning).
// Generating a batch starts a FRESH GAME — the previous cycle's boards, their
// scans, and the answer keys are cleared first. Without the key wipe, stale
// keys from the last game would "release" scores for the new boards against
// the old consensus the moment a player scans (release state is computed
// live from the keys), and old-sheet codes would keep resolving.
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const { count } = await req.json().catch(() => ({ count: 1 }))
  const n = Math.min(Math.max(Number(count) || 1, 1), 60)
  try {
    // FK order: submissions reference boards, so clear them first (the DDL
    // cascades too, but explicit deletes keep this provider-agnostic).
    const clearedSubmissions = (await db.aertsOSubmission.deleteMany({})).count
    const clearedBoards = (await db.aertsOBoard.deleteMany({})).count
    const clearedKeys = (await db.aertsOAnswerKey.deleteMany({})).count

    const boards: AertsOBoard[] = []
    for (let i = 0; i < n; i++) {
      boards.push(await createBoard(null))
    }
    return NextResponse.json({
      ok: true,
      clearedBoards,
      clearedSubmissions,
      clearedKeys,
      boards: await Promise.all(boards.map((b) => boardView(b))),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

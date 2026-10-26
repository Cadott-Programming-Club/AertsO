import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { getAnswerKeyState } from '@/lib/boards'
import { recomputeAutoScores, scoreRows } from '@/lib/scores'

const MAX_ABS = 1_000_000

// Admin: full score table (emails, auto/manual split, notes) — visible even
// while scores are sealed, since admins already see every board's status.
export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const [rows, state] = await Promise.all([scoreRows(), getAnswerKeyState()])
  return NextResponse.json({
    rows,
    released: state.released,
    rules: { perCalledMark: 1, perBingoLine: 10 },
  })
}

// Admin: change a player's score, or force a recompute.
//   { userId, total, note? }  — set the player's TOTAL (stored as manual = total - auto,
//                               so future scan points still add on top)
//   { userId, delta, note? }  — nudge the manual adjustment by delta
//   { action: 'recompute' }   — rescore everyone from current scans + consensus
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))

  if (body?.action === 'recompute') {
    await recomputeAutoScores()
    return NextResponse.json({ ok: true, rows: await scoreRows() })
  }

  const { userId, note } = body ?? {}
  const hasTotal = Number.isFinite(Number(body?.total))
  const hasDelta = Number.isFinite(Number(body?.delta))
  if (typeof userId !== 'string' || (!hasTotal && !hasDelta)) {
    return NextResponse.json({ error: 'Send userId plus total or delta (or action:"recompute").' }, { status: 400 })
  }
  if (note !== undefined && note !== null && String(note).length > 200) {
    return NextResponse.json({ error: 'Note is too long (200 max).' }, { status: 400 })
  }

  const target = await db.aertsOUser.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ error: 'No such player.' }, { status: 404 })

  // refresh auto first so the stored adjustment matches what the admin sees
  await recomputeAutoScores()
  const current = await db.aertsOScore.findUnique({ where: { userId } })

  let manual: number
  if (hasTotal) {
    const total = Math.trunc(Number(body.total))
    if (Math.abs(total) > MAX_ABS) return NextResponse.json({ error: 'Score out of range.' }, { status: 400 })
    manual = total - (current?.auto ?? 0)
  } else {
    const delta = Math.trunc(Number(body.delta))
    if (Math.abs(delta) > MAX_ABS) return NextResponse.json({ error: 'Adjustment out of range.' }, { status: 400 })
    manual = (current?.manual ?? 0) + delta
  }
  if (Math.abs(manual) > 2 * MAX_ABS) {
    return NextResponse.json({ error: 'Adjustment out of range.' }, { status: 400 })
  }

  const noteValue =
    note === undefined
      ? (current?.note ?? null)
      : note === null || String(note).trim() === ''
        ? null
        : String(note).trim()

  await db.aertsOScore.upsert({
    where: { userId },
    create: { userId, manual, note: noteValue, updatedBy: user.email },
    update: { manual, note: noteValue, updatedBy: user.email },
  })

  const rows = await scoreRows()
  const row = rows.find((r) => r.userId === userId)
  return NextResponse.json({ ok: true, rows, row })
}

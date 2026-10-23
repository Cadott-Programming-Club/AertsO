import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, activeItems } from '@/lib/boards'
import { normalizeCode } from '@/lib/layout'

// Admin-only print data. Players never print their own paper — the club
// generates and prints every sheet — so the print view is gated server-side.
//   GET ?ids=CODE1,CODE2  -> those boards (cells for BoardSheet rendering)
//   GET (no ids)          -> every board on file (= the current batch;
//                            used by "Reprint last batch" after a reload)
//   GET ?answers=1        -> active item pool (AnswerSheet rendering)
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Only club admins can print sheets.' }, { status: 403 })
  }

  const url = new URL(req.url)

  if (url.searchParams.get('answers')) {
    const items = await activeItems()
    return NextResponse.json({ items: items.map((it) => ({ id: it.id, text: it.text })) })
  }

  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => normalizeCode(s))
    .filter((v): v is string => Boolean(v))
  if (ids.length === 0) {
    // No ids = the whole current batch. Generating a new batch clears the
    // old boards, so everything on file IS the last batch — this is what
    // "Reprint last batch" uses after a page reload, when the in-memory
    // board ids are gone but the boards are still in the database.
    const all = await db.aertsOBoard.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json({ boards: await Promise.all(all.map((b) => boardView(b))) })
  }

  const boards: { id: string; code: string; ownerId: string | null; cells: string[]; itemIds: string[] }[] = []
  for (const code of ids) {
    const board = await db.aertsOBoard.findUnique({ where: { code } })
    if (!board) return NextResponse.json({ error: `Unknown board ${code}.` }, { status: 404 })
    boards.push(await boardView(board))
  }
  return NextResponse.json({ boards })
}

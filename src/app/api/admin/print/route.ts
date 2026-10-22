import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, activeItems } from '@/lib/boards'
import { normalizeCode } from '@/lib/layout'

// Admin-only print data. Players never print their own paper — the club
// generates and prints every sheet — so the print view is gated server-side.
//   GET ?ids=CODE1,CODE2  -> boards (cells for BoardSheet rendering)
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
    return NextResponse.json({ error: 'No boards requested.' }, { status: 400 })
  }

  const boards: { id: string; code: string; ownerId: string | null; cells: string[]; itemIds: string[] }[] = []
  for (const code of ids) {
    const board = await db.aertsOBoard.findUnique({ where: { code } })
    if (!board) return NextResponse.json({ error: `Unknown board ${code}.` }, { status: 404 })
    boards.push(await boardView(board))
  }
  return NextResponse.json({ boards })
}

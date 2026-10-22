import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createBoard, boardView } from '@/lib/boards'

// Create a board for the signed-in player (bound to their email immediately).
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  try {
    const board = await createBoard(user.id)
    return NextResponse.json({ ok: true, board: await boardView(board) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// List my boards.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const boards = await db_boards(user.id)
  return NextResponse.json({ boards })
}

async function db_boards(userId: string) {
  const { db } = await import('@/lib/db')
  const rows = await db.aertsOBoard.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    include: { submission: true },
  })
  return rows.map((b) => ({
    id: b.id,
    code: b.code,
    token: b.token,
    createdAt: b.createdAt,
    marks: b.submission?.marks ?? null,
    submittedAt: b.submission?.updatedAt ?? null,
  }))
}

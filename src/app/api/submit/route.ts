import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, submissionStatus } from '@/lib/boards'
import { normalizeCode } from '@/lib/layout'

// Submit scanned marks. Requires sign-in; binds an unclaimed board to the user.
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const { code, marks } = await req.json().catch(() => ({}))
  if (typeof marks !== 'string' || !/^[01]{36}$/.test(marks)) {
    return NextResponse.json({ error: 'Marks must be 36 cells.' }, { status: 400 })
  }
  const normalized = typeof code === 'string' ? normalizeCode(code) : null
  if (!normalized) {
    return NextResponse.json({ error: 'Board not found — check the code under the QR.' }, { status: 404 })
  }
  const board = await db.aertsOBoard.findUnique({ where: { code: normalized } })
  if (!board) return NextResponse.json({ error: 'Board not found — check the code under the QR.' }, { status: 404 })

  if (board.ownerId && board.ownerId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: 'This board belongs to someone else.' }, { status: 403 })
  }

  if (!board.ownerId) {
    await db.aertsOBoard.update({ where: { id: board.id }, data: { ownerId: user.id } })
  }

  await db.aertsOSubmission.upsert({
    where: { boardId: board.id },
    create: { boardId: board.id, userId: user.id, marks },
    update: { userId: user.id, marks },
  })

  const view = await boardView(board)
  const status = await submissionStatus(board.id, view.itemIds, marks)
  return NextResponse.json({ ok: true, board: { code: board.code }, status })
}

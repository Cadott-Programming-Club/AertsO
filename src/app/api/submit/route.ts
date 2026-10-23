import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, submissionStatus } from '@/lib/boards'
import { getGame } from '@/lib/game'
import { normalizeCode } from '@/lib/layout'

// Submit scanned marks. Requires sign-in; binds an unclaimed board to the user.
// The scan photo rides along so admins can review the paper vs. the recorded
// marks. After the game's end date submissions are LOCKED: resubmitting the
// same marks is fine (players rescanning to check their result), changes are
// rejected — admins bypass so they can fix mistakes.
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const { code, marks, photo } = await req.json().catch(() => ({}))
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

  const game = await getGame()
  const existing = await db.aertsOSubmission.findUnique({ where: { boardId: board.id } })
  if (game.ended && !user.isAdmin) {
    if (!existing || existing.marks !== marks) {
      const when = game.endsAt ? new Date(game.endsAt).toLocaleDateString('en-US', { dateStyle: 'full' }) : 'the deadline'
      return NextResponse.json(
        {
          error: `The game ended ${when} — boards are locked for scoring.${
            existing ? ' Your saved marks are still on file and were counted.' : ''
          }`,
        },
        { status: 403 },
      )
    }
    // idempotent rescan of the same marks — let it through so players can
    // still check their result, but keep the original evidence photo/marks.
    const view = await boardView(board)
    const status = await submissionStatus(board.id, view.itemIds, existing.marks)
    return NextResponse.json({ ok: true, board: { code: board.code }, status })
  }

  if (!board.ownerId) {
    await db.aertsOBoard.update({ where: { id: board.id }, data: { ownerId: user.id } })
  }

  // photo: dataURL from the scanner (small — ~380px JPEG); guard against
  // anything unexpected before storing it.
  const safePhoto = typeof photo === 'string' && photo.startsWith('data:image/') && photo.length < 1_500_000 ? photo : undefined

  await db.aertsOSubmission.upsert({
    where: { boardId: board.id },
    create: { boardId: board.id, userId: user.id, marks, photo: safePhoto },
    update: { userId: user.id, marks, ...(safePhoto ? { photo: safePhoto } : {}) },
  })

  const view = await boardView(board)
  const status = await submissionStatus(board.id, view.itemIds, marks)
  return NextResponse.json({ ok: true, board: { code: board.code }, status })
}

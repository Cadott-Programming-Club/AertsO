import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ANSWER_TOKEN } from '@/lib/layout'
import { boardView, activeItems, getAnswerKey } from '@/lib/boards'

// Public lookup by QR token. `ANSWERS` returns the answer-sheet pool instead.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (token === ANSWER_TOKEN) {
    const items = await activeItems()
    return NextResponse.json({ kind: 'answers', items: items.map((it) => ({ id: it.id, text: it.text })) })
  }

  const board = await db.aertsOBoard.findUnique({ where: { token } })
  if (!board) return NextResponse.json({ error: 'Unknown board.' }, { status: 404 })
  return NextResponse.json({ kind: 'board', board: await boardView(board) })
}

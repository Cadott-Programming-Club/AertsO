import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ANSWER_TOKEN, normalizeCode } from '@/lib/layout'
import { boardView, activeItems } from '@/lib/boards'

// Public lookup by board code (the code embedded in the QR payload, or typed
// as the manual fallback). `ANSWERS` returns the answer-sheet item pool.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  if (code === ANSWER_TOKEN) {
    const items = await activeItems()
    return NextResponse.json({ kind: 'answers', items: items.map((it) => ({ id: it.id, text: it.text })) })
  }

  const normalized = normalizeCode(decodeURIComponent(code))
  if (!normalized) return NextResponse.json({ error: 'Unknown board code.' }, { status: 400 })
  const board = await db.aertsOBoard.findUnique({ where: { code: normalized } })
  if (!board) return NextResponse.json({ error: 'Unknown board.' }, { status: 404 })
  return NextResponse.json({ kind: 'board', board: await boardView(board) })
}

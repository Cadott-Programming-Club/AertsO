import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, getAnswerKey } from '@/lib/boards'

// Admin: all boards + submissions + live bingo status against the current answer key.
export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const boards = await db.aertsOBoard.findMany({
    orderBy: { createdAt: 'desc' },
    include: { submission: true, owner: true },
  })
  const key = await getAnswerKey()
  const calledSet = new Set(key.itemIds)

  const rows = await Promise.all(
    boards.map(async (b) => {
      const view = await boardView(b)
      const marks = b.submission?.marks ?? null
      let bingo = false
      let winningLines: number[][] = []
      let invalidLines: number[][] = []
      if (marks) {
        const { evaluateBingo } = await import('@/lib/layout')
        const res = evaluateBingo(view.itemIds, marks, calledSet)
        bingo = res.bingo
        winningLines = res.winningLines
        invalidLines = res.invalidLines
      }
      return {
        code: b.code,
        createdAt: b.createdAt,
        ownerEmail: b.owner?.email ?? null,
        marks,
        markedCount: marks ? marks.split('').filter((c) => c === '1').length : 0,
        submittedAt: b.submission?.updatedAt ?? null,
        bingo,
        winningLines,
        invalidLines,
        cells: view.cells,
        itemIds: view.itemIds,
      }
    })
  )
  return NextResponse.json({ rows, answerKeyExists: key.itemIds.length > 0, calledCount: key.itemIds.length })
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, getAnswerKeyState } from '@/lib/boards'

// Admin: all boards + submissions. While answer keys are still outstanding
// the scores are SEALED — rows show marks but no bingo verdicts. Once every
// admin has saved their master key the scores release and are graded against
// the consensus of all keys.
export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const boards = await db.aertsOBoard.findMany({
    orderBy: { createdAt: 'desc' },
    include: { submission: true, owner: true },
  })
  const state = await getAnswerKeyState()
  const calledSet = new Set(state.consensus)

  const rows = await Promise.all(
    boards.map(async (b) => {
      const view = await boardView(b)
      const marks = b.submission?.marks ?? null
      let bingo = false
      let winningLines: number[][] = []
      let invalidLines: number[][] = []
      if (marks && state.released) {
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
  return NextResponse.json({
    rows,
    released: state.released,
    missing: state.missing,
    roster: state.roster,
    keys: state.keys.map((k) => ({ email: k.email, count: k.itemIds.length, updatedAt: k.updatedAt })),
    consensusCount: state.consensus.length,
    disputedCount: state.disputed.length,
    answerKeyExists: state.keys.length > 0,
    calledCount: state.released ? state.consensus.length : 0,
  })
}

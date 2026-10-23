import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { boardView, getAnswerKeyState, type AnswerKeyState } from '@/lib/boards'

// Admin: all boards + submissions. While answer keys are still outstanding
// the scores are SEALED — rows show marks but no bingo verdicts. Once every
// admin has saved their master key the scores release and are graded against
// the consensus of all keys.
//
// ?code=X returns ONE row including the scan photo (the review view); the
// plain list omits photos so the payload stays light.
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const wanted = searchParams.get('code')
  if (wanted) {
    const board = await db.aertsOBoard.findUnique({
      where: { code: wanted },
      include: { submission: true, owner: true },
    })
    if (!board) return NextResponse.json({ error: 'Unknown board.' }, { status: 404 })
    const state = await getAnswerKeyState()
    return NextResponse.json({
      row: await detailRow(board, state),
      // consensus item ids (empty while no admin key exists) — the verify
      // dialog highlights called-but-unmarked spots with these
      calledItemIds: state.consensus,
      released: state.released,
    })
  }

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
        hasPhoto: Boolean(b.submission?.photo),
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
    forceReleased: state.forceReleased,
    missing: state.missing,
    roster: state.roster,
    keys: state.keys.map((k) => ({ email: k.email, count: k.itemIds.length, updatedAt: k.updatedAt })),
    consensusCount: state.consensus.length,
    disputedCount: state.disputed.length,
    answerKeyExists: state.keys.length > 0,
    calledCount: state.released ? state.consensus.length : 0,
  })
}

interface BoardDetail {
  id: string
  code: string
  layout: string
  ownerId: string | null
  createdAt: Date
  submission: { marks: string; photo: string | null; updatedAt: Date } | null
  owner: { email: string } | null
}

async function detailRow(b: BoardDetail, state: AnswerKeyState) {
  const calledSet = new Set(state.consensus)
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
    photo: b.submission?.photo ?? null, // included here only
    bingo,
    winningLines,
    invalidLines,
    cells: view.cells,
    itemIds: view.itemIds,
  }
}

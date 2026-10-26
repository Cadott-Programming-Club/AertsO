import { db } from '@/lib/db'
import { evaluateBingo } from '@/lib/layout'
import { getAnswerKeyState } from '@/lib/boards'

// Scoring rules — surfaced in the leaderboard UI and the README.
export const POINTS_PER_CALLED_MARK = 1 // each inked space whose item was actually called (consensus)
export const POINTS_PER_BINGO_LINE = 10 // each fully-marked, fully-called line

// Points a single scanned board earns its OWNER (not the submitter — admins can
// scan sheets for players). Marks on uncalled items score nothing; before the
// keys release there is no consensus, so nothing is graded yet.
export function boardAutoPoints(layoutItemIds: string[], marks: string, calledSet: Set<string>) {
  const { winningLines } = evaluateBingo(layoutItemIds, marks, calledSet)
  let calledMarks = 0
  for (let i = 0; i < layoutItemIds.length; i++) {
    if (marks[i] === '1' && calledSet.has(layoutItemIds[i])) calledMarks++
  }
  return calledMarks * POINTS_PER_CALLED_MARK + winningLines.length * POINTS_PER_BINGO_LINE
}

// Recompute every user's `auto` points from current submissions, graded against
// the key CONSENSUS. Manual adjustments are untouched. Runs after every board
// submission, every answer-key save (the consensus can shift), and every new
// batch (which wipes boards/scans/keys, so everyone drops back to auto 0).
export async function recomputeAutoScores() {
  const state = await getAnswerKeyState()
  const calledSet = new Set(state.consensus)

  const owned = await db.aertsOBoard.findMany({
    where: { ownerId: { not: null } },
    include: { submission: true },
  })

  const perUser = new Map<string, number>()
  for (const b of owned) {
    if (!b.ownerId || !b.submission) continue
    const ids = JSON.parse(b.layout) as string[]
    const pts = boardAutoPoints(ids, b.submission.marks, calledSet)
    perUser.set(b.ownerId, (perUser.get(b.ownerId) ?? 0) + pts)
  }

  const users = await db.aertsOUser.findMany({ select: { id: true } })
  for (const u of users) {
    const auto = perUser.get(u.id) ?? 0
    await db.aertsOScore.upsert({
      where: { userId: u.id },
      create: { userId: u.id, auto },
      update: { auto },
    })
  }
  return perUser
}

export interface ScoreRow {
  userId: string
  email: string
  name: string // email local-part — the only identifier exposed publicly
  auto: number
  manual: number
  total: number
  note: string | null
  updatedBy: string | null
  updatedAt: string | null
  bingos: number // boards with at least one verified line against the consensus
  boardsPlayed: number // owned boards that have been scanned
  lastScanAt: string | null
  rank: number
}

// Full rows (emails included) for the admin scores tab. Ranks are over ALL
// users; the public projection re-ranks the visible subset.
export async function scoreRows(): Promise<ScoreRow[]> {
  const state = await getAnswerKeyState()
  const calledSet = new Set(state.consensus)

  const users = await db.aertsOUser.findMany({
    include: {
      score: true,
      boards: { include: { submission: true } },
    },
  })

  const rows = users.map((u) => {
    const auto = u.score?.auto ?? 0
    const manual = u.score?.manual ?? 0
    let bingos = 0
    let boardsPlayed = 0
    let lastScanAt: Date | null = null
    for (const b of u.boards) {
      if (!b.submission) continue
      boardsPlayed++
      const ids = JSON.parse(b.layout) as string[]
      if (evaluateBingo(ids, b.submission.marks, calledSet).bingo) bingos++
      const at = b.submission.updatedAt
      if (at && (!lastScanAt || at > lastScanAt)) lastScanAt = at
    }
    return {
      userId: u.id,
      email: u.email,
      name: u.email.split('@')[0] || u.email,
      auto,
      manual,
      total: auto + manual,
      note: u.score?.note ?? null,
      updatedBy: u.score?.updatedBy ?? null,
      updatedAt: u.score?.updatedAt ? u.score.updatedAt.toISOString() : null,
      bingos,
      boardsPlayed,
      lastScanAt: lastScanAt ? lastScanAt.toISOString() : null,
      rank: 0,
    }
  })

  rows.sort(
    (a, b) =>
      b.total - a.total ||
      b.bingos - a.bingos ||
      b.boardsPlayed - a.boardsPlayed ||
      a.email.localeCompare(b.email),
  )
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

// Public-safe projection: identity masked to the email local-part, never-played
// users hidden, visible list re-ranked so the board shows clean positions.
export function publicRows(rows: ScoreRow[]) {
  const players = rows.filter((r) => r.boardsPlayed > 0 || r.total !== 0)
  return players.map((r, i) => ({
    userId: r.userId,
    name: r.name,
    total: r.total,
    bingos: r.bingos,
    boardsPlayed: r.boardsPlayed,
    rank: i + 1,
  }))
}

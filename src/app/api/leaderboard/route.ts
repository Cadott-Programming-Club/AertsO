import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getAnswerKeyState } from '@/lib/boards'
import { scoreRows, publicRows } from '@/lib/scores'

// Public leaderboard — player identity is masked to the email local-part.
// While scores are SEALED (admin keys still outstanding) no rows are exposed at
// all, so relative standings can't leak before release. Signed-in callers also
// get their own rank (only once released).
export async function GET() {
  const state = await getAnswerKeyState()
  if (!state.released) {
    return NextResponse.json({
      released: false,
      rows: [],
      me: null,
      pendingAdmins: state.missing,
      rules: { perCalledMark: 1, perBingoLine: 10 },
    })
  }

  const rows = await scoreRows()
  const pub = publicRows(rows)
  const user = await getSessionUser()
  let me: { rank: number; total: number } | null = null
  if (user) {
    const row = pub.find((r) => r.userId === user.id)
    if (row) me = { rank: row.rank, total: row.total }
  }
  return NextResponse.json({
    released: true,
    rows: pub,
    me,
    rules: { perCalledMark: 1, perBingoLine: 10 },
  })
}

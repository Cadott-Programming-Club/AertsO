import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getAnswerKeyState } from '@/lib/boards'
import { scoreRows, publicRows } from '@/lib/scores'

export async function GET() {
  const user = await getSessionUser()
  let score: { total: number; rank: number } | null = null
  if (user) {
    const state = await getAnswerKeyState()
    if (state.released) {
      // sealed standings must not leak — only expose a signed-in player's own
      // score once every admin key is in
      const rows = publicRows(await scoreRows())
      const row = rows.find((r) => r.userId === user.id)
      if (row) score = { total: row.total, rank: row.rank }
    }
  }
  return NextResponse.json({ user, score })
}

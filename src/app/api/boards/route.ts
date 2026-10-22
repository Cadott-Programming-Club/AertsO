import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

// Players never create boards — club admins generate and print the paper
// sheets (see /api/admin/boards). This endpoint only lists the signed-in
// player's own claimed boards.
export async function POST() {
  return NextResponse.json(
    { error: 'Boards are generated and printed by club admins — sheets are handed out at the club.' },
    { status: 403 }
  )
}

// List my boards.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const boards = await db_boards(user.id)
  return NextResponse.json({ boards })
}

async function db_boards(userId: string) {
  const { db } = await import('@/lib/db')
  const rows = await db.aertsOBoard.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    include: { submission: true },
  })
  return rows.map((b) => ({
    id: b.id,
    code: b.code,
    createdAt: b.createdAt,
    marks: b.submission?.marks ?? null,
    submittedAt: b.submission?.updatedAt ?? null,
  }))
}

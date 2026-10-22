import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createBoard, boardView } from '@/lib/boards'
import type { AertsOBoard } from '@prisma/client'

// Admin: print a batch of unassigned boards (players claim them by scanning).
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const { count } = await req.json().catch(() => ({ count: 1 }))
  const n = Math.min(Math.max(Number(count) || 1, 1), 60)
  try {
    const boards: AertsOBoard[] = []
    for (let i = 0; i < n; i++) {
      boards.push(await createBoard(null))
    }
    return NextResponse.json({ ok: true, boards: await Promise.all(boards.map((b) => boardView(b))) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

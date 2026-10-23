import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boardView } from '@/lib/boards'
import { normalizeCode } from '@/lib/layout'

// Public board lookup by human code — the manual fallback when a player can't
// scan (cramped camera, damaged QR). Returned marks are tapped in by hand in
// the confirm grid, exactly like every other scanner path.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code') ?? ''
  const normalized = normalizeCode(code)
  if (!normalized) {
    return NextResponse.json({ error: 'Enter the 8-character board code (like K7QM-X2P9).' }, { status: 400 })
  }
  const board = await db.aertsOBoard.findUnique({ where: { code: normalized } })
  if (!board) return NextResponse.json({ error: 'No board with that code.' }, { status: 404 })
  return NextResponse.json({ board: await boardView(board) })
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boardView } from '@/lib/boards'

// Public board lookup by human code (fallback when the QR won't scan).
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code') ?? ''
  if (!/^[A-Z2-9]{4}$/i.test(code.trim())) {
    return NextResponse.json({ error: 'Enter the 4-character board code.' }, { status: 400 })
  }
  const board = await db.aertsOBoard.findUnique({ where: { code: code.trim().toUpperCase() } })
  if (!board) return NextResponse.json({ error: 'No board with that code.' }, { status: 404 })
  return NextResponse.json({ board: await boardView(board) })
}

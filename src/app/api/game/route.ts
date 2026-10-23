import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getGame, setGame } from '@/lib/game'

// Game settings: rules text + end date. Public read (homepage + print view
// need both); admin-only write.
export async function GET() {
  return NextResponse.json(await getGame())
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await setGame(body))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

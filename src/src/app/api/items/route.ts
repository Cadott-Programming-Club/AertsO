import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { activeItems } from '@/lib/boards'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const items = user.isAdmin ? await db.aertsOItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }) : await activeItems()
  return NextResponse.json({ items })
}

// Admin: replace the whole pool in one go (sent as { texts: string[] }).
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const { texts } = await req.json().catch(() => ({ texts: null }))
  if (!Array.isArray(texts) || texts.length === 0) {
    return NextResponse.json({ error: 'Send a non-empty list of item texts.' }, { status: 400 })
  }
  const clean = [...new Set(texts.map((t) => String(t).trim()).filter(Boolean))] as string[]
  if (clean.length === 0) return NextResponse.json({ error: 'All entries were empty.' }, { status: 400 })

  await db.$transaction(async (tx) => {
    await tx.aertsOItem.deleteMany({})
    await tx.aertsOItem.createMany({
      data: clean.map((text, sortOrder) => ({ text, sortOrder })),
    })
  })
  const items = await db.aertsOItem.findMany({ orderBy: { sortOrder: 'asc' } })
  return NextResponse.json({ ok: true, items })
}

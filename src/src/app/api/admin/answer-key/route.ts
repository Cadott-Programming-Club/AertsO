import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { getAnswerKey } from '@/lib/boards'

export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const key = await getAnswerKey()
  return NextResponse.json(key)
}

// Admin: replace the called-items key (from answer-sheet scan or manual edit).
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const { itemIds } = await req.json().catch(() => ({ itemIds: null }))
  if (!Array.isArray(itemIds)) return NextResponse.json({ error: 'Send itemIds array.' }, { status: 400 })

  const existing = await db.aertsOAnswerKey.findFirst()
  const data = {
    itemIds: JSON.stringify(itemIds),
    updatedBy: user.email,
  }
  if (existing) {
    await db.aertsOAnswerKey.update({ where: { id: existing.id }, data })
  } else {
    await db.aertsOAnswerKey.create({ data })
  }
  return NextResponse.json({ ok: true, itemIds })
}

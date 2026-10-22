import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { getAnswerKeyState } from '@/lib/boards'

// Admin answer keys ("master keys"). The pool is shared; each admin keeps
// their own key. GET returns every admin's key plus the comparison — which
// items all admins agree on (consensus) and which are disputed — and the
// release status: scores stay sealed until every admin on the roster has
// saved a key, then they release automatically.
export async function GET() {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const state = await getAnswerKeyState()
  const keyByEmail = new Map(state.keys.map((k) => [k.email, new Set(k.itemIds)]))
  const items = await db.aertsOItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })

  return NextResponse.json({
    me: user.email,
    released: state.released,
    roster: state.roster,
    missing: state.missing,
    keys: state.keys.map((k) => ({
      email: k.email,
      count: k.itemIds.length,
      updatedAt: k.updatedAt,
    })),
    consensusCount: state.consensus.length,
    disputedCount: state.disputed.length,
    // per-item comparison: which admins called it
    items: items.map((it) => ({
      id: it.id,
      text: it.text,
      calledBy: state.roster.filter((email) => keyByEmail.get(email)?.has(it.id)),
    })),
  })
}

// Admin: save/replace THIS admin's own key (from an answer-sheet scan or
// manual taps). Upserts one row per admin email.
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const { itemIds } = await req.json().catch(() => ({ itemIds: null }))
  if (!Array.isArray(itemIds)) return NextResponse.json({ error: 'Send itemIds array.' }, { status: 400 })

  await db.aertsOAnswerKey.upsert({
    where: { updatedBy: user.email },
    create: { itemIds: JSON.stringify(itemIds), updatedBy: user.email },
    update: { itemIds: JSON.stringify(itemIds) },
  })

  const state = await getAnswerKeyState()
  return NextResponse.json({
    ok: true,
    itemIds,
    saved: true,
    calledCount: itemIds.length,
    released: state.released,
    missing: state.missing,
    consensusCount: state.consensus.length,
    disputedCount: state.disputed.length,
    keysCount: state.keys.length,
  })
}

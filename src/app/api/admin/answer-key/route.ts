import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { getAnswerKeyState } from '@/lib/boards'
import { recomputeAutoScores } from '@/lib/scores'

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
  const myItemIds = state.keys.find((k) => k.email === user.email)?.itemIds ?? []
  const items = await db.aertsOItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })

  return NextResponse.json({
    me: user.email,
    myItemIds,
    released: state.released,
    forceReleased: state.forceReleased, // released early despite missing keys
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

  // findFirst + update/create instead of a unique-input upsert: the Vercel
  // build cache can serve a stale generated Prisma client that doesn't know
  // updatedBy is unique (postinstall may not re-run on cached installs), and
  // this shape works regardless. Concurrent saves by the same admin are
  // practically impossible (one device, one sheet).
  const existing = await db.aertsOAnswerKey.findFirst({ where: { updatedBy: user.email } })
  if (existing) {
    await db.aertsOAnswerKey.update({ where: { id: existing.id }, data: { itemIds: JSON.stringify(itemIds) } })
  } else {
    await db.aertsOAnswerKey.create({ data: { itemIds: JSON.stringify(itemIds), updatedBy: user.email } })
  }

  // the consensus (and with it every board's grade) can shift — rescore
  await recomputeAutoScores()

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

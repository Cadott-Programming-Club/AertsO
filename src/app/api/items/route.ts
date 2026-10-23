import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { activeItems } from '@/lib/boards'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  // The textarea edits the ACTIVE pool — deactivated items (kept only so old
  // boards and answer keys keep resolving) must not resurrect on every save.
  const items = await activeItems()
  return NextResponse.json({ items })
}

// Admin: replace the active pool in one go (sent as { texts: string[] }).
// ID-STABLE by design: items whose text is unchanged KEEP their row (and id),
// so boards and answer keys that reference them never break. Texts that vanish
// from the pool are DEACTIVATED, not deleted — an already-printed board keeps
// showing its items, it just stops feeding new boards and answer sheets.
// (The old delete-all/recreate-all save silently re-assigned every id, which
// retroactively turned every existing board's cells into dashes.)
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
    const existing = await tx.aertsOItem.findMany()
    const byText = new Map(existing.map((it) => [it.text, it]))
    const keptIds = new Set<string>()

    for (let sortOrder = 0; sortOrder < clean.length; sortOrder++) {
      const text = clean[sortOrder]
      const match = byText.get(text)
      if (match) {
        keptIds.add(match.id)
        if (!match.active || match.sortOrder !== sortOrder) {
          await tx.aertsOItem.update({ where: { id: match.id }, data: { active: true, sortOrder } })
        }
      } else {
        await tx.aertsOItem.create({ data: { text, sortOrder, active: true } })
      }
    }

    // texts that left the pool — deactivate (never delete): existing boards,
    // submissions, and answer keys still point at these ids
    const gone = existing.filter((it) => it.active && !keptIds.has(it.id))
    for (const it of gone) {
      await tx.aertsOItem.update({ where: { id: it.id }, data: { active: false } })
    }
  })

  const items = await activeItems()
  return NextResponse.json({ ok: true, items })
}

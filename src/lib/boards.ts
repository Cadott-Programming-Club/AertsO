import { db } from '@/lib/db'
import { evaluateBingo } from '@/lib/layout'

// unambiguous alphabet for board codes (no I/O/0/1) — 8 chars, ~1.1e12 combos,
// so the code doubles as the sheet's unguessable credential
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8

export function generateBoardCode() {
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return s
}

export async function uniqueBoardCode() {
  for (let i = 0; i < 20; i++) {
    const code = generateBoardCode()
    if (!(await db.aertsOBoard.findUnique({ where: { code } }))) return code
  }
  throw new Error('could not allocate board code')
}

export async function activeItems() {
  return db.aertsOItem.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function createBoard(ownerId: string | null) {
  const pool = await activeItems()
  if (pool.length < 36) {
    throw new Error(`Need at least 36 items in the pool (currently ${pool.length}).`)
  }
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const chosen = shuffled.slice(0, 36)
  // shuffle placement too (row-major)
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chosen[i], chosen[j]] = [chosen[j], chosen[i]]
  }
  return db.aertsOBoard.create({
    data: {
      code: await uniqueBoardCode(),
      layout: JSON.stringify(chosen.map((it) => it.id)),
      ownerId,
    },
  })
}

// ---- answer keys (multi-admin master keys) ---------------------------------------------
// The pool is shared, but every admin keeps their OWN master key (one row per
// admin email). Scores stay SEALED until every admin on the roster has saved a
// key — the moment the last one lands, scores release automatically and are
// graded against the CONSENSUS: an item only counts as called when it is in
// EVERY admin's key. Items some admins have but others don't are "disputed" —
// surfaced to the admins so they can compare and reconcile before/after release.

export interface AdminKey {
  email: string
  itemIds: string[]
  updatedAt: Date
}

export interface AnswerKeyState {
  keys: AdminKey[] // roster admins' keys, newest first
  roster: string[] // emails of admin users known to the database
  missing: string[] // roster admins who haven't saved a key yet
  released: boolean // true when every roster admin has a key
  consensus: string[] // items in EVERY key — the graded called-set
  disputed: string[] // items in some keys but not all
}

export async function getAnswerKeyState(): Promise<AnswerKeyState> {
  const admins = await db.aertsOUser.findMany({
    where: { isAdmin: true },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  })
  const roster = admins.map((a) => a.email)
  const recs = await db.aertsOAnswerKey.findMany({ orderBy: { updatedAt: 'desc' } })
  const byEmail = new Map(recs.map((r) => [r.updatedBy, r]))

  const keys: AdminKey[] = []
  for (const email of roster) {
    const rec = byEmail.get(email)
    if (rec) keys.push({ email, itemIds: JSON.parse(rec.itemIds) as string[], updatedAt: rec.updatedAt })
  }
  const missing = roster.filter((email) => !byEmail.has(email))
  const released = roster.length > 0 && missing.length === 0

  let consensus: string[] = []
  let disputed: string[] = []
  if (keys.length > 0) {
    const sets = keys.map((k) => new Set(k.itemIds))
    const union = new Set(keys.flatMap((k) => k.itemIds))
    consensus = [...union].filter((id) => sets.every((s) => s.has(id)))
    disputed = [...union].filter((id) => !sets.every((s) => s.has(id)))
    // keep pool order for stable display
    const order = new Map((await activeItems()).map((it, i) => [it.id, i]))
    const byOrder = (a: string, b: string) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)
    consensus.sort(byOrder)
    disputed.sort(byOrder)
  }

  return { keys, roster, missing, released, consensus, disputed }
}

export async function boardView(board: { id: string; code: string; layout: string; ownerId: string | null }) {
  const items = await db.aertsOItem.findMany()
  const byId = new Map(items.map((it) => [it.id, it.text]))
  const ids = JSON.parse(board.layout) as string[]
  return {
    id: board.id,
    code: board.code,
    ownerId: board.ownerId,
    cells: ids.map((id) => byId.get(id) ?? '—'),
    itemIds: ids,
  }
}

// Player-facing status. Sealed until release — bingo results are NOT leaked
// while keys are still outstanding; players just see who's pending.
export async function submissionStatus(boardId: string, layoutItemIds: string[], marks: string) {
  void boardId
  const state = await getAnswerKeyState()
  if (!state.released) {
    return {
      released: false as const,
      answerKeyExists: state.keys.length > 0,
      pendingAdmins: state.missing,
      bingo: false,
      winningLines: [] as number[][],
      invalidLines: [] as number[][],
      calledCount: 0,
    }
  }
  const calledSet = new Set(state.consensus)
  const result = evaluateBingo(layoutItemIds, marks, calledSet)
  return {
    released: true as const,
    answerKeyExists: true,
    pendingAdmins: [] as string[],
    disputedCount: state.disputed.length,
    ...result,
    calledCount: state.consensus.length,
  }
}

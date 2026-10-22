import { db } from '@/lib/db'
import { randomToken } from '@/lib/auth'
import { evaluateBingo } from '@/lib/layout'

// unambiguous alphabet for human-typed board codes
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateBoardCode() {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
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
      token: randomToken(),
      layout: JSON.stringify(chosen.map((it) => it.id)),
      ownerId,
    },
  })
}

export async function getAnswerKey() {
  const rec = await db.aertsOAnswerKey.findFirst()
  if (!rec) return { itemIds: [] as string[], updatedAt: null as Date | null, updatedBy: '' }
  return { itemIds: JSON.parse(rec.itemIds) as string[], updatedAt: rec.updatedAt, updatedBy: rec.updatedBy }
}

export async function boardView(board: { id: string; code: string; token: string; layout: string; ownerId: string | null }) {
  const items = await db.aertsOItem.findMany()
  const byId = new Map(items.map((it) => [it.id, it.text]))
  const ids = JSON.parse(board.layout) as string[]
  return {
    id: board.id,
    code: board.code,
    token: board.token,
    ownerId: board.ownerId,
    cells: ids.map((id) => byId.get(id) ?? '—'),
    itemIds: ids,
  }
}

export async function submissionStatus(boardId: string, layoutItemIds: string[], marks: string) {
  const key = await getAnswerKey()
  const calledSet = new Set(key.itemIds)
  const result = evaluateBingo(layoutItemIds, marks, calledSet)
  return { answerKeyExists: key.itemIds.length > 0, calledCount: key.itemIds.length, ...result }
}

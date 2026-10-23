import { db, schemaReady } from '@/lib/db'

// Game settings — a single row (id 'current') the admins edit: club rules
// text (shown on the site + printed on sheets) and the game end date.
// Submissions lock after endsAt (admins can still fix things); generating a
// new board batch resets the clock (see /api/admin/boards).

export const GAME_ID = 'current'

export interface GameState {
  rules: string
  endsAt: string | null // ISO
  ended: boolean
}

interface GameRow {
  rulesText: string | null
  endsAt: Date | null
}

async function loadRow(): Promise<GameRow> {
  await schemaReady()
  let row = await db.aertsOGame.findUnique({ where: { id: GAME_ID } })
  if (!row) {
    // first touch — create the settings row (races are harmless, re-read)
    try {
      row = await db.aertsOGame.create({ data: { id: GAME_ID } })
    } catch {
      row = await db.aertsOGame.findUniqueOrThrow({ where: { id: GAME_ID } })
    }
  }
  return row
}

export async function getGame(): Promise<GameState> {
  const row = await loadRow()
  return {
    rules: row.rulesText ?? '',
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    ended: row.endsAt ? row.endsAt.getTime() < Date.now() : false,
  }
}

// Body: { rules?: string, endsAt?: string | null } — endsAt is an ISO string
// (the client converts its datetime-local pick to ISO so server tz never
// shifts it) or null/'' to clear.
export async function setGame(input: { rules?: unknown; endsAt?: unknown }): Promise<GameState> {
  const data: { rulesText?: string; endsAt?: Date | null } = {}
  if (typeof input.rules === 'string') data.rulesText = input.rules.slice(0, 4000)
  if (input.endsAt === null || input.endsAt === '' || typeof input.endsAt === 'undefined') {
    if (input.endsAt !== undefined) data.endsAt = null
  } else if (typeof input.endsAt === 'string') {
    const d = new Date(input.endsAt)
    if (isNaN(d.getTime())) throw new Error('Invalid end date.')
    data.endsAt = d
  }
  await loadRow() // ensure the row exists before update
  if (Object.keys(data).length > 0) {
    await db.aertsOGame.update({ where: { id: GAME_ID }, data })
  }
  return getGame()
}

// Called by batch generation: a new batch is a new game — clear a PASSED end
// date so the fresh boards aren't born locked. Future dates are kept (the
// admin set the deadline deliberately).
export async function resetGameClockIfEnded(): Promise<boolean> {
  const row = await loadRow()
  if (row.endsAt && row.endsAt.getTime() < Date.now()) {
    await db.aertsOGame.update({ where: { id: GAME_ID }, data: { endsAt: null } })
    return true
  }
  return false
}

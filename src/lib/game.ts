import { db, schemaReady } from '@/lib/db'

// Game settings — a single row (id 'current') the admins edit: club rules
// text (shown on the site + printed on sheets), the game end date, and the
// force-release override (scores don't have to wait for every admin key).
// Submissions lock after endsAt (admins can still fix things); generating a
// new board batch resets the clock and the override (see /api/admin/boards).

export const GAME_ID = 'current'

export interface GameState {
  rules: string
  endsAt: string | null // ISO
  ended: boolean
  forceReleased: boolean // scores released before every admin key landed
}

interface GameRow {
  rulesText: string | null
  endsAt: Date | null
  forceReleased: boolean | null
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
    forceReleased: Boolean(row.forceReleased),
  }
}

// Body: { rules?: string, endsAt?: string | null, forceReleased?: boolean } —
// endsAt is an ISO string (the client converts its datetime-local pick to ISO
// so server tz never shifts it) or null/'' to clear; forceReleased is the
// "release scores now" override (see getAnswerKeyState). Absent keys are left
// untouched, so saving rules doesn't wipe the override and vice versa.
export async function setGame(input: { rules?: unknown; endsAt?: unknown; forceReleased?: unknown }): Promise<GameState> {
  const data: { rulesText?: string; endsAt?: Date | null; forceReleased?: boolean } = {}
  if (typeof input.rules === 'string') data.rulesText = input.rules.slice(0, 4000)
  if (input.endsAt === null || input.endsAt === '' || typeof input.endsAt === 'undefined') {
    if (input.endsAt !== undefined) data.endsAt = null
  } else if (typeof input.endsAt === 'string') {
    const d = new Date(input.endsAt)
    if (isNaN(d.getTime())) throw new Error('Invalid end date.')
    data.endsAt = d
  }
  if (typeof input.forceReleased === 'boolean') data.forceReleased = input.forceReleased
  await loadRow() // ensure the row exists before update
  if (Object.keys(data).length > 0) {
    await db.aertsOGame.update({ where: { id: GAME_ID }, data })
  }
  return getGame()
}

// Called by batch generation: a new batch is a new game — clear a PASSED end
// date so the fresh boards aren't born locked (future dates are kept — the
// admin set the deadline deliberately) and clear the force-release override
// so the new game starts sealed. (The override is also inert with zero keys,
// but clearing it keeps the state honest.)
export async function resetGameClockIfEnded(): Promise<boolean> {
  const row = await loadRow()
  const clearEnds = Boolean(row.endsAt && row.endsAt.getTime() < Date.now())
  if (clearEnds || row.forceReleased) {
    await db.aertsOGame.update({
      where: { id: GAME_ID },
      data: {
        ...(clearEnds ? { endsAt: null } : {}),
        ...(row.forceReleased ? { forceReleased: false } : {}),
      },
    })
  }
  return clearEnds
}

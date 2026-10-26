'use client'

// Public leaderboard: podium for the top 3, ranked table for the rest.
// While admin keys are still outstanding the board is SEALED — no rows are
// exposed (not even names) so relative standings can't leak before release.
// Scoring is automatic (+1 per called mark, +10 per bingo line) and admins can
// adjust any total — see the Scores tab in the admin panel.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface PublicRow {
  userId: string
  name: string
  total: number
  bingos: number
  boardsPlayed: number
  rank: number
}

const MEDALS: Record<number, { ring: string; chip: string }> = {
  1: {
    ring: 'border-amber-400/70 dark:border-amber-400/50 bg-amber-400/10 dark:bg-amber-400/15',
    chip: 'bg-amber-400 text-amber-950',
  },
  2: {
    ring: 'border-slate-400/70 dark:border-slate-400/40 bg-slate-400/10 dark:bg-slate-400/15',
    chip: 'bg-slate-400 text-slate-900',
  },
  3: {
    ring: 'border-orange-500/60 dark:border-orange-500/40 bg-orange-500/10 dark:bg-orange-500/15',
    chip: 'bg-orange-500 text-orange-950',
  },
}

function PodiumSpot({ row }: { row: PublicRow }) {
  const m = MEDALS[row.rank] ?? MEDALS[3]
  const tall = row.rank === 1
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${m.ring} ${
        tall ? 'sm:py-7' : 'sm:py-5'
      }`}
    >
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${m.chip}`}>
        {row.rank}
      </span>
      <div className="text-sm font-semibold truncate max-w-full" title={row.name}>
        {row.name}
      </div>
      <div className={`font-extrabold tabular-nums ${tall ? 'text-3xl' : 'text-2xl'}`}>{row.total}</div>
      <div className="text-[11px] text-muted-foreground">
        {row.bingos} bingo{row.bingos === 1 ? '' : 's'} · {row.boardsPlayed} board{row.boardsPlayed === 1 ? '' : 's'}
      </div>
    </div>
  )
}

export function Leaderboard({ meEmail }: { meEmail: string | null }) {
  const [rows, setRows] = useState<PublicRow[]>([])
  const [released, setReleased] = useState<boolean | null>(null)
  const [pendingAdmins, setPendingAdmins] = useState<string[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/leaderboard')
    if (!res.ok) return
    const json = await res.json()
    setRows(json.rows ?? [])
    setReleased(Boolean(json.released))
    setPendingAdmins(json.pendingAdmins ?? [])
    setMyRank(json.me?.rank ?? null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    load()
  }, [load])

  const podium = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Leaderboard
          {released === true && myRank && <Badge variant="default">you&apos;re #{myRank}</Badge>}
          <span className="ml-auto">
            <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh leaderboard">
              Refresh
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Scoring: <span className="font-medium">+1</span> per inked space the caller actually drew ·{' '}
          <span className="font-medium">+10</span> per verified bingo line · admins can adjust any total.
        </p>

        {!loaded ? null : released === false ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center">
            <p className="text-sm font-medium">Scores are sealed until every admin&apos;s answer key is in.</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {pendingAdmins.length > 0 ? (
                <>
                  Still waiting on{' '}
                  {pendingAdmins.map((a) => (
                    <span key={a} className="font-medium">
                      {a.split('@')[0]}
                    </span>
                  )).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}
                  {' — '}
                </>
              ) : null}
              the leaderboard goes live the moment the last key lands.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No scans yet — grab a sheet, play a round, and scan it to get on the board.
          </p>
        ) : (
          <>
            {podium.length > 0 && (
              <div
                className={`grid gap-2 sm:gap-3 items-end ${
                  podium.length === 1 ? 'grid-cols-1 max-w-[12rem] mx-auto' : podium.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                }`}
              >
                {/* podium order on sm+: 2nd, 1st (tall, center), 3rd */}
                {podium
                  .slice()
                  .sort((a, b) => (a.rank === 1 ? 1 : b.rank === 1 ? -1 : a.rank - b.rank))
                  .map((row) => (
                    <PodiumSpot key={row.userId} row={row} />
                  ))}
              </div>
            )}

            {rest.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium w-12">#</th>
                      <th className="px-3 py-2 font-medium">Player</th>
                      <th className="px-3 py-2 font-medium text-right">Bingos</th>
                      <th className="px-3 py-2 font-medium text-right">Boards</th>
                      <th className="px-3 py-2 font-medium text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((r) => {
                      const isMe = meEmail != null && myRank === r.rank && myRank != null
                      return (
                        <tr key={r.userId} className={`border-t ${isMe ? 'bg-primary/5' : ''}`}>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.rank}</td>
                          <td className="px-3 py-2 font-medium truncate max-w-[10rem]" title={r.name}>
                            {r.name}
                            {isMe && (
                              <Badge variant="secondary" className="ml-2">
                                you
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.bingos}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.boardsPlayed}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

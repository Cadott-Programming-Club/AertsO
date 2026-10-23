'use client'

// Admin panel: shared item pool, batch printing, master keys (one per admin,
// with comparison + automatic score release), live submissions.

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { formatCode, COLS } from '@/lib/layout'
import type { Me } from './LoginView'

interface Item {
  id: string
  text: string
  sortOrder: number
  active: boolean
}
interface Row {
  code: string
  ownerEmail: string | null
  marks: string | null
  markedCount: number
  submittedAt: string | null
  hasPhoto?: boolean
  photo?: string | null
  bingo: boolean
  winningLines: number[][]
  invalidLines: number[][]
  cells: string[]
  itemIds?: string[] // aligned with cells — detail rows carry it
}
interface KeyInfo {
  email: string
  count: number
  updatedAt: string
}
interface ReleaseInfo {
  released: boolean
  forceReleased?: boolean
  roster: string[]
  missing: string[]
  keys: KeyInfo[]
  consensusCount: number
  disputedCount: number
}
interface CompareItem {
  id: string
  text: string
  calledBy: string[]
}
interface KeyState extends ReleaseInfo {
  me: string
  items: CompareItem[]
}
interface GameInfo {
  rules: string
  endsAt: string | null
  ended: boolean
}

function initial(email: string) {
  return (email.split('@')[0] ?? '?').slice(0, 1).toUpperCase()
}

// datetime-local wants YYYY-MM-DDTHH:mm in the browser's own timezone
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AdminPanel({ me, openPrint }: { me: Me; openPrint: (url: string) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [batchCount, setBatchCount] = useState(12)
  const [rows, setRows] = useState<Row[]>([])
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [keyState, setKeyState] = useState<KeyState | null>(null)
  const [lastIds, setLastIds] = useState('')
  const [dbReady, setDbReady] = useState<boolean | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  // game settings (rules + end date) and their draft form
  const [game, setGame] = useState<GameInfo | null>(null)
  const [rulesDraft, setRulesDraft] = useState('')
  const [endsDraft, setEndsDraft] = useState('')
  // boards-tab verify dialog (per-board detail incl. the scan photo)
  const [reviewCode, setReviewCode] = useState<string | null>(null)
  const [reviewRow, setReviewRow] = useState<Row | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  // consensus item ids from the detail fetch — powers the
  // called-but-not-marked highlight in the verify grid
  const [reviewCalled, setReviewCalled] = useState<Set<string>>(new Set())

  const probeDb = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/setup')
      if (!res.ok) return
      const json = await res.json()
      setDbReady(Boolean(json.ready))
    } catch {
      // ignore — banner simply stays hidden
    }
  }, [])

  const loadItems = useCallback(async () => {
    const res = await fetch('/api/items')
    if (res.ok) {
      const json = await res.json()
      setItems(json.items)
      setDraft(json.items.map((i: Item) => i.text).join('\n'))
    }
  }, [])

  const loadSubs = useCallback(async () => {
    const res = await fetch('/api/admin/submissions')
    if (res.ok) {
      const json = await res.json()
      setRows(json.rows)
      setRelease({
        released: json.released,
        forceReleased: Boolean(json.forceReleased),
        roster: json.roster,
        missing: json.missing,
        keys: json.keys,
        consensusCount: json.consensusCount,
        disputedCount: json.disputedCount,
      })
    }
  }, [])

  const loadKeys = useCallback(async () => {
    const res = await fetch('/api/admin/answer-key')
    if (res.ok) setKeyState(await res.json())
  }, [])

  const loadGame = useCallback(async () => {
    const res = await fetch('/api/game')
    if (!res.ok) return
    const json: GameInfo = await res.json()
    setGame(json)
    setRulesDraft(json.rules)
    setEndsDraft(json.endsAt ? toLocalInput(json.endsAt) : '')
  }, [])

  useEffect(() => {
    loadItems()
    loadSubs()
    loadKeys()
    loadGame()
    probeDb()
  }, [loadItems, loadSubs, loadKeys, loadGame, probeDb])

  const runSetup = async () => {
    setMsg('')
    setSettingUp(true)
    try {
      const res = await fetch('/api/admin/setup', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(json.error ?? 'Setup failed.')
        return
      }
      setDbReady(true)
      setMsg(
        json.created > 0
          ? `Database ready — ${json.created} of ${json.total} tables created.`
          : 'Database already initialized.',
      )
      loadItems()
      loadSubs()
    } finally {
      setSettingUp(false)
    }
  }

  const saveItems = async () => {
    setMsg('')
    const texts = draft.split('\n').map((t) => t.trim()).filter(Boolean)
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMsg(json.error ?? 'Could not save.')
      return
    }
    setItems(json.items)
    setMsg(`Saved ${json.items.length} items${json.items.length < 36 ? ' — you need at least 36 before boards can be generated.' : '.'}`)
  }

  const printBatch = async () => {
    setMsg('')
    // Generating a batch wipes the previous game — make that explicit before
    // the old boards/scans/keys are gone.
    const existingBoards = rows.length
    const existingKeys = release?.keys.length ?? 0
    if (existingBoards > 0 || existingKeys > 0) {
      const parts: string[] = []
      if (existingBoards > 0) parts.push(`${existingBoards} board${existingBoards === 1 ? '' : 's'} and their scans`)
      if (existingKeys > 0) parts.push(`${existingKeys} answer key${existingKeys === 1 ? '' : 's'}`)
      if (
        !window.confirm(
          `Generate a fresh set? This starts a new game — it clears the ${parts.join(' and ')} from the last one, and a passed end date resets.`,
        )
      ) {
        return
      }
    }
    const res = await fetch('/api/admin/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: batchCount }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMsg(json.error ?? 'Could not generate boards.')
      return
    }
    const codes = json.boards.map((b: { code: string }) => b.code).join(',')
    setLastIds(codes)
    openPrint(`/?print=batch&ids=${codes}`)
    const clearedBits: string[] = []
    if (json.clearedBoards > 0) clearedBits.push(`${json.clearedBoards} old board${json.clearedBoards === 1 ? '' : 's'}`)
    if (json.clearedSubmissions > 0) clearedBits.push(`${json.clearedSubmissions} scan${json.clearedSubmissions === 1 ? '' : 's'}`)
    if (json.clearedKeys > 0) clearedBits.push(`${json.clearedKeys} answer key${json.clearedKeys === 1 ? '' : 's'}`)
    setMsg(
      `Generated ${json.boards.length} fresh board${json.boards.length === 1 ? '' : 's'}${
        clearedBits.length ? ` — cleared ${clearedBits.join(', ')}` : ''
      } — opening the print view.${json.gameClockReset ? ' The passed end date was cleared — set a new one in the Game tab.' : ''}`,
    )
    loadSubs()
    loadKeys()
    loadGame()
  }

  const saveGame = async () => {
    setMsg('')
    // datetime-local is browser-local — convert to ISO here so the server
    // never re-interprets the moment in its own timezone
    const endsAt = endsDraft ? new Date(endsDraft).toISOString() : null
    const res = await fetch('/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: rulesDraft, endsAt }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMsg(json.error ?? 'Could not save game settings.')
      return
    }
    setGame(json as GameInfo)
    setMsg(
      `Game settings saved${
        (json as GameInfo).endsAt ? ` — the game ends ${new Date((json as GameInfo).endsAt!).toLocaleString()}` : ' — no end date set'
      }.`,
    )
  }

  // "Release scores now": grade against the keys submitted so far instead of
  // waiting on admins who haven't scanned their answer sheet. If they scan
  // later, the consensus (and every board's verdict) recomputes automatically.
  const setForceRelease = async (on: boolean) => {
    setMsg('')
    const res = await fetch('/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceReleased: on }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMsg(json.error ?? 'Could not change the release override.')
      return
    }
    loadKeys()
    loadSubs()
    if (on) {
      setMsg('Scores released — boards are graded against the keys submitted so far.')
    } else {
      setMsg('Back to sealed — boards show marks only until every admin key is in.')
    }
  }

  const releaseNow = () => {
    const waiting = keyState?.missing.join(', ') ?? 'the other admins'
    const submitted = keyState?.keys.length ?? 0
    if (
      !window.confirm(
        `Release scores now? Boards will be graded against the ${submitted} key${submitted === 1 ? '' : 's'} submitted so far — ` +
          `you won't wait on ${waiting}. If they scan their answer sheet later, scores recompute automatically to include their key.`,
      )
    )
      return
    setForceRelease(true)
  }

  const openReview = async (code: string) => {
    setReviewCode(code)
    setReviewRow(null)
    setReviewCalled(new Set())
    setReviewLoading(true)
    try {
      const res = await fetch(`/api/admin/submissions?code=${code}`)
      if (res.ok) {
        const json = await res.json()
        setReviewRow(json.row as Row)
        setReviewCalled(new Set((json.calledItemIds ?? []) as string[]))
      }
    } finally {
      setReviewLoading(false)
    }
  }

  const closeReview = () => {
    setReviewCode(null)
    setReviewRow(null)
    setReviewCalled(new Set())
  }

  // verify dialog: ESC closes it; page scroll locks while it's open
  useEffect(() => {
    if (!reviewCode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReview()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeReview is a plain state reset
  }, [reviewCode])

  const reprintLast = () => {
    // lastIds lives only in memory — a reload wipes it, which used to make
    // this button say "Generate a batch first" while the database clearly
    // still held the batch (and generating would wipe it!). Since a new
    // batch clears the old boards, everything on file IS the last batch:
    // with no ids the print route returns every board on file.
    openPrint(lastIds ? `/?print=batch&ids=${lastIds}` : '/?print=batch')
  }

  const printAnswers = () => openPrint('/?print=answers')

  const bingos = rows.filter((r) => r.bingo).length
  const flagged = rows.filter((r) => r.invalidLines.length > 0 && !r.bingo).length

  const scanAnswerSheet = () => openPrint('/?scan=ANSWERS')

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Admin
          <Badge variant="secondary">{me.email}</Badge>
          {game?.endsAt && (
            <Badge variant={game.ended ? 'destructive' : 'secondary'}>
              {game.ended
                ? `ended ${new Date(game.endsAt).toLocaleDateString()}`
                : `ends ${new Date(game.endsAt).toLocaleDateString()}`}
            </Badge>
          )}
          {release && (
            <Badge variant={release.released ? 'default' : 'outline'}>
              {release.released
                ? release.forceReleased && release.missing.length > 0
                  ? `${release.consensusCount} called · released early`
                  : `${release.consensusCount} called · scores released`
                : release.keys.length > 0
                  ? `${release.keys.length}/${release.roster.length} keys · scores sealed`
                  : 'no answer keys yet'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {dbReady === false && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="min-w-40 flex-1 text-sm">
              <span className="font-medium">Database not initialized.</span> Create the tables to get started.
            </p>
            <Button size="sm" onClick={runSetup} disabled={settingUp}>
              {settingUp ? 'Creating…' : 'Initialize database'}
            </Button>
          </div>
        )}
        <Tabs defaultValue="game">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="game">Game</TabsTrigger>
            <TabsTrigger value="items">Item pool</TabsTrigger>
            <TabsTrigger value="print">Print</TabsTrigger>
            <TabsTrigger value="keys">
              Answer keys
              {release && !release.released && release.keys.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5">
                  {release.keys.length}/{release.roster.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="subs">
              Boards
              {release?.released && bingos > 0 && <span className="ml-1.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5">{bingos}</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="game" className="flex flex-col gap-4 pt-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              {game?.ended ? (
                <span className="text-amber-600 dark:text-amber-400">
                  <span className="font-medium">The game has ended</span> — {new Date(game.endsAt!).toLocaleString()}.
                  Player submissions are locked (admins can still fix marks). Generate a new batch to start fresh.
                </span>
              ) : game?.endsAt ? (
                <span>
                  <span className="font-medium">Game ends {new Date(game.endsAt).toLocaleString()}</span> — after that,
                  players can&apos;t change their marks. Rescanning the same marks still works so they can check results.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No end date set — the game runs until you generate a new batch. Set a deadline (a week out is
                  typical) and boards lock after it passes.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="game-rules">Club rules — shown on the website and printed on every sheet</Label>
              <Textarea
                id="game-rules"
                rows={10}
                value={rulesDraft}
                onChange={(e) => setRulesDraft(e.target.value)}
                placeholder={
                  'One line per rule, or free text.\nExample: Boards must be scanned by the deadline.\nPrizes drawn from verified bingos.'
                }
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5 w-64">
                <Label htmlFor="game-ends">Game ends (optional)</Label>
                <Input id="game-ends" type="datetime-local" value={endsDraft} onChange={(e) => setEndsDraft(e.target.value)} />
              </div>
              <Button onClick={saveGame}>Save game settings</Button>
              {endsDraft && (
                <Button variant="outline" onClick={() => setEndsDraft('')}>
                  Clear end date
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A passed end date clears automatically when you generate a new batch. Rules show on the homepage and at
              the bottom of every printed sheet — keep it to roughly a paragraph so it fits the page.
            </p>
          </TabsContent>

          <TabsContent value="items" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label>One item per line — what can appear on a space</Label>
              <Textarea
                rows={12}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={'Has a dog\nBorn in October\nWearing socks\n…'}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={saveItems}>Save pool</Button>
              <span className="text-sm text-muted-foreground">
                {items.length} saved · {items.length < 36 ? `${36 - items.length} more until 36` : 'ready'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Shared pool — every admin sees and edits this same list, and every printed board is generated from it.
            </p>
          </TabsContent>

          <TabsContent value="print" className="flex flex-col gap-4 pt-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5 w-32">
                <Label>Boards</Label>
                <Input type="number" min={1} max={60} value={batchCount} onChange={(e) => setBatchCount(Number(e.target.value))} />
              </div>
              <Button onClick={printBatch}>Generate & print batch</Button>
              <Button variant="outline" onClick={reprintLast}>
                Reprint last batch
              </Button>
              <Button variant="outline" onClick={printAnswers}>
                Print answer key
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Only admins print — players get paper sheets at the club. Boards print one per page at 100% scale.
              Each QR contains its board&apos;s code, so a phone camera scan opens the site with that board loaded.
              Print one answer key sheet per admin — each of you inks your own copy as items are drawn, then scans it in.
            </p>
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <span className="font-medium">Generating a batch starts a new game</span> — all existing boards, their
              scans, and the answer keys are cleared first, so players&apos; &quot;My boards&quot; lists start fresh.
              You&apos;ll be asked to confirm before anything is cleared.
            </div>
          </TabsContent>

          <TabsContent value="keys" className="flex flex-col gap-4 pt-3">
            {keyState && (
              <>
                {keyState.released ? (
                  keyState.forceReleased && keyState.missing.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3">
                      <p className="min-w-40 flex-1 text-sm">
                        <span className="font-medium">Scores released early.</span> Grading on{' '}
                        {keyState.keys.length} of {keyState.roster.length} admin key
                        {keyState.roster.length === 1 ? '' : 's'} — still waiting on{' '}
                        <span className="font-medium">{keyState.missing.join(', ')}</span>: {keyState.consensusCount} item
                        {keyState.consensusCount === 1 ? '' : 's'} called
                        {keyState.disputedCount > 0 && <> · {keyState.disputedCount} disputed (not counted)</>}. If their
                        key lands later, scores recompute automatically.
                      </p>
                      <Button size="sm" variant="outline" onClick={() => setForceRelease(false)}>
                        Re-seal
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm">
                      <span className="font-medium">Scores released.</span> Every admin key is in — boards are graded on
                      the consensus: {keyState.consensusCount} item{keyState.consensusCount === 1 ? '' : 's'} called
                      {keyState.disputedCount > 0 && <> · {keyState.disputedCount} disputed (not counted)</>}.
                    </div>
                  )
                ) : (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <p className="min-w-40 flex-1 text-sm">
                      <span className="font-medium">Scores sealed.</span> {keyState.keys.length} of {keyState.roster.length}{' '}
                      admin key{keyState.roster.length === 1 ? '' : 's'} in
                      {keyState.missing.length > 0 && (
                        <> — waiting for <span className="font-medium">{keyState.missing.join(', ')}</span></>
                      )}
                      . Scores release the moment the last key is saved
                      {keyState.keys.length > 0 && ' — or release now and grade on the keys in so far'}.
                    </p>
                    {keyState.keys.length > 0 && keyState.missing.length > 0 && (
                      <Button size="sm" onClick={releaseNow}>
                        Release scores now
                      </Button>
                    )}
                    {!keyState.keys.some((k) => k.email === keyState.me) && (
                      <Button size="sm" onClick={scanAnswerSheet}>
                        Scan your answer sheet
                      </Button>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Master keys</h3>
                  {keyState.keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No keys yet — scan your answer sheet to record what you drew.
                    </p>
                  ) : (
                    <div className="rounded-lg border divide-y">
                      {keyState.keys.map((k) => (
                        <div key={k.email} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{k.email}</span>
                            {k.email === keyState.me && <Badge variant="secondary">you</Badge>}
                          </span>
                          <span className="text-muted-foreground">
                            {k.count} item{k.count === 1 ? '' : 's'} · {new Date(k.updatedAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {keyState.missing.map((m) => (
                        <div key={m} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground/70">
                          <span>{m}</span>
                          <span className="text-amber-600 dark:text-amber-400">no key yet</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button size="sm" variant="outline" onClick={scanAnswerSheet}>
                      {keyState.keys.some((k) => k.email === keyState.me) ? 'Update my key' : 'Scan my answer sheet'}
                    </Button>
                  </div>
                </div>

                {keyState.keys.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">Compare answers</h3>
                    {keyState.disputedCount === 0 ? (
                      <p className="text-sm text-emerald-600 dark:text-emerald-400">
                        All admins agree — {keyState.consensusCount} item{keyState.consensusCount === 1 ? '' : 's'} called.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-sm text-muted-foreground">
                          {keyState.disputedCount} disputed item{keyState.disputedCount === 1 ? '' : 's'} — called by
                          some admins but not others. They don&apos;t count toward bingos; fix your key if you disagree.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {keyState.items
                            .filter((it) => it.calledBy.length > 0 && it.calledBy.length < keyState.roster.length)
                            .map((it) => (
                              <div
                                key={it.id}
                                className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-xs"
                              >
                                <span className="min-w-0 flex-1">{it.text}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {keyState.roster.map((email) => {
                                    const called = it.calledBy.includes(email)
                                    return (
                                      <span
                                        key={email}
                                        title={`${email} — ${called ? 'called' : 'not called'}`}
                                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                          called
                                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                            : 'bg-muted text-muted-foreground/50'
                                        }`}
                                      >
                                        {initial(email)}
                                      </span>
                                    )
                                  })}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        Agreed items ({keyState.consensusCount})
                      </summary>
                      <p className="mt-1.5 text-muted-foreground">
                        {keyState.items
                          .filter((it) => it.calledBy.length === keyState.roster.length)
                          .map((it) => it.text)
                          .join(' · ') || '—'}
                      </p>
                    </details>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="subs" className="pt-3">
            {release && !release.released && (
              <div className="mb-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <span className="font-medium">Scores sealed</span> — boards show marks only until every admin has saved
                an answer key ({release.keys.length}/{release.roster.length} in
                {release.missing.length > 0 ? `, waiting on ${release.missing.join(', ')}` : ''}).
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-3 text-sm">
              <Badge variant="secondary">{rows.length} boards</Badge>
              <Badge variant="secondary">{rows.filter((r) => r.submittedAt).length} scanned</Badge>
              {release?.released && (
                <Badge variant={bingos ? 'default' : 'secondary'}>{bingos} verified bingos</Badge>
              )}
              {release?.released && flagged > 0 && <Badge variant="destructive">{flagged} to review</Badge>}
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Board</th>
                    <th className="px-3 py-2 font-medium">Player</th>
                    <th className="px-3 py-2 font-medium">Marks</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Scanned</th>
                    <th className="px-3 py-2 font-medium">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-t">
                      <td className="px-3 py-2 font-mono">{formatCode(r.code)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.ownerEmail ?? <span className="text-muted-foreground/50">unclaimed</span>}</td>
                      <td className="px-3 py-2">{r.markedCount || '—'}</td>
                      <td className="px-3 py-2">
                        {release && !release.released ? (
                          r.submittedAt ? (
                            <span className="text-muted-foreground">sealed until release</span>
                          ) : (
                            <span className="text-muted-foreground/50">not scanned</span>
                          )
                        ) : r.bingo ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Bingo ✓</span>
                        ) : r.invalidLines.length > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">Review — marked line with uncalled items</span>
                        ) : r.submittedAt ? (
                          <span className="text-muted-foreground">no bingo</span>
                        ) : (
                          <span className="text-muted-foreground/50">not scanned</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="outline" disabled={!r.marks} onClick={() => void openReview(r.code)}>
                          Verify
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        No boards yet — generate a batch in Print.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
        {reviewCode && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={closeReview}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Verify board"
              className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                <h3 className="text-base font-semibold">Verify board {formatCode(reviewCode)}</h3>
                <button
                  onClick={closeReview}
                  aria-label="Close"
                  className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
                >
                  ×
                </button>
              </div>
              <div className="overflow-y-auto p-5">
                {reviewLoading ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">Loading the scan…</p>
                ) : reviewRow ? (
                  <ReviewDetail row={reviewRow} released={Boolean(release?.released)} calledIds={reviewCalled} />
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">No details available.</p>
                )}
              </div>
            </div>
          </div>
        )}
        {msg && <p className="text-sm text-muted-foreground mt-3">{msg}</p>}
      </CardContent>
    </Card>
  )
}

// Boards-tab verification dialog: the recorded mark grid beside the photo the
// scanner took of the physical sheet, so an admin can confirm the read was
// faithful. Winning lines get a green outline, marked-but-uncalled lines
// amber (once scores have released), and spots whose item IS called per the
// answer keys but NOT marked on the board get a dashed sky outline — if the
// photo shows ink there, it counts (a scanner miss worth fixing).
function ReviewDetail({ row, released, calledIds }: { row: Row; released: boolean; calledIds: Set<string> }) {
  const marks = row.marks ?? ''
  const winSet = new Set(released ? row.winningLines.flat() : [])
  const invalidSet = new Set(released ? row.invalidLines.flat() : [])
  const itemIds = row.itemIds ?? []
  const missed = Array.from({ length: 36 }, (_, i) => itemIds[i]).filter(
    (id, i) => id && calledIds.has(id) && marks[i] !== '1',
  ).length
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <span className="font-medium">{row.markedCount} marked</span>
        {' · '}
        {row.ownerEmail ?? 'unclaimed'}
        {row.submittedAt ? ` · scanned ${new Date(row.submittedAt).toLocaleString()}` : ' · not scanned'}
        {calledIds.size > 0 && (
          <>
            {' · '}
            <span className="font-medium text-sky-600 dark:text-sky-400">{missed} called but not marked</span>
          </>
        )}
      </p>
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        {row.photo ? (
          <img
            src={row.photo}
            alt="Scan photo"
            className="max-h-[64vh] w-full rounded-lg border bg-black object-contain lg:w-[46%] lg:shrink-0"
          />
        ) : (
          <div className="w-full rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground lg:w-[46%] lg:shrink-0">
            No scan photo on file{row.submittedAt ? ' (submitted before photos were kept).' : ' — not scanned yet.'}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="grid grid-cols-6 gap-1.5">
            {COLS.map((c) => (
              <div key={c} className="text-center text-xs font-bold text-muted-foreground">
                {c}
              </div>
            ))}
            {Array.from({ length: 36 }, (_, i) => {
              const marked = marks[i] === '1'
              const inWin = winSet.has(i)
              const inInvalid = invalidSet.has(i)
              const calledNotMarked = Boolean(itemIds[i] && calledIds.has(itemIds[i]) && !marked)
              return (
                <div
                  key={i}
                  title={row.cells[i]}
                  className={`flex aspect-square items-center justify-center rounded-lg border p-1.5 text-center text-[11px] leading-tight break-words ${
                    marked ? 'bg-primary/15 font-semibold' : calledNotMarked ? 'bg-sky-500/5' : 'bg-background'
                  } ${
                    inWin
                      ? 'border-2 border-emerald-500'
                      : inInvalid
                        ? 'border-2 border-amber-500'
                        : calledNotMarked
                          ? 'border-2 border-dashed border-sky-500'
                          : marked
                            ? 'border-primary'
                            : ''
                  }`}
                >
                  <span className="line-clamp-4">{row.cells[i]}</span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Compare the grid against the scan photo to verify the read.{' '}
            {calledIds.size > 0 &&
              'Blue dashed = called item the player did NOT mark — if the photo shows ink there, it counts. '}
            {released
              ? 'Green outline = winning line · amber = marked line with uncalled items.'
              : 'Winning/amber outlines appear once scores release.'}
          </p>
        </div>
      </div>
    </div>
  )
}

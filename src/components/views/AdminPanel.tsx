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
import { formatCode } from '@/lib/layout'
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
  markedCount: number
  submittedAt: string | null
  bingo: boolean
  winningLines: number[][]
  invalidLines: number[][]
  cells: string[]
}
interface KeyInfo {
  email: string
  count: number
  updatedAt: string
}
interface ReleaseInfo {
  released: boolean
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

function initial(email: string) {
  return (email.split('@')[0] ?? '?').slice(0, 1).toUpperCase()
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

  useEffect(() => {
    loadItems()
    loadSubs()
    loadKeys()
    probeDb()
  }, [loadItems, loadSubs, loadKeys, probeDb])

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
          `Generate a fresh set? This starts a new game — it clears the ${parts.join(' and ')} from the last one.`,
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
      } — opening the print view.`,
    )
    loadSubs()
    loadKeys()
  }

  const reprintLast = () => {
    if (!lastIds) {
      setMsg('Generate a batch first.')
      return
    }
    openPrint(`/?print=batch&ids=${lastIds}`)
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
          {release && (
            <Badge variant={release.released ? 'default' : 'outline'}>
              {release.released
                ? `${release.consensusCount} called · scores released`
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
        <Tabs defaultValue="items">
          <TabsList className="flex-wrap h-auto">
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
                  <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm">
                    <span className="font-medium">Scores released.</span> Every admin key is in — boards are graded on
                    the consensus: {keyState.consensusCount} item{keyState.consensusCount === 1 ? '' : 's'} called
                    {keyState.disputedCount > 0 && <> · {keyState.disputedCount} disputed (not counted)</>}.
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <p className="min-w-40 flex-1 text-sm">
                      <span className="font-medium">Scores sealed.</span> {keyState.keys.length} of {keyState.roster.length}{' '}
                      admin key{keyState.roster.length === 1 ? '' : 's'} in
                      {keyState.missing.length > 0 && (
                        <> — waiting for <span className="font-medium">{keyState.missing.join(', ')}</span></>
                      )}
                      . Scores release the moment the last key is saved.
                    </p>
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
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        No boards yet — generate a batch in Print.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
        {msg && <p className="text-sm text-muted-foreground mt-3">{msg}</p>}
      </CardContent>
    </Card>
  )
}

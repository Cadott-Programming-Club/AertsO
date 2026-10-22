'use client'

// Admin panel: item pool, batch printing, answer key, live submissions.

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

export function AdminPanel({ me, openPrint }: { me: Me; openPrint: (url: string) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [batchCount, setBatchCount] = useState(12)
  const [rows, setRows] = useState<Row[]>([])
  const [keyInfo, setKeyInfo] = useState<{ calledCount: number; exists: boolean } | null>(null)
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
      setKeyInfo({ calledCount: json.calledCount, exists: json.answerKeyExists })
    }
  }, [])

  useEffect(() => {
    loadItems()
    loadSubs()
    probeDb()
  }, [loadItems, loadSubs, probeDb])

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
    setMsg(`Generated ${json.boards.length} boards — opening the print view.`)
    loadSubs()
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Admin
          <Badge variant="secondary">{me.email}</Badge>
          {keyInfo && (
            <Badge variant={keyInfo.exists ? 'default' : 'outline'}>
              {keyInfo.exists ? `${keyInfo.calledCount} called` : 'no answer key'}
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
            <TabsTrigger value="subs">
              Boards
              {bingos > 0 && <span className="ml-1.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5">{bingos}</span>}
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
              The answer key is the caller sheet — ink each box as you draw it, then scan it after the game.
            </p>
          </TabsContent>

          <TabsContent value="subs" className="pt-3">
            <div className="flex flex-wrap gap-2 mb-3 text-sm">
              <Badge variant="secondary">{rows.length} boards</Badge>
              <Badge variant="secondary">{rows.filter((r) => r.submittedAt).length} scanned</Badge>
              <Badge variant={bingos ? 'default' : 'secondary'}>{bingos} verified bingos</Badge>
              {flagged > 0 && <Badge variant="destructive">{flagged} to review</Badge>}
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
                        {r.bingo ? (
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

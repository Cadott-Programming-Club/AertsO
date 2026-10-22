'use client'

// AertsO — paper bingo you verify with your phone.
// Single-route app: views switch via search params (?view=scan, ?print=…, ?scan=TOKEN).

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoginView, type Me } from '@/components/views/LoginView'
import { AdminPanel } from '@/components/views/AdminPanel'
import { PrintView } from '@/components/views/PrintView'
import { Scanner } from '@/components/scanner/Scanner'
import { COLS } from '@/lib/layout'

interface MyBoard {
  id: string
  code: string
  token: string
  marks: string | null
  submittedAt: string | null
}

function AertsOApp() {
  const params = useSearchParams()
  const [me, setMe] = useState<Me | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [myBoards, setMyBoards] = useState<MyBoard[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const printParam = params.get('print')
  const idsParam = params.get('ids') ?? undefined
  const stamp = params.get('stamp') ?? undefined
  const answerStamp = params.get('astamp') ?? undefined
  const viewParam = params.get('view')
  const scanDeepLink = params.get('scan') // from a native-camera QR scan
  const showScan = viewParam === 'scan' || Boolean(scanDeepLink)
  const showLogin = viewParam === 'login'

  const refreshMe = useCallback(async () => {
    const res = await fetch('/api/me')
    const json = await res.json().catch(() => ({ user: null }))
    setMe(json.user)
    setMeLoaded(true)
  }, [])

  const refreshBoards = useCallback(async () => {
    if (!me) return
    const res = await fetch('/api/boards')
    if (res.ok) {
      const json = await res.json()
      setMyBoards(json.boards)
    }
  }, [me])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  useEffect(() => {
    refreshBoards()
  }, [refreshBoards])

  const openUrl = useCallback((url: string) => {
    window.location.href = url
  }, [])

  const printMyBoard = async () => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/boards', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(json.error ?? 'Could not create a board.')
        return
      }
      refreshBoards()
      openUrl(`/?print=${json.board.token}`)
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setMe(null)
    setMyBoards([])
    openUrl('/')
  }

  // ---- print overlay mode ----
  if (printParam) {
    return (
      <PrintView
        printParam={printParam}
        idsParam={idsParam}
        stamp={stamp}
        answerStamp={answerStamp}
        onExit={() => openUrl('/')}
      />
    )
  }

  // ---- app shell ----
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
          <a href="/" className="font-extrabold text-xl tracking-[0.3em] text-primary select-none">
            AERTSO
          </a>
          <div className="flex items-center gap-2 text-sm">
            {meLoaded &&
              (me ? (
                <>
                  <span className="text-muted-foreground hidden sm:inline">{me.email}</span>
                  {me.isAdmin && <Badge variant="default">admin</Badge>}
                  <Button variant="ghost" size="sm" onClick={logout}>
                    Sign out
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => openUrl('/?view=login')}>
                  Sign in
                </Button>
              ))}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-5 sm:px-8 py-8 flex flex-col gap-6">
        {showLogin && !me ? (
          <Card>
            <CardContent className="pt-6">
              <LoginView
                onSuccess={(m) => {
                  setMe(m)
                  openUrl('/')
                }}
              />
            </CardContent>
          </Card>
        ) : null}

        {showScan ? (
          <Scanner
            user={me ? { email: me.email, isAdmin: me.isAdmin } : null}
            onDone={() => {
              refreshBoards()
              openUrl('/')
            }}
            loginSlot={
              <LoginView
                embedded
                onSuccess={(m) => {
                  setMe(m)
                  refreshMe()
                }}
              />
            }
          />
        ) : null}

        {!showScan && (
          <>
            <section className="text-center py-4">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                Paper bingo, <span className="text-primary">verified by phone</span>.
              </h1>
              <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                Print a {GRID}-{GRID} sheet, play with a pen like normal bingo, then scan it here to link the board to
                your email and check your marks against the caller&apos;s answer key.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {me ? (
                  <Button size="lg" onClick={printMyBoard} disabled={busy}>
                    {busy ? 'Generating…' : 'Print my board'}
                  </Button>
                ) : (
                  <Button size="lg" onClick={() => openUrl('/?view=login')}>
                    Sign in to print a board
                  </Button>
                )}
                <Button size="lg" variant="outline" onClick={() => openUrl('/?view=scan')}>
                  Scan a sheet
                </Button>
              </div>
              {msg && <p className="mt-3 text-sm text-destructive">{msg}</p>}
            </section>

            <section aria-label="How it works">
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { n: '1', t: 'Print', d: 'Every sheet is a random 6×6 board — no item repeats on a sheet — with a QR code and corner markers.' },
                  { n: '2', t: 'Play on paper', d: 'Ink the small corner box of each space as you get it. Old-school bingo, zero screens while you play.' },
                  { n: '3', t: 'Scan to score', d: 'Photograph your sheet — your board links to your email and your marks are checked against the scanned answer key.' },
                ].map((s) => (
                  <Card key={s.n} className="bg-card">
                    <CardContent className="pt-5">
                      <div className="font-mono text-xs text-muted-foreground mb-2">{s.n}</div>
                      <div className="font-semibold mb-1.5">{s.t}</div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{s.d}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            {me && myBoards.length > 0 && (
              <section aria-label="My boards">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">My boards</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {myBoards.map((b) => (
                      <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg px-3 py-2">
                        <span className="font-mono text-sm">Board {b.code}</span>
                        <span className="text-xs text-muted-foreground">
                          {b.marks ? `${b.marks.split('').filter((c) => c === '1').length} marks scanned` : 'not scanned yet'}
                        </span>
                        <Button size="sm" variant="outline" onClick={() => openUrl(`/?print=${b.token}`)}>
                          Reprint
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}

            {me?.isAdmin && <AdminPanel me={me} openPrint={openUrl} />}
          </>
        )}
      </main>

      <footer className="border-t mt-auto">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>
            Columns spell it out: <span className="font-mono tracking-[0.3em]">{COLS.join('')}</span>
          </span>
          <span>Cadott Programming Club</span>
        </div>
      </footer>
    </div>
  )
}

const GRID = 6

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AertsOApp />
    </Suspense>
  )
}

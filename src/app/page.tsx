'use client'

// AertsO — paper bingo you verify with your phone.
// Single-route app: views switch via search params (?view=scan, ?print=…, ?scan=CODE).
// ?scan=CODE is the deep link baked into every printed QR — a native phone-camera
// scan opens the site straight into the sheet scanner (camera ready, board NOT
// auto-entered — the sheet is scanned so the marks are read off the paper).

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoginView, type Me } from '@/components/views/LoginView'
import { AdminPanel } from '@/components/views/AdminPanel'
import { PrintView } from '@/components/views/PrintView'
import { Scanner } from '@/components/scanner/Scanner'
import { COLS, formatCode } from '@/lib/layout'

interface MyBoard {
  id: string
  code: string
  marks: string | null
  submittedAt: string | null
}

function AertsOApp() {
  const params = useSearchParams()
  const [me, setMe] = useState<Me | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [myBoards, setMyBoards] = useState<MyBoard[]>([])
  const [game, setGame] = useState<{ rules: string; endsAt: string | null; ended: boolean } | null>(null)

  const printParam = params.get('print')
  const idsParam = params.get('ids') ?? undefined
  const stamp = params.get('stamp') ?? undefined
  const answerStamp = params.get('astamp') ?? undefined
  const viewParam = params.get('view')
  const scanDeepLink = params.get('scan') // from a native-camera QR scan
  const showScan = viewParam === 'scan' || Boolean(scanDeepLink)
  const showLogin = viewParam === 'login'
  const showAdmin = viewParam === 'admin'

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
    fetch('/api/game')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setGame(j))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshBoards()
  }, [refreshBoards])

  const openUrl = useCallback((url: string) => {
    window.location.href = url
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setMe(null)
    setMyBoards([])
    openUrl('/')
  }

  // ---- print overlay mode (admins only — gated server-side by /api/admin/print) ----
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
            {me?.isAdmin && (
              <Button variant={showAdmin ? 'default' : 'ghost'} size="sm" onClick={() => openUrl('/?view=admin')}>
                Admin
              </Button>
            )}
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
            initialScan={scanDeepLink}
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
        ) : showAdmin ? (
          me?.isAdmin ? (
            <AdminPanel me={me} openPrint={openUrl} />
          ) : (
            <Card>
              <CardContent className="pt-6 flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {me
                    ? 'This area is for club admins. Ask an admin to add your email if you should have access.'
                    : 'Sign in with an admin email to manage the game.'}
                </p>
                {!me && (
                  <div className="max-w-sm">
                    <LoginView
                      onSuccess={(m) => {
                        setMe(m)
                        refreshMe()
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        ) : null}

        {!showScan && !showAdmin && (
          <>
            <section className="text-center py-4">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                Paper bingo, <span className="text-primary">verified by phone</span>.
              </h1>
              <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                The club prints the {GRID}×{GRID} sheets and hands them out. Play with a pen, then scan yours
                here — your board links to your email and your bingo is checked against the admins&apos;
                answer keys once they&apos;re all in.
              </p>
              {game?.endsAt && (
                <p
                  className={`mt-4 inline-block rounded-md border px-3 py-1.5 text-sm ${
                    game.ended
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-900 dark:text-amber-100'
                      : 'border-primary/30 bg-primary/10 text-foreground'
                  }`}
                >
                  {game.ended
                    ? `The game ended ${new Date(game.endsAt).toLocaleString()} — boards are locked for scoring.`
                    : `Game ends ${new Date(game.endsAt).toLocaleString()} — submit your board by then.`}
                </p>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button size="lg" onClick={() => openUrl('/?view=scan')}>
                  Scan a sheet
                </Button>
                {!me && meLoaded && (
                  <Button size="lg" variant="outline" onClick={() => openUrl('/?view=login')}>
                    Sign in with email
                  </Button>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Printing is for club admins — grab a paper sheet at the club.
              </p>
            </section>

            <section aria-label="How it works">
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { n: '1', t: 'Get a sheet', d: 'Club admins print every AertsO sheet — each one has its own QR code with its board code built in. Just grab one and a pen.' },
                  { n: '2', t: 'Play on paper', d: 'Ink the small corner box of each space as you get it. Old-school bingo, zero screens while you play.' },
                  { n: '3', t: 'Scan to score', d: 'Scan your sheet with the phone camera — the QR and your inked marks are read straight off the paper. Bingo is verified once every admin has entered their answer key and the scores release.' },
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

            {game?.rules && game.rules.trim().length > 0 && (
              <section aria-label="Club rules">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Club rules</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {game.rules}
                    </p>
                  </CardContent>
                </Card>
              </section>
            )}

            {me && myBoards.length > 0 && (
              <section aria-label="My boards">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">My boards</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Scan as often as you like — your marks update on each scan, and bingo is re-checked every time.
                    </p>
                    {myBoards.map((b) => (
                      <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg px-3 py-2">
                        <span className="font-mono text-sm">Board {formatCode(b.code)}</span>
                        <span className="text-xs text-muted-foreground">
                          {b.marks ? `${b.marks.split('').filter((c) => c === '1').length} marks scanned` : 'not scanned yet'}
                        </span>
                        <Button size="sm" variant="outline" onClick={() => openUrl(`/?scan=${b.code}`)}>
                          Scan again / edit marks
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}

            {me?.isAdmin && (
              <p className="text-center text-xs text-muted-foreground">
                Heads-up, admins: printing, answer keys, and game settings now live in the{' '}
                <button className="underline" onClick={() => openUrl('/?view=admin')}>
                  admin panel
                </button>
                .
              </p>
            )}
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

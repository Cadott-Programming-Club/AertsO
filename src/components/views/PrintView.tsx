'use client'

// Print overlay: renders only the sheets + a no-print toolbar.
// Data comes from /api/admin/print, which is admin-only — players never print
// their own paper; club admins generate and print every sheet.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BoardSheet } from '@/components/sheet/BoardSheet'
import { AnswerSheet } from '@/components/sheet/AnswerSheet'

interface BoardView {
  code: string
  cells: string[]
}

export function PrintView({
  printParam,
  idsParam,
  stamp,
  answerStamp,
  onExit,
}: {
  printParam: string
  idsParam?: string
  stamp?: string
  answerStamp?: string
  onExit: () => void
}) {
  const [boards, setBoards] = useState<BoardView[] | null>(null)
  const [items, setItems] = useState<{ id: string; text: string }[] | null>(null)
  const [error, setError] = useState('')
  const [game, setGameState] = useState<{ rules: string } | null>(null)

  const isAnswers = printParam === 'answers'
  const ids = isAnswers ? [] : printParam === 'batch' ? (idsParam ?? '').split(',').filter(Boolean) : [printParam]

  useEffect(() => {
    setError('')
    if (isAnswers) {
      fetch('/api/admin/print?answers=1')
        .then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}))
            throw new Error(j.error ?? 'Could not load the item pool.')
          }
          return r.json()
        })
        .then((j) => setItems(j.items))
        .catch((e) => setError(e.message))
      return
    }
    fetch(`/api/admin/print?ids=${ids.join(',')}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error ?? 'Could not load the boards.')
        }
        return r.json()
      })
      .then((j) => setBoards(j.boards))
      .catch((e) => setError(e.message))
    // game settings (public) — the club rules print on every board sheet
    // (the end date intentionally does NOT print; it shows on the website)
    fetch('/api/game')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setGameState({ rules: (j.rules ?? '') as string }))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids derive from printParam/idsParam
  }, [printParam, idsParam])

  const ready = isAnswers ? items !== null : boards !== null

  // Only the admin print view may reach the printer — globals.css blocks
  // printing everywhere else ("printing is for club admins").
  useEffect(() => {
    if (!ready) return
    document.body.classList.add('print-allowed')
    return () => document.body.classList.remove('print-allowed')
  }, [ready])

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button variant="outline" onClick={onExit}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-200">
      <div className="no-print sticky top-0 z-10 bg-background border-b px-4 py-3 flex flex-wrap items-center gap-3">
        <Button onClick={() => window.print()}>Print</Button>
        <Button variant="outline" onClick={onExit}>
          Back to AertsO
        </Button>
        <p className="text-sm text-muted-foreground">Letter paper · print at 100% / actual size</p>
      </div>
      <div className="print-area py-6">
        {isAnswers ? (
          items ? (
            <AnswerSheet items={items!} origin={typeof window !== 'undefined' ? window.location.origin : ''} stamp={answerStamp} />
          ) : null
        ) : boards ? (
          boards.length === 0 ? (
            <p className="text-center text-muted-foreground py-10">
              No boards on file yet — generate a batch in the admin panel&apos;s Print tab first.
            </p>
          ) : (
            boards.map((b) => (
              <BoardSheet
                key={b.code}
                cells={b.cells}
                code={b.code}
                qrPayload={`${typeof window !== 'undefined' ? window.location.origin : ''}/?scan=${b.code}`}
                stamp={stamp}
                rules={game?.rules}
              />
            ))
          )
        ) : (
          <p className="text-center text-muted-foreground py-10">Loading sheets…</p>
        )}
      </div>
      {ready && boards && boards.length > 0 && (
        <p className="no-print text-center text-xs text-muted-foreground pb-6">
          QR codes carry each board&apos;s code — one phone-camera scan opens the site with that board loaded.
        </p>
      )}
    </div>
  )
}

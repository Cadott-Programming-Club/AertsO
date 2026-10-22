'use client'

// Print overlay: renders only the sheets + a no-print toolbar.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BoardSheet } from '@/components/sheet/BoardSheet'
import { AnswerSheet } from '@/components/sheet/AnswerSheet'

interface BoardView {
  code: string
  token: string
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

  useEffect(() => {
    const origin = window.location.origin
    if (printParam === 'answers') {
      fetch('/api/board/ANSWERS')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load the item pool.'))))
        .then((j) => setItems(j.items))
        .catch((e) => setError(e.message))
      return
    }
    const tokens = printParam === 'batch' ? (idsParam ?? '').split(',').filter(Boolean) : [printParam]
    Promise.all(
      tokens.map((t) =>
        fetch(`/api/board/${t}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load a board.'))))
      )
    )
      .then((js) => setBoards(js.map((j) => j.board)))
      .catch((e) => setError(e.message))
  }, [printParam, idsParam])

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

  const ready = printParam === 'answers' ? items !== null : boards !== null

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
        {printParam === 'answers' ? (
          items ? (
            <AnswerSheet items={items!} origin={typeof window !== 'undefined' ? window.location.origin : ''} stamp={answerStamp} />
          ) : null
        ) : boards ? (
          boards.map((b) => (
            <BoardSheet
              key={b.token}
              cells={b.cells}
              code={b.code}
              qrPayload={`${typeof window !== 'undefined' ? window.location.origin : ''}/?scan=${b.token}`}
              stamp={stamp}
            />
          ))
        ) : (
          <p className="text-center text-muted-foreground py-10">Loading sheets…</p>
        )}
      </div>
    </div>
  )
}

'use client'

// The printed answer key: every pool item with a fill box the caller inks as
// items are drawn. Scanning it records the called set used to verify bingos.
// Box positions come from answerBoxTopLeftMM — the same helper the scanner CV
// uses, so print and detection can never drift.

import {
  FINDER_SIZE,
  answerSheetLayout,
  answerFinderCentersMM,
  answerBoxTopLeftMM,
  ANS_X0,
  ANS_Y0,
  ANS_COL_W,
  ANS_BOX_SIZE,
  ANS_BOX_INSET,
  QR_SIZE,
} from '@/lib/layout'
import { Finder, FillBox, QrBlock, SheetTitle, SheetPage } from './Sheet'

export function AnswerSheet({ items, origin, stamp }: { items: { id: string; text: string }[]; origin: string; stamp?: string }) {
  const { rowH, frameH } = answerSheetLayout(items.length)
  const finderXY = answerFinderCentersMM(frameH).map(([cx, cy]) => [cx - FINDER_SIZE / 2, cy - FINDER_SIZE / 2] as [number, number])
  return (
    <SheetPage>
      <SheetTitle title="AERTSO · ANSWER KEY" sub="CALLER SHEET · INK A BOX WHEN THAT ITEM IS DRAWN" />

      <div style={{ position: 'relative', width: '180mm', height: `${frameH}mm`, margin: '0 auto' }}>
        {finderXY.map(([x, y], i) => (
          <Finder key={i} x={x} y={y} />
        ))}

        {items.map((it, i) => {
          const [bx, by] = answerBoxTopLeftMM(i, rowH)
          const col = i % 6
          const row = Math.floor(i / 6)
          const cellY = ANS_Y0 + row * rowH
          const filled = stamp ? stamp[i] === '1' : false
          return (
            <div key={it.id}>
              <FillBox x={bx} y={by} size={ANS_BOX_SIZE} filled={filled} />
              <div
                style={{
                  position: 'absolute',
                  left: `${bx + ANS_BOX_SIZE + 1}mm`,
                  top: `${cellY}mm`,
                  width: `${ANS_COL_W - (ANS_BOX_INSET + ANS_BOX_SIZE + 2)}mm`,
                  height: `${rowH}mm`,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '6.4pt',
                  lineHeight: 1.1,
                  overflow: 'hidden',
                }}
              >
                {it.text}
              </div>
            </div>
          )
        })}
        <span className="sr-only">{items.length} items</span>
      </div>

      <div style={{ marginTop: '4mm' }}>
        <QrBlock payload={`${origin}/?scan=ANSWERS`} caption="SCAN AFTER THE GAME" size={QR_SIZE} />
      </div>
    </SheetPage>
  )
}

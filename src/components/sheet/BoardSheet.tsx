'use client'

// The printed play sheet: 6x6 board with A-E-R-T-S-O headers, corner fill boxes,
// four finder patterns, QR + human code at the bottom.

import {
  COLS,
  FRAME_W,
  FRAME_H,
  FINDER_CENTERS,
  HEADER_Y,
  HEADER_H,
  GRID_X0,
  GRID_Y0,
  CELL_W,
  CELL_H,
  BOX_SIZE,
  BOX_INSET,
  QR_SIZE,
  formatCode,
} from '@/lib/layout'
import { Finder, FillBox, QrBlock, SheetTitle, SheetPage } from './Sheet'

export function BoardSheet({
  cells,
  code,
  qrPayload,
  stamp,
  rules,
}: {
  cells: string[]
  code: string
  qrPayload: string
  stamp?: string
  rules?: string
}) {
  const finderXY = FINDER_CENTERS.map(([cx, cy]) => [cx - 9, cy - 9]) // top-left of 18mm finder
  return (
    <SheetPage>
      <SheetTitle title="AERTSO" sub="PAPER BINGO · MARK THE CORNER BOX OF EACH SPACE AS YOU GET IT" />

      <div style={{ position: 'relative', width: `${FRAME_W}mm`, height: `${FRAME_H}mm`, margin: '0 auto' }}>
        {/* finder patterns */}
        {finderXY.map(([x, y], i) => (
          <Finder key={i} x={x} y={y} />
        ))}

        {/* column headers A E R T S O */}
        {COLS.map((letter, c) => (
          <div
            key={letter}
            style={{
              position: 'absolute',
              left: `${GRID_X0 + c * CELL_W}mm`,
              top: `${HEADER_Y}mm`,
              width: `${CELL_W}mm`,
              height: `${HEADER_H}mm`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11pt',
              fontWeight: 800,
              letterSpacing: '0.1em',
            }}
          >
            {letter}
          </div>
        ))}

        {/* grid cells */}
        {cells.map((text, i) => {
          const row = Math.floor(i / 6)
          const col = i % 6
          const x = GRID_X0 + col * CELL_W
          const y = GRID_Y0 + row * CELL_H
          const filled = stamp ? stamp[i] === '1' : false
          return (
            <div key={i}>
              <FillBox x={x + BOX_INSET} y={y + BOX_INSET} size={BOX_SIZE} filled={filled} />
              <div
                style={{
                  position: 'absolute',
                  left: `${x + BOX_INSET + BOX_SIZE + 1.2}mm`,
                  top: `${y + 1}mm`,
                  width: `${CELL_W - (BOX_INSET + BOX_SIZE + 2.4)}mm`,
                  height: `${CELL_H - 2}mm`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  fontSize: '6.6pt',
                  lineHeight: 1.15,
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                }}
              >
                {text}
              </div>
              {/* faint cell outline (visual only; CV ignores it) */}
              <div
                style={{
                  position: 'absolute',
                  left: `${x}mm`,
                  top: `${y}mm`,
                  width: `${CELL_W}mm`,
                  height: `${CELL_H}mm`,
                  border: '0.2mm solid #bbb',
                }}
                aria-hidden
              />
            </div>
          )
        })}
      </div>

      {/* QR + code — the QR payload is <origin>/?scan=<CODE>, so the code is
          built into the QR: a native camera scan opens the site with this
          exact board loaded. The printed text is the manual fallback. */}
      <div style={{ marginTop: '4mm' }}>
        <QrBlock payload={qrPayload} caption={`BOARD ${formatCode(code)}`} size={QR_SIZE} />
      </div>

      {/* player footer: how to submit and the club rules.
          Kept compact so everything fits one letter page under the QR.
          The end date is NOT printed — that space belongs to the rules; the
          deadline still shows on the website banner. */}
      <div style={{ width: `${FRAME_W}mm`, margin: '3mm auto 0', textAlign: 'center' }}>
        <div style={{ fontSize: '6pt', lineHeight: 1.3, color: '#222' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.08em' }}>HOW TO SUBMIT: </span>
          Scan the QR code with your phone camera, sign in with your email, and confirm your inked marks. You can
          scan again to update until the game ends.
        </div>
        {rules && rules.trim().length > 0 && (
          <div style={{ fontSize: '5.5pt', lineHeight: 1.25, color: '#333', marginTop: '1.5mm', whiteSpace: 'pre-wrap' }}>
            RULES: {rules.trim().slice(0, 600)}
            {rules.trim().length > 600 ? '…' : ''}
          </div>
        )}
      </div>
    </SheetPage>
  )
}

// Multi-board batch: one sheet page per board.
export function BoardBatch({
  boards,
  origin,
  stamps,
  rules,
}: {
  boards: { cells: string[]; code: string }[]
  origin: string
  stamps?: Record<string, string>
  rules?: string
}) {
  return (
    <>
      {boards.map((b) => (
        <BoardSheet
          key={b.code}
          cells={b.cells}
          code={b.code}
          qrPayload={`${origin}/?scan=${b.code}`}
          stamp={stamps?.[b.code]}
          rules={rules}
        />
      ))}
    </>
  )
}

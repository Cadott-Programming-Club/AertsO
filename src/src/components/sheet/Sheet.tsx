'use client'

// Shared sheet primitives: finder patterns, fill boxes, QR, page chrome.
// All geometry flows from src/lib/layout.ts (single source of truth with the scanner).

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { FINDER_SIZE, FINDER_MODULE } from '@/lib/layout'

export function Finder({ x, y }: { x: number; y: number }) {
  // QR-style finder: 1:1:3:1:1 concentric squares
  const inner = FINDER_SIZE - 2 * FINDER_MODULE
  const core = FINDER_SIZE - 4 * FINDER_MODULE
  return (
    <div style={{ position: 'absolute', left: `${x}mm`, top: `${y}mm`, width: `${FINDER_SIZE}mm`, height: `${FINDER_SIZE}mm` }}>
      <div style={{ position: 'absolute', inset: 0, background: '#000' }} />
      <div style={{ position: 'absolute', left: `${FINDER_MODULE}mm`, top: `${FINDER_MODULE}mm`, width: `${inner}mm`, height: `${inner}mm`, background: '#fff' }} />
      <div style={{ position: 'absolute', left: `${2 * FINDER_MODULE}mm`, top: `${2 * FINDER_MODULE}mm`, width: `${core}mm`, height: `${core}mm`, background: '#000' }} />
    </div>
  )
}

export function FillBox({ x, y, size, filled }: { x: number; y: number; size: number; filled: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}mm`,
        top: `${y}mm`,
        width: `${size}mm`,
        height: `${size}mm`,
        border: '0.35mm solid #000',
        background: filled ? '#000' : '#fff',
        borderRadius: '0.4mm',
      }}
      aria-hidden
    />
  )
}

export function QrBlock({ payload, caption, size }: { payload: string; caption: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(payload, { margin: 0, width: 360, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(null))
  }, [payload])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5mm' }}>
      {src ? (
        <img src={src} alt="" style={{ width: `${size}mm`, height: `${size}mm`, display: 'block' }} />
      ) : (
        <div style={{ width: `${size}mm`, height: `${size}mm` }} />
      )}
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '9pt', fontWeight: 700, letterSpacing: '0.25em' }}>
        {caption}
      </div>
    </div>
  )
}

export function SheetTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: '2mm' }}>
      <div style={{ fontSize: '15pt', fontWeight: 800, letterSpacing: '0.42em', textIndent: '0.42em' }}>{title}</div>
      <div style={{ fontSize: '6.5pt', letterSpacing: '0.18em', color: '#333', marginTop: '0.5mm' }}>{sub}</div>
    </div>
  )
}

// Page wrapper: one sheet per printed page.
export function SheetPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="sheet-page" style={{ width: '216mm', minHeight: '279mm', padding: '10mm 18mm', background: '#fff', color: '#000', margin: '0 auto' }}>
      {children}
    </div>
  )
}

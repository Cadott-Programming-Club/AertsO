'use client'

// AertsO sheet scanner: camera or photo upload -> jsQR identifies the sheet ->
// finder-pattern homography samples the fill boxes -> human confirms -> submit.
// Every CV step degrades gracefully to manual taps, so a bad photo never
// blocks the game.

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  COLS,
  parseScanPayload,
  formatCode,
  FRAME_W,
  GRID,
  fillBoxCenterMM,
  answerBoxCenterMM,
  answerSheetLayout,
  finderCentersNorm,
  answerFinderCentersMM,
  BOX_SIZE,
  ANSWER_TOKEN,
} from '@/lib/layout'
import { binarize, findFinderCandidates, assignCorners, detectMarks, decodeQR, type Pt } from '@/lib/cv'

export interface BoardData {
  code: string
  cells: string[]
  itemIds: string[]
}
export interface AnswerData {
  items: { id: string; text: string }[]
}

type Phase = 'choose' | 'camera' | 'processing' | 'confirm' | 'done'

interface ScanOutcome {
  kind: 'board' | 'answers'
  board?: BoardData
  answerItems?: { id: string; text: string }[]
  marks: boolean[]
  confidence: number[]
  aligned: boolean
  findersFound: number
  photo: string // dataURL for the confirm view
  needsLogin?: boolean
}

export function Scanner({
  user,
  initialScan,
  onDone,
  loginSlot,
}: {
  user: { email: string; isAdmin: boolean } | null
  initialScan?: string | null
  onDone: () => void
  loginSlot: React.ReactNode
}) {
  const [phase, setPhase] = useState<Phase>('choose')
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [marks, setMarks] = useState<boolean[]>([])
  const [status, setStatus] = useState('')
  // getUserMedia was refused without a user gesture (iOS Safari deep link) or
  // the permission is off — park on a one-tap "Start the camera" screen.
  const [needsTap, setNeedsTap] = useState(false)
  // the sheet wouldn't frame for ~7s — surface an explicit manual-entry escape
  const [frameTrouble, setFrameTrouble] = useState(false)
  const [submitResult, setSubmitResult] = useState<null | {
    board?: { code?: string }
    bingo?: boolean
    answerKeyExists?: boolean
    calledCount?: number
    saved?: boolean
    released?: boolean
    pendingAdmins?: string[]
    disputedCount?: number
    keysCount?: number
  }>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // sheet lookups are cached per scan session — the live loop re-analyzes every
  // 500ms while the user frames the sheet, and the board layout never changes.
  const boardCacheRef = useRef<Map<string, BoardData>>(new Map())
  const answersCacheRef = useRef<{ id: string; text: string }[] | null>(null)
  // consecutive frames where the QR decoded but the sheet wasn't framed yet
  const unframedRef = useRef(0)
  // after this many unframed tries (~7s) we surface an explicit "tap your marks
  // manually" escape button. The live loop itself NEVER accepts a QR-only
  // decode — auto-dumping an unframed player into the manual grid is exactly
  // the "it only lets me punch it in" bug the QR deep-link flow had.
  const UNFRAMED_LIMIT = 14

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ---------- core: analyze one frame/image ----------
  // requireFrame: live camera mode refuses a QR-only decode — the sheet must
  // be framed (all four corner finders visible) so the marks are actually
  // sampled off the paper. Returns 'unframed' to keep the loop scanning.
  const analyze = useCallback(
    async (canvas: HTMLCanvasElement, opts: { requireFrame?: boolean } = {}): Promise<ScanOutcome | 'unframed' | null> => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    void ctx
    // downscale to sane CV size
    const maxDim = 1500
    const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height))
    const w = Math.round(canvas.width * scale)
    const h = Math.round(canvas.height * scale)
    const small = document.createElement('canvas')
    small.width = w
    small.height = h
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    sctx.drawImage(canvas, 0, 0, w, h)
    const img = sctx.getImageData(0, 0, w, h)

    // 1) QR — layered: native BarcodeDetector -> jsQR full -> jsQR bottom-center crop
    //    (the QR always sits bottom-center under the frame, and dense sheets can
    //    drown jsQR's pattern search in false finder candidates)
    const qr = await decodeQR(small, img, (d, ww, hh) => jsQR(d, ww, hh, { inversionAttempts: 'attemptBoth' }))
    if (!qr) return null
    const payload = parseScanPayload(qr.data)
    if (!payload) return null
    const qrCenter: Pt = qr.center
    const qrWidth = qr.width

    // 2) fetch sheet content (cached — the live loop re-runs while framing)
    let board: BoardData | undefined
    let answerItems: { id: string; text: string }[] | undefined
    if (payload.kind === 'board') {
      const cached = boardCacheRef.current.get(payload.code)
      if (cached) {
        board = cached
      } else {
        const res = await fetch(`/api/board/${payload.code}`)
        if (!res.ok) return null
        const json = await res.json()
        board = json.board as BoardData
        boardCacheRef.current.set(payload.code, board)
      }
    } else {
      const cached = answersCacheRef.current
      if (cached) {
        answerItems = cached
      } else {
        const res = await fetch(`/api/board/${ANSWER_TOKEN}`)
        if (!res.ok) return null
        const json = await res.json()
        answerItems = json.items as { id: string; text: string }[]
        answersCacheRef.current = answerItems
      }
    }

    // 3) finder detection
    const { bin } = binarize(img)
    // QR printed at QR_SIZE mm -> mm-per-px estimate -> expected finder px
    const mmPerPx = QR_PRINTED_MM / Math.max(qrWidth, 1)
    const finderPx = FINDER_PRINTED_MM / mmPerPx
    const candidates = findFinderCandidates(bin, w, h, finderPx * 0.55, finderPx * 1.6)
    const corners = assignCorners(candidates, qrCenter)

    // framing gate (live camera): no accept until the whole sheet is in view —
    // right after a native QR scan the phone is still close to the sheet, and
    // accepting a QR-only decode there dumps the player into manual tapping.
    // Marks can only be sampled when all four corner finders are visible.
    if (opts.requireFrame) {
      const topEdgePx = corners ? Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) : 0
      if (!corners || topEdgePx < 250) return 'unframed'
    }

    let marks: boolean[] = []
    let confidence: number[] = []
    let aligned = false
    let findersFound = candidates.length

    if (board) {
      const n = GRID * GRID
      if (corners) {
        const norm = finderCentersNorm(FRAME_H_BOARD)
        const boxes: Pt[] = []
        for (let i = 0; i < n; i++) {
          const [x, y] = fillBoxCenterMM(Math.floor(i / GRID), i % GRID)
          boxes.push({ x: x / FRAME_W, y: y / FRAME_H_BOARD })
        }
        const res = detectMarks(bin, w, h, corners, norm, boxes, (BOX_SIZE / FRAME_W) * 0.55)
        marks = res.marks
        confidence = res.confidence
        aligned = res.aligned
      } else {
        marks = new Array(n).fill(false)
        confidence = new Array(n).fill(0)
      }
    } else if (answerItems) {
      const n = answerItems.length
      const { rowH, frameH } = answerSheetLayout(n)
      if (corners) {
        const norm = answerFinderCentersMM(frameH).map(([x, y]) => ({ x: x / FRAME_W, y: y / frameH }))
        const boxes: Pt[] = answerItems.map((_, i) => {
          const [x, y] = answerBoxCenterMM(i, rowH)
          return { x: x / FRAME_W, y: y / frameH }
        })
        const res = detectMarks(bin, w, h, corners, norm, boxes, (BOX_SIZE / FRAME_W) * 0.55)
        marks = res.marks
        confidence = res.confidence
        aligned = res.aligned
      } else {
        marks = new Array(n).fill(false)
        confidence = new Array(n).fill(0)
      }
    }

    // photo thumbnail for the confirm step
    const photo = document.createElement('canvas')
    const pw = 380
    photo.width = pw
    photo.height = Math.round((h / w) * pw)
    photo.getContext('2d')!.drawImage(small, 0, 0, photo.width, photo.height)

    return {
      kind: payload.kind,
      board,
      answerItems,
      marks,
      confidence,
      aligned,
      findersFound,
      photo: photo.toDataURL('image/jpeg', 0.7),
    }
  }, [])

  const runOutcome = (res: ScanOutcome) => {
    setOutcome(res)
    setMarks(res.marks)
    setPhase('confirm')
    setStatus(
      res.aligned
        ? `Sheet detected — ${res.marks.filter(Boolean).length} marked space${res.marks.filter(Boolean).length === 1 ? '' : 's'} found. Check them below and fix anything wrong.`
        : res.findersFound >= 4
          ? 'QR read, but alignment failed — tap your marked spaces below.'
          : 'QR read — tap your marked spaces below.'
    )
  }

  // ---------- camera ----------
  const startCamera = async () => {
    setPhase('camera')
    setNeedsTap(false)
    setFrameTrouble(false)
    unframedRef.current = 0
    setStatus('Fit the whole sheet in the frame — the QR and your inked marks are read together.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      timerRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return
        const v = videoRef.current
        const canvas = document.createElement('canvas')
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        if (!canvas.width) return
        canvas.getContext('2d')!.drawImage(v, 0, 0)
        // live camera ALWAYS requires the whole sheet to be framed — the marks
        // are read off the paper, never guessed from a QR-only decode. A player
        // who can't frame the sheet gets an explicit escape button instead of
        // being dropped into the manual tap grid.
        const res = await analyze(canvas, { requireFrame: true })
        if (res === 'unframed') {
          unframedRef.current++
          if (unframedRef.current >= UNFRAMED_LIMIT) setFrameTrouble(true)
          setStatus(
            unframedRef.current > 8
              ? 'Still reading the sheet — flatten the paper, use even light, and fill the frame with the whole sheet.'
              : 'QR found — pull back so the whole sheet fits in the frame.',
          )
          return
        }
        if (res) {
          stopCamera()
          runOutcome(res)
        }
      }, 500)
    } catch {
      // Most often iOS Safari refusing a programmatic camera start without a
      // user gesture (a deep link just opened the page), or the camera
      // permission is off. Never fall back to manual entry over this — one
      // tap satisfies the gesture requirement and unlocks the camera.
      console.warn('[aertso] camera start failed — parking on one-tap start')
      stopCamera()
      setNeedsTap(true)
    }
  }

  // ---------- manual escape (live loop couldn't frame the sheet) ----------
  // Hands the player the tap grid using whatever the camera currently sees.
  // Only reachable through the explicit button — never chosen for them.
  const manualFromCamera = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    const res = await analyze(canvas)
    if (res && res !== 'unframed') {
      stopCamera()
      runOutcome(res)
    } else {
      setStatus('Point the camera at the sheet so the QR at the bottom is readable, then try again.')
    }
  }

  // ---------- deep link (?scan=CODE from a native-camera QR scan) ----------
  // The printed QR contains the board code — a native camera scan opens the
  // site straight into the SHEET SCANNER. The board is never auto-entered:
  // the in-app scan re-reads the QR (identifying the sheet) and samples the
  // player's inked marks off the paper in the same pass. Where the platform
  // refuses a gesture-less camera start (iOS Safari), startCamera parks on a
  // one-tap "Start the camera" screen instead of falling back to manual entry.
  const deepLinkRef = useRef<string | null>(null)
  useEffect(() => {
    const raw = initialScan?.trim()
    if (!raw || deepLinkRef.current === raw) return
    deepLinkRef.current = raw
    void startCamera()
  }, [initialScan])

  // ---------- upload ----------
  const onUpload = async (file: File) => {
    setPhase('processing')
    setStatus('Reading the sheet…')
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      const res = await analyze(canvas)
      if (res && res !== 'unframed') {
        runOutcome(res)
      } else {
        setStatus("Couldn't find the QR code in that photo — try better lighting and make sure the QR at the bottom is visible.")
        setPhase('choose')
      }
    } catch (err) {
      console.error('[aertso] scan failed', err)
      setStatus(`Scan failed: ${(err as Error).message}. Try again, or upload a photo.`)
      setPhase('choose')
    }
  }

  // ---------- submit ----------
  const submit = async () => {
    if (!user) return
    if (outcome?.kind === 'answers') {
      if (!user.isAdmin) {
        setStatus('Only admins can save the answer key.')
        return
      }
      const ids = outcome.answerItems!.filter((_, i) => marks[i]).map((it) => it.id)
      const res = await fetch('/api/admin/answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: ids }),
      })
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        setSubmitResult({ saved: true, calledCount: ids.length, ...json })
        setPhase('done')
      } else {
        setStatus('Could not save the answer key — try again.')
      }
      return
    }
    const bitmap = marks.map((m) => (m ? '1' : '0')).join('')
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: outcome?.board?.code, marks: bitmap }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(json.error ?? 'Could not save — try again.')
      return
    }
    // API returns { ok, board, status } — flatten so the done view can read
    // bingo / answerKeyExists / calledCount directly.
    setSubmitResult({ board: json.board, ...json.status })
    setPhase('done')
  }

  // ---------- render ----------
  if (phase === 'choose') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scan a sheet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button onClick={startCamera}>Use camera</Button>
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                }}
              />
              <Button variant="outline" className="w-full" onClick={(e) => (e.currentTarget.parentElement as HTMLLabelElement).querySelector('input')!.click()}>
                Upload a photo
              </Button>
            </label>
          </div>
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </CardContent>
      </Card>
    )
  }

  if (phase === 'camera') {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            {needsTap && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                <p className="text-sm text-white/90">The camera needs one tap to start.</p>
                <Button size="lg" onClick={() => void startCamera()}>
                  Start the camera
                </Button>
                <p className="text-xs text-white/60">
                  If it still won&apos;t open, allow camera access for this site in your browser settings — or
                  cancel and upload a photo of the sheet.
                </p>
              </div>
            )}
          </div>
          {!needsTap && <p className="text-sm text-muted-foreground">{status}</p>}
          {frameTrouble && !needsTap && (
            <div className="rounded-lg border bg-muted/40 p-3 flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Can&apos;t get the whole sheet in view? Your marks can also be tapped in by hand.
              </p>
              <Button variant="outline" onClick={() => void manualFromCamera()}>
                Enter marks by tapping instead
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              stopCamera()
              setPhase('choose')
            }}
          >
            Cancel
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'processing') {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">{status}</CardContent>
      </Card>
    )
  }

  if (phase === 'confirm' && outcome) {
    const isAnswers = outcome.kind === 'answers'
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {isAnswers ? 'Answer key' : `Board ${formatCode(outcome.board?.code ?? '')}`}
            {!isAnswers && <Badge variant="secondary">36 spaces</Badge>}
            {isAnswers && <Badge variant="secondary">{outcome.answerItems?.length ?? 0} items</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{status}</p>
          <div className="flex gap-4">
            {outcome.photo && (
              <img src={outcome.photo} alt="Scanned sheet" className="hidden md:block w-40 rounded-lg border" />
            )}
            <div className="flex-1">
              {isAnswers ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-96 overflow-y-auto pr-1">
                  {outcome.answerItems!.map((it, i) => (
                    <button
                      key={it.id}
                      onClick={() => setMarks((m) => m.map((v, j) => (j === i ? !v : v)))}
                      className={`text-left text-xs rounded-lg border px-2.5 py-2 min-h-11 transition-colors ${
                        marks[i] ? 'border-primary bg-primary/10 font-medium' : 'bg-background hover:bg-muted'
                      }`}
                    >
                      {it.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-1">
                  {COLS.map((c) => (
                    <div key={c} className="text-center text-xs font-bold text-muted-foreground">
                      {c}
                    </div>
                  ))}
                  {Array.from({ length: 36 }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setMarks((m) => m.map((v, j) => (j === i ? !v : v)))}
                      className={`aspect-square rounded-lg border text-[10px] leading-tight p-1 flex items-center justify-center text-center transition-colors ${
                        marks[i] ? 'border-primary bg-primary/15 font-semibold' : 'bg-background hover:bg-muted'
                      }`}
                      title={outcome.board?.cells[i]}
                    >
                      <span className="line-clamp-3 break-words">{outcome.board?.cells[i]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {!user ? (
            <div className="border rounded-xl p-4 bg-muted/40">
              <p className="text-sm font-medium mb-3">Sign in to link this board to your email</p>
              {loginSlot}
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button onClick={submit}>{isAnswers ? 'Save answer key' : 'These are my marks'}</Button>
              {!outcome.aligned && (
                <Button variant="outline" onClick={() => startCamera()}>
                  Scan again
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setOutcome(null)
                  setPhase('choose')
                }}
              >
                Scan a different sheet
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  if (phase === 'done' && submitResult) {
    const savedKey = submitResult.saved
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {savedKey
              ? submitResult.released
                ? 'Master key saved — scores released'
                : 'Master key saved — scores sealed'
              : `Board ${formatCode(submitResult.board?.code ?? '')} linked to your email`}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {savedKey ? (
            submitResult.released ? (
              <p className="text-sm text-muted-foreground">
                Your key is in — that was the last one, so scores are released to everyone. Boards are graded on
                the consensus of all {submitResult.keysCount} key{submitResult.keysCount === 1 ? '' : 's'}
                {typeof submitResult.disputedCount === 'number' && submitResult.disputedCount > 0
                  ? ` (${submitResult.disputedCount} disputed item${submitResult.disputedCount === 1 ? '' : 's'} not counted)`
                  : ''}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your key is saved — {submitResult.calledCount} item{submitResult.calledCount === 1 ? '' : 's'} recorded.
                Scores stay sealed until every admin saves their key
                {submitResult.pendingAdmins?.length
                  ? ` (still waiting on ${submitResult.pendingAdmins.join(', ')})`
                  : ''}
                . They release automatically the moment the last one lands.
              </p>
            )
          ) : submitResult.released && submitResult.bingo ? (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Verified bingo — a full line of called items. 🎉</p>
          ) : submitResult.released ? (
            <p className="text-sm text-muted-foreground">
              Marks saved. No verified bingo yet against the {submitResult.calledCount} called items.
            </p>
          ) : submitResult.answerKeyExists ? (
            <p className="text-sm text-muted-foreground">
              Marks saved. Scores are sealed until every admin saves their answer key
              {submitResult.pendingAdmins?.length
                ? ` (waiting on ${submitResult.pendingAdmins.join(', ')})`
                : ''}
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Marks saved. Bingo status appears once admins scan in their answer keys.</p>
          )}
          {!savedKey && (
            <p className="text-xs text-muted-foreground">
              Playing on? Scan this sheet again anytime — your marks update on every scan, and bingo is re-checked
              against the admins&apos; keys each time.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {!savedKey && (
              <Button
                onClick={() => {
                  setSubmitResult(null)
                  setOutcome(null)
                  void startCamera()
                }}
              >
                Scan again / update my marks
              </Button>
            )}
            <Button variant="outline" onClick={onDone}>
              Done
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return null
}

// printed constants for scale estimation (mm) — mirrors layout.ts print sizes
const QR_PRINTED_MM = 28
const FINDER_PRINTED_MM = 18
const FRAME_H_BOARD = 180

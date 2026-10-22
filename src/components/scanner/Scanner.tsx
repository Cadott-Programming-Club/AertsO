'use client'

// AertsO sheet scanner: camera or photo upload -> jsQR identifies the sheet ->
// finder-pattern homography samples the fill boxes -> human confirms -> submit.
// Every CV step degrades gracefully to manual taps, so a bad photo never
// blocks the game.

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  COLS,
  parseScanPayload,
  parseScanValue,
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
  const [manualCode, setManualCode] = useState('')
  const [manualError, setManualError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ---------- deep link (?scan=CODE from a native-camera QR scan) ----------
  // The printed QR contains the board code, so a phone's built-in camera can
  // open the site with the board already identified — no in-app re-scan.
  const deepLinkRef = useRef<string | null>(null)
  useEffect(() => {
    const raw = initialScan?.trim()
    if (!raw || deepLinkRef.current === raw) return
    deepLinkRef.current = raw
    const payload = parseScanValue(raw)
    if (!payload) return
    void resolveDeepLink(payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per payload
  }, [initialScan])

  const resolveDeepLink = async (payload: { kind: 'board'; code: string } | { kind: 'answers' }) => {
    setPhase('processing')
    setStatus('Loading sheet…')
    try {
      if (payload.kind === 'board') {
        const res = await fetch(`/api/board/${payload.code}`)
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? 'No board matches that code.')
        }
        const json = await res.json()
        runOutcome({
          kind: 'board',
          board: json.board,
          marks: new Array(36).fill(false),
          confidence: new Array(36).fill(0),
          aligned: false,
          findersFound: 0,
          photo: '',
        })
        setStatus(`Board ${formatCode(json.board.code)} loaded — tap the spaces you marked on paper, then submit.`)
      } else {
        const res = await fetch(`/api/board/${ANSWER_TOKEN}`)
        if (!res.ok) throw new Error('Could not load the item pool.')
        const json = await res.json()
        const n: number = json.items.length
        runOutcome({
          kind: 'answers',
          answerItems: json.items,
          marks: new Array(n).fill(false),
          confidence: new Array(n).fill(0),
          aligned: false,
          findersFound: 0,
          photo: '',
        })
        setStatus('Answer key — tap every item that was drawn, then save. Your key is yours alone; scores release once every admin has saved theirs.')
      }
    } catch (e) {
      setStatus((e as Error).message)
      setPhase('choose')
    }
  }

  // ---------- core: analyze one frame/image ----------
  const analyze = useCallback(async (canvas: HTMLCanvasElement): Promise<ScanOutcome | null> => {
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

    // 2) fetch sheet content
    let board: BoardData | undefined
    let answerItems: { id: string; text: string }[] | undefined
    if (payload.kind === 'board') {
      const res = await fetch(`/api/board/${payload.code}`)
      if (!res.ok) return null
      const json = await res.json()
      board = json.board
    } else {
      const res = await fetch(`/api/board/${ANSWER_TOKEN}`)
      if (!res.ok) return null
      const json = await res.json()
      answerItems = json.items
    }

    // 3) finder detection
    const { bin } = binarize(img)
    // QR printed at QR_SIZE mm -> mm-per-px estimate -> expected finder px
    const mmPerPx = QR_PRINTED_MM / Math.max(qrWidth, 1)
    const finderPx = FINDER_PRINTED_MM / mmPerPx
    const candidates = findFinderCandidates(bin, w, h, finderPx * 0.55, finderPx * 1.6)
    const corners = assignCorners(candidates, qrCenter)

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
    setStatus('Point at the QR code at the bottom of the sheet…')
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
        const res = await analyze(canvas)
        if (res) {
          stopCamera()
          runOutcome(res)
        }
      }, 500)
    } catch {
      setStatus('Camera unavailable — upload a photo or type the board code instead.')
      setPhase('choose')
    }
  }

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
      if (res) {
        runOutcome(res)
      } else {
        setStatus("Couldn't find the QR code in that photo — try better lighting, or type the board code.")
        setPhase('choose')
      }
    } catch (err) {
      console.error('[aertso] scan failed', err)
      setStatus(`Scan failed: ${(err as Error).message}. Try the board code instead.`)
      setPhase('choose')
    }
  }

  // ---------- manual code ----------
  const onManualCode = async () => {
    setManualError('')
    const res = await fetch(`/api/boards/lookup?code=${encodeURIComponent(manualCode.trim())}`)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setManualError(json.error ?? 'No board with that code.')
      return
    }
    const json = await res.json()
    runOutcome({
      kind: 'board',
      board: json.board,
      marks: new Array(36).fill(false),
      confidence: new Array(36).fill(0),
      aligned: false,
      findersFound: 0,
      photo: '',
    })
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
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                placeholder="Board code (e.g. K7QM-X2P9)"
                value={manualCode}
                maxLength={9}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && onManualCode()}
              />
              {manualError && <p className="text-destructive text-sm mt-1">{manualError}</p>}
            </div>
            <Button variant="secondary" onClick={onManualCode}>
              Look up
            </Button>
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
          </div>
          <p className="text-sm text-muted-foreground">{status}</p>
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
          <Button variant="outline" onClick={onDone}>
            Done
          </Button>
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

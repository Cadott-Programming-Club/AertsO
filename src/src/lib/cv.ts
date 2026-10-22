// AertsO scanner CV — best-effort mark detection with a human-confirm safety net.
// Pipeline: binarize -> QR decode (jsQR, done by caller) -> finder-pattern
// detection (1:1:3:1:1 scanline) -> 4-point homography -> sample fill boxes.

export interface Pt {
  x: number
  y: number
}

export interface DetectResult {
  marks: boolean[] // per fill box
  confidence: number[] // dark ratio per box, 0..1
  aligned: boolean // homography validated (finder centers sample dark)
  findersFound: number
}

// ---------- grayscale + adaptive binarize (integral image) ----------
export function binarize(src: ImageData): { bin: Uint8Array; w: number; h: number } {
  const { width: w, height: h, data } = src
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  // integral image
  const integ = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x]
      integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + rowSum
    }
  }
  const win = Math.max(15, Math.floor(Math.min(w, h) / 16)) | 1
  const rad = Math.floor(win / 2)
  const bin = new Uint8Array(w * h) // 1 = black
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad)
    const y1 = Math.min(h - 1, y + rad)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad)
      const x1 = Math.min(w - 1, x + rad)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        integ[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integ[y0 * (w + 1) + (x1 + 1)] -
        integ[(y1 + 1) * (w + 1) + x0] +
        integ[y0 * (w + 1) + x0]
      const mean = sum / area
      bin[y * w + x] = gray[y * w + x] < mean - 8 ? 1 : 0
    }
  }
  return { bin, w, h }
}

// ---------- finder pattern candidates via 1:1:3:1:1 scanlines ----------
interface Candidate {
  x: number
  y: number
  size: number
}

function runLengths(bin: Uint8Array, w: number, h: number, row: number) {
  const runs: { color: number; len: number; end: number }[] = []
  let start = 0
  for (let x = 1; x <= w; x++) {
    const cur = x < w ? bin[row * w + x] : -1
    const prev = bin[row * w + x - 1]
    if (cur !== prev) {
      runs.push({ color: prev, len: x - start, end: x })
      start = x
    }
  }
  return runs
}

function matchFinderRatio(runs: { color: number; len: number; end: number }[]): number | null {
  // look for B W B W B with lengths ~ 1:1:3:1:1
  for (let i = 0; i + 4 < runs.length; i++) {
    const [a, b, c, d, e] = [runs[i], runs[i + 1], runs[i + 2], runs[i + 3], runs[i + 4]]
    if (a.color !== 1 || b.color !== 0 || c.color !== 1 || d.color !== 0 || e.color !== 1) continue
    const unit = (a.len + b.len + c.len + d.len + e.len) / 7
    const ok = (v: number, k: number) => Math.abs(v - unit * k) < unit * 0.65
    if (ok(a.len, 1) && ok(b.len, 1) && ok(c.len, 3) && ok(d.len, 1) && ok(e.len, 1)) {
      // center of the full 5-run pattern: midpoint of [start of a, end of e]
      return (runs[i].end - a.len + e.end) / 2
    }
  }
  return null
}

export function findFinderCandidates(
  bin: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  maxSize: number
): Candidate[] {
  const hits: { x: number; y: number }[] = []
  const step = Math.max(1, Math.floor(h / 300))
  for (let y = 2; y < h - 2; y += step) {
    const runs = runLengths(bin, w, h, y)
    for (let i = 0; i + 4 < runs.length; i++) {
      const r = matchFinderRatio(runs.slice(i, i + 5))
      if (r == null) continue
      const total = runs[i].len + runs[i + 1].len + runs[i + 2].len + runs[i + 3].len + runs[i + 4].len
      const size = (total / 7) * 7 // whole pattern width
      if (size < minSize || size > maxSize) continue
      hits.push({ x: r, y })
    }
  }
  // cluster hits -> vertical-verified candidates
  const candidates: Candidate[] = []
  const used = new Array(hits.length).fill(false)
  hits.sort((p, q) => p.x - q.x)
  for (let i = 0; i < hits.length; i++) {
    if (used[i]) continue
    const cluster = [hits[i]]
    used[i] = true
    for (let j = i + 1; j < hits.length; j++) {
      if (used[j]) continue
      if (Math.abs(hits[j].x - hits[i].x) < minSize * 0.6 && Math.abs(hits[j].y - hits[i].y) < minSize * 2.5) {
        cluster.push(hits[j])
        used[j] = true
      }
    }
    const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length
    const yMin = Math.min(...cluster.map((p) => p.y))
    const yMax = Math.max(...cluster.map((p) => p.y))
    if (yMax - yMin < minSize * 0.5) continue // must span vertically like a square
    const cy = (yMin + yMax) / 2
    const size = yMax - yMin + minSize * 0.9
    if (size < minSize || size > maxSize) continue
    candidates.push({ x: cx, y: cy, size })
  }
  return candidates
}

// ---------- homography (DLT, 4 point pairs) ----------
export function solveHomography(src: Pt[], dst: Pt[]): number[] | null {
  const n = 8
  const A: number[][] = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A[i * 2] = [x, y, 1, 0, 0, 0, -x * u, -y * u, u]
    A[i * 2 + 1] = [0, 0, 0, x, y, 1, -x * v, -y * v, v]
  }
  // Gaussian elimination with partial pivot
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-10) return null
    ;[A[col], A[piv]] = [A[piv], A[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]
    }
  }
  const H = new Array(9).fill(0)
  for (let i = 0; i < n; i++) H[i] = A[i][n] / A[i][i]
  H[8] = 1
  return H
}

export function applyH(H: number[], p: Pt): Pt {
  const d = H[6] * p.x + H[7] * p.y + H[8]
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d }
}

// ---------- QR decoding (layered) ----------
// Native BarcodeDetector (Chrome/Android, very robust) -> jsQR on the full
// image -> jsQR on a bottom-center crop (the QR always sits under the frame;
// dense sheets can drown jsQR's finder search in false candidates).

export interface DecodedQR {
  data: string
  center: Pt
  width: number
  via: string
}

interface JsQrLocation {
  topLeftCorner: Pt
  topRightCorner: Pt
  bottomRightCorner: Pt
  bottomLeftCorner: Pt
}

export async function decodeQR(
  fullCanvas: HTMLCanvasElement,
  fullImageData: ImageData,
  jsQR: (data: Uint8ClampedArray, w: number, h: number, opts?: { inversionAttempts?: string }) => { data: string; location: JsQrLocation } | null
): Promise<DecodedQR | null> {
  const w = fullImageData.width
  const h = fullImageData.height

  // 1) native BarcodeDetector
  const BD = (globalThis as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: CanvasImageSource) => Promise<{ rawValue: string; cornerPoints: Pt[] }[]> } }).BarcodeDetector
  if (BD) {
    try {
      const detector = new BD({ formats: ['qr_code'] })
      const codes = await detector.detect(fullCanvas)
      if (codes.length) {
        const pts = codes[0].cornerPoints
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
        const width = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        return { data: codes[0].rawValue, center: { x: cx, y: cy }, width, via: 'native' }
      }
    } catch {
      /* fall through */
    }
  }

  const fromJsQr = (loc: JsQrLocation): DecodedQR => ({
    data: '',
    center: { x: (loc.topLeftCorner.x + loc.bottomRightCorner.x) / 2, y: (loc.topLeftCorner.y + loc.bottomRightCorner.y) / 2 },
    width: Math.hypot(loc.topRightCorner.x - loc.topLeftCorner.x, loc.topRightCorner.y - loc.topLeftCorner.y),
    via: '',
  })

  // 2) jsQR on the full image
  const qrFull = jsQR(fullImageData.data, w, h, { inversionAttempts: 'attemptBoth' })
  if (qrFull) return { ...fromJsQr(qrFull.location), data: qrFull.data, via: 'jsqr-full' }

  // 3) jsQR on the bottom-center crop (60% width band, bottom 45% of height)
  const cx0 = Math.floor(w * 0.2)
  const cw = Math.max(10, Math.floor(w * 0.6))
  const cy0 = Math.floor(h * 0.55)
  const ch = Math.max(10, h - cy0)
  const crop = document.createElement('canvas')
  crop.width = cw
  crop.height = ch
  const cctx = crop.getContext('2d', { willReadFrequently: true })!
  cctx.drawImage(fullCanvas, cx0, cy0, cw, ch, 0, 0, cw, ch)
  const cropData = cctx.getImageData(0, 0, cw, ch)
  const qrCrop = jsQR(cropData.data, cw, ch, { inversionAttempts: 'attemptBoth' })
  if (qrCrop) {
    const base = fromJsQr(qrCrop.location)
    return { ...base, data: qrCrop.data, center: { x: base.center.x + cx0, y: base.center.y + cy0 }, via: 'jsqr-crop' }
  }
  return null
}

// ---------- main detection ----------
// expectedNorm: fill-box centers in normalized board coords (x/FRAME_W, y/frameH)
// finderNorm: the four finder centers in normalized coords [TL, TR, BL, BR]
export function detectMarks(
  bin: Uint8Array,
  w: number,
  h: number,
  finderPx: Pt[], // detected finder centers in px, order [TL, TR, BL, BR]
  finderNorm: Pt[],
  boxCentersNorm: Pt[],
  boxRadiusNorm: number // fraction of FRAME_W
): DetectResult {
  const scale = Math.hypot(finderPx[1].x - finderPx[0].x, finderPx[1].y - finderPx[0].y)
  const H = solveHomography(
    finderNorm.map((p) => ({ x: p.x, y: p.y })),
    finderPx
  )
  const marks = boxCentersNorm.map(() => false)
  const confidence = boxCentersNorm.map(() => 0)
  if (!H) return { marks, confidence, aligned: false, findersFound: 4 }

  const radius = Math.max(2, boxRadiusNorm * scale)

  // validate alignment: finder centers (normalized) should map onto themselves in black
  let alignedCount = 0
  for (let i = 0; i < 4; i++) {
    const p = applyH(H, finderNorm[i])
    if (darkRatio(bin, w, h, p, radius * 0.35) > 0.6) alignedCount++
  }
  const aligned = alignedCount >= 3

  boxCentersNorm.forEach((pNorm, i) => {
    const p = applyH(H, pNorm)
    const r = darkRatio(bin, w, h, p, radius)
    confidence[i] = r
    marks[i] = r > 0.3
  })
  return { marks, confidence, aligned, findersFound: 4 }
}

function darkRatio(bin: Uint8Array, w: number, h: number, p: Pt, radius: number): number {
  let dark = 0
  let total = 0
  const x0 = Math.max(0, Math.floor(p.x - radius))
  const x1 = Math.min(w - 1, Math.ceil(p.x + radius))
  const y0 = Math.max(0, Math.floor(p.y - radius))
  const y1 = Math.min(h - 1, Math.ceil(p.y + radius))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - p.x
      const dy = y - p.y
      if (dx * dx + dy * dy > radius * radius) continue
      total++
      if (bin[y * w + x]) dark++
    }
  }
  return total ? dark / total : 0
}

// ---------- assemble corner roles from candidates + QR position ----------
// QR sits at bottom-center under the frame: the two finder candidates closest
// to the QR are the bottom corners; within each pair, order by x.
export function assignCorners(candidates: Candidate[], qrCenter: Pt): Pt[] | null {
  if (candidates.length < 4) return null
  // pick the best 4: prefer large, spread candidates
  const sorted = [...candidates].sort((a, b) => b.size - a.size)
  const picked: Candidate[] = []
  for (const c of sorted) {
    if (picked.length >= 4) break
    if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > c.size * 1.5)) picked.push(c)
  }
  if (picked.length < 4) return null
  const byDist = [...picked].sort((a, b) => Math.hypot(a.x - qrCenter.x, a.y - qrCenter.y) - Math.hypot(b.x - qrCenter.x, b.y - qrCenter.y))
  const bottomPair = byDist.slice(0, 2)
  const topPair = byDist.slice(2, 4)
  const cx = picked.reduce((s, p) => s + p.x, 0) / 4
  const bl = bottomPair.find((p) => p.x < cx)!
  const br = bottomPair.find((p) => p.x >= cx)!
  const tl = topPair.find((p) => p.x < cx)!
  const tr = topPair.find((p) => p.x >= cx)!
  return [tl, tr, bl, br].map((p) => ({ x: p.x, y: p.y }))
}

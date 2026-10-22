// AertsO shared sheet geometry — SINGLE SOURCE OF TRUTH.
// The print components AND the scanner CV both derive positions from these
// constants, so a printed sheet and its detected coordinates can never drift.
//
// Board frame: 180 x 180 mm square. Normalized coords divide x by FRAME_W and
// y by FRAME_H (answer sheets can be taller), giving [0,1] x [0,1] space that
// the scanner maps to pixels via a homography built from the four finder
// pattern centers.

export const GRID = 6; // 6x6
export const COLS = ['A', 'E', 'R', 'T', 'S', 'O'] as const;

// ---- board (play sheet) geometry, mm -------------------------------------------------
export const FRAME_W = 180;
export const FRAME_H = 180;

export const FINDER_SIZE = 18; // outer square
export const FINDER_CENTER_INSET = 12; // center distance from frame corner
export const FINDER_MODULE = FINDER_SIZE / 7; // QR-style 1:1:3:1:1
// finder center coords (mm), TL TR BL BR
export const FINDER_CENTERS: [number, number][] = [
  [FINDER_CENTER_INSET, FINDER_CENTER_INSET],
  [FRAME_W - FINDER_CENTER_INSET, FINDER_CENTER_INSET],
  [FINDER_CENTER_INSET, FRAME_H - FINDER_CENTER_INSET],
  [FRAME_W - FINDER_CENTER_INSET, FRAME_H - FINDER_CENTER_INSET],
];

export const HEADER_Y = 24;
export const HEADER_H = 12;

export const GRID_X0 = 26;
export const GRID_Y0 = 38;
export const GRID_W = 128;
export const GRID_H = 126;
export const CELL_W = GRID_W / GRID; // 21.333
export const CELL_H = GRID_H / GRID; // 21

// fill box (the small corner box players ink in)
export const BOX_SIZE = 5.5;
export const BOX_INSET = 1.6; // from cell top-left

export const QR_SIZE = 28; // mm, printed under the frame
export const CODE_TEXT_H = 6; // "Board K7QM" text height

// ---- answer sheet geometry -----------------------------------------------------------
export const ANS_COLS = 6;
export const ANS_X0 = GRID_X0;
export const ANS_W = GRID_W;
export const ANS_COL_W = ANS_W / ANS_COLS;
export const ANS_Y0 = 38;
export const ANS_ROW_H = 19;
export const ANS_BOX_SIZE = 5;
export const ANS_BOX_INSET = 1.5;
export const ANS_BOTTOM_PAD = 12;
export const ANS_FRAME_H_MAX = 244; // keep printable on letter

export function answerSheetLayout(count: number) {
  const rows = Math.max(1, Math.ceil(count / ANS_COLS));
  let rowH = ANS_ROW_H;
  let frameH = ANS_Y0 + rows * rowH + ANS_BOTTOM_PAD;
  if (frameH > ANS_FRAME_H_MAX) {
    rowH = (ANS_FRAME_H_MAX - ANS_Y0 - ANS_BOTTOM_PAD) / rows;
    frameH = ANS_FRAME_H_MAX;
  }
  return { rows, rowH, frameH };
}

// ---- normalized helpers (used by the scanner) ---------------------------------------
// Board sheets: normalize by (FRAME_W, FRAME_H). Answer sheets: by (FRAME_W, frameH).
export function finderCentersNorm(frameH: number): { x: number; y: number }[] {
  return FINDER_CENTERS.map(([x, y]) => ({ x: x / FRAME_W, y: y / frameH }));
}

export function answerFinderCentersMM(frameH: number): [number, number][] {
  return [
    [FINDER_CENTER_INSET, FINDER_CENTER_INSET],
    [FRAME_W - FINDER_CENTER_INSET, FINDER_CENTER_INSET],
    [FINDER_CENTER_INSET, frameH - FINDER_CENTER_INSET],
    [FRAME_W - FINDER_CENTER_INSET, frameH - FINDER_CENTER_INSET],
  ];
}

export function cellRectMM(row: number, col: number) {
  return {
    x: GRID_X0 + col * CELL_W,
    y: GRID_Y0 + row * CELL_H,
    w: CELL_W,
    h: CELL_H,
  };
}

export function fillBoxCenterMM(row: number, col: number) {
  const c = cellRectMM(row, col);
  return [c.x + BOX_INSET + BOX_SIZE / 2, c.y + BOX_INSET + BOX_SIZE / 2] as [number, number];
}

export function answerBoxTopLeftMM(index: number, rowH: number): [number, number] {
  const col = index % ANS_COLS;
  const row = Math.floor(index / ANS_COLS);
  return [
    ANS_X0 + col * ANS_COL_W + ANS_BOX_INSET,
    ANS_Y0 + row * rowH + ANS_BOX_INSET + (rowH - ANS_BOX_SIZE) / 2,
  ];
}

export function answerBoxCenterMM(index: number, rowH: number): [number, number] {
  const [x, y] = answerBoxTopLeftMM(index, rowH);
  return [x + ANS_BOX_SIZE / 2, y + ANS_BOX_SIZE / 2];
}

// ---- board codes -----------------------------------------------------------------------
// The 8-character code is the board's single identity: printed on the sheet,
// embedded in the QR payload, typed as the manual fallback, and used in URLs.
// 32^8 ≈ 1.1 trillion combinations — codes double as unguessable credentials.
// QR payload shapes (the code is built INTO the QR):
//   play sheet : <origin>/?scan=<CODE>   (e.g. https://aertso.vercel.app/?scan=K7QMX2P9)
//   answer key : <origin>/?scan=ANSWERS
// A native phone-camera scan of the QR opens that URL directly and the site
// loads the board without any in-app re-scan.
export const ANSWER_TOKEN = 'ANSWERS';

export function normalizeCode(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
  return /^[A-Z2-9]{8}$/.test(v) ? v : null;
}

export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function parseScanValue(raw: string): { kind: 'board'; code: string } | { kind: 'answers' } | null {
  const v = raw.trim();
  if (v.toUpperCase() === ANSWER_TOKEN) return { kind: 'answers' };
  const code = normalizeCode(v);
  return code ? { kind: 'board', code } : null;
}

export function parseScanPayload(raw: string): { kind: 'board'; code: string } | { kind: 'answers' } | null {
  try {
    const url = new URL(raw);
    const v = url.searchParams.get('scan');
    if (!v) return null;
    return parseScanValue(v);
  } catch {
    return null;
  }
}

// ---- bingo evaluation -----------------------------------------------------------------
// 6x6 lines: 6 rows, 6 cols, 2 diagonals = 14.
export function lineIndices(): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < GRID; r++) lines.push(Array.from({ length: GRID }, (_, c) => r * GRID + c));
  for (let c = 0; c < GRID; c++) lines.push(Array.from({ length: GRID }, (_, r) => r * GRID + c));
  lines.push(Array.from({ length: GRID }, (_, i) => i * GRID + i));
  lines.push(Array.from({ length: GRID }, (_, i) => i * GRID + (GRID - 1 - i)));
  return lines;
}

export interface BingoResult {
  bingo: boolean;
  winningLines: number[][]; // fully marked AND fully called
  invalidLines: number[][]; // fully marked by player but contains uncalled items
}

export function evaluateBingo(layoutItemIds: string[], marks: string, calledSet: Set<string>): BingoResult {
  const winning: number[][] = [];
  const invalid: number[][] = [];
  for (const line of lineIndices()) {
    const allMarked = line.every((i) => marks[i] === '1');
    if (!allMarked) continue;
    const allCalled = line.every((i) => calledSet.has(layoutItemIds[i]));
    (allCalled ? winning : invalid).push(line);
  }
  return { bingo: winning.length > 0, winningLines: winning, invalidLines: invalid };
}

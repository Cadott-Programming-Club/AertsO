# AertsO

**6×6 paper bingo, verified by phone.** Players print a sheet, play with a pen,
and scan it to link the board to their email — the site checks claimed bingos
against the caller's scanned answer key. Built by the Cadott Programming Club.

The six columns spell the name: **A · E · R · T · S · O**.

## How a game runs

1. **Admin — set the pool.** Sign in with an admin email, open *Admin → Item
   pool*, and enter one item per line ("Has a dog", "Born in October", …).
   You need **at least 36** items (a 6×6 board draws 36 distinct items, no
   repeats on a sheet).
2. **Print boards.** *Print → Generate & print batch* prints unassigned boards
   (players claim them by scanning), or each player prints their own with
   *Print my board*. **Print at 100% / actual size** on letter paper.
3. **Print the answer key.** Same tab — this is the caller's sheet. Ink a box
   each time you draw an item.
4. **Play.** Players ink the small corner box of each space they get. No
   screens while playing.
5. **Players scan.** *Scan a sheet* → point the camera at the QR (or upload a
   photo / type the board code). The site reads the marks, the player confirms
   them with a tap, and the board links to their email.
6. **Admin scans the answer key.** After the game, scan the caller sheet the
   same way. Every scanned board is scored instantly: verified bingos,
   "no bingo", or **Review** (a fully-marked line that includes uncalled
   items — someone marked squares that weren't drawn).

If the camera or the automatic mark detection ever struggles, every step has a
manual fallback — nothing can block a game night.

## How scanning works (the fun part)

Each printed sheet carries four QR-style **finder patterns** at the corners of
the board and a **QR code** (plus a human-readable code like `K7QM`) at the
bottom. The scanner decodes the QR to identify the sheet, finds the finder
patterns, computes a homography from the shared geometry constants
(`src/lib/layout.ts` — the same module the print pages use), and samples the
ink ratio inside each fill box. Detected marks land in a confirm grid where
the player fixes any mistakes before submitting — CV does the busywork, the
human signs off.

## Setup

### 1. Database (Supabase Postgres)

Create a project at [supabase.com](https://supabase.com) (or reuse one), then
push the schema once from your machine:

```bash
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
  npx prisma db push
```

Tables are all prefixed `AertsO*`, so sharing an existing project is safe.

### 2. Deploy (Vercel)

Import this repo at [vercel.com/new](https://vercel.com/new) — zero build
config needed — and set the environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` (transaction pooler — best for serverless) |
| `ADMIN_EMAILS` | comma-separated admin emails, e.g. `you@school.org,teacher@school.org` |
| `SMTP_HOST` | your SMTP host, e.g. `mail.ddylongneck.com` |
| `SMTP_PORT` | `587` (or `465` for implicit TLS) |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials |
| `MAIL_FROM` | e.g. `AertsO <noreply@ddylongneck.com>` |

**Login is email-only**: players enter their email, get a 6-digit code, and
stay signed in for 30 days. With no SMTP configured the code is returned in
the API response and logged (dev mode) — set up SMTP before real games.

### 3. Local development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev
```

For a quick SQLite dev database, change `provider` in `prisma/schema.prisma`
to `"sqlite"` and set `DATABASE_URL=file:./dev.db` — the schema is
cross-provider by design.

## Project map

```
src/
  app/
    page.tsx              # the whole app: views switch on ?view / ?print / ?scan
    api/                  # auth (email OTP), items, boards, submit, admin
  lib/
    layout.ts             # sheet geometry — single source of truth (print + CV)
    cv.ts                 # binarize, finder detection, homography, mark sampling
    bingo.ts logic lives in layout.ts (line evaluation)
    auth.ts               # sessions, login codes, SMTP mailer
    boards.ts             # board generation, answer key, scoring
  components/
    sheet/                # printable BoardSheet / AnswerSheet (mm-accurate)
    scanner/Scanner.tsx   # camera + upload + CV + human-confirm grid
    views/                # login, admin panel, print overlay
```

## Tips for game night

- Print **at 100% scale** ("Actual size", not "Fit to page").
- Sheets are cheap — reprint if a photo looks crumpled; scanning works best
  with flat paper and even light.
- The answer key can be re-scanned or hand-edited any time; scoring updates
  instantly for every submitted board.
- A "Review" status on the boards table means a player marked a full line but
  at least one item was never drawn — check their sheet before calling bingo.

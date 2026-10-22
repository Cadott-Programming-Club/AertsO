# AertsO

**6×6 paper bingo, verified by phone.** The club prints the sheets, players play
with a pen, and one phone scan links a board to the player's email — the site
checks claimed bingos against the caller's scanned answer key. Built by the
Cadott Programming Club.

The six columns spell the name: **A · E · R · T · S · O**.

## How a game runs

1. **Admin — set the pool.** Sign in with an admin email, open *Admin → Item
   pool*, and enter one item per line ("Has a dog", "Born in October", …).
   You need **at least 36** items (a 6×6 board draws 36 distinct items, no
   repeats on a sheet).
2. **Admins print the boards.** *Admin → Print → Generate & print batch*.
   Only admins can print — the print view is gated server-side, and player
   pages print nothing but a "printing is for club admins" notice. Hand the
   paper out at the club.
3. **Admin prints the answer key.** Same tab — this is the caller's sheet.
   Ink a box each time you draw an item.
4. **Play.** Players ink the small corner box of each space they get. No
   screens while playing.
5. **Players scan.** The QR on each sheet contains that board's own code —
   scanning it with the phone's **built-in camera** opens the site with the
   board already loaded (the `?scan=` link). Or use *Scan a sheet* in-app:
   point the camera at the sheet, upload a photo, or type the code under the
   QR (`K7QM-X2P9`). The player confirms the marks with a tap, and the board
   links to their email.
6. **Admin scans the answer key.** After the game, scan the caller sheet the
   same way (its QR is `?scan=ANSWERS`). Every scanned board is scored
   instantly: verified bingos, "no bingo", or **Review** (a fully-marked line
   that includes uncalled items — someone marked squares that weren't drawn).

If the camera or the automatic mark detection ever struggles, every step has a
manual fallback — nothing can block a game night.

## Board codes

Each board has one 8-character code (like `K7QM-X2P9`) that is its whole
identity: printed under the QR, **embedded in the QR payload**
(`<site>/?scan=K7QMX2P9`), typed as the manual fallback, and used in URLs.
32⁸ ≈ 1.1 trillion combinations, so codes double as the sheet's unguessable
credential — a code only works if you have the paper.

## How scanning works (the fun part)

Each printed sheet carries four QR-style **finder patterns** at the corners of
the board and a **QR code** (plus the human-readable code) at the bottom. The
in-app scanner decodes the QR to identify the sheet, finds the finder
patterns, computes a homography from the shared geometry constants
(`src/lib/layout.ts` — the same module the print pages use), and samples the
ink ratio inside each fill box. Detected marks land in a confirm grid where
the player fixes any mistakes before submitting — CV does the busywork, the
human signs off.

## Setup

### 1. Deploy (Vercel)

Import this repo at [vercel.com/new](https://vercel.com/new) — zero build
config needed — and connect your Supabase project with the official
**Supabase integration** (Project → Storage → Add Database → Supabase, or from
[supabase.com](https://supabase.com) → Integrations → Vercel). The integration
injects `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`, which the Prisma
schema reads directly — **no `DATABASE_URL` needed.**

Then set the environment variables:

| Variable | Value |
|---|---|
| `ADMIN_EMAILS` | comma-separated admin emails, e.g. `you@school.org,teacher@school.org` — **only admins can print** |
| `SMTP_HOST` | your SMTP host, e.g. `mail.ddylongneck.com` |
| `SMTP_PORT` | `587` (or `465` for implicit TLS) |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials |
| `MAIL_FROM` | e.g. `AertsO <noreply@ddylongneck.com>` |

**Login is email-only**: players enter their email, get a 6-digit code, and
stay signed in for 30 days. With no SMTP configured the code is returned in
the API response and logged (dev mode) — set up SMTP before real games.

### 2. Database (automatic)

Nothing to run: on the first request after a deploy, the app creates the
`AertsO*` tables itself (idempotent `CREATE TABLE IF NOT EXISTS`, then RLS
enabled on every table — no policies → deny-by-default for anon keys; the
app's direct connection is unaffected). Login writes to the database, so the
bootstrap deliberately runs before the first sign-in. The admin panel's
**Initialize database** button does the same thing on demand as a fallback.

> ⚠️ **Do not run `prisma db push` against the shared Supabase project.**
> The schema only knows the AertsO tables, so db push wants to DROP every
> other app's tables to "fix the drift" — if you ever see a data-loss
> warning, stop; `--accept-data-loss` would delete live data from other sites
> sharing the project. Table creation belongs to the automatic bootstrap.

Tables are all prefixed `AertsO*`, so sharing an existing Supabase project is
safe.

### 3. Local development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev
```

For a quick SQLite dev database, change `provider` in `prisma/schema.prisma`
to `"sqlite"`, both `url`/`directUrl` to `env("DATABASE_URL")`, and set
`DATABASE_URL=file:./dev.db` — the schema is cross-provider by design. (Flip
the provider back to `"postgresql"` before committing/pushing.)

## Project map

```
src/
  app/
    page.tsx              # the whole app: views switch on ?view / ?print / ?scan
    api/                  # auth (email OTP), items, boards, submit, admin
    api/admin/print       # admin-only print data (players never print)
  lib/
    layout.ts             # sheet geometry + board codes — single source of truth (print + CV)
    cv.ts                 # binarize, finder detection, homography, mark sampling
    bingo.ts logic lives in layout.ts (line evaluation)
    auth.ts               # sessions, login codes, SMTP mailer
    boards.ts             # board generation, answer key, scoring
  components/
    sheet/                # printable BoardSheet / AnswerSheet (mm-accurate)
    scanner/Scanner.tsx   # camera + upload + CV + deep links + human-confirm grid
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

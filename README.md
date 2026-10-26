# AertsO

**6×6 paper bingo, verified by phone.** The club prints the sheets, players play
with a pen, and one phone scan links a board to the player's email — the site
checks claimed bingos against the admins' answer keys. Built by the
Cadott Programming Club.

The six columns spell the name: **A · E · R · T · S · O**.

## How a game runs

1. **Admin — set the pool.** Sign in with an admin email, open *Admin → Item
   pool*, and enter one item per line ("Has a dog", "Born in October", …).
   You need **at least 36** items (a 6×6 board draws 36 distinct items, no
   repeats on a sheet). The pool is **shared** — every admin sees and edits
   the same list, and every printed board comes from it.
2. **Admins print the boards.** *Admin → Print → Generate & print batch*.
   Only admins can print — the print view is gated server-side, and player
   pages print nothing but a "printing is for club admins" notice. Hand the
   paper out at the club.
3. **Each admin prints their own answer key.** Same tab — the caller sheet.
   Print one per admin and ink a box each time you draw an item.
4. **Play.** Players ink the small corner box of each space they get. No
   screens while playing.
5. **Players scan.** The QR on each sheet contains that board's own code —
   scanning it with the phone's **built-in camera** opens the site straight
   into the sheet scanner (the `?scan=` link). Point the camera at the sheet
   and the QR + inked marks are read off the paper; the player confirms them
   with a tap and the board links to their email. Uploading a photo works
   too. Marks save right away; **scores stay sealed** until the keys are in.
6. **Every admin scans their answer key (master key).** After the game, each
   admin scans their own caller sheet (its QR is `?scan=ANSWERS`). Every key
   saves under that admin's email — the *Answer keys* tab shows all of them
   side by side and flags **disputed items** (called by some admins but not
   others) so you can compare and reconcile. The moment the **last** admin
   saves their key, scores **release automatically**: boards are graded on
   the **consensus** (an item counts as called only if it's in every admin's
   key), and each scan shows a verified bingo, "no bingo", or **Review** (a
   fully-marked line that includes uncalled items — someone marked squares
   that weren't drawn, or the item is disputed).

If the automatic mark detection ever struggles, the confirm grid lets the
player fix marks with a tap — nothing can block a game night. Entry is
QR-only: camera or photo upload, no codes to type.

## Leaderboard & scores

Every scan earns points automatically, and the **Leaderboard** on the home
page ranks all players. Like the board results, it stays **sealed** while
admin keys are outstanding — no rows at all, so relative standings can't
leak — and goes live the moment scores release. Player identity is masked to
the email local-part (e.g. `brody`); signed-in players see a “you're #N”
badge and their own row highlighted.

Scoring (graded against the key **consensus**):

- **+1** per inked space whose item was actually called
- **+10** per verified bingo line
- Recomputed automatically whenever a board is scanned, an answer key is
  saved (the consensus shifts), or a new batch starts

**Admins can manually change any player's score** — *Admin → Scores*:

- Type a new **Total** (plus an optional **Note** like "offline round win")
  and Save. The edit is stored as a *manual adjustment* on top of the auto
  points, so later scans still add on instead of wiping it.
- Quick **+10** buttons for fast in-game awards; totals can go negative for
  penalties.
- **Recompute from scans** rescores everyone from the current submissions +
  consensus (manual adjustments are always preserved).
- The tab shows the full split per player: bingos, auto points, adjustment,
  rank, and who last touched the score — visible to admins even while
  scores are sealed.

Starting a new batch wipes the whole leaderboard (auto and manual) along
with the boards, scans, and keys — a fresh game starts at zero.

## Board codes

Each board has one 8-character code (like `K7QM-X2P9`) that is its whole
identity: printed under the QR, **embedded in the QR payload**
(`<site>/?scan=K7QMX2P9`), and used in URLs. Players never type it — the QR
is the only way in.
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

In **live camera mode** a QR decode alone is never accepted — the scan only
goes through once all four corner finders are visible (the whole sheet is
framed), because that's exactly when the marks can be read off the paper.
Until then the scanner keeps coaching ("pull back so the whole sheet fits"),
and only after ~7 seconds of trying does it fall back to the manual tap grid.
Photo uploads degrade to the tap grid whenever alignment fails, with a
one-tap "Scan again" retry.

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
    api/                  # auth (email OTP), items, boards, submit, leaderboard,
                          #   game, admin (boards, submissions, answer-key, scores, setup)
    api/admin/print       # admin-only print data (players never print)
  lib/
    layout.ts             # sheet geometry + board codes — single source of truth (print + CV)
    cv.ts                 # binarize, finder detection, homography, mark sampling
    bingo.ts logic lives in layout.ts (line evaluation)
    auth.ts               # sessions, login codes, SMTP mailer
    boards.ts             # board generation, multi-admin keys, consensus + release
    scores.ts             # leaderboard engine: auto points, manual adjustments
    game.ts               # game settings: rules, end date, force-release
    bootstrap.ts          # cold-start DDL + RLS for fresh Postgres deploys
  components/
    sheet/                # printable BoardSheet / AnswerSheet (mm-accurate)
    scanner/Scanner.tsx   # camera + upload + CV + deep links + human-confirm grid
    views/                # login, admin panel (+ Scores tab), leaderboard, print overlay
```

## Tips for game night

- Print **at 100% scale** ("Actual size", not "Fit to page").
- Sheets are cheap — reprint if a photo looks crumpled; scanning works best
  with flat paper and even light.
- Any admin can re-scan or hand-edit their own key any time; the consensus and
  every submitted board re-grade instantly. Saving a new key when one was
  missing re-triggers release automatically.
- A single-admin club works exactly the same: one admin, one key — scores
  release as soon as that key is saved.
- A "Review" status on the boards table means a player marked a full line but
  at least one item was never drawn — check their sheet before calling bingo.

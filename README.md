# BookOrbit → Obsidian

Pull your [BookOrbit](https://bookorbit.app) reading stats into Markdown notes your Obsidian vault can parse —
YAML frontmatter, Dataview inline fields (`key:: value`), readable tables, and a text-based contribution heatmap.

```
BookOrbit (self-hosted)                    Your Obsidian vault
┌──────────────────────┐    REST /api/v1   ┌─────────────────────────────────────┐
│ NestJS + PostgreSQL ─┼──────────────────▶│ BookOrbit/                         │
│ stats · sessions ·   │   (login → JWT)   │ ├─ BookOrbit Dashboard.md          │
│ widgets · highlights ┘                   │ ├─ Reading Heatmap.md              │
│                                          │ ├─ Reading Log.md                  │
│   npm run sync (cron / on demand) ───────┼─ Library Stats.md                  │
│                                          │ ├─ Highlights.md (index)           │
│                                          │ └─ Highlights/  (one note per book)│
└──────────────────────┘        ✍ writes    └─────────────────────────────────────┘
```

Obsidian picks up file changes live, so after a sync the notes appear in seconds — no plugin required to
*write* them. Install the free [Dataview](https://obsidian.md/plugins?id=dataview) plugin to query the numbers.

---

## Why these notes exist

BookOrbit already has a beautiful dashboard. These notes exist to put the numbers **inside your notes**:
- Queryable: every headline figure is a Dataview inline field.
- Searchable: heatmap grids, tables, and highlights become part of your vault graph.
- Archivable: daily reading minutes, finishes, and highlights accumulate even if you switch platforms.

## How the data gets out of BookOrbit — the three paths we explored

| Path | What it gives you | Verdict |
| --- | --- | --- |
| **REST API (`/api/v1`)** | Every dashboard widget, all reading/library statistics, session timelines, built-in Markdown highlight export | ✅ **Used here.** Clean, versioned, no DB access needed. |
| **Direct PostgreSQL** | Raw `reading_sessions`, `books`, `user_book_status` tables — a full per-session archive the API only exposes aggregated | Power option. Useful later if you want exhaustive session history or custom SQL in a Dataview note. |
| **Built-in exports** | BookOrbit's own highlight export (Markdown/CSV/JSON) from the web UI | Useful as a manual fallback. We don't need it — the annotation **hub API** returns the same highlights structured, so each book becomes its own note. |

The script talks to the same API the web UI uses, so it works identically whether you self-host or use a
managed instance — no database credentials required.

### Endpoints used (all `GET` under `/api/v1`, JWT auth)

| Note | Endpoints |
| --- | --- |
| Dashboard | `user-statistics/summary`, `dashboard/widgets/{reading-goal,reading-streak,currently-reading,monthly-challenge,year-projection,highlight-of-the-day}` |
| Heatmap | `user-statistics/reading-heatmap?days=N` |
| Reading Log | `dashboard/widgets/currently-reading`, `dashboard/scrollers/want-to-read`, `user-statistics/session-timeline?year&week` (last 4 weeks), `user-statistics/completion-timeline` |
| Library Stats | `statistics/summary`, `statistics/format-distribution`, `statistics/genre-distribution`, `statistics/top-authors`, `statistics/books-added-over-time`, `dashboard/widgets/library-overview` |
| Highlights | `annotations` (paginated hub — every annotation with its book title/author), `dashboard/widgets/highlight-of-the-day` |

Auth: `POST /auth/login` with `{ username, password, clientKind: 'native', deviceLabel }` returns **full
credentials** (access + refresh token) in the body. The **refresh token is persisted** (`.bookorbit-session.json`,
mode 0600) and reused on later runs: each run either reuses a still-valid access token or exchanges the refresh
token for fresh ones (which also *rotates* it and slides the session's 7-day lifetime). Your BookOrbit
**Sessions** list keeps exactly one entry ("bookorbit-to-obsidian sync") instead of one login per run. If the
refresh token is ever rejected (session revoked or >7 days offline), the client falls back to a fresh login
automatically.

---

## Setup

Requirements: **Node.js ≥ 18** (built-in `fetch`, no runtime dependencies).

```bash
git clone <this-repo> && cd bookorbit-to-obsidian   # or copy the folder into your infra
npm install
cp .env.example .env
```

Edit `.env`:

```ini
BOOKORBIT_URL=http://192.168.1.10:3000     # your BookOrbit server
BOOKORBIT_USERNAME=your-username
BOOKORBIT_PASSWORD=your-password

OBSIDIAN_VAULT_PATH=/absolute/path/to/your/obsidian/vault
OBSIDIAN_OUTPUT_DIR=BookOrbit              # subfolder created in the vault
HEATMAP_DAYS=365                           # trailing window for the heatmap
SHOW_WANT_TO_READ=true

# Login session (refresh-token reuse). Sensitive — keep out of git (already
# gitignored) and leave the file at 0600. Delete it to force a fresh login.
BOOKORBIT_SESSION_FILE=.bookorbit-session.json
BOOKORBIT_DEVICE_LABEL=bookorbit-to-obsidian sync   # shown in BookOrbit > Sessions
```

Run once:

```bash
npm run sync
```

### Preview without a server

```bash
npm run sample        # writes the 5 notes + one Highlights note per book with synthetic data
```

## Scheduling

### 1. Build a single file (no npm needed at runtime)

The sync bundles down to one dependency-free JS file, so cron just needs `node`:

```bash
npm install && npm run build      # produces dist/sync.mjs (~40 KB)
```

### 2. Add the cron wrapper

```bash
crontab -e
```

```cron
0 * * * * /DATA/projects/bookorbit-to-obsidian/bin/bookorbit-sync.sh
```

The wrapper (`bin/bookorbit-sync.sh`) does the rest:

- sources `.env` from the project root (real environment variables win),
- runs `dist/sync.mjs` with `--quiet`,
- **never overlaps** — if a previous sync is still running it exits quietly,
- appends a timestamped trace to `logs/bookorbit-sync.log`,
- exits nonzero on failure so cron can email you or trigger an alert.

Log tail, and a quick manual run:

```bash
tail -f /DATA/projects/bookorbit-to-obsidian/logs/bookorbit-sync.log
/DATA/projects/bookorbit-to-obsidian/bin/bookorbit-sync.sh
```

Tuning via environment: `BOOKORBIT_SYNC_LOG` (log path) and `BOOKORBIT_SYNC_FLAGS`
(e.g. `"--only=overview,heatmap"`). If `node` isn't on the wrapper's PATH it checks
`~/.local/node/bin`, `/usr/local/bin`, `/usr/bin` and `/opt/homebrew/bin`, or use
`NODE_BIN=/path/to/node`.

> **Where to run it:** the script reads your BookOrbit over HTTP and writes into the vault folder, so run it
> on the machine that has the vault (your desktop/laptop, or a box that mounts it). It does not need to run
> on the BookOrbit server.

### On macOS / Windows

- **macOS:** `launchd` — or install `flock` (coreutils) and it works as-is; without `flock` the wrapper
  falls back to an atomic `mkdir` lock.
- **Windows:** Task Scheduler running `node dist\sync.mjs --quiet` (set env vars, or pass
  `--url/--username/--password/--vault` flags).

### Useful flags

```bash
npm run sync -- --only=overview,heatmap   # render a subset of notes
npm run sync -- --days=90                 # shorter heatmap window
npm run sync -- --no-highlights           # skip the highlights notes
npm run sync -- --no-want-to-read         # skip the Want to Read shelf
npm run sync -- --quiet                   # suppress progress (cron)
npm run sync -- --vault=/tmp/my-vault --out=BookOrbit
```

## Using the notes in Obsidian

Everything data-y is either frontmatter or an inline field, so Dataview can aggregate across notes:

```dataview
TABLE heatmap-total-time, heatmap-active-days, heatmap-best-day
FROM "BookOrbit/Reading Heatmap"
```

```dataview
TABLE total-books, total-authors, books-added-this-year
FROM "BookOrbit/Library Stats"
```

Inline fields are also plain text you can reference in Templater:

```
Reading time YTD: {{=`$="Reading Heatmap".heatmap-total-time`}}
```

### Referencing books by plain title

Per-book highlight notes are named `Highlights/<slug>-<bookId>.md`, but each declares its real title as an
Obsidian **alias**, so the id never leaks into your writing:

```
[[The Left Hand of Darkness]]   → resolves to the highlights note
```

Aliases are first-class properties you can query with Dataview too:

```dataview
TABLE highlight-count, note-count
FROM "BookOrbit/Highlights"
WHERE file.aliases = "The Left Hand of Darkness"
```

And of course everything is searchable, linkable, and part of your graph — that's the point.

## Files

```
src/
├── index.ts         # CLI entry: auth → fetch → render → write (atomic)
├── config.ts        # .env + flag parsing (incl. --quiet)
├── api.ts           # BookOrbit REST client (typed endpoints, refresh-token reuse)
├── types.ts         # API response types (mirrors @bookorbit/types)
├── session-store.ts # persisted login session (0600 token file)
├── markdown.ts      # frontmatter / inline fields / tables / heatmap glyph helper
├── writer.ts        # atomic vault writes (no half-written notes)
├── render/          # one module per note
│   ├── overview.ts  # Dashboard
│   ├── heatmap.ts   # Heatmap + contribution grid + daily/monthly tables
│   ├── books.ts     # Reading Log (current, want-to-read, sessions, finishes)
│   ├── library.ts   # Library Stats
│   └── highlights.ts# Highlights index + one note per book (+ stale-note pruning)
└── sample.ts        # demo notes with synthetic data
bin/
└── bookorbit-sync.sh  # cron wrapper: .env, lock, logging, exit codes
dist/
└── sync.mjs           # bundled single-file build (npm run build)
```

## Troubleshooting

- **`Login failed (401)`** — wrong URL (`http://host:3000`, no trailing path) or credentials. If BookOrbit
  sits behind a reverse proxy, use the public URL.
- **`GET ... failed (404)`** — you're on an older BookOrbit release than this script targets; the widget
  endpoints are recent. Update BookOrbit (v3+).
- **Highlights index is empty / missing book notes** — no active annotations exist yet; highlight a book in
  BookOrbit and re-sync. Deleted highlights are pruned automatically on the next sync.
- **Per-book notes exist but a book's highlights changed** — the notes are fully regenerated every sync, so
  they always match BookOrbit's current state.
- **No sessions in Reading Log** — the session-timeline endpoint serves the last 4 ISO weeks; if you track
  on devices that only sync periodically (Kobo/KOReader), give it a day.
- **Wrong account after a password change** — the stored refresh token is bound to the old password's
  session. Delete `.bookorbit-session.json` (or revoke the session in BookOrbit → Settings → Sessions, where
  it shows as "bookorbit-to-obsidian sync") and the next run logs in fresh.
- **`Refresh failed (401)` then `Login failed (401)`** — credentials are wrong. If the refresh token was
  revoked in BookOrbit's Sessions list, this is expected once; the next run re-creates a session.
- **Cron `✔` but nothing changed** — check `logs/bookorbit-sync.log`; a `SKIPPED` line means an earlier run
  was still going (fine), a `FAILED (exit N)` line means the last run errored.

## Ideas for next steps

- A DataviewJS dashboard note that draws the heatmap from `sample-out` JSON instead of a table.
- Querying Postgres directly for a complete session archive (the API's `session-timeline` is weekly).
- Per-book notes also imported into Obsidian's **Properties** (add ratings/genres from the library API).
- Pushing these notes with git so the vault has a history of your reading.
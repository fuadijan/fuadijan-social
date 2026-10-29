# Fuadijan Social Agent — PLAN (v1, 2026-10-30)

This is step 1 of the Process in `PROMPT.md`: the plan to approve before any code is written.
It covers the schema, the job stages, the cron table, the Telegram message formats, the template
field spec, the `brand.json` shape, the env vars and the two-cut delivery. Decisions that are mine
(not in the brief) are marked **Decision**; things only the owner can settle are under
"Questions for the owner" at the end.

Day 1 is **Tue 3 Nov 2026**. Cut 1 must run by **Mon 2 Nov**, Cut 2 by **Thu 5 Nov**.

---

## 0. What I checked before planning (facts the plan relies on)

| Checked | Result |
|---|---|
| Workbook `calendar/Fuadijan-Posts-Calendar.xlsx`, sheet `Calendar` | 30 rows + header, exactly the 18 columns in the brief, dates 2026-11-03 → 2026-12-02 as midnight datetimes, `post_time` blank, `status` `planned` throughout, 23 reels / 4 feed / 3 carousels. Row 2's `confirmation_notes` is the first paragraph of its `creative_instructions` (a prefix, not byte-identical); rows 3, 7, 8, 9, 15, 17, 18 and 30 are byte-identical. Rule on import: identical to, or a prefix of, `creative_instructions` → empty. Four `story_ideas` cells (days 7, 14, 21, 30) carry a trailing `---\n\n# Days …` block pasted from the narrative — strip it on import. Bracket placeholders sit exactly where the brief says (days 3, 4, 5, 16, 17, 20, 22, 23, 24, 25, 28, 29; heaviest 23, 29, 3, 24). |
| `Read Me` sheet | Confirms: key on row order, dates may move, blank dish intentional, status workflow `planned → photo-needed → ready → posted`. |
| Hub (`fuadijan-hub/lib/auth.ts`, `lib/session.ts`) | Already at **48 h** (`maxAge` and `MAX_SESSION_SECONDS`), so nothing to raise there. `APP_KEYS` has no `social` yet; `app/page.tsx` has the tile list. Both need a one-line addition (hub repo, owner's push). |
| Payroll `server/middleware/hubSession.js` | jose v5 + `@panva/hkdf`, HKDF info `"NextAuth.js Generated Encryption Key"`, cookie `__Secure-next-auth.session-token`, already 48 h. Its test encodes with the real `next-auth/jwt` as a devDependency — I'll port that test too. |
| POS conventions (`fuadijan-pos`) | Fastify 5, `pg` pool with TLS rules for hosted DBs, SQL migrations in name order under an advisory lock, `schema_migrations` table, `smtp2go.ts` (AU endpoint, plain fetch, outcome type), `SECURITY_HEADERS` + `onSend` hook, static apps served by hand (path-traversal safe), Vitest with `TEST_DATABASE_URL` ending in `_test`. I'll mirror all of these. |
| Brand frame kit (`fuadijan-brand`) | `sync.py` has `vite_app()` for Payroll; a `social` entry = `vite_app("fuadijan-social/web")` (one line in that repo). Components: `AppFrame`, `PageHeader`, `Card`, `Button`, `Tabs`, `ThemeToggle`; phone bar comes free from `nav`. |
| Menu Screens `GET /api/menu` (square-integration) | Public, CORS `*`, 5-min cache. Shape: `{ menu: [{ name, items: [...] }], tvScreens, bestSellers }`; each item `{ id, name, description, category, price, outOfStock, availabilityNote, variations[], allVariations[{name, price, inStock}] }`. That's the `menu-screens` MenuSource. Live URL assumed `https://fjtv.nutrimeals.au/api/menu` (the hub tile points at `fjtv.nutrimeals.au/admin`). |
| Local machine | Node 24.16 (brief says Node 22: the code targets 22, runs on 24; Railway gets `engines: >=22`). PostgreSQL 16 is installed but the Windows service is **stopped** — it has to be started for local runs and tests. Python 3.14 is there for `sync.py`. |
| Reference samples | 1, 3, 4, 5, 6 = cutout layout A on Night; 2 = full-bleed layout B. Footers: 1/2 brand line with ✻ rule, 3–6 address + `OPEN 5PM – 10PM`. Address on samples reads "Paramatta" (one r). |

---

## 1. Repo layout and stack

As in the brief's "Repo layout", with these specifics:

- One npm package (no workspaces): `package.json` at the root, `web/` is a Vite project with its own `package.json` only if Vite insists; I'll keep it in the root package (Vite root = `web/`) so there's one `npm install`, one `npm run check`.
- TypeScript ESM, `tsx` to run (`tsx src/main.ts`), no build step for the server; `vite build` for `web/` → `web/dist/`.
- Scripts: `dev`, `start`, `check` (= `tsc --noEmit && vitest run`), `test`, `typecheck`, `seed-calendar`, `dry-run`, `render-samples` (Cut 2), `build:web`, `migrate`.
- `railway.json`: NIXPACKS, build `npm ci && npm run build:web`, start `npx tsx src/main.ts`.
- Dependencies (Cut 1): `fastify`, `pg`, `grammy`, `node-cron`, `@anthropic-ai/sdk`, `zod`, `sharp`, `exceljs`, `jose@5`, `@panva/hkdf`, `heic-convert`; web: `react@19`, `react-dom`, `react-router`. Dev: `typescript`, `tsx`, `vitest`, `vite`, `@vitejs/plugin-react`, `next-auth@4` (test-only, to mint hub cookies), `@types/*`. Cut 2 adds `satori`, `@resvg/resvg-js`, `@imgly/background-removal-node` (or the alternative, see §11).

**Decision — where files live.** Railway's filesystem is wiped on every deploy, so photos, crops and packs can't live only on disk. Everything binary goes into Postgres as `bytea` in a `files` table (a 30-day calendar is a few hundred MB at most; a Telegram `file_id` lets us re-fetch any original anyway). `DATA_DIR` (default `./data`) is a disk cache plus the place `packs/<date> <slug>/` is written for the dry run and for local use. No Railway volume needed.

---

## 2. Postgres schema (`src/db/migrations/0001_init.sql`)

```sql
-- the 30 days, seeded from the workbook; day_no is the key
calendar_rows (
  id                serial primary key,
  day_no            int not null unique,                     -- 1..30, row order in the sheet
  date              date not null,                           -- Sydney calendar date
  slot              text not null check (slot in ('feed','carousel','reel')),
  type              text not null,
  dish              text,                                    -- null = flexible row; never filled by the agent
  theme             text, caption_hint text,
  post_time         time,                                    -- null = default by slot (see settings)
  template          text not null,                           -- the sheet's own value; registry maps it
  status            text not null default 'planned'
                    check (status in ('planned','photo-needed','ready','posted')),
  asset             text, objective text, creative_instructions text, on_screen_text text,
  caption           text, cta text, hashtags text, story_ideas text, confirmation_notes text,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
)

-- every change to a row after the seed; the seed consults it so it never overwrites an owner edit
calendar_edits (
  id serial primary key, row_id int references calendar_rows, field text not null,
  old_value text, new_value text,
  source text not null check (source in ('owner-telegram','owner-web','agent','seed')),
  created_at timestamptz not null default now()
)

-- binary content (originals, crops, cutouts, renders), so nothing depends on Railway's disk
files (
  id text primary key,            -- sha256 of the bytes
  mime text not null, bytes bytea not null, size int not null, created_at timestamptz default now()
)

assets (
  id serial primary key,
  telegram_file_id text, telegram_message_id bigint,
  kind text not null check (kind in ('photo','document','video','text')),
  filename text, mime text,
  caption_raw text, parsed_subject text, parsed_tags text[] not null default '{}', parsed_note text,
  calendar_row_id int references calendar_rows,
  set_key text,                                -- same day + within 10 min → same set
  original_file_id text references files,      -- null for video/text
  width int, height int,
  quality jsonb,                               -- { longEdge, luminance, laplacian, verdict: 'ok'|'small'|'dark'|'blurry', accepted: bool }
  prepped jsonb,                               -- { crop4x5, crop9x16, square, cutout?, shadow? } → files.id
  created_at timestamptz not null default now()
)

renders (
  id serial primary key, asset_id int references assets, calendar_row_id int references calendar_rows,
  template text not null, format text not null check (format in ('feed','story','carousel','reel-cover')),
  page int,                                    -- carousel page, else null
  file_id text not null references files, created_at timestamptz default now()
)

packs (
  id serial primary key, calendar_row_id int not null references calendar_rows,
  caption text not null, cta text, hashtags text[] not null, alt_text text, story_text text,
  facebook_caption text, reel_hook text, reel_on_screen_text text[], reel_shot_list text[],
  canva_brief text not null, caption_txt text not null,     -- the exact caption.txt body
  folder text not null,                                     -- "2026-11-04 chapli-kebab"
  sources jsonb not null,                                   -- asset ids, render ids, crop file ids
  created_at timestamptz not null default now()
)

questions (
  id serial primary key, row_id int references calendar_rows, job_id int,
  field text,                                  -- 'dish' | 'match' | 'caption' | 'on_screen_text' | 'quality' | ...
  question text not null, options jsonb not null,           -- [{ key, label, value }]
  answer text, answered_via text, asked_at timestamptz default now(), answered_at timestamptz,
  telegram_message_id bigint
)

jobs (
  id serial primary key, asset_id int references assets, calendar_row_id int references calendar_rows,
  stage text not null check (stage in ('intake','match','prep','resolve','render','pack','notify','done')),
  status text not null default 'queued' check (status in ('queued','running','waiting','done','failed')),
  state jsonb not null default '{}',           -- stage outputs (match result, resolved copy, …)
  waiting_on_question_id int references questions,
  attempts int not null default 0, last_error text, run_after timestamptz default now(),
  created_at timestamptz default now(), updated_at timestamptz default now()
)

claude_calls (
  id serial primary key, purpose text not null, model text not null,
  input_tokens int, output_tokens int, cache_read_tokens int, cost_usd numeric(10,6),
  latency_ms int, ok boolean not null, error text, job_id int, created_at timestamptz default now()
)

messages_log (
  id serial primary key, direction text check (direction in ('in','out')), channel text,
  chat_id text, telegram_message_id bigint, kind text, text text, ok boolean, error text,
  created_at timestamptz default now()
)

settings (key text primary key, value text not null, updated_at timestamptz default now())
-- seeded: store_address, open_hours, website_url, post_time_default='18:00', story_time_default='12:00',
--         paused='false', instagram_handle='@fuadijan'
```

`schema_migrations` as in the POS. Indexes on `jobs(status, run_after)`, `assets(calendar_row_id)`, `questions(answered_at) where answered_at is null`.

---

## 3. Calendar seed (`npm run seed-calendar`)

1. Open the workbook with `exceljs`, sheet `Calendar`; assert the header is exactly the 18 names in order (fail loudly otherwise). Read `Read Me` and print it.
2. For each data row i (1..30): `day_no = i`; `date` = the date part of the cell (`YYYY-MM-DD`, no TZ conversion); trim strings; `post_time` `HH:MM` or null; `status` default `planned`.
3. Clean-ups (all deterministic, all logged):
   - strip a trailing `📍 …` line from `caption` (the pack re-adds `STORE_ADDRESS`);
   - `confirmation_notes` identical to, or a prefix of, `creative_instructions` → null (row 2 is the prefix case);
   - strip a trailing `\n\n---\n\n# Days …` block from `story_ideas`;
   - keep every `[bracket]` as-is.
4. Upsert by `day_no`. For an existing row, compare field by field; skip any field that has a `calendar_edits` entry with `source <> 'seed'`; record changed fields as `source='seed'` edits.
5. Print a table: day, date, slot, template, dish, then the list of `[bracketed]` placeholders per day (expect days 3, 4, 5, 16, 17, 20, 22, 23, 24, 25, 28, 29).
6. Boot check: every distinct `template` in the table must be in the render registry (§7).

Date assignment: `CALENDAR_START` only matters if it differs from the sheet's first date; then every row shifts by the same offset (dates are stored, so `/push` and `skip` just change `date`).

---

## 4. Pipeline — `jobs` worker

One worker loop, tick every 5 s, picks the oldest `queued` job with `run_after <= now()` using `FOR UPDATE SKIP LOCKED`, runs exactly one stage, writes the next stage back, releases. A stage that throws: `attempts+1`, `run_after = now() + 30s × attempts`, `failed` after 3 with a Telegram "I couldn't process photo X: <reason>". `waiting` jobs wake when their question is answered (the answer handler sets `status='queued'`).

| stage | does | writes to `state` | Cut |
|---|---|---|---|
| **intake** | `getFile` download (or dry-run file), HEIC → JPEG via `heic-convert`, EXIF auto-orient, store original in `files`, quality stats (long edge, mean luminance, Laplacian variance). Video: no download, log, go straight to `pack` with "clip received". Under 1600 px → ask "send as File / ok" (a `questions` row, `field='quality'`), park. Dark/blurry → tell him, park with the same two options ("I'll resend" ends the job). | `quality` | 1 |
| **match** | Caption parse (`subject -- note #tags`). `#dayN` → that row, no Claude. Else Claude `match-photo-to-row` with a 512 px thumbnail + candidate rows (date within −2…+10 days of today) + menu names. Confidence < 0.7 or `#unscheduled` → question with top-3 rows + "unscheduled", park. Sets `assets.calendar_row_id`, `set_key`. Sends `shoot_tip` if clutter is medium/high. | `match: { rowId, confidence, composition, clutter, dishCanonical }` | 1 |
| **prep** | sharp: `normalise()` (gentle), light `sharpen()`, attention crops 4:5 (2160×2700), 9:16 (2160×3840), 1:1 (2160²), strip EXIF, JPEG q90 → `files`. Cut 2 adds the cutout (+shadow PNG) for `single-plate` when the mask covers 25–90 %. | `prepped` | 1 (cutout 2) |
| **resolve** | Claude `resolve-copy`: row copy + menu facts + the owner's answers so far → `{ label, headline, line, caption, cta, hashtags[], alt_text, story_text, facebook_caption, on_screen_text[], unresolved[] }`. Any `unresolved` → one Telegram message listing them with suggested answers as buttons, park. Re-run after answers; loop until `unresolved` is empty. Rules in the system prompt: keep caption/CTA as written, resolve brackets from menu only, never invent prices/reviews/names/claims, 3–5 hashtags, Australian spelling. | `copy` | 1 |
| **render** | Template from the registry, satori → SVG → resvg → PNG, sharp composites photo/cutout. Skipped for reels except the reel cover; skipped entirely in Cut 1 (stage is a pass-through). | `renders[]` | 2 |
| **pack** | Writes the `packs` row and `packs/<date> <slug>/` (`caption.txt`, `canva-brief.txt`, `reel-pack.txt` for reels, `crop-4x5.jpg`, `crop-9x16.jpg`, renders when present). `status = ready` only if `unresolved` is empty, else `photo-needed` with the questions listed. | `packId` | 1 |
| **notify** | Telegram: images as documents, then the caption block, then hashtags alone, then "Reply `posted N` when it's up" with the deep link. Cut 1 attaches the plain crops as documents. | — | 1 |

Photo sets: an asset whose row already has an asset within 10 min joins its `set_key`; the set's job runs `match` once (the first), and `pack` waits until no new photo has arrived for 10 min. Carousel rows: one render per set member; otherwise the best (sharpest, brightest) is the hero, the rest get 9:16 crops as story images.

---

## 5. Claude (`src/brain/`)

- `@anthropic-ai/sdk`, `client.messages.parse()` with `output_config: { format: zodOutputFormat(Schema) }`, no `tool_choice`, no `thinking` param, `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`. Model `CLAUDE_MODEL` (default `claude-opus-5-5`).
- Four purposes, each a Zod schema and a fixture under `test/fixtures/claude/<purpose>-<case>.json`: `match-photo-to-row`, `resolve-copy`, `write-pack` (alt text / Facebook / story text when resolve didn't produce them — folded into resolve in practice), `weekly-review` (Cut 2).
- Every call → `claude_calls` row (tokens, cost from a price table in `config.ts`, latency, ok). Images: 512 px thumbnail for match, never above 1024 px.
- `ClaudeClient` interface with a `FixtureClaude` for tests and the dry run (matches by purpose + day).

---

## 6. Telegram (`src/messaging/telegram.ts`, grammy, long polling)

Only `TELEGRAM_CHAT_ID` is obeyed. Any other chat gets one "This bot is private." and a `messages_log` row (with the chat id, so the owner can read his own id from the log on first contact). Every outgoing message ends with the deep link `https://social.nutrimeals.au/day/N` where a day is involved (`WEB_URL` in `.env`).

**Inline buttons** carry `q:<questionId>:<optionKey>`; a free-text reply is routed to the newest open question.

Message formats (plain text, Telegram HTML only for bold):

```
MORNING BRIEF (08:30)
☀️ Good morning. Next 7 days:

Tue 3 Nov — Reel · Introducing Fuadijan (brand-intro) · planned
  No clips yet. Shoot: charcoal catching; flame and smoke; Chapli on the grill; … 12–18 s vertical.
Wed 4 Nov — Feed · Chapli Kebab (From the Fire) · photo-needed
  Needs: hero photo. Top-down or 45°, plain dark bench, wipe the rim, send as a File.
Thu 5 Nov — Carousel · Chapli Kebab (education) · planned
  Needs: 2–3 close-ups + 4 confirmations (bold spices / fresh herbs / hand-formed / grilled over fire).
…
Open questions: 2 — /ask
Week view: https://social.nutrimeals.au/
```

```
SHOOT REMINDER (09:00, only when something is missing)
📸 Thu 6 Nov is a Reel — Chicken Karahi (From the Karahi). Nothing received yet.
Shot list: ingredients ready → karahi warming → adding in sequence → bubbling close-up → garnish → finished dish → naan beside it. 15–25 s vertical.
Send clips with the caption "karahi clip 1", "karahi clip 2"…
https://social.nutrimeals.au/day/4
```

```
PHOTO RECEIVED (after intake)
Got it — chapli kebab → Day 2 (Wed 4 Nov, Feed). Working on it.
   [for low confidence instead:]
Which day is this for?
[Day 2 · Chapli Kebab] [Day 8 · Chapli reel] [Day 27 · Chapli hero] [Unscheduled]

QUALITY
Got it. For a sharper post, send it as a File (📎 → File) — or reply ok to use this one.
[Use this one] [I'll resend as a File]

SHOOT TIP (clutter medium/high)
Tip: boxes and the fire extinguisher are in the background — shoot tighter or from above on the dark bench.
```

```
QUESTIONS (resolve stage, one message per job)
Day 4 — Chicken Karahi needs 2 confirmations before it's ready:
1. "COOKED TO ORDER" on screen — is that true?            [Yes] [Leave it out]
2. Sides to mention: naan, roti, rice — which are on the menu?   [Naan + roti] [Naan + rice] [All three] [Type…]
```

```
PACK (notify)
<document: feed.png or crop-4x5.jpg> <document: story.png or crop-9x16.jpg>

📦 Day 2 — Chapli Kebab · Wed 4 Nov · Feed · post at 18:00
=== CAPTION ===
…caption, CTA, 📍 address…
=== ALT TEXT === …
=== STORY === …
=== FACEBOOK === …

<separate message, hashtags only>
#Fuadijan #ChapliKebab #PakistaniCuisine #AuburnEats #FromTheFire

Reply "posted 2" when it's up. Canva brief: /brief 2 · https://social.nutrimeals.au/day/2
```

```
REEL PACK (notify, reel rows; Cut 1's most important output)
🎬 Day 1 — Introducing Fuadijan · Tue 3 Nov · Reel · post at 18:00
Hook (first second): THIS IS FUADIJAN
On-screen text, in order:
  1. THIS IS FUADIJAN
  2. FROM THE FIRE
  3. FROM THE KARAHI
  4. SMOKED. GRILLED. ROOTED IN TRADITION.
Shot list: 1) Charcoal catching 2) flame and smoke 3) Chapli Kebab on the grill … 8) exterior/sign or team serving.
Length: 12–18 s. Music: use Instagram's licensed audio.
Clips received: 3 (not downloaded — Instagram takes them straight from your phone).
<caption block> <hashtags message> Reply "posted 1" when it's up.
```

```
POST-TIME (at post_time, default 18:00; stories 12:00 when story_ideas exists)
⏰ Time to post Day 2 — Chapli Kebab. <resend pack>      — or —
⏰ Day 2 — Chapli Kebab is due at 18:00 but isn't ready: still needs a hero photo and 1 confirmation (/ask).

EVENING NUDGE (21:30, only if today's row isn't posted)
🌙 Day 2 — Chapli Kebab isn't marked posted. Reply "posted 2" if it went up, "skip 2" to move it.

SKIP
Move Day 2 to the next free date — push everything after it by a day, or just this one?
[Push everything] [Just this one] [Cancel]

POSTED
✅ Day 2 marked posted at 18:42. Tomorrow: Day 3 — Carousel · Chapli Kebab.
```

Commands: `/today` `/week` `/status` `/pack N` `/ask` `/redo N <note>` `/edit N <field> <text>` `/push N <days>` `/brief N` `/set address|hours|website <text>` `/pause` `/resume`, plus `posted [N]`, `skip N`, `ok`, `review -- <initials>` followed by the quote. `/status` prints: rows by status, jobs by status, open questions, Claude calls and spend this month, last error, uptime, menu source freshness.

Email fallback (Cut 2): `Messenger` interface `{ sendText, sendDocument, ask }`; `EmailMessenger` via smtp2go (POS's `smtp2go.ts` copied), used when Telegram fails 3 times or `MESSENGER=email`.

---

## 7. Render templates (Cut 2) — field spec and registry

Registry (boot fails if a sheet `template` value is missing):

| key | sheet `template` values | Zod fields | footer |
|---|---|---|---|
| `hero-photo` | from-the-fire, from-the-karahi, chapli-from-the-fire, customer-favourite, snack-pack, modern-fuadijan, family-feast, family-table, bbq-feast, weekend-feast, art-of-karahi, rooted-in-tradition, save-room, new-product-reveal | `photo` (file id), `layout: 'A'|'B'`, `label` ≤ 28 chars, `headline` 2 lines ≤ 14 chars each, `line` ≤ 90 chars, `footer: 'brand'|'address'` | brand for from-the-fire/from-the-karahi/chapli-*/art-of-karahi/rooted-in-tradition/customer-favourite/modern-fuadijan/new-product-reveal; address for snack-pack/family-*/bbq-feast/weekend-feast/save-room |
| `review` | customer-review, you-said-it | `photo?`, `quote` ≤ 220 chars, `reviewer` initials, `label` = "CUSTOMER LOVE" | address |
| `carousel` | chapli-education, audience-poll | `cover_photo`, `cover_title`, `slides[] { title ≤ 40, photo? }` (2–7), `closing_title` | brand (cover only) |
| `story` | every row (9:16) | `photo`, `label`, `headline` | none (safe zones: nothing in top 250 / bottom 300 px) |
| `reel-cover` | every reel row | `photo`, `hook` ≤ 60 chars, `label` | brand |
| `text-only` | brand-intro, brand-finale, auburn-community, behind-fuadijan, team-picks, new-product-teaser | `label`, `headline`, `line` | brand |

Layout constants (from the samples): canvas 1080×1350 / 1080×1920; logo 220 px wide at (60, 60); text column x=60, width 460, vertically 35–70 %; label Saffron (Sand on busy photos) 26 px, 0.3 em tracking, uppercase; headline Instrument Serif Cream, start 130 px / line-height 0.95, shrink in 8 px steps until two lines fit (measure with satori, retry); Ember rule 90×3; line Inter 32–34 px Cream ≤ 3 lines; footer 60 px from the bottom, Sand 22 px, 0.25 em tracking. Layout A: cutout + shadow in the right ⅔, ~75 % canvas width, left rim may run under the headline. Layout B: full-bleed photo, Night gradient over the lower 45 %. The food's centre is never under text (checked by a unit test on the layout boxes).

Snapshot tests: every template × sample data → PNG, compare a perceptual hash + pixel diff tolerance against `test/__snapshots__/*.png`. `npm run render-samples` writes `samples/out/<key>.png` next to a copy of the matching reference.

`canva-brief.txt` (every pack, Cut 1 already): template key + layout, label / headline (with the break) / line / footer text, which crop to drop in, hex values and font names.

---

## 8. `brand/brand.json`

```json
{
  "name": "Fuadijan social kit",
  "version": 1,
  "colors": {
    "night": "#0F0D0B", "charcoal": "#171412", "cream": "#F3EBDD",
    "sand": "#B8AC9A", "ember": "#E8742E", "saffron": "#F2B544"
  },
  "fonts": {
    "heading": { "family": "Instrument Serif", "file": "fonts/InstrumentSerif-Regular.ttf", "italic": "fonts/InstrumentSerif-Italic.ttf", "fallback": "fonts/PlayfairDisplay-Regular.ttf" },
    "body":    { "family": "Inter", "file": "fonts/Inter-Regular.ttf", "medium": "fonts/Inter-Medium.ttf", "fallback": "fonts/DMSans-Regular.ttf" }
  },
  "logo": "logo.png",
  "canvas": { "feed": [1080, 1350], "story": [1080, 1920], "square": [1080, 1080] },
  "layout": { "margin": 60, "logoWidth": 220, "textColumn": 460, "ruleSize": [90, 3],
              "label": { "size": 26, "tracking": 0.3 }, "headline": { "start": 130, "min": 84, "step": 8, "lineHeight": 0.95 },
              "line": { "size": 34, "maxLines": 3 }, "footer": { "size": 22, "tracking": 0.25 } },
  "cutout": { "widthRatio": 0.75, "shadow": { "offsetY": 24, "blur": 40, "opacity": 0.55 }, "glow": { "color": "ember", "opacity": 0.12 },
              "feather": 3, "minCoverage": 0.25, "maxCoverage": 0.90 },
  "seriesLabels": ["FROM THE FIRE", "FROM THE KARAHI", "ROOTED IN TRADITION", "MODERN FUADIJAN", "BEHIND FUADIJAN"],
  "brandLine": "SMOKED. GRILLED. ROOTED IN TRADITION.",
  "ornament": "✻"
}
```

Fonts are the four OFL Google Fonts as TTF in `brand/fonts/` (downloaded once, committed). `brand/logo.png` is the Fuadijan logo on transparent (the one in the reference samples); until the owner gives a PNG I'll take `fuadijan_logo.png` from `square-integration`. The loader validates every file exists at boot.

---

## 9. Reminder schedule (node-cron, `timezone: 'Australia/Sydney'`)

| when (Sydney) | job | Cut |
|---|---|---|
| every 5 s | jobs worker tick | 1 |
| every minute | post-time check: rows with `date = today` and `post_time` (or default) = now → post-time reminder once (dedup in `messages_log`) | 1 |
| 08:30 daily | morning brief (next 7 days) + shoot reminders folded in (2 days / 1 day before, 4 days for gated rows 22–24, 29) | 1 |
| 12:00 daily | story reminder for today's row if it has `story_ideas` and no story was sent | 1 |
| 21:30 daily | evening nudge if today's row isn't `posted` | 1 |
| every 15 min | menu source refresh (cache; failures logged, last good copy kept) | 1 |
| Sun 17:00 | weekly review (coming week, rows with no dish, repeats back-to-back, dishes not on menu / sold out, open questions) | 2 |
| `/run/:job` (bearer `RUN_TOKEN`) | fire any of the above by hand | 1 |

`paused` setting silences everything but replies to the owner. All times configurable: `BRIEF_TIME`, `STORY_TIME`, `NUDGE_TIME`, `REVIEW_TIME`.

---

## 10. Web app (`web/`, Vite + React 19 + react-router)

- Served by Fastify at `/` from `web/dist` (POS-style static handler, SPA fallback to `index.html`), API under `/api/*`. Security headers = POS's `SECURITY_HEADERS`; API mutations also require `Sec-Fetch-Site: same-origin` (or none) and reject other `Origin`s.
- Auth: `src/auth/hubSession.ts` = Payroll's middleware in TypeScript with `APP_KEY='social'`, `HUB_SESSION_MAX_HOURS=48`. Page requests without a valid session → 302 to `${HUB_URL}/login?callbackUrl=<here>`; API requests → 401 JSON (403 when signed in without the `social` grant) and the SPA redirects like Payroll's `apiFetch`. Locally with no `HUB_COOKIE_DOMAIN`: `DEV_USER` is the user.
- Frame kit vendored by `python sync.py social` (after adding `"social": vite_app("fuadijan-social/web")` to `fuadijan-brand/sync.py`). `AppFrame` with nav Week / Month / Day, `appsHref = HUB_URL`.
- Screens as in the brief. Cut 1 is read-only plus: question answer buttons (`POST /api/questions/:id/answer`), Mark posted / Skip / Push +1 (`POST /api/rows/:dayNo/status|skip|push`), Copy (clipboard in the tap handler), Share (Web Share API with the PNG/JPG as a `File`, falls back to Download). Cut 2: Edit (every text field → `calendar_edits`) and Upload (multipart → same intake pipeline).
- API: `GET /api/week`, `GET /api/month`, `GET /api/day/:dayNo`, `GET /api/questions`, `GET /api/status`, `GET /api/files/:id` (images), `GET /api/packs/:dayNo/:name` (txt files), the POSTs above, `GET /health` (public).

---

## 11. Images

- `sharp` for all prep (§4). HEIC via `heic-convert` when the mime/magic says so; the README also tells the owner about "Most Compatible".
- Background removal (Cut 2) behind `BackgroundRemover { remove(buffer): Promise<{ mask: Buffer, coverage: number }> }`. Default `@imgly/background-removal-node` **if its licence allows this use** — I'll read the licence file in the package before adding it; if it's AGPL-only or non-commercial, the default becomes U²-Net / ISNet (Apache-2.0 ONNX weights, pinned by hash) run with `onnxruntime-node`. `remove.bg` (`REMOVE_BG_KEY`) is the switchable alternative either way. Mask post-processing in sharp exactly as the brief specifies.
- Test fixtures: `brand/reference/real-01..03.jpg` → expected cutout coverage ranges, plus the sample → reference pairs 1, 3, 4 for the look.

---

## 12. Env vars (`.env.example`)

```
# core
TZ=Australia/Sydney
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/fuadijan_social
DATA_DIR=./data
CALENDAR_START=2026-11-03
WEB_URL=https://social.nutrimeals.au          # deep links; http://localhost:3000 locally
RUN_TOKEN=                                    # bearer for POST /run/:job

# hub login (unset HUB_COOKIE_DOMAIN locally → DEV_USER is signed in)
HUB_URL=https://apps.nutrimeals.au
HUB_COOKIE_DOMAIN=.nutrimeals.au
NEXTAUTH_SECRET=
HUB_SESSION_MAX_HOURS=48
DEV_USER=Ahmad

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Claude
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-opus-5-5

# menu facts
MENU_SOURCE=menu-screens                      # menu-screens | pos | file
MENU_SCREENS_URL=https://fjtv.nutrimeals.au/api/menu
POS_DATABASE_URL=                             # read-only role, when MENU_SOURCE=pos

# reminders (Sydney)
BRIEF_TIME=08:30
STORY_TIME=12:00
NUDGE_TIME=21:30
REVIEW_TIME=17:00                             # Sundays

# quality thresholds
MIN_LONG_EDGE=1600
MIN_LUMINANCE=45
MIN_LAPLACIAN=60

# Cut 2
BACKGROUND_REMOVER=imgly                      # imgly | removebg | none
REMOVE_BG_KEY=
MESSENGER=telegram                            # telegram | email
SMTP2GO_API_KEY=
EMAIL_FROM="Fuadijan Social <social@nutrimeals.au>"
EMAIL_TO=
```

Settings that the owner edits from Telegram (`/set`) live in the `settings` table, not env: address, hours, website, post-time defaults.

---

## 13. Tests and the dry run

- Vitest. Unit tests need no database: caption parser, workbook clean-ups (fixture workbook built in the test), date/Sydney helpers, caption.txt layout, reel pack text, hub session (tokens minted with `next-auth/jwt`), message formats, Claude schemas against fixtures, menu-screens parsing against a recorded JSON.
- Database tests (`TEST_DATABASE_URL` ending in `_test`, skipped otherwise, as in the POS): migrations, seed idempotence + owner-edit protection, job worker stage transitions, question parking/resume, skip/push logic.
- `npm run dry-run -- --day 2 --file samples/chapli.jpg`: migrates + seeds a local DB if needed, injects the file as a Telegram photo with caption `chapli kebab #day2`, runs every stage with `FixtureClaude` and a `ConsoleMessenger`, prints the pack folder and `caption.txt`, `canva-brief.txt` (and `reel-pack.txt` for a reel day). `--day 1` shows the reel pack.
- `samples/`: copies of `real-01..03.jpg` as `karahi.jpg`, `plates.jpg`, `tikka-chips.jpg`; `chapli.jpg` is a **stand-in** (a copy of `tikka-chips.jpg`) until the owner sends a real Chapli photo — the fixture Claude answer is keyed by day, so the dry run is unaffected.

---

## 14. Two-cut delivery

**Cut 1 — by Mon 2 Nov (this session)**
1. Scaffold, `config.ts`, pool + migrations, `0001_init.sql`, settings seed.
2. `seed-calendar` with the clean-ups and the placeholder report.
3. Hub auth port + test; Fastify server with security headers, `/health`, `/run/:job`, static web.
4. Web app: frame kit synced, Week / Month / Day read-only + Copy/Share + question and status buttons.
5. Menu source `menu-screens` (+ `file`), cache, freshness in `/status`.
6. Telegram bot: private gate, commands, intake (photo/document/video), caption parser, quality check, questions with buttons, free-text routing.
7. Jobs worker: intake → match → prep → resolve → (render pass-through) → pack → notify; packs with `caption.txt`, `canva-brief.txt`, `reel-pack.txt`, crops attached.
8. Reminders: morning brief + shoot reminders, post-time, story reminder, evening nudge; `posted`, `skip`, `/push`.
9. `npm run check` green; `npm run dry-run -- --day 2 --file samples/chapli.jpg` prints a pack; README.

**Cut 2 — by Thu 5 Nov**
1. Fonts + logo in `brand/`, `brand.json` loader, satori/resvg templates, snapshot tests, `render-samples`.
2. Background remover + cutout/shadow/glow, layout A/B choice, render stage live.
3. Day screen Edit (+ `calendar_edits`) and Upload.
4. Sunday review (Claude `weekly-review`), `/status` spend, email fallback via smtp2go.
5. Railway service + Postgres, `social.nutrimeals.au` CNAME, hub key + tile — only after the owner approves the spend.

What stays mocked after Cut 1: Claude in tests and the dry run (fixtures); Telegram in the dry run; the render stage (pass-through until Cut 2); the `pos` menu source (interface + stub, no live POS yet).

---

## 15. Questions for the owner (answer before Day 1; the agent won't guess)

1. **Address line** for the 📍 and the footer: `129 Parramatta Road, Auburn NSW 2144`? (The Canva samples spell it "Paramatta"; the workbook captions say "129 Parramatta Rd".)
2. **Opening hours** for the footer, weekdays and weekends (samples say `OPEN 5PM – 10PM`).
3. **Website link** for stories until fuadijan.com.au is live — the Menu Screens page or the Square Online link?
4. **Day 22/23 fire-grilled fish**: confirmed, or should those days switch to evergreen "From the Fire" content? **Day 24 dessert**: which dessert is on the menu? **Day 29**: the three real ideas to poll.
5. **Days 5 and 20 reviews**: the exact review texts, reviewer initials and permission.
6. **Railway**: approve a new service + Postgres (about US$5–10/month), or run Cut 1 from the shop PC first?
7. **Storage decision** (§1): images in Postgres rather than a Railway volume — fine?
8. **Telegram**: create the bot with BotFather and paste the token into `.env`; send it `/start` — the log shows your chat id to put in `TELEGRAM_CHAT_ID`.
9. A real **Chapli Kebab photo** for `samples/chapli.jpg` (any phone shot), so the dry run and Cut 2's render samples use the right dish.
10. Hub: OK for me to add the `social` key, tile and `APP_URL_SOCIAL` to `fuadijan-hub` and the `social` entry to `fuadijan-brand/sync.py` (two tiny edits in two repos, committed by you)?

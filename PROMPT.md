# Fuadijan Social Agent — build brief for Claude Code (v2.1, 2026-10-30)

Run from a new folder `~/Documents/fuadijan-social` (`git init` locally; a private GitHub repo `fuadijan/fuadijan-social` like the POS — ask before creating it). Before starting, copy `~/Downloads/Fuadijan-Posts-Calendar.xlsx` to `calendar/Fuadijan-Posts-Calendar.xlsx` (git-ignored) and `~/Downloads/Fuadijan-30-Day-Content-Calendar.md` to `calendar/source.md` (narrative reference only), and the six approved sample posts from `~/Downloads/fuadijan-social-reference/01..06.webp` to `brand/reference/`. Paste everything below into Claude Code.

---

## What this is

A small always-on service that runs Fuadijan's 30-day Instagram calendar for the owner, who shoots and posts everything himself from his phone. The agent **reminds him what to shoot, turns the photos he sends it into branded 4:5 / 9:16 designs, and hands him everything to copy-paste at posting time**. It never posts, never generates or retouches food with AI, and never invents a menu fact.

It has two faces that share one database: a **Telegram bot** (reminders, photo intake, questions) and a **phone-first web app** at `social.nutrimeals.au` behind the Fuadijan login hub, with three screens: *This week* (the brief), *Month* (the 30 days and what to shoot), and *Day* (the full post: shot list, caption, hashtags, story, images, status). See "Web app".

Owner: Ahmad. Restaurant: Fuadijan, halal Pakistani charcoal BBQ, Auburn NSW (street address is a setting — see "Confirm before Day 1"). Brand line: *Smoked. Grilled. Rooted in Tradition.* Series labels: FROM THE FIRE, FROM THE KARAHI, ROOTED IN TRADITION, MODERN FUADIJAN, BEHIND FUADIJAN.

Day 1 is **Tuesday 2026-11-03** (`CALENDAR_START`). Everything runs on Sydney time.

## What changed from the first brief, and why (don't drift back)

1. **No Canva.** Canva's Brand Templates + Autofill APIs require a Canva **Enterprise** organisation, not Pro. Designs are rendered in-house: HTML-like templates → PNG with `satori` + `@resvg/resvg-js` (no headless browser), photo prep and compositing with `sharp`. The owner can still open the plain prepped crop in the Canva app by hand when he wants something different.
2. **No Google Sheets / Drive.** Telegram is both the inbox and the outbox: Ahmad sends a photo to the bot with a caption, and the caption replaces the filename convention (renaming files on a phone is painful). The calendar lives in Postgres, seeded once from the `Calendar` sheet of `calendar/Fuadijan-Posts-Calendar.xlsx`, and is browsed in the web app (behind the login hub, like every other Fuadijan app).
3. **No LangGraph / LangSmith.** The per-photo pipeline is a linear state machine with one pause point; it's a `jobs` table and a worker loop, the same pattern as the POS's outbox tables. Observability is a `claude_calls` table (model, tokens, cost, latency, result) that `/status` reports.
4. **Fastify, not Express**, to share patterns with `fuadijan-pos` (migrations run on boot, `pg` pool, smtp2go client).
5. **Brand kit is the social palette the owner approved from Canva samples** (the look is specified under "Render templates"): Night `#0F0D0B`, Charcoal `#171412`, Cream `#F3EBDD`, Sand `#B8AC9A`, Ember `#E8742E`, Saffron `#F2B544`; headings Instrument Serif (fallback Playfair Display), body Inter (fallback DM Sans). It lives in `brand/brand.json`; the six approved samples in `brand/reference/` are the look to match. This is the social kit, separate from the app UI tokens in `~/Documents/fuadijan-brand` — don't mix them. Fonts are bundled TTF files in `brand/fonts/` (satori needs the files; all four are Google Fonts under the OFL).
6. **Menu facts come from Menu Screens today, the POS later.** The POS isn't live yet. `square-integration` already serves a public `/api/menu` (names, categories, prices, sold-out) that the TV boards read. One `MenuSource` interface with three implementations: `menu-screens` (default), `pos` (read-only Postgres role, `packages/db` in `fuadijan-pos` documents the schema), `file` (`data/menu.json`).

## Stack (match the other Fuadijan apps)

- Node 22, TypeScript, ESM, npm. One long-running process on Railway: Fastify for `/health` and manual triggers, `node-cron` for schedules, a worker loop for jobs, the Telegram bot on **long polling** (no public webhook needed; one instance only). `railway.json` like the Payroll repo's (NIXPACKS, explicit start command). Deploys on push to `main`, like every other app.
- Postgres on Railway, this app's own database (every Fuadijan app has its own). Plain SQL migrations in `src/db/migrations/`, run on boot. **A new Railway service + Postgres costs money (roughly US$5–10/month) — confirm with the owner before creating them; until then run locally.**
- `@anthropic-ai/sdk` for all language and vision work. Model from `CLAUDE_MODEL`, default `claude-opus-5-5` (the volume is a handful of calls a day; `claude-sonnet-5-5` is the cheaper override). Structured outputs through `client.messages.parse()` with Zod schemas (`output_config.format`), **not** forced `tool_choice` (returns 400 on these models) and no free-text parsing. Leave thinking adaptive (omit the parameter). Enable the server-side refusal fallback (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`). Log every call to `claude_calls`. Never send an image larger than a 1024 px thumbnail.
- Telegram via `grammy` (TypeScript-first). Only `TELEGRAM_CHAT_ID` is obeyed; every other chat gets one "this bot is private" reply and is logged. Put the channel behind a `Messenger` interface; ship **email via smtp2go** as the fallback channel now (copy the POS's `apps/store/src/email/smtp2go.ts` approach), WhatsApp later if ever.
- Images: `sharp` for everything (auto-orient, attention crop, gentle `normalise()`, light `sharpen()`, resize, strip EXIF). HEIC: sharp's prebuilt binaries can't decode it — decode with `heic-convert` (WASM) first, or ask Ahmad to set the iPhone camera to "Most Compatible" (JPEG). Render: `satori` → SVG → `@resvg/resvg-js` → PNG; the photo is embedded as a data URL of the prepped crop or cutout.
- **Plate cutout (background removal).** Ahmad's real photos are shot on a patterned wooden table or a grey bench; the approved samples got their look by cutting the plate out and placing it on the dark canvas with a soft shadow. That's segmentation, not generation, and it's a required step. Behind a `BackgroundRemover` interface: default `@imgly/background-removal-node` (ONNX models run locally, no API; **check its licence allows this commercial use before shipping** and pin the model files so Railway builds are repeatable), with `remove.bg` (`REMOVE_BG_KEY`, a few cents an image) as the alternative. Mask post-processing in sharp: feather the edge 2–3 px, drop the mask's stray islands, make a drop shadow from the blurred alpha offset 24 px down at 55% opacity, and a warm radial glow (Ember at ~12%) behind the plate. If the mask covers under 25% or over 90% of the frame, or the vision pass says the photo is a scene, skip the cutout and use the full-bleed layout instead.
- **Web app:** Vite + React 19 + TypeScript in `web/`, built to static files and served by the same Fastify process at `/` (the POS store serves its built till and KDS apps the same way), with a JSON API under `/api/`. UI chrome uses the shared Fuadijan **app frame kit and UI tokens** vendored from `~/Documents/fuadijan-brand` (`python sync.py social`; AppFrame, PageHeader, Card, Button, Tabs, ThemeToggle, the phone bottom bar). The UI palette (ember/saffron/sand UI tokens) is for the app's chrome; the social palette in `brand/brand.json` is only for rendered posts. Don't mix them.
- **Login = the hub.** Domain `social.nutrimeals.au` (CNAME at GoDaddy to the Railway service; the apex row is untouchable). Verify the hub's `__Secure-next-auth.session-token` cookie exactly as Payroll does — port `~/Documents/Payroll/server/middleware/hubSession.js` to TypeScript: NextAuth v4 encrypted JWE, same `NEXTAUTH_SECRET`, the `apps` claim must include **`social`**, and the sign-in (`auth_time`) must be under **48 hours** old (`HUB_SESSION_MAX_HOURS=48`; the owner raised this from the 12 hours the other apps use on 2026-10-30 — the hub itself (`fuadijan-hub/lib/auth.ts` `maxAge` and `lib/session.ts`) must be raised to 48 h as well or its 12 h cut-off wins); otherwise redirect to the hub, never to a login page of this app's own (it has none). Add `social` to the hub's `APP_KEYS` and a tile (`~/Documents/fuadijan-hub/lib/apps.ts`). Locally, with no `HUB_COOKIE_DOMAIN` set, the API trusts a `DEV_USER` env var, as Payroll's `HUB_MODE` does. The Telegram bot and the web app are the only ways in; the `/api/` routes also accept nothing from other origins (same-origin only, strict CSP, security headers as the POS store sets them).
- `.env` + `.env.example`; `TZ=Australia/Sydney`; store timestamps as UTC, compute schedules in Sydney.
- Vitest. `npm run check` = typecheck + tests. Snapshot tests for every render template (PNG hash + a saved reference image under `test/__snapshots__/`).

## Repo layout

```
fuadijan-social/
  README.md               what it does, setup in order, the caption convention, the Telegram commands, what it won't do
  PROMPT.md               this brief
  calendar/               Fuadijan-Posts-Calendar.xlsx (git-ignored) + source.md (narrative reference) + calendar.schema.ts + seed.ts
  brand/                  brand.json (the approved palette + fonts), fonts/*.ttf, logo.png, reference/01..06.webp
  src/
    config.ts
    db/                   migrations/*.sql, pool.ts, migrate.ts (run on boot)
    calendar/             row model, status writes, date assignment from CALENDAR_START, push/skip logic
    intake/               telegram photo/document/video handlers, caption parser, HEIC decode, quality check
    images/               sharp prep, ratio crops, luminance/blur stats
    brain/                Claude calls: match-photo-to-row, resolve-copy, write-pack, weekly-review
    render/               satori templates (hero-photo, review, carousel, story, reel-cover, text-only), brand loader
    pipeline/             jobs table worker: intake → match → prep → resolve → render → pack → notify
    menu/                 MenuSource interface + menu-screens.ts, pos.ts, file.ts
    reminders/            cron jobs: morning brief, shoot reminders, post-time, evening nudge, Sunday review
    messaging/            Messenger interface, telegram.ts (grammy), email.ts (smtp2go), formats.ts
    api/                  fastify routes under /api: week, month, day, questions, status, uploads, packs
    auth/                 hubSession.ts (port of Payroll's middleware), grants
    server.ts             fastify: /health, /run/:job (bearer token), /api/*, static web/dist at /
    main.ts               boot: migrate → menu source check → templates check → bot + cron + worker + server
  web/                    Vite + React app: src/screens/Week.tsx, Month.tsx, Day.tsx; vendored frame kit + tokens
  packs/                  local Ready packs (git-ignored): packs/<date> <day-slug>/
  samples/                a few test photos for dry runs
  test/
```

## Postgres schema (minimum)

- `calendar_rows` — `day_no, date, slot (feed|carousel|reel), type, dish, theme, caption_hint, post_time, template, status (planned|photo-needed|ready|posted), asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes, posted_at, updated_at` (the workbook's 18 columns plus `day_no`, `posted_at`, `updated_at`). Seeded from the workbook; the agent writes `status`, `posted_at`, and whatever `/edit` changes, and keeps an `edits` history row per change.
- `assets` — `id, telegram_file_id, kind (photo|document|video|text), filename, caption_raw, parsed_subject, parsed_tags[], parsed_note, calendar_row_id?, width, height, quality jsonb, prepped_paths jsonb, created_at`.
- `renders` — `id, asset_id, calendar_row_id, template, format (feed|story|carousel|reel-cover), path, created_at`.
- `packs` — `id, calendar_row_id, caption, hashtags, alt_text, story_text, facebook_caption, reel_on_screen_text?, reel_shot_list?, folder, created_at`.
- `questions` — open confirmations (`row_id, field, question, options jsonb, answer?, asked_at, answered_at, telegram_message_id`).
- `jobs` — `id, asset_id, stage, state jsonb, waiting_on_question_id?, attempts, last_error, created_at, updated_at`.
- `claude_calls` — `id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, latency_ms, ok, created_at`.
- `messages_log`, `settings` (key/value: address, opening hours, website link, post-time defaults — editable from Telegram).

## The calendar seed (`npm run seed-calendar`)

Reads sheet `Calendar` of `calendar/Fuadijan-Posts-Calendar.xlsx` with `exceljs`: 30 rows, 18 columns, exactly `date, slot, type, dish, theme, caption_hint, post_time, template, status, asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes`; dates run 2026-11-03 → 2026-12-02. Read the `Read Me` sheet too. Facts about this workbook (checked 2026-10-30):

- `day_no` = row order (1–30). Key on it, not on `date`: the Read Me says dates may be changed. `date` cells are ISO strings at midnight UTC — take the date part as the Sydney date, don't convert.
- 23 rows are reels, 4 feed, 3 carousels. `post_time` is blank throughout (defaults apply) and `status` is `planned` throughout.
- A blank `dish` is intentional (brand, community, review rows). The morning brief suggests a dish by rotation from the menu source and Ahmad confirms with a button; the agent never fills `dish` on its own.
- Captions end with a `📍 129 Parramatta Rd, Auburn` line: strip it on import; the pack adds `STORE_ADDRESS`.
- Row 2's `confirmation_notes` duplicates its `creative_instructions`; when the two are identical, treat `confirmation_notes` as empty.
- `[bracketed]` placeholders sit in days 3, 4, 5, 16, 17, 20, 22, 23, 24, 25, 28 and 29 (heaviest: 23, 29, 3, 24). Print them all after seeding so the owner sees what he'll be asked.
- `template` values are the sheet's own names (`from-the-fire`, `chapli-education`, `customer-review`, …); the render registry below maps every one of them.

Idempotent: re-running updates by `day_no` but **never overwrites a field Ahmad edited** (the `edits` history says which). `calendar/source.md` is the narrative version of the same plan: use it only to settle an ambiguity, never as a second source. The 6-column `Fuadijan_30_Day_Social_Media_Calendar.xlsx` in Downloads is an older cut — ignore it.

## Photo intake over Telegram (the caption convention)

Ahmad sends a photo, a file, or a video to the bot. The **caption** is parsed as:

`<dish or subject> [-- optional note] [#tags]`

Examples: `chapli kebab` · `chicken karahi -- cooked to order, with naan` · `team photo #day11` · `beef seek #story` · `karahi clip 1` (video).
Tags: `#dayN` (force a calendar row), `#story` (9:16 only), `#feed`, `#carousel`, `#noprice`, `#price` (prices allowed, from the menu source only), `#drafts3` (three caption options), `#unscheduled` (don't match the calendar). No caption → the agent asks "Which day is this for?" with the top 3 rows as buttons.

Several photos within 10 minutes for the same day are one set (`chapli 1`, `chapli 2` → a carousel if the row is a carousel, otherwise the best one is the hero and the rest become stories). Videos aren't downloaded or rendered (Bot API files are capped at 20 MB); they're logged against the row and the pack says "clip received".

**Quality:** Telegram recompresses "photos" to ~1280 px. If a photo arrives under 1600 px on its long edge, reply once: "Got it. For a sharper post, send it as a *File* (📎 → File) — or reply **ok** to use this one." Too dark or blurry (mean luminance, Laplacian variance thresholds in config) → say so and ask for another; never "fix" it.

## Pipeline per photo (`jobs` worker, one stage per tick, resumable)

1. **intake** — download via `getFile`, decode HEIC if needed, store the asset, run the quality check.
2. **match** — Claude picks the calendar row and reads the photo. Candidates: rows within −2…+10 days whose `dish`, `type`, `theme` or `creative_instructions` fit the caption and what's visible in a 512 px thumbnail; plus the menu names. Output schema `{ row_id | null, confidence, reason, dish_canonical, alternatives[], composition: "single-plate" | "scene" | "people" | "other", background_clutter: "low" | "medium" | "high", shoot_tip: string | null }`. `composition` decides the render layout (single plate → cutout layout A; scene or people → full-bleed layout B). `shoot_tip` is one plain sentence Ahmad gets back when clutter is medium or high ("Boxes and the fire extinguisher are in the background — shoot tighter or from above on the dark bench"), because he shoots everything himself and a tip now saves a reshoot later. Confidence < 0.7 or `#unscheduled` → ask on Telegram with inline buttons (top 3 rows + "unscheduled"), write a `questions` row, and park the job (`waiting_on_question_id`) until the answer arrives.
3. **prep** — sharp crops: 4:5 feed (2160×2700), 9:16 story (2160×3840), 1:1 square; carousels 4:5 per image. Long edge 2160 px, EXIF stripped. For `single-plate` photos also the **cutout** (plate PNG with alpha + its shadow), kept beside the crops.
4. **resolve** — Claude turns the row's draft copy into publishable copy. Rules: keep the calendar's caption and CTA as written unless the caption note says otherwise; find every `[bracketed]` placeholder and CONFIRM note in `caption`, `on_screen_text`, `cta`, `hashtags`, `creative_instructions`; resolve what the menu source can (dish names, sides, categories, availability); for the rest **ask Ahmad** — one Telegram message listing the questions with suggested answers as buttons — and don't render until answered. Never invent prices, availability, reviews, people's names or cooking claims. Hashtags: the row's, 3–5, Australian spelling; a bracketed hashtag is resolved or dropped. Output schema `{ label, headline, line, caption, cta, hashtags[], alt_text, story_text, facebook_caption, on_screen_text[], unresolved[] }`.
5. **render** — only for `feed`, `carousel`, and story/reel covers: the template named in the row's `template` column (fallback by `type`, see the registry) at 1080×1350 / 1080×1920 / one PNG per carousel page. Text never over the food (templates reserve a band or a gradient edge), logo small.
6. **pack** — write `packs/<date> <day-slug>/` with `feed.png` / `story.png` / `carousel-01..N.png` / `reel-cover.png`, the plain prepped crops (`crop-4x5.jpg`, `crop-9x16.jpg`), `caption.txt` in the exact layout below, **always** a `canva-brief.txt` (see "Manual fallback" under Render templates), and for reels `reel-pack.txt` (hook, on-screen text in order, shot list from `creative_instructions`, suggested length, music note "use Instagram's licensed audio"). Set `status = ready`.
7. **notify** — Telegram: the rendered image(s) as *files* (not photos, so Instagram gets full quality), then the caption block, then a separate message with only the hashtags (one-tap copy), then "Reply `posted 12` when it's up".

`caption.txt` layout (plain text, no markdown, blank lines preserved):

```
=== CAPTION ===
<caption>
<CTA>
📍 <STORE_ADDRESS>

=== HASHTAGS (first comment or end of caption) ===
#... #... #...

=== ALT TEXT ===
<one sentence>

=== STORY ===
<sticker text / poll text from story_ideas, with placeholders resolved>
Link: <WEBSITE_URL>   Tag: @fuadijan   Location: Auburn, NSW

=== FACEBOOK ===
<caption without hashtags>

=== POST AT ===
<Weekday D Mon, HH:MM> — <slot>
```

## Render templates (`src/render/templates.ts`)

| key | the sheet's `template` values it renders | fields |
|---|---|---|
| `hero-photo` | from-the-fire, from-the-karahi, chapli-from-the-fire, customer-favourite, snack-pack, modern-fuadijan, family-feast, family-table, bbq-feast, weekend-feast, art-of-karahi, rooted-in-tradition, save-room, new-product-reveal | `photo`, `label`, `headline`, `line` |
| `review` | customer-review, you-said-it | `photo`, `quote`, `reviewer`, `label` ("CUSTOMER LOVE") |
| `carousel` | chapli-education, audience-poll | `cover_photo`, `cover_title`, `slides[] {title, photo?}`, `closing_title` |
| `story` | every row's story | `photo`, `label`, `headline` |
| `reel-cover` | every `reel` row (23 of 30), with its template's label | `photo`, `hook`, `label` |
| `text-only` | brand-intro, brand-finale, auburn-community, behind-fuadijan, team-picks, new-product-teaser (when no photo fits) | `label`, `headline`, `line` |

The registry is a map from the sheet's `template` value to a key; boot fails if a value in the sheet has no mapping.

**The look (match `brand/reference/01..06.webp`; these were made in Canva and the owner approved them):**

- Canvas 1080×1350 (story 1080×1920), background Night with a soft Charcoal radial glow. **Layout A (cutout; samples 1, 3, 4, 5, 6):** the plate cutout with its shadow sits in the right two-thirds, about 75% of the canvas width, its left rim allowed to run under the headline's last letters as in sample 1; the text column on the left is on pure Night. **Layout B (full-bleed; sample 2):** the whole photo fills the canvas with a bottom-to-top gradient from opaque Night to transparent over the lower ~45%, text in that band; for scenes, people and anything the cutout can't handle. Satori does the layout and gradient; sharp composites the photo or cutout and exports. The food's centre is never covered by text in either layout.
- Logo (`brand/logo.png`) top-left, about 220 px wide, 60 px from the edges.
- Text column on the left, ~460 px wide, 60 px margin, vertically between 35% and 70% of the height: **label** in Saffron (Sand on busy photos), uppercase, letter-spacing 0.3em, ~26 px; **headline** in Instrument Serif, Cream, two lines, ~130 px with line-height 0.95, shrunk in steps until it fits two lines (satori doesn't auto-fit: measure, retry smaller); a 90×3 px **Ember rule**; the **line** in Inter 32–34 px, Cream, at most three lines.
- Footer at 60 px from the bottom, Sand, uppercase, letter-spacing 0.25em, ~22 px: either a thin Sand rule with the ✻ ornament and `ROOTED IN TRADITION` / `SMOKED. GRILLED. ROOTED IN TRADITION.` (samples 1/2), or two lines `STORE_ADDRESS` and `OPEN <OPEN_HOURS>` (samples 3–6). The row's `template` decides which; the brand-line footer is the default for hero rows, the address footer for specials and weekend rows.
- Review template: the quote in Instrument Serif italic, the reviewer's initials in Sand, label `CUSTOMER LOVE` in Saffron. Carousel: cover as layout B, inner slides a Charcoal card with a Cream title and an optional photo. Reel cover: layout B with the hook as the headline. Story: layout B stretched to 9:16 with the text in the lower third, nothing in the top 250 px or bottom 300 px (Instagram's UI covers them).
- Render every template on boot with sample data and fail loudly if a font or token is missing. Snapshot tests compare against saved PNGs. `npm run render-samples` writes every template to `samples/out/` next to the matching reference image so the owner can approve the look before Day 2.

**Manual fallback (`canva-brief.txt`, in every pack):** the template key and layout (A or B), the exact label / headline (with the line break) / line / footer text, which crop file to drop in, the palette hex values and font names, in a form Ahmad can rebuild in the Canva app in two minutes when he prefers to. `/brief 12` resends it. The reference samples were made from Ahmad's own photos (the originals of samples 1, 3 and 4 are `brand/reference/real-01..03.jpg`: karahi on the patterned table, four plates in the shop, tikka chips on the grey bench) — keep those pairs as the cutout test fixtures. A post uses only photos Ahmad sent.

## Web app (phone first; the same data the bot uses)

Three screens, phone bottom bar *Week · Month · Day*, desktop sidebar. Every Telegram message deep-links to the matching day (`https://social.nutrimeals.au/day/12`).

- **This week** (home) — the morning brief as a page, always current: the next 7 days as cards. Each card: weekday + date, slot badge (feed / carousel / reel), dish (or "dish to choose" with the rotation suggestion and a *Use this* button), status pill, **what's still needed** in plain words (photo / clips / a confirmation / nothing), the shot list lifted from `creative_instructions`, post time, and open questions with their answer buttons inline. Tap a card → Day. A *Shoot list* strip at the top groups what's needed in the next 7 and 14 days by dish, so he can shoot several days' worth in one evening.
- **Month** — the 30 days (3 Nov – 2 Dec) as a grid, one tile per day: day number, slot icon, dish or theme, status colour (planned grey, photo-needed saffron, ready ember, posted green), a dot for open questions. Below the grid, **What to shoot this month**: every dish and scene the calendar needs, grouped by week, each with the days it serves and the shot types (hero photo, clips, team, customer). Tap a tile → Day.
- **Day** — the whole row: title (`Day 12 — Chicken Tikka Snack Pack`), date, slot, series label, objective, theme; **Shoot** (creative instructions / shot list, on-screen text in order, story ideas); **Copy** (caption with a *Copy* button, CTA, hashtags with their own *Copy* button, alt text, Facebook caption, story text); **Confirm** (confirmation notes and open questions with buttons; nothing renders until they're answered); **Images** (received photos as thumbnails, rendered feed/story/carousel/reel-cover with *Download* and *Share* — the Web Share API with the PNG as a file opens the phone's share sheet, where Instagram is one tap away — plus the plain crops and the Canva brief); **Status** (*Mark posted*, *Skip* with the push-everything / just-this-one choice, *Push +1 day*). Cut 2 adds *Edit* (every text field, with the `edits` history) and *Upload photos* from the phone (same intake pipeline and caption convention as Telegram; the field for the caption is pre-filled with the day's dish).

Copy and Share must run inside the tap handler (iOS Safari requires a user gesture). The app is read-only before Cut 2 except for answering questions and the status buttons. Everything the app changes, the bot sees at once, and the reverse.

## Reminder schedule (node-cron, Sydney time; times in `.env`)

- **08:30 daily — morning brief.** Next 7 days: date, slot, dish, status, what's still needed. Plain language: *"Thu 6 Nov — Reel, Chicken Karahi (From the Karahi). No clips yet. Shoot: ingredients ready, karahi warming, adding in sequence, bubbling close-up, garnish, finished dish, naan beside it. 15–25 s vertical."* Shot list lifted from `creative_instructions`.
- **Shoot reminders.** Reels and carousels: 2 days before and the day before if nothing has arrived for that row. Feed photos: the day before, with the standing hero-shot tips: top-down or 45°, the plate on the plain dark bench (not the patterned table), wipe the rim, nothing else in frame, send as a File. Rows with a production gate or unresolved brackets (Days 22–24, 29): 4 days before, asking for the confirmation first.
- **Post-time reminder.** At `post_time` (default 18:00 if blank; stories at 12:00 if the row has `story_ideas`): resend the Ready pack — image, caption, hashtags — or say exactly what's missing.
- **21:30 evening nudge** if today's row isn't `posted`. `posted` / `posted 12` → `status = posted`, log the time. `skip 12` → row stays `planned` and moves to the next free date (ask first: "push everything after it by a day?" / "just this one").
- **Sunday 17:00 review.** Coming week; rows with no dish; dishes repeated back-to-back; rows whose dish isn't on the current menu or is sold out; open questions still unanswered.

Keep volume low: one morning brief, one post-time set, one evening nudge at most. Everything else only when there's something new.

## Telegram commands

`/today` `/week` `/status` (incl. Claude spend this month) `/pack 12` (resend) `/ask` (open questions) `/redo 12 <note>` (re-run resolve+render with the note, e.g. "shorter caption", "use photo 2") `/edit 12 caption <text>` (also `cta`, `hashtags`, `dish`, `post_time`, `story`) `/push 12 1` (move day 12 by +1 day) `/brief 12` (resend the Canva brief) `/set address <text>` `/set hours <text>` `/set website <url>` `/pause` `/resume`. Buttons for every question; a free-text reply is routed to the latest open question.

## Guardrails

- Never posts, never calls Meta APIs, never calls Canva.
- No generative image editing: nothing is painted, extended, relit by a model, or replaced. Allowed, because they only move or mask Ahmad's own pixels: crop, tone, sharpen, plate cutout, shadow, glow, gradient — which is what Canva did to the approved samples.
- Every `[bracket]` is resolved by the menu source or by Ahmad before `status = ready`. Unresolved → `photo-needed` with the question listed.
- Reviews (Days 5, 20): never generated. Ahmad sends the review text and permission note as a message or `.txt` starting `review -- <reviewer initials>`; the agent quotes it verbatim.
- People in photos: the pack reminds about consent for team/customer rows; the agent doesn't judge faces.
- Prices appear only with `#price` and only from the menu source.
- Secrets only in `.env` / Railway variables; the bot token and Anthropic key never in logs.

## Process

1. Write `PLAN.md`: schema, job stages, cron table, Telegram message formats, template field spec, brand.json shape, env vars, and the two-cut delivery below. **Stop and show it to me before writing code.**
2. **Cut 1 (must work by Mon 2 Nov):** calendar seed → hub login + the web app's Week, Month and Day screens (read-only, with Copy/Share, question buttons and status buttons) → Telegram bot (commands, questions, intake + prep) → menu source (menu-screens) → resolve + pack (copy only, plain prepped crops attached) → morning brief, post-time, evening nudge. 23 of the 30 rows are reels, so the reel pack (hook, on-screen text, shot list) and the copy matter more than feed designs; Day 1 is a reel, so no render is needed on day one.
3. **Cut 2 (by Thu 5 Nov):** render templates with snapshot tests → render stage in the pipeline → Day screen Edit + Upload → Sunday review → email fallback → `/status` spend.
4. Tests at each step; Claude calls tested with recorded fixtures (`test/fixtures/claude/*.json`), never live in CI.
5. `npm run dry-run -- --day 2 --file samples/chapli.jpg` runs the whole pipeline locally with Telegram and Claude mocked and prints the pack, so copy can be checked before anything is sent.
6. README: setup in order (Railway service + Postgres, the `social.nutrimeals.au` CNAME at GoDaddy and the Railway custom domain, `NEXTAUTH_SECRET` + `HUB_COOKIE_DOMAIN` from the hub, the `social` key and tile in the hub, Telegram bot + chat id, Anthropic key, menu source, `CALENDAR_START`, address / hours / website settings), the caption convention, the commands, and what the agent will and won't do.
7. Finish with a summary of what's built, what's mocked, and the first three things the owner must do by hand before Tuesday 3 Nov.

## Confirm before Day 1 (ask the owner; don't guess)

- The street address for the 📍 line and the footer. Note the Canva samples spell it "129 Paramatta Road": Parramatta has two r's. Confirm the full line (`129 Parramatta Road, Auburn NSW 2144`?) before anything renders.
- Opening hours for the footer (the samples say `OPEN 5PM – 10PM`; confirm, including weekends).
- The website link for stories: fuadijan.com.au isn't live yet; use the Menu Screens menu page or Square Online link until it is.
- Day 23 "Fire-Grilled Fish" is gated on confirmation; Days 5 and 20 need the review texts and permission.
- Whether a new Railway service + Postgres is approved, or Cut 1 runs on the shop PC / laptop first.

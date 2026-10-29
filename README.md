# Fuadijan Social Agent

An always-on helper that runs Fuadijan's 30-day Instagram calendar for the owner. It **reminds him what to
shoot**, turns the photos he sends over **Telegram** into branded post packs, and hands him everything to
copy-paste at posting time. It never posts to Instagram, never calls Meta or Canva, never generates or retouches
food with AI, and never invents a menu fact.

Two faces, one database: a Telegram bot (reminders, photo intake, questions) and a phone-first web app at
`social.nutrimeals.au` behind the Fuadijan login hub (This week · Month · Day).

- **Cut 1** (this build): calendar seed, hub login, the three read-only screens with Copy/Share and status
  buttons, the Telegram bot, photo intake and crops, copy packs (`caption.txt`, `canva-brief.txt`,
  `reel-pack.txt`), the morning brief, shoot reminders, post-time and evening nudges.
- **Cut 2**: rendered designs (satori + resvg, plate cutout), Day screen Edit + Upload, the Sunday review with
  Claude, the email fallback.

`PROMPT.md` is the brief, `PLAN.md` the approved plan.

## Setup, in order

1. **Node 22+** and a **Postgres 16**. Locally the app expects `postgres://postgres@localhost:5433/fuadijan_social`
   (a user-owned instance; see "Local Postgres" below) or the Windows service on 5432.
2. `npm install`, then `cp .env.example .env` and fill it in (every variable is explained in the file).
3. `npm run migrate` creates the database and tables. `npm run seed-calendar` loads the 30 rows from
   `calendar/Fuadijan-Posts-Calendar.xlsx` (sheet `Calendar`; the file is git-ignored) and prints every
   `[bracketed]` placeholder the owner will be asked about. Re-running never overwrites a field the owner edited.
4. **Telegram**: create the bot with BotFather, paste the token into `TELEGRAM_BOT_TOKEN`, start the app, send the
   bot any message — the log prints the chat id; put it in `TELEGRAM_CHAT_ID` and restart. Only that chat is obeyed.
5. **Anthropic key** in `ANTHROPIC_API_KEY`. Model `CLAUDE_MODEL` (default `claude-opus-5-5`). Without a key the
   app answers from `test/fixtures/claude` (useful for a first look, useless for real copy).
6. **Menu facts**: `MENU_SOURCE=menu-screens` reads Menu Screens' public `/api/menu`. Later `pos` (read-only POS
   role, `POS_DATABASE_URL`) or `file` (`data/menu.json`).
7. **Settings the owner edits from Telegram**: `/set address …`, `/set hours …`, `/set website …`. The seed starts
   with `129 Parramatta Road, Auburn NSW 2144`, `5PM – 10PM` and no website; confirm all three before Day 1.
8. `npm run build:web` builds the web app into `web/dist`; `npm start` serves everything on `PORT`.
9. **Deploy (after the owner approves the spend)**: a Railway service from this repo (`railway.json`: NIXPACKS,
   `npm run build:web`, `tsx src/main.ts`) plus a Railway Postgres (`DATABASE_URL`). One instance only (the bot
   long-polls). Then:
   - GoDaddy: CNAME `social` → the Railway service; Railway: custom domain `social.nutrimeals.au`.
   - `HUB_COOKIE_DOMAIN=.nutrimeals.au`, the hub's `NEXTAUTH_SECRET`, `WEB_URL=https://social.nutrimeals.au`.
   - In `fuadijan-hub`: add `"social"` to `APP_KEYS` in `lib/apps.ts` (label "Social"), a tile in `app/page.tsx`
     (`APP_URL_SOCIAL`), and grant the owner's account `social`. The hub and this app both cap a sign-in at
     **48 hours** (`HUB_SESSION_MAX_HOURS`).
   - `RUN_TOKEN` so `POST /run/morning-brief` etc. can be fired by hand.

### Local Postgres

The Windows service `postgresql-x64-16` needs an administrator to start. Without one, run a user-owned instance:

```bash
"/c/Program Files/PostgreSQL/16/bin/initdb.exe" -D .local/pgdata -U postgres -A trust -E UTF8 --locale=C
"/c/Program Files/PostgreSQL/16/bin/pg_ctl.exe" -D .local/pgdata -o "-p 5433" -l .local/pg.log start
```

`.local/` is git-ignored. Stop it with `pg_ctl -D .local/pgdata stop`.

## Day to day

```bash
npm run dev          # the whole agent with reload
npm run check        # typecheck + tests (database tests run when TEST_DATABASE_URL ends in _test)
npm run dry-run -- --day 2 --file samples/chapli.jpg   # the whole pipeline, Telegram → console, Claude → fixtures
npm run seed-calendar
```

The dry run seeds the calendar if needed, feeds the photo in as if the owner had sent it with the caption
`<dish> #dayN`, answers every question with its first suggestion, and prints the pack. `--caption "…"` and
`--answer "…"` override those. `samples/chapli.jpg` is a stand-in until a real Chapli photo arrives.

## The caption convention (Telegram)

Send a photo, a **File** (📎 → File, for full quality — Telegram recompresses "photos" to ~1280 px) or a video
with a caption:

```
<dish or subject> [-- optional note] [#tags]
chapli kebab
chicken karahi -- cooked to order, with naan
team photo #day11
beef seek #story
karahi clip 1
```

Tags: `#dayN` (force a calendar day), `#story` (9:16 only), `#feed`, `#carousel`, `#noprice`, `#price` (prices
allowed, menu only), `#drafts3`, `#unscheduled` (plain crops, no calendar match). No caption, or an uncertain
match → "Which day is this for?" with buttons. Several photos within 10 minutes for the same day are one set.
Videos aren't downloaded; they're counted against the day and the reel pack says "clip received".

Reviews (Days 5 and 20): send `review -- AB` and the review text; it is quoted exactly as sent.

Photos under 1600 px, too dark or blurry get one question (use it / resend) — nothing is "fixed".

## Telegram commands

`/today` `/week` `/status` (rows, jobs, open questions, Claude spend this month, menu source) `/ask`
`/pack N` `/brief N` `/redo N <note>` `/edit N <field> <text>` (`dish`, `caption`, `cta`, `hashtags`,
`story_ideas`, `post_time`) `/push N <days>` `/set address|hours|website <text>` `/pause` `/resume`,
plus `posted N`, `skip N`, `ok`. Every question has buttons; a free-text reply answers the latest open one.

## What arrives at post time

For a feed day: the plain crops as files (4:5 and 9:16; rendered designs come in Cut 2), the caption block
(caption, CTA, 📍 address, alt text, story text, Facebook caption, post time), a separate message with only the
hashtags (one-tap copy), and "Reply `posted N` when it's up". For a reel day the pack opens with the hook, the
on-screen text in order, the shot list, the length and the music note. Every pack is also written to
`packs/<date> <day-slug>/` with `caption.txt`, `canva-brief.txt` (how to rebuild the design in the Canva app in two
minutes) and, for reels, `reel-pack.txt`.

## Reminders (Sydney time, `.env`)

08:30 morning brief (next 7 days, what's still needed, shot lists) with shoot reminders (reels/carousels 2 and 1
days before, feed photos the day before, gated rows 4 days before) · every minute: post-time check (`post_time`
or 18:00) · 12:00 story reminder · 21:30 evening nudge if today's row isn't posted · Sunday 17:00 review.
At most one of each per day per row. `/pause` silences them.

## Layout

```
calendar/     xlsx.ts (reader) · calendar.schema.ts (clean-ups) · seed.ts
src/
  config.ts time.ts settings.ts files.ts context.ts
  db/         pool.ts migrate.ts migrations/*.sql
  calendar/   rows.ts (status, edits, push, skip) suggest.ts
  intake/     caption.ts
  images/     prep.ts (sharp: decode, HEIC, quality, crops)
  menu/       source.ts menu-screens.ts index.ts (file, pos)
  brain/      client.ts (Claude + fixtures + claude_calls) prompts.ts schemas.ts
  pipeline/   stages.ts worker.ts questions.ts packs.ts
  messaging/  telegram.ts commands.ts formats.ts messenger.ts
  reminders/  index.ts brief.ts
  auth/       hubSession.ts
  api/        routes.ts
  server.ts main.ts dry-run.ts
web/          Vite + React: screens/Week.tsx Month.tsx Day.tsx, vendored frame kit (components/fj)
test/         vitest; fixtures/claude/*.json, fixtures/menu-screens.json
```

## What it will and won't do

Will: remind, read photos, crop, ask before anything uncertain, write the copy from the calendar and the menu,
hand over packs, track posted/skipped days. Won't: post, call Meta or Canva, invent a dish, price, side, review,
name or cooking claim, paint or relight a photo, or talk to any Telegram chat but the owner's.

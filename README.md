# Fuadijan Social Agent

An always-on helper that runs Fuadijan's 30-day Instagram calendar for the owner. It **reminds him what to
shoot**, turns the photos he sends over **Telegram** into branded post packs, and hands him everything to
copy-paste at posting time. It never posts to Instagram, never calls Meta or Canva, never generates or retouches
food with AI, and never invents a menu fact.

Two faces, one database: a Telegram bot (reminders, photo intake, questions) and a phone-first web app at
`social.nutrimeals.au` behind the Fuadijan login hub (This week · Month · Day).

- **Cut 1**: calendar seed, hub login, the three screens with Copy/Share and status buttons, the Telegram bot,
  photo intake and crops, copy packs (`caption.txt`, `canva-brief.txt`, `reel-pack.txt`), the morning brief,
  shoot reminders, post-time and evening nudges.
- **Cut 2**: rendered designs (satori + resvg; plate cutout with a local Apache-2.0 segmentation model), the
  render stage in the pipeline, Day screen Edit + Upload, the Sunday review written by Claude from computed facts,
  the smtp2go email fallback, `npm run render-samples`.

`PROMPT.md` is the brief, `PLAN.md` the approved plan, `DEPLOY.md` the step-by-step deployment (Railway,
GoDaddy, hub tile, Telegram).

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
`story_ideas`, `post_time`) `/push N <days>` `/set address|hours|website <text>` `/set design <standing notes>`
`/set wording ask|off` `/fact <dish> -- <what is true>` `/wording N [k]` `/pause` `/resume`,
plus `posted N`, `skip N`, `ok`. Every question has buttons; a free-text reply answers the latest open one.

**Wording first.** After the copy is resolved and before anything is designed, the bot shows the calendar's wording
and two alternatives Claude wrote (shorter and punchier; warmer and story-led) and asks which to use; tap a button
or type your own headline. Every set is kept in `copy_options` and listed on the Day page under "Wording", where
any earlier wording can be chosen again (`/wording N k` does the same); after the pack is made a pick rebuilds the
designs and the pack. `/set wording off` skips the question and uses the calendar wording.

**Loading a month.** Fill `calendar/Fuadijan-Monthly-Template.xlsx` (sheets: Calendar, Columns, Templates, Slogans,
Read Me), save it as the month's workbook and run `npm run seed-calendar -- --file "calendar/December.xlsx"`. The
month of the first date names the plan (`2026-12`); it is added beside the running month, never over it, and
becomes the plan "Day N" refers to on its first date. Loading the same month again updates what changed and leaves
owner edits alone. The month view takes `?plan=2026-12` to look ahead.

**The slogan bank.** Keep several slogans per menu item and they are offered among the wordings whenever a post is
about that item. Load them with the monthly plan: a sheet named `Slogans` in the plan workbook, or the separate
`calendar/Fuadijan-Slogans.xlsx` (a template with a Read Me is in the repo), columns `Item | Slogan | Line | Caption`
(Line and Caption optional; a slogan without them borrows the calendar's). `npm run seed-calendar` loads both; the
same item + slogan is updated, never duplicated. Item `all` applies to every post. From Telegram:
`/slogan chapli kebab -- Hand-formed. Fire-finished. | Grilled over charcoal every evening.` adds one (`/` in the
headline breaks the line), `/slogan chapli kebab` lists them, `/slogan chapli kebab -- remove 2` forgets one. The
slogans for the item also reach Claude, so one of its alternatives may build on them.

## What arrives at post time

For a feed day: the rendered `feed.png` and `story.png` as files (carousels one PNG per page, reels a
`reel-cover.png`; the plain crops when nothing could be rendered), the caption block
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

## Rendered designs (Cut 2)

`brand/brand.json` holds the social palette (Night, Charcoal, Cream, Sand, Ember, Saffron), the fonts
(Instrument Serif for headlines, Inter for body, Playfair Display and DM Sans as fallbacks, all OFL TTFs in
`brand/fonts/`), the logo and the layout constants matched to the six approved Canva samples in `brand/reference/`.
Templates: `hero-photo` (layout A = plate cutout on Night with the text column left; layout B = full-bleed photo
with a Night gradient), `review`, `carousel`, `story`, `reel-cover`, `text-only`. The registry in
`src/render/registry.ts` maps every sheet `template` value to one of them; boot fails on an unmapped value, and
every template renders once at boot with sample data so a missing font fails loudly.

**The design is decided per photo**, not by a fixed recipe. The photo is measured (`src/images/analyze.ts`: a 4×4
grid of luminance and detail, the quietest zone, where the bright mass sits); the art director (Claude, with the
thumbnail and those numbers, `direct-design`) picks layout A or B, text top or bottom, left or right, band strength,
type scale and the crop focus, improving on a rule-based default (`src/pipeline/design.ts`); the legibility maths
(`src/render/legibility.ts`) raises the band until cream text over that zone reaches 5.5:1 and floors every type
size at what a 390 px phone can read; the owner's `/redo` note ("layout B", "text on the right", "text at the top",
"bigger text") overrides and locks fields, and `/set design …` gives standing notes. Then the critic
(`critique-design`, `CLAUDE_CRITIQUE_MODEL`, Sonnet by default) looks at the finished feed PNG at phone size and
scores it; under 7 its fixes are applied and the design is rendered once more, and the better of the two is kept.
**Five styles**, distilled from the owner's reference designs into the Fuadijan kit (`src/render/styles.ts`,
`styled.ts`, `compose-styles.ts`): **band** (the house look above, layout A or B, optionally with the first headline
line as an italic saffron lead-in), **split** (one giant word above the dish and one below), **poster** (Cream paper,
a huge stacked Night headline, the cut-out plate in front of the words, ember sparkles), **flat** (solid Ember, the
plate bleeding off the bottom, pill tags and an hours sticker) and **invite** (a Night panel, the photo fading off one
side, an italic lead-in, date, hours and address in columns). Poster and flat need a cutout, so they fall back to
band without one. The art director picks the style from the photo and the calendar template's preference
(`registry.ts`: snack-pack → flat, modern-fuadijan → poster, customer-favourite and bbq-feast → split,
new-product-reveal and weekend-feast → invite), the owner's note locks it (`/redo 5 poster`, `/redo 5 split, text on
the right`, "accent" / "no accent", "band style"), and the critic judges each style by its own rules. The style
also shapes the story (invite's story is the band story).

The pack's `design.json` and the Telegram line "🎨 Layout B · text bottom-left · type ×1.10 · …" say what was
decided and why. `DESIGN_CRITIQUE=0` turns the critic off.

**Custom designs** (web app, Create → New design): a one-off post outside the monthly plan. The flow asks for the
product (the menu plus every item in the wording bank), the series (the hero-photo templates: label and footer),
the title and writing (the product's wordings from the bank, the house ones, your own words, or let the agent
write it), the style (the art director's choice or one of the five, locked), feed and/or story with the date and
time, and the photo (a new upload or one already received, which keeps its crops and cut-out). It becomes a
calendar row in the running plan numbered from 101 (`type` custom, `custom` jsonb, `src/pipeline/custom.ts`), so
the ordinary pipeline, Day page, reminders, `/redo 101 …` and the Telegram pack all apply; the owner's wording is
used as given with no wording question, and only the formats asked for are kept. **Wordings** (Create → Wordings)
maintains the bank the Slogans sheet and `/slogan` feed: one product, many wordings (two headline lines, a line, a
caption), offered on every post about that product and in the Create flow.

`npm run render-samples` writes every template with the owner's real photos to `samples/out/`, next to the
matching reference, for approval. Snapshot tests (`test/render.test.ts`, `test/__snapshots__/*.png`) compare a
perceptual hash; delete a snapshot to re-record it after an intended change.

**Background removal** is segmentation, never generation: `BACKGROUND_REMOVER=u2netp` (default; U²-Net, 4.7 MB,
downloaded once into `data/models/` and checked against a pinned sha256), `isnet` (176 MB, sharper), `removebg`
(`REMOVE_BG_KEY`) or `none`. The cutout is taken from the whole photo, feathered, cleaned of stray islands, given a
drop shadow and an Ember glow; when the mask covers under 25 % or over 90 % of the frame, or Claude read the photo
as a scene or people, the design falls back to layout B. `@imgly/background-removal-node` was rejected because it
is AGPL-3.0.

## Layout

```
calendar/     xlsx.ts (reader) · calendar.schema.ts (clean-ups) · seed.ts
src/
  config.ts time.ts settings.ts files.ts context.ts
  db/         pool.ts migrate.ts migrations/*.sql
  calendar/   rows.ts (status, edits, push, skip) suggest.ts
  intake/     caption.ts
  images/     prep.ts (sharp: decode, HEIC, quality, crops) cutout.ts (segmentation, mask clean-up, shadow)
  render/     brand.ts templates.ts (satori) text.ts (fit) compose.ts (sharp) index.ts registry.ts
  menu/       source.ts menu-screens.ts index.ts (file, pos)
  brain/      client.ts (Claude + fixtures + claude_calls) prompts.ts schemas.ts
  pipeline/   stages.ts render-stage.ts worker.ts questions.ts packs.ts wording.ts design.ts custom.ts
  messaging/  telegram.ts commands.ts formats.ts messenger.ts email.ts (smtp2go + fallback)
  reminders/  index.ts brief.ts
  auth/       hubSession.ts
  api/        routes.ts
  server.ts main.ts dry-run.ts
web/          Vite + React: screens/Week.tsx Month.tsx Day.tsx Create.tsx Wordings.tsx, vendored frame kit (components/fj)
test/         vitest; fixtures/claude/*.json, fixtures/menu-screens.json
```

## What it will and won't do

Will: remind, read photos, crop, ask before anything uncertain, write the copy from the calendar and the menu,
hand over packs, track posted/skipped days. Won't: post, call Meta or Canva, invent a dish, price, side, review,
name or cooking claim, paint or relight a photo, or talk to any Telegram chat but the owner's.

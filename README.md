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
Read Me), save it as the month's workbook and load it on the Strategy page ("Load a month's workbook"), or run
`npm run seed-calendar -- --file "calendar/December.xlsx"` next to the database. The
month of the first date names the plan (`2026-12`); it is added beside the running month, never over it, and
becomes the plan "Day N" refers to on its first date. Loading the same month again updates what changed and leaves
owner edits alone. The month view takes `?plan=2026-12` to look ahead.

**Campaigns and the roster.** Two more sheets in the same workbook. `Campaigns` (CampaignID | Campaign Name |
Category | Series | Start Date | End Date | Status | Priority) records every launch, countdown or seasonal push;
several run at once, and a Calendar row joins one through its optional `campaign` column (the id or the name).
The Strategy page lists each campaign with its dates and how many of its posts are made and posted; the Day page
names the post's campaign. `Products` (ProductID | Product Name | Category | Status | Series) is the whole roster,
including what is not on the menu yet (active, coming soon, planned, retired): a roster product is offered in
Create and `/custom` with its series, so a launch can be posted about before the dish reaches the website, and a
row's `dish` may be a ProductID. Series are the hero-photo labels (FROM THE FIRE, FROM THE KARAHI, MODERN
FUADIJAN, ROOTED IN TRADITION, FRESH POUR, SAVE ROOM, FROM THE CHARCOAL SEA for seafood, FROM THE TAWA for
parathas). `npm run
template-workbook` brings the template's sheets, dropdowns and notes up to date with the code.

**The planning documents.** The owner's planning pack arrives as separate workbooks and each loads on its own:
campaigns with an objective (`CampaignID | CampaignName | Objective`), the product roster, customer benefits
(`Benefits` or `Customer Benefits`: `BenefitID | Benefit`), and an operational calendar laid out as `Day |
CampaignID | ProductID | BenefitID | Series | Format | Hook | Caption | CTA | Hashtags | Status`
(`calendar/layouts.ts`): Series picks the template, Format the slot, the Hook becomes the theme the writer
reads, the ids resolve against the tables, and without a `Date` column the first day is given on upload
(`--start` on the command line). A row's `benefit` reaches the writer as the one thing to say about an
improvement; `customerBenefits` in `brand/strategy.json` lists the topics never written about (renovations,
builders, equipment, furniture) and the customer message for each change. Series now also include WHAT WE ATE
TODAY, YOU SAID IT (reviews) and FOR OUR CUSTOMERS (benefit posts).

**One record, every platform.** A Calendar row may carry the whole post (`src/calendar/record.ts`, stored in
`calendar_rows.content`): Canva Headline and Subheading, Reel Cover Text, Hook, Instagram, Facebook and TikTok
versions, Story Sequence, Reel Shot List, AI Image Prompt, Customer Message, and internal notes (Platform, Content
Goal, Funnel Stage, KPI, Priority). What the owner wrote is used as written, including a headline that is not the
product's name and more than five hashtags; what is blank the writer drafts from the same facts when the photo
arrives, with no new claims. The Day page shows the set under "Every platform" and the pack adds `platforms.txt`.
`Day` may be a number or a weekday: a weekday is checked against the date, and a sheet with only dates finds each
post by its PostID, else by its date, so a partial sheet never lands on the wrong day (an unstarted post on that
date first). A record with a new PostID on a date that already has a post (a launch teaser, `POST-20261111-T`) is
added beside that post, never laid over it.
A sheet called `Operational Calendar` is read as the Calendar, ids may be hyphenated (`PRD-07`), and a product's
launch date and notes reach the writer, so an upcoming dish is never written up as on sale. The planning
sheets (Business Vision, Brand Positioning, Content Pillars, Annual Roadmap, 12-Week Roadmap, the hook, CTA, hashtag
and caption-template libraries, Field Guide, a Topic | Working Rule Read Me) are kept whole in `reference_sheets`
(`src/reference.ts`), shown on the Strategy page, and the parts that bear on a post reach the writer. `calendar/Fuadijan-Post-Record-Example.xlsx` is
a full example.

**Retiring the old plan.** `0011_retire_old_plan.sql` retired the first month's posts and the old strategy's wordings
when the planning documents arrived: `retired_at` takes a post out of every list, reminder and command and frees its
day number, and nothing is erased (rows, photos, designs and packs stay). The Strategy tab now reads only the planning
documents, the old plan can no longer be re-applied, and `brand/strategy.json` supplies only the voice rules once
they are loaded.

**A reel's clips and cover.** On a reel day's page, "Video for the reel" lists the clips received; the owner taps
them in the order they go in the reel (`calendar_rows.clips`, `POST /api/rows/:dayNo/clips`), and the reel pack lists
them. A clip is never kept: the web upload sends only its name and a still the browser takes about a second in
(`assets.still_file_id`, migration 0016; the CSP allows `media-src blob:` for this). Clips sent to the bot have no
still and show as ▶ with their name. The reel's cover is still made from a photo ("Photo for the cover"); a post day
picks photos only.

**Two photos in one design.** Two different dishes that look alike once cooked can share a design: on the Day page the
owner picks two received photos and names each (`calendar_rows.design_photos`, `src/render/pair.ts`). The feed shows
them side by side, the story and reel cover stacked, each with its dish's name on it and the words below, off the food.
The layout is fixed, so the art director and the critic are skipped. Picking one photo makes it the hero; a new photo
sent later clears the pick.

**Editing a finished post.** Every text on the Day page can be changed there, and a wording can be changed or added
(`src/pipeline/post-text.ts`). An edit goes on the row, into the job's copy, into the wording in use and straight into
the pack, with no writer run and no question. Only text printed on the design (headline, label, reel cover, a wording's
title and line) makes the designs again. The owner's record edits are logged as `content.<field>`, and loading a workbook
leaves those fields alone; the owner's wordings carry into the next writer run.

**The Captions tab.** (Called wordings in the code and the Telegram commands.) Every caption first, with the posts and
products it belongs to under it, and all of it editable (`src/wordings-view.ts`): reusable captions, every post's own
words and the benefit captions, then the hook, CTA and hashtag libraries by series, goal or tag group. A post keeps only
its words, so a library row's posts are found by matching its text. Captions and products are many to many
(`slogan_items`): every caption card can be linked to any products, or to a group of them (a category or a series), and
is offered only on the posts they reach, matched on whole words. Adding a product to a post's words or a hook saves them
as one reusable caption. Posts not yet posted follow a link at once; one using the caption keeps it. A reusable wording links to any number of items
(`slogan_items`), so one change reaches them all; taken off its last item it is kept as not linked. Moving a library row
is editing its series. An edited library row survives loading the same workbook again (`reference_sheets.owner_rows`).
Changing a reusable wording also reaches every post written but not yet posted that offers it (`spreadSloganEdit`): a
post using it follows, the pack at once and new designs only if the printed line changed. A post already posted, or a
wording the owner changed on the post, stays as it is.

**The karahi brand line.** A karahi post's footer reads only "ROOTED IN TRADITION.", before and after the charcoal launch
(`brandLineOn`, `isKarahiPost`).

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

**The step-by-step builder** (`web/src/components/PostBuilder.tsx`, used by Create → New design and by each day's
page through `DayBuilder.tsx`). A post is six named parts: series label, title and line under it (on the design), then
caption, call to action and hashtags (posted with it). A reel is series label, cover text and the text over the video,
then the same three. Each part is one step, numbered on a sketch of the design. Its dropdown lists the words that belong
to the product: the post's own (calendar and writer), the product's saved captions, the series' hooks, the CTA, hashtag
and benefit-caption libraries. "Write my own" and, in Create, "Let the agent write it" are also in the list, and the
chosen words can be edited. The Look step picks a style. For Invite it also sets the date shown, the time and the
message over the time (`calendar_rows.invite`, migration 0015), printed on the feed post and the story. "Preview on the
photo" (`POST /api/preview`, `src/pipeline/preview.ts`) draws the real design with those words, without Claude or the
cutout, and stores nothing. "Preview on a blank photo" draws it on a plain stand-in (also used when there is no photo yet), to show just where the words sit. On a day's page, saving sends only the changed parts (`POST /api/rows/:dayNo/parts`,
`setPostParts`), and the design is made again once. With nothing changed, the same button makes the design again
(`POST /api/rows/:dayNo/remake`) with an optional note for the art director. Carousels and reviews keep the full page.

**Custom designs** (web app, Create → New design): a one-off post outside the monthly plan. The flow asks for the
product (the menu plus every item in the wording bank), the series (the hero-photo templates: label and footer; the product's menu category suggests one, FRESH POUR for
drinks and SAVE ROOM for sweets),
the title and writing (the product's wordings from the bank, the house ones, your own words, or let the agent
write it), the style (the art director's choice or one of the five, locked), feed and/or story with the date and
time, and the photo (a new upload or one already received, which keeps its crops and cut-out); a reel makes only its
cover and pack, with the cover text and text cards the owner chose. It becomes a
calendar row in the running plan numbered from 101 (`type` custom, `custom` jsonb, `src/pipeline/custom.ts`), so
the ordinary pipeline, Day page, reminders, `/redo 101 …` and the Telegram pack all apply; the owner's wording is
used as given with no wording question, and only the formats asked for are kept. The title of a design is the
product's name by default and the wording (the owner's words, or a bank wording) is the line under it; the owner can
name a different title. From Telegram the same post is one line:
`/custom chapli kebab poster story tomorrow 7pm -- Hand-formed, fire-finished. | Grilled every evening.` A redo asks
which wording to use, and `/wording 101 -- Beef Seekh | Hand formed, special spices` sets the words directly.
(style, feed/story, date and time all optional; `-- 2` takes wording 2 from the bank; no `--` and the agent writes
it); the bot then offers the product's earlier photos as buttons or waits for a new one captioned `#day101`.
**Wordings** (Create → Wordings)
maintains the bank the Slogans sheet and `/slogan` feed: one product, many wordings (two headline lines, a line, a
caption), offered on every post about that product and in the Create flow.

**Strategy** (`brand/strategy.json`, web app → Strategy): the marketing strategy as data — positioning, voice rules
(do and never), taglines, signature dishes, audiences, caption patterns, hashtag sets, the weekly rituals (Karahi
Night on Wednesdays, Chapli Kebab Day on the first Friday, Student Night, Family Combo Weekends), the event year
with a poster concept each, the ten poster concepts and ten ready captions, the shot list and reel ideas, the KPI
list and the 30-day content plan. `src/strategy.ts` turns it into a brief for the copy writer (positioning, voice,
the day's ritual or running event, the hashtag sets to draw from) and for the art director (palette and visual
rules), and seeds the taglines, posters and captions into the wording bank at boot (source `strategy`, idempotent),
so every ritual and event is a product in Create → New design with its wording ready. `npm run strategy-workbook`
writes the 30-day plan as a plan workbook (`calendar/Fuadijan-Strategy-2026-11.xlsx`, same 18 columns plus a
Slogans sheet); `npm run seed-calendar -- --file <that file>` makes it the month's plan. Edit the JSON, never the
code, to change what the agent is told; bracketed offers and prices stay placeholders the agent asks about.

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

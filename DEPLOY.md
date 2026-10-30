# Deploying Fuadijan Social

Nothing here has been created yet. Every step is the owner's to run; the order matters because the hub
redirect, the cookie and the domain all have to agree before a browser can get in.

Cost: one Railway service (the always-on process) plus one Railway Postgres, roughly US$5–10 a month at this
size. Everything else is already paid for (GoDaddy domain, Vercel hub, Anthropic usage billed per call).

## 0. Before Railway: push the repo

1. Create the private GitHub repo `fuadijan/fuadijan-social` (empty, no README) and push `main`:

   ```bash
   git remote add origin git@github.com:fuadijan/fuadijan-social.git
   git push -u origin main
   ```

2. The calendar workbook is git-ignored on purpose. Railway seeds from a copy you upload once (step 4), or
   you run the seed from this PC against the Railway database.

## 1. Railway: Postgres

1. Railway → New Project → **Provision PostgreSQL** (its own project or the same project as the service; this
   app has its own database like every other Fuadijan app).
2. Copy its `DATABASE_URL` (the internal `postgres.railway.internal` one is fine for the service; use
   `DATABASE_PUBLIC_URL` only from this PC).

## 2. Railway: the service

1. In the same project → **New → GitHub Repo → fuadijan/fuadijan-social**, branch `main`. Railway reads
   `railway.json` (NIXPACKS installs with `npm ci` itself, build `npm run build:web`, start `npx tsx src/main.ts`,
   health check `/health`). `.node-version` pins Node 22.
2. **Variables** (Settings → Variables). Paste the block below and fill the blanks:

   ```
   TZ=Australia/Sydney
   PORT=3000
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DATA_DIR=/app/data
   CALENDAR_START=2026-11-03
   WEB_URL=https://social.nutrimeals.au
   RUN_TOKEN=<random, e.g. openssl rand -hex 24>

   HUB_URL=https://apps.nutrimeals.au
   HUB_COOKIE_DOMAIN=.nutrimeals.au
   NEXTAUTH_SECRET=<the hub's NEXTAUTH_SECRET, byte for byte>
   HUB_SESSION_MAX_HOURS=48

   TELEGRAM_BOT_TOKEN=<from BotFather>
   TELEGRAM_CHAT_ID=<your chat id; see step 5>

   ANTHROPIC_API_KEY=<console.anthropic.com>
   CLAUDE_MODEL=claude-opus-5-5

   MENU_SOURCE=menu-screens
   MENU_SCREENS_URL=https://fjtv.nutrimeals.au/api/menu

   BRIEF_TIME=08:30
   STORY_TIME=12:00
   NUDGE_TIME=21:30
   REVIEW_TIME=17:00

   BACKGROUND_REMOVER=u2netp
   MESSENGER=telegram
   SMTP2GO_API_KEY=<optional, the POS's key works>
   EMAIL_FROM=Fuadijan Social <social@nutrimeals.au>
   EMAIL_TO=<optional, your email for the fallback>
   ```

   `DEV_USER` must **not** be set in production. The app refuses to start on Railway until `HUB_COOKIE_DOMAIN`
   is set (so a half-configured deploy can never sit open on its Railway URL); the **first deploy therefore
   fails until the variables above are in**, which is expected. `NEXTAUTH_SECRET` is the one the hub uses on Vercel
   (Payroll, Analytics, Costing and Loan all carry the same value).
3. **Replicas: 1.** The Telegram bot long-polls; two copies would fight over updates.
4. Deploy. The first boot runs the migration, checks the menu source and renders every template once. The
   log should end with `Fuadijan Social listening on :3000 (hub mode, cookie domain .nutrimeals.au)`. The
   U²-Net model (4.7 MB) downloads into `/app/data/models` on the first photo; a redeploy fetches it again.

## 3. Domain

1. **Railway** → service → Settings → Networking → **Custom Domain** → `social.nutrimeals.au`. Railway shows
   a CNAME target like `xxxx.up.railway.app`.
2. **GoDaddy** → nutrimeals.au → DNS → **Add record**: Type `CNAME`, Name `social`, Value the Railway target,
   TTL 1 hour. Do not touch the apex (`@`) row.
3. Wait for Railway to show the certificate as issued (minutes to an hour). `https://social.nutrimeals.au/health`
   must answer `{"ok":true,"hub":true,...}`.

## 4. Seed the calendar

From this PC, against the Railway database (the public URL), once:

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" npm run seed-calendar
```

It prints the 30 rows and every `[bracketed]` placeholder. Re-running later never overwrites a field edited from
Telegram or the web app.

## 5. Telegram

1. BotFather → `/newbot` → name "Fuadijan Social", a username ending in `bot`. Copy the token into
   `TELEGRAM_BOT_TOKEN` and redeploy.
2. Send the bot any message. The Railway log prints `Telegram message from a chat that is not TELEGRAM_CHAT_ID:
   <id>`. Put that id in `TELEGRAM_CHAT_ID` and redeploy. From then on only that chat is obeyed.
3. Send `/status`, then `/set address …`, `/set hours …`, `/set website …` with the confirmed values.

## 6. The hub (fuadijan-hub, Vercel)

The uncommitted changes in `~/Documents/fuadijan-hub` add the `social` key, label and tile:

- `lib/apps.ts` — `"social"` in `APP_KEYS`, label `Social`.
- `app/page.tsx` — the tile (icon 📸, "Instagram calendar, packs, reminders"), URL from `APP_URL_SOCIAL`,
  fallback `https://social.nutrimeals.au`.
- `.env.local.example` — `APP_URL_SOCIAL` documented.

Review, commit and push them (`git diff` first). Then on Vercel set `APP_URL_SOCIAL=https://social.nutrimeals.au`
(optional, the fallback is the same) and grant the account:

```bash
cd ~/Documents/fuadijan-hub && npm run user -- grant <your hub email> social
```

Sign out and in again at the hub so the token carries the new grant; the 48-hour cap is already in place on both
sides.

## 7. The brand kit (fuadijan-brand)

`sync.py` has an uncommitted line `"social": vite_app("fuadijan-social/web")` so `python sync.py social` copies
the frame kit into this repo. Commit it there.

## 8. Checks after deploy

- `https://social.nutrimeals.au/` with no hub session → redirected to `apps.nutrimeals.au/login?callbackUrl=…`.
- Signed in at the hub → the Week screen. The tile on the hub opens it.
- `curl -X POST -H "Authorization: Bearer $RUN_TOKEN" https://social.nutrimeals.au/run/morning-brief` sends the
  brief to Telegram once (a second call is ignored for the day).
- Send the bot a photo with the caption `chapli kebab #day2` and watch the pack arrive.

## Running from the shop PC instead (no Railway)

`npm start` on the shop PC with the same `.env` works for Cut 1 and Cut 2 as long as the PC stays on; the web app
is then only reachable on the local network (`http://<pc>:3000`, `DEV_USER` mode, no hub). Move to Railway
before relying on the reminders.

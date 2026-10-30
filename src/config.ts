/**
 * Every setting the process reads from the environment, read once. `.env` is loaded here when present
 * (Node's own loader, so no dotenv). Secrets never leave this module as part of a log line.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (existsSync(resolve(process.cwd(), '.env'))) {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env'));
  } catch {
    // Already loaded, or unreadable: the explicit environment wins either way.
  }
}

const env = process.env;
/** A value still wearing the template's angle brackets ("<from BotFather>") counts as unset, not as a token. */
const isPlaceholder = (v: string) => /^<[^>]*>$/.test(v.trim());
const str = (k: string, d = ''): string => {
  const v = (env[k] ?? '').trim();
  return v === '' || isPlaceholder(v) ? d : v;
};
const num = (k: string, d: number): number => {
  const v = Number(env[k]);
  return Number.isFinite(v) && env[k] !== undefined && env[k] !== '' ? v : d;
};
const time = (k: string, d: string): string => {
  const v = str(k, d);
  if (!/^\d{2}:\d{2}$/.test(v)) throw new Error(`${k} must be HH:MM, got "${v}"`);
  return v;
};

export const TZ = 'Australia/Sydney';

export const config = {
  port: num('PORT', 3000),
  databaseUrl: str('DATABASE_URL', 'postgres://postgres@localhost:5433/fuadijan_social'),
  dataDir: resolve(process.cwd(), str('DATA_DIR', './data')),
  calendarStart: str('CALENDAR_START', '2026-11-03'),
  webUrl: str('WEB_URL', 'http://localhost:3000').replace(/\/$/, ''),
  runToken: str('RUN_TOKEN'),

  hub: {
    url: str('HUB_URL', 'https://apps.nutrimeals.au').replace(/\/$/, ''),
    cookieDomain: str('HUB_COOKIE_DOMAIN'),
    nextAuthSecret: str('NEXTAUTH_SECRET'),
    maxHours: num('HUB_SESSION_MAX_HOURS', 48),
    devUser: str('DEV_USER', 'Ahmad'),
    appKey: 'social',
  },

  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    chatId: str('TELEGRAM_CHAT_ID'),
  },

  claude: {
    apiKey: str('ANTHROPIC_API_KEY'),
    model: str('CLAUDE_MODEL', 'claude-opus-5-5'),
    fixtures: str('CLAUDE_FIXTURES') === '1',
    /** USD per million tokens, for the claude_calls cost column. */
    prices: {
      'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
      'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
    } as Record<string, { input: number; output: number; cacheRead: number }>,
  },

  menu: {
    source: str('MENU_SOURCE', 'menu-screens') as 'menu-screens' | 'pos' | 'file',
    menuScreensUrl: str('MENU_SCREENS_URL', 'https://fjtv.nutrimeals.au/api/menu'),
    file: resolve(process.cwd(), str('MENU_FILE', './data/menu.json')),
    posDatabaseUrl: str('POS_DATABASE_URL'),
  },

  times: {
    brief: time('BRIEF_TIME', '08:30'),
    story: time('STORY_TIME', '12:00'),
    nudge: time('NUDGE_TIME', '21:30'),
    review: time('REVIEW_TIME', '17:00'),
  },

  quality: {
    minLongEdge: num('MIN_LONG_EDGE', 1600),
    minLuminance: num('MIN_LUMINANCE', 45),
    minLaplacian: num('MIN_LAPLACIAN', 60),
  },

  messenger: str('MESSENGER', 'telegram') as 'telegram' | 'email',
  email: {
    apiKey: str('SMTP2GO_API_KEY'),
    from: str('EMAIL_FROM', 'Fuadijan Social <social@nutrimeals.au>'),
    to: str('EMAIL_TO'),
  },
};

export type Config = typeof config;

/** What the hub expects of the deployed app; when unset we are in local development. */
export const hubMode = Boolean(config.hub.cookieDomain);

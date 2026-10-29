/** What every part of the app shares: the pool, Claude, the menu, the channel to the owner, and a logger. */
import type pg from 'pg';
import type { ClaudeClient } from './brain/client.js';
import type { CachedMenu } from './menu/source.js';
import type { Messenger } from './messaging/messenger.js';

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export interface AppContext {
  pool: pg.Pool;
  claude: ClaudeClient;
  menu: CachedMenu;
  messenger: Messenger;
  log: Logger;
  /** Overridable clock, for tests and the dry run. */
  now: () => Date;
}

export const consoleLogger: Logger = {
  info: (m, e) => console.log(`[info] ${m}`, e ? JSON.stringify(e) : ''),
  warn: (m, e) => console.warn(`[warn] ${m}`, e ? JSON.stringify(e) : ''),
  error: (m, e) => console.error(`[error] ${m}`, e ? JSON.stringify(e) : ''),
};

/**
 * Boot: migrate → menu source check → template registry check → Telegram bot + cron + worker + Fastify.
 * One long-running process; the bot long-polls, so one instance only.
 */
import { config, hubMode } from './config.js';
import { claudeFromConfig } from './brain/client.js';
import { consoleLogger, type AppContext } from './context.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { cachedMenuFromConfig } from './menu/index.js';
import { ConsoleMessenger, type Messenger } from './messaging/messenger.js';
import { EmailMessenger, FallbackMessenger } from './messaging/email.js';
import { loadBrand } from './render/brand.js';
import { checkTemplates } from './render/index.js';
import { createBot, TelegramMessenger, wireBot } from './messaging/telegram.js';
import { Worker } from './pipeline/worker.js';
import { assertAllMapped } from './render/registry.js';
import { scheduleReminders } from './reminders/index.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const log = consoleLogger;
  const pool = createPool(config.databaseUrl);
  await migrate(pool, (m) => log.info(m));

  const templates = (await pool.query<{ template: string }>('select distinct template from calendar_rows')).rows.map((r) => r.template);
  assertAllMapped(templates);
  if (!templates.length) log.warn('calendar_rows is empty — run `npm run seed-calendar`.');

  const menu = cachedMenuFromConfig();
  try {
    const m = await menu.get();
    log.info(`Menu source ${m.source}: ${m.items.length} items.`);
  } catch (e) {
    log.warn(`Menu source unavailable at boot: ${e instanceof Error ? e.message : e}`);
  }

  // The brand kit and every template render once with sample data, so a missing font or token fails here.
  const brand = loadBrand();
  await checkTemplates(brand);
  log.info(`Brand kit "${brand.name}" v${brand.version}: fonts and templates OK.`);

  const claude = claudeFromConfig(pool);
  if (claude.kind === 'fixture') log.warn('Claude is answering from fixtures (no ANTHROPIC_API_KEY or CLAUDE_FIXTURES=1).');

  const bot = config.telegram.token ? createBot(config.telegram.token) : null;
  const email = config.email.apiKey && config.email.to ? new EmailMessenger(config.email.apiKey, config.email.from, config.email.to) : null;
  let messenger: Messenger;
  if (config.messenger === 'email' && email) messenger = email;
  else if (bot && config.telegram.chatId) messenger = new FallbackMessenger(new TelegramMessenger(bot, config.telegram.chatId, pool), email, (m) => log.warn(m));
  else messenger = new ConsoleMessenger();
  if (!bot) log.warn('TELEGRAM_BOT_TOKEN is not set — messages go to the console.');
  else if (!config.telegram.chatId) log.warn('TELEGRAM_CHAT_ID is not set — the bot will log the chat id of whoever messages it; outgoing messages go to the console until it is set.');
  if (email) log.info(`Email fallback to ${config.email.to} is ${config.messenger === 'email' ? 'the primary channel' : 'ready'}.`);

  const ctx: AppContext = { pool, claude, menu, messenger, log, now: () => new Date() };

  const worker = new Worker(ctx);
  worker.start();
  const reminders = scheduleReminders(ctx);

  if (bot) {
    wireBot(bot, ctx);
    bot.start({ onStart: (me) => log.info(`Telegram bot @${me.username} polling.`) }).catch((e) => log.error('Telegram polling stopped', { err: String(e) }));
  }

  const server = buildServer(ctx, { worker });
  await server.listen({ port: config.port, host: '0.0.0.0' });
  log.info(`Fuadijan Social listening on :${config.port} (${hubMode ? `hub mode, cookie domain ${config.hub.cookieDomain}` : `local, DEV_USER=${config.hub.devUser}`}).`);

  const shutdown = async () => {
    log.info('Shutting down…');
    reminders.stop();
    worker.stop();
    await bot?.stop().catch(() => {});
    await server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

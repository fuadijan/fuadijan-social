/**
 * The Telegram face of the agent (grammy, long polling). Only TELEGRAM_CHAT_ID is obeyed; every other chat gets
 * one "This bot is private." and a log line with its id (which is how the owner finds his own id on day one).
 */
import { Bot, InlineKeyboard, InputFile, type Context as GrammyContext } from 'grammy';
import type pg from 'pg';
import { config } from '../config.js';
import type { AppContext } from '../context.js';
import { handleCommand, handleFreeText, handleButton } from './commands.js';
import type { Button, Messenger } from './messenger.js';
import { PRIVATE_BOT } from './formats.js';
import { receiveAsset } from '../pipeline/worker.js';

const TELEGRAM_LIMIT = 4000;

export class TelegramMessenger implements Messenger {
  readonly name = 'telegram';
  constructor(private readonly bot: Bot, private readonly chatId: string, private readonly db: pg.Pool) {}

  async sendText(text: string, opts?: { buttons?: Button[]; questionId?: number }): Promise<{ messageId: number | null }> {
    const keyboard = opts?.buttons?.length ? opts.buttons.reduce((kb, b) => kb.text(b.label, b.key).row(), new InlineKeyboard()) : undefined;
    let last: number | null = null;
    for (const chunk of chunks(text)) {
      try {
        const m = await this.bot.api.sendMessage(this.chatId, chunk, { reply_markup: keyboard, link_preview_options: { is_disabled: true } });
        last = m.message_id;
        await this.log('out', 'text', chunk, m.message_id, true);
      } catch (err) {
        await this.log('out', 'text', chunk, null, false, String(err));
        throw err;
      }
    }
    return { messageId: last };
  }

  async sendDocument(bytes: Buffer, filename: string, caption?: string): Promise<{ messageId: number | null }> {
    try {
      const m = await this.bot.api.sendDocument(this.chatId, new InputFile(bytes, filename), { caption });
      await this.log('out', 'document', filename, m.message_id, true);
      return { messageId: m.message_id };
    } catch (err) {
      await this.log('out', 'document', filename, null, false, String(err));
      throw err;
    }
  }

  private async log(direction: 'in' | 'out', kind: string, text: string, messageId: number | null, ok: boolean, error?: string): Promise<void> {
    await this.db.query('insert into messages_log (direction, channel, chat_id, telegram_message_id, kind, text, ok, error) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [direction, 'telegram', this.chatId, messageId, kind, text.slice(0, 2000), ok, error ?? null]).catch(() => {});
  }
}

function chunks(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > TELEGRAM_LIMIT) {
    const cut = rest.lastIndexOf('\n', TELEGRAM_LIMIT);
    const at = cut > TELEGRAM_LIMIT / 2 ? cut : TELEGRAM_LIMIT;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  if (rest) out.push(rest);
  return out;
}

export function createBot(token: string): Bot {
  return new Bot(token);
}

/** Wires the handlers. `ctx.messenger` must already be the TelegramMessenger for the same bot. */
export function wireBot(bot: Bot, app: AppContext): void {
  const chatId = config.telegram.chatId;
  const strangers = new Set<string>();

  bot.use(async (c, next) => {
    const id = String(c.chat?.id ?? c.from?.id ?? '');
    if (id && id === chatId) return next();
    if (id && !strangers.has(id)) {
      strangers.add(id);
      app.log.warn(`Telegram message from a chat that is not TELEGRAM_CHAT_ID: ${id}`);
      await app.pool.query("insert into messages_log (direction, channel, chat_id, kind, text, ok) values ('in', 'telegram', $1, 'stranger', $2, false)", [id, c.message?.text?.slice(0, 200) ?? '']).catch(() => {});
      await c.reply(PRIVATE_BOT).catch(() => {});
    }
  });

  bot.on('callback_query:data', async (c) => {
    await c.answerCallbackQuery().catch(() => {});
    await logIn(app.pool, c, 'button', c.callbackQuery.data);
    await handleButton(app, c.callbackQuery.data);
  });

  bot.on('message:photo', async (c) => {
    const photo = c.message.photo.at(-1)!;
    const bytes = await download(bot, photo.file_id);
    await logIn(app.pool, c, 'photo', c.message.caption ?? '');
    await receiveAsset(app.pool, { kind: 'photo', bytes, mime: 'image/jpeg', filename: null, caption: c.message.caption ?? null, telegramFileId: photo.file_id, telegramMessageId: c.message.message_id });
  });

  bot.on('message:document', async (c) => {
    const doc = c.message.document;
    const mime = doc.mime_type ?? '';
    await logIn(app.pool, c, 'document', `${doc.file_name ?? ''} ${c.message.caption ?? ''}`);
    if (mime.startsWith('video/')) {
      await receiveAsset(app.pool, { kind: 'video', caption: c.message.caption ?? null, filename: doc.file_name, mime, telegramFileId: doc.file_id, telegramMessageId: c.message.message_id });
      return;
    }
    if (mime === 'text/plain' || /\.txt$/i.test(doc.file_name ?? '')) {
      const bytes = await download(bot, doc.file_id);
      await handleFreeText(app, bytes.toString('utf8'));
      return;
    }
    if ((doc.file_size ?? 0) > 20 * 1024 * 1024) {
      await c.reply('That file is over 20 MB, which the Bot API can\'t fetch. Send it as a photo, or a smaller export.');
      return;
    }
    const bytes = await download(bot, doc.file_id);
    await receiveAsset(app.pool, { kind: 'document', bytes, mime: mime || null, filename: doc.file_name ?? null, caption: c.message.caption ?? null, telegramFileId: doc.file_id, telegramMessageId: c.message.message_id });
  });

  bot.on(['message:video', 'message:video_note', 'message:animation'], async (c) => {
    const v = c.message.video ?? c.message.video_note ?? c.message.animation;
    await logIn(app.pool, c, 'video', c.message.caption ?? '');
    await receiveAsset(app.pool, { kind: 'video', caption: c.message.caption ?? null, mime: (v as { mime_type?: string } | undefined)?.mime_type ?? 'video/mp4', telegramFileId: v?.file_id ?? null, telegramMessageId: c.message.message_id });
  });

  bot.on('message:text', async (c) => {
    const text = c.message.text.trim();
    await logIn(app.pool, c, text.startsWith('/') ? 'command' : 'text', text);
    if (text.startsWith('/')) await handleCommand(app, text);
    else await handleFreeText(app, text);
  });

  bot.catch((err) => app.log.error('telegram handler failed', { err: String(err.error) }));
}

async function download(bot: Bot, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram returned no file path.');
  const res = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function logIn(db: pg.Pool, c: GrammyContext, kind: string, text: string): Promise<void> {
  await db.query('insert into messages_log (direction, channel, chat_id, telegram_message_id, kind, text) values ($1, $2, $3, $4, $5, $6)',
    ['in', 'telegram', String(c.chat?.id ?? ''), c.message?.message_id ?? null, kind, text.slice(0, 2000)]).catch(() => {});
}

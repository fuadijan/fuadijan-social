/**
 * The channel the owner talks to the agent through. Telegram is the one that ships; email (smtp2go) is the
 * fallback in Cut 2; the console one is for the dry run and tests.
 */
export interface Button { key: string; label: string }

export interface Messenger {
  readonly name: string;
  sendText(text: string, opts?: { buttons?: Button[]; questionId?: number }): Promise<{ messageId: number | null }>;
  /** A file the owner can save at full quality (Telegram "document", not "photo"). */
  sendDocument(bytes: Buffer, filename: string, caption?: string): Promise<{ messageId: number | null }>;
}

export class ConsoleMessenger implements Messenger {
  readonly name = 'console';
  readonly sent: { text?: string; file?: string; buttons?: Button[] }[] = [];
  constructor(private readonly print = true) {}
  async sendText(text: string, opts?: { buttons?: Button[] }) {
    this.sent.push({ text, buttons: opts?.buttons });
    if (this.print) {
      console.log(`\n──── message ────\n${text}`);
      if (opts?.buttons?.length) console.log(`[${opts.buttons.map((b) => b.label).join('] [')}]`);
    }
    return { messageId: null };
  }
  async sendDocument(bytes: Buffer, filename: string, caption?: string) {
    this.sent.push({ file: filename, text: caption });
    if (this.print) console.log(`\n──── file ──── ${filename} (${Math.round(bytes.length / 1024)} KB)${caption ? ` — ${caption}` : ''}`);
    return { messageId: null };
  }
}

/**
 * The email fallback: SMTP2GO in its Sydney data centre by plain HTTPS, the way the POS's receipts do it. Used
 * when MESSENGER=email, or by the FallbackMessenger when Telegram fails three times in a row. Buttons become a
 * numbered list the owner answers by replying on Telegram or in the web app; files go as attachments.
 */
import type { Button, Messenger } from './messenger.js';

export const SMTP2GO_AU_ENDPOINT = 'https://au-api.smtp2go.com/v3/email/send';
const TIMEOUT_MS = 10_000;

export interface OutgoingEmail {
  sender: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; mimetype: string; fileblob: string }[];
}

export type SendOutcome = { ok: true; providerId: string | null } | { ok: false; retry: boolean; reason: string };

export async function smtp2goSend(apiKey: string, email: OutgoingEmail, o: { endpoint?: string; fetch?: typeof fetch } = {}): Promise<SendOutcome> {
  const body = {
    sender: email.sender, to: [email.to], subject: email.subject, text_body: email.text, html_body: email.html,
    ...(email.attachments?.length ? { attachments: email.attachments } : {}),
  };
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(o.endpoint ?? SMTP2GO_AU_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Smtp2go-Api-Key': apiKey },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, retry: true, reason: 'Couldn’t reach the email service (SMTP2GO).' };
  }
  type Answer = { data?: { succeeded?: unknown; failed?: unknown; email_id?: unknown } } | null;
  let json: Answer = null;
  try {
    json = (await res.json()) as Answer;
  } catch {
    json = null;
  }
  if (res.status === 200) {
    if (Number(json?.data?.failed ?? 0) > 0) return { ok: false, retry: false, reason: 'The email service wouldn’t send to that address.' };
    const id = json?.data?.email_id;
    return { ok: true, providerId: typeof id === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(id) ? id : null };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, retry: false, reason: 'The email service didn’t accept SMTP2GO_API_KEY.' };
  if (res.status === 429) return { ok: false, retry: true, reason: 'The email service is busy just now.' };
  if (res.status >= 500) return { ok: false, retry: true, reason: `The email service isn’t answering properly (HTTP ${res.status}).` };
  return { ok: false, retry: false, reason: `The email service refused this email (HTTP ${res.status}).` };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class EmailMessenger implements Messenger {
  readonly name = 'email';
  constructor(private readonly apiKey: string, private readonly from: string, private readonly to: string, private readonly fetchFn: typeof fetch = fetch) {
    if (!apiKey || !to) throw new Error('Email needs SMTP2GO_API_KEY and EMAIL_TO.');
  }

  async sendText(text: string, opts?: { buttons?: Button[] }): Promise<{ messageId: number | null }> {
    const options = opts?.buttons?.length ? `\n\nOptions (answer on Telegram or in the web app):\n${opts.buttons.map((b, i) => `${i + 1}. ${b.label}`).join('\n')}` : '';
    const body = `${text}${options}`;
    const subject = `Fuadijan Social: ${text.split('\n')[0]!.slice(0, 70)}`;
    const out = await smtp2goSend(this.apiKey, { sender: this.from, to: this.to, subject, text: body, html: `<pre style="font: 14px/1.5 -apple-system, Segoe UI, sans-serif; white-space: pre-wrap">${escapeHtml(body)}</pre>` }, { fetch: this.fetchFn });
    if (!out.ok) throw new Error(out.reason);
    return { messageId: null };
  }

  async sendDocument(bytes: Buffer, filename: string, caption?: string): Promise<{ messageId: number | null }> {
    const mimetype = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    const out = await smtp2goSend(this.apiKey, {
      sender: this.from, to: this.to, subject: `Fuadijan Social: ${filename}`, text: caption ?? filename, html: `<p>${escapeHtml(caption ?? filename)}</p>`,
      attachments: [{ filename, mimetype, fileblob: bytes.toString('base64') }],
    }, { fetch: this.fetchFn });
    if (!out.ok) throw new Error(out.reason);
    return { messageId: null };
  }
}

/** Telegram first; after `threshold` consecutive failures everything goes to the fallback until Telegram works again. */
export class FallbackMessenger implements Messenger {
  readonly name: string;
  private failures = 0;
  constructor(private readonly primary: Messenger, private readonly fallback: Messenger | null, private readonly log: (m: string) => void, private readonly threshold = 3) {
    this.name = primary.name;
  }

  private async attempt<T>(fn: (m: Messenger) => Promise<T>): Promise<T> {
    if (this.fallback && this.failures >= this.threshold) {
      try {
        const r = await fn(this.primary);
        this.failures = 0;
        return r;
      } catch {
        return fn(this.fallback);
      }
    }
    try {
      const r = await fn(this.primary);
      this.failures = 0;
      return r;
    } catch (e) {
      this.failures++;
      this.log(`${this.primary.name} failed (${this.failures}): ${e instanceof Error ? e.message : e}`);
      if (this.fallback && this.failures >= this.threshold) {
        this.log(`switching to ${this.fallback.name} until ${this.primary.name} answers again`);
        return fn(this.fallback);
      }
      throw e;
    }
  }

  sendText(text: string, opts?: { buttons?: Button[]; questionId?: number }) {
    return this.attempt((m) => m.sendText(text, opts));
  }

  sendDocument(bytes: Buffer, filename: string, caption?: string) {
    return this.attempt((m) => m.sendDocument(bytes, filename, caption));
  }
}

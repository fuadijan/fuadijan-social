import { describe, expect, it } from 'vitest';
import { EmailMessenger, FallbackMessenger, smtp2goSend } from '../src/messaging/email.js';
import type { Messenger } from '../src/messaging/messenger.js';

const fetchWith = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('smtp2go', () => {
  it('reads outcomes the way the POS does', async () => {
    const email = { sender: 'a@b', to: 'c@d', subject: 's', text: 't', html: 'h' };
    expect(await smtp2goSend('k', email, { fetch: fetchWith(200, { data: { succeeded: 1, failed: 0, email_id: 'abc-1' } }) })).toEqual({ ok: true, providerId: 'abc-1' });
    expect(await smtp2goSend('k', email, { fetch: fetchWith(200, { data: { succeeded: 0, failed: 1 } }) })).toMatchObject({ ok: false, retry: false });
    expect(await smtp2goSend('k', email, { fetch: fetchWith(401, {}) })).toMatchObject({ ok: false, retry: false });
    expect(await smtp2goSend('k', email, { fetch: fetchWith(429, {}) })).toMatchObject({ ok: false, retry: true });
    expect(await smtp2goSend('k', email, { fetch: fetchWith(503, {}) })).toMatchObject({ ok: false, retry: true });
  });

  it('turns buttons into a numbered list and attaches files', async () => {
    const calls: unknown[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { succeeded: 1, failed: 0 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const m = new EmailMessenger('k', 'Fuadijan <s@x>', 'owner@x', f);
    await m.sendText('Which day?', { buttons: [{ key: 'a', label: 'Day 2' }, { key: 'b', label: 'Day 8' }] });
    await m.sendDocument(Buffer.from('png'), 'feed.png', 'Day 2');
    expect((calls[0] as { text_body: string }).text_body).toContain('1. Day 2\n2. Day 8');
    expect((calls[1] as { attachments: { filename: string; mimetype: string }[] }).attachments[0]).toMatchObject({ filename: 'feed.png', mimetype: 'image/png' });
  });
});

describe('fallback messenger', () => {
  const failing = (name: string, fail: boolean): Messenger & { sent: string[] } => {
    const sent: string[] = [];
    return {
      name, sent,
      async sendText(t: string) {
        if (fail) throw new Error('down');
        sent.push(t);
        return { messageId: null };
      },
      async sendDocument(_b: Buffer, n: string) {
        if (fail) throw new Error('down');
        sent.push(n);
        return { messageId: null };
      },
    };
  };

  it('switches to email after three Telegram failures', async () => {
    const tg = failing('telegram', true);
    const mail = failing('email', false);
    const logs: string[] = [];
    const fm = new FallbackMessenger(tg, mail, (m) => logs.push(m), 3);
    await expect(fm.sendText('one')).rejects.toThrow('down');
    await expect(fm.sendText('two')).rejects.toThrow('down');
    await fm.sendText('three'); // third failure → email
    await fm.sendText('four');
    expect(mail.sent).toEqual(['three', 'four']);
    expect(logs.some((l) => l.includes('switching to email'))).toBe(true);
  });

  it('without a fallback it just throws', async () => {
    const fm = new FallbackMessenger(failing('telegram', true), null, () => {}, 1);
    await expect(fm.sendText('x')).rejects.toThrow('down');
  });
});

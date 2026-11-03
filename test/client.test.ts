import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveClaude, MAX_OUTPUT_TOKENS } from '../src/brain/client.js';

/** A stand-in for the API, so the live client's request and its handling of a cut-off answer are tested without the network. */
describe('LiveClaude', () => {
  let server: Server;
  let reply: { text: string; stop_reason: string };
  let lastBody: { max_tokens?: number } = {};
  const baseUrl = process.env.ANTHROPIC_BASE_URL;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        lastBody = JSON.parse(body) as { max_tokens?: number };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: reply.text }], stop_reason: reply.stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (baseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = baseUrl;
    await new Promise((done) => server.close(done));
  });

  const ask = () => new LiveClaude(null, 'test-key', 'claude-opus-5-5').call({ purpose: 'resolve-copy', system: 's', user: 'u', schema: z.object({ caption: z.string() }) });

  it('leaves room for thinking and a long answer', async () => {
    reply = { text: '{"caption":"Lamb Karahi."}', stop_reason: 'end_turn' };
    await expect(ask()).resolves.toEqual({ caption: 'Lamb Karahi.' });
    expect(lastBody.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(16_000);
  });

  it('says plainly when an answer was cut off, without the JSON error', async () => {
    reply = { text: '{"caption":"Lamb Kar', stop_reason: 'max_tokens' };
    await expect(ask()).rejects.toThrow('The written copy was cut off before it finished.');
  });
});

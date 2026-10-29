/**
 * One door to Claude. `messages.parse` with a Zod output format, no forced tool_choice, thinking left adaptive,
 * server-side refusal fallback on, every call logged to claude_calls. `FixtureClaude` answers from
 * test/fixtures/claude/<purpose>-<case>.json for tests and the dry run; nothing in CI reaches the network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { Purpose } from './schemas.js';

export interface ImageInput { bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp' }

export interface CallInput<T> {
  purpose: Purpose;
  /** A key the fixture client matches on, e.g. "day2". */
  fixtureKey?: string;
  system: string;
  user: string;
  image?: ImageInput;
  schema: z.ZodType<T>;
  jobId?: number | null;
}

export interface ClaudeClient {
  readonly kind: 'live' | 'fixture';
  call<T>(input: CallInput<T>): Promise<T>;
}

function cost(model: string, input: number, output: number, cacheRead: number): number {
  const p = config.claude.prices[model] ?? config.claude.prices['claude-opus-5-5']!;
  return (input * p.input + output * p.output + cacheRead * p.cacheRead) / 1_000_000;
}

async function logCall(db: Db | null, row: { purpose: string; model: string; input?: number; output?: number; cacheRead?: number; latencyMs: number; ok: boolean; error?: string; jobId?: number | null }): Promise<void> {
  if (!db) return;
  await db.query(
    'insert into claude_calls (purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, latency_ms, ok, error, job_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [row.purpose, row.model, row.input ?? null, row.output ?? null, row.cacheRead ?? null, row.ok ? cost(row.model, row.input ?? 0, row.output ?? 0, row.cacheRead ?? 0) : null, row.latencyMs, row.ok, row.error ?? null, row.jobId ?? null],
  ).catch(() => {});
}

export class LiveClaude implements ClaudeClient {
  readonly kind = 'live';
  private readonly client: Anthropic;
  constructor(private readonly db: Db | null, apiKey = config.claude.apiKey, private readonly model = config.claude.model) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
    this.client = new Anthropic({ apiKey });
  }

  async call<T>(input: CallInput<T>): Promise<T> {
    const started = Date.now();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.image) {
      content.push({ type: 'image', source: { type: 'base64', media_type: input.image.mime, data: input.image.bytes.toString('base64') } });
    }
    content.push({ type: 'text', text: input.user });
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 4096,
        system: input.system,
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(input.schema) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Parameters<typeof this.client.beta.messages.parse>[0]);
      const usage = response.usage;
      if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.');
      const parsed = (response as { parsed_output?: T | null }).parsed_output;
      if (parsed == null) throw new Error('Claude answered without the expected structure.');
      await logCall(this.db, { purpose: input.purpose, model: response.model ?? this.model, input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens ?? 0, latencyMs: Date.now() - started, ok: true, jobId: input.jobId });
      return input.schema.parse(parsed);
    } catch (err) {
      await logCall(this.db, { purpose: input.purpose, model: this.model, latencyMs: Date.now() - started, ok: false, error: err instanceof Error ? err.message : String(err), jobId: input.jobId });
      throw err;
    }
  }
}

export const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'claude');

export class FixtureClaude implements ClaudeClient {
  readonly kind = 'fixture';
  constructor(private readonly db: Db | null = null, private readonly dir = FIXTURES_DIR) {}

  async call<T>(input: CallInput<T>): Promise<T> {
    const candidates = [input.fixtureKey ? `${input.purpose}-${input.fixtureKey}.json` : null, `${input.purpose}-default.json`].filter((x): x is string => Boolean(x));
    const files = new Set(readdirSync(this.dir));
    const file = candidates.find((c) => files.has(c));
    if (!file) throw new Error(`No Claude fixture for ${input.purpose} (${candidates.join(' or ')}) in ${this.dir}`);
    const json = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as unknown;
    await logCall(this.db, { purpose: input.purpose, model: 'fixture', input: 0, output: 0, cacheRead: 0, latencyMs: 0, ok: true, jobId: input.jobId });
    return input.schema.parse(json);
  }
}

export function claudeFromConfig(db: Db | null): ClaudeClient {
  if (config.claude.fixtures || !config.claude.apiKey) return new FixtureClaude(db);
  return new LiveClaude(db);
}

/** Claude spend this month (Sydney), for /status. */
export async function spendThisMonth(db: Db): Promise<{ calls: number; usd: number; failed: number }> {
  const r = (await db.query<{ calls: string; usd: string | null; failed: string }>(
    `select count(*) calls, coalesce(sum(cost_usd), 0) usd, count(*) filter (where not ok) failed from claude_calls
      where created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney'`)).rows[0]!;
  return { calls: Number(r.calls), usd: Number(r.usd ?? 0), failed: Number(r.failed) };
}

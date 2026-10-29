/**
 * Fastify: /health (public), POST /run/:job (bearer RUN_TOKEN), /api/* (hub session, same-origin only), and the
 * built web app from web/dist at / with an SPA fallback. Security headers as the POS store sets them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { config, hubMode } from './config.js';
import type { AppContext } from './context.js';
import { authenticate } from './auth/hubSession.js';
import { registerApi } from './api/routes.js';
import { REMINDERS, type ReminderJob } from './reminders/index.js';
import type { Worker } from './pipeline/worker.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * The CSP. The web app's index.html carries one inline script (the theme switch that runs before first paint), so
 * its hash is allowed; everything else loads from this origin. Fonts come from Google Fonts as in every other app.
 */
export function contentSecurityPolicy(inlineScriptHashes: string[]): string {
  const scripts = ["'self'", ...inlineScriptHashes.map((h) => `'sha256-${h}'`)].join(' ');
  return `default-src 'self'; script-src ${scripts}; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
}

/** sha256 (base64) of every inline <script> body in an HTML file, for the CSP. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => createHash('sha256').update(m[1]!).digest('base64'));
}

export interface ServerOptions {
  webDist?: string;
  worker?: Worker | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: { name: string; email: string | null; via: 'hub' | 'dev' } | null;
  }
}

export function buildServer(ctx: AppContext, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  const webDist = resolve(opts.webDist ?? join(process.cwd(), 'web', 'dist'));
  const hasWeb = existsSync(join(webDist, 'index.html'));
  const csp = contentSecurityPolicy(hasWeb ? inlineScriptHashes(readFileSync(join(webDist, 'index.html'), 'utf8')) : []);

  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    reply.header('content-security-policy', csp);
    return payload;
  });

  app.decorateRequest('user', null);
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

  app.get('/health', async () => ({ ok: true, hub: hubMode, claude: ctx.claude.kind, menu: ctx.menu.status().source }));

  app.post<{ Params: { job: string } }>('/run/:job', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (!config.runToken || auth !== `Bearer ${config.runToken}`) return reply.code(401).send({ ok: false, error: 'RUN_TOKEN required' });
    const job = req.params.job as ReminderJob;
    if (job === 'worker-tick') {
      const ran = await opts.worker?.tick();
      return { ok: true, ran: Boolean(ran) };
    }
    const fn = REMINDERS[job as Exclude<ReminderJob, 'worker-tick'>];
    if (!fn) return reply.code(404).send({ ok: false, error: `Unknown job. One of: ${[...Object.keys(REMINDERS), 'worker-tick'].join(', ')}` });
    await fn(ctx);
    return { ok: true };
  });

  // /api: hub session (or DEV_USER locally), same-origin only for anything that changes state.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/')) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.headers['sec-fetch-site'];
      const origin = req.headers.origin;
      const sameOrigin = (!site || site === 'same-origin' || site === 'none') && (!origin || origin === `${req.protocol}://${req.headers.host}` || origin === config.webUrl);
      if (!sameOrigin) return reply.code(403).send({ ok: false, error: 'Cross-origin requests are not accepted.' });
    }
    const auth = await authenticate(req.headers.cookie);
    if (auth.kind === 'ok') {
      req.user = auth.user;
      return;
    }
    if (auth.kind === 'denied') return reply.code(403).send({ ok: false, error: 'Not granted access to Social', hub: config.hub.url });
    return reply.code(401).send({ ok: false, error: 'Sign in at the hub', login: `${config.hub.url}/login` });
  });

  registerApi(app, ctx);

  // The web app. A page request without a hub session is redirected to the hub (never to a login page of our own).
  if (hasWeb) {
    const serveFile = (file: string) => {
      const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      return { type, cache, bytes: readFileSync(file) };
    };
    app.get<{ Params: { '*': string } }>('/*', async (req, reply) => {
      let rel: string;
      try {
        rel = decodeURIComponent(req.params['*'] ?? '');
      } catch {
        return reply.code(400).send();
      }
      if (rel.startsWith('api/')) return reply.code(404).send({ ok: false });
      const target = resolve(webDist, rel || 'index.html');
      if (target !== webDist && !target.startsWith(webDist + sep)) return reply.code(404).send();
      let file = target;
      const isPage = !existsSync(file) || statSync(file).isDirectory();
      if (isPage) {
        if (extname(rel)) return reply.code(404).send();
        file = join(webDist, 'index.html');
        const auth = await authenticate(req.headers.cookie);
        if (auth.kind !== 'ok') {
          const back = encodeURIComponent(`${config.webUrl}${req.url}`);
          return reply.redirect(auth.kind === 'denied' ? config.hub.url : `${config.hub.url}/login?callbackUrl=${back}`);
        }
      }
      const f = serveFile(file);
      reply.header('content-type', f.type).header('cache-control', f.cache);
      return reply.send(f.bytes);
    });
  } else {
    app.get('/', async (_req, reply) => {
      reply.header('content-type', 'text/html; charset=utf-8');
      return '<!doctype html><meta charset="utf-8"><title>Fuadijan Social</title><body style="font-family:system-ui;margin:32px"><h1>Fuadijan Social Agent</h1><p>The web app isn\'t built yet: <code>npm run build:web</code>.</p><p><a href="/health">/health</a></p>';
    });
  }

  return app;
}

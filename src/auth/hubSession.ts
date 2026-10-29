/**
 * Reads the hub's session cookie, as Payroll's server/middleware/hubSession.js does. NextAuth v4 issues a JWE
 * (alg "dir", enc A256GCM) whose key is HKDF-SHA256 of NEXTAUTH_SECRET with next-auth's literal info string.
 * Implemented with jose + @panva/hkdf (what next-auth uses internally) rather than next-auth itself; the test
 * mints tokens with the real next-auth encoder so an upstream change fails there, not in production.
 *
 * A valid session is not enough: the `apps` claim must include `social`, and the sign-in (`auth_time`, stamped
 * once by the hub) must be under HUB_SESSION_MAX_HOURS (48) old.
 */
import { hkdf } from '@panva/hkdf';
import { jwtDecrypt } from 'jose';
import { config, hubMode } from '../config.js';

const HKDF_INFO = 'NextAuth.js Generated Encryption Key';
export const APP_KEY = 'social';

export function cookieName(secure = hubMode || process.env.NODE_ENV === 'production'): string {
  return `${secure ? '__Secure-' : ''}next-auth.session-token`;
}

let cachedKey: Uint8Array | null = null;
let cachedFor: string | null = null;
async function derivedKey(secret: string): Promise<Uint8Array> {
  if (cachedKey && cachedFor === secret) return cachedKey;
  cachedKey = await hkdf('sha256', secret, '', HKDF_INFO, 32);
  cachedFor = secret;
  return cachedKey;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export interface HubClaims {
  name?: string;
  email?: string;
  sub?: string;
  apps?: unknown;
  auth_time?: unknown;
}

export function signedInRecently(claims: HubClaims | null, maxHours = config.hub.maxHours, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const t = claims?.auth_time;
  if (typeof t !== 'number' || !Number.isFinite(t)) return false;
  if (t > nowSeconds + 60) return false;
  return nowSeconds - t <= maxHours * 3600;
}

export function hasSocialGrant(claims: HubClaims | null): boolean {
  return Array.isArray(claims?.apps) && (claims!.apps as unknown[]).includes(APP_KEY);
}

/** Decrypts the token; null for anything malformed, expired, foreign, or signed in too long ago. */
export async function decodeHubToken(token: string, secret = config.hub.nextAuthSecret, maxHours = config.hub.maxHours): Promise<HubClaims | null> {
  if (!secret) return null;
  try {
    const { payload } = await jwtDecrypt(token, await derivedKey(secret), { clockTolerance: 15 });
    const claims = payload as HubClaims;
    return signedInRecently(claims, maxHours) ? claims : null;
  } catch {
    return null;
  }
}

export type AuthResult =
  | { kind: 'ok'; user: { name: string; email: string | null; via: 'hub' | 'dev' } }
  | { kind: 'anonymous' }
  | { kind: 'denied' };

/** The request's standing: signed in with the grant, signed in without it, or not at all. */
export async function authenticate(cookieHeader: string | undefined): Promise<AuthResult> {
  if (!hubMode) return { kind: 'ok', user: { name: config.hub.devUser, email: null, via: 'dev' } };
  if (!config.hub.nextAuthSecret) {
    console.error('HUB_COOKIE_DOMAIN is set but NEXTAUTH_SECRET is not — hub sessions cannot be read');
    return { kind: 'anonymous' };
  }
  const token = readCookie(cookieHeader, cookieName(true));
  if (!token) return { kind: 'anonymous' };
  const claims = await decodeHubToken(token);
  if (!claims) return { kind: 'anonymous' };
  if (!hasSocialGrant(claims)) return { kind: 'denied' };
  return { kind: 'ok', user: { name: claims.name ?? 'Owner', email: claims.email ?? null, via: 'hub' } };
}

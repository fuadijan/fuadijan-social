/**
 * Guards the one risky coupling: next-auth's HKDF info string. Tokens are minted with the REAL next-auth encoder
 * (a devDependency), so an upstream change fails here, not as "nobody can log in" in production.
 */
import { describe, expect, it } from 'vitest';
import { encode } from 'next-auth/jwt';
import { cookieName, decodeHubToken, hasSocialGrant, readCookie, signedInRecently } from '../src/auth/hubSession.js';

const SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const now = Math.floor(Date.now() / 1000);
const CLAIMS = { name: 'Ahmad', email: 'fuadijan@gmail.com', sub: '1', apps: ['payroll', 'social'], auth_time: now - 60 };

describe('hub session', () => {
  it('names the secure cookie as the hub does', () => {
    expect(cookieName(true)).toBe('__Secure-next-auth.session-token');
    expect(cookieName(false)).toBe('next-auth.session-token');
  });

  it('decodes a token produced by the real next-auth encoder', async () => {
    const token = await encode({ token: CLAIMS, secret: SECRET });
    const claims = await decodeHubToken(token, SECRET, 48);
    expect(claims?.email).toBe(CLAIMS.email);
    expect(hasSocialGrant(claims)).toBe(true);
  });

  it('rejects a token for another secret, a stale sign-in, and a missing grant', async () => {
    const token = await encode({ token: CLAIMS, secret: SECRET });
    expect(await decodeHubToken(token, 'another-secret', 48)).toBeNull();
    const old = await encode({ token: { ...CLAIMS, auth_time: now - 49 * 3600 }, secret: SECRET });
    expect(await decodeHubToken(old, SECRET, 48)).toBeNull();
    const fresh = await encode({ token: { ...CLAIMS, auth_time: now - 47 * 3600 }, secret: SECRET });
    expect(await decodeHubToken(fresh, SECRET, 48)).not.toBeNull();
    const noGrant = await encode({ token: { ...CLAIMS, apps: ['payroll'] }, secret: SECRET });
    expect(hasSocialGrant(await decodeHubToken(noGrant, SECRET, 48))).toBe(false);
  });

  it('applies the 48-hour cap and clock tolerance', () => {
    expect(signedInRecently({ auth_time: now - 10 }, 48, now)).toBe(true);
    expect(signedInRecently({ auth_time: now - 48 * 3600 - 1 }, 48, now)).toBe(false);
    expect(signedInRecently({ auth_time: now + 120 }, 48, now)).toBe(false);
    expect(signedInRecently({ auth_time: 'nope' }, 48, now)).toBe(false);
    expect(signedInRecently(null, 48, now)).toBe(false);
  });

  it('reads the cookie out of a header as a browser sends it', () => {
    const token = 'a.b.c%3D';
    expect(readCookie(`theme=dark; __Secure-next-auth.session-token=${token}; other=1`, '__Secure-next-auth.session-token')).toBe('a.b.c=');
    expect(readCookie(undefined, 'x')).toBeNull();
  });
});

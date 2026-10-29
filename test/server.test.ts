import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes } from '../src/server.js';

describe('content security policy', () => {
  it('allows only this origin plus the hash of each inline script', () => {
    const html = '<html><head><script>\n(function(){ try { x() } catch (e) {} })();\n</script><script src="/assets/a.js"></script></head></html>';
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const csp = contentSecurityPolicy(hashes);
    expect(csp).toContain(`script-src 'self' 'sha256-${hashes[0]}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy([])).toContain("script-src 'self';");
  });
});

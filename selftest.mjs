// Self-test of the security-critical parts: token, PKCE, slug.
// Run with: node selftest.mjs
import assert from 'node:assert';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Configure the environment BEFORE importing server.js (dynamic import)
process.env.SECRET = 'test-secret-key';
process.env.ADMIN_PASSWORD = 'pw';
process.env.ME = 'https://example.com';
process.env.POSTS_DIR = path.join(os.tmpdir(), 'presence-selftest-posts');

const { signToken, verifyToken, pkceS256, slugify, contextLine } = await import('./server.js');

// contextLine: IndieWeb post types
assert(contextLine('bookmark', 'https://x.com') === '🔖 Bookmark: [https://x.com](https://x.com)', 'bookmark');
assert(contextLine('like', 'https://y.com') === '👍 Liked: [https://y.com](https://y.com)', 'like');
assert(contextLine('food', '') === '**🍽 Eating**', 'food = header without URL');
assert(contextLine('note', 'ignored') === '', 'note = no prefix');
assert(contextLine('bookmark', '') === '', 'url-type without link = no prefix');

const now = Math.floor(Date.now() / 1000);

// Valid JWT roundtrips
const tok = signToken({ me: 'https://example.com', scope: 'create delete', exp: now + 100 });
const p = verifyToken(tok);
assert(p && p.me === 'https://example.com', 'valid token verified');
assert(p.scope === 'create delete', 'scope preserved');

// Tampered signature rejected
assert(verifyToken(tok.slice(0, -2) + 'xx') === null, 'tampered signature rejected');
assert(verifyToken('garbage') === null, 'garbage token rejected');

// Expired token rejected
assert(verifyToken(signToken({ me: 'x', exp: now - 1 })) === null, 'expired token rejected');

// Token forged with wrong secret rejected
const body = Buffer.from(JSON.stringify({ me: 'x', exp: now + 100 })).toString('base64url');
const badSig = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('base64url');
assert(verifyToken(`${body}.${badSig}`) === null, 'forged token rejected');

// PKCE S256: official RFC 7636 Appendix B test vector
assert(
  pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'PKCE S256 matches the RFC 7636 vector'
);

// slugify strips accents and unsafe characters
assert(slugify('Ciao Mondo àccénti') === 'ciao-mondo-accenti', 'slug strips accents');

console.log('OK: all self-tests passed');
process.exit(0);

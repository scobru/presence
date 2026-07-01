// Self-test della parte security-critica: token, PKCE, slug.
// Esegui con: node selftest.mjs
import assert from 'node:assert';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Configura l'ambiente PRIMA di importare server.js (import dinamico)
process.env.SECRET = 'test-secret-key';
process.env.ADMIN_PASSWORD = 'pw';
process.env.ME = 'https://example.com';
process.env.POSTS_DIR = path.join(os.tmpdir(), 'presence-selftest-posts');

const { signToken, verifyToken, pkceS256, slugify, contextLine } = await import('./server.js');

// contextLine: tipi di post IndieWeb
assert(contextLine('bookmark', 'https://x.com') === '🔖 Bookmark: [https://x.com](https://x.com)', 'bookmark');
assert(contextLine('like', 'https://y.com') === '👍 Like: [https://y.com](https://y.com)', 'like');
assert(contextLine('note', 'ignorato') === '', 'nota = nessun prefisso');
assert(contextLine('bookmark', '') === '', 'senza link = nessun prefisso');

const now = Math.floor(Date.now() / 1000);

// JWT valido fa roundtrip
const tok = signToken({ me: 'https://example.com', scope: 'create delete', exp: now + 100 });
const p = verifyToken(tok);
assert(p && p.me === 'https://example.com', 'token valido verificato');
assert(p.scope === 'create delete', 'scope preservato');

// Firma manomessa rifiutata
assert(verifyToken(tok.slice(0, -2) + 'xx') === null, 'firma manomessa rifiutata');
assert(verifyToken('garbage') === null, 'token spazzatura rifiutato');

// Token scaduto rifiutato
assert(verifyToken(signToken({ me: 'x', exp: now - 1 })) === null, 'token scaduto rifiutato');

// Token forgiato con segreto sbagliato rifiutato
const body = Buffer.from(JSON.stringify({ me: 'x', exp: now + 100 })).toString('base64url');
const badSig = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('base64url');
assert(verifyToken(`${body}.${badSig}`) === null, 'token forgiato rifiutato');

// PKCE S256: vettore di test ufficiale RFC 7636 Appendice B
assert(
  pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'PKCE S256 corrisponde al vettore RFC 7636'
);

// slugify rimuove accenti e caratteri non sicuri
assert(slugify('Ciao Mondo àccénti') === 'ciao-mondo-accenti', 'slug rimuove accenti');

console.log('OK: tutti i self-test passati');
process.exit(0);

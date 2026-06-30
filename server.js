import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const postsDir = process.env.POSTS_DIR || path.join(__dirname, 'posts');

// Identità del sito (valore `me` di IndieAuth) e segreto per firmare i token
const SITE_URL = (process.env.ME || 'https://presence.scobrudot.dev').replace(/\/+$/, '');
const SECRET = process.env.SECRET || process.env.INDIEAUTH_SECRET || '';
const AUTH_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 giorni

// Assicura che la cartella dei post esista
if (!fs.existsSync(postsDir)) {
  fs.mkdirSync(postsDir, { recursive: true });
}

// Serve i media caricati come file statici
app.use('/media', express.static(path.join(postsDir, 'media')));

// Helper per escapare HTML (titoli, tag, slug provengono da contenuto utente via Micropub)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Helper per compilare Markdown in HTML (sicuro e nativo)
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = '<p>' + html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  html = html.replace(/<p><h/g, '<h').replace(/<\/h(\d)><\/p>/g, '</h$1>');
  html = html.replace(/<p><pre>/g, '<pre>').replace(/<\/pre><\/p>/g, '</pre>');
  return html;
}

// Helper per leggere e ordinare tutti i post dal disco
function getSortedPosts() {
  if (!fs.existsSync(postsDir)) return [];
  const files = fs.readdirSync(postsDir);
  const posts = [];

  for (const file of files) {
    if (file.endsWith('.md')) {
      try {
        const filePath = path.join(postsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

        let title = '';
        let date = '';
        let tags = [];
        let bodyContent = content;

        if (frontMatterMatch) {
          const yaml = frontMatterMatch[1];
          bodyContent = frontMatterMatch[2];

          const lines = yaml.split('\n');
          let currentKey = '';
          for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line.startsWith('-')) {
              if (currentKey === 'tags') {
                tags.push(line.substring(1).trim().replace(/^["']|["']$/g, ''));
              }
            } else {
              const parts = line.split(':');
              const key = parts[0].trim();
              let val = parts.slice(1).join(':').trim();
              val = val.replace(/^["']|["']$/g, '');

              if (key === 'title') title = val;
              else if (key === 'date') date = val;
              else if (key === 'tags') currentKey = 'tags';
              else currentKey = '';
            }
          }
        }

        const basename = path.basename(file, '.md');
        const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
        const slug = dateMatch ? dateMatch[2] : basename;
        if (!date && dateMatch) date = dateMatch[1];

        posts.push({
          slug,
          filename: file,
          title: title || slug,
          date: date || new Date().toISOString(),
          tags,
          content: bodyContent.trim()
        });
      } catch (e) {
        console.error(`Errore nel parsing del file ${file}:`, e);
      }
    }
  }

  return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// 3. Homepage: mostra la lista dei post
app.get('/', (req, res) => {
  const posts = getSortedPosts();
  const postsHtml = posts.map(post => {
    const formattedDate = new Date(post.date).toLocaleDateString('it-IT', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const tagsHtml = post.tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join(' ');

    return `
      <article class="post-card">
        <header>
          <h2><a href="/posts/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
          <div class="meta">
            <time>${formattedDate}</time>
            ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
          </div>
        </header>
        <div class="post-preview">
          ${renderMarkdown(post.content.length > 250 ? post.content.substring(0, 250) + '...' : post.content)}
        </div>
        ${post.content.length > 250 ? `<a href="/posts/${encodeURIComponent(post.slug)}" class="read-more">Leggi tutto →</a>` : ''}
      </article>
    `;
  }).join('\n');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>presence — Blog</title>
    <link rel="authorization_endpoint" href="/auth">
    <link rel="token_endpoint" href="/token">
    <link rel="micropub" href="/micropub">
    <link rel="me" href="mailto:dev.scobru@pm.me">
    <link rel="microsub" href="https://aperture.p3k.io/microsub/1103">
    <style>
        body {
            background-color: #050505;
            color: #d8d8d8;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            line-height: 1.6;
            margin: 0;
            padding: 40px 20px;
        }
        .container {
            max-width: 650px;
            margin: 0 auto;
        }
        header.main-header {
            margin-bottom: 50px;
            border-bottom: 1px solid #1a1a1a;
            padding-bottom: 25px;
        }
        h1 {
            font-size: 1.5rem;
            color: #ffffff;
            margin: 0 0 10px 0;
            letter-spacing: -0.5px;
        }
        .status {
            display: inline-flex;
            align-items: center;
            font-size: 0.75rem;
            color: #00ff66;
            background-color: rgba(0, 255, 102, 0.04);
            border: 1px solid rgba(0, 255, 102, 0.2);
            padding: 4px 10px;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .status-dot {
            width: 5px;
            height: 5px;
            background-color: #00ff66;
            border-radius: 50%;
            margin-right: 8px;
            box-shadow: 0 0 6px #00ff66;
        }
        .post-card {
            border: 1px solid #141414;
            background-color: #0a0a0a;
            padding: 25px;
            border-radius: 4px;
            margin-bottom: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        .post-card h2 {
            font-size: 1.15rem;
            margin-top: 0;
            margin-bottom: 8px;
        }
        .post-card h2 a {
            color: #ffffff;
            text-decoration: none;
        }
        .post-card h2 a:hover {
            text-decoration: underline;
        }
        .meta {
            font-size: 0.8rem;
            color: #666666;
            margin-bottom: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tag {
            color: #888888;
            margin-left: 8px;
        }
        .post-preview {
            font-size: 0.9rem;
            color: #b0b0b0;
        }
        .read-more {
            font-size: 0.85rem;
            color: #ffffff;
            text-decoration: underline;
            display: inline-block;
            margin-top: 10px;
        }
        .read-more:hover {
            background-color: #ffffff;
            color: #000000;
            text-decoration: none;
        }
        footer {
            margin-top: 60px;
            border-top: 1px dashed #1a1a1a;
            padding-top: 20px;
            font-size: 0.75rem;
            color: #444444;
            text-align: center;
        }
    </style>
</head>
<body>
    <!-- Microformats2 h-card per le informazioni del profilo IndieAuth -->
    <div class="h-card" style="display: none;">
        <a class="p-name u-url" href="https://presence.scobrudot.dev/">scobru</a>
        <img class="u-photo" src="https://avatars.githubusercontent.com/u/1079164?v=4" alt="scobru">
        <a class="u-email" href="mailto:dev.scobru@pm.me">dev.scobru@pm.me</a>
    </div>
    <div class="container">
        <header class="main-header">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h1>presence — Blog</h1>
                <div class="status"><span class="status-dot"></span>VPS Online</div>
            </div>
            <p style="color: #888888; font-size: 0.85rem; margin: 0;">
                Sito personale di <a href="https://scobru.it" style="color: #ffffff;">scobru.it</a>.
            </p>
        </header>

        <main>
            ${postsHtml || '<p style="color: #555555; text-align: center; padding: 40px 0;">Nessun post pubblicato ancora.</p>'}
        </main>

        <footer>
            // running stateful on node.js
        </footer>
    </div>
</body>
</html>`);
});

// 4. Pagina singolo post
app.get('/posts/:slug', (req, res) => {
  const { slug } = req.params;
  const posts = getSortedPosts();
  const post = posts.find(p => p.slug === slug);

  if (!post) {
    return res.status(404).send('Post non trovato.');
  }

  const formattedDate = new Date(post.date).toLocaleDateString('it-IT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const tagsHtml = post.tags.map(tag => `<span class="tag">#${tag}</span>`).join(' ');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(post.title)} — presence</title>
    <link rel="authorization_endpoint" href="/auth">
    <link rel="token_endpoint" href="/token">
    <link rel="micropub" href="/micropub">
    <link rel="me" href="https://github.com/scobru">
    <link rel="me" href="mailto:dev.scobru@pm.me">
    <style>
        body {
            background-color: #050505;
            color: #d8d8d8;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            line-height: 1.6;
            margin: 0;
            padding: 40px 20px;
        }
        .container {
            max-width: 650px;
            margin: 0 auto;
        }
        .back-link {
            font-size: 0.85rem;
            color: #888888;
            text-decoration: none;
            display: inline-block;
            margin-bottom: 30px;
        }
        .back-link:hover {
            color: #ffffff;
            text-decoration: underline;
        }
        h1 {
            font-size: 1.4rem;
            color: #ffffff;
            margin-top: 0;
            margin-bottom: 10px;
            letter-spacing: -0.5px;
            line-height: 1.3;
        }
        .meta {
            font-size: 0.8rem;
            color: #666666;
            margin-bottom: 30px;
            border-bottom: 1px solid #1a1a1a;
            padding-bottom: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tag {
            color: #888888;
            margin-left: 8px;
        }
        .content {
            font-size: 0.95rem;
            color: #c0c0c0;
        }
        .content h2 {
            font-size: 1.15rem;
            color: #ffffff;
            margin-top: 30px;
        }
        .content h3 {
            font-size: 1rem;
            color: #ffffff;
            margin-top: 25px;
        }
        .content p {
            margin-bottom: 20px;
        }
        .content code {
            background-color: #121212;
            padding: 2px 6px;
            border-radius: 3px;
            color: #e0e0e0;
            font-size: 0.85rem;
            border: 1px solid #222222;
        }
        .content pre {
            background-color: #0a0a0a;
            border: 1px solid #141414;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .content pre code {
            background-color: transparent;
            padding: 0;
            border: none;
            font-size: 0.85rem;
        }
        footer {
            margin-top: 60px;
            border-top: 1px dashed #1a1a1a;
            padding-top: 20px;
            font-size: 0.75rem;
            color: #444444;
            text-align: center;
        }
    </style>
</head>
<body>
    <!-- Microformats2 h-card per le informazioni del profilo IndieAuth -->
    <div class="h-card" style="display: none;">
        <a class="p-name u-url" href="https://presence.scobrudot.dev/">scobru</a>
        <img class="u-photo" src="https://avatars.githubusercontent.com/u/1079164?v=4" alt="scobru">
        <a class="u-email" href="mailto:dev.scobru@pm.me">dev.scobru@pm.me</a>
    </div>
    <div class="container">
        <a href="/" class="back-link">← Torna alla homepage</a>
        
        <article>
            <header>
                <h1>${escapeHtml(post.title)}</h1>
                <div class="meta">
                    <time>${formattedDate}</time>
                    ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
                </div>
            </header>
            
            <div class="content">
                ${renderMarkdown(post.content)}
            </div>
        </article>

        <footer>
            // post renderizzato da presence-frontend
        </footer>
    </div>
</body>
</html>`);
});

// 5. Admin UI: lista post + cancellazione. Protetta da Basic Auth.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Admin UI disabilitata: imposta ADMIN_PASSWORD nelle variabili d\'ambiente.');
  }
  const auth = req.headers.authorization || '';
  const [user, pass] = auth.startsWith('Basic ')
    ? Buffer.from(auth.slice(6), 'base64').toString().split(':')
    : [];
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="presence admin"');
    return res.status(401).send('Autenticazione richiesta.');
  }
  next();
}

app.use('/admin', express.urlencoded({ extended: false }));

app.get('/admin', requireAdminAuth, (req, res) => {
  const posts = getSortedPosts();
  const rowsHtml = posts.map(post => `
    <tr>
      <td><a href="/posts/${encodeURIComponent(post.slug)}" target="_blank">${escapeHtml(post.title)}</a></td>
      <td>${escapeHtml(post.date)}</td>
      <td>
        <form method="POST" action="/admin/posts/${encodeURIComponent(post.filename)}/delete" onsubmit="return confirm('Cancellare questo post?');">
          <button type="submit">Cancella</button>
        </form>
      </td>
    </tr>`).join('\n');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Admin — presence</title>
    <style>
        body { background: #050505; color: #d8d8d8; font-family: ui-monospace, monospace; padding: 30px; max-width: 800px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; }
        td, th { border-bottom: 1px solid #222; padding: 8px; text-align: left; }
        button { background: #300; color: #fff; border: 1px solid #500; padding: 4px 10px; cursor: pointer; }
        a { color: #6cf; }
        form.new-post { display: flex; flex-direction: column; gap: 10px; margin-bottom: 40px; }
        form.new-post input, form.new-post textarea {
            background: #0a0a0a; color: #d8d8d8; border: 1px solid #222; padding: 10px;
            font-family: inherit; font-size: 0.9rem; border-radius: 3px;
        }
        form.new-post button { background: #030; border-color: #050; align-self: flex-start; padding: 8px 18px; }
    </style>
</head>
<body>
    <h1>Nuovo post</h1>
    <form class="new-post" method="POST" action="/admin/posts">
        <input name="title" placeholder="Titolo" required>
        <input name="tags" placeholder="tag separati da virgola (es: web, indieweb)">
        <textarea name="content" rows="10" placeholder="Contenuto (Markdown)" required></textarea>
        <button type="submit">Pubblica</button>
    </form>

    <h1>Post pubblicati (${posts.length})</h1>
    <table>
        <tr><th>Titolo</th><th>Data</th><th></th></tr>
        ${rowsHtml || '<tr><td colspan="3">Nessun post.</td></tr>'}
    </table>
</body>
</html>`);
});

// Genera uno slug sicuro per il filesystem da un titolo
export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Scrive un post su disco come file Markdown con frontmatter.
// Usato sia dalla UI /admin sia dall'endpoint Micropub.
// Ritorna { slug, url } o lancia un Error con .status.
export function writePost({ title, body, tags = [] }) {
  title = (title || '').trim();
  body = (body || '').trim();
  tags = tags.map(t => String(t).trim()).filter(Boolean);

  if (!body) {
    const e = new Error('Il contenuto è obbligatorio.');
    e.status = 400;
    throw e;
  }

  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  // Una nota senza titolo (es. da client Micropub) usa il timestamp come slug
  const slug = slugify(title) || String(now.getTime());
  const filename = `${datePart}-${slug}.md`;
  const filePath = path.join(postsDir, filename);

  if (fs.existsSync(filePath)) {
    const e = new Error('Esiste già un post con questo slug per oggi.');
    e.status = 409;
    throw e;
  }

  // Rimuove le virgolette doppie: il parser frontmatter in getSortedPosts è semplice
  const titleYaml = title ? `title: "${title.replace(/"/g, '')}"\n` : '';
  const tagsYaml = tags.length
    ? 'tags:\n' + tags.map(t => `  - "${t.replace(/"/g, '')}"`).join('\n') + '\n'
    : '';
  const frontmatter = `---\n${titleYaml}date: ${now.toISOString()}\n${tagsYaml}---\n`;

  fs.writeFileSync(filePath, frontmatter + body + '\n');
  return { slug, url: `${SITE_URL}/posts/${slug}` };
}

// Cancella un post dato il suo URL pubblico (es. https://site/posts/slug)
function deletePostByUrl(url) {
  let slug;
  try {
    slug = decodeURIComponent(new URL(url).pathname.replace(/^\/posts\//, '').replace(/\/$/, ''));
  } catch {
    return false;
  }
  const post = getSortedPosts().find(p => p.slug === slug);
  if (!post) return false;

  const filePath = path.join(postsDir, post.filename);
  if (path.dirname(filePath) !== path.resolve(postsDir) || !fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

app.post('/admin/posts', requireAdminAuth, (req, res) => {
  const tags = (req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  try {
    writePost({ title: req.body.title, body: req.body.content, tags });
    res.redirect('/admin');
  } catch (e) {
    res.status(e.status || 500).send(e.message);
  }
});

app.post('/admin/posts/:filename/delete', requireAdminAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(postsDir, filename);

  if (!filename.endsWith('.md') || path.dirname(filePath) !== path.resolve(postsDir) || !fs.existsSync(filePath)) {
    return res.status(404).send('Post non trovato.');
  }

  fs.unlinkSync(filePath);
  res.redirect('/admin');
});

// ============================================================
// IndieAuth (authorization + token endpoint) e Micropub nativi
// Spec: https://indieauth.spec.indieweb.org/ e https://www.w3.org/TR/micropub/
// ============================================================

// --- Helper crittografici ---
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Access token = JWT firmato HMAC-SHA256, stateless (nessun DB richiesto)
export function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function pkceS256(verifier) {
  return b64url(crypto.createHash('sha256').update(String(verifier)).digest());
}

function timingEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Codici di autorizzazione: vita breve (10 min), uso singolo, in memoria.
// ponytail: Map in memoria — se il container riavvia durante il login, rifai l'accesso.
// Per single-user va bene; se serve multi-istanza, sposta su store condiviso.
const authCodes = new Map();

function hasScope(token, scope) {
  const scopes = String(token?.scope || '').split(/\s+/).filter(Boolean);
  if (scopes.includes(scope)) return true;
  if (scope === 'create' && scopes.includes('post')) return true; // alias legacy
  return false;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.body && req.body.access_token) return req.body.access_token;
  return null;
}

function requireConfigured(req, res, next) {
  if (!SECRET || !AUTH_PASSWORD) {
    return res.status(503).json({ error: 'service_unavailable', error_description: 'Imposta SECRET e ADMIN_PASSWORD per abilitare IndieAuth/Micropub.' });
  }
  next();
}

app.use(['/auth', '/token', '/micropub'], express.urlencoded({ extended: false }), express.json(), requireConfigured);

// --- Authorization endpoint: pagina di consenso ---
app.get('/auth', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, me } = req.query;

  if (!client_id || !redirect_uri || !code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).send('Richiesta di autorizzazione non valida (richiesto client_id, redirect_uri, code_challenge, code_challenge_method=S256).');
  }

  const hidden = { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope: scope || '', me: me || SITE_URL };
  const hiddenHtml = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n');
  const scopeList = String(scope || '').split(/\s+/).filter(Boolean);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><title>Autorizza — presence</title>
<style>
  body { background:#050505; color:#d8d8d8; font-family:ui-monospace,monospace; max-width:420px; margin:60px auto; padding:0 20px; }
  .box { border:1px solid #222; background:#0a0a0a; padding:25px; border-radius:6px; }
  h1 { font-size:1.3rem; color:#fff; }
  code { color:#6cf; word-break:break-all; }
  ul { padding-left:18px; } li { margin-bottom:4px; }
  input[type=password] { width:100%; box-sizing:border-box; background:#050505; color:#fff; border:1px solid #333; padding:10px; margin:12px 0; border-radius:4px; }
  button { background:#06c; color:#fff; border:0; padding:10px 20px; border-radius:4px; cursor:pointer; width:100%; font-size:1rem; }
</style></head><body><div class="box">
  <h1>Autorizza applicazione</h1>
  <p><code>${escapeHtml(client_id)}</code> chiede accesso a <code>${escapeHtml(hidden.me)}</code></p>
  ${scopeList.length ? `<p>Permessi:</p><ul>${scopeList.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '<p>Solo autenticazione (nessun permesso di scrittura).</p>'}
  <form method="POST" action="/auth">
    ${hiddenHtml}
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Consenti</button>
  </form>
</div></body></html>`);
});

// --- Authorization endpoint: approvazione → emette il codice ---
app.post('/auth', (req, res) => {
  const { password, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.body;

  if (!timingEqual(password || '', AUTH_PASSWORD)) {
    return res.status(401).send('Password errata.');
  }
  if (!client_id || !redirect_uri || !code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).send('Parametri di autorizzazione mancanti.');
  }

  const code = b64url(crypto.randomBytes(32));
  authCodes.set(code, {
    client_id, redirect_uri, code_challenge,
    scope: scope || '',
    me: SITE_URL,
    exp: Date.now() + 10 * 60 * 1000
  });

  const sep = redirect_uri.includes('?') ? '&' : '?';
  const qs = `code=${encodeURIComponent(code)}` + (state ? `&state=${encodeURIComponent(state)}` : '');
  res.redirect(`${redirect_uri}${sep}${qs}`);
});

// Scambia un codice di autorizzazione verificando la PKCE. Ritorna i dati o null.
function redeemCode({ code, client_id, redirect_uri, code_verifier }) {
  const data = authCodes.get(code);
  if (!data) return null;
  authCodes.delete(code); // uso singolo
  if (data.exp < Date.now()) return null;
  if (data.client_id !== client_id || data.redirect_uri !== redirect_uri) return null;
  if (!timingEqual(pkceS256(code_verifier || ''), data.code_challenge)) return null;
  return data;
}

// --- Token endpoint: scambia codice → access token ---
app.post('/token', (req, res) => {
  const { grant_type, code, client_id, redirect_uri, code_verifier } = req.body;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const data = redeemCode({ code, client_id, redirect_uri, code_verifier });
  if (!data) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const now = Math.floor(Date.now() / 1000);
  const access_token = signToken({ me: data.me, scope: data.scope, client_id, iat: now, exp: now + TOKEN_TTL });
  res.json({ access_token, token_type: 'Bearer', scope: data.scope, me: data.me });
});

// --- Token endpoint: verifica token (usato da alcuni client) ---
app.get('/token', (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  res.json({ me: token.me, client_id: token.client_id, scope: token.scope });
});

// --- Micropub: normalizza create da form-encoded o JSON (mf2) ---
function parseMicropubCreate(body) {
  if (body.type) {
    const p = body.properties || {};
    const first = v => (Array.isArray(v) ? v[0] : v);
    let content = first(p.content);
    if (content && typeof content === 'object') content = content.html || content.value || '';
    return {
      title: first(p.name) || '',
      body: String(content || ''),
      tags: [].concat(p.category || []).filter(Boolean)
    };
  }
  return {
    title: body.name || '',
    body: String(body.content || ''),
    tags: [].concat(body.category || body['category[]'] || []).filter(Boolean)
  };
}

// --- Micropub: query (q=config / source / syndicate-to) ---
app.get('/micropub', (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  switch (req.query.q) {
    case 'config':
      return res.json({ 'media-endpoint': null, 'syndicate-to': [] });
    case 'syndicate-to':
      return res.json({ 'syndicate-to': [] });
    case 'source': {
      const post = getSortedPosts().find(p => `${SITE_URL}/posts/${p.slug}` === req.query.url);
      if (!post) return res.status(404).json({ error: 'not_found' });
      return res.json({
        type: ['h-entry'],
        properties: {
          name: [post.title],
          content: [post.content],
          ...(post.tags.length ? { category: post.tags } : {})
        }
      });
    }
    default:
      return res.json({});
  }
});

// --- Micropub: create / delete ---
app.post('/micropub', (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const action = req.body.action || 'create';

  try {
    if (action === 'create') {
      if (!hasScope(token, 'create')) {
        return res.status(403).json({ error: 'insufficient_scope', scope: 'create' });
      }
      const { url } = writePost(parseMicropubCreate(req.body));
      res.setHeader('Location', url);
      return res.status(201).end();
    }

    if (action === 'delete') {
      if (!hasScope(token, 'delete')) {
        return res.status(403).json({ error: 'insufficient_scope', scope: 'delete' });
      }
      const ok = deletePostByUrl(req.body.url);
      return ok ? res.status(204).end() : res.status(404).json({ error: 'not_found' });
    }

    // update / undelete non implementati: i post sono file Markdown, si modificano da /admin
    return res.status(501).json({ error: 'not_implemented', error_description: `Azione '${action}' non supportata.` });
  } catch (e) {
    return res.status(e.status || 500).json({ error: 'invalid_request', error_description: e.message });
  }
});

// Avvia il server solo se eseguito direttamente (non in import, es. dai test)
if (process.argv[1] === __filename) {
  app.listen(PORT, () => {
    if (!SECRET || !AUTH_PASSWORD) {
      console.warn('ATTENZIONE: SECRET o ADMIN_PASSWORD non impostati — IndieAuth/Micropub e /admin restano disabilitati.');
    }
    console.log(`Server unificato presence attivo sulla porta ${PORT}`);
    console.log(`Cartella sorgente post impostata su: ${postsDir}`);
  });
}

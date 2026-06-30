import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Avvio del backend Indiekit sulla porta interna 3001
console.log('Avvio di Indiekit sulla porta interna 3001...');
const indiekitProcess = spawn('npx', ['indiekit', 'server'], {
  env: { ...process.env, PORT: '3001' },
  stdio: 'inherit',
  shell: true
});

indiekitProcess.on('error', (err) => {
  console.error('Errore nel caricamento del processo Indiekit:', err);
});

const app = express();
const PORT = process.env.PORT || 3000;
const postsDir = process.env.POSTS_DIR || path.join(__dirname, 'posts');
const indiekitUrl = 'http://localhost:3001';

// Assicura che la cartella dei post esista
if (!fs.existsSync(postsDir)) {
  fs.mkdirSync(postsDir, { recursive: true });
}

// 1. Configura la cartella dei media come statica.
// Se un file viene cercato e non esiste fisicamente, passerà al middleware successivo (il proxy a Indiekit).
app.use('/media', express.static(path.join(postsDir, 'media'), {
  fallthrough: true
}));

// 2. Middleware di Proxy per le rotte destinate ad Indiekit
app.use((req, res, next) => {
  const path = req.path;
  const isIndiekitRoute = 
    path.startsWith('/auth') || 
    path.startsWith('/token') || 
    path.startsWith('/micropub') || 
    path.startsWith('/media') || 
    path.startsWith('/assets') ||
    (path === '/' && req.query.q !== undefined);

  if (isIndiekitRoute) {
    // Riscrive e inoltra la richiesta a Indiekit su porta 3001
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: req.url,
      method: req.method,
      headers: req.headers
    };

    // Sovrascrive l'host header con quello originale
    options.headers['host'] = req.headers.host;

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    req.pipe(proxyReq, { end: true });

    proxyReq.on('error', (err) => {
      console.error('Errore proxy verso Indiekit:', err);
      res.status(502).send('Il server di pubblicazione Indiekit è temporaneamente non disponibile.');
    });
  } else {
    next();
  }
});

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

    const tagsHtml = post.tags.map(tag => `<span class="tag">#${tag}</span>`).join(' ');

    return `
      <article class="post-card">
        <header>
          <h2><a href="/posts/${post.slug}">${post.title}</a></h2>
          <div class="meta">
            <time>${formattedDate}</time>
            ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
          </div>
        </header>
        <div class="post-preview">
          ${renderMarkdown(post.content.length > 250 ? post.content.substring(0, 250) + '...' : post.content)}
        </div>
        ${post.content.length > 250 ? `<a href="/posts/${post.slug}" class="read-more">Leggi tutto →</a>` : ''}
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
        .endpoints {
            font-size: 0.75rem;
            color: #555555;
            background-color: #080808;
            border: 1px solid #121212;
            padding: 10px;
            border-radius: 4px;
            margin-top: 20px;
            text-align: left;
        }
        .endpoints code {
            display: block;
            margin-bottom: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="main-header">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h1>presence — Blog</h1>
                <div class="status"><span class="status-dot"></span>VPS Online</div>
            </div>
            <p style="color: #888888; font-size: 0.85rem; margin: 0;">
                Sito personale di <a href="https://scobru.it" style="color: #ffffff;">scobru.it</a>. 
                I post sono pubblicati tramite Indiekit (Micropub).
            </p>
        </header>

        <main>
            ${postsHtml || '<p style="color: #555555; text-align: center; padding: 40px 0;">Nessun post pubblicato ancora. Usa un client Micropub per iniziare.</p>'}
        </main>

        <div class="endpoints">
            <code><strong>IndieAuth Auth Endpoint:</strong> /auth</code>
            <code><strong>IndieAuth Token Endpoint:</strong> /token</code>
            <code><strong>Micropub Endpoint:</strong> /micropub</code>
        </div>

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
    <title>${post.title} — presence</title>
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
    <div class="container">
        <a href="/" class="back-link">← Torna alla homepage</a>
        
        <article>
            <header>
                <h1>${post.title}</h1>
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

app.listen(PORT, () => {
  console.log(`Server unificato presence attivo sulla porta ${PORT}`);
  console.log(`Cartella sorgente post impostata su: ${postsDir}`);
});

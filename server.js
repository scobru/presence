import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const postsDir = process.env.POSTS_DIR || path.join(__dirname, 'posts');
const mediaDir = path.join(postsDir, 'media');

// Site identity (IndieAuth `me` value) and secret to sign tokens
const SITE_URL = (process.env.ME || 'https://presence.scobrudot.dev').replace(/\/+$/, '');
const SECRET = process.env.SECRET || process.env.INDIEAUTH_SECRET || '';
const AUTH_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

// Site name and description (shown on homepage). Configurable via env.
const SITE_NAME = process.env.SITE_NAME || 'presence';
const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || '';

// Light mode: enabled when <html data-theme="light">. The initial theme follows
// the OS (or the saved choice) via THEME_UI; the 🌓 button toggles and persists it.
const LIGHT_CSS = `
html[data-theme="light"] body { background-color: #fbfbfb !important; color: #1f1f1f !important; }
html[data-theme="light"] .post-card, html[data-theme="light"] .box { background-color: #ffffff !important; border-color: #e5e5e5 !important; box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important; }
html[data-theme="light"] h1, html[data-theme="light"] h2 a, html[data-theme="light"] .post-card h2 a, html[data-theme="light"] .content h2, html[data-theme="light"] .content h3 { color: #111111 !important; }
html[data-theme="light"] a { color: #0066cc !important; }
html[data-theme="light"] .meta, html[data-theme="light"] .tag, html[data-theme="light"] footer { color: #777777 !important; }
html[data-theme="light"] .content, html[data-theme="light"] .post-preview { color: #333333 !important; }
html[data-theme="light"] .content code { background: #f0f0f0 !important; color: #c7254e !important; border-color: #e0e0e0 !important; }
html[data-theme="light"] .content pre { background: #f6f6f6 !important; border-color: #e5e5e5 !important; }
html[data-theme="light"] input, html[data-theme="light"] textarea, html[data-theme="light"] select { background-color: #ffffff !important; color: #222222 !important; border-color: #cccccc !important; }
html[data-theme="light"] table td, html[data-theme="light"] table th { border-color: #e5e5e5 !important; }
html[data-theme="light"] button, html[data-theme="light"] a.btn { background: #eee !important; color: #111 !important; border-color: #ccc !important; }
html[data-theme="light"] button.danger { background: #fdd !important; border-color: #f99 !important; color: #900 !important; }
html[data-theme="light"] header.main-header { border-color: #e5e5e5 !important; }
html[data-theme="light"] .theme-toggle { color: #333 !important; border-color: #ccc !important; }`;

// Theme toggle button + inline init (avoids flash: reads the saved choice or the OS).
const THEME_UI = `
<button class="theme-toggle" title="Toggle theme" aria-label="Toggle theme" onclick="(function(d){var n=d.getAttribute('data-theme')==='light'?'dark':'light';d.setAttribute('data-theme',n);localStorage.setItem('theme',n)})(document.documentElement)" style="position:fixed;top:12px;right:12px;z-index:10;background:transparent;border:1px solid #444;color:#aaa;border-radius:6px;padding:6px 9px;cursor:pointer;font-size:1rem;line-height:1">🌓</button>
<script>(function(){try{var t=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t)}catch(e){}})()</script>`;

// Mastodon syndication (optional): active only if both variables are present
const MASTODON_URL = (process.env.MASTODON_URL || '').replace(/\/+$/, '');
const MASTODON_TOKEN = process.env.MASTODON_ACCESS_TOKEN || '';
const MASTODON_USER = process.env.MASTODON_USER || '';

// IndieWeb post types — single source for composer, rendering and homepage filter.
// url:true → requires a reference URL; verb = phrase shown at the top of the post;
// lead:true → type without URL but with a dedicated header line (food/drink).
const POST_TYPES = {
  note:     { label: 'Note',     emoji: '📝', url: false, prop: null,           verb: '' },
  article:  { label: 'Article',  emoji: '📄', url: false, prop: null,           verb: '' },
  bookmark: { label: 'Bookmark', emoji: '🔖', url: true,  prop: 'bookmark-of',  verb: 'Bookmark:' },
  reply:    { label: 'Reply',    emoji: '↩',  url: true,  prop: 'in-reply-to',  verb: 'In reply to' },
  rsvp:     { label: 'RSVP',     emoji: '📅', url: true,  prop: 'in-reply-to',  verb: 'Attending' },
  repost:   { label: 'Repost',   emoji: '🔁', url: true,  prop: 'repost-of',    verb: 'Shared from' },
  like:     { label: 'Like',     emoji: '👍', url: true,  prop: 'like-of',      verb: 'Liked:' },
  checkin:  { label: 'Check-in', emoji: '📍', url: true,  prop: 'checkin',      verb: 'At' },
  photo:    { label: 'Photo',    emoji: '📷', url: false, prop: null,           verb: '' },
  listen:   { label: 'Listen',   emoji: '🎧', url: true,  prop: 'listen-of',    verb: 'Listening to' },
  food:     { label: 'Food',     emoji: '🍽', url: false, prop: null,           verb: 'Eating', lead: true },
  drink:    { label: 'Drink',    emoji: '🥤', url: false, prop: null,           verb: 'Drinking', lead: true }
};

// Ensure directories exist
fs.mkdirSync(mediaDir, { recursive: true });

// Serve uploaded media as static files
app.use('/media', express.static(mediaDir));

// Serve favicon
app.get('/favicon.png', (req, res) => {
  res.type('image/jpeg'); // favicon.png is actually JPEG-encoded
  res.sendFile(path.join(__dirname, 'favicon.png'));
});

// Upload media to disk: media/{yyyy}/{mm}/{timestamp}-{slug}.{ext}
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const d = new Date();
      const dir = path.join(mediaDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = slugify(path.parse(file.originalname).name) || 'file';
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${safe}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// Public URL of a file uploaded by multer
function mediaUrlFor(file) {
  const rel = path.relative(mediaDir, file.path).split(path.sep).join('/');
  return `${SITE_URL}/media/${rel}`;
}

// Helper to escape HTML (titles, tags, slugs come from user content via Micropub)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Helper to compile Markdown to HTML (safe and native)
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
  // Images before links (image syntax contains the link syntax)
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px">');
  html = html.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  html = '<p>' + html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  html = html.replace(/<p><h/g, '<h').replace(/<\/h(\d)><\/p>/g, '</h$1>');
  html = html.replace(/<p><pre>/g, '<pre>').replace(/<\/pre><\/p>/g, '</pre>');
  return html;
}

// Helper to read and sort all posts from disk
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
        let type = 'note';
        let tags = [];
        let mastodonId = '';
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
              else if (key === 'type') type = val || 'note';
              else if (key === 'mastodon_id') mastodonId = val;
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
          type,
          tags,
          mastodonId,
          content: bodyContent.trim()
        });
      } catch (e) {
        console.error(`Error parsing file ${file}:`, e);
      }
    }
  }

  return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// 3. Homepage: show the list of posts
app.get('/', (req, res) => {
  const filterType = POST_TYPES[req.query.type] ? req.query.type : '';
  const posts = getSortedPosts().filter(p => !filterType || p.type === filterType);

  const postsHtml = posts.map(post => {
    const formattedDate = new Date(post.date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const tagsHtml = post.tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join(' ');
    const badge = POST_TYPES[post.type] ? `${POST_TYPES[post.type].emoji} ` : '';

    return `
      <article class="post-card">
        <header>
          <h2><a href="/posts/${encodeURIComponent(post.slug)}">${badge}${escapeHtml(post.title)}</a></h2>
          <div class="meta">
            <time>${formattedDate}</time>
            ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
          </div>
        </header>
        <div class="post-preview">
          ${renderMarkdown(post.content.length > 250 ? post.content.substring(0, 250) + '...' : post.content)}
        </div>
        ${post.content.length > 250 ? `<a href="/posts/${encodeURIComponent(post.slug)}" class="read-more">Read more →</a>` : ''}
      </article>
    `;
  }).join('\n');

  const filterOptions = ['<option value="">All types</option>']
    .concat(Object.entries(POST_TYPES).map(([k, t]) =>
      `<option value="${k}"${k === filterType ? ' selected' : ''}>${t.emoji} ${t.label}</option>`))
    .join('');
  const filterBar = `<div class="filter-bar">
    <select onchange="location.href = this.value ? '/?type=' + this.value : '/'">${filterOptions}</select>
  </div>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <link rel="icon" type="image/png" href="/favicon.png">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(SITE_NAME)}</title>
    <link rel="authorization_endpoint" href="/auth">
    
    <link rel="token_endpoint" href="/token">
    <link rel="micropub" href="/micropub">
    <link rel="me" href="mailto:dev.scobru@pm.me">
    <link rel="microsub" href="https://aperture.p3k.io/microsub/1103">
    <style>
        body {
            background-color: #050505;
            color: #d8d8d8;
            font-family: 'Inter', 'Roboto', system-ui, -apple-system, sans-serif;
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
            color: #888888;
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
        .filter-bar { margin-bottom: 30px; }
        .filter-bar select {
            appearance: none; -webkit-appearance: none; cursor: pointer;
            background-color: #0a0a0a; color: #d8d8d8; border: 1px solid #1a1a1a; border-radius: 4px;
            padding: 8px 34px 8px 12px; font-family: inherit; font-size: 0.8rem;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%2300ff66' d='M2 4l4 4 4-4z'/></svg>");
            background-repeat: no-repeat; background-position: right 12px center;
        }
        .filter-bar select:focus { outline: none; border-color: #00ff66; }
        ${LIGHT_CSS}
    </style>
</head>
<body>
    ${THEME_UI}
    <!-- Microformats2 h-card for IndieAuth profile information -->
    <div class="h-card" style="display: none;">
        <a class="p-name u-url" href="${SITE_URL}/">scobru</a>
        <img class="u-photo" src="https://avatars.githubusercontent.com/u/1079164?v=4" alt="scobru">
        <a class="u-email" href="mailto:dev.scobru@pm.me">dev.scobru@pm.me</a>
    </div>
    <div class="container">
        <header class="main-header">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h1 style="display: flex; align-items: center; gap: 10px;"><img src="/favicon.png" alt="" width="32" height="32" style="border-radius: 6px;">${escapeHtml(SITE_NAME)}</h1>
            </div>
            ${SITE_DESCRIPTION ? `<p style="color: #888888; font-size: 0.85rem; margin: 0;">${escapeHtml(SITE_DESCRIPTION)}</p>` : ''}
        </header>

        ${filterBar}

        <main>
            ${postsHtml || '<p style="color: #555555; text-align: center; padding: 40px 0;">No posts published yet.</p>'}
        </main>

        <footer>
            <a href="https://github.com/scobru/presence" target="_blank" rel="noopener">github.com/scobru/presence</a>
        </footer>
    </div>
</body>
</html>`);
});

// 4. Single post page
app.get('/posts/:slug', (req, res) => {
  const { slug } = req.params;
  const posts = getSortedPosts();
  const post = posts.find(p => p.slug === slug);

  if (!post) {
    return res.status(404).send('Post not found.');
  }

  const formattedDate = new Date(post.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const tagsHtml = post.tags.map(tag => `<span class="tag">#${tag}</span>`).join(' ');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <link rel="icon" type="image/png" href="/favicon.png">
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
            font-family: 'Inter', 'Roboto', system-ui, -apple-system, sans-serif;
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
            color: #888888;
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
        ${LIGHT_CSS}
    </style>
</head>
<body>
    ${THEME_UI}
    <!-- Microformats2 h-card for IndieAuth profile information -->
    <div class="h-card" style="display: none;">
        <a class="p-name u-url" href="https://presence.scobrudot.dev/">scobru</a>
        <img class="u-photo" src="https://avatars.githubusercontent.com/u/1079164?v=4" alt="scobru">
        <a class="u-email" href="mailto:dev.scobru@pm.me">dev.scobru@pm.me</a>
    </div>
    <div class="container">
        <a href="/" class="back-link">← Back to homepage</a>
        
        <article>
            <header>
                <h1>${POST_TYPES[post.type] ? POST_TYPES[post.type].emoji + ' ' : ''}${escapeHtml(post.title)}</h1>
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
            // post rendered by presence-frontend
        </footer>
    </div>
</body>
</html>`);
});

// 5. Admin UI: post list + deletion. Protected by Basic Auth.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';

function requireAdminAuth(req, res, next) {
  if (!AUTH_PASSWORD && !AUTH_PASSWORD_HASH) {
    return res.status(503).send('Admin UI disabled: set ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) in the environment variables.');
  }
  const auth = req.headers.authorization || '';
  const [user, pass] = auth.startsWith('Basic ')
    ? Buffer.from(auth.slice(6), 'base64').toString().split(':')
    : [];
  if (user !== ADMIN_USER || !checkAdminPassword(pass)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="presence admin"');
    return res.status(401).send('Authentication required.');
  }
  next();
}

app.use('/admin', express.urlencoded({ extended: false }));

const ADMIN_STYLE = `
        body { background: #050505; color: #d8d8d8; font-family: 'Inter', 'Roboto', system-ui, -apple-system, sans-serif; padding: 30px; max-width: 800px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; }
        td, th { border-bottom: 1px solid #222; padding: 8px; text-align: left; vertical-align: top; }
        .tag { color: #888; }
        .actions { display: flex; gap: 8px; }
        button, a.btn { background: #222; color: #fff; border: 1px solid #444; padding: 4px 10px; cursor: pointer; text-decoration: none; font: inherit; border-radius: 3px; }
        button.danger { background: #300; border-color: #500; }
        a { color: #6cf; }
        form.post-form { display: flex; flex-direction: column; gap: 10px; margin-bottom: 40px; }
        form.post-form input, form.post-form textarea, form.post-form select {
            background: #0a0a0a; color: #d8d8d8; border: 1px solid #222; padding: 10px;
            font-family: inherit; font-size: 0.9rem; border-radius: 3px;
        }
        form.post-form select {
            appearance: none; -webkit-appearance: none; cursor: pointer; padding-right: 34px;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%236cf' d='M2 4l4 4 4-4z'/></svg>");
            background-repeat: no-repeat; background-position: right 12px center;
        }
        form.post-form select:focus, form.post-form input:focus, form.post-form textarea:focus { outline: none; border-color: #6cf; }
        form.post-form button[type=submit] { background: #030; border-color: #050; align-self: flex-start; padding: 8px 18px; }
        .filter-bar { margin: 20px 0; }
        .filter-bar select {
            appearance: none; -webkit-appearance: none; cursor: pointer;
            background: #0a0a0a; color: #d8d8d8; border: 1px solid #222; border-radius: 4px;
            padding: 8px 34px 8px 12px; font-family: inherit; font-size: 0.85rem;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%2300ff66' d='M2 4l4 4 4-4z'/></svg>");
            background-repeat: no-repeat; background-position: right 12px center;
        }
        ${LIGHT_CSS}`;

// Generates the type selector <option> elements from POST_TYPES
function typeOptions(selected) {
  return Object.entries(POST_TYPES)
    .map(([k, t]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${t.emoji} ${t.label}</option>`)
    .join('');
}

app.get('/admin', requireAdminAuth, (req, res) => {
  const posts = getSortedPosts();
  const rowsHtml = posts.map(post => `
    <tr>
      <td><a href="/posts/${encodeURIComponent(post.slug)}" target="_blank">${escapeHtml(post.title)}</a></td>
      <td>${escapeHtml(String(post.date).slice(0, 10))}</td>
      <td class="tag">${post.tags.map(t => '#' + escapeHtml(t)).join(' ')}</td>
      <td>
        <div class="actions">
          <a class="btn" href="/admin/posts/${encodeURIComponent(post.filename)}/edit">Edit</a>
          <form method="POST" action="/admin/posts/${encodeURIComponent(post.filename)}/delete" onsubmit="return confirm('Delete this post?');">
            <button class="danger" type="submit">Delete</button>
          </form>
        </div>
      </td>
    </tr>`).join('\n');

  const syndNote = (MASTODON_URL && MASTODON_TOKEN)
    ? `<p style="color:#6a6;">Mastodon syndication active → ${escapeHtml(MASTODON_USER || MASTODON_URL)}</p>`
    : '<p style="color:#666;">Mastodon syndication not configured.</p>';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <link rel="icon" type="image/png" href="/favicon.png">
    <meta charset="UTF-8">
    <title>Admin — presence</title>
    <style>${ADMIN_STYLE}</style>
</head>
<body>
    ${THEME_UI}
    <h1>New post</h1>
    ${syndNote}
    <form class="post-form" method="POST" action="/admin/posts" enctype="multipart/form-data">
        <select name="ptype">${typeOptions('note')}</select>
        <input name="link" placeholder="URL (per bookmark / reply / like / repost / listen / check-in)">
        <input name="title" placeholder="Title">
        <input name="tags" placeholder="comma-separated tags (e.g., web, indieweb)">
        <textarea name="content" rows="10" placeholder="Content (Markdown)"></textarea>
        <input type="file" name="photo" accept="image/*" multiple>
        ${(MASTODON_URL && MASTODON_TOKEN) ? '<label style="display:flex;align-items:center;gap:8px;color:#aaa;"><input type="checkbox" name="syndicate" value="1" checked style="width:auto;"> Post to Mastodon</label>' : ''}
        <button type="submit">Publish</button>
    </form>

    <h1>Published posts (${posts.length})</h1>
    <table>
        <tr><th>Title</th><th>Date</th><th>Tag</th><th></th></tr>
        ${rowsHtml || '<tr><td colspan="4">No posts.</td></tr>'}
    </table>
</body>
</html>`);
});

// Edit page for an existing post
app.get('/admin/posts/:filename/edit', requireAdminAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const post = getSortedPosts().find(p => p.filename === filename);
  if (!post) return res.status(404).send('Post not found.');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <link rel="icon" type="image/png" href="/favicon.png">
    <meta charset="UTF-8">
    <title>Edit — presence</title>
    <style>${ADMIN_STYLE}</style>
</head>
<body>
    ${THEME_UI}
    <p><a href="/admin">← Back to admin</a></p>
    <h1>Edit post</h1>
    <form class="post-form" method="POST" action="/admin/posts/${encodeURIComponent(filename)}">
        <input name="title" placeholder="Title" value="${escapeHtml(post.title)}">
        <input name="tags" placeholder="comma-separated tags" value="${escapeHtml(post.tags.join(', '))}">
        <textarea name="content" rows="16" required>${escapeHtml(post.content)}</textarea>
        <button type="submit">Save</button>
    </form>
</body>
</html>`);
});

// Generate a filesystem-safe slug from a title
export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Builds the YAML frontmatter block (simple parser: no quotes in values)
function buildFrontmatter({ title, date, tags = [], type = 'note', mastodonId = '' }) {
  const titleYaml = title ? `title: "${title.replace(/"/g, '')}"\n` : '';
  const typeYaml = type && type !== 'note' ? `type: ${type}\n` : '';
  const mastodonYaml = mastodonId ? `mastodon_id: ${mastodonId}\n` : '';
  const tagsYaml = tags.length
    ? 'tags:\n' + tags.map(t => `  - "${String(t).replace(/"/g, '')}"`).join('\n') + '\n'
    : '';
  return `---\n${titleYaml}${typeYaml}${mastodonYaml}date: ${date}\n${tagsYaml}---\n`;
}

// Appends images at the end of the body as Markdown
function appendPhotos(body, photos = []) {
  if (!photos.length) return body;
  const imgs = photos.map(u => `![](${u})`).join('\n');
  return `${body}\n\n${imgs}`.trim();
}

// Writes a new post. Returns { slug, url } or throws Error with .status.
export function writePost({ title, body, tags = [], photos = [], type = 'note' }) {
  title = (title || '').trim();
  body = appendPhotos((body || '').trim(), photos);
  tags = tags.map(t => String(t).trim()).filter(Boolean);

  if (!body) {
    const e = new Error('Content is required.');
    e.status = 400;
    throw e;
  }

  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  // A note without a title (e.g. from a Micropub client) uses the timestamp as a slug
  const slug = slugify(title) || String(now.getTime());
  const filename = `${datePart}-${slug}.md`;
  const filePath = path.join(postsDir, filename);

  if (fs.existsSync(filePath)) {
    const e = new Error('A post with this slug already exists for today.');
    e.status = 409;
    throw e;
  }

  fs.writeFileSync(filePath, buildFrontmatter({ title, date: now.toISOString(), tags, type }) + body + '\n');
  return { slug, filename, url: `${SITE_URL}/posts/${slug}` };
}

// Injects mastodon_id into an existing post's frontmatter (once, after create).
function setPostMastodonId(filename, id) {
  const filePath = path.join(postsDir, path.basename(filename));
  if (!id || !fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m || /^mastodon_id:/m.test(m[1])) return;
  fs.writeFileSync(filePath, `---\n${m[1]}\nmastodon_id: ${id}\n---\n${m[2]}`);
}

// Rewrites an existing post identified by filename, keeping date and slug
// (the public URL stays stable). Returns { slug, url } or throws Error with .status.
export function updatePost(filename, { title, body, tags }) {
  filename = path.basename(filename);
  const filePath = path.join(postsDir, filename);
  if (!filename.endsWith('.md') || path.dirname(filePath) !== path.resolve(postsDir) || !fs.existsSync(filePath)) {
    const e = new Error('Post not found.');
    e.status = 404;
    throw e;
  }

  const existing = getSortedPosts().find(p => p.filename === filename);
  const newTitle = title !== undefined ? String(title).trim() : existing.title;
  const newBody = body !== undefined ? String(body).trim() : existing.content;
  const newTags = tags !== undefined ? tags.map(t => String(t).trim()).filter(Boolean) : existing.tags;

  fs.writeFileSync(filePath, buildFrontmatter({ title: newTitle, date: existing.date, tags: newTags, type: existing.type, mastodonId: existing.mastodonId }) + newBody + '\n');
  return { slug: existing.slug, url: `${SITE_URL}/posts/${existing.slug}`, mastodonId: existing.mastodonId, title: newTitle, body: newBody };
}

// Deletes a post given its public URL (e.g. https://site/posts/slug).
// Returns the deleted post (with mastodonId) or null.
function deletePostByUrl(url) {
  const post = findPostByUrl(url);
  if (!post) return null;
  const filePath = path.join(postsDir, post.filename);
  if (path.dirname(filePath) !== path.resolve(postsDir) || !fs.existsSync(filePath)) return null;
  fs.unlinkSync(filePath);
  return post;
}

// Finds a post from its public URL
function findPostByUrl(url) {
  let slug;
  try {
    slug = decodeURIComponent(new URL(url).pathname.replace(/^\/posts\//, '').replace(/\/$/, ''));
  } catch {
    return null;
  }
  return getSortedPosts().find(p => p.slug === slug) || null;
}

// Converts a public media URL into the local file path, or null if external
function mediaUrlToPath(u) {
  const prefix = `${SITE_URL}/media/`;
  return typeof u === 'string' && u.startsWith(prefix)
    ? path.join(mediaDir, u.slice(prefix.length))
    : null;
}

// Uploads a file to Mastodon (/api/v2/media). Returns the id or null.
async function uploadMastodonMedia(filePath) {
  try {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    const r = await fetch(`${MASTODON_URL}/api/v2/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MASTODON_TOKEN}` },
      body: form
    });
    if (!r.ok) return null;
    return (await r.json()).id || null;
  } catch {
    return null;
  }
}

// Publishes a Mastodon status (optionally threaded on inReplyToId). Returns the URL or null.
async function postMastodonStatus(text, photoPaths = [], inReplyToId) {
  const mediaIds = [];
  for (const p of photoPaths) {
    const id = await uploadMastodonMedia(p);
    if (id) mediaIds.push(id);
  }
  const r = await fetch(`${MASTODON_URL}/api/v1/statuses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MASTODON_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: text,
      ...(mediaIds.length ? { media_ids: mediaIds } : {}),
      ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {})
    })
  });
  if (!r.ok) {
    console.error('Mastodon syndication failed:', r.status, await r.text().catch(() => ''));
    return null;
  }
  const j = await r.json();
  return { id: j.id || null, url: j.url || null };
}

// Edits an existing Mastodon status in place (text only). Returns the URL or null.
async function editMastodonStatus(id, text) {
  if (!MASTODON_URL || !MASTODON_TOKEN || !id) return null;
  try {
    const r = await fetch(`${MASTODON_URL}/api/v1/statuses/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${MASTODON_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: text })
    });
    if (!r.ok) {
      console.error('Mastodon edit failed:', r.status, await r.text().catch(() => ''));
      return null;
    }
    return (await r.json()).url || null;
  } catch (e) {
    console.error('Mastodon edit error:', e.message);
    return null;
  }
}

// Deletes an existing Mastodon status. Returns true on success.
async function deleteMastodonStatus(id) {
  if (!MASTODON_URL || !MASTODON_TOKEN || !id) return false;
  try {
    const r = await fetch(`${MASTODON_URL}/api/v1/statuses/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${MASTODON_TOKEN}` }
    });
    if (!r.ok) {
      console.error('Mastodon delete failed:', r.status, await r.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('Mastodon delete error:', e.message);
    return false;
  }
}

// Resolves a remote post URL into the local status id on the instance, via federated
// ActivityPub search (resolve=true). Used to hook up native reply/repost/like.
async function resolveMastodonStatusId(url) {
  try {
    const r = await fetch(`${MASTODON_URL}/api/v2/search?resolve=true&type=statuses&q=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${MASTODON_TOKEN}` }
    });
    if (!r.ok) return null;
    const { statuses } = await r.json();
    return statuses && statuses[0] ? statuses[0].id : null;
  } catch {
    return null;
  }
}

// Native AP boost/favourite of a resolved status: no new status, just the action.
async function reblogMastodonStatus(id) {
  const r = await fetch(`${MASTODON_URL}/api/v1/statuses/${id}/reblog`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MASTODON_TOKEN}` }
  });
  if (!r.ok) return null;
  return (await r.json()).reblog?.url || null;
}
async function favouriteMastodonStatus(id) {
  const r = await fetch(`${MASTODON_URL}/api/v1/statuses/${id}/favourite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MASTODON_TOKEN}` }
  });
  if (!r.ok) return null;
  return (await r.json()).url || null;
}

// Text for the Mastodon status: title + content (without image syntax, photos
// are attached separately) + backlink to the original post.
function mastodonStatusText(title, content, url) {
  const clean = (content || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return `${title ? title + '\n\n' : ''}${clean.slice(0, 400)}\n\n${url}`;
}

// Crosspost to Mastodon (best-effort). photoPaths = local file paths to attach.
// For reply/rsvp/repost/like with a link resolvable to a Mastodon post, uses the
// native AP action (thread/boost/favourite) instead of a new status with the link in the text.
async function syndicateToMastodon({ title, body, content, url, photoPaths = [], type, link }) {
  if (!MASTODON_URL || !MASTODON_TOKEN) return null;
  try {
    if (link && ['reply', 'rsvp', 'repost', 'like'].includes(type)) {
      const id = await resolveMastodonStatusId(link);
      if (id) {
        if (type === 'repost') return { id: null, url: await reblogMastodonStatus(id) };
        if (type === 'like') return { id: null, url: await favouriteMastodonStatus(id) };
        return await postMastodonStatus(mastodonStatusText(title, content, url), photoPaths, id);
      }
    }
    return await postMastodonStatus(mastodonStatusText(title, body, url), photoPaths);
  } catch (e) {
    console.error('Mastodon syndication error:', e.message);
    return null;
  }
}

app.post('/admin/posts', requireAdminAuth, mediaUpload.array('photo'), async (req, res) => {
  const type = POST_TYPES[req.body.ptype] ? req.body.ptype : 'note';
  const tags = (req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const photos = (req.files || []).map(mediaUrlFor);
  const photoPaths = (req.files || []).map(f => f.path);
  const link = (req.body.link || '').trim();
  const content = req.body.content;
  const body = [contextLine(type, link), content].filter(Boolean).join('\n\n');
  try {
    const { url, filename } = writePost({ title: req.body.title, body, tags, photos, type });
    if (req.body.syndicate) {
      const synd = await syndicateToMastodon({ title: req.body.title, body, content, url, photoPaths, type, link });
      if (synd?.id) setPostMastodonId(filename, synd.id);
    }
    res.redirect('/admin');
  } catch (e) {
    res.status(e.status || 500).send(e.message);
  }
});

// Saves changes to an existing post
app.post('/admin/posts/:filename', requireAdminAuth, async (req, res) => {
  const tags = (req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  try {
    const upd = updatePost(req.params.filename, { title: req.body.title, body: req.body.content, tags });
    if (upd.mastodonId) await editMastodonStatus(upd.mastodonId, mastodonStatusText(upd.title, upd.body, upd.url));
    res.redirect('/admin');
  } catch (e) {
    res.status(e.status || 500).send(e.message);
  }
});

app.post('/admin/posts/:filename/delete', requireAdminAuth, async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(postsDir, filename);

  if (!filename.endsWith('.md') || path.dirname(filePath) !== path.resolve(postsDir) || !fs.existsSync(filePath)) {
    return res.status(404).send('Post not found.');
  }

  const post = getSortedPosts().find(p => p.filename === filename);
  fs.unlinkSync(filePath);
  if (post?.mastodonId) await deleteMastodonStatus(post.mastodonId);
  res.redirect('/admin');
});

// ============================================================
// Native IndieAuth (authorization + token endpoint) and Micropub
// Spec: https://indieauth.spec.indieweb.org/ and https://www.w3.org/TR/micropub/
// ============================================================

// --- Cryptographic helpers ---
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Access token = HMAC-SHA256 signed JWT, stateless (no DB required)
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

// Password hash: salted scrypt, format "scrypt:<salt_hex>:<hash_hex>".
// Generated by the /auth/new-password setup page and put in ADMIN_PASSWORD_HASH.
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, 64);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

function verifyPasswordHash(plain, stored) {
  const [algo, saltHex, hashHex] = String(stored).split(':');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = crypto.scryptSync(plain, salt, expected.length);
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}

// ADMIN_PASSWORD_HASH takes priority over plaintext ADMIN_PASSWORD if both are set.
function checkAdminPassword(candidate) {
  if (AUTH_PASSWORD_HASH) return verifyPasswordHash(candidate || '', AUTH_PASSWORD_HASH);
  return timingEqual(candidate || '', AUTH_PASSWORD);
}

// Authorization codes: short-lived (10 min), single-use, in memory.
// ponytail: In-memory Map — if the container restarts during login, log in again.
// Fine for single-user; if multi-instance is needed, move to a shared store.
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
  if (!SECRET || (!AUTH_PASSWORD && !AUTH_PASSWORD_HASH)) {
    return res.status(503).json({ error: 'service_unavailable', error_description: 'Set SECRET and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) to enable IndieAuth/Micropub.' });
  }
  next();
}

// --- Setup: generates the password hash to put in ADMIN_PASSWORD_HASH ---
// Deliberately outside requireConfigured: also needed before SECRET/ADMIN_PASSWORD are set.
function renderNewPasswordPage({ error, hash } = {}) {
  return `<!DOCTYPE html>
<html lang="en"><head>
    <link rel="icon" type="image/png" href="/favicon.png"><meta charset="UTF-8"><title>Generate hash password — presence</title>
<style>
  body { background:#050505; color:#d8d8d8; font-family:ui-monospace,monospace; max-width:480px; margin:60px auto; padding:0 20px; }
  .box { border:1px solid #222; background:#0a0a0a; padding:25px; border-radius:6px; }
  h1 { font-size:1.3rem; color:#fff; }
  p.hint { color:#888; font-size:0.85rem; }
  code { color:#6cf; }
  pre { color:#6cf; word-break:break-all; white-space:pre-wrap; background:#050505; border:1px solid #222; padding:12px; border-radius:4px; }
  .error { color:#f66; }
  input[type=password] { width:100%; box-sizing:border-box; background:#050505; color:#fff; border:1px solid #333; padding:10px; margin:12px 0; border-radius:4px; }
  button { background:#06c; color:#fff; border:0; padding:10px 20px; border-radius:4px; cursor:pointer; width:100%; font-size:1rem; }
</style></head><body><div class="box">
  <h1>Generate hash password</h1>
  <p class="hint">Enter the password you want to use for <code>/admin</code> and IndieAuth. The server generates a hash to paste into <code>ADMIN_PASSWORD_HASH</code> in <code>.env</code> — the plaintext password is never saved anywhere.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  ${hash ? `<p>Hash generated, copy it to <code>ADMIN_PASSWORD_HASH</code>:</p><pre>${escapeHtml(hash)}</pre><p class="hint">Then remove <code>ADMIN_PASSWORD</code> (or leave it empty) and restart the server.</p>` : ''}
  <form method="POST" action="/auth/new-password">
    <input type="password" name="password" placeholder="New password" autofocus required minlength="8">
    <button type="submit">Generate hash</button>
  </form>
</div></body></html>`;
}

app.get('/auth/new-password', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(renderNewPasswordPage());
});

app.post('/auth/new-password', express.urlencoded({ extended: false }), (req, res) => {
  const password = req.body?.password || '';
  res.setHeader('Content-Type', 'text/html');
  if (!password) return res.status(400).send(renderNewPasswordPage({ error: 'Enter a password.' }));
  res.send(renderNewPasswordPage({ hash: hashPassword(password) }));
});

app.use(['/auth', '/token', '/micropub', '/media'], express.urlencoded({ extended: false }), express.json(), requireConfigured);

// --- Authorization endpoint: consent page ---
app.get('/auth', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, me } = req.query;

  if (!client_id || !redirect_uri || !code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).send('Invalid authorization request (client_id, redirect_uri, code_challenge, code_challenge_method=S256 required).');
  }

  const hidden = { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope: scope || '', me: me || SITE_URL };
  const hiddenHtml = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n');
  const scopeList = String(scope || '').split(/\s+/).filter(Boolean);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
    <link rel="icon" type="image/png" href="/favicon.png"><meta charset="UTF-8"><title>Authorize — presence</title>
<style>
  body { background:#050505; color:#d8d8d8; font-family:ui-monospace,monospace; max-width:420px; margin:60px auto; padding:0 20px; }
  .box { border:1px solid #222; background:#0a0a0a; padding:25px; border-radius:6px; }
  h1 { font-size:1.3rem; color:#fff; }
  code { color:#6cf; word-break:break-all; }
  ul { padding-left:18px; } li { margin-bottom:4px; }
  input[type=password] { width:100%; box-sizing:border-box; background:#050505; color:#fff; border:1px solid #333; padding:10px; margin:12px 0; border-radius:4px; }
  button { background:#06c; color:#fff; border:0; padding:10px 20px; border-radius:4px; cursor:pointer; width:100%; font-size:1rem; }
  ${LIGHT_CSS}
</style></head><body>${THEME_UI}<div class="box">
  <h1>Authorize application</h1>
  <p><code>${escapeHtml(client_id)}</code> requests access to <code>${escapeHtml(hidden.me)}</code></p>
  ${scopeList.length ? `<p>Permissions:</p><ul>${scopeList.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '<p>Authentication only (no write permissions).</p>'}
  <form method="POST" action="/auth">
    ${hiddenHtml}
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Allow</button>
  </form>
</div></body></html>`);
});

// --- Authorization endpoint: approval → emits the code ---
app.post('/auth', (req, res) => {
  const { password, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.body;

  if (!checkAdminPassword(password)) {
    return res.status(401).send('Incorrect password.');
  }
  if (!client_id || !redirect_uri || !code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).send('Missing authorization parameters.');
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

// Exchanges an authorization code by verifying PKCE. Returns the data or null.
function redeemCode({ code, client_id, redirect_uri, code_verifier }) {
  const data = authCodes.get(code);
  if (!data) return null;
  authCodes.delete(code); // single use
  if (data.exp < Date.now()) return null;
  if (data.client_id !== client_id || data.redirect_uri !== redirect_uri) return null;
  if (!timingEqual(pkceS256(code_verifier || ''), data.code_challenge)) return null;
  return data;
}

// --- Token endpoint: exchange code → access token ---
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

// --- Token endpoint: verify token (used by some clients) ---
app.get('/token', (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  res.json({ me: token.me, client_id: token.client_id, scope: token.scope });
});

// Extracts photo URLs from an mf2 property (string, {value}, or mixed array)
function photoUrls(photo) {
  return [].concat(photo || [])
    .map(p => (p && typeof p === 'object' ? p.value : p))
    .filter(Boolean);
}

// Renders an IndieWeb post type as a Markdown line at the top of the post.
// - types with URL: "emoji verb [link](link)" (only if link is present)
// - lead types without URL (food/drink): "emoji verb" as header
// - note/article/photo: no prefix
export function contextLine(type, link) {
  const t = POST_TYPES[type];
  if (!t) return '';
  if (t.url) return link ? `${t.emoji} ${t.verb} [${link}](${link})` : '';
  if (t.lead) return `**${t.emoji} ${t.verb}**`;
  return '';
}

// --- Micropub: normalize create from form-encoded or JSON (mf2) ---
function parseMicropubCreate(body) {
  const p = body.type ? (body.properties || {}) : body; // JSON mf2 vs form-encoded
  const first = v => (Array.isArray(v) ? v[0] : v);

  let content = first(p.content);
  if (content && typeof content === 'object') content = content.html || content.value || '';
  content = String(content || '');

  // Infers the type from the present mf2 property (bookmark-of, like-of, ...)
  let type = 'note';
  let link = '';
  for (const [name, t] of Object.entries(POST_TYPES)) {
    if (t.prop && p[t.prop] !== undefined) { type = name; link = first(p[t.prop]); break; }
  }

  return {
    type,
    title: first(p.name) || '',
    content,
    link,
    body: [contextLine(type, link), content].filter(Boolean).join('\n\n'),
    tags: [].concat(p.category || p['category[]'] || []).filter(Boolean),
    photos: photoUrls(p.photo || p['photo[]'])
  };
}

// --- Media endpoint: uploads a file and returns the public URL ---
app.post('/media', (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  if (!hasScope(token, 'media') && !hasScope(token, 'create')) {
    return res.status(403).json({ error: 'insufficient_scope', scope: 'media' });
  }
  mediaUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'invalid_request', error_description: err.message });
    if (!req.file) return res.status(400).json({ error: 'invalid_request', error_description: 'Missing file field.' });
    res.setHeader('Location', mediaUrlFor(req.file));
    res.status(201).end();
  });
});

// --- Micropub: query (q=config / source / syndicate-to) ---
app.get('/micropub', (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const syndicateTo = (MASTODON_URL && MASTODON_TOKEN)
    ? [{ uid: `mastodon://${MASTODON_URL}`, name: MASTODON_USER || MASTODON_URL }]
    : [];

  switch (req.query.q) {
    case 'config':
      return res.json({ 'media-endpoint': `${SITE_URL}/media`, 'syndicate-to': syndicateTo });
    case 'syndicate-to':
      return res.json({ 'syndicate-to': syndicateTo });
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

// --- Micropub: create / update / delete ---
// upload.any() handles any inline attached photos (multipart); for JSON/form it passes through
app.post('/micropub', mediaUpload.any(), async (req, res) => {
  const token = verifyToken(bearer(req));
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const action = req.body.action || 'create';

  try {
    if (action === 'create') {
      if (!hasScope(token, 'create')) {
        return res.status(403).json({ error: 'insufficient_scope', scope: 'create' });
      }
      const parsed = parseMicropubCreate(req.body);
      // Photos uploaded inline with the post are added to those passed as URLs
      const inlinePhotos = (req.files || []).map(mediaUrlFor);
      parsed.photos = [...parsed.photos, ...inlinePhotos];

      const { url, filename } = writePost(parsed);
      // parsed.photos already contains the inline URLs: resolve the local ones for Mastodon
      const photoPaths = parsed.photos.map(mediaUrlToPath).filter(Boolean);
      const synd = await syndicateToMastodon({ title: parsed.title, body: parsed.body, content: parsed.content, url, photoPaths, type: parsed.type, link: parsed.link });
      if (synd?.id) setPostMastodonId(filename, synd.id);
      res.setHeader('Location', url);
      return res.status(201).end();
    }

    if (action === 'update') {
      if (!hasScope(token, 'update')) {
        return res.status(403).json({ error: 'insufficient_scope', scope: 'update' });
      }
      const post = findPostByUrl(req.body.url);
      if (!post) return res.status(404).json({ error: 'not_found' });

      // Supports `replace` of name/content/category (the most common client case)
      const repl = req.body.replace || {};
      const first = v => (Array.isArray(v) ? v[0] : v);
      const patch = {};
      if (repl.name !== undefined) patch.title = first(repl.name);
      if (repl.content !== undefined) {
        let c = first(repl.content);
        if (c && typeof c === 'object') c = c.html || c.value || '';
        patch.body = String(c || '');
      }
      if (repl.category !== undefined) patch.tags = [].concat(repl.category).filter(Boolean);

      const upd = updatePost(post.filename, patch);
      if (upd.mastodonId) await editMastodonStatus(upd.mastodonId, mastodonStatusText(upd.title, upd.body, upd.url));
      res.setHeader('Location', `${SITE_URL}/posts/${post.slug}`);
      return res.status(204).end();
    }

    if (action === 'delete') {
      if (!hasScope(token, 'delete')) {
        return res.status(403).json({ error: 'insufficient_scope', scope: 'delete' });
      }
      const deleted = deletePostByUrl(req.body.url);
      if (!deleted) return res.status(404).json({ error: 'not_found' });
      if (deleted.mastodonId) await deleteMastodonStatus(deleted.mastodonId);
      return res.status(204).end();
    }

    return res.status(501).json({ error: 'not_implemented', error_description: `Action '${action}' not supported.` });
  } catch (e) {
    return res.status(e.status || 500).json({ error: 'invalid_request', error_description: e.message });
  }
});

// Start the server only if executed directly (not in import, e.g. from tests)
if (process.argv[1] === __filename) {
  app.listen(PORT, () => {
    if (!SECRET || (!AUTH_PASSWORD && !AUTH_PASSWORD_HASH)) {
      console.warn('WARNING: SECRET or ADMIN_PASSWORD/ADMIN_PASSWORD_HASH not set — IndieAuth/Micropub and /admin remain disabled. Visit /auth/new-password to generate a hash.');
    }
    console.log(`Unified presence server active on port ${PORT}`);
    console.log(`Post source folder set to: ${postsDir}`);
  });
}

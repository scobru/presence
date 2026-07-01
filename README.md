# presence

Minimal personal IndieWeb blog: a single `server.js` file (Express, ESM) that
**natively** implements IndieAuth, Micropub, and an admin panel, without
Indiekit and without a database. Posts are Markdown files with frontmatter on disk.

Designed for deployment on a VPS with CapRover (or any Docker host).

## Features

- **Markdown blog** — posts are `.md` files with frontmatter (`title`, `date`,
  `type`, `tags`), read and sorted from disk on every request. No DB.
- **Native IndieAuth** — self-hosted authorization endpoint (`/auth`) + token
  endpoint (`/token`). Login with your password, HMAC-SHA256 signed JWT access
  tokens (stateless), mandatory PKCE `S256`, single-use codes.
- **Native Micropub** (`/micropub`, [W3C spec](https://www.w3.org/TR/micropub/)) —
  compatible with external clients (Micropublish, Quill, micro.blog):
  - `create` (form-encoded and JSON mf2), `update` (replace name/content/category),
    `delete`
  - `q=config`, `q=source`, `q=syndicate-to` queries
- **IndieWeb post types** — Note, Article, Bookmark, Reply, RSVP, Repost,
  Like, Check-in, Photo, Listen, Food, Drink. Context properties
  (`bookmark-of`, `like-of`, `in-reply-to`, ...) are rendered as a Markdown line
  at the top of the post, with emoji and a natural-language phrase.
- **Media** — `/media` endpoint (multipart upload via Micropub) and direct
  photo upload from the admin panel. Markdown images (`![](url)`) rendered.
- **Admin panel** (`/admin`, Basic Auth) — composer with type selector,
  photo upload, post creation / editing / deletion, visual filter.
- **Mastodon syndication** — automatic (best-effort) crosspost of every new
  post, with image uploads as attachments (`/api/v2/media`). Reply,
  RSVP, Repost and Like with a link resolvable to a Mastodon post become
  native AP actions (threaded reply, boost, favourite) instead of a new status
  with the link in the text.
- **Homepage** — post list with a type badge, **type filter** dropdown,
  site name/description configurable via env.
- **Light/dark theme** — 🌓 button on every page, choice saved in
  `localStorage`, initial theme follows the OS setting.
- **Security** — HTML escaping of user content, path traversal guards,
  timing-safe comparisons for passwords and signatures, self-tests included.

## Requirements

- Node.js 20+ (uses native `fetch`, `FormData`, `Blob`)

## Local startup

```bash
npm install
cp .env.example .env   # then edit the values
npm start              # http://localhost:3000
```

## Environment variables

| Variable | Required | Description |
|-----------|:---:|-------------|
| `ME` | recommended | Public URL of the site (IndieAuth `me` value), without trailing slash |
| `SECRET` | for IndieAuth | Secret for signing access tokens. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_PASSWORD` | for admin/auth | Single password for `/admin` (Basic Auth) and for authorizing Micropub clients. Without it, `/admin` and `/micropub` stay disabled (503) |
| `ADMIN_USER` | no | Admin username (default `admin`) |
| `SITE_NAME` | no | Site name shown on the homepage (default `presence`) |
| `SITE_DESCRIPTION` | no | Homepage subtitle (default empty) |
| `POSTS_DIR` | no | Posts folder (default `./posts`) |
| `PORT` | no | Port (default `3000`) |
| `MASTODON_URL` | no | Mastodon instance for crossposting |
| `MASTODON_ACCESS_TOKEN` | no | Mastodon token with `write:statuses`, `write:favourites`, `write:reblogs` and `read:search` permissions (to resolve reply/repost/like into native AP actions) |
| `MASTODON_USER` | no | Handle shown in admin |

Mastodon syndication activates only if `MASTODON_URL` **and**
`MASTODON_ACCESS_TOKEN` are both present.

## Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Homepage (supports `?type=<type>` to filter) |
| `/posts/:slug` | GET | Single post page |
| `/admin` | GET | Admin panel (Basic Auth) |
| `/admin/posts` | POST | Create post (form) |
| `/admin/posts/:file/edit` | GET | Edit form |
| `/admin/posts/:file` | POST | Save changes |
| `/admin/posts/:file/delete` | POST | Delete |
| `/auth` | GET/POST | IndieAuth authorization endpoint |
| `/token` | GET/POST | IndieAuth token endpoint |
| `/micropub` | GET/POST | Micropub (create/update/delete, query) |
| `/media` | POST | Media upload (Micropub) |

## Publishing posts

**From the admin panel:** go to `/admin`, choose the type, write, attach photos,
Publish.

**From an external Micropub client** (e.g. [Micropublish](https://micropublish.net)):
log in with your site's URL and your `ADMIN_PASSWORD`. The client discovers the
endpoints from the `<link rel>` tags in the pages.

## Post format

```markdown
---
title: "Post title"
type: bookmark
date: 2026-07-01T10:00:00.000Z
tags:
  - web
  - indieweb
---
🔖 Bookmark: [https://example.com](https://example.com)

Post content in Markdown.
```

The file name is `YYYY-MM-DD-slug.md`; the slug is derived from the title (or
the timestamp for untitled notes). Editing a post keeps its date and slug (stable
URL).

## Deploy (CapRover)

The repo includes `Dockerfile`, `captain-definition` and `docker-compose.yml`.
Set the environment variables in CapRover's App Config (at least `ME`,
`SECRET`, `ADMIN_PASSWORD`) and deploy. The `posts/` folder should be mounted on
a persistent volume.

## Tests

```bash
npm test
```

`selftest.mjs` verifies the security-critical part without starting the server:
token roundtrip/tampering/expiry/forgery, the official PKCE vector
(RFC 7636), `slugify` and `contextLine`.

## Not implemented (by choice)

- Micropub `undelete`
- ActivityPub / federation (only Mastodon API crossposting exists)
- Dedicated rich rendering for Check-in (map) / Listen (embed)
- `update` that replaces content removes photos (mf2 `replace` semantics)

## License

MIT — Francesco Bruno (scobru)

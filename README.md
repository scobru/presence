# presence

Blog personale IndieWeb minimale: un singolo file `server.js` (Express, ESM) che
implementa **nativamente** IndieAuth, Micropub e un pannello admin, senza
Indiekit e senza database. I post sono file Markdown con frontmatter su disco.

Pensato per il deploy su una VPS con CapRover (o qualsiasi host Docker).

## Caratteristiche

- **Blog Markdown** — i post sono file `.md` con frontmatter (`title`, `date`,
  `type`, `tags`), letti e ordinati da disco a ogni richiesta. Nessun DB.
- **IndieAuth nativo** — authorization endpoint (`/auth`) + token endpoint
  (`/token`) self-hosted. Login con la tua password, access token JWT firmati
  HMAC-SHA256 (stateless), PKCE `S256` obbligatoria, codici monouso.
- **Micropub nativo** (`/micropub`, [spec W3C](https://www.w3.org/TR/micropub/)) —
  compatibile con i client esterni (Micropublish, Quill, micro.blog):
  - `create` (form-encoded e JSON mf2), `update` (replace name/content/category),
    `delete`
  - query `q=config`, `q=source`, `q=syndicate-to`
- **Tipi di post IndieWeb** — Nota, Articolo, Bookmark, Risposta, RSVP, Repost,
  Like, Check-in, Foto, Listen, Food, Drink. Le proprietà di contesto
  (`bookmark-of`, `like-of`, `in-reply-to`, ...) sono rese come riga Markdown in
  cima al post, con emoji e frase naturale.
- **Media** — endpoint `/media` (upload multipart via Micropub) e upload foto
  diretto dal pannello admin. Immagini Markdown (`![](url)`) renderizzate.
- **Pannello admin** (`/admin`, Basic Auth) — composer con selettore tipo,
  upload foto, creazione / modifica / cancellazione post, filtro visivo.
- **Syndication Mastodon** — crosspost automatico (best-effort) di ogni nuovo
  post, con upload delle immagini come allegati (`/api/v2/media`).
- **Homepage** — lista post con badge per tipo, **filtro per tipo** a tendina,
  nome/descrizione del sito configurabili da env.
- **Tema chiaro/scuro** — bottone 🌓 su ogni pagina, scelta salvata in
  `localStorage`, tema iniziale che segue l'impostazione dell'OS.
- **Sicurezza** — escaping HTML dei contenuti utente, guardie contro path
  traversal, confronti timing-safe su password e firme, self-test inclusi.

## Requisiti

- Node.js 20+ (usa `fetch`, `FormData`, `Blob` nativi)

## Avvio locale

```bash
npm install
cp .env.example .env   # poi modifica i valori
npm start              # http://localhost:3000
```

## Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|-----------|:---:|-------------|
| `ME` | consigliata | URL pubblico del sito (valore `me` di IndieAuth), senza slash finale |
| `SECRET` | per IndieAuth | Segreto per firmare gli access token. Genera con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_PASSWORD` | per admin/auth | Password unica per `/admin` (Basic Auth) e per autorizzare i client Micropub. Senza, `/admin` e `/micropub` restano disabilitati (503) |
| `ADMIN_USER` | no | Username admin (default `admin`) |
| `SITE_NAME` | no | Nome del sito mostrato in homepage (default `presence`) |
| `SITE_DESCRIPTION` | no | Sottotitolo in homepage (default vuoto) |
| `POSTS_DIR` | no | Cartella dei post (default `./posts`) |
| `PORT` | no | Porta (default `3000`) |
| `MASTODON_URL` | no | Istanza Mastodon per il crosspost |
| `MASTODON_ACCESS_TOKEN` | no | Token Mastodon con permesso `write:statuses` |
| `MASTODON_USER` | no | Handle mostrato in admin |

La syndication Mastodon si attiva solo se `MASTODON_URL` **e**
`MASTODON_ACCESS_TOKEN` sono entrambe presenti.

## Endpoint

| Rotta | Metodo | Descrizione |
|-------|--------|-------------|
| `/` | GET | Homepage (supporta `?type=<tipo>` per filtrare) |
| `/posts/:slug` | GET | Pagina singolo post |
| `/admin` | GET | Pannello admin (Basic Auth) |
| `/admin/posts` | POST | Crea post (form) |
| `/admin/posts/:file/edit` | GET | Form di modifica |
| `/admin/posts/:file` | POST | Salva modifiche |
| `/admin/posts/:file/delete` | POST | Cancella |
| `/auth` | GET/POST | IndieAuth authorization endpoint |
| `/token` | GET/POST | IndieAuth token endpoint |
| `/micropub` | GET/POST | Micropub (create/update/delete, query) |
| `/media` | POST | Upload media (Micropub) |

## Pubblicare i post

**Dal pannello admin:** vai su `/admin`, scegli il tipo, scrivi, allega foto,
Pubblica.

**Da un client Micropub esterno** (es. [Micropublish](https://micropublish.net)):
fai login con l'URL del tuo sito e la tua `ADMIN_PASSWORD`. Il client scopre gli
endpoint dai `<link rel>` nelle pagine.

## Formato dei post

```markdown
---
title: "Titolo del post"
type: bookmark
date: 2026-07-01T10:00:00.000Z
tags:
  - web
  - indieweb
---
🔖 Segnalibro: [https://esempio.com](https://esempio.com)

Contenuto del post in Markdown.
```

Il nome file è `YYYY-MM-DD-slug.md`; lo slug deriva dal titolo (o dal timestamp
per le note senza titolo). Modificare un post ne mantiene data e slug (URL
stabile).

## Deploy (CapRover)

Il repo include `Dockerfile`, `captain-definition` e `docker-compose.yml`.
Imposta le variabili d'ambiente nell'App Config di CapRover (almeno `ME`,
`SECRET`, `ADMIN_PASSWORD`) e fai il deploy. La cartella `posts/` va montata su
un volume persistente.

## Test

```bash
npm test
```

`selftest.mjs` verifica la parte security-critica senza avviare il server:
roundtrip/manomissione/scadenza/forgiatura dei token, il vettore PKCE ufficiale
(RFC 7636), `slugify` e `contextLine`.

## Non implementato (per scelta)

- `undelete` Micropub
- ActivityPub / federazione (esiste solo il crosspost via API Mastodon)
- Rendering ricco dedicato per Check-in (mappa) / Listen (embed)
- L'`update` che sostituisce il contenuto rimuove le foto (semantica mf2
  `replace`)

## Licenza

MIT — Francesco Bruno (scobru)

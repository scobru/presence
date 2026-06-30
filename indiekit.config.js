export default {
  application: {
    me: process.env.ME || "https://scobru.it",
    name: "presence"
  },
  plugins: [
    "@indiekit/store-file-system",
    "@indiekit/syndicator-mastodon",
    "@indiekit/endpoint-media"
  ],
  publication: {
    me: process.env.ME || "https://scobru.it",
    media: {
      path: "media/{yyyy}/{mm}/{filename}",
      url: "media/{yyyy}/{mm}/{filename}"
    },
    postTypes: [
      {
        type: "article",
        name: "Article",
        post: {
          path: "{yyyy}-{mm}-{dd}-{slug}.md",
          url: "posts/{slug}"
        }
      },
      {
        type: "note",
        name: "Note",
        post: {
          path: "{yyyy}-{mm}-{dd}-{slug}.md",
          url: "posts/{slug}"
        }
      }
    ]
  },
  "@indiekit/store-file-system": {
    directory: process.env.POSTS_DIR || "posts"
  },
  "@indiekit/syndicator-mastodon": {
    checked: true,
    url: process.env.MASTODON_URL,
    user: process.env.MASTODON_USER
  }
};

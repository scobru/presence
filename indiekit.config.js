const plugins = [
  "@indiekit/store-file-system",
  "@indiekit/endpoint-media"
];

const config = {
  application: {
    me: process.env.ME || "https://scobru.it",
    name: "presence"
  },
  plugins,
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
  }
};

// Carica il plugin Mastodon solo se le variabili d'ambiente sono state configurate su CapRover
if (process.env.MASTODON_URL && process.env.MASTODON_USER) {
  plugins.push("@indiekit/syndicator-mastodon");
  config["@indiekit/syndicator-mastodon"] = {
    checked: true,
    url: process.env.MASTODON_URL,
    user: process.env.MASTODON_USER
  };
}

export default config;

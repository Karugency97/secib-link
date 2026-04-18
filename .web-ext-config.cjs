// Configuration web-ext pour signature sur addons.thunderbird.net (ATN).
//
// Usage :
//   export WEB_EXT_API_KEY='user:12345:67'   # JWT issuer (ATN)
//   export WEB_EXT_API_SECRET='<secret>'     # JWT secret (ATN)
//   web-ext sign
//
// Le XPI signé arrive dans ./web-ext-artifacts/. Renomme-le pour qu'il
// corresponde à l'URL déclarée dans updates.json (ex.
// secib_link-1.2.0-tb.xpi), puis upload sur la GitHub Release.

module.exports = {
  sourceDir: __dirname,
  artifactsDir: "./web-ext-artifacts",
  ignoreFiles: [
    ".git/**",
    ".github/**",
    ".gitignore",
    "**/.DS_Store",
    "docs/**",
    "README.md",
    "updates.json",
    ".web-ext-config.cjs",
    "web-ext-artifacts/**",
    "node_modules/**",
    "*.xpi"
  ],
  sign: {
    apiUrlPrefix: "https://addons.thunderbird.net/api/v4/",
    channel: "unlisted"
  },
  build: {
    overwriteDest: true
  }
};

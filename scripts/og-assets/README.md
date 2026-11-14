# OG card assets

## SpaceGrotesk-Variable.woff2

Latin subset of [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk),
the display face the site already loads from Google Fonts in
`frontend/index.html`. Vendored here so `scripts/generate-og-images.mjs`
produces byte-identical cards offline and in CI, instead of depending on a
network fetch at generation time.

Space Grotesk is licensed under the SIL Open Font License 1.1, which permits
redistribution. It is a variable font: the single file covers weights 300–700,
which is why there is one file rather than one per weight.

Re-fetch with:

    curl -A "Mozilla/5.0 (X11; Linux x86_64) Chrome/120" \
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap"
    # then download the woff2 in the `unicode-range: U+0000-00FF` (latin) block

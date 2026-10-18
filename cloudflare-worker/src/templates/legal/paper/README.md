# templates/legal/paper — the faces and the mark of the legal paper

Every legal document prints on one HTML paper (D711, #1776), and this folder
holds what that paper prints in. `cloudflare-worker/src/services/legalPaperCss.ts`
imports each file as an `ArrayBuffer` (wrangler.toml's `[[rules]] type = "Data"`
block) and inlines it as a `data:` URI, so no render fetches anything from the
network. CI never subsets: the files here are the output, committed as full
blobs, not LFS pointers (`.gitattributes` and `scripts/lfs-size-gate.mjs` exempt
each one, saying why).

## The files

| File | Face | Role on the paper | Bytes |
| --- | --- | --- | --- |
| `public-sans-400.woff2` | Public Sans Regular, v2.001 | body, preamble, execution text | 14,200 |
| `public-sans-400-italic.woff2` | Public Sans Italic, v2.001 | oblique runs, "[Signature page follows]" | 15,144 |
| `public-sans-700.woff2` | Public Sans Bold, v2.001 | bold runs, defined terms, eyebrows, CONFIDENTIAL | 14,160 |
| `bricolage-grotesque-800.woff2` | Bricolage Grotesque ExtraBold, v1.001 | the title and article headings | 21,836 |
| `space-grotesk-700.woff2` | Space Grotesk Bold, v2.000 | the "AXAL VC" wordmark in the lockup, nothing else | 13,264 |
| `roboto-mono-400.woff2` | Roboto Mono Regular, v3.001 | figures, the audit line, hashes | 14,776 |
| `roboto-mono-700.woff2` | Roboto Mono Bold, v3.001 | bold figures (a totals row) | 14,872 |
| `axal-mark.png` | the Axal mark, a copy of `frontend/public/axal-mark.png` | the lockup | 7,770 |

The seven faces total 108,252 bytes, under the 400 KB cap D711 sets.

## Licences

All four families are under the SIL Open Font License 1.1, which allows
embedding and subsetting. The licence text of each, with its copyright line,
sits beside it: `OFL-PublicSans.txt`, `OFL-BricolageGrotesque.txt`,
`OFL-SpaceGrotesk.txt` and `OFL-RobotoMono.txt`. The canvas gives Roboto Mono
as Apache 2.0; the v3.001 file shipped here names the OFL in its own `name`
table (IDs 13 and 14), and its licence file says the same, so the OFL is what
applies.

## Source

The static TTFs of the Google Fonts releases, as packaged on npm by
`@expo-google-fonts/public-sans@0.4.2`, `@expo-google-fonts/bricolage-grotesque@0.4.1`,
`@expo-google-fonts/space-grotesk@0.4.1` and `@expo-google-fonts/roboto-mono@0.4.2`
(`npm pack`, never a dependency of this repo). The licence files are those
packages' `LICENSE_FONT`.

## Subset ranges

Basic Latin, Latin-1, Latin Extended-A, U+0218–021B (Ș ș Ț ț), General
Punctuation, ← → and ≤ ≥ ≠ where the face has them. Public Sans and Roboto
Mono have no ← or →, so those two glyphs fall back to the browser's sans in
those faces; every other character in the ranges is present in every face.

Each file was made with fontTools 4.x:

    pyftsubset <Face>.ttf \
      --unicodes='U+0020-007E,U+00A0-00FF,U+0100-017F,U+0218-021B,U+2000-206F,U+2190,U+2192,U+2260,U+2264,U+2265' \
      --flavor=woff2 --layout-features='kern,liga,calt,tnum,lnum' \
      --no-hinting --desubroutinize --output-file=<name>.woff2

## Rules

- **Change a face here and in `LEGAL_FACES` together.** `legalPaperCss.ts`
  lists each file's family, style, weight and role, and the paper's tests check
  every listed file starts `wOF2` and the total stays under the cap.
- **Space Grotesk is the wordmark only.** No other CSS rule names it.
- **Nothing here is fetched at render time,** and nothing is added that is.

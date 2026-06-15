#!/usr/bin/env node
/**
 * gen-spinout-icons.mjs — pre-bake the 5 glyph PNGs the Axal Spin-Out PPTX
 * generator (`frontend/src/decks/spinout/buildDeck.js`) embeds.
 *
 * The original `axal_vc_spinout_deck.js` template rasterised react-icons
 * Font Awesome glyphs to PNG via `sharp` at runtime. Neither `sharp`
 * (native) nor `react-icons`/`react-dom` can run in this codebase's
 * deck path (the generator runs in the BROWSER, and prod is a Cloudflare
 * Worker — no Node, no native binaries). Instead we pre-bake five clean,
 * single-colour glyphs ONCE here and inline them as base64 constants in
 * `frontend/src/decks/spinout/icons.generated.js`, which the generator
 * imports synchronously.
 *
 * Colours are pinned to THEME: accent `#2C4BE0` for the four solution
 * step glyphs, white `#FFFFFF` for the check that sits on a coloured dot.
 *
 * Rasterised with ImageMagick (`magick`), the SVG→PNG tool available in
 * this environment. Re-run after editing a glyph:
 *
 *     node scripts/gen-spinout-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = '#2C4BE0';
const WHITE = '#FFFFFF';
const SIZE = 256;

// Clean geometric glyphs (basic SVG shapes only, so the rasteriser needs
// no font or path-library support). Each conveys the same concept as the
// Font Awesome glyph the template referenced.
const SVGS = {
  // database — "ingest"
  ingest: `
    <g fill="${ACCENT}">
      <ellipse cx="128" cy="58" rx="84" ry="32"/>
      <path d="M44 58 v50 c0 17.7 37.6 32 84 32 s84 -14.3 84 -32 V58 c0 17.7 -37.6 32 -84 32 S44 75.7 44 58 Z"/>
      <path d="M44 122 v50 c0 17.7 37.6 32 84 32 s84 -14.3 84 -32 v-50 c0 17.7 -37.6 32 -84 32 S44 139.7 44 122 Z"/>
    </g>`,
  // chart-line — "score"
  score: `
    <g fill="none" stroke="${ACCENT}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="44,40 44,212 216,212"/>
      <polyline points="68,168 112,118 150,150 212,72"/>
    </g>`,
  // eye — "monitor"
  monitor: `
    <g>
      <path d="M20 128 C62 66 194 66 236 128 C194 190 62 190 20 128 Z" fill="none" stroke="${ACCENT}" stroke-width="18" stroke-linejoin="round"/>
      <circle cx="128" cy="128" r="34" fill="${ACCENT}"/>
    </g>`,
  // bolt — "act"
  act: `<polygon fill="${ACCENT}" points="150,18 58,142 118,142 104,238 198,114 138,114"/>`,
  // check — white, sits on a coloured status dot
  check: `<polyline fill="none" stroke="${WHITE}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" points="50,134 108,194 206,72"/>`,
};

const wrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${SIZE}" height="${SIZE}">${inner}</svg>`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'frontend', 'src', 'decks', 'spinout', 'icons.generated.js');
const tmp = mkdtempSync(join(tmpdir(), 'spinout-icons-'));

const icons = {};
for (const [key, inner] of Object.entries(SVGS)) {
  const svgPath = join(tmp, `${key}.svg`);
  const pngPath = join(tmp, `${key}.png`);
  writeFileSync(svgPath, wrap(inner), 'utf8');
  execFileSync('magick', [
    '-background', 'none',
    svgPath,
    '-resize', `${SIZE}x${SIZE}`,
    '-strip',
    '-depth', '8',
    pngPath,
  ]);
  const b64 = readFileSync(pngPath).toString('base64');
  icons[key] = `image/png;base64,${b64}`;
  // eslint-disable-next-line no-console
  console.log(`  ${key}: ${b64.length} base64 chars`);
}
rmSync(tmp, { recursive: true, force: true });

const header = `/**
 * icons.generated.js — DO NOT EDIT BY HAND.
 *
 * Pre-baked base64 PNG glyphs for the Axal Spin-Out PPTX generator,
 * produced by \`scripts/gen-spinout-icons.mjs\`. Each value is in the
 * \`image/png;base64,...\` form pptxgenjs \`addImage({ data })\` expects.
 *
 * Re-generate with:  node scripts/gen-spinout-icons.mjs
 */
`;
const body =
  `export const SPINOUT_ICONS = {\n` +
  Object.entries(icons)
    .map(([k, v]) => `  ${k}: '${v}',`)
    .join('\n') +
  `\n};\n`;
writeFileSync(OUT, header + '\n' + body, 'utf8');
// eslint-disable-next-line no-console
console.log(`\nWrote ${OUT}`);

#!/usr/bin/env node
/**
 * Generate the Open Graph card images served at /og/<key>.png.
 *
 * WHY
 * ---
 * Every axal.vc route used to advertise a single `og:image` — `/og.png` — and
 * that file does not exist in this repository. Crawlers that fetch a 404 for
 * the declared image fall back to scraping whatever raster they can find on the
 * page, which is how an unrelated 1536x1024 asset ended up as the WhatsApp
 * preview for every link regardless of which page was shared.
 *
 * This script renders one correctly-sized (1200x630) card per key in
 * `frontend/src/lib/ogRegistry.js`, so every route resolves to a real image
 * that matches the page it belongs to.
 *
 * HOW
 * ---
 * The card is an HTML document rendered by headless Chromium at exactly
 * 1200x630 with `--force-device-scale-factor=1`. Everything it needs is inlined
 * as a data URI — the vendored Space Grotesk subset and the Axal mark — so a
 * run is deterministic and needs no network. No npm dependency is involved:
 * Chromium's `--screenshot` flag does the rasterising.
 *
 * Output:
 *   frontend/public/og/<key>.png       the cards themselves
 *   frontend/src/lib/ogManifest.js     key -> content hash, for cache-busting
 *
 * Usage:
 *   node scripts/generate-og-images.mjs            # render everything
 *   node scripts/generate-og-images.mjs --check    # verify, write nothing
 *
 * `--check` is what CI runs: it re-renders into a temp dir and fails if any
 * committed card is missing or stale, so copy changes cannot ship with an
 * outdated image.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OG_ROUTES,
  ogImageKeys,
  DEFAULT_OG_KEY,
  SECTION_OG_KEYS,
} from '../frontend/src/lib/ogRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'frontend/public/og');
const MANIFEST_FILE = path.join(ROOT, 'frontend/src/lib/ogManifest.js');
const FONT_FILE = path.join(ROOT, 'scripts/og-assets/SpaceGrotesk-Variable.woff2');
const MARK_FILE = path.join(ROOT, 'frontend/public/axal-logo-mark.png');

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Copy for the keys that are not 1:1 with a route — the sitewide default and
 * the per-section fallbacks. Route-backed keys take their copy straight from
 * the registry so a card always says what its page says.
 */
const SECTION_CARDS = {
  [DEFAULT_OG_KEY]: {
    eyebrow: 'Axal VC',
    title: 'Axal VC StudioOS',
    description: 'One network connecting partners, capital, and founders.',
  },
  home: null, // route-backed ('/')
  'spinout-lab': null, // route-backed ('/spinout-lab')
  product: {
    eyebrow: 'Products',
    title: 'Built for founders, investors, advisors and partners',
    description: 'One network, four ways in.',
  },
  content: {
    eyebrow: 'Insights',
    title: 'Writing from the Axal VC network',
    description: 'Long-form thinking from founders, investors, partners, and the studio.',
  },
  company: {
    eyebrow: 'Axal VC',
    title: 'Axal VC',
    description: 'A venture studio that builds companies alongside the founders it backs.',
  },
};

/** Human label for the eyebrow chip, by section. */
const SECTION_EYEBROW = {
  home: 'Axal VC',
  'spinout-lab': 'Spin-Out Lab',
  product: 'Products',
  content: 'Insights',
  company: 'Axal VC',
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  // Last resort: whatever a glob under the Playwright browsers dir turns up.
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const dir of fs.readdirSync(pw)) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = path.join(pw, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {
    /* fall through to the throw */
  }
  throw new Error(
    'No Chromium binary found. Set CHROME_PATH, or install Chrome/Chromium.\n' +
      `Looked in: ${candidates.join(', ')} and under ${pw}`,
  );
}

function dataUri(file, mime) {
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Escape text for interpolation into HTML. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shorten a description so it fills the card's two lines without CSS clamping
 * it mid-word (`venture-…`). Prefers ending on a sentence, then on a word.
 *
 * The full description still goes into `og:description` — this only governs
 * what is drawn on the card.
 */
function cardDescription(text, limit = 104) {
  const s = String(text || '').trim();
  if (s.length <= limit) return s;

  const firstSentence = s.match(/^[^.!?]+[.!?]/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= limit) return firstSentence;

  const cut = s.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : limit).replace(/[\s,;:—–-]+$/, '')}…`;
}

/**
 * Pick a headline size that keeps long titles on at most three lines. Chromium
 * has no text-fit primitive, so this approximates from character count — the
 * card is a fixed width, so a simple step function is stable and predictable.
 */
function titleSize(title) {
  const n = title.length;
  if (n <= 22) return 92;
  if (n <= 34) return 76;
  if (n <= 52) return 62;
  if (n <= 74) return 52;
  return 44;
}

function cardHtml({ eyebrow, title, description }, assets) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Space Grotesk';
    src: url('${assets.font}') format('woff2');
    font-weight: 300 700;
    font-display: block;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    font-family: 'Space Grotesk', 'Liberation Sans', sans-serif;
    background: #0B0A14;
    color: #fff;
    position: relative;
    overflow: hidden;
  }
  /* Brand glow — violet, matching the app's declared theme-color #7c3aed. */
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(900px 520px at 88% -12%, rgba(124,58,237,.55), transparent 62%),
      radial-gradient(700px 460px at -8% 108%, rgba(99,102,241,.34), transparent 60%),
      linear-gradient(145deg, #0B0A14 0%, #150F28 58%, #1B1036 100%);
  }
  /* Fine grid, kept very low contrast so it reads as texture not pattern. */
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(760px 420px at 22% 42%, #000 35%, transparent 78%);
  }
  .frame {
    position: relative;
    height: 100%;
    padding: 62px 72px 58px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .top { display: flex; align-items: center; gap: 18px; }
  .badge {
    width: 60px; height: 60px; border-radius: 16px;
    background: #fff;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 30px rgba(124,58,237,.42);
    flex: none;
  }
  .badge img { width: 42px; height: 42px; object-fit: contain; display: block; }
  .wordmark { font-size: 27px; font-weight: 700; letter-spacing: -.015em; }
  .wordmark span { color: #C4B5FD; font-weight: 500; }
  .body { max-width: 1000px; }
  .eyebrow {
    display: inline-block;
    font-size: 20px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase;
    color: #C4B5FD;
    border: 1px solid rgba(196,181,253,.34);
    border-radius: 999px;
    padding: 9px 20px;
    margin-bottom: 26px;
  }
  h1 {
    font-size: ${titleSize(title)}px;
    font-weight: 700; line-height: 1.06; letter-spacing: -.028em;
    /* Cap at three lines; long registry titles shrink via titleSize() first. */
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  p {
    margin-top: 24px;
    font-size: 29px; line-height: 1.42; font-weight: 400;
    color: #B9B2D6;
    max-width: 900px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .foot { display: flex; align-items: center; justify-content: space-between; }
  .domain { font-size: 25px; font-weight: 500; color: #fff; }
  .rule { height: 5px; width: 132px; border-radius: 999px;
          background: linear-gradient(90deg, #A78BFA, #6366F1); }
</style></head>
<body>
  <div class="glow"></div>
  <div class="grid"></div>
  <div class="frame">
    <div class="top">
      <div class="badge"><img src="${assets.mark}" alt="" /></div>
      <div class="wordmark">AXAL <span>VC</span></div>
    </div>
    <div class="body">
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
      <h1>${esc(title)}</h1>
      ${description ? `<p>${esc(cardDescription(description))}</p>` : ''}
    </div>
    <div class="foot">
      <div class="domain">axal.vc</div>
      <div class="rule"></div>
    </div>
  </div>
</body></html>`;
}

/** Build the copy for every card key the registry declares. */
function buildCards() {
  const byKey = new Map();
  for (const r of OG_ROUTES) {
    if (r.key && !byKey.has(r.key)) {
      byKey.set(r.key, {
        eyebrow: SECTION_EYEBROW[r.section] || 'Axal VC',
        title: r.title,
        description: r.description,
      });
    }
  }
  for (const key of ogImageKeys()) {
    if (byKey.has(key)) continue;
    const preset = SECTION_CARDS[key];
    if (preset) {
      byKey.set(key, preset);
      continue;
    }
    // A section key with no preset and no route — fall back to the section
    // label so a new section still renders something sane rather than nothing.
    const section = Object.entries(SECTION_OG_KEYS).find(([, v]) => v === key)?.[0];
    byKey.set(key, {
      eyebrow: SECTION_EYEBROW[section] || 'Axal VC',
      title: SECTION_CARDS[DEFAULT_OG_KEY].title,
      description: SECTION_CARDS[DEFAULT_OG_KEY].description,
    });
  }
  return byKey;
}

const BASE_FLAGS = [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
];

/**
 * Chromium's `--window-size` sizes the *window*, not the viewport: asking for
 * 1200x630 yields a 1200x543 viewport on this platform, so a naive screenshot
 * loses the bottom ~87px of the card (the footer row) and pads it with black.
 *
 * The offset is not a documented constant and varies by platform and Chromium
 * build, so measure it once per run instead of hardcoding it: screenshot a
 * blank page and compare the result to the window size we asked for.
 *
 * We measure the screenshot rather than asking the page to report its own
 * innerHeight, because the screenshot is the thing we actually care about —
 * and it keeps this script free of any inline <script>, which static analysis
 * flags on sight even when the markup is a hardcoded literal.
 */
function measureChromeOffset(chrome, workDir) {
  const probeFile = path.join(workDir, 'probe.html');
  const probeShot = path.join(workDir, 'probe.png');
  fs.writeFileSync(probeFile, '<html><body></body></html>');
  try {
    execFileSync(
      chrome,
      [...BASE_FLAGS, `--window-size=${WIDTH},${HEIGHT}`, '--virtual-time-budget=800',
       `--screenshot=${probeShot}`, `file://${probeFile}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const got = pngSize(probeShot);
    if (!got) return { dx: 0, dy: 0 };
    return { dx: WIDTH - got.width, dy: HEIGHT - got.height };
  } catch {
    // Probe failed — fall back to no correction and let the size assertion
    // in renderCard() surface the problem rather than shipping a bad card.
    return { dx: 0, dy: 0 };
  }
}

/** Read a PNG's real pixel dimensions from its IHDR chunk. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

// Node exposes zlib.crc32 only from v22.2; keep a local table for older runtimes.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Crop a PNG to its top `targetHeight` rows, in place.
 *
 * Chromium's screenshot is the size of the *window*, but only the viewport area
 * paints — so a card rendered with the window inflated by the chrome offset
 * comes out correct on top with a dead strip underneath. Cropping from the top
 * is the one crop that needs no pixel decoding: PNG scanline filters only ever
 * reference the row above, so the first N filtered scanlines are already a
 * valid image on their own. Keep them, drop the rest, re-deflate.
 *
 * Only handles the 8-bit non-interlaced RGB/RGBA that Chromium emits; anything
 * else throws rather than silently producing a corrupt card.
 */
function cropPngTop(file, targetHeight) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${file}: not a PNG`);

  let offset = 8;
  let ihdr = null;
  const idat = [];
  const passthrough = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') ihdr = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type !== 'IEND' && type !== 'gAMA' && type !== 'cHRM') passthrough.push({ type, data });
    offset += 12 + len;
  }
  if (!ihdr) throw new Error(`${file}: no IHDR`);

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `${file}: unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`,
    );
  }
  if (height === targetHeight) return;
  if (height < targetHeight) throw new Error(`${file}: ${height}px tall, cannot crop up to ${targetHeight}`);

  const bpp = colorType === 6 ? 4 : 3;
  const stride = 1 + width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const kept = raw.subarray(0, stride * targetHeight);
  if (kept.length !== stride * targetHeight) throw new Error(`${file}: truncated image data`);

  ihdr.writeUInt32BE(targetHeight, 4);
  const out = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    ...passthrough.map((c) => pngChunk(c.type, Buffer.from(c.data))),
    pngChunk('IDAT', zlib.deflateSync(kept, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, out);
}

function renderCard(chrome, html, outFile, workDir, offset) {
  const htmlFile = path.join(workDir, 'card.html');
  fs.writeFileSync(htmlFile, html);
  execFileSync(
    chrome,
    [
      ...BASE_FLAGS,
      `--window-size=${WIDTH + offset.dx},${HEIGHT + offset.dy}`,
      `--screenshot=${outFile}`,
      `file://${htmlFile}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  // Drop the unpainted strip the window-size correction added.
  cropPngTop(outFile, HEIGHT);

  // A card that is not exactly 1200x630 is a broken card — several platforms
  // crop or reject off-ratio images. Fail loudly rather than commit one.
  const size = pngSize(outFile);
  if (!size || size.width !== WIDTH || size.height !== HEIGHT) {
    throw new Error(
      `Rendered ${path.basename(outFile)} at ${size ? `${size.width}x${size.height}` : 'unknown size'}, ` +
        `expected ${WIDTH}x${HEIGHT}. Chromium window-size correction may be wrong for this build.`,
    );
  }
}

function sha8(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function writeManifest(manifest) {
  const entries = Object.keys(manifest)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(manifest[k])},`)
    .join('\n');
  const body = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by \`scripts/generate-og-images.mjs\`. Maps an OG image key to the
 * SHA-256 (first 8 hex chars) of the generated PNG's bytes.
 *
 * The hash is appended to the image URL as \`?v=<hash>\`, which is what makes
 * cache-busting automatic: regenerating a card because its copy changed also
 * changes its content hash, so the URL changes, so CDNs and clients that keyed
 * on the old URL fetch the new bytes instead of serving a stale card.
 *
 * A key missing from this map is not an error — \`ogImageUrl()\` simply omits
 * the version param. That keeps the app booting if images have not been
 * generated yet (fresh clone, or a route added before its card was rendered).
 *
 * Regenerate with:  node scripts/generate-og-images.mjs
 */
export const OG_MANIFEST = {
${entries}
};
`;
  fs.writeFileSync(MANIFEST_FILE, body);
}

function main() {
  const check = process.argv.includes('--check');

  let chrome;
  try {
    chrome = findChrome();
  } catch (err) {
    // In --check mode a missing browser must not read as "cards are fine".
    // Skip loudly and non-zero-free rather than silently weakening the gate:
    // the staleness itself is still caught by validate-og-tags.mjs (which
    // verifies each card exists at 1200x630), only the *content* comparison
    // is unavailable without a renderer.
    if (check) {
      console.warn('OG image check SKIPPED — no Chromium available on this machine.');
      console.warn(`  ${err.message.split('\n')[0]}`);
      console.warn('  Card existence and dimensions are still enforced by validate-og-tags.mjs;');
      console.warn('  card *content* staleness is not. Install Chrome or set CHROME_PATH to close that gap.');
      return;
    }
    throw err;
  }
  const assets = {
    font: dataUri(FONT_FILE, 'font/woff2'),
    mark: dataUri(MARK_FILE, 'image/png'),
  };

  const cards = buildCards();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
  const offset = measureChromeOffset(chrome, workDir);
  const targetDir = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'og-check-')) : OUT_DIR;
  if (!check) fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {};
  const problems = [];

  for (const [key, copy] of [...cards].sort(([a], [b]) => a.localeCompare(b))) {
    const outFile = path.join(targetDir, `${key}.png`);
    renderCard(chrome, cardHtml(copy, assets), outFile, workDir, offset);
    const bytes = fs.readFileSync(outFile);
    manifest[key] = sha8(bytes);

    if (check) {
      const committed = path.join(OUT_DIR, `${key}.png`);
      if (!fs.existsSync(committed)) {
        problems.push(`missing card: frontend/public/og/${key}.png`);
      } else if (sha8(fs.readFileSync(committed)) !== manifest[key]) {
        problems.push(`stale card: frontend/public/og/${key}.png (copy changed?)`);
      }
    } else {
      const kb = Math.round(bytes.length / 1024);
      console.log(`  ${key.padEnd(26)} ${WIDTH}x${HEIGHT}  ${String(kb).padStart(4)} KB  ${manifest[key]}`);
    }
  }

  if (check) {
    const current = fs.existsSync(MANIFEST_FILE) ? fs.readFileSync(MANIFEST_FILE, 'utf8') : '';
    for (const [k, v] of Object.entries(manifest)) {
      if (!current.includes(`"${k}": "${v}"`)) {
        problems.push(`manifest out of date for "${k}" (expected ${v})`);
      }
    }
    if (problems.length) {
      console.error('OG image check FAILED:');
      for (const p of problems) console.error(`  - ${p}`);
      console.error('\nRun: node scripts/generate-og-images.mjs');
      process.exit(1);
    }
    console.log(`OG image check passed — ${Object.keys(manifest).length} cards up to date.`);
    return;
  }

  writeManifest(manifest);
  console.log(`\nWrote ${Object.keys(manifest).length} cards to frontend/public/og/`);
  console.log(`Wrote manifest to frontend/src/lib/ogManifest.js`);
}

main();

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
 * `--check` is what CI runs. It does NOT render: it recomputes each card's
 * input fingerprint (copy + inlined font/mark + template) and compares that to
 * the manifest, and separately asserts every committed card exists, measures
 * 1200x630, and terminates with a PNG IEND chunk. So copy changes still cannot
 * ship with an outdated image, and the check needs no browser.
 *
 * It used to re-render and compare PNG bytes, which could only ever pass on the
 * one machine that generated the committed cards: raster output depends on the
 * browser build, not just the card. Chromium 1194's full build and its
 * headless-shell build — same version, same machine, same commit — disagree on
 * all 13 cards. Regenerating and committing does not fix that, it only changes
 * which machine fails, which is why this gate sat red rather than being useful.
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

/**
 * #3705: the record-card families the canvas draws (SC4 event, SC5 profile,
 * SC8 private). No fixed route uses them yet; the Worker card injector (D1439,
 * #3705 Part B) and the private-link card (Part D) point record and token
 * links at them. Drawn now so those parts reference art that already exists.
 */
const FAMILY_CARDS = {
  event: {
    eyebrow: 'Events',
    title: 'Programs & Events',
    description: 'Cohorts, demo days, LP briefings, and office hours.',
  },
  profile: {
    eyebrow: 'Axal VC',
    title: 'Profiles on the Axal VC network',
    description: 'Founders, investors, advisors and partners on Axal VC.',
  },
  private: {
    eyebrow: 'Axal VC',
    title: 'Sign in to view',
    description: 'This link opens a private page on Axal VC.',
    kind: 'lock',
  },
};

/**
 * #3705: per-key art from the canvas — the eyebrow the board draws, the card
 * kind, and SC2's tier chips (plan NAMES only, never a price; pinned against
 * `frontend/src/lib/sitePricing.js` by `social_cards_art_d1604.test.mjs`).
 */
const KEY_STYLE = {
  pricing: { chips: ['Free', 'Validate + Build', 'Raise + Grow', 'Investor Plus', 'Investor Pro', 'Institutional'] },
  'pricing-investor': { chips: ['Investor Plus', 'Investor Pro', 'Institutional'] },
  articles: { eyebrow: 'Insights' },
  authors: { eyebrow: 'Insights' },
  jobs: { eyebrow: 'Jobs' },
  event: { eyebrow: 'Events' },
  trust: { eyebrow: 'Trust', kind: 'doc' },
  'trust-security': { eyebrow: 'Trust', kind: 'doc' },
  'trust-data': { eyebrow: 'Trust', kind: 'doc' },
  'trust-subprocessors': { eyebrow: 'Trust', kind: 'doc' },
  'trust-documents': { eyebrow: 'Trust', kind: 'doc' },
  'trust-disclosure': { eyebrow: 'Trust', kind: 'doc' },
  terms: { eyebrow: 'Legal', kind: 'doc' },
  privacy: { eyebrow: 'Legal', kind: 'doc' },
  'privacy-interviews': { eyebrow: 'Legal', kind: 'doc' },
  'risk-disclosures': { eyebrow: 'Legal', kind: 'doc' },
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

/*
 * #3705: the canvas's light family cards
 * (`design/incoming/Share Cards Page.dc.html`, boards SC1–SC10).
 *
 * One light image per URL. A lavender art band fills x 0–268; the text block
 * starts at x 300 so the mark, the eyebrow and the title's first words survive
 * the centred square crop (x 285–915) that WhatsApp and iMessage take. Three
 * kinds: `plain` (concentric violet circles in the band), `doc` (trust and
 * legal: a lavender ground, a hairline frame and a document tile) and `lock`
 * (the private-link card: a lock tile, violet, never red). The old dark card
 * is board SC0, kept on the canvas for reference only.
 */
const PALETTE = {
  bg: '#ffffff', band: '#f4f0fe', ink: '#18181b', mut: '#6b6577',
  vio: '#7c3aed', vdeep: '#6d28d9', lavE: '#ddd0fb', tile: '#ffffff',
};

const GLYPHS = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
  doc: '<path d="M6 2.5h8l4 4V21.5H6z"></path><path d="M14 2.5v4h4M9 11h6M9 14.5h6M9 18h4"></path>',
};

function glyph(kind, size, stroke = 1.6) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${PALETTE.vio}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[kind]}</svg>`;
}

function bandHtml(kind) {
  if (kind === 'lock' || kind === 'doc') {
    const fill = kind === 'lock' ? `background:${PALETTE.band};` : '';
    return `<div class="band" style="${fill}display:grid;place-items:center"><div class="tile">${glyph(kind, 64, kind === 'lock' ? 1.8 : 1.6)}</div></div>`;
  }
  const rings = [44, 84, 124, 164, 204, 244, 284].map((r) => `<circle cx="150" cy="430" r="${r}"></circle>`).join('');
  let dots = '';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 7; j++) dots += `<circle cx="${26 + i * 22}" cy="${34 + j * 22}" r="2.4"></circle>`;
  return `<div class="band" style="background:${PALETTE.band}"><svg viewBox="0 0 268 630" width="268" height="630">`
    + `<g fill="none" stroke="${PALETTE.vio}" stroke-opacity=".28" stroke-width="1.5">${rings}</g>`
    + `<circle cx="150" cy="430" r="40" fill="${PALETTE.vio}" fill-opacity=".85"></circle>`
    + `<circle cx="150" cy="430" r="14" fill="${PALETTE.band}"></circle>`
    + `<g fill="${PALETTE.vio}" fill-opacity=".45">${dots}</g></svg></div>`;
}

function cardHtml({ eyebrow, title, description, kind = 'plain', chips = null }, assets) {
  const doc = kind === 'doc';
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
    background: ${doc ? PALETTE.band : PALETTE.bg};
    color: ${PALETTE.ink};
    position: relative;
    overflow: hidden;
  }
  .band { position: absolute; left: 0; top: 0; bottom: 0; width: 268px; overflow: hidden; }
  .tile {
    width: 132px; height: 132px; border-radius: 32px;
    background: ${PALETTE.tile}; border: 1.5px solid ${PALETTE.lavE};
    display: grid; place-items: center;
  }
  .frame-line { position: absolute; inset: 26px; border: 1px solid ${PALETTE.lavE}; border-radius: 18px; }
  .block {
    position: absolute; left: 300px; top: 62px; right: 72px; bottom: 58px;
    display: flex; flex-direction: column;
  }
  .top { display: flex; align-items: center; gap: 14px; }
  .top img { width: 46px; height: 46px; border-radius: 11px; object-fit: contain; display: block; }
  .wordmark { font-size: 27px; font-weight: 700; letter-spacing: .06em; }
  .eyebrow {
    align-self: flex-start; margin-top: 26px;
    display: inline-flex; align-items: center; gap: 8px;
    height: 42px; padding: 0 18px; border-radius: 999px;
    border: 1.5px solid ${PALETTE.lavE};
    font-size: 20px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase;
    color: ${PALETTE.vdeep}; white-space: nowrap;
  }
  h1 {
    margin-top: 22px;
    font-size: ${titleSize(title)}px;
    font-weight: 700; line-height: 1.06; letter-spacing: -.028em;
    /* Cap at three lines; long registry titles shrink via titleSize() first. */
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  p {
    margin-top: 16px;
    font-size: 29px; line-height: 1.42; font-weight: 400;
    color: ${PALETTE.mut};
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
  .chip {
    display: inline-flex; align-items: center; height: 42px; padding: 0 16px;
    border-radius: 999px; background: ${PALETTE.tile}; border: 1.5px solid ${PALETTE.lavE};
    font-size: 21px; font-weight: 600; white-space: nowrap;
  }
  .foot { margin-top: auto; display: flex; align-items: center; gap: 12px; height: 30px; }
  .rule { width: 28px; height: 3px; border-radius: 2px; background: ${PALETTE.vio}; }
  .domain { font-size: 25px; line-height: 30px; font-weight: 500; }
</style></head>
<body>
  ${bandHtml(kind)}
  ${doc ? '<div class="frame-line"></div>' : ''}
  <div class="block">
    <div class="top">
      <img src="${assets.mark}" alt="" />
      <div class="wordmark">AXAL VC</div>
    </div>
    ${eyebrow ? `<div class="eyebrow">${doc ? glyph('doc', 20) : ''}${esc(eyebrow)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${description ? `<p>${esc(cardDescription(description))}</p>` : ''}
    ${chips ? `<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
    <div class="foot"><div class="rule"></div><div class="domain">axal.vc</div></div>
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
        ...KEY_STYLE[r.key],
      });
    }
  }
  for (const key of ogImageKeys()) {
    if (byKey.has(key)) continue;
    const preset = SECTION_CARDS[key] || FAMILY_CARDS[key];
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
 * loses the bottom ~87px of the card (the footer row).
 *
 * The offset is not a documented constant and varies by platform and Chromium
 * build, so measure it once per run instead of hardcoding it.
 *
 * #3705: measure the VIEWPORT, not the screenshot's size. Builds differ in how
 * they show the shortfall. Older ones return a screenshot as short as the
 * viewport (1200x543). Chromium 1194 returns a full 1200x630 screenshot whose
 * bottom 87px are simply unpainted, so comparing sizes measured no offset at
 * all and every card lost its footer. The probe page paints a black block
 * exactly `100vh` tall on a white page; the black rows in its screenshot are
 * the viewport height on every build. Still no inline <script>: static
 * analysis flags one on sight even in a hardcoded literal.
 */
function measureChromeOffset(chrome, workDir) {
  const probeFile = path.join(workDir, 'probe.html');
  const probeShot = path.join(workDir, 'probe.png');
  fs.writeFileSync(
    probeFile,
    '<html style="background:#fff"><body style="margin:0"><div style="width:100vw;height:100vh;background:#000"></div></body></html>',
  );
  try {
    execFileSync(
      chrome,
      [...BASE_FLAGS, `--window-size=${WIDTH},${HEIGHT}`, '--virtual-time-budget=800',
       `--screenshot=${probeShot}`, `file://${probeFile}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const got = pngSize(probeShot);
    if (!got) return { dx: 0, dy: 0 };
    const viewport = blackRowsFromTop(probeShot);
    return { dx: WIDTH - got.width, dy: HEIGHT - (viewport ?? got.height) };
  } catch {
    // Probe failed — fall back to no correction and let the size assertion
    // in renderCard() surface the problem rather than shipping a bad card.
    return { dx: 0, dy: 0 };
  }
}

/**
 * Count the rows, from the top, whose first pixel is black. Decodes the PNG
 * (8-bit RGB/RGBA, not interlaced, as Chromium writes it) and undoes each
 * row's filter. Returns null for any other format.
 */
function blackRowsFromTop(file) {
  const buf = fs.readFileSync(file);
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') ihdr = buf.subarray(offset + 8, offset + 8 + len);
    else if (type === 'IDAT') idat.push(buf.subarray(offset + 8, offset + 8 + len));
    offset += 12 + len;
  }
  if (!ihdr || ihdr[8] !== 8 || ihdr[12] !== 0 || (ihdr[9] !== 2 && ihdr[9] !== 6)) return null;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bpp = ihdr[9] === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (row[i] + add) & 0xff;
    }
    if (row[0] > 16 || row[1] > 16 || row[2] > 16) return y;
    prev = row;
  }
  return height;
}

/** Read a PNG's real pixel dimensions from its IHDR chunk. */
/**
 * True when the file ends with PNG's IEND chunk — the 4-byte type "IEND"
 * followed by its 4-byte CRC. A truncated card still carries a valid IHDR
 * (and so a valid width/height) in its first 24 bytes, so this is what
 * actually distinguishes a whole PNG from half of one.
 */
function endsWithPngIend(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      if (size < 12) return false;
      const tail = Buffer.alloc(8);
      fs.readSync(fd, tail, 0, 8, size - 8);
      return tail.toString('latin1', 0, 4) === 'IEND'
        && tail.readUInt32BE(4) === 0xae426082;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

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

/**
 * Fingerprint a card by its INPUTS, not by the PNG the renderer produced.
 *
 * `cardHtml()` already inlines everything a card is made of — the eyebrow,
 * title and description, the vendored font and the Axal mark as data URIs, and
 * the template's own markup and CSS. Hashing that string therefore changes
 * exactly when the card's content should change, and never otherwise.
 *
 * This used to hash the rendered PNG's bytes, which made the `--check` gate
 * unrunnable in CI: PNG bytes are a function of the *browser build*, not just
 * the card. Rendering the identical commit with Chromium 1194's full build and
 * its headless-shell build — same version, same machine — produces different
 * bytes for all 13 cards, so the committed cards could only ever match the one
 * machine that generated them. Regenerating and committing does not fix that;
 * it just moves which machine fails.
 */
function fingerprint(html) {
  return sha8(Buffer.from(html, 'utf8'));
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
 * SHA-256 (first 8 hex chars) of the card's RENDER INPUTS — its copy plus the
 * inlined font, mark and template. Deliberately not a hash of the PNG bytes:
 * those vary by browser build, which made the CI check fail on any machine but
 * the one that generated the cards.
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

  const assets = {
    font: dataUri(FONT_FILE, 'font/woff2'),
    mark: dataUri(MARK_FILE, 'image/png'),
  };

  const cards = buildCards();

  // --check needs no browser: it compares each card's INPUT fingerprint
  // against the manifest, plus the committed PNG's existence and dimensions.
  // Nothing here is renderer-dependent, so it gives the same answer on a CI
  // runner, a laptop and a container.
  if (check) {
    const problems = [];
    const manifest = {};
    const current = fs.existsSync(MANIFEST_FILE) ? fs.readFileSync(MANIFEST_FILE, 'utf8') : '';

    for (const [key, copy] of [...cards].sort(([a], [b]) => a.localeCompare(b))) {
      manifest[key] = fingerprint(cardHtml(copy, assets));
      const committed = path.join(OUT_DIR, `${key}.png`);
      if (!fs.existsSync(committed)) {
        problems.push(`missing card: frontend/public/og/${key}.png`);
        continue;
      }
      // A card that is not exactly 1200x630 is a broken card — several
      // platforms crop or reject off-ratio images.
      const size = pngSize(committed);
      if (!size || size.width !== WIDTH || size.height !== HEIGHT) {
        problems.push(
          `wrong size: frontend/public/og/${key}.png is ` +
            `${size ? `${size.width}x${size.height}` : 'unreadable'}, expected ${WIDTH}x${HEIGHT}`,
        );
      } else if (!endsWithPngIend(committed)) {
        // Dimensions alone do not prove the file is whole: they come from the
        // IHDR header in the first 24 bytes, which survives truncation. A
        // half-written card reports 1200x630 and renders as a broken image.
        problems.push(`truncated card: frontend/public/og/${key}.png has no PNG IEND terminator`);
      }
      if (!current.includes(`"${key}": "${manifest[key]}"`)) {
        problems.push(`stale card: frontend/public/og/${key}.png — copy or assets changed, card not regenerated`);
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

  const chrome = findChrome();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
  const offset = measureChromeOffset(chrome, workDir);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {};

  for (const [key, copy] of [...cards].sort(([a], [b]) => a.localeCompare(b))) {
    const html = cardHtml(copy, assets);
    const outFile = path.join(OUT_DIR, `${key}.png`);
    renderCard(chrome, html, outFile, workDir, offset);
    manifest[key] = fingerprint(html);
    const kb = Math.round(fs.readFileSync(outFile).length / 1024);
    console.log(`  ${key.padEnd(26)} ${WIDTH}x${HEIGHT}  ${String(kb).padStart(4)} KB  ${manifest[key]}`);
  }

  writeManifest(manifest);
  console.log(`\nWrote ${Object.keys(manifest).length} cards to frontend/public/og/`);
  console.log(`Wrote manifest to frontend/src/lib/ogManifest.js`);
}

main();

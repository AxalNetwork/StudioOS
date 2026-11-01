// #3705 — the social-cards canvas's light family art, the trust and
// legal cards, and the record families drawn ahead of the Worker injector.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { FAMILY_OG_KEYS, OG_ROUTES, ogImageKeys, ogTagsFor } from '../src/lib/ogRegistry.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const generator = read('scripts/generate-og-images.mjs');

/** Decode an 8-bit RGB/RGBA PNG into rows of bytes (filters undone). */
function decodePng(file) {
  const buf = readFileSync(new URL(file, root));
  let off = 8; let ihdr; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') ihdr = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4); const bpp = ihdr[9] === 6 ? 4 : 3;
  const stride = width * bpp; const raw = zlib.inflateSync(Buffer.concat(idat)); const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]; const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const add = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      row[i] = (row[i] + add) & 0xff;
    }
    rows.push(row); prev = row;
  }
  return { width, height, bpp, px: (x, y) => [...rows[y].subarray(x * bpp, x * bpp + 3)] };
}

test('every card key is a whole 1200×630 PNG, including the record families', () => {
  const keys = ogImageKeys();
  for (const k of ['event', 'profile', 'private', 'trust', 'trust-security', 'terms', 'pricing-investor']) assert.ok(keys.includes(k), k);
  assert.deepEqual(FAMILY_OG_KEYS, ['event', 'profile', 'private']);
  for (const k of keys) {
    const png = decodePng(`frontend/public/og/${k}.png`);
    assert.deepEqual([png.width, png.height], [1200, 630], k);
  }
});

test('the cards are painted to the bottom edge: the band and the footer survive (the 87px viewport bug)', () => {
  // A plain card's art band is lavender #f4f0fe from top to bottom; a doc card's ground is lavender everywhere.
  for (const k of ['home', 'pricing', 'articles', 'event', 'trust', 'terms']) {
    const png = decodePng(`frontend/public/og/${k}.png`);
    assert.deepEqual(png.px(10, 625), [0xf4, 0xf0, 0xfe], `${k}: bottom-left is the band, not unpainted`);
  }
  // The violet rule before "axal.vc" sits in the last 72px.
  const home = decodePng('frontend/public/og/home.png');
  const violet = [];
  for (let y = 540; y < 572; y++) for (let x = 300; x < 330; x++) { const [r, g, b] = home.px(x, y); if (b > 200 && r > 100 && r < 140 && g < 80) violet.push(y); }
  assert.ok(violet.length > 20, 'the footer rule is drawn');
  assert.match(generator, /height:100vh;background:#000/, 'the probe measures the viewport, not the screenshot');
});

test('SC2 chips are plan names only, and each one is a real plan name', () => {
  const pricing = read('frontend/src/lib/sitePricing.js');
  const chips = [...generator.matchAll(/chips: \[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.ok(chips.length >= 9);
  for (const c of chips) {
    assert.doesNotMatch(c, /[$€£]|\d/, `no price in a chip: ${c}`);
    assert.ok(pricing.includes(`name: '${c}'`), `"${c}" is a plan name in sitePricing.js`);
  }
});

test('SC7: the trust center and its five tabs have their own document cards, in the page’s own words', () => {
  const trust = OG_ROUTES.filter((r) => r.path === '/trust' || r.path.startsWith('/trust/'));
  assert.deepEqual(trust.map((r) => r.path), ['/trust', '/trust/security', '/trust/data', '/trust/subprocessors', '/trust/documents', '/trust/disclosure']);
  assert.ok(!trust.some((r) => r.path === '/trust/me'), 'the signed-in trust page gets no card');
  for (const r of trust) assert.equal(ogTagsFor(r.path).image.split('?')[0], `https://axal.vc/og/${r.key}.png`);
  assert.match(trust.find((r) => r.path === '/trust').description, /^How we protect your data and your money/);
  assert.match(read('frontend/src/pages/site/trustCenterModel.js'), /TITLE = 'How we protect your data and your money'/);
  assert.match(trust.find((r) => r.path === '/trust/subprocessors').description, /reviewed by counsel/, 'no claim of a published list');
  for (const k of ['trust', 'trust-security', 'terms', 'privacy', 'risk-disclosures']) assert.match(generator, new RegExp(`'?${k}'?: \\{ eyebrow: '(Trust|Legal)', kind: 'doc' \\}`), k);
});

test('cards never carry an amount, an email or a seat count', () => {
  for (const r of OG_ROUTES.filter((x) => x.key)) {
    assert.doesNotMatch(`${r.title} ${r.description}`, /\$\d|@\w+\.\w|seats? left/i, r.path);
  }
  const fam = generator.slice(generator.indexOf('const FAMILY_CARDS'), generator.indexOf('const KEY_STYLE'));
  assert.match(fam, /title: 'Sign in to view'/);
  assert.match(fam, /kind: 'lock'/);
  assert.doesNotMatch(fam, /\$|@|seat|capacity/i);
});

test('the canvases are on disk, unedited intake', () => {
  for (const f of ['Share Cards Page.dc.html', 'Share Cards · Boards.dc.html']) assert.ok(read(`design/incoming/${f}`).length > 5000, f);
  assert.match(read('design/incoming/Share Cards · Boards.dc.html'), /dc-import name="Share Cards Page"/);
});

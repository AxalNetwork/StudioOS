#!/usr/bin/env node
/**
 * D7121 part 2 (#7121) — build the committed Wellness PDF from its source.
 *
 * The same pipeline as `scripts/build-program-briefs.mjs` (D6966): Playwright's Chromium prints
 * the deck's HTML to `frontend/public/program-briefs/axal-vc-wellness-v1.pdf` — 16:9,
 * 13.333 × 7.5 in, one slide per page, text kept as selectable text, the legal paper's faces
 * embedded and subset, links live, tagged, with a document outline. Wellness is not in the kit's
 * `programs/catalog/` (its page is `pages/wellbeing/WellnessPresentationPage.jsx`, D7121 part 1)
 * and its slides draw the private bracket and the planned box the kit's blocks have no type for,
 * so the deck is `frontend/src/pages/wellbeing/wellnessDeck.js` and this script prints it.
 *
 *   node scripts/build-wellness-brief.mjs                 # the committed PDF
 *   node scripts/build-wellness-brief.mjs --gray --out DIR  # the grayscale print sheet, elsewhere
 *   node scripts/build-wellness-brief.mjs --html DIR      # also write the deck's HTML, to look at
 *
 * The cover's image is the owner's dawn image, `frontend/public/axal-vc-future.png`, re-encoded
 * as a JPEG at most 1536 wide (its own width) (Chromium would embed the PNG as a raw Flate image). Set `PW_CHROMIUM_PATH`
 * when the installed Chromium is not the one Playwright pins.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const GRAY = args.includes('--gray');
const OUT = opt('--out');
const HTML_DIR = opt('--html');

const PAPER = join(ROOT, 'cloudflare-worker/src/templates/legal/paper');
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const face = (family, weight, file) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(${dataUri(join(PAPER, file), 'font/woff2')}) format('woff2');}`;
const FACES = [
  face('Public Sans', 400, 'public-sans-400.woff2'),
  face('Public Sans', 700, 'public-sans-700.woff2'),
  face('Bricolage Grotesque', 800, 'bricolage-grotesque-800.woff2'),
  face('Space Grotesk', 700, 'space-grotesk-700.woff2'),
].join('\n');
const MARK = dataUri(join(ROOT, 'frontend/public/axal-mark.png'), 'image/png');
const ART = dataUri(join(ROOT, 'frontend/public/axal-vc-future.png'), 'image/png');
const WORDMARK = '.d-logo b{font-family:"Space Grotesk",sans-serif;font-weight:700;}';

/** The cover image as a JPEG at most 1536 wide (its own width) data URI, re-encoded in the browser. */
async function asJpeg(browser, uri) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const w = Math.min(1536, img.naturalWidth);
      const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#1d1530';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.7);
    }, uri);
  } finally {
    await page.close();
  }
}

async function main() {
  const require = createRequire(join(ROOT, 'package.json'));
  const { chromium } = require('playwright');
  const { WELLNESS_PRESENTATION: entry } = await import(pathToFileURL(join(ROOT, 'frontend/src/pages/wellbeing/wellnessPresentation.js')).href);
  const { wellnessDeckHtml, WELLNESS_DECK_CSS } = await import(pathToFileURL(join(ROOT, 'frontend/src/pages/wellbeing/wellnessDeck.js')).href);
  const exe = process.env.PW_CHROMIUM_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    let body = wellnessDeckHtml(entry, { gray: GRAY }).replaceAll('{{MARK}}', MARK);
    if (body.includes('{{ART}}')) body = body.replaceAll('{{ART}}', await asJpeg(browser, ART));
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${entry.name} · Axal VC · ${entry.edition}</title>`
      + `<style>${FACES}\n${WELLNESS_DECK_CSS}\n${WORDMARK}</style></head><body>${body}</body></html>`;
    if (HTML_DIR) {
      mkdirSync(HTML_DIR, { recursive: true });
      writeFileSync(join(HTML_DIR, `${entry.key}${GRAY ? '-gray' : ''}.html`), html);
    }
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const name = entry.pdf.split('/').pop();
    const target = OUT ? join(OUT, GRAY ? name.replace(/\.pdf$/, '-gray.pdf') : name) : join(ROOT, entry.pdfFile);
    mkdirSync(dirname(target), { recursive: true });
    // 1920 CSS px across 13.333 in (1280 px at 96 dpi): scale 2/3, so every slide fills its page.
    await page.pdf({
      path: target, width: '13.333in', height: '7.5in', scale: 2 / 3, printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }, tagged: true, outline: true,
    });
    await page.close();
    console.log(`${entry.key}: ${target.replace(`${ROOT}/`, '')} (${readFileSync(target).length.toLocaleString('en-US')} bytes, ${entry.slides} slides)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

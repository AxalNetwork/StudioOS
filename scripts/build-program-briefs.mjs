#!/usr/bin/env node
/**
 * D6966 (#6966) — build the committed program PDFs from their source.
 *
 * For each program in the presentation map (`frontend/src/pages/programs/catalog/*.js`) this renders
 * its slides (`frontend/src/pages/programs/deck.js` over `content/<key>.js`, styled by
 * its `DECK_CSS`) with Playwright's Chromium and writes
 * `frontend/public/<the entry's pdf path>`: 16:9, 13.333 × 7.5 in, one slide per page, text kept
 * as selectable text, the faces embedded and subset, links live, tagged, with a document
 * outline. The PDF reads nothing live: no cohort, date or place is ever in it.
 *
 *   node scripts/build-program-briefs.mjs                 # every program
 *   node scripts/build-program-briefs.mjs spinout-lab     # one program
 *   node scripts/build-program-briefs.mjs --gray --out DIR  # the grayscale print sheet, elsewhere
 *   node scripts/build-program-briefs.mjs --html DIR      # also write each deck's HTML, to look at
 *
 * The faces are the legal paper's subsets (`cloudflare-worker/src/templates/legal/paper/`,
 * committed as full blobs, OFL 1.1): Public Sans 400 and 700, Bricolage Grotesque 800 and
 * Space Grotesk 700 for the wordmark. Chromium is Playwright's; set `PW_CHROMIUM_PATH` when the
 * installed build is not the one Playwright pins (as `frontend/tests/visual` does).
 *
 * The content modules import app code (`lib/spinoutLab.js`), so the script registers the same
 * JSX/extensionless loader the frontend tests use before it imports them.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { loadProgramCatalog, pdfFileOf } from './lib/programCatalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(join(ROOT, 'frontend/test/_deck-loader-hook.mjs')));

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const GRAY = flag('--gray');
const OUT = opt('--out');
const HTML_DIR = opt('--html');
const only = args.filter((a, i) => !a.startsWith('--') && !['--out', '--html'].includes(args[i - 1]));

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
const WORDMARK = '.d-logo b{font-family:"Space Grotesk",sans-serif;font-weight:700;}';

/** The cover art: the site's own artwork, from `frontend/public/site/`, never anything else. */
function artUri(name) {
  if (!name) return '';
  if (!/^[a-z0-9-]+\.(webp|png|jpg)$/.test(name)) throw new Error(`cover art "${name}" is not a file name under frontend/public/site/`);
  const file = join(ROOT, 'frontend/public/site', name);
  if (!existsSync(file)) throw new Error(`cover art ${name} is not in frontend/public/site/`);
  return dataUri(file, name.endsWith('.webp') ? 'image/webp' : name.endsWith('.png') ? 'image/png' : 'image/jpeg');
}

/**
 * The art as a JPEG data URI, re-encoded in the browser: Chromium writes a WebP or PNG into a
 * PDF as a raw Flate image (1.4 MB for the Lab's cover), and a JPEG as itself.
 */
async function asJpeg(browser, uri) {
  if (!uri) return '';
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.fillStyle = '#1a1328';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.8);
    }, uri);
  } finally {
    await page.close();
  }
}

async function launch() {
  const require = createRequire(join(ROOT, 'package.json'));
  const { chromium } = require('playwright');
  const exe = process.env.PW_CHROMIUM_PATH;
  return chromium.launch(exe ? { executablePath: exe } : {});
}

async function main() {
  const programs = (await loadProgramCatalog()).filter((p) => !only.length || only.includes(p.key));
  if (only.length && programs.length !== only.length) throw new Error(`no map entry for: ${only.filter((k) => !programs.some((p) => p.key === k)).join(', ')}`);
  // D7121: the approved Wellness deck has its own diagram renderer and builder.
  if (programs.some((p) => p.key === 'wellness')) {
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts/build-wellness-brief.mjs'),
      ...(GRAY ? ['--gray'] : []), ...(OUT ? ['--out', resolve(OUT)] : []), ...(HTML_DIR ? ['--html', resolve(HTML_DIR)] : [])],
    { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Wellness PDF build failed');
  }
  const standard = programs.filter((p) => p.key !== 'wellness');
  if (!standard.length) return;
  const { deckHtml, DECK_CSS: CSS } = await import(pathToFileURL(join(ROOT, 'frontend/src/pages/programs/deck.js')).href);
  const browser = await launch();
  try {
    for (const program of standard) {
      const content = (await import(pathToFileURL(join(ROOT, `frontend/src/pages/programs/content/${program.key}.js`)).href)).default;
      const body = deckHtml(program, content, { gray: GRAY })
        .replaceAll('{{MARK}}', MARK)
        .replaceAll('{{ART}}', await asJpeg(browser, artUri(content.cover?.art)));
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${program.name} · Axal VC · ${program.edition}</title>`
        + `<style>${FACES}\n${CSS}\n${WORDMARK}</style></head><body>${body}</body></html>`;
      if (HTML_DIR) {
        mkdirSync(HTML_DIR, { recursive: true });
        writeFileSync(join(HTML_DIR, `${program.key}${GRAY ? '-gray' : ''}.html`), html);
      }
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const target = OUT ? join(OUT, program.file.replace(/\.pdf$/, GRAY ? '-gray.pdf' : '.pdf')) : pdfFileOf(program);
      mkdirSync(dirname(target), { recursive: true });
      // 1920 CSS px across 13.333 in (1280 px at 96 dpi): scale 2/3, so every slide fills its page.
      await page.pdf({
        path: target, width: '13.333in', height: '7.5in', scale: 2 / 3, printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }, tagged: true, outline: true,
      });
      await page.close();
      const bytes = readFileSync(target);
      console.log(`${program.key}: ${target.replace(`${ROOT}/`, '')} (${bytes.length.toLocaleString('en-US')} bytes, ${program.slides} slides)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

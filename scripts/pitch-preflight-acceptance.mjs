#!/usr/bin/env node
/**
 * #3661 (D1370) — the preflight acceptance run, in a real browser. It bundles
 * `scripts/pitch-preflight-acceptance.entry.jsx` (the product's own preflight
 * code on the deliberately defective synthetic deck,
 * `frontend/test/fixtures/pitch_preflight_defective.mjs`), opens it in the
 * pre-installed Playwright Chromium with the built stylesheet (`docs/`), and
 * checks, at desktop (1440 × 900) and phone (390 × 844) widths, light and dark:
 *
 *   1. measured, not guessed: the long body on slide 1 is cut off at export size
 *      in the browser's real layout, and blocks the export;
 *   2. PF3: Show me draws that finding on its slide, outlined, with the edge it
 *      overflows marked; the contrast finding shows its colour pair and ratio;
 *   3. the gate before Export holds "Export anyway" back while something is to fix;
 *   4. keyboard: every button in the panel is reached by Tab, in the order the
 *      findings are listed, and each has an accessible name;
 *   5. screen readers: each finding is a list item named like "Slide 1, body,
 *      the text is cut off at export size".
 *
 * Every slide of the fixture lays out in a real browser, so no slide is "Couldn't
 * check" here: pf5c's per-slide Try again is `frontend/test/pitch_preflight_overlay_3661.test.mjs`'s.
 *
 * WHAT IT CANNOT PROVE. The exported files: the PDF and PowerPoint are made on
 * the Worker (Browser Rendering), which this run does not reach; the fixed deck's
 * export is `cloudflare-worker/test/pitch_preflight_export_3661.test.ts`, and the
 * live export is `scripts/pitch-acceptance-live.mjs`. A screenshot is for a person
 * to compare with the PF1–PF5 boards.
 *
 *   npm run build && node scripts/pitch-preflight-acceptance.mjs [out-dir]
 *
 * Exit 0: every check passed. Exit 1: a check failed. Exit 2: it could not run
 * (no build, no browser) and verified nothing.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(process.argv[2] || join(ROOT, 'pitch-preflight-acceptance-out'));

function stop(code, message) {
  console.error(message);
  process.exit(code);
}

const html = existsSync(join(ROOT, 'docs/index.html')) ? readFileSync(join(ROOT, 'docs/index.html'), 'utf8') : null;
const css = html && (html.match(/assets\/index-[^"]+\.css/) || [])[0];
if (!css || !existsSync(join(ROOT, 'docs', css))) stop(2, 'No built stylesheet: run `npm run build` first (D529). Nothing was verified.');

let esbuild;
let chromium;
try { esbuild = await import('esbuild'); } catch { stop(2, 'esbuild is not installed. Nothing was verified.'); }
try { ({ chromium } = await import('playwright')); } catch { stop(2, 'Playwright is not installed. Nothing was verified.'); }

mkdirSync(OUT, { recursive: true });
await esbuild.build({
  entryPoints: [join(ROOT, 'scripts/pitch-preflight-acceptance.entry.jsx')],
  bundle: true, format: 'iife', outfile: join(OUT, 'bundle.js'), jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, logLevel: 'error',
  nodePaths: [join(ROOT, 'frontend/node_modules'), join(ROOT, 'node_modules')],
  // One React: the frontend's own, which the components import.
  alias: { react: join(ROOT, 'frontend/node_modules/react'), 'react-dom': join(ROOT, 'frontend/node_modules/react-dom') },
});
copyFileSync(join(ROOT, 'docs', css), join(OUT, 'app.css'));
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"><title>Preflight acceptance</title></head><body class="bg-axal-ground dark:bg-gray-950"><div id="root"></div><script src="bundle.js"></script></body></html>`);

const results = [];
const check = (key, ok, detail) => { results.push({ key, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${key}${detail ? ` — ${detail}` : ''}`); };

let browser;
// The repo may pin a Playwright whose own browser is not installed: fall back to the pre-installed Chromium.
const PREINSTALLED = '/opt/pw-browsers/chromium';
try { browser = await chromium.launch(); } catch (e) {
  try { browser = existsSync(PREINSTALLED) ? await chromium.launch({ executablePath: PREINSTALLED, args: ['--no-sandbox'] }) : null; } catch { browser = null; }
  if (!browser) stop(2, `The browser did not start (${String(e.message).split('\n')[0]}). Nothing was verified.`);
}
const VIEWS = [
  { key: 'desktop', width: 1440, height: 900, dark: false },
  { key: 'phone', width: 390, height: 844, dark: false },
  { key: 'desktop-dark', width: 1440, height: 900, dark: true },
];
try {
  for (const v of VIEWS) {
    const page = await browser.newPage({ viewport: { width: v.width, height: v.height }, colorScheme: v.dark ? 'dark' : 'light' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(join(OUT, 'index.html')).href);
    if (v.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForFunction(() => window.__pf?.done, null, { timeout: 30_000 });
    await page.waitForTimeout(600); // the panel slides in
    const pf = await page.evaluate(() => window.__pf);
    check(`${v.key}: the page drew without errors`, errors.length === 0, errors.join(' | '));

    const clip = pf.findings.find((f) => f.check === 'overflow' && f.card === 0 && f.block === 'b2');
    check(`${v.key}: 1. the long body on slide 1 is measured cut off and blocks the export`, clip && clip.severity === 'blocking', clip ? clip.title : 'no overflow finding');
    check(`${v.key}: 1. every slide was drawn (no "Couldn't check" for a whole slide)`, pf.failed.length === 0, `failed: ${JSON.stringify(pf.failed)}`);
    await page.screenshot({ path: join(OUT, `${v.key}-panel.png`), fullPage: true });

    // 4 and 5: the panel's buttons by Tab, and each finding's name.
    const names = await page.evaluate(() => [...document.querySelectorAll('[data-testid="pitch-preflight"] button')]
      .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()));
    check(`${v.key}: 4. every panel button has an accessible name`, names.length > 0 && names.every(Boolean), `${names.length} buttons`);
    const order = [];
    await page.evaluate(() => document.activeElement?.blur?.());
    // Tab until the focus comes round again (or 300 presses): the whole order, once.
    for (let i = 0; i < 300; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute?.('data-testid') || null);
      if (id && order.length && id === order[0]) break;
      if (id) order.push(id);
    }
    const shows = order.filter((id) => /^pitch-preflight-row-.*-show$/.test(id));
    const listed = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="pitch-preflight-row-"][data-testid$="-show"]')].map((n) => n.getAttribute('data-testid')));
    check(`${v.key}: 4. Tab reaches every Show me, in the order the findings are listed`, shows.length === listed.length && shows.every((id, i) => id === listed[i]), `${shows.length} of ${listed.length} reached`);
    const label = await page.evaluate(() => document.querySelector('[data-testid="pitch-preflight-fix"] li')?.getAttribute('aria-label') || '');
    check(`${v.key}: 5. a finding is a list item with its spoken name`, /^Slide \d+, [a-z ]+, .+/.test(label), label);

    // 2. PF3 on the slide.
    await page.evaluate((id) => window.__show(id), clip?.id);
    await page.waitForSelector('[data-testid="pitch-preflight-overlay"]');
    await page.waitForTimeout(150);
    const edge = await page.evaluate(() => document.querySelector('[data-testid="pitch-preflight-overlay-edge"]')?.getAttribute('data-edge') || null);
    const outlined = await page.evaluate(() => Boolean(document.querySelector('[data-testid="pitch-preflight-overlay-outline"]')));
    check(`${v.key}: 2. the cut-off block is outlined on its slide, its overflowing edge marked`, outlined && Boolean(edge), `edge: ${edge}`);
    await page.screenshot({ path: join(OUT, `${v.key}-pf3-clip.png`), fullPage: true });
    const contrast = pf.findings.find((f) => f.check === 'contrast' && f.pair);
    await page.evaluate((id) => window.__show(id), contrast?.id);
    await page.waitForSelector('[data-testid="pitch-preflight-pair"]');
    const ratio = await page.textContent('[data-testid="pitch-preflight-pair-ratio"]');
    check(`${v.key}: 2. the contrast finding shows its colour pair and ratio`, Boolean(contrast) && / : 1$/.test(ratio || ''), ratio);
    await page.screenshot({ path: join(OUT, `${v.key}-pf3-contrast.png`), fullPage: true });

    // 3. the gate before Export.
    await page.evaluate(() => window.__view('gate'));
    await page.waitForTimeout(600); // the sheet slides in
    const gateText = await page.evaluate(() => document.body.innerText);
    check(`${v.key}: 3. Export anyway is held back while something is to fix`, /Export anyway opens once the \d+ items? to fix/.test(gateText), '');
    await page.screenshot({ path: join(OUT, `${v.key}-gate.png`), fullPage: true });

    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
writeFileSync(join(OUT, 'matrix.md'), [
  '| Check | Result | Detail |', '| --- | --- | --- |',
  ...results.map((r) => `| ${r.key} | ${r.ok ? 'pass' : '**fail**'} | ${String(r.detail || '').replace(/\|/g, '/')} |`),
  '| Exported PDF and PowerPoint of the deck | not tested here | Made on the Worker; see pitch_preflight_export_3661 and pitch-acceptance-live.mjs |',
].join('\n') + '\n');
console.log(`${results.length - failed.length} of ${results.length} checks passed. Screenshots and matrix.md in ${OUT}`);
process.exit(failed.length ? 1 : 0);

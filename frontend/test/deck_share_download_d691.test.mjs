/**
 * D691 (#1700) test 16 — the share viewer honours a link's download setting.
 *
 * Decision 5: a link can be made with download off. The share read returns
 * `allow_download`, and the viewer hides Save as PDF when it is false. An older
 * link sends no field and keeps the button. The deck is drawn in the browser,
 * so this stops neither a screenshot nor the browser's own print, and the page
 * does not claim it does.
 *
 * The refusal hint no longer says links are single-use or last 72 hours: since
 * D691 a link opens as often as it is used, and lasts 7, 14 or 30 days or has
 * no end.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_share_download_d691.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canSavePdf } from '../src/pages/PitchDeckPrintPage.jsx';

const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/PitchDeckPrintPage.jsx'), 'utf8');

test('16: in share mode Save as PDF is hidden with allow_download false, and drawn with true or with the field absent', () => {
  assert.equal(canSavePdf(true, { allow_download: false }), false);
  assert.equal(canSavePdf(true, { allow_download: true }), true);
  assert.equal(canSavePdf(true, {}), true, 'an older link sends no field and keeps the button');
  assert.equal(canSavePdf(true, null), true);
  // Outside share mode (the founder's own export) the button is always there.
  assert.equal(canSavePdf(false, { allow_download: false }), true);
});

test('16: the button is drawn only through canSavePdf', () => {
  const at = page.indexOf("'Save as PDF'");
  assert.ok(at > 0, 'the button is still on the page');
  const before = page.slice(Math.max(0, at - 900), at);
  assert.match(before, /\{canSavePdf\(shareMode, deck\) && \(\s*<button/);
  assert.equal(page.match(/'Save as PDF'/g)?.length, 1, 'one Save as PDF, behind the check');
});

test('16: the refusal hint no longer says links are single-use or last 72 hours', () => {
  // The hint the error state draws in share mode, as rendered text.
  const at = page.indexOf("This deck isn't available");
  assert.ok(at > 0);
  const block = page.slice(at, page.indexOf('</div>', at));
  const shown = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].trim()).join(' ');
  assert.match(shown, /Ask the founder for a fresh link\./);
  assert.doesNotMatch(shown, /single-use|72 hours|expire/i);
});

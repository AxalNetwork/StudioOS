/**
 * D4812 (#4812, part 8) — work package 7, the type sizes, held across every
 * Fund Admin file: no working text under 12px. The one exception is the
 * uppercase eyebrow (a table header, a panel label, a tile's key), which the
 * issue sets at 11–12px and this console draws at 11px. The shared parts carry
 * the sizes the canvas asks for: table and row text 13–14px, metadata 12px.
 *
 *   node --test frontend/test/fund_admin_type_d4812.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'frontend/src/pages/admin/fundAdmin');
const FILES = readdirSync(DIR).filter((f) => /\.(jsx|js)$/.test(f));
const read = (f) => readFileSync(join(DIR, f), 'utf8');

/** Every `text-[Npx]` in a file with the class string it sits in, read up to the next quote or backtick. */
function sizes(src) {
  const out = [];
  for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
    const from = Math.max(src.lastIndexOf("'", m.index), src.lastIndexOf('"', m.index), src.lastIndexOf('`', m.index));
    const ends = ["'", '"', '`'].map((q) => src.indexOf(q, m.index)).filter((i) => i > 0);
    out.push({ px: Number(m[1]), cls: src.slice(from + 1, Math.min(...ends)) });
  }
  return out;
}

test('no Fund Admin text is under 12px, except an uppercase eyebrow at 11px', () => {
  const bad = [];
  for (const f of FILES) {
    for (const { px, cls } of sizes(read(f))) {
      if (px >= 12) continue;
      if (px === 11 && /\buppercase\b/.test(cls)) continue;
      bad.push(`${f}: ${px}px in "${cls.slice(0, 80)}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the shared parts draw the canvas sizes', () => {
  const parts = read('parts.jsx');
  assert.match(parts, /export const TH = 'text-\[11px\] font-extrabold uppercase/, 'the table header and eyebrow are 11px');
  assert.match(parts, /\[overflow-wrap:anywhere\] text-\[13px\] \$\{c\.mono/, 'a table cell is 13px');
  assert.match(parts, /text-\[13\.5px\] font-bold \$\{tone/, "a row's name is 13.5px");
  assert.match(parts, /px-4 py-3 text-\[13px\] leading-relaxed/, 'a note is 13px');
  for (const f of ['FundTabs.jsx', 'BankingTabs.jsx', 'FeesReportsTabs.jsx', 'LpDialogs.jsx']) {
    assert.match(read(f), /LABEL = 'text-\[13px\] font-semibold/, `${f}: a form label is 13px`);
  }
});

test('the phone target helper makes a text control 44 × 44px below sm, and TAP_LINK uses it', () => {
  const parts = read('parts.jsx');
  assert.match(parts, /export const TAP = 'max-sm:inline-flex max-sm:min-h-\[44px\] max-sm:min-w-\[44px\] max-sm:items-center';/);
  assert.match(parts, /export const TAP_LINK = `[^`]*\$\{TAP\}`;/);
});

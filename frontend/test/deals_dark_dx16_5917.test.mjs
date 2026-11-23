/**
 * #5917 (D4815-p16, Deals v2 DX16) — Deal flow and the deal Overview in dark mode, boards DE16a and DE16b.
 *
 * The browser half is `frontend/tests/visual/deals_dark_5917.spec.mjs` (axe colour-contrast at 1440 and
 * 390, every status family and absence state drawn). This half holds, in the suite, what that run found:
 *   - the deal page's primary button keeps #7c3aed with white text in dark mode, as the canvas does
 *     (5.7:1); its dark violet-500 read 4.4:1;
 *   - the Deals header's "Investor & LP" badge has a dark colour; its #3730a3 read 1.6:1 on #211f3d;
 *   - each status family and each absence keeps a dark variant and its own shape, so none rests on colour.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_dark_dx16_5917.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BTN_P } from '../src/pages/deal/DealFrame.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** WCAG relative luminance and contrast, for the colours named below. */
const lum = (hex) => {
  const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the primary button keeps the canvas violet with white text in dark mode', () => {
  assert.match(BTN_P, /\bbg-axal-violet\b/);
  assert.match(BTN_P, /\btext-white\b/);
  assert.doesNotMatch(BTN_P, /dark:bg-/, 'a dark background would replace #7c3aed');
  assert.ok(ratio('#ffffff', '#7c3aed') >= 4.5, 'white on #7c3aed');
  // The current step's mark in DE15's stepper is the same violet with a white number.
  const frame = read('frontend/src/pages/deal/DealFrame.jsx');
  const mark = frame.slice(frame.indexOf('const STEP_MARK'), frame.indexOf('};', frame.indexOf('const STEP_MARK')));
  assert.match(mark, /now: 'border-axal-violet bg-axal-violet text-white',/);
  assert.doesNotMatch(frame, /dark:bg-violet-500/);
});

test('the "Investor & LP" badge has a dark colour that reads on its ground', () => {
  const css = read('frontend/src/pages/investor/investorWorkspace.css');
  const ground = css.match(/\.dark \.investor-workspace \{[^}]*--inv-indigo-soft: (#[0-9a-f]{6})/)[1];
  const fg = css.match(/\.dark \.investor-workspace \.investor-product \{ color: (#[0-9a-f]{6}); \}/);
  assert.ok(fg, 'no dark colour for .investor-product');
  assert.ok(ratio(fg[1], ground) >= 4.5, `${fg[1]} on ${ground}: ${ratio(fg[1], ground).toFixed(2)}`);
  assert.ok(ratio('#3730a3', ground) < 4.5, 'the light colour alone fails on the dark ground');
});

test('the three status families and every absence keep a dark variant and their own shape', () => {
  const card = read('frontend/src/pages/investor/dealflow/DealCard.jsx');
  const fam = (name) => card.slice(card.indexOf(`export function ${name}`), card.indexOf('\n}\n', card.indexOf(`export function ${name}`)));
  assert.match(fam('CompanyStatus'), /rounded border[^"]*font-mono[^"]*uppercase[^"]*dark:text-gray-100/, 'company: a square mono tag');
  assert.match(fam('CompanyStatus'), />CO</);
  assert.match(fam('ProcessStatus'), /rounded-full[^"]*dark:text-violet-200/, 'process: a round pill');
  assert.match(fam('ProcessStatus'), /h-1\.5 w-1\.5 rounded-full/, 'with its dot');
  assert.match(fam('TransactionStatus'), /border-l-\[3px\][^"]*dark:border-l-teal-400[^"]*dark:text-teal-300/, 'transaction: a ruled tag');
  const score = read('frontend/src/pages/investor/dealflow/ScopeScore.jsx');
  for (const mark of ['locked', 'unreadable', 'missing', 'not_recorded', 'not_expected', 'not_shared']) {
    assert.match(score, new RegExp(`data-mark="${mark}"`), `${mark} has its own mark`);
  }
  // Every mark and word carries a dark variant.
  const marks = score.slice(score.indexOf('function Mark'), score.indexOf('/** Each family'));
  for (const line of marks.split('\n').filter((l) => /className="/.test(l))) assert.match(line, /dark:/, line.trim());
});

test('the part file names the boards, what the run found and the browser check', () => {
  const f = 'documentation/architecture/decisions/D4815-p16.md';
  assert.ok(existsSync(new URL(`../../${f}`, import.meta.url)));
  const d = read(f);
  assert.match(d, /^## D4815 part 16 — .*\(#4815, #5917\)$/m);
  for (const s of ['DE16a', 'DE16b', '4.4:1', '1.6:1', 'deals_dark_5917.spec.mjs', 'Seen in a browser']) assert.ok(d.includes(s), s);
});

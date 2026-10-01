/**
 * D358 — Admin · Profiling trends (/admin/profiling-trends) and the two new
 * api.js calls. The Worker half is cloudflare-worker/test/profile_evolution_d358.test.ts.
 *
 * A hidden cell is drawn "<5", never 0; a real 0 stays 0; a month with no
 * profile is "—"; nothing on the page names a person; a failed read is
 * Unreadable with a retry, never an empty table.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/profiling_trends_d358.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrendsView, cellText, shareText } from '../src/pages/admin/AdminProfilingTrends.jsx';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const PAGE = read('../src/pages/admin/AdminProfilingTrends.jsx');
const APP = read('../src/App.jsx');
const API = read('../src/lib/api.js');
const SIDEBAR = read('../src/sidebarConfig.js');
const PROGRAMS = read('../src/pages/admin/HeldPrograms.jsx');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const arche = (over) => [
  { slug: 'fo_missionary', label: 'The Missionary', count: 8, suppressed: false },
  { slug: 'fo_rocketeer', label: 'The Rocketeer', count: 0, suppressed: false },
  { slug: 'fo_architect', label: 'The Architect', count: null, suppressed: true },
  { slug: 'fo_maverick', label: 'The Maverick', count: null, suppressed: true },
].map((a) => ({ ...a, ...(over?.[a.slug] || {}) }));
const DATA = {
  min_cell: 5,
  months: ['2026-06', '2026-07'],
  distribution: [
    { month: '2026-07', persona: 'founder', profiles: { count: 17, suppressed: false }, archetypes: arche() },
  ],
  changes: [
    { month: '2026-07', persona: 'founder', count: 6, suppressed: false, share: 0.353 },
    { month: '2026-07', persona: 'investor', count: null, suppressed: true, share: null },
  ],
  skills: [
    { axis: 'finance_ops', label: 'Finance / Ops', states: [
      { state: 'not_recorded', count: 0, suppressed: false },
      { state: 'self_rated_only', count: 17, suppressed: false },
      { state: 'some_evidence', count: null, suppressed: true },
      { state: 'corroborated', count: null, suppressed: true },
      { state: 'evidence_only', count: 0, suppressed: false },
    ] },
  ],
  revisions: [{ month: '2026-07', count: 12, suppressed: false }],
};

test('D358: a hidden cell reads "<5", a real zero stays 0, and no cell reads "—"', () => {
  assert.equal(cellText({ count: null, suppressed: true }, 5), '<5');
  assert.equal(cellText({ count: 0, suppressed: false }, 5), '0');
  assert.equal(cellText({ count: 12, suppressed: false }, 5), '12');
  assert.equal(cellText(undefined, 5), '—');
  assert.equal(shareText(0.353), '35.3%');
  assert.equal(shareText(null), '—');
});

test('D358: the distribution draws counts, hidden cells, zeros and months with no profile honestly', () => {
  const html = renderToStaticMarkup(createElement(TrendsView, { data: DATA }));
  const t = text(html);
  assert.match(t, /Founders Archetype 2026-06 2026-07 The Missionary — 8 The Rocketeer — 0 The Architect — <5 The Maverick — <5 Profiles — 17/);
  assert.equal((html.match(/data-suppressed="true"/g) || []).length, 2 + 1 + 2, 'two archetypes, one change, two skill states');
  assert.match(t, /Founders — 6 · 35.3% Investors — <5/);
  assert.match(t, /Finance \/ Ops 0 17 <5 <5 0/);
  assert.match(t, /change of mind\. 2026-06 2026-07 — 12$/);
  assert.match(html, /title="Fewer than 5, hidden so a small group cannot identify a person"/);
});

test('D358: an empty population says so', () => {
  const t = text(renderToStaticMarkup(createElement(TrendsView, { data: { ...DATA, distribution: [], changes: [], skills: [], revisions: [] } })));
  assert.match(t, /No profile has been classified yet\./);
  assert.match(t, /No displayed archetype has changed in this period\./);
  assert.match(t, /No skill axis has been recorded yet\./);
});

test('D358: a failed read is Unreadable with a retry, not an empty page', () => {
  assert.match(PAGE, /api\.adminProfilingTrends\(months\)/);
  assert.match(PAGE, /setState\(\{ status: 'unreadable', data: null \}\)/);
  assert.match(PAGE, /<Unreadable what="Profiling trends" claim="[^"]+" onRetry=\{load\} \/>/);
  assert.doesNotMatch(PAGE, /\?\? 0|\|\| 0/, 'no figure defaults to 0');
});

test('D358: the page is an admin route, lit under Programs, with a door on the Programs landing', () => {
  assert.match(APP, /const AdminProfilingTrends = lazy\(\(\) => import\('\.\/pages\/admin\/AdminProfilingTrends'\)\);/);
  assert.match(APP, /<Route path="\/admin\/profiling-trends" element=\{guard\(\['admin'\], <AdminProfilingTrends \/>\)\} \/>/);
  assert.match(SIDEBAR, /match: \['\/admin\/spinout-lab', '\/admin\/advisor-cohorts', '\/admin\/assessment', '\/admin\/profiling-trends'\] \}/);
  assert.match(PROGRAMS, /<Link to="\/admin\/profiling-trends" className=\{OPEN\}>Open profiling trends<\/Link>/);
  assert.match(PROGRAMS, /stance="Five consoles, each opened where it is decided"/);
});

test('D358: api.js carries both calls on their Worker paths', () => {
  assert.match(API, /profileReask: \(\) => request\('\/profile\/reask'\),/);
  assert.match(API, /adminProfilingTrends: \(months\) =>\s*\n\s*request\(`\/admin\/profiling\/trends\$\{months \? `\?months=\$\{encodeURIComponent\(months\)\}` : ''\}`\),/);
});

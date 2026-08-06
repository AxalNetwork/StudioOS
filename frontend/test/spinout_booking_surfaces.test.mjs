/**
 * The Lab has TWO "book an expert" surfaces, and they are not interchangeable.
 *
 *   /spinout-lab/advisors      individual ADVISORS, ranked against the skill
 *                              gaps in your latest scoring run. Growth-tier
 *                              gated. Completing a booking satisfies the
 *                              Week-3 REQUIRED milestone.
 *   /spinout-lab/office-hours  PARTNER ORGANISATIONS — investors, lawyers,
 *                              operators. No tier gate. Fires an OPTIONAL
 *                              milestone.
 *
 * They share no tables, and the split is deliberate: it is load-bearing in the
 * milestone gate, the paywall, the matching engine, the review system, and
 * partner-authored guidance. Merging them would force a choice between partner
 * bookings advancing Week 3 or advisor bookings no longer doing so.
 *
 * What was NOT deliberate is that nothing on either surface said any of this.
 * The workspace grid offered "Matched advisor network" beside "Book partner
 * sessions" — two tiles that read as the same feature — so a founder trying to
 * complete Week 3 could book the wrong one and come up short, or hit the
 * advisor tier gate without knowing the untiered surface existed.
 *
 * These tests pin the disambiguation, not the split.
 *
 * Run with:  node --test frontend/test/spinout_booking_surfaces.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const WORKSPACE = read('../src/pages/SpinoutLabWorkspace.jsx');
const ADVISORS = read('../src/pages/SpinoutLabAdvisorsPage.jsx');
const OFFICE_HOURS = read('../src/pages/SpinoutLabOfficeHoursPage.jsx');

// ---------------------------------------------------------------------------
// The tool grid — where a founder chooses between them.
// ---------------------------------------------------------------------------

test('the two tiles no longer describe themselves interchangeably', () => {
  // The old pair: "Matched advisor network" / "Book partner sessions".
  assert.doesNotMatch(WORKSPACE, /desc: 'Matched advisor network'/);
  assert.doesNotMatch(WORKSPACE, /desc: 'Book partner sessions'/);
});

test('each tile names who you actually book', () => {
  assert.match(WORKSPACE, /advisors: \{[^}]*desc: '1:1 advisors matched to your gaps'/);
  assert.match(WORKSPACE, /'office-hours': \{[^}]*desc: 'Investors, lawyers & operators'/);
});

test('the two descriptions stay distinct', () => {
  const descs = [...WORKSPACE.matchAll(/desc: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(new Set(descs).size, descs.length, 'two Lab tools share a description');
});

// ---------------------------------------------------------------------------
// Reciprocal cross-links — landing on either one routes you to the other.
// ---------------------------------------------------------------------------

test('the advisors page points at Office Hours for partner orgs', () => {
  assert.match(ADVISORS, /data-testid="xlink-office-hours"/);
  assert.match(ADVISORS, /to="\/spinout-lab\/office-hours"/);
  assert.match(ADVISORS, /investor, lawyer, or operator/);
});

test('the office-hours page points at Advisors for the Week-3 booking', () => {
  assert.match(OFFICE_HOURS, /data-testid="xlink-advisors"/);
  assert.match(OFFICE_HOURS, /to="\/spinout-lab\/advisors"/);
  // The consequential half: this is the one that completes Week 3.
  assert.match(OFFICE_HOURS, /completes Week 3/);
});

test('the cross-links are reciprocal — neither is a dead end', () => {
  assert.match(ADVISORS, /spinout-lab\/office-hours/);
  assert.match(OFFICE_HOURS, /spinout-lab\/advisors/);
});

// ---------------------------------------------------------------------------
// The split itself is intact — this change was UX only.
// ---------------------------------------------------------------------------

test('both pages still exist as separate surfaces', () => {
  const APP = read('../src/App.jsx');
  assert.match(APP, /path="\/spinout-lab\/advisors"/);
  assert.match(APP, /path="\/spinout-lab\/office-hours"/);
});

test('the co-founder match page still names advisors as the Week-3 path', () => {
  // A third surface already told founders which one counts; it must keep
  // agreeing with the cross-link copy above.
  const COFOUNDER = read('../src/pages/SpinoutLabCofounderMatchPage.jsx');
  assert.match(COFOUNDER, /For Week 3, <Link to="\/spinout-lab\/advisors"/);
});

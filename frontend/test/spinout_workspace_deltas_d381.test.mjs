/**
 * D381 — the Spin-Out Lab Workspace deltas against its canvas
 * (`design/canvases/out-of-scope/Spin-Out Lab Workspace.dc.html`, the gap
 * map's PR 3):
 *
 *   1. The header's "N of M deliverables", with the ring as that share.
 *   2. "Graduated" apart from "exited". `users.is_incorporated` is set by
 *      finishing week 4 AND by `/exit`; only the first records
 *      `incorporation_completed`.
 *   3. The completed Week 1 summary's record: startup record, TAM / SAM with
 *      what they were derived from, interviews logged, and the Eadwyn row the
 *      canvas draws and no store holds — rendered Not recorded with its reason.
 *
 * The components are RENDERED (react-dom/server, the harness's TSX loader),
 * so these assert on what a founder reads, not on the source's spelling. The
 * Week 1 record's reads run in an effect static rendering never runs; they are
 * held as source below, and the rendered half uses the preview's fixture path.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_workspace_deltas_d381.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import Workspace, { WeekOneRecord, WEEK_DEFS, countDeliverables } from '../src/pages/SpinoutLabWorkspace.jsx';
import {
  labStanding, deliverablePct, recordDay, keyInsight, interviewRows, derivationParts, fmtMarket,
  EADWYN_WEEK_REASON,
} from '../src/lib/labWeekSummary.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const WS = read('../src/pages/SpinoutLabWorkspace.jsx');
const PREVIEW = read('../src/pages/admin/AdminSpinoutJourneyPreview.jsx');
const CANVAS = read('../../design/canvases/out-of-scope/Spin-Out Lab Workspace.dc.html');

const render = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const text = (el) => renderedText(render(el));
const ws = (state, extra = {}) => text(React.createElement(Workspace, { state, ...extra }));

/** Every milestone key a set of week definitions names. */
const keysOf = (weeks) => weeks.flatMap((w) => w.deliverables.flatMap((d) => d.keys));
const TOTAL = WEEK_DEFS.reduce((n, w) => n + countDeliverables(w, () => false).total, 0);

// ---------------------------------------------------------------------------
// The canvas, sliced at both ends, so these claims are about the artboard.
// ---------------------------------------------------------------------------

test('the canvas draws what this file claims it draws', () => {
  assert.match(CANVAS, /of 18 deliverables/, 'the header count moved in the canvas');
  const s = CANVAS.indexOf('<!-- SECTION 4 — WEEK 1 SUMMARY -->');
  const e = CANVAS.indexOf('<!-- SECTION 6 — LOCKED WEEK PREVIEWS -->');
  assert.ok(s > 0 && e > s, 'the Week 1 summary section moved in the canvas');
  const summary = CANVAS.slice(s, e);
  for (const el of ['Startup record', 'TAM / SAM', 'Personal advisor', 'Interviews logged', 'Key insight']) {
    assert.ok(summary.includes(el), `the canvas's Week 1 summary no longer draws "${el}"`);
  }
});

// ---------------------------------------------------------------------------
// 1. The header counts deliverables, and the ring is that count's share.
// ---------------------------------------------------------------------------

/** The ring's own number, read from its element rather than the page's run-on text. */
const ring = (state, extra = {}) => {
  const m = render(React.createElement(Workspace, { state, ...extra })).match(/data-testid="workspace-ring">(\d+)%</);
  assert.ok(m, 'the header ring is gone');
  return Number(m[1]);
};

test('the header says how many deliverables are done, out of every counted one', () => {
  const done = keysOf(WEEK_DEFS.slice(0, 1));
  const state = { active: true, week: 2, days_remaining: 20, milestones: done.map((key) => ({ key })) };
  const out = ws(state);
  const doneCount = countDeliverables(WEEK_DEFS[0], () => true).done;
  assert.ok(doneCount > 0 && TOTAL > doneCount, 'the fixture no longer exercises a partial count');
  assert.ok(out.includes(`${doneCount} of ${TOTAL} deliverables`), 'the header lost its deliverables count');
  assert.equal(ring(state), deliverablePct(doneCount, TOTAL), 'the ring is not the share of that count');
  assert.ok(out.includes('Week 2 of 4 · 20 days remaining'));
});

test('the ring is deliverables, not days, including in the admin preview', () => {
  // 20 days remaining is day 9 of 28 (32%); no deliverable done is 0%.
  assert.equal(ring({ active: true, week: 2, days_remaining: 20, milestones: [] }), 0,
    'the ring went back to counting days');
  assert.equal(ring({ active: true, week: 2, days_remaining: 19, milestones: [] }, { previewAllUnlocked: true }), 0,
    'the preview ring claims deliverables nobody did');
  const preview = ws({ active: true, week: 2, days_remaining: 19, milestones: [] }, { previewAllUnlocked: true });
  assert.ok(preview.includes('19 days remaining · all weeks unlocked'));
});

test('deliverablePct never divides by zero and rounds to a whole percent', () => {
  assert.equal(deliverablePct(0, 0), 0);
  assert.equal(deliverablePct(4, 18), 22);
  assert.equal(deliverablePct(27, 27), 100);
});

// ---------------------------------------------------------------------------
// 2. Graduated is not exited.
// ---------------------------------------------------------------------------

test('labStanding reads the milestone, not the flag alone', () => {
  assert.equal(labStanding({ is_incorporated: false }, new Set()), 'active');
  assert.equal(labStanding({ is_incorporated: true }, new Set(['incorporation_completed'])), 'graduated');
  assert.equal(labStanding({ is_incorporated: true }, new Set(['project_created'])), 'exited');
  assert.equal(labStanding(null, new Set()), 'active');
});

test('a founder who used /exit is not told they graduated', () => {
  const out = ws({ is_incorporated: true, week: 2, milestones: [{ key: 'project_created' }] });
  assert.ok(out.includes('Exited'), 'the exited badge is missing');
  assert.ok(out.includes('Left the programme in Week 2'));
  assert.ok(!out.includes('Graduated'), 'an exited founder is shown as graduated');
  assert.ok(!out.includes('incorporated'), 'an exited founder is told they incorporated');
  // The timeline card of the week they left carries "Left", not "Locked" —
  // read off that card, since the header sentence also says "Left".
  const left = WEEK_DEFS.find((w) => w.num === 2).name;
  assert.ok(out.includes(`${left}Left`), 'the week they left is shown as locked or active');
});

test('a graduate is still told they graduated', () => {
  const out = ws({ is_incorporated: true, week: 4, milestones: [{ key: 'incorporation_completed' }] });
  assert.ok(out.includes('Graduated'));
  assert.ok(out.includes('Graduated · incorporated'));
  assert.ok(!out.includes('Exited'));
});

test('the workspace derives its standing from labStanding, never the bare flag', () => {
  const code = codeOnly(WS);
  assert.doesNotMatch(code, /const graduated = Boolean\(state\?\.is_incorporated\)/,
    'the workspace went back to reading is_incorporated as graduation');
  assert.match(code, /const standing = labStanding\(state, done\);/);
});

// ---------------------------------------------------------------------------
// 3. The Week 1 record.
// ---------------------------------------------------------------------------

const FIXTURE = {
  project: { name: 'Test Co', created_at: '2026-07-02 10:00:00', tam: 2400000000, sam: 340000000 },
  assumptions: { assumptions: { methodology: 'Bottom-up', category: 'Workflow', geography: 'Global' } },
  interviews: [
    { id: 1, name: 'Interviewee A', date: 'Jul 2', insight: 'Async hand-offs break' },
    { id: 2, name: 'Interviewee B', date: null, insight: null },
  ],
};
const rec = (fixture, startedAt = '2026-07-01 00:00:00') =>
  text(React.createElement(WeekOneRecord, { startedAt, fixture }));

test('the Week 1 record draws the startup record, the sizing, and the interviews', () => {
  const out = rec(FIXTURE);
  assert.ok(out.includes('Test Co'));
  assert.ok(out.includes('Startup record created · Day 2'));
  assert.ok(out.includes('$2.4B') && out.includes('$340M'));
  assert.ok(out.includes('Derived from your assumptions: Bottom-up · Workflow · Global'));
  assert.ok(out.includes('Interviews logged · 2'));
  assert.ok(out.includes('Async hand-offs break'));
  assert.ok(out.includes('No pain logged'), 'an interview with no pain borrowed an insight');
});

test('what no store holds is said, never drawn from the canvas', () => {
  const out = rec(FIXTURE);
  // Citations: the canvas cites Gartner and CB Insights; nothing stores one.
  assert.ok(out.includes('Cited sources: Not recorded'));
  // The assistant row: the canvas's "Personal advisor … question bank complete".
  assert.ok(out.includes('Eadwyn · Week 1 questions'));
  assert.ok(out.includes(EADWYN_WEEK_REASON));
  assert.ok(!/Personal advisor|question bank complete/i.test(out), 'the canvas’s advisor claim is drawn');
  for (const fixtureName of ['NovaCraft', 'Sarah T.', 'Gartner', 'CB Insights']) {
    assert.ok(!WS.includes(fixtureName), `the workspace carries the canvas fixture "${fixtureName}"`);
  }
});

test('an unsized record says Not sized, not $0', () => {
  const out = rec({ ...FIXTURE, project: { ...FIXTURE.project, tam: null, sam: 0 } });
  assert.ok(out.includes('Not sized'));
  assert.ok(!out.includes('$0'), 'an unsized market printed $0');
});

test('no startup record is stated, and no interview count is invented for it', () => {
  const out = rec({ project: null, assumptions: null, interviews: [] });
  assert.ok(out.includes('No startup record on file'));
  assert.ok(!/Interviews logged · \d/.test(out), 'a count was drawn for a project that does not exist');
});

test('the preview labels its record as sample data; the live one is never labelled', () => {
  assert.ok(rec(FIXTURE).includes('Sample data'));
  // EVERY workspace the preview renders gets the sample, so no stage of it
  // reads the admin's own projects as if they were a founder's record.
  const mounts = [...codeOnly(PREVIEW).matchAll(/<SpinoutLabWorkspace\b[^>]*\/>/g)].map((m) => m[0]);
  assert.ok(mounts.length >= 2, 'the preview renders fewer workspaces than this test expects');
  for (const m of mounts) {
    assert.match(m, /week1Fixture=\{WEEK1_FIXTURE\}/, `a preview stage renders the workspace without its sample: ${m}`);
  }
  assert.match(WS, /\{s\.def\.num === 1 && <WeekOneRecord startedAt=\{state\?\.started_at\} fixture=\{week1Fixture\} \/>\}/,
    'the Week 1 record is no longer mounted inside the Week 1 summary');
});

test('the live record reads the three stores, and a failed read says so', () => {
  const comp = codeOnly(WS).slice(codeOnly(WS).indexOf('export function WeekOneRecord'));
  const body = comp.slice(0, comp.indexOf('export default function SpinoutLabWorkspace'));
  assert.match(body, /pickLabProject\(await api\.listProjects\(\), user\)/);
  assert.match(body, /api\.listInterviews\(project\.id\)/);
  assert.match(body, /api\.getMarketAssumptions\(project\.id\)/);
  assert.equal((body.match(/<Unreadable\b/g) || []).length, 3,
    'each of the three reads needs its own Unreadable (record, assumptions, interviews)');
  // A failed interview read must not fall through to the empty-list sentence.
  assert.match(body, /read\.interviews\?\.status === 'error' \? \(\s*<Unreadable what="Your interviews"/);
});

// ---------------------------------------------------------------------------
// The pure helpers.
// ---------------------------------------------------------------------------

test('recordDay counts from the Lab start and refuses a record older than it', () => {
  assert.equal(recordDay('2026-07-01 09:00:00', '2026-07-01 00:00:00'), 1);
  assert.equal(recordDay('2026-07-08 00:00:00', '2026-07-01 00:00:00'), 8);
  assert.equal(recordDay('2026-06-01 00:00:00', '2026-07-01 00:00:00'), null);
  assert.equal(recordDay(null, '2026-07-01'), null);
});

test('keyInsight, interviewRows and derivationParts keep absence as null', () => {
  assert.equal(keyInsight({ pains: ['  ', 'Real pain'] }), 'Real pain');
  assert.equal(keyInsight({ pains: [] }), null);
  const rows = interviewRows([{ id: 1, interviewee_name: ' ', interview_date: null, pains: [] }]);
  assert.deepEqual(rows, [{ id: 1, name: null, date: null, insight: null }]);
  assert.equal(derivationParts({ assumptions: null, filled: {} }), null);
  assert.deepEqual(derivationParts({ assumptions: { methodology: 'Top-down' } }), ['Top-down']);
  assert.equal(fmtMarket(0), null);
  assert.equal(fmtMarket(null), null);
  assert.equal(fmtMarket(2.4e9), '$2.4B');
});

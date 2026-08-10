/**
 * Spin-Out Lab · Studio Ops — the derivations behind /spinout-lab/studio-ops
 * (frontend/src/lib/spinout/studioOps.js) plus the two wiring invariants this
 * feature exists to enforce:
 *
 *   1. The Lab's Studio Ops tool opens the DEDICATED Lab page — never the
 *      Command Center Operations tab it used to alias.
 *   2. The page's commitments are the week catalog's real deliverables, so the
 *      tracker and the workspace can never disagree about the same week.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_studio_ops.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  sprintPosition,
  deliverableDone,
  buildCommitments,
  executionHealth,
  deriveBlockers,
  mustHitList,
} from '../src/lib/spinout/studioOps.js';
import { TOOL_INFO, WEEK_DEFS } from '../src/pages/SpinoutLabWorkspace.jsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

// ------------------------------------------------------------ wiring

test('Studio Ops tool card opens the dedicated Lab page, not Command Center', () => {
  assert.equal(TOOL_INFO['studio-ops'].to, '/spinout-lab/studio-ops');
  assert.ok(
    !String(TOOL_INFO['studio-ops'].to).includes('command-center'),
    'the Lab tool must not alias Command Center',
  );
  // Stays ungated: the cadence is worth setting before Week 2 formally starts.
  assert.equal(TOOL_INFO['studio-ops'].ungated, true);
});

test('the dedicated route exists in App.jsx and Command Center keeps its Operations embed', () => {
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/spinout-lab/studio-ops"'), 'Lab route missing');
  assert.ok(app.includes('SpinoutLabStudioOpsPage'), 'Lab page not routed');
  // The decoupling must not have deleted the studio console's own surfaces.
  const cc = read('src/pages/CommandCenterPage.jsx');
  assert.ok(cc.includes('<StudioOpsPage embedded founderCopy />'), 'Command Center Operations tab lost its embed');
  assert.ok(app.includes('path="/studio-ops"'), 'legacy /studio-ops route removed');
});

test('the page marks no milestone on load — only the server-side cadence lock does', () => {
  const page = read('src/pages/SpinoutLabStudioOpsPage.jsx');
  assert.ok(
    !page.includes('markMilestone('),
    'viewing the page must never record studio_ops_cadence_set; the lock endpoint records it server-side',
  );
});

// ------------------------------------------------------------ sprintPosition

test('sprintPosition: not started → week only, no invented day number', () => {
  const p = sprintPosition({ week: 2, started_at: null, days_remaining: 28 });
  assert.equal(p.week, 2);
  assert.equal(p.day, null);
  assert.equal(p.label, 'Week 2');
});

test('sprintPosition: day derives from server days_remaining, not the browser clock', () => {
  const fresh = sprintPosition({ week: 1, started_at: '2026-08-01 00:00:00', days_remaining: 28 });
  assert.equal(fresh.day, 1, 'a just-started sprint is Day 1');
  const mid = sprintPosition({ week: 2, started_at: '2026-08-01 00:00:00', days_remaining: 18 });
  assert.equal(mid.day, 11, '28 − 18 + 1 = Day 11 (the design’s own example)');
  assert.equal(mid.label, 'Week 2 · Day 11');
  assert.equal(mid.dayInWeek, 4, 'day 11 is the 4th day of its week');
  const done = sprintPosition({ week: 4, started_at: '2026-08-01 00:00:00', days_remaining: 0 });
  assert.equal(done.day, 28, 'clamped to the sprint length');
});

test('sprintPosition: clamps week into the 1-4 program', () => {
  assert.equal(sprintPosition({ week: 9 }).week, 4);
  assert.equal(sprintPosition({ week: 0 }).week, 1);
  assert.equal(sprintPosition(null).week, 1);
});

// ------------------------------------------------------------ commitments

const week2 = WEEK_DEFS.find((w) => w.num === 2);

test('buildCommitments: rows ARE the week catalog’s deliverables, 1:1', () => {
  const rows = buildCommitments({ weekDef: week2, doneKeys: new Set(), toolInfo: TOOL_INFO, ownerName: 'Maya' });
  assert.equal(rows.length, week2.deliverables.length);
  rows.forEach((r, i) => {
    assert.equal(r.title, week2.deliverables[i].label);
    assert.equal(r.due, 'Week 2', 'due is the week’s real deadline — no invented weekday');
    assert.equal(r.owner, 'Maya');
  });
});

test('buildCommitments: module chips resolve through TOOL_INFO and link to the tool', () => {
  const rows = buildCommitments({ weekDef: week2, doneKeys: new Set(), toolInfo: TOOL_INFO, ownerName: 'M' });
  const ops = rows.find((r) => r.title === 'Studio Ops cadence set');
  assert.ok(ops, 'the cadence deliverable is itself a commitment');
  assert.equal(ops.module, 'Studio Ops');
  assert.equal(ops.to, '/spinout-lab/studio-ops');
});

test('buildCommitments/deliverableDone: ANY listed key completes a row (workspace parity)', () => {
  const d = { label: 'x', keys: ['a', 'b'] };
  assert.equal(deliverableDone(d, new Set(['b'])), true);
  assert.equal(deliverableDone(d, new Set(['c'])), false);
  const rows = buildCommitments({
    weekDef: week2,
    doneKeys: new Set(['pitch_deck_drafted']),
    toolInfo: TOOL_INFO,
    ownerName: 'M',
  });
  const deck = rows.find((r) => r.title === 'Draft pitch deck v1');
  assert.equal(deck.done, true);
  assert.equal(deck.status, 'Done');
});

// ------------------------------------------------------------ health

test('executionHealth: optional rows never count toward the denominator', () => {
  const rows = [
    { done: true, optional: false },
    { done: false, optional: false },
    { done: false, optional: true },
  ];
  const h = executionHealth(rows, []);
  assert.equal(h.total, 2);
  assert.equal(h.done, 1);
  assert.equal(h.pct, 50);
  assert.equal(h.label, 'On track');
});

test('executionHealth: a High blocker downgrades even a finished week to At risk', () => {
  const rows = [{ done: true, optional: false }];
  assert.equal(executionHealth(rows, []).label, 'Complete');
  const h = executionHealth(rows, [{ severity: 'High' }]);
  assert.equal(h.label, 'At risk');
  assert.equal(h.atRisk, true);
  assert.match(h.note, /1 high blocker/);
});

test('executionHealth: zero counted commitments reads Not started, not 0%-broken', () => {
  const h = executionHealth([], []);
  assert.equal(h.label, 'Not started');
  assert.equal(h.tone, 'muted');
  assert.equal(h.pct, 0);
});

// ------------------------------------------------------------ blockers

const pos = (pct) => ({ week: 2, weekElapsedPct: pct });

test('deriveBlockers: early in the week nothing is a blocker — it is just work', () => {
  const b = deriveBlockers({ weekDef: week2, doneKeys: new Set(), position: pos(30), toolInfo: TOOL_INFO });
  assert.deepEqual(b, []);
});

test('deriveBlockers: mid-week open deliverables are Medium and do not escalate', () => {
  const b = deriveBlockers({ weekDef: week2, doneKeys: new Set(), position: pos(57), toolInfo: TOOL_INFO });
  assert.ok(b.length > 0);
  for (const x of b) {
    assert.equal(x.severity, 'Medium');
    assert.equal(x.escalate, false, 'escalating everything escalates nothing');
  }
});

test('deriveBlockers: late-week open deliverables go High and escalate', () => {
  const b = deriveBlockers({ weekDef: week2, doneKeys: new Set(), position: pos(85), toolInfo: TOOL_INFO });
  assert.ok(b.length > 0);
  for (const x of b) {
    assert.equal(x.severity, 'High');
    assert.equal(x.escalate, true);
  }
});

test('deriveBlockers: done and optional deliverables never appear', () => {
  const allKeys = new Set(week2.deliverables.flatMap((d) => d.keys));
  const b = deriveBlockers({ weekDef: week2, doneKeys: allKeys, position: pos(90), toolInfo: TOOL_INFO });
  assert.deepEqual(b, [], 'a finished week has no derived blockers');
});

test('deriveBlockers: a frozen cohort gate outranks everything with one Program blocker', () => {
  const b = deriveBlockers({
    weekDef: week2,
    doneKeys: new Set(),
    position: pos(90),
    cohortTiming: { frozen: true, frozen_week: 2 },
    toolInfo: TOOL_INFO,
  });
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'Program');
  assert.equal(b[0].severity, 'High');
  assert.match(b[0].title, /paused at Week 2/);
});

// ------------------------------------------------------------ must-hit

test('mustHitList: comes from the week chips and reflects real completion', () => {
  const none = mustHitList(week2, new Set());
  assert.equal(none.length, week2.chips.length);
  assert.ok(none.every((m) => !m.done));
  const one = mustHitList(week2, new Set(['okrs_created']));
  assert.equal(one.find((m) => m.text === '3+ OKRs').done, true);
});

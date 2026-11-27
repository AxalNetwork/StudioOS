/**
 * Co-founder Match ↔ Agreement tell the truth — D352.
 *
 * Match stores the Week-3 decision (projects.cofounder_decision_meta, migration
 * 162). Agreement's solo path said "Axal does not store a chose-solo decision",
 * and Match's solo outcome promised "the solo declaration executes in Week 4" —
 * a document that does not exist. The Startup page sent Lab members to the
 * legacy wizard. These tests pin:
 *
 *   * Agreement's solo caveat follows the STORED decision, and an unreadable
 *     project is "unknown", never "none".
 *   * The five outcomes, finalists and sort chips round-trip through the blob
 *     and stay under the Worker's 8000-character cap at their limits.
 *   * A card with no figure for a sort key sorts last, never as a zero.
 *   * The Agreement route follows the SAME rule as the Lab route's guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  DECISION_OUTCOMES, FINALIST_LIMIT, SORT_KEYS, buildDecisionModel, serializeDecision, sortCards, sortFigure,
} from '../src/lib/cofounderMatchViewModel.js';
import {
  soloDecisionFacts, buildCofounderAgreementViewModel,
  SOLO_CAVEAT_RECORDED, SOLO_CAVEAT_NONE, SOLO_CAVEAT_OTHER, SOLO_CAVEAT_UNREADABLE,
} from '../src/lib/cofounderAgreementViewModel.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MATCH = codeOnly(raw('frontend/src/pages/SpinoutLabCofounderMatchPage.jsx'));
const AGREEMENT = codeOnly(raw('frontend/src/pages/SpinoutLabCofounderAgreementPage.jsx'));
const AGREEMENT_RAW = raw('frontend/src/pages/SpinoutLabCofounderAgreementPage.jsx');
const MATCH_VM = raw('frontend/src/lib/cofounderMatchViewModel.js');
const AGREEMENT_VM = raw('frontend/src/lib/cofounderAgreementViewModel.js');
const STARTUP = codeOnly(raw('frontend/src/pages/SpinoutLabStartupPage.jsx'));
const APP = raw('frontend/src/App.jsx');
const PROJECTS = raw('cloudflare-worker/src/routes/projects.ts');
const LEGAL = raw('cloudflare-worker/src/routes/legal.ts');
const CANVAS = raw('design/canvases/out-of-scope/Co-founder Match.dc.html');

// ---------------------------------------------------------------------------
// Agreement reads the stored decision
// ---------------------------------------------------------------------------
test('a stored solo decision is reported as recorded — and as not a signed declaration', () => {
  const f = soloDecisionFacts({ outcome: 'solo', decidedAt: '2026-09-20T10:00:00Z', note: 'Hiring a CTO instead' });
  assert.equal(f.state, 'solo');
  assert.equal(f.caveat, SOLO_CAVEAT_RECORDED);
  assert.match(SOLO_CAVEAT_RECORDED, /not a signed declaration/);
});

test('no decision, a different decision, and an unreadable project are three different states', () => {
  assert.equal(soloDecisionFacts({ outcome: null }).caveat, SOLO_CAVEAT_NONE);
  assert.equal(soloDecisionFacts({ outcome: 'searching' }).caveat, SOLO_CAVEAT_OTHER);
  const u = soloDecisionFacts({ outcome: 'solo' }, { unreadable: true });
  assert.equal(u.state, 'unreadable', 'an unreadable project must not report the decision as known');
  assert.equal(u.caveat, SOLO_CAVEAT_UNREADABLE);
});

test('the solo readout leads with the recorded decision', () => {
  const vm = buildCofounderAgreementViewModel({
    user: { name: 'A' }, project: { id: 1 }, decision: { outcome: 'solo', decidedAt: '2026-09-20T10:00:00Z' },
  });
  assert.equal(vm.solo.items[0].label, 'Recorded Week-3 decision');
  assert.equal(vm.solo.items[0].value, 'Solo path · 2026-09-20');
  assert.equal(vm.solo.caveat, SOLO_CAVEAT_RECORDED);
  const none = buildCofounderAgreementViewModel({ user: { name: 'A' }, project: { id: 1 }, decision: null });
  assert.equal(none.solo.items[0].value, 'Not recorded');
});

test('the Agreement page passes the stored blob to the view model', () => {
  assert.match(AGREEMENT, /buildDecisionModel\(\{ meta: project\.cofounder_decision_meta, milestoneKeys: \[\] \}\)/);
  assert.match(AGREEMENT, /decision, projectUnreadable: projectsFailed,/);
});

test('the stale claims are gone', () => {
  assert.doesNotMatch(AGREEMENT_VM, /does not store a “chose solo” decision/);
  assert.doesNotMatch(MATCH_VM, /solo declaration executes in Week 4/);
  assert.doesNotMatch(MATCH, /solo declaration itself executes/);
  assert.doesNotMatch(AGREEMENT_RAW, /generator is dev-only/);
  assert.match(LEGAL, /legal\.post\('\/cofounder-agreement'/, 'the Worker generator route this page now names is gone');
});

// ---------------------------------------------------------------------------
// Five outcomes, finalists, sort chips
// ---------------------------------------------------------------------------
test('the canvas’s five outcomes are the console’s five', () => {
  const block = CANVAS.slice(CANVAS.indexOf('const outcomes=['), CANVAS.indexOf('];', CANVAS.indexOf('const outcomes=[')));
  const drawn = [...block.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(drawn, ['Proceed with candidate', 'Run trial project', 'Request references', 'Continue search', 'Document solo path']);
  assert.deepEqual(DECISION_OUTCOMES.map((o) => o.value), ['advance', 'trial', 'references', 'searching', 'solo']);
});

test('trial and references say that no tracker stores them', () => {
  for (const v of ['trial', 'references']) {
    const o = DECISION_OUTCOMES.find((x) => x.value === v);
    assert.equal(o.needsCandidate, true);
    assert.match(o.desc, /Axal (has no|stores no)/, `${v} must not imply a tracker exists`);
  }
});

test('outcome, candidate and finalists round-trip through the stored blob', () => {
  const blob = serializeDecision({ outcome: 'trial', candidateUid: 'c1', finalists: ['c1', 'c2', 'c1', ''], note: 'n', followups: [], decidedAt: 'd' });
  assert.deepEqual(blob.finalists, ['c1', 'c2']);
  const m = buildDecisionModel({ meta: JSON.stringify(blob), milestoneKeys: [] });
  assert.equal(m.outcome, 'trial');
  assert.equal(m.candidateUid, 'c1');
  assert.deepEqual(m.finalists, ['c1', 'c2']);
});

test('a candidate is dropped from an outcome that is not about one', () => {
  assert.equal(serializeDecision({ outcome: 'solo', candidateUid: 'c1' }).candidate_uid, null);
  assert.equal(serializeDecision({ outcome: 'references', candidateUid: 'c1' }).candidate_uid, 'c1');
});

test('the blob at every limit stays under the Worker’s 8000-character cap', () => {
  const blob = serializeDecision({
    outcome: 'references', candidateUid: 'x'.repeat(64),
    note: 'n'.repeat(5000), followups: Array.from({ length: 20 }, () => 'f'.repeat(900)),
    finalists: Array.from({ length: 10 }, (_, i) => `${'u'.repeat(60)}${i}`), decidedAt: new Date(0).toISOString(),
  });
  assert.ok(blob.finalists.length <= FINALIST_LIMIT);
  assert.ok(JSON.stringify(blob).length < 8000, `${JSON.stringify(blob).length} chars would be refused`);
  assert.match(PROJECTS, /if \(out\.length > 8000\) return \{ error: 'cofounder_decision_meta too large' \};/);
});

test('sort keys are the three the breakdown can order by; missing figures sort last', () => {
  assert.deepEqual(SORT_KEYS.map((k) => k.key), ['total', 'complementarity', 'values']);
  const cards = [
    { uid: 'a', match_score: 40, breakdown: { values_alignment: 5 } },
    // `b` has NO figure and comes before `d`, which has a real zero: read as
    // zero, `b` would tie `d` and keep its earlier place.
    { uid: 'b', match_score: null, breakdown: {} },
    { uid: 'c', match_score: 70, breakdown: { skill_complementarity: 10, profile_skills: 15, values_alignment: 20 } },
    { uid: 'd', match_score: 0, breakdown: { values_alignment: 0, skill_complementarity: 0 } },
  ];
  assert.deepEqual(sortCards(cards, 'total').map((c) => c.uid), ['c', 'a', 'd', 'b']);
  assert.deepEqual(sortCards(cards, 'complementarity').map((c) => c.uid), ['c', 'd', 'a', 'b']);
  assert.equal(sortFigure(cards[0], 'complementarity'), null, 'no complement signal is not a zero');
  assert.deepEqual(sortCards(cards, 'values').map((c) => c.uid), ['c', 'a', 'd', 'b']);
});

test('the page renders sorted cards, the chips, the finalists and the Evidence absence', () => {
  assert.match(MATCH, /sortedCards\.map\(\(card\) =>/);
  assert.match(MATCH, /data-testid="sort-chips"/);
  assert.match(MATCH, /data-testid="card-finalists"/);
  assert.match(MATCH, /Evidence: <Unrecorded reason=/);
  assert.match(MATCH, /finalists,\s+decidedAt: new Date\(\)\.toISOString\(\),/);
});

// ---------------------------------------------------------------------------
// Failed project reads
// ---------------------------------------------------------------------------
test('neither page turns a failed project read into "no project"', () => {
  for (const [name, src] of [['Match', MATCH], ['Agreement', AGREEMENT]]) {
    assert.doesNotMatch(src, /listProjects\(\)\.catch\(\(\) => \[\]\)/, `${name} still swallows the project read`);
    assert.match(src, /setProjectsFailed\(!projects\.ok\)/, name);
  }
  const i = AGREEMENT.indexOf('if (projectsFailed) {');
  const j = AGREEMENT.indexOf('if (!project) {');
  assert.ok(i > 0 && i < j, 'the Agreement page must decide unreadable before "No startup record yet"');
});

// ---------------------------------------------------------------------------
// Startup links follow the Lab route's own guard
// ---------------------------------------------------------------------------
test('the agreement route admits exactly who the Lab route’s guard admits', async () => {
  assert.match(APP, /path="\/spinout-lab\/cofounder-agreement" element=\{guard\(labRoles\(\['admin'\]\)/);
  assert.match(APP, /if \(user && user\.spinout_lab_active === 1 && !result\.includes\(user\.role\)\)/);
  assert.match(STARTUP, /return user\?\.role === 'admin' \|\| user\?\.spinout_lab_active === 1\s*\? '\/spinout-lab\/cofounder-agreement'\s*: '\/incorporate\/cofounder-agreement';/);
  assert.match(STARTUP, /to: cofounderAgreementRoute\(user\), testid: 'readiness-cofounder-agreement'/);
  assert.match(STARTUP, /to=\{cofounderAgreementRoute\(user\)\}\s+data-testid="link-solo-path"/);
  assert.doesNotMatch(STARTUP, /to="\/incorporate\/cofounder-agreement"/);
});

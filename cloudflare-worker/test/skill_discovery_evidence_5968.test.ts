/**
 * D4538 part 8 (#5968, of #4538) — discovery's input gate, run gate and ranking stages 4 and 5, and their measurement.
 *
 *  - INPUTS: #4667's real `preflight` (`skillInputs.ts`) over stub readers, turned into the gate by `inputGapsOf`. A
 *    required input the scope cannot supply puts the skill in `blocked` with `input_unavailable`, never in
 *    `candidates`; one a run supplies when it starts is deferred and said; a skill with no binding is "Not recorded".
 *  - RUN GATE: `agentRun`'s refusals of the agent (`agent_paused`, `outside_assistant`) are `not_runnable`.
 *  - STAGE 4 (`evaluationOf`): the exact version, suite, models and evaluator; stale and incomplete evidence labelled
 *    and never scored; only fresh complete results move a score.
 *  - STAGE 5 (`operationalOf`): #4536's served measures; an absent one is `{ available: false, reason }`; only the
 *    failure rate moves a score, down, over OPS_MIN_ENDED runs.
 *  - Popularity never raises a rank: two skills that differ only in use count (and completed-run count) score alike.
 *  - The route (real SQLite): the evidence of the published version, and only this company's runs; another company's
 *    runs of the same HQ skill never enter a figure, even when HQ's admin asks.
 *  - MEASUREMENT: queries.v1.json re-run with the sources wired, and #4588's first-ten qualification set; the numbers
 *    are pinned here and in the ```json measured block of `documentation/architecture/decisions/D4538-p8.md`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_discovery_evidence_5968.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { SKILL_LIBRARY } from './_skill_library.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { passHqGate } from './_hq_skill_gate.ts';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamSkills from '../src/routes/team_skills.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';
import { FIRST_TEN, FIRST_TEN_SLUGS, HARD, preflight } from '../src/services/agents/skillInputs.ts';
import { EVALUATOR } from '../src/services/agents/skillLifecycle.ts';
import {
  OPS_MIN_ENDED, QUALITY_BOOST, QUALITY_FRESH_DAYS, QUALITY_PENALTY, discoverSkills, evaluationOf, gateOf, inputGapsOf, operationalOf,
  type Discovery, type DiscoveryAgent, type DiscoverySkill, type InputFacts, type OperationalFacts, type QualityFacts,
} from '../src/services/agents/skillDiscovery.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The fixed "now" every preflight and freshness figure here is taken at. */
const NOW = Date.parse('2026-11-22T12:00:00Z');
const RECENT = '2026-11-20 09:00:00';

const LIBRARY: DiscoverySkill[] = SKILL_LIBRARY.map((e, i) => {
  const d = readLibrarySkill(e.skill_md) as { slug: string; name: string; purpose: string; steps: string[]; tools: string[]; output_kind: string; tags: Array<{ slug: string }>; roles: string[] };
  return {
    uid: d.slug, slug: d.slug, scope: 'hq', company: null, status: 'published', readable: true, version: 1, suspended: false,
    name: d.name, purpose: d.purpose, steps: d.steps, roles: d.roles, tools: d.tools, output_kind: d.output_kind, taxonomy: d.tags,
    use_count: (i * 37) % 101,
  };
});
const lib = (slug: string) => LIBRARY.find((s) => s.uid === slug)!;

type Fail = 'throw' | 'null' | 'withheld' | 'absent' | 'empty';
const COVERED = { returned: 1, total: 1, omitted: 0, complete: true };
/** A reader's full answer for the kind a need expects, as the real reader gives it with no record selected. */
function answer(read: string, expects: string): unknown {
  if (read === 'data_room.index') return { document_status: 'not_selected' };
  if (read === 'fund.performance') return { fund_status: 'not_selected' };
  if (expects === 'project_profile' || expects === 'company_profile') return { name: 'Made-up Co' };
  return { records: [{ at: RECENT }], coverage: COVERED };
}
/** Stub readers for one skill's needs, each answering fully unless `fail` names it. */
function readersFor(slug: string, fail: Record<string, Fail> = {}) {
  const out: Record<string, (env: unknown, c: unknown) => Promise<unknown>> = {};
  for (const n of FIRST_TEN.find((s) => s.slug === slug)!.needs) {
    if (n.read.startsWith('manual:') || fail[n.read] === 'absent') continue;
    const f = fail[n.read];
    out[n.read] = async () => {
      if (f === 'throw') throw new Error('reader failed');
      if (f === 'null') return null;
      if (f === 'withheld') return { withheld: true, reason: 'The sponsor may not read this source.' };
      if (f === 'empty') return { records: [], coverage: { returned: 0, total: 0, omitted: 0, complete: true } };
      return answer(n.read, n.expects);
    };
  }
  return out;
}
/** #4667's real preflight for `slug`, as discovery's route reads it, over stub readers. */
async function inputsFor(slug: string, o: { fail?: Record<string, Fail>; granted?: readonly string[]; venture?: boolean } = {}): Promise<InputFacts> {
  const p = await preflight({} as any, slug, { scope: { kind: 'company', id: 1, uid: 'c', name: 'C' }, agent: {} as any, projectId: o.venture ? 5 : null, document: null, fund: null },
    readersFor(slug, o.fail) as any, NOW, undefined, {}, o.granted ? { granted: o.granted } : {});
  return { state: p!.state, venture: !!o.venture, limits: p!.limits, paths: p!.paths, inputs: p!.inputs.map((i) => ({ field: i.field, read: i.read, required: i.required, status: i.status, ...(i.reason ? { reason: i.reason } : {}), ...(i.source ? { source: i.source } : {}) })) };
}
const agentFor = (s: DiscoverySkill, over: Partial<DiscoveryAgent> = {}): DiscoveryAgent => ({ role: s.roles[0], company: 'own', tools: [...s.tools], ...over });

const quality = (over: Partial<QualityFacts['results']> = {}, top: Partial<QualityFacts> = {}): QualityFacts => ({
  version: 1,
  release: { evidence_hash: 'e'.repeat(64), suite_revision: 'r'.repeat(64), cases: 4, evaluator_version: EVALUATOR.version, models: ['m1', 'm2'], models_source: 'declared', pass: 8, total: 8, approved_at: '2026-11-01 10:00:00' },
  now: { suite_revision: 'r'.repeat(64), evaluator_version: EVALUATOR.version, models: ['m1', 'm2'] },
  suite: { cases: 4, models: ['m1', 'm2'], models_source: 'version_evidence' },
  results: {
    units: 8, recorded: 8, counts: { pass: 8, fail: 0, not_run: 0 }, by_model: { m1: { pass: 4, fail: 0, not_run: 0 }, m2: { pass: 4, fail: 0, not_run: 0 } },
    evaluator_versions: [EVALUATOR.version], on_current_evaluator: 8, case_text_not_recorded: 0,
    newest_run_at: RECENT, oldest_run_at: RECENT, hours_since_oldest: 51, ...over,
  },
  ...top,
});
const FAILING = { counts: { pass: 5, fail: 3, not_run: 0 }, by_model: { m1: { pass: 2, fail: 2, not_run: 0 }, m2: { pass: 3, fail: 1, not_run: 0 } } };
const ops = (o: Partial<OperationalFacts['outcomes']> = {}, version = 1): OperationalFacts => ({
  version, window: { since: '2026-10-24 00:00:00', until: '2026-11-23 00:00:00', days: 30 },
  outcomes: { completed: 0, refused: 0, failed: 0, retryable: 0, version_not_recorded: 0, attributed_since: null, ...o },
  model_latency_ms: { p50: 900, p95: 2100, runs_measured: 12 },
});

// ── Inputs (#4667) ──────────────────────────────────────────────────────────

test('5968 inputs: a required input the scope cannot supply is input_unavailable, in blocked, never a candidate', async () => {
  // Mutations checked: `inputGapsOf` returning no unmet input → the runway skill stays a candidate for every case;
  // `wrong_shape` dropped from the gate → the wrong-shape case is a candidate; the gate reading `s.inputs.state ===
  // 'not_ready'` alone → the company agent's missing burn (deferred, not_ready by preflight) is blocked.
  const s = lib('cash-runway-snapshot');
  const a = agentFor(s);
  const task = 'How many months of runway do we have left at the current burn?';
  const ready = await inputsFor(s.slug!);
  assert.equal(ready.state, 'ready');
  const ok = discoverSkills({ task }, a, LIBRARY.map((x) => (x === s ? { ...x, inputs: ready } : x)));
  assert.equal(ok.candidates[0].skill_uid, s.uid);
  assert.deepEqual(ok.candidates[0].inputs, { available: true, state: 'ready', inputs: ready.inputs, limits: [], deferred: [] });

  const cases: Array<[string, Parameters<typeof inputsFor>[1], string]> = [
    ['no reader is built', { fail: { 'grow.burn': 'absent' } }, 'unavailable_reader'],
    ['the rule book does not read it', { granted: ['mercury.balances'] }, 'not_granted'],
    ['the sponsor may not read it', { fail: { 'mercury.balances': 'withheld' } }, 'withheld'],
    ['the reader throws', { fail: { 'grow.burn': 'throw' } }, 'unreadable'],
    ['nothing is recorded on the agent\'s venture', { fail: { 'grow.burn': 'null' }, venture: true }, 'missing'],
    ['an empty collection on the agent\'s venture', { fail: { 'grow.burn': 'empty' }, venture: true }, 'empty'],
  ];
  for (const [why, o, status] of cases) {
    const f = await inputsFor(s.slug!, o);
    assert.equal(f.state, 'not_ready', why);
    const r = discoverSkills({ task }, a, LIBRARY.map((x) => (x === s ? { ...x, inputs: f } : x)));
    assert.ok(!r.candidates.some((c) => c.skill_uid === s.uid), `${why}: still a candidate`);
    const b = r.blocked.find((x) => x.skill_uid === s.uid);
    assert.equal(b?.code, 'input_unavailable', why);
    assert.ok(b!.inputs!.length && b!.inputs!.every((i) => i.required && i.status === status), `${why}: ${JSON.stringify(b!.inputs)}`);
    assert.ok(HARD.includes(status as any), 'every gated status is one of #4667\'s HARD statuses');
  }
  // #4667 reports a reader that gives another shape as partial, wrong_shape: the skill cannot run on it.
  const shape = { ...ready, state: 'not_ready' as const, inputs: ready.inputs.map((i, k) => (k === 0 ? { ...i, status: 'partial', reason: 'wrong_shape' } : i)) };
  assert.equal(gateOf({ ...s, inputs: shape }, a)?.code, 'input_unavailable');
  // A company agent's run names its venture when it starts: what a venture-less read found missing is deferred, said.
  const companyWide = await inputsFor(s.slug!, { fail: { 'grow.burn': 'null' } });
  assert.equal(companyWide.state, 'not_ready');
  const deferred = discoverSkills({ task }, a, LIBRARY.map((x) => (x === s ? { ...x, inputs: companyWide } : x)));
  assert.equal(deferred.candidates[0].skill_uid, s.uid);
  const block = deferred.candidates[0].inputs;
  assert.ok(block.available && block.state === 'conditional' && block.deferred.length === 1 && block.deferred[0].read === 'grow.burn', JSON.stringify(block));
});

test('5968 inputs: a run-selected document, fund or person\'s evidence is deferred; no binding is Not recorded, never available', async () => {
  // Mutations checked: RUN_SUPPLIED emptied → the contract skills (document not selected) are blocked; the "not
  // recorded" block replaced by `{ available: true, state: 'ready' }` → the outside-ten assert fails.
  for (const slug of ['contract-clause-extraction', 'contract-risk-issue-spotting', 'lp-quarterly-letter-draft']) {
    const f = await inputsFor(slug, { venture: true });
    const g = inputGapsOf(f);
    assert.deepEqual(g.unmet, [], `${slug}: ${JSON.stringify(g.unmet)}`);
    assert.ok(g.deferred.length >= 1, `${slug}: nothing deferred`);
    assert.equal(gateOf({ ...lib(slug), inputs: f }, agentFor(lib(slug))), null, slug);
  }
  const outside = lib('weekly-kpi-digest');
  assert.ok(!FIRST_TEN_SLUGS.includes(outside.slug!));
  const r = discoverSkills({ task: 'Give me this week\'s KPI digest.' }, agentFor(outside), LIBRARY);
  const c = r.candidates.find((x) => x.skill_uid === outside.uid)!;
  assert.deepEqual(c.inputs, { available: false, reason: 'Not recorded: no input binding is reported for this skill (#4667 covers the first ten skills).' });
  assert.match(r.stages[2].reason!, /Inputs are not checked/);
});

test('5968 run gate: a paused or outside-assistant agent is not_runnable, after every other code', () => {
  // Mutations checked: the `s.runnable` check dropped from `gateOf` → the paused case is a candidate; moved before
  // the role check → the role-mismatch case reads not_runnable.
  const s = lib('cash-runway-snapshot');
  const a = agentFor(s);
  for (const code of ['agent_paused', 'outside_assistant'] as const) {
    const r = discoverSkills({ task: 'How many months of runway do we have left?' }, a, LIBRARY.map((x) => (x === s ? { ...x, runnable: { ok: false, code } } : x)));
    assert.ok(!r.candidates.some((c) => c.skill_uid === s.uid));
    assert.deepEqual(r.blocked.find((b) => b.skill_uid === s.uid), { skill_uid: s.uid, name: s.name, code: 'not_runnable', run: code });
  }
  assert.equal(gateOf({ ...s, runnable: { ok: false, code: 'agent_paused' } }, { ...a, role: 'cto' })?.code, 'role_mismatch');
  assert.equal(gateOf({ ...s, runnable: { ok: true } }, a), null);
});

// ── Stage 4: quality evidence ───────────────────────────────────────────────

test('5968 stage 4: the block names the exact version, suite, models and evaluator; stale and incomplete are labelled and not scored', () => {
  // Mutations checked: the freshness test using `>` QUALITY_FRESH_DAYS days on newest instead of oldest → the
  // old-oldest case reads fresh; the evaluator check dropped → the earlier-evaluator case reads fresh; `meets` over
  // `recorded` instead of `units` → the incomplete case is judged; the release stale reasons dropped → stale false.
  const fresh = evaluationOf(quality(), 1);
  assert.ok(fresh.available);
  assert.equal(fresh.version, 1);
  assert.deepEqual(fresh.suite, { cases: 4, models: ['m1', 'm2'], models_source: 'version_evidence' });
  assert.ok(fresh.results.available !== false);
  assert.deepEqual([fresh.results.units, fresh.results.recorded, fresh.results.missing, fresh.results.pass, fresh.results.meets_bar], [8, 8, 0, 8, true]);
  assert.deepEqual(fresh.results.evaluator_versions, [EVALUATOR.version]);
  assert.equal(fresh.results.current_evaluator_version, EVALUATOR.version);
  assert.ok(fresh.release.available && fresh.release.evidence_hash === 'e'.repeat(64) && fresh.release.stale === false);
  assert.equal(fresh.freshness, 'fresh');
  assert.deepEqual(fresh.rank, { effect: 'raised', factor: 1 + QUALITY_BOOST, reason: fresh.rank.reason });

  const old = evaluationOf(quality({ hours_since_oldest: (QUALITY_FRESH_DAYS + 1) * 24, oldest_run_at: '2026-08-01 00:00:00' }), 1);
  assert.ok(old.available && old.freshness === 'stale' && old.rank.effect === 'none' && old.rank.factor === 1);
  assert.match(old.stale_reasons[0], /days old/);
  const edge = evaluationOf(quality({ hours_since_oldest: QUALITY_FRESH_DAYS * 24 }), 1);
  assert.ok(edge.available && edge.freshness === 'fresh', 'exactly the window is still fresh');
  const evaluator = evaluationOf(quality({ on_current_evaluator: 6, evaluator_versions: [EVALUATOR.version - 1, EVALUATOR.version] }), 1);
  assert.ok(evaluator.available && evaluator.freshness === 'stale' && evaluator.rank.factor === 1);
  assert.match(evaluator.stale_reasons.join(' '), /earlier evaluator/);
  const unknownTime = evaluationOf(quality({ hours_since_oldest: null, oldest_run_at: null }), 1);
  assert.ok(unknownTime.available && unknownTime.freshness === 'stale', 'an unknown run time is never fresh');
  const incomplete = evaluationOf(quality({ recorded: 6, on_current_evaluator: 6, counts: { pass: 6, fail: 0, not_run: 0 } }), 1);
  assert.ok(incomplete.available && incomplete.freshness === 'incomplete' && incomplete.rank.factor === 1);
  assert.ok(incomplete.results.available !== false && incomplete.results.meets_bar === null && incomplete.results.missing === 2);
  const failing = evaluationOf(quality(FAILING), 1);
  assert.ok(failing.available && failing.rank.effect === 'lowered' && failing.rank.factor === 1 - QUALITY_PENALTY);
  const release = evaluationOf(quality({}, { now: { suite_revision: 's'.repeat(64), evaluator_version: EVALUATOR.version + 1, models: ['m1'] } }), 1);
  assert.ok(release.available && release.release.available && release.release.stale && release.release.stale_reasons.length === 3, JSON.stringify(release));

  // Absent evidence is said, never zero.
  const none = evaluationOf(quality({ units: 8, recorded: 0, on_current_evaluator: 0, counts: { pass: 0, fail: 0, not_run: 0 }, by_model: {}, hours_since_oldest: null, oldest_run_at: null, newest_run_at: null }), 1);
  assert.ok(none.available && none.results.available === false && none.freshness === 'not_recorded' && none.rank.factor === 1);
  assert.deepEqual(evaluationOf(quality({ recorded: 0, counts: { pass: 0, fail: 0, not_run: 0 } }, { release: null }), 1),
    { available: false, reason: 'No golden-case result is recorded on v1, and it has no release manifest.' });
  assert.deepEqual(evaluationOf(quality({}, { version: 2 }), 3), { available: false, reason: 'The evidence read is for v2, not the published v3.' });
  const noManifest = evaluationOf(quality({}, { release: null }), 1);
  assert.ok(noManifest.available && noManifest.release.available === false && /before D4533/.test(noManifest.release.reason));
  assert.equal(evaluationOf(undefined, 1).available, false);
});

// ── Stage 5: operational evidence ───────────────────────────────────────────

test('5968 stage 5: served measures only; absent ones are unavailable; only failures move a score, down, over enough runs', () => {
  // Mutations checked: OPS_MIN_ENDED ignored → the 9-run case is lowered; a positive factor for a clean record →
  // the clean case is raised; `rateOf` returning 0 for no runs → the empty rates are numbers.
  const empty = operationalOf(ops(), 1);
  assert.ok(empty.available);
  for (const k of ['success', 'refusal', 'failure'] as const) assert.equal(typeof empty.outcomes.rates[k], 'object', `${k} with no run is a number`);
  for (const k of ['cost_per_completed_run', 'run_latency', 'workflows'] as const) assert.equal(empty[k].available, false);
  assert.equal(empty.scope, 'company_runs');
  const few = operationalOf(ops({ completed: 5, failed: OPS_MIN_ENDED - 6 }), 1);
  assert.ok(few.available && few.outcomes.ended === OPS_MIN_ENDED - 1 && few.rank.factor === 1);
  const failing = operationalOf(ops({ completed: 6, failed: 4 }), 1);
  assert.ok(failing.available && failing.outcomes.rates.failure === 0.4 && failing.rank.effect === 'lowered' && failing.rank.factor === 0.8);
  const clean = operationalOf(ops({ completed: 500 }), 1);
  assert.ok(clean.available && clean.rank.effect === 'none' && clean.rank.factor === 1);
  assert.deepEqual(operationalOf(ops({}, 2), 3), { available: false, reason: 'The runs read are for v2, not the published v3.' });
  assert.deepEqual(operationalOf({ available: false, reason: 'The run history could not be read.' }, 1), { available: false, reason: 'The run history could not be read.' });
});

test('5968: popularity never raises a rank; an unavailable measure is never read as zero', () => {
  // Mutations checked: the score multiplied by `1 + use_count / 1e6` or by `1 + completed / 1e4` → the twin
  // asserts fail; an unavailable evaluation scored as a 0-of-N failure (factor 1 - QUALITY_PENALTY) → the
  // unavailable asserts fail.
  const base = lib('cash-runway-snapshot');
  const a = agentFor(base);
  const task = 'How many months of runway do we have left at the current burn?';
  const twinA: DiscoverySkill = { ...base, uid: 'twin-a', use_count: 0, operations: ops({ completed: 3 }) };
  const twinB: DiscoverySkill = { ...base, uid: 'twin-b', use_count: 1_000_000, operations: ops({ completed: 90_000 }) };
  const r = discoverSkills({ task }, a, [...LIBRARY.filter((x) => x !== base), twinA, twinB]);
  const sa = r.candidates.find((c) => c.skill_uid === 'twin-a')!, sb = r.candidates.find((c) => c.skill_uid === 'twin-b')!;
  assert.equal(sa.score, sb.score, 'use count or run count moved a score');
  assert.deepEqual(r.candidates.map((c) => c.skill_uid).slice(0, 2), ['twin-a', 'twin-b'], 'ties break by name then uid, not by use');
  const flipped = discoverSkills({ task }, a, [...LIBRARY.filter((x) => x !== base), { ...twinA, use_count: 1_000_000 }, { ...twinB, use_count: 0 }]);
  assert.deepEqual(flipped.candidates.map((c) => [c.skill_uid, c.score]), r.candidates.map((c) => [c.skill_uid, c.score]));

  const plain = discoverSkills({ task }, a, LIBRARY).candidates[0];
  for (const unavailable of [
    { quality: { available: false as const, reason: 'The quality evidence could not be read.' } },
    { quality: quality({ recorded: 0, on_current_evaluator: 0, counts: { pass: 0, fail: 0, not_run: 0 }, by_model: {}, hours_since_oldest: null }) },
    { quality: quality({ ...FAILING, hours_since_oldest: 5000 }) },
    { operations: { available: false as const, reason: 'The run history could not be read.' } },
    { operations: ops({ failed: 9 }) },
  ]) {
    const got = discoverSkills({ task }, a, LIBRARY.map((x) => (x === base ? { ...x, ...unavailable } : x))).candidates[0];
    assert.equal(got.skill_uid, base.uid);
    assert.equal(got.score, plain.score, `${JSON.stringify(unavailable).slice(0, 80)} moved the score`);
  }
});

test('5968: fresh evidence moves the order, and the candidate says why', () => {
  // Mutations checked: the evidence factor left out of `score` → the raised score equals the plain one; the
  // quality reason not pushed → no `quality` reason.
  const base = lib('cash-runway-snapshot');
  const a = agentFor(base);
  const task = 'How many months of runway do we have left at the current burn?';
  const plain = discoverSkills({ task }, a, LIBRARY).candidates[0];
  const up = discoverSkills({ task }, a, LIBRARY.map((x) => (x === base ? { ...x, quality: quality() } : x))).candidates[0];
  assert.ok(up.score > plain.score);
  assert.ok(up.reasons.some((x) => x.signal === 'quality' && /9 of 10 bar/.test(x.text)));
  const down = discoverSkills({ task }, a, LIBRARY.map((x) => (x === base ? { ...x, quality: quality(FAILING), operations: ops({ completed: 5, failed: 5 }) } : x))).candidates.find((c) => c.skill_uid === base.uid);
  assert.ok(down && down.score < plain.score && down.reasons.some((x) => x.signal === 'operational'));
  const r = discoverSkills({ task }, a, LIBRARY.map((x) => (x === base ? { ...x, quality: quality() } : x)));
  assert.deepEqual(r.stages.slice(3).map((s) => s.available), [true, false]);
});

// ── Measurement ─────────────────────────────────────────────────────────────

type Fixture = { slug: string; scope: 'hq' | 'company'; company?: string; roles: string[]; tools: string[]; output: string; status: 'draft' | 'published' | 'retired' };
type Scenario = {
  id: string; kind: string; task: string; output_kind?: 'brief' | 'draft' | 'record_change';
  agent: { role: string; scope: string; company?: string; tools: string[] }; fixtures?: Fixture[];
  expect: { outcome: Discovery['outcome']; relevant: string[]; acceptable: string[]; must_not_return: Array<{ skill: string; code: string }> };
};
const SET = JSON.parse(readFileSync(new URL('../../documentation/architecture/skill-discovery/queries.v1.json', import.meta.url), 'utf8')) as { version: number; scenarios: Scenario[] };
const fixtureSkill = (f: Fixture): DiscoverySkill => ({
  uid: f.slug, slug: f.slug, scope: f.scope, company: f.company ?? null, status: f.status, readable: true, version: 1, suspended: false,
  name: f.slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), purpose: '', steps: [], roles: f.roles, tools: f.tools, output_kind: f.output, taxonomy: [],
});
const scenarioAgent = (sc: Scenario): DiscoveryAgent => ({ role: sc.agent.role, company: sc.agent.company ?? 'own', tools: sc.agent.tools });

/** Every first-ten library skill with #4667's preflight on a company agent's scope, all readers answering, or none readable. */
async function wired(mode: 'readable' | 'unreadable'): Promise<DiscoverySkill[]> {
  const out: DiscoverySkill[] = [];
  for (const s of LIBRARY) {
    if (!FIRST_TEN_SLUGS.includes(s.slug!)) { out.push(s); continue; }
    const fail = mode === 'unreadable' ? Object.fromEntries(FIRST_TEN.find((x) => x.slug === s.slug)!.needs.map((n) => [n.read, 'throw' as Fail])) : {};
    out.push({ ...s, inputs: await inputsFor(s.slug!, { fail }), runnable: { ok: true } });
  }
  return out;
}

function measureSet(library: readonly DiscoverySkill[], evidence: (s: DiscoverySkill, sc: Scenario) => Partial<DiscoverySkill> = () => ({})) {
  const rows = SET.scenarios.map((sc) => {
    const catalogue = [...library, ...(sc.fixtures ?? []).map(fixtureSkill)].map((s) => ({ ...s, ...evidence(s, sc) }));
    const r = discoverSkills({ task: sc.task, output_kind: sc.output_kind ?? null }, scenarioAgent(sc), catalogue);
    const got = r.candidates.map((c) => c.skill_uid);
    const ok = new Set([...sc.expect.relevant, ...sc.expect.acceptable]);
    const gated = got.filter((u) => gateOf(catalogue.find((s) => s.uid === u)!, scenarioAgent(sc), sc.output_kind ?? null) !== null);
    return {
      id: sc.id, outcome: r.outcome, expected: sc.expect.outcome, first: got[0] ?? null,
      p1: sc.expect.outcome === 'recommend' && got.length ? (ok.has(got[0]) ? 1 : 0) : null,
      first_relevant: sc.expect.relevant.length ? got.findIndex((u) => sc.expect.relevant.includes(u)) + 1 || null : null,
      ineligible: [...got.filter((u) => sc.expect.must_not_return.some((m) => m.skill === u)), ...gated], returned: got.length,
      input_blocked: r.blocked.filter((b) => b.code === 'input_unavailable').length,
    };
  });
  const p = rows.filter((r) => r.p1 !== null);
  const rel = rows.filter((r) => SET.scenarios.find((s) => s.id === r.id)!.expect.relevant.length);
  return {
    rows,
    summary: {
      scenarios: rows.length,
      precision_at_1: Math.round((p.reduce((a, r) => a + r.p1!, 0) / Math.max(1, p.length)) * 1000) / 1000,
      first_relevant_at_1: rel.filter((r) => r.first_relevant === 1).length, relevant_scenarios: rel.length,
      outcome_matches: rows.filter((r) => r.outcome === r.expected).length,
      ineligible_returned: rows.reduce((a, r) => a + r.ineligible.length, 0),
      input_unavailable_blocked: rows.reduce((a, r) => a + r.input_blocked, 0),
    },
  };
}

/** The #4588 qualification packs: each scenario's name, without its skill's prefix, asked as a task. */
const PACKS = readdirSync(new URL('../src/services/agents/skills/scenarios/', import.meta.url)).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(`../src/services/agents/skills/scenarios/${f}`, import.meta.url), 'utf8')) as { skill: string; scenarios: Array<{ case_id: string; name: string }> })
  .filter((p) => FIRST_TEN_SLUGS.includes(p.skill));

async function measureFirstTen() {
  const library = await wired('readable');
  let asked = 0, first = 0, top3 = 0, missed = 0, ineligible = 0, abstained = 0;
  for (const p of PACKS) {
    const s = library.find((x) => x.uid === p.skill)!;
    const a = agentFor(s);
    for (const sc of p.scenarios) {
      asked++;
      const task = sc.name.slice(sc.name.indexOf(': ') + 2);
      const r = discoverSkills({ task }, a, library);
      const at = r.candidates.findIndex((c) => c.skill_uid === s.uid);
      if (at === 0) first++;
      if (at >= 0 && at < 3) top3++;
      if (at < 0) missed++;
      if (r.outcome === 'no_suitable_skill') abstained++;
      ineligible += r.candidates.filter((c) => gateOf(library.find((x) => x.uid === c.skill_uid)!, a) !== null).length;
    }
  }
  // The gate against #4667, skill by skill: every scope-level failure of every required input, and the ready state.
  let gateCases = 0, gateAgree = 0;
  for (const t of FIRST_TEN) {
    const s = library.find((x) => x.uid === t.slug)!;
    const a = agentFor(s);
    const variants: Array<[Parameters<typeof inputsFor>[1], boolean]> = [[{}, true]];
    for (const n of t.needs.filter((x) => x.required && !x.read.startsWith('manual:'))) {
      for (const f of ['absent', 'withheld', 'throw'] as const) variants.push([{ fail: { [n.read]: f } }, false]);
      variants.push([{ granted: t.needs.map((x) => x.read).filter((k) => k !== n.read) }, false]);
    }
    for (const [o, runs] of variants) {
      gateCases++;
      const f = await inputsFor(t.slug, o);
      const offered = discoverSkills({ task: s.name }, a, library.map((x) => (x.uid === s.uid ? { ...x, inputs: f } : x))).candidates.some((c) => c.skill_uid === s.uid);
      const blockedRight = runs || gateOf({ ...s, inputs: f }, a)?.code === 'input_unavailable';
      if (offered === runs && blockedRight) gateAgree++;
    }
  }
  return { skills: PACKS.length, scenarios: asked, skill_first: first, skill_in_top_3: top3, skill_missed: missed, abstained, ineligible_returned: ineligible, gate_cases: gateCases, gate_agreement: gateAgree };
}

/** The numbers D4538-p8.md records. A change that moves one changes both, on purpose. */
const MEASURED = {
  queries_v1: {
    set_version: 1,
    wired_readable: { scenarios: 15, precision_at_1: 1, first_relevant_at_1: 10, relevant_scenarios: 10, outcome_matches: 15, ineligible_returned: 0, input_unavailable_blocked: 0 },
    wired_unreadable: { scenarios: 15, precision_at_1: 0.778, first_relevant_at_1: 7, relevant_scenarios: 10, outcome_matches: 14, ineligible_returned: 0, input_unavailable_blocked: 4 },
    worst_case_evidence: { scenarios: 15, precision_at_1: 1, first_relevant_at_1: 10, relevant_scenarios: 10, outcome_matches: 15, ineligible_returned: 0, input_unavailable_blocked: 0 },
  },
  first_ten: { skills: 10, scenarios: 52, skill_first: 31, skill_in_top_3: 37, skill_missed: 15, abstained: 11, ineligible_returned: 0, gate_cases: 62, gate_agreement: 62 },
};

test('5968 measurement: queries.v1.json with the sources wired, and the first-ten qualification set; zero ineligible', async (t) => {
  // Mutations checked: the input gate dropped from `gateOf` → wired_unreadable reads as wired_readable and the pinned
  // numbers fail; QUALITY_BOOST raised to 2 → worst_case_evidence loses relevant-first scenarios.
  const readable = measureSet(await wired('readable'));
  const unreadable = measureSet(await wired('unreadable'));
  // Worst case: every labelled relevant skill on fresh failing results and a 50% failure rate, every other skill on
  // fresh passing results: the most stages 4 and 5 can move an order.
  const worst = measureSet(await wired('readable'), (s, sc) => (sc.expect.relevant.includes(s.uid)
    ? { quality: quality(FAILING), operations: ops({ completed: 10, failed: 10 }) }
    : { quality: quality() }));
  for (const [name, m] of [['readable', readable], ['unreadable', unreadable], ['worst', worst]] as const) {
    t.diagnostic(`${name}: ${JSON.stringify(m.summary)}`);
    for (const r of m.rows) if (r.outcome !== r.expected || r.ineligible.length) t.diagnostic(`  ${r.id}: ${r.outcome} (label ${r.expected}) first=${r.first} ineligible=${r.ineligible.join(',')}`);
  }
  const firstTen = await measureFirstTen();
  t.diagnostic(`first_ten: ${JSON.stringify(firstTen)}`);
  for (const m of [readable, unreadable, worst]) assert.equal(m.summary.ineligible_returned, 0);
  assert.equal(firstTen.ineligible_returned, 0);
  assert.equal(firstTen.gate_agreement, firstTen.gate_cases);
  assert.deepEqual({
    queries_v1: { set_version: SET.version, wired_readable: readable.summary, wired_unreadable: unreadable.summary, worst_case_evidence: worst.summary },
    first_ten: firstTen,
  }, MEASURED);
});

test('D4538-p8.md records exactly these numbers', () => {
  const md = readFileSync(new URL('../../documentation/architecture/decisions/D4538-p8.md', import.meta.url), 'utf8');
  const block = /```json measured\n([\s\S]*?)\n```/.exec(md);
  assert.ok(block, 'D4538-p8.md has no ```json measured block');
  assert.deepEqual(JSON.parse(block![1]), MEASURED);
});

// ── The route, on real SQLite ───────────────────────────────────────────────

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, ADMIN = 2, EDITOR = 10, OTHER_EDITOR = 13;
const CFO = 'a'.repeat(32), GLOBEX_CFO = 'e'.repeat(32);

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const f of ['199_super_admin', '089_skills_values_taxonomy', '712_team_agents', '202611021724_team_agents_persona', '759_agent_skills',
    '202611022326_agent_skill_context_tokens', '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle', '202611090904_skill_eval_result_identity',
    '202611081919_skill_release_evidence', '202611092030_skill_version_release_note', '202611070826_team_agent_skill_events', '091_user_skill_profile',
    '202611022313_agent_skill_runs', '202611090905_skill_version_eval_identity']) db.exec(sql(`migrations/${f}.sql`));
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oli Other', 'founder', 103);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l3', OTHER_EDITOR, 2, 'Owner'); link.run('l4', SUPER, 1, 'Founder');
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('fp_and_a', 'finance_ops', 'FP&A')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ${EDITOR}, 5000000, ${EDITOR}, ?)`);
  agent.run(CFO, 'company', 1, null, 'cfo', 'Carla', MODEL, 'active');
  agent.run(GLOBEX_CFO, 'company', 2, null, 'cfo', 'Gil', MODEL, 'active');
  const env: any = { DB, JWT_SECRET: 'd5968-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;
function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  a.route('/api/teams', teamSkills);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
async function runwaySkill(w: W) {
  const made = await call(w, SUPER, 'POST', '/skills', {
    scope: 'hq', name: 'Runway months brief', purpose: 'Report months of runway from recorded balances and burn.',
    steps: ['Read the recorded cash balances', 'Divide by the monthly burn to report runway in months'], tools: [], output_kind: 'brief', roles: ['cfo'], tags: [{ slug: 'fp_and_a', level: 'proficient' }],
  });
  assert.equal(made.status, 201, made.text);
  const uid = made.body.skill.uid as string;
  await passHqGate(w.db, uid);
  const pub = await call(w, SUPER, 'POST', `/skills/${uid}/publish`);
  assert.equal(pub.status, 200, pub.text);
  return uid;
}
const ASK = { task: 'How many months of runway do we have from our balances and burn?', agent_uid: CFO };

test('5968 route: the published version\'s quality evidence, by version, suite and model; stale results are labelled', async () => {
  // Mutations checked: EVALS_SQL without `e.version = s.current_version` → the v2 fail is counted; the oldest taken
  // as the newest row → the two-unit evidence reads fresh.
  const w = world();
  const uid = await runwaySkill(w);
  const s = w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(uid) as { id: number };
  const kase = w.db.prepare('SELECT uid FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL').get(s.id) as { uid: string };
  const row = w.db.prepare(`INSERT INTO agent_skill_version_evals (skill_id, version, case_key, case_name, model_id, result, run_by, run_at, evaluator_version, case_sha256)
    VALUES (?, ?, ?, 'gate', 'm', ?, ${SUPER}, ?, ?, NULL)`);
  const before = await call(w, EDITOR, 'POST', '/skills/discover', ASK);
  const ev0 = before.body.candidates[0].evaluation;
  assert.ok(ev0.available && ev0.version === 1 && ev0.results.available === false && ev0.release.available, JSON.stringify(ev0));
  assert.deepEqual(ev0.suite, { cases: 1, models: ['m'], models_source: 'version_evidence' });
  assert.equal(ev0.release.evaluator_version, EVALUATOR.version);

  row.run(s.id, 1, kase.uid, 'pass', w.db.prepare("SELECT datetime('now', '-1 day') AS t").get().t, EVALUATOR.version);
  // Another version's row (a later draft's, say) is never this version's evidence.
  row.run(s.id, 2, kase.uid, 'fail', w.db.prepare("SELECT datetime('now') AS t").get().t, EVALUATOR.version);
  const fresh = await call(w, EDITOR, 'POST', '/skills/discover', ASK);
  const ev = fresh.body.candidates[0].evaluation;
  assert.deepEqual([ev.results.recorded, ev.results.pass, ev.results.meets_bar, ev.freshness, ev.rank.effect], [1, 1, true, 'fresh', 'raised'], JSON.stringify(ev));
  assert.deepEqual(ev.results.by_model, { m: { pass: 1, fail: 0, not_run: 0 } });
  assert.equal(fresh.body.stages[3].available, true);

  // Two units: one run yesterday, one long ago. Freshness is the oldest's, so the evidence is stale.
  w.db.prepare('DELETE FROM agent_skill_version_evals').run();
  w.db.prepare(`INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES ('${'9'.repeat(32)}', ?, 'second', '{"records":{"x.read":{}}}', '{"output":"brief","must_include":["x"],"must_say_not_recorded":[],"must_not_include":[]}', ${SUPER})`).run(s.id);
  row.run(s.id, 1, kase.uid, 'pass', w.db.prepare("SELECT datetime('now', '-1 day') AS t").get().t, EVALUATOR.version);
  row.run(s.id, 1, '9'.repeat(32), 'pass', w.db.prepare(`SELECT datetime('now', '-${QUALITY_FRESH_DAYS + 30} days') AS t`).get().t, EVALUATOR.version);
  const stale = (await call(w, EDITOR, 'POST', '/skills/discover', ASK)).body.candidates[0].evaluation;
  assert.deepEqual([stale.results.recorded, stale.freshness, stale.rank.effect, stale.rank.factor], [2, 'stale', 'none', 1], JSON.stringify(stale));
  assert.ok(stale.release.stale && /golden cases changed/.test(stale.release.stale_reasons.join(' ')), 'a case added after the release leaves the manifest stale');
  assert.match(stale.stale_reasons[0], /days old/);
});

test('5968 route: run measures are this company\'s agents\' only, even for HQ\'s admin; a paused agent is not_runnable', async () => {
  // Mutations checked: OUTCOMES_SQL without the company clause → Globex's failures enter Acme's figures and lower
  // the score; the version filter dropped in operationalFacts → the v9 events count; `agent_paused` never set → the
  // paused agent gets a candidate.
  const w = world();
  const uid = await runwaySkill(w);
  const ids = Object.fromEntries((w.db.prepare('SELECT id, uid FROM team_agents').all() as Array<{ id: number; uid: string }>).map((r) => [r.uid, r.id]));
  const event = w.db.prepare("INSERT INTO team_agent_events (agent_id, kind, detail_json) VALUES (?, ?, ?)");
  const detail = (version: number, code?: string, status?: number) => JSON.stringify({ skill: { uid, version }, outcome_v: 1, ...(code ? { code, status } : {}) });
  for (let i = 0; i < 4; i++) event.run(ids[CFO], 'run', detail(1));
  for (let i = 0; i < 30; i++) event.run(ids[GLOBEX_CFO], 'refused', detail(1, 'run_failed', 502));
  event.run(ids[CFO], 'refused', detail(9, 'run_failed', 502));
  for (const who of [EDITOR, SUPER]) {
    const r = await call(w, who, 'POST', '/skills/discover', ASK);
    assert.equal(r.status, 200, r.text);
    const op = r.body.candidates[0].operational;
    assert.ok(op.available, r.text);
    assert.deepEqual([op.outcomes.completed, op.outcomes.failed, op.outcomes.ended, op.rank.factor], [4, 0, 4, 1], `user ${who}: ${JSON.stringify(op)}`);
    assert.equal(op.cost_per_completed_run.available, false);
  }
  const globex = await call(w, OTHER_EDITOR, 'POST', '/skills/discover', { ...ASK, agent_uid: GLOBEX_CFO });
  const gop = globex.body.candidates.find((c: any) => c.skill_uid === uid);
  assert.deepEqual([gop.operational.outcomes.failed, gop.operational.rank.effect], [30, 'lowered'], globex.text);

  w.db.prepare("UPDATE team_agents SET status = 'paused', paused_reason = 'manual' WHERE uid = ?").run(CFO);
  const paused = await call(w, EDITOR, 'POST', '/skills/discover', ASK);
  assert.equal(paused.status, 200, paused.text);
  assert.ok(!paused.body.candidates.some((c: any) => c.skill_uid === uid));
  assert.deepEqual(paused.body.blocked.find((b: any) => b.skill_uid === uid), { skill_uid: uid, name: 'Runway months brief', code: 'not_runnable', run: 'agent_paused' });
});

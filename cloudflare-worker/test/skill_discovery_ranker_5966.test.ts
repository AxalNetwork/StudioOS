/**
 * D4538 part 4 (#5966, of #4538) — the discovery service (`services/agents/skillDiscovery.ts`) run on every scenario
 * of `documentation/architecture/skill-discovery/queries.v1.json`, measured, and held to the contract.
 *
 * Its neighbour `skill_discovery_queries_4538.test.ts` holds the labels to the library and the gate; this file runs
 * the ranker against those labels. It reports, per scenario and in total:
 *   - precision@1 and precision@3: of the first k candidates (at most as many as were returned), the share labelled
 *     `relevant` or `acceptable`, over scenarios labelled `recommend`;
 *   - recall@3 of the `relevant` labels, where a scenario has them;
 *   - the rank of the first `relevant` skill (1 is best; absent counts as a miss);
 *   - the ineligible-recommendation rate: `must_not_return` skills in `candidates`. It must be zero, or this fails;
 *   - abstention matches: the outcome equals the label's outcome.
 * The measured numbers are pinned in `MEASURED` and must equal the ```json measured block of
 * `documentation/architecture/decisions/D4538-p4.md`, with the set's version, so a ranker change that moves them
 * changes both, on purpose.
 *
 * It also holds the contract: another company's skill is in neither list; a role mismatch and a missing tool are
 * in `blocked` with the gate's code (and the tool); the ambiguous scenario asks a question at low confidence; the
 * abstentions give a reason; a version is always published; the evidence blocks are `{ available: false, reason }`;
 * use count moves nothing; the service has no store, route or attach in reach.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_LIBRARY } from './_skill_library.ts';
import { readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';
import {
  discoverSkills, gateOf, checkDiscoveryRequest, terms, type DiscoveryAgent, type DiscoverySkill, type Discovery,
} from '../src/services/agents/skillDiscovery.ts';

type Fixture = { slug: string; scope: 'hq' | 'company'; company?: string; roles: string[]; tools: string[]; output: string; status: 'draft' | 'published' | 'retired' };
type Scenario = {
  id: string; kind: string; task: string; output_kind?: 'brief' | 'draft' | 'record_change';
  agent: { role: string; scope: string; company?: string; tools: string[] }; fixtures?: Fixture[];
  expect: { outcome: Discovery['outcome']; relevant: string[]; acceptable: string[]; must_not_return: Array<{ skill: string; code: string; tool?: string }> };
};
const SET_PATH = '../../documentation/architecture/skill-discovery/queries.v1.json';
const SET = JSON.parse(readFileSync(new URL(SET_PATH, import.meta.url), 'utf8')) as { version: number; scenarios: Scenario[] };

/** The library as the catalogue would describe it: every skill published at version 1, HQ scope, use count varied. */
const LIBRARY: DiscoverySkill[] = SKILL_LIBRARY.map((e, i) => {
  const d = readLibrarySkill(e.skill_md) as { slug: string; name: string; purpose: string; steps: string[]; tools: string[]; output_kind: string; tags: Array<{ slug: string }>; roles: string[] };
  assert.ok(d, `${e.slug} does not parse`);
  return {
    uid: d.slug, scope: 'hq', company: null, status: 'published', readable: true, version: 1, suspended: false,
    name: d.name, purpose: d.purpose, steps: d.steps, roles: d.roles, tools: d.tools, output_kind: d.output_kind, taxonomy: d.tags,
    use_count: (i * 37) % 101,
  };
});

const fixtureSkill = (f: Fixture): DiscoverySkill => ({
  uid: f.slug, scope: f.scope, company: f.company ?? null, status: f.status, readable: true, version: 1, suspended: false,
  name: f.slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), purpose: '', steps: [],
  roles: f.roles, tools: f.tools, output_kind: f.output, taxonomy: [],
});
const agentOf = (sc: Scenario): DiscoveryAgent => ({ role: sc.agent.role, company: sc.agent.company ?? 'own', tools: sc.agent.tools });
const catalogueOf = (sc: Scenario) => [...LIBRARY, ...(sc.fixtures ?? []).map(fixtureSkill)];
const run = (sc: Scenario, catalogue = catalogueOf(sc)) => discoverSkills({ task: sc.task, output_kind: sc.output_kind ?? null }, agentOf(sc), catalogue);

const K = [1, 3] as const;
type Row = { id: string; outcome: string; expected: string; first_relevant: number | null; p: Record<number, number | null>; recall3: number | null; ineligible: string[]; top: string[] };

function measure(): { rows: Row[]; summary: Record<string, unknown> } {
  const rows: Row[] = SET.scenarios.map((sc) => {
    const r = run(sc);
    const got = r.candidates.map((c) => c.skill_uid);
    const ok = new Set([...sc.expect.relevant, ...sc.expect.acceptable]);
    const p: Record<number, number | null> = {};
    for (const k of K) {
      const head = got.slice(0, k);
      p[k] = sc.expect.outcome === 'recommend' && head.length ? head.filter((u) => ok.has(u)).length / head.length : null;
    }
    const firstAt = got.findIndex((u) => sc.expect.relevant.includes(u));
    return {
      id: sc.id, outcome: r.outcome, expected: sc.expect.outcome,
      first_relevant: sc.expect.relevant.length ? (firstAt < 0 ? null : firstAt + 1) : null,
      p, recall3: sc.expect.relevant.length ? got.slice(0, 3).filter((u) => sc.expect.relevant.includes(u)).length / sc.expect.relevant.length : null,
      ineligible: got.filter((u) => sc.expect.must_not_return.some((m) => m.skill === u)), top: got.slice(0, 3),
    };
  });
  const mean = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null; };
  const recommend = SET.scenarios.filter((s) => s.expect.outcome === 'recommend');
  const withRelevant = rows.filter((r) => SET.scenarios.find((s) => s.id === r.id)!.expect.relevant.length);
  const summary = {
    set_version: SET.version, scenarios: rows.length,
    precision_at_1: mean(rows.map((r) => r.p[1])), precision_at_3: mean(rows.map((r) => r.p[3])),
    precision_scenarios: recommend.length,
    mean_candidates_on_recommend: mean(rows.filter((r) => r.expected === 'recommend').map((r) => run(SET.scenarios.find((s) => s.id === r.id)!).candidates.length)),
    recall_at_3: mean(rows.map((r) => r.recall3)),
    first_relevant_at_1: withRelevant.filter((r) => r.first_relevant === 1).length,
    first_relevant_missed: withRelevant.filter((r) => r.first_relevant === null).length,
    mean_first_relevant_rank: mean(withRelevant.map((r) => r.first_relevant)),
    relevant_scenarios: withRelevant.length,
    ineligible_rate: rows.reduce((a, r) => a + r.ineligible.length, 0) / Math.max(1, rows.reduce((a, r) => a + r.top.length, 0)),
    ineligible_returned: rows.reduce((a, r) => a + r.ineligible.length, 0),
    outcome_matches: rows.filter((r) => r.outcome === r.expected).length,
    abstention_matches: `${rows.filter((r) => r.expected === 'no_suitable_skill' && r.outcome === 'no_suitable_skill').length}/${rows.filter((r) => r.expected === 'no_suitable_skill').length}`,
    false_abstentions: rows.filter((r) => r.expected !== 'no_suitable_skill' && r.outcome === 'no_suitable_skill').length,
  };
  return { rows, summary };
}

/** The numbers D4538-p4.md records for queries.v1.json. A ranker change that moves one changes both on purpose. */
const MEASURED = {
  set_version: 1, scenarios: 15,
  precision_at_1: 1, precision_at_3: 1,
  precision_scenarios: 10, mean_candidates_on_recommend: 1,
  recall_at_3: 1,
  first_relevant_at_1: 10, first_relevant_missed: 0, mean_first_relevant_rank: 1, relevant_scenarios: 10,
  ineligible_rate: 0, ineligible_returned: 0,
  outcome_matches: 15, abstention_matches: '4/4', false_abstentions: 0,
};

test('the measurement on queries.v1.json: zero ineligible recommendations, and the recorded numbers', (t) => {
  const { rows, summary } = measure();
  for (const r of rows) t.diagnostic(`${r.id}: ${r.outcome} (label ${r.expected}) first_relevant=${r.first_relevant} p@1=${r.p[1]} p@3=${r.p[3]} top=${r.top.join(', ')}`);
  t.diagnostic(JSON.stringify(summary));
  for (const r of rows) assert.deepEqual(r.ineligible, [], `${r.id}: must_not_return skills recommended: ${r.ineligible.join(', ')}`);
  assert.equal(summary.ineligible_rate, 0);
  assert.deepEqual(summary, MEASURED);
});

test('D4538-p4.md records exactly these numbers, with the set\'s version', () => {
  const md = readFileSync(new URL('../../documentation/architecture/decisions/D4538-p4.md', import.meta.url), 'utf8');
  const block = /```json measured\n([\s\S]*?)\n```/.exec(md);
  assert.ok(block, 'D4538-p4.md has no ```json measured block');
  assert.deepEqual(JSON.parse(block![1]), MEASURED);
  assert.match(md, /queries\.v1\.json/);
});

test('every scenario\'s outcome is its label\'s, and every relevant skill is ranked first', () => {
  for (const sc of SET.scenarios) {
    const r = run(sc);
    assert.equal(r.outcome, sc.expect.outcome, `${sc.id}: ${r.outcome}, labelled ${sc.expect.outcome}`);
    if (sc.expect.relevant.length) assert.equal(r.candidates[0]?.skill_uid, sc.expect.relevant[0], `${sc.id}: first is ${r.candidates[0]?.skill_uid}`);
  }
});

test('no must_not_return skill is a candidate, on any scenario, at any limit', () => {
  for (const sc of SET.scenarios) {
    for (const limit of [1, 5, 10]) {
      const r = discoverSkills({ task: sc.task, output_kind: sc.output_kind ?? null, limit }, agentOf(sc), catalogueOf(sc));
      for (const m of sc.expect.must_not_return) assert.ok(!r.candidates.some((c) => c.skill_uid === m.skill), `${sc.id}: ${m.skill} recommended at limit ${limit}`);
      for (const c of r.candidates) {
        const s = catalogueOf(sc).find((x) => x.uid === c.skill_uid)!;
        assert.equal(gateOf(s, agentOf(sc), sc.output_kind ?? null), null, `${sc.id}: ${c.skill_uid} fails the gate but is a candidate`);
      }
    }
  }
});

test('another company\'s skill is in neither candidates nor blocked, even when its task is an exact match', () => {
  for (const sc of SET.scenarios) {
    const r = run(sc);
    for (const m of sc.expect.must_not_return.filter((x) => x.code === 'not_found')) {
      assert.ok(!r.candidates.some((c) => c.skill_uid === m.skill), `${sc.id}: ${m.skill} is a candidate`);
      assert.ok(!r.blocked.some((b) => b.skill_uid === m.skill), `${sc.id}: ${m.skill} is listed as blocked`);
    }
  }
  const sc = SET.scenarios.find((s) => s.kind === 'cross_tenant')!;
  const other: DiscoverySkill = { ...LIBRARY.find((s) => s.uid === 'weekly-kpi-digest')!, uid: 'orbit-copy', scope: 'company', company: 'orbit', name: 'Weekly KPI digest', tools: ['grow.read'] };
  const r = run(sc, [...catalogueOf(sc), other]);
  assert.ok(![...r.candidates, ...r.blocked].some((x) => x.skill_uid === 'orbit-copy'), 'a matching other-company copy leaks');
  const own = run(sc, [...catalogueOf(sc), { ...other, company: sc.agent.company! }]);
  assert.ok(own.candidates.some((c) => c.skill_uid === 'orbit-copy'), 'the agent\'s own company skill is a candidate');
  const withoutOther = run(sc, catalogueOf(sc).filter((s) => s.uid !== 'kpi-digest-orbit'));
  assert.deepEqual(r.candidates.map((c) => [c.skill_uid, c.score]), withoutOther.candidates.map((c) => [c.skill_uid, c.score]), 'a hidden skill moves a score');
});

test('a role mismatch and a missing tool are in blocked with the gate\'s code, and the tool', () => {
  const kinds = SET.scenarios.filter((s) => s.kind === 'role_mismatch' || s.kind === 'missing_tool');
  assert.ok(kinds.length >= 2);
  for (const sc of kinds) {
    const r = run(sc);
    for (const m of sc.expect.must_not_return) {
      const b = r.blocked.find((x) => x.skill_uid === m.skill);
      assert.ok(b, `${sc.id}: ${m.skill} is not listed as blocked`);
      assert.equal(b!.code, m.code, `${sc.id}: blocked for ${b!.code}`);
      if (m.code === 'tool_not_approved') assert.deepEqual(b!.tool, { key: m.tool, label: m.tool });
      else assert.equal(b!.tool, undefined);
    }
    assert.ok(r.abstain_reason && r.abstain_reason.includes(r.blocked[0].name), `${sc.id}: the reason does not name the blocked skill`);
  }
  const missing = SET.scenarios.find((s) => s.kind === 'missing_tool')!;
  assert.match(run(missing).abstain_reason!, /mercury\.read/);
});

test('the ambiguous scenario asks a question at low confidence; the abstentions give a reason', () => {
  for (const sc of SET.scenarios.filter((s) => s.expect.outcome === 'ambiguous')) {
    const r = run(sc);
    assert.equal(r.outcome, 'ambiguous');
    assert.ok(r.candidates.length >= 2);
    assert.ok(r.candidates.every((c) => c.confidence === 'low' && c.uncertainty), `${sc.id}: a candidate is not low`);
    assert.ok(r.clarify && r.clarify.endsWith('?'), `${sc.id}: no clarifying question`);
    assert.deepEqual(r.candidates.slice(0, 2).map((c) => c.skill_uid).sort(), [...sc.expect.acceptable].sort(), `${sc.id}: the question is not between the labelled skills`);
    for (const c of r.candidates.slice(0, 2)) assert.ok(r.clarify!.includes(c.name), `${sc.id}: the question does not name ${c.name}`);
    assert.equal(r.abstain_reason, null);
  }
  for (const sc of SET.scenarios.filter((s) => s.expect.outcome === 'no_suitable_skill')) {
    const r = run(sc);
    assert.equal(r.outcome, 'no_suitable_skill');
    assert.ok(r.abstain_reason && r.abstain_reason.length > 20, `${sc.id}: no reason`);
    assert.equal(r.clarify, null);
    assert.ok(r.candidates.every((c) => c.confidence === 'low' && sc.expect.acceptable.includes(c.skill_uid)), `${sc.id}: an abstention offers ${r.candidates.map((c) => c.skill_uid)}`);
  }
  for (const sc of SET.scenarios.filter((s) => s.expect.outcome === 'recommend')) {
    const r = run(sc);
    assert.equal(r.clarify, null); assert.equal(r.abstain_reason, null);
  }
});

test('a candidate names a published version, never a draft; drafts and unpublished skills are gated', () => {
  const sc = SET.scenarios.find((s) => s.id === 'runway-cfo')!;
  const runway = LIBRARY.find((s) => s.uid === 'cash-runway-snapshot')!;
  const at3 = run(sc, LIBRARY.map((s) => (s === runway ? { ...s, version: 3 } : s)));
  assert.equal(at3.candidates[0].version, 3);
  for (const sc2 of SET.scenarios) for (const c of run(sc2).candidates) assert.ok(Number.isSafeInteger(c.version) && c.version >= 1);
  const unpublished = run(sc, LIBRARY.map((s) => (s === runway ? { ...s, status: 'draft' as const, version: null } : s)));
  assert.ok(!unpublished.candidates.some((c) => c.skill_uid === runway.uid));
  assert.deepEqual(unpublished.blocked.find((b) => b.skill_uid === runway.uid), { skill_uid: runway.uid, name: runway.name, code: 'version_not_published' });
  const unreadable = run(sc, LIBRARY.map((s) => (s === runway ? { ...s, status: 'draft' as const, readable: false } : s)));
  assert.ok(![...unreadable.candidates, ...unreadable.blocked].some((x) => x.skill_uid === runway.uid), 'a draft the caller may not read is named');
  const suspended = run(sc, LIBRARY.map((s) => (s === runway ? { ...s, suspended: true } : s)));
  assert.equal(suspended.blocked.find((b) => b.skill_uid === runway.uid)?.code, 'skill_suspended');
});

test('evaluation and operational are { available: false, reason } on every candidate; use count is not an input', () => {
  for (const sc of SET.scenarios) {
    const r = run(sc);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c.evaluation).sort(), ['available', 'reason']);
      assert.equal(c.evaluation.available, false); assert.ok(c.evaluation.reason);
      assert.deepEqual(Object.keys(c.operational).sort(), ['available', 'reason']);
      assert.equal(c.operational.available, false); assert.ok(c.operational.reason);
      assert.deepEqual(c.missing, []);
      assert.equal(c.fit.role, true);
    }
    assert.deepEqual(r.stages.filter((s) => s.stage >= 4).map((s) => s.available), [false, false]);
    const flipped = discoverSkills({ task: sc.task, output_kind: sc.output_kind ?? null }, agentOf(sc), catalogueOf(sc).map((s, i) => ({ ...s, use_count: i % 2 ? 0 : 1e6 })));
    assert.deepEqual(flipped, r, `${sc.id}: use count moved the answer`);
  }
});

test('the gate: attachCheck\'s order, output_mismatch, and the two seams only when wired', () => {
  const s: DiscoverySkill = { ...LIBRARY.find((x) => x.uid === 'cash-runway-snapshot')! };
  const a: DiscoveryAgent = { role: 'cfo', company: 7, tools: ['mercury.read', 'grow.read'] };
  assert.equal(gateOf(s, a), null);
  assert.deepEqual(gateOf({ ...s, scope: 'company', company: 8 }, a), { code: 'not_found' });
  assert.deepEqual(gateOf({ ...s, scope: 'company', company: null }, { ...a, company: null }), { code: 'not_found' }, 'a company skill with no company is nobody\'s');
  assert.equal(gateOf({ ...s, scope: 'company', company: 7 }, a), null);
  assert.deepEqual(gateOf({ ...s, readable: false }, a), { code: 'not_found' });
  assert.deepEqual(gateOf({ ...s, version: 0, status: 'retired' }, a), { code: 'version_not_published' }, 'unpublished is said before retired');
  assert.deepEqual(gateOf({ ...s, status: 'retired', suspended: true, roles: ['ceo'] }, a), { code: 'skill_retired' });
  assert.deepEqual(gateOf({ ...s, suspended: true, roles: ['ceo'] }, a), { code: 'skill_suspended' });
  assert.deepEqual(gateOf({ ...s, roles: ['ceo'] }, { ...a, tools: [] }), { code: 'role_mismatch' });
  assert.deepEqual(gateOf(s, { ...a, tools: ['grow.read'] }), { code: 'tool_not_approved', tool: { key: 'mercury.read', label: 'mercury.read' } });
  assert.deepEqual(gateOf(s, a, 'draft'), { code: 'output_mismatch' });
  assert.equal(gateOf(s, a, 'brief'), null);
  assert.deepEqual(gateOf(s, a, null, { inputs: () => false }), { code: 'input_unavailable' });
  assert.deepEqual(gateOf(s, a, null, { inputs: () => true, runnable: () => false }), { code: 'not_runnable' });
  assert.deepEqual(gateOf(s, a, 'draft', { inputs: () => false }), { code: 'output_mismatch' }, 'the seams come last');
  const sc = SET.scenarios.find((x) => x.id === 'runway-cfo')!;
  const r = discoverSkills({ task: sc.task }, agentOf(sc), LIBRARY, { inputs: (x) => x.uid !== 'cash-runway-snapshot' });
  assert.equal(r.blocked.find((b) => b.skill_uid === 'cash-runway-snapshot')?.code, 'input_unavailable');
  assert.equal(run(sc).stages[2].reason?.includes('#4667'), true, 'stage 3 says inputs were not checked');
  assert.equal(r.stages[2].reason, null);
});

test('the request\'s bounds, and the limit', () => {
  assert.deepEqual(checkDiscoveryRequest({ task: ' Runway? ' }), { ok: true, request: { task: 'Runway?', output_kind: null, taxonomy_focus: [], limit: 5 } });
  for (const bad of [{}, { task: '' }, { task: 'x'.repeat(501) }, { task: 1 }]) assert.deepEqual(checkDiscoveryRequest(bad), { ok: false, code: 'task_invalid' });
  assert.deepEqual(checkDiscoveryRequest({ task: 't', output_kind: 'email' }), { ok: false, code: 'output_kind_invalid' });
  for (const f of [['a', 'b', 'c', 'd'], ['Bad slug'], 'x']) assert.deepEqual(checkDiscoveryRequest({ task: 't', taxonomy_focus: f }), { ok: false, code: 'taxonomy_focus_invalid' });
  for (const l of [0, 11, 2.5, '3']) assert.deepEqual(checkDiscoveryRequest({ task: 't', limit: l }), { ok: false, code: 'limit_invalid' });
  assert.equal(checkDiscoveryRequest({ task: 'x'.repeat(500), limit: 10, output_kind: 'draft', taxonomy_focus: ['finops_treasury'] }).ok, true);
  const sc = SET.scenarios.find((x) => x.id === 'pricing-ambiguous-cpo')!;
  assert.equal(discoverSkills({ task: sc.task, limit: 1 }, agentOf(sc), LIBRARY).candidates.length, 1);
});

test('taxonomy focus raises a tagged skill and is reported as a reason', () => {
  const sc = SET.scenarios.find((x) => x.id === 'pricing-ambiguous-cpo')!;
  const plain = discoverSkills({ task: sc.task }, agentOf(sc), LIBRARY);
  const second = plain.candidates[1];
  const tag = LIBRARY.find((s) => s.uid === second.skill_uid)!.taxonomy[0].slug;
  const focused = discoverSkills({ task: sc.task, taxonomy_focus: [tag] }, agentOf(sc), LIBRARY);
  const after = focused.candidates.find((c) => c.skill_uid === second.skill_uid)!;
  assert.ok(after.score > second.score, 'focus did not raise the score');
  assert.ok(after.fit.taxonomy.includes(tag));
  assert.ok(after.reasons.some((x) => x.signal === 'taxonomy' && x.text.includes(tag)));
});

test('terms: stop words, stems, and nothing but the task\'s own words', () => {
  assert.deepEqual(terms("How many months of runway do we have left?"), ['month', 'runway']);
  assert.deepEqual(terms('Pricing prices priced'), ['pric', 'pric', 'pric']);
  assert.deepEqual(terms('What shipped this week?'), ['ship', 'week']);
});

test('the service reads no store, mounts no route, attaches nothing and calls nothing', () => {
  const src = readFileSync(new URL('../src/services/agents/skillDiscovery.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of [/\bDB\b/, /\bprepare\(/, /\bfetch\(/, /\benv\b/, /\bINSERT\b|\bUPDATE\b|\bDELETE\s+FROM\b/i, /linkStatement|checkSkillList|attachCheck\(/, /new Hono|Router\(/]) {
    assert.doesNotMatch(code, banned, `the service uses ${banned}`);
  }
  const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['./skillLinks', './skills']);
  assert.match(code, /import \{ toolLabel, type AttachCode \} from '\.\/skillLinks'/, 'only toolLabel is a value from skillLinks');
});

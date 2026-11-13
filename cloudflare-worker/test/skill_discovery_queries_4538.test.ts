/**
 * D4538 (#4538) — the labelled discovery query set is held to the library and to the eligibility gate.
 *
 * `documentation/architecture/skill-discovery/queries.v1.json` labels what a recommender should return. Labels are
 * human judgements; the gate is deterministic. This file keeps the two consistent, so no label can ask a ranker to
 * return a skill the agent could not run:
 *   - every named skill is a library slug or an inline fixture, every role is a catalogue role, and every agent tool
 *     is one some skill uses (a typo would silently make a skill ineligible);
 *   - every `relevant` and `acceptable` skill passes the gate for its scenario's agent;
 *   - every `must_not_return` skill fails it, with exactly the stated code (and tool, for `tool_not_approved`);
 *   - an abstention (`no_suitable_skill`) names no relevant skill, and `ambiguous` names at least two acceptable ones;
 *   - the set covers every kind the issue asks for.
 *
 * The gate here is the order `attachCheck` (services/agents/skillLinks.ts) refuses in, over a skill's frontmatter,
 * plus discovery's `output_mismatch` (SKILL_DISCOVERY_CONTRACT.md). It uses the Worker's own `missingTools`.
 *
 * Mutation checked: a relevant skill swapped for one the agent's role cannot run; a must_not_return code changed; a
 * tool typo in an agent's grants; an abstention given a relevant skill. Each fails a test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_LIBRARY } from './_skill_library.ts'; // D4574 H3: the entries are a static asset
import { ROLES } from '../src/services/agents/catalogue.ts';
import { missingTools } from '../src/services/agents/skills.ts';

type Skill = { slug: string; scope: 'hq' | 'company'; company?: string; roles: string[]; tools: string[]; output: string; status: string };
type Agent = { role: string; scope: 'company' | 'project'; company?: string; tools: string[] };
type Ref = string | { skill: string; code: string; tool?: string };
type Scenario = {
  id: string; kind: string; task: string; output_kind?: string; agent: Agent; fixtures?: Skill[]; notes?: string;
  expect: { outcome: 'recommend' | 'ambiguous' | 'no_suitable_skill'; relevant: string[]; acceptable: string[]; must_not_return: Array<{ skill: string; code: string; tool?: string }> };
};

const SET = JSON.parse(readFileSync(new URL('../../documentation/architecture/skill-discovery/queries.v1.json', import.meta.url), 'utf8')) as { version: number; scenarios: Scenario[] };

/** A frontmatter line's value (`key: value`), read without building a pattern from `key`. */
const one = (md: string, key: string): string => md.split('\n').find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim() ?? '';
const list = (md: string, key: string): string[] => {
  const v = one(md, key);
  return v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : [];
};
const LIBRARY = new Map<string, Skill>(SKILL_LIBRARY.map((e) => [e.slug, {
  slug: e.slug, scope: 'hq', roles: list(e.skill_md, 'roles'), tools: list(e.skill_md, 'tools'), output: one(e.skill_md, 'output'), status: 'published',
}]));
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));
const KNOWN_TOOLS = new Set([...LIBRARY.values()].flatMap((s) => s.tools));

/** Why `agent` may not be recommended `s` for this request; null when it may. `attachCheck`'s order, then discovery's. */
export function gate(s: Skill, agent: Agent, outputKind?: string): { code: string; tool?: string } | null {
  if (s.scope === 'company' && s.company !== agent.company) return { code: 'not_found' };
  if (s.status === 'retired') return { code: 'skill_retired' };
  if (!s.roles.includes(agent.role)) return { code: 'role_mismatch' };
  const missing = missingTools(s.tools, agent.tools.map((tool) => ({ tool } as any)));
  if (missing.length) return { code: 'tool_not_approved', tool: missing[0] };
  if (outputKind && s.output !== outputKind) return { code: 'output_mismatch' };
  return null;
}

const skillOf = (sc: Scenario, slug: string): Skill | undefined => sc.fixtures?.find((f) => f.slug === slug) ?? LIBRARY.get(slug);

test('the set is versioned, its ids are unique, and it covers every kind the issue asks for', () => {
  assert.equal(SET.version, 1);
  const ids = SET.scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'a scenario id is used twice');
  const kinds = new Set(SET.scenarios.map((s) => s.kind));
  for (const k of ['clear_task', 'ambiguous', 'output_constraint', 'role_mismatch', 'missing_tool', 'cross_tenant', 'retired', 'no_skill']) {
    assert.ok(kinds.has(k), `no scenario of kind ${k}`);
  }
});

test('every skill, role and tool a scenario names exists', () => {
  for (const sc of SET.scenarios) {
    assert.ok(ROLE_KEYS.has(sc.agent.role), `${sc.id}: role ${sc.agent.role} is not a catalogue role`);
    for (const t of sc.agent.tools) assert.ok(KNOWN_TOOLS.has(t), `${sc.id}: tool ${t} is used by no skill (a typo?)`);
    for (const f of sc.fixtures ?? []) {
      assert.ok(!LIBRARY.has(f.slug), `${sc.id}: fixture ${f.slug} shadows a library skill`);
      for (const r of f.roles) assert.ok(ROLE_KEYS.has(r), `${sc.id}: fixture role ${r}`);
    }
    const named = [...sc.expect.relevant, ...sc.expect.acceptable, ...sc.expect.must_not_return.map((m) => m.skill)];
    for (const slug of named) assert.ok(skillOf(sc, slug), `${sc.id}: ${slug} is neither a library skill nor a fixture`);
  }
});

test('every relevant or acceptable skill is one the scenario\'s agent can run', () => {
  for (const sc of SET.scenarios) {
    for (const slug of [...sc.expect.relevant, ...sc.expect.acceptable]) {
      const why = gate(skillOf(sc, slug)!, sc.agent, sc.output_kind);
      // A "no suitable skill" scenario may still list an acceptable draft (offering the draft, never claiming to send).
      assert.equal(why, null, `${sc.id}: ${slug} is labelled ${sc.expect.relevant.includes(slug) ? 'relevant' : 'acceptable'} but the gate refuses it (${JSON.stringify(why)})`);
    }
  }
});

test('every must_not_return skill is refused by the gate with exactly the stated code', () => {
  for (const sc of SET.scenarios) {
    for (const m of sc.expect.must_not_return) {
      const why = gate(skillOf(sc, m.skill)!, sc.agent, sc.output_kind);
      assert.ok(why, `${sc.id}: ${m.skill} is labelled must_not_return but the gate would allow it`);
      assert.equal(why!.code, m.code, `${sc.id}: ${m.skill} is refused for ${why!.code}, labelled ${m.code}`);
      if (m.code === 'tool_not_approved') assert.equal(why!.tool, m.tool, `${sc.id}: the missing tool is ${why!.tool}`);
      assert.ok(!sc.expect.relevant.includes(m.skill) && !sc.expect.acceptable.includes(m.skill), `${sc.id}: ${m.skill} is labelled both ways`);
    }
  }
});

test('outcomes are consistent with their labels', () => {
  for (const sc of SET.scenarios) {
    const e = sc.expect;
    if (e.outcome === 'recommend') assert.ok(e.relevant.length >= 1, `${sc.id}: a recommendation names no relevant skill`);
    if (e.outcome === 'no_suitable_skill') assert.equal(e.relevant.length, 0, `${sc.id}: an abstention names a relevant skill`);
    if (e.outcome === 'ambiguous') {
      assert.equal(e.relevant.length, 0, `${sc.id}: an ambiguous request picks a winner`);
      assert.ok(e.acceptable.length >= 2, `${sc.id}: ambiguous needs at least two candidates to choose between`);
    }
  }
});

test('the gate itself: another company, retired, role, tool and output, in attachCheck\'s order', () => {
  const s: Skill = { slug: 'x', scope: 'hq', roles: ['cfo'], tools: ['mercury.read'], output: 'brief', status: 'published' };
  const a: Agent = { role: 'cfo', scope: 'company', company: 'acme', tools: ['mercury.read'] };
  assert.equal(gate(s, a), null);
  assert.deepEqual(gate({ ...s, scope: 'company', company: 'orbit' }, a), { code: 'not_found' });
  assert.equal(gate({ ...s, scope: 'company', company: 'acme' }, a), null, 'its own company\'s skill passes');
  assert.deepEqual(gate({ ...s, status: 'retired', roles: ['ceo'] }, a), { code: 'skill_retired' }, 'retired is said before role');
  assert.deepEqual(gate({ ...s, roles: ['ceo'] }, a), { code: 'role_mismatch' });
  assert.deepEqual(gate(s, { ...a, tools: [] }), { code: 'tool_not_approved', tool: 'mercury.read' });
  assert.deepEqual(gate(s, a, 'draft'), { code: 'output_mismatch' });
});

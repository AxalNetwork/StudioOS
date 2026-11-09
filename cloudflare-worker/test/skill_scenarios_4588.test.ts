/**
 * D4588 (#4588) — the qualification scenarios for the first ten skills
 * (`services/agents/skills/scenarios/<slug>.json`), checked deterministically.
 *
 * Every scenario is run through the production validator and evaluator
 * (`skillLifecycle.checkCase` and `judge`, judge version 3): its case must be
 * valid, its known-correct output must pass, and each targeted incorrect output
 * must fail ON THE ASSERTION IT NAMES. Each assertion in a case has at least
 * one incorrect output that fails on it, so no assertion is decorative. The
 * scenarios feed only reads their skill declares, and hold no email address.
 *
 * Nothing here runs a model: a model evaluation is `not_run` until one is
 * authorized (D4588 §4). The suite reports coverage by skill and case.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_scenarios_4588.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkCase, judge, type CaseExpect } from '../src/services/agents/skillLifecycle.ts';
import { READ_KEYS } from '../src/services/agents/catalogue.ts';
import { FIRST_TEN_SLUGS } from '../src/services/agents/skillInputs.ts';
import { SKILL_LIBRARY } from '../src/services/agents/skillLibrary.generated.ts';

const DIR = join(process.cwd(), 'cloudflare-worker/src/services/agents/skills');
const SCEN = join(DIR, 'scenarios');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Incorrect = { targets: string; text?: string; edit?: [string, string][] };
type Scenario = {
  case_id: string; revision: number; name: string; covers: string;
  input: { records: Record<string, unknown> }; expect: Record<string, unknown>;
  outputs: { correct: string; incorrect: Incorrect[] };
  staged?: Array<{ assertion: string; reason: string }>;
};
type Pack = { skill: string; pack_revision: number; note: string; scenarios: Scenario[] };

const packs: Pack[] = readdirSync(SCEN).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(SCEN, f), 'utf8')) as Pack);

function toolsOf(slug: string): string[] {
  const md = readFileSync(join(DIR, `${slug}.md`), 'utf8');
  const m = /^tools:\s*\[([^\]]*)\]/m.exec(md);
  return m ? m[1].split(',').map((t) => t.trim()).filter(Boolean) : [];
}

/** The incorrect output: the correct one with its edits applied, each edit's text found exactly once. */
export function incorrectText(correct: string, bad: Incorrect): string {
  if (typeof bad.text === 'string') return bad.text;
  let out = correct;
  for (const [from, to] of bad.edit ?? []) {
    const at = out.indexOf(from);
    if (at < 0 || out.indexOf(from, at + 1) >= 0) throw new Error(`edit text must occur exactly once: ${JSON.stringify(from)}`);
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  return out;
}

/** Each assertion in a case, as the words its failure detail names. */
export function assertionItems(e: CaseExpect): Array<{ kind: string; names: string }> {
  const items: Array<{ kind: string; names: string }> = [];
  for (const w of e.must_include) items.push({ kind: 'must_include', names: `"${w}"` });
  for (const f of e.must_say_not_recorded) items.push({ kind: 'not_recorded', names: f });
  for (const n of e.numbers ?? []) items.push({ kind: 'number', names: n.metric });
  for (const w of e.must_not_include) items.push({ kind: 'must_not_include', names: `"${w}"` });
  const s = (e as any).structure;
  if (s) items.push({ kind: 'structure', names: s.sections?.length ? 'section' : s.form });
  for (const c of (e as any).evidence?.cite ?? []) items.push({ kind: 'evidence', names: `[${c}]` });
  if ((e as any).refusal) items.push({ kind: 'refusal', names: (e as any).refusal.subject });
  for (const c of [...((e as any).claims?.required ?? []), ...((e as any).claims?.forbidden ?? [])]) items.push({ kind: 'claim', names: `"${c.subject} … ${c.object}"` });
  if ((e as any).output_schema) items.push({ kind: 'output_schema', names: 'At ' });
  return items;
}

test('the pack covers exactly the ten skills of #4588, each with 5 to 10 scenarios', () => {
  assert.deepEqual(packs.map((p) => p.skill).sort(), [...FIRST_TEN_SLUGS].sort());
  for (const p of packs) {
    assert.ok(p.scenarios.length >= 5 && p.scenarios.length <= 10, `${p.skill}: ${p.scenarios.length} scenarios`);
    assert.ok(Number.isInteger(p.pack_revision) && p.pack_revision >= 1);
  }
});

test('every case identity is unique, traceable and distinct from the golden case', () => {
  const ids = new Set<string>(), names = new Set<string>();
  const golden = new Set(SKILL_LIBRARY.map((e) => `${e.slug}: golden case`));
  for (const p of packs) for (const s of p.scenarios) {
    assert.match(s.case_id, CASE_ID, s.case_id);
    assert.ok(s.case_id.startsWith(`${p.skill}-`), `${s.case_id} is named after its skill`);
    assert.ok(Number.isInteger(s.revision) && s.revision >= 1, `${s.case_id}: revision`);
    assert.ok(!ids.has(s.case_id), `case id ${s.case_id} is used twice`);
    ids.add(s.case_id);
    // The importer dedupes by case name (skillLibrarySeed.ts), so each name is its own identity.
    assert.ok(!names.has(s.name) && !golden.has(s.name), `case name "${s.name}" is not unique`);
    names.add(s.name);
    assert.ok(s.covers && s.covers.length > 10, `${s.case_id}: says what it covers`);
  }
});

test('each case feeds only reads its skill declares, and holds no email address', () => {
  for (const p of packs) {
    const sources = new Set(toolsOf(p.skill).map((t) => t.replace(/\.read$/, '')));
    for (const s of p.scenarios) {
      for (const key of Object.keys(s.input.records)) {
        assert.ok((READ_KEYS as readonly string[]).includes(key), `${s.case_id}: ${key} is no catalogue read`);
        assert.ok(sources.has(key.split('.')[0]), `${s.case_id}: ${key} is not a read ${p.skill} declares`);
      }
      assert.doesNotMatch(JSON.stringify(s), EMAIL, `${s.case_id}: no email address`);
    }
  }
});

test('the existing one-file golden cases are untouched and still valid v1 cases', () => {
  for (const slug of FIRST_TEN_SLUGS) {
    const k = JSON.parse(readFileSync(join(DIR, 'cases', `${slug}.json`), 'utf8'));
    const c = checkCase({ name: `${slug}: golden case`, input: k.input, expect: k.expect });
    assert.ok(c.ok, `${slug}: the golden case stays valid`);
  }
});

const coverage: Array<{ skill: string; case_id: string; assertions: number; incorrect: number; staged: number }> = [];

for (const p of packs) {
  test(`${p.skill}: every case is valid, its correct output passes, and every assertion is caught by a targeted incorrect output`, () => {
    for (const s of p.scenarios) {
      const c = checkCase({ name: s.name, input: s.input, expect: s.expect });
      assert.ok(c.ok, `${s.case_id}: ${c.ok ? '' : c.message}`);
      if (!c.ok) continue;
      const good = judge(c.expect, s.outputs.correct, c.input);
      assert.equal(good.result, 'pass', `${s.case_id}: the correct output fails: ${good.detail}`);
      const items = assertionItems(c.expect);
      const caught = new Set<number>();
      for (const [i, bad] of s.outputs.incorrect.entries()) {
        const out = incorrectText(s.outputs.correct, bad);
        const r = judge(c.expect, out, c.input);
        assert.equal(r.result, 'fail', `${s.case_id} incorrect #${i} (${bad.targets}) passed`);
        const detail = (r.detail ?? '').toLowerCase();
        assert.ok(detail.includes(bad.targets.toLowerCase()), `${s.case_id} incorrect #${i}: failed on "${r.detail}", not on ${bad.targets}`);
        items.forEach((it, j) => { if (detail.includes(it.names.toLowerCase())) caught.add(j); });
      }
      items.forEach((it, j) => assert.ok(caught.has(j), `${s.case_id}: no incorrect output fails on its ${it.kind} assertion (${it.names})`));
      for (const st of s.staged ?? []) assert.ok(st.assertion && st.reason, `${s.case_id}: a staged assertion says what and why`);
      coverage.push({ skill: p.skill, case_id: s.case_id, assertions: items.length, incorrect: s.outputs.incorrect.length, staged: s.staged?.length ?? 0 });
    }
  });
}

test('the missing-field regression: an unrelated "Not recorded" never excuses a runway figure', () => {
  const s = packs.find((p) => p.skill === 'board-meeting-brief')!.scenarios.find((x) => x.case_id === 'board-meeting-brief-missing-burn')!;
  const c = checkCase({ name: s.name, input: s.input, expect: s.expect });
  assert.ok(c.ok);
  const regression = 'Churn: Not recorded.\nRunway: 12 months.\nCash on hand: 600,000 USD.\nDelaware franchise tax.\nMonthly burn: Not recorded.';
  // Judge version 1 accepted the field anywhere plus "Not recorded" anywhere; this output met that.
  assert.ok(regression.toLowerCase().includes('runway') && regression.toLowerCase().includes('not recorded'));
  const r = judge(c.ok ? c.expect : ({} as CaseExpect), regression, c.ok ? c.input : null);
  assert.equal(r.result, 'fail');
  assert.match(r.detail ?? '', /runway is not recorded/);
});

test('coverage by skill and case (reported, model evaluation not run)', () => {
  const bySkill = new Map<string, { cases: number; assertions: number; incorrect: number; staged: number }>();
  for (const c of coverage) {
    const b = bySkill.get(c.skill) ?? { cases: 0, assertions: 0, incorrect: 0, staged: 0 };
    b.cases += 1; b.assertions += c.assertions; b.incorrect += c.incorrect; b.staged += c.staged;
    bySkill.set(c.skill, b);
  }
  const lines = [...bySkill].map(([k, v]) => `${k}: ${v.cases} cases, ${v.assertions} assertions, ${v.incorrect} incorrect outputs, ${v.staged} staged`);
  console.log(`# D4588 coverage (deterministic; model_evaluation: not_run)\n# ${lines.join('\n# ')}`);
  assert.equal(bySkill.size, packs.length);
});

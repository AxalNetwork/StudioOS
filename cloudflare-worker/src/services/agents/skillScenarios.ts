/**
 * D5336 (#5336): the qualification scenario packs (`skills/scenarios/<slug>.json`,
 * #4588) as stored cases, and the rules the CI gate holds them to.
 *
 * `scenarioCase` is how a scenario becomes a library case: named by its own
 * `name`, identified by `case_id` + `revision` (`skillCaseIdentity.ts`). The
 * generator (`scripts/build-skill-library.mjs`) packs the same fields in the
 * same order; `skill_case_identity_5336.test.ts` holds the two equal.
 *
 * `checkScenarioPacks` is pure: pack texts in, findings and per-skill coverage
 * out. Its rules are #4588's suite (#5180's list): a unique `case_id` and
 * `name`, the slug prefix, an integer revision, no email address anywhere in
 * the scenario, a correct output that passes `judge()`, and for each
 * assertion an incorrect output that fails on it. Declared reads, the output
 * kind and `checkCase` itself run on the packed case in `skillCatalogue.ts`,
 * like every other library case. Nothing here runs a model.
 */
import { checkCase, judge, type CaseExpect } from './skillLifecycle';
import type { Finding } from './skillCatalogue';
import { goldenName } from './skillCaseIdentity';

export type Incorrect = { targets: string; text?: string; edit?: [string, string][] };
export type Scenario = {
  case_id: string; revision: number; name: string; covers: string;
  input: { records: Record<string, unknown> }; expect: Record<string, unknown>;
  outputs: { correct: string; incorrect: Incorrect[] };
  staged?: Array<{ assertion: string; reason: string }>;
};
export type Pack = { skill: string; pack_revision: number; note: string; scenarios: Scenario[] };

/** The library case a scenario becomes. The generator writes these fields, in this order. */
export const scenarioCase = (skill: string, s: Scenario) => ({
  skill, case_id: s.case_id, revision: s.revision, name: s.name, note: s.covers, input: s.input, expect: s.expect,
});


const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  const x = e as any;
  for (const w of e.must_include) items.push({ kind: 'must_include', names: `"${w}"` });
  for (const f of e.must_say_not_recorded) items.push({ kind: 'not_recorded', names: f });
  for (const n of e.numbers ?? []) items.push({ kind: 'number', names: n.metric });
  for (const w of e.must_not_include) items.push({ kind: 'must_not_include', names: `"${w}"` });
  if (x.structure) items.push({ kind: 'structure', names: x.structure.sections?.length ? 'section' : x.structure.form });
  for (const c of x.evidence?.cite ?? []) items.push({ kind: 'evidence', names: `[${c}]` });
  if (x.refusal) items.push({ kind: 'refusal', names: x.refusal.subject });
  for (const c of [...(x.claims?.required ?? []), ...(x.claims?.forbidden ?? [])]) items.push({ kind: 'claim', names: `"${c.subject} … ${c.object}"` });
  if (x.output_schema) items.push({ kind: 'output_schema', names: 'At ' });
  return items;
}

export type ScenarioCoverage = { slug: string; scenarios: number; assertions: number; incorrect_outputs: number; staged: number };

/** A pack read from its text, or null when it is not one. */
export function parsePack(text: string): Pack | null {
  let p: any = null;
  try { p = JSON.parse(text); } catch { return null; }
  if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.skill !== 'string' || !Array.isArray(p.scenarios)) return null;
  if (!p.scenarios.every((s: any) => s && typeof s === 'object' && !Array.isArray(s))) return null;
  return p as Pack;
}

/**
 * Every scenario rule; see the header. `packs` maps `<slug>.json` to its text; `slugs` are the
 * skills that have a definition. Findings name the pack file, the slug and the scenario's case id.
 */
export function checkScenarioPacks(packs: Record<string, string>, slugs: ReadonlySet<string>): { findings: Finding[]; coverage: ScenarioCoverage[]; parsed: Map<string, Pack> } {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'level'>) => findings.push({ level: 'error', ...f });
  const ids = new Map<string, string>(); const names = new Map<string, string>();
  const coverage: ScenarioCoverage[] = [];
  const parsed = new Map<string, Pack>();
  for (const f of Object.keys(packs).filter((x) => x.endsWith('.json')).sort()) {
    const slug = f.slice(0, -5);
    const file = `scenarios/${f}`;
    const p = parsePack(packs[f]);
    if (!p) { add({ file, slug, field: null, case_id: null, rule: 'scenario_malformed', message: `${file} is not a scenario pack.`, remediation: 'Give it "skill" and a "scenarios" list of objects (scenarios/README.md).' }); continue; }
    if (p.skill !== slug || !slugs.has(slug)) {
      add({ file, slug, field: 'skill', case_id: null, rule: 'scenario_orphan', message: p.skill !== slug ? `${file} names ${p.skill}.` : `${slug} has no definition.`, remediation: `Name the pack after its skill, and add ${slug}.md or remove the pack.` });
      continue;
    }
    parsed.set(slug, p);
    const cov: ScenarioCoverage = { slug, scenarios: 0, assertions: 0, incorrect_outputs: 0, staged: 0 };
    for (const s of p.scenarios) {
      const cid = typeof s.case_id === 'string' ? s.case_id : '';
      const where = { file, slug, case_id: cid || null };
      cov.scenarios += 1;
      if (!CASE_ID.test(cid) || !cid.startsWith(`${slug}-`)) add({ ...where, field: 'case_id', rule: 'scenario_case_id_invalid', message: `"${cid}" is not "${slug}-<scenario>" in lower-case letters, digits and hyphens.`, remediation: 'Name the case after its skill; never rename a case id that has been imported.' });
      else if (ids.has(cid)) add({ ...where, field: 'case_id', rule: 'scenario_case_id_duplicate', message: `${cid} is also in ${ids.get(cid)}.`, remediation: 'Give each scenario its own case id.' });
      else ids.set(cid, file);
      if (!Number.isInteger(s.revision) || s.revision < 1) add({ ...where, field: 'revision', rule: 'scenario_revision_invalid', message: `The revision is ${JSON.stringify(s.revision)}.`, remediation: 'Use an integer from 1, bumped whenever the case text changes.' });
      const name = typeof s.name === 'string' ? s.name.replace(/\s+/g, ' ').trim() : '';
      const golden = [...slugs].some((x) => goldenName(x) === name);
      if (!name || golden || names.has(name)) add({ ...where, field: 'name', rule: 'scenario_name_duplicate', message: name ? `"${name}" is ${golden ? 'a golden case\'s name' : `also used in ${names.get(name)}`}.` : 'The scenario has no name.', remediation: 'Give each scenario its own name.' });
      else names.set(name, file);
      if (EMAIL.test(JSON.stringify(s))) add({ ...where, field: null, rule: 'scenario_has_email', message: 'The scenario holds an email address.', remediation: 'Use made-up records, people by name only.' });
      const c = checkCase({ name: name || cid, input: s.input, expect: s.expect });
      // An invalid case is reported once, by the library check on the packed case (skillCatalogue.ts).
      if (!c.ok) continue;
      const correct = typeof s.outputs?.correct === 'string' ? s.outputs.correct : null;
      const incorrect = Array.isArray(s.outputs?.incorrect) ? s.outputs.incorrect : [];
      if (correct == null) { add({ ...where, field: 'outputs.correct', rule: 'scenario_correct_fails', message: 'The scenario has no known-correct output.', remediation: 'Add an output that must pass.' }); continue; }
      const good = judge(c.expect, correct, c.input);
      if (good.result !== 'pass') add({ ...where, field: 'outputs.correct', rule: 'scenario_correct_fails', message: `The correct output fails: ${good.detail}`, remediation: 'Fix the output or the assertion.' });
      const items = assertionItems(c.expect);
      const caught = new Set<number>();
      for (const [i, bad] of incorrect.entries()) {
        let out: string | null = null;
        try { out = incorrectText(correct, bad); } catch (e) {
          add({ ...where, field: `outputs.incorrect[${i}]`, rule: 'scenario_incorrect_invalid', message: String((e as Error).message), remediation: 'Make each edit\'s text occur exactly once in the correct output.' });
          continue;
        }
        const r = judge(c.expect, out, c.input);
        const detail = (r.detail ?? '').toLowerCase();
        if (r.result !== 'fail' || !detail.includes(String(bad.targets ?? '').toLowerCase())) {
          add({ ...where, field: `outputs.incorrect[${i}]`, rule: 'scenario_incorrect_not_caught', message: r.result === 'fail' ? `It fails on "${r.detail}", not on ${bad.targets}.` : `It passes; it should fail on ${bad.targets}.`, remediation: 'Edit only what the named assertion checks, or name the assertion it fails on.' });
        }
        if (r.result === 'fail') items.forEach((it, j) => { if (detail.includes(it.names.toLowerCase())) caught.add(j); });
      }
      items.forEach((it, j) => {
        if (!caught.has(j)) add({ ...where, field: 'expect', rule: 'scenario_assertion_uncaught', message: `No incorrect output fails on its ${it.kind} assertion (${it.names}).`, remediation: 'Add an incorrect output that fails on it, or remove the assertion.' });
      });
      cov.assertions += items.length; cov.incorrect_outputs += incorrect.length; cov.staged += s.staged?.length ?? 0;
    }
    coverage.push(cov);
  }
  return { findings, coverage, parsed };
}

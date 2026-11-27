/**
 * D8520 (#8520) — the skill evaluation cases that need no model, run in pull-request CI.
 *
 * `runCaseWithoutModel` (skillEval.ts) decides each check without a model, and
 * `scripts/check-skill-eval-cases.mjs` runs it for the changed skills (every
 * skill when the evaluation code changes or no base can be diffed), holds each
 * skill to a deterministic case or an allowlist entry with its reason, and
 * names the skill, case and reason on stdout and in the job summary.
 *
 * The fixture (`fixtures/skill_eval_8520/`) is a pull request that drops a
 * required input: `after/` is `before/` with `stripe.read` removed from the
 * skill's tools while a case still feeds `stripe.revenue`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaseWithoutModel } from '../src/services/agents/skillEval.ts';
// @ts-ignore — a .mjs script, typed loosely here
import { ALLOWLIST_REL, EVAL_CODE, SKILLS_REL, changedFrom, evaluate, readSkills, selectSkills, skillOfPath, summaryMarkdown } from '../../scripts/check-skill-eval-cases.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = join(ROOT, 'cloudflare-worker/test/fixtures/skill_eval_8520');
const SCRIPT = join(ROOT, 'scripts/check-skill-eval-cases.mjs');
const LOADER = './cloudflare-worker/test/_ts-loader.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'skill-eval-8520-'));

/** The script as CI runs it, with no base to diff (so every skill runs) unless `base` is given. */
function runScript(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', LOADER, SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, SKILL_EVAL_BASE: '', CI_FAILURE_BASE: '', GITHUB_STEP_SUMMARY: '', ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const skill = { tools: ['grow.read', 'stripe.read'], output_kind: 'brief' };
const kpis = { kpis: [{ name: 'Active sites', value: 120 }, { name: 'Churned sites', value: null }] };
const expect = { output: 'brief', must_include: ['120'], must_say_not_recorded: ['Churned sites'], must_not_include: [] };
const correct = '- Active sites: 120\n- Churned sites: Not recorded';
const known = (incorrect: unknown[] = [{ targets: '"120"', edit: [['120', '121']] }]) => ({ correct, incorrect }) as any;

test('a case with known outputs is deterministic and passes; a golden case is not deterministic but still checked', () => {
  const det = runCaseWithoutModel(skill, { name: 'scenario', input: { records: { 'grow.records': kpis } }, expect, outputs: known() });
  assert.deepEqual(det, { case: 'scenario', deterministic: true, failures: [] });
  const golden = runCaseWithoutModel(skill, { name: 'golden', input: { records: { 'grow.records': kpis } }, expect, outputs: null });
  assert.deepEqual(golden, { case: 'golden', deterministic: false, failures: [] });
});

test('each model-free check fails with its own code and a reason naming what failed', () => {
  const checks = (c: Parameters<typeof runCaseWithoutModel>[1], s = skill) => runCaseWithoutModel(s, c).failures;
  assert.equal(checks({ name: 'x', input: { records: {} }, expect: { output: 'brief' }, outputs: null })[0].check, 'case_invalid');
  assert.deepEqual(checks({ name: 'x', input: { records: { 'grow.records': kpis } }, expect: { ...expect, output: 'draft' } }, skill).map((f) => f.check), ['output_kind_mismatch']);
  const read = checks({ name: 'x', input: { records: { 'grow.records': kpis, 'stripe.revenue': { amount: 1 } } }, expect }, { ...skill, tools: ['grow.read'] });
  assert.deepEqual(read, [{ check: 'read_not_granted', reason: 'The case feeds stripe.revenue, and the skill\'s tools do not grant stripe.read.' }]);
  const wrongCorrect = checks({ name: 'x', input: { records: { 'grow.records': kpis } }, expect, outputs: { correct: '- Active sites: 121', incorrect: [] } });
  assert.equal(wrongCorrect[0].check, 'correct_output_fails');
  assert.match(wrongCorrect[0].reason, /^The known-correct output fails: .*120/);
  const passes = checks({ name: 'x', input: { records: { 'grow.records': kpis } }, expect, outputs: known([{ targets: '"120"', edit: [['Active sites', 'Live sites']] }]) });
  assert.deepEqual(passes, [{ check: 'incorrect_output_not_caught', reason: 'Incorrect output 1 passes; it should fail on "120".' }]);
  const elsewhere = checks({ name: 'x', input: { records: { 'grow.records': kpis } }, expect, outputs: known([{ targets: '"120"', edit: [['Not recorded', '0']] }]) });
  assert.equal(elsewhere[0].check, 'incorrect_output_not_caught');
  assert.match(elsewhere[0].reason, /^Incorrect output 1 fails on ".*Churned sites.*", not on "120"\.$/);
  const invalid = checks({ name: 'x', input: { records: { 'grow.records': kpis } }, expect, outputs: known([{ targets: '"120"', edit: [['absent text', 'y']] }]) });
  assert.equal(invalid[0].check, 'incorrect_output_invalid');
});

test('the fixture: dropping a required input from one skill fails the step, naming the skill, the case and the reason', () => {
  const allow = join(tmp(), 'allow.json');
  writeFileSync(allow, '{"skills":{}}');
  const before = runScript(['--dir', join(FIXTURE, 'before'), '--allowlist', allow]);
  assert.equal(before.status, 0, before.out);
  assert.match(before.out, /✓ check-skill-eval-cases: 1 of 1 skills .*2 cases, 0 findings; no model called\./);
  const summary = join(tmp(), 'summary.md');
  writeFileSync(summary, '');
  const after = runScript(['--dir', join(FIXTURE, 'after'), '--allowlist', allow], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(after.status, 1, after.out);
  assert.match(after.out, /✖ fixture-kpi-brief · fixture-kpi-brief-revenue: read_not_granted — The case feeds stripe\.revenue, and the skill's tools do not grant stripe\.read\./);
  assert.match(readFileSync(summary, 'utf8'), /\| fixture-kpi-brief \| fixture-kpi-brief-revenue \| read_not_granted \| The case feeds stripe\.revenue, and the skill's tools do not grant stripe\.read\. \|/);
});

test('on the real library: losing a read or an assertion fails the step', () => {
  const dir = tmp();
  cpSync(join(ROOT, SKILLS_REL), dir, { recursive: true });
  const md = join(dir, 'board-meeting-brief.md');
  const text = readFileSync(md, 'utf8');
  assert.match(text, /^tools: \[.*compliance\.read.*\]$/m);
  writeFileSync(md, text.replace(/(^tools: \[.*?)(, )?compliance\.read(, )?/m, (_m, head, a, b) => `${head}${a && b ? ', ' : ''}`));
  const lostRead = runScript(['--dir', dir]);
  assert.equal(lostRead.status, 1, lostRead.out);
  assert.match(lostRead.out, /✖ board-meeting-brief · board-meeting-brief-complete: read_not_granted — The case feeds compliance\.calendar/);
  writeFileSync(md, text);
  // An assertion removed from a scenario: the incorrect output that targets it now passes.
  const scen = join(dir, 'scenarios/board-meeting-brief.json');
  const pack = JSON.parse(readFileSync(scen, 'utf8'));
  const first = pack.scenarios[0];
  assert.deepEqual(first.expect.must_include, ['Delaware franchise tax', '2026-11-30']);
  first.expect.must_include = ['2026-11-30'];
  writeFileSync(scen, JSON.stringify(pack));
  const lostAssertion = runScript(['--dir', dir]);
  assert.equal(lostAssertion.status, 1, lostAssertion.out);
  // Its incorrect output now passes, or fails only on another assertion: either way not on its target.
  assert.match(lostAssertion.out, /✖ board-meeting-brief · board-meeting-brief-complete: incorrect_output_not_caught — Incorrect output \d+ (passes; it should fail|fails on ".*", not) on Delaware franchise tax\./);
  rmSync(dir, { recursive: true, force: true });
});

test('a skill needs a deterministic case or an allowlist entry with its reason, and the list only shrinks', () => {
  const skills = new Map([
    ['with', { slug: 'with', invalid: false, tools: skill.tools, output_kind: 'brief', cases: [{ name: 's', input: { records: { 'grow.records': kpis } }, expect, outputs: known() }] }],
    ['without', { slug: 'without', invalid: false, tools: skill.tools, output_kind: 'brief', cases: [{ name: 'g', input: { records: { 'grow.records': kpis } }, expect, outputs: null }] }],
  ]);
  const codes = (allowlist: Record<string, unknown>) => evaluate({ skills, selected: [], allowlist }).failures.map((f: any) => `${f.skill}:${f.check}`);
  assert.deepEqual(codes({}), ['without:no_deterministic_case']);
  assert.deepEqual(codes({ without: 'no pack yet' }), []);
  assert.deepEqual(codes({ without: 'no pack yet', with: 'stale' }), ['with:allowlist_stale']);
  assert.deepEqual(codes({ without: 'no pack yet', gone: 'stale' }), ['gone:allowlist_stale']);
  assert.deepEqual(codes({ without: ' ' }), ['without:allowlist_reason_missing']);
});

test('the changed skills run, or every skill when the evaluation code changed or no base can be diffed', () => {
  const slugs = ['a', 'b', 'c'];
  assert.deepEqual(selectSkills(null, slugs), { mode: 'all', reason: 'no base commit could be diffed', slugs });
  assert.equal(selectSkills(['cloudflare-worker/src/services/agents/skillAssertions.ts'], slugs).mode, 'all');
  assert.equal(selectSkills([ALLOWLIST_REL], slugs).mode, 'all');
  assert.deepEqual(selectSkills([`${SKILLS_REL}/a.md`, `${SKILLS_REL}/scenarios/c.json`, `${SKILLS_REL}/README.md`, 'frontend/x.js'], slugs).slugs, ['a', 'c']);
  assert.deepEqual(selectSkills(['frontend/x.js'], slugs), { mode: 'changed', reason: 'this change edits no skill', slugs: [] });
  assert.equal(skillOfPath(`${SKILLS_REL}/cases/b.json`), 'b');
  assert.equal(skillOfPath(`${SKILLS_REL}/scenarios/README.md`), null);
  for (const p of EVAL_CODE) assert.equal(selectSkills([p], slugs).mode, 'all', p);
  assert.equal(changedFrom(null), null);
  assert.equal(changedFrom('not a ref; rm'), null);
});

test('changedFrom reads the diff from a base commit in a real repository', () => {
  const repo = tmp();
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'one.txt'), '1');
  git('add', '.'); git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'two.txt'), '2');
  git('add', '.'); git('commit', '-qm', 'two');
  assert.deepEqual(changedFrom(base, repo), ['two.txt']);
  assert.equal(changedFrom('0000000000000000000000000000000000000000', repo), null);
  rmSync(repo, { recursive: true, force: true });
});

test('the summary names what ran and each finding as skill, case, check and reason', () => {
  const md = summaryMarkdown({ mode: 'all', reason: 'no base commit could be diffed', slugs: ['a'] },
    { rows: [{ slug: 'a', cases: 3, deterministic: 2 }], failures: [{ skill: 'a', case: 'a-x', check: 'read_not_granted', reason: 'It | fed\nb.' }] }, 5);
  assert.match(md, /Ran 1 of 5 skills \(no base commit could be diffed\): 3 cases, 2 of them deterministic\. No model was called\./);
  assert.match(md, /\| a \| a-x \| read_not_granted \| It \\\| fed b\. \|/);
  assert.match(summaryMarkdown({ mode: 'changed', reason: 'r', slugs: [] }, { rows: [], failures: [] }, 5), /No finding\./);
});

test('summary table cells preserve literal backslashes and escape separators in every column (#8603)', () => {
  const selection = { mode: 'all', reason: 'fixture', slugs: ['fixture'] };
  const samples = [
    ['', ''],
    ['plain text', 'plain text'],
    [String.raw`a\b`, String.raw`a\\b`],
    [String.raw`a|b`, String.raw`a\|b`],
    [String.raw`a\|b`, String.raw`a\\\|b`],
    [String.raw`a\\|b`, String.raw`a\\\\\|b`],
    ['trailing\\', 'trailing\\\\'],
    ['a\t|\r\nb', String.raw`a \| b`],
  ];
  for (const [value, expected] of samples) {
    const md = summaryMarkdown(selection, {
      rows: [], failures: [{ skill: value, case: value, check: value, reason: value }],
    }, 1);
    assert.equal(md.split('\n').at(-2), `| ${expected} | ${expected} | ${expected} | ${expected} |`);
  }
});

test('the library passes as it is, every allowlisted skill lacks a deterministic case, and D8520 states the count', () => {
  const r = runScript([]);
  assert.equal(r.status, 0, r.out);
  const allow = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_REL), 'utf8')).skills;
  const skills = readSkills();
  const lacking = [...skills.values()].filter((s: any) => !s.cases.some((c: any) => c.outputs)).map((s: any) => s.slug).sort();
  assert.deepEqual(Object.keys(allow).sort(), lacking);
  const d = readFileSync(join(ROOT, 'documentation/architecture/decisions/D8520.md'), 'utf8');
  assert.match(d, new RegExp(`\\*\\*${lacking.length} skills\\*\\* are on the allowlist`));
  assert.match(d, new RegExp(`\\*\\*${skills.size - lacking.length} skills\\*\\* have a deterministic case`));
});

test('the step is a guard of the full suite, after the library check', () => {
  const guards = JSON.parse(readFileSync(join(ROOT, 'scripts/guard-commands.json'), 'utf8'));
  const ids = guards.map((g: any) => g.id);
  const at = ids.indexOf('check-skill-eval-cases');
  assert.ok(at > ids.indexOf('check-skill-library'));
  assert.deepEqual(guards[at].command, ['node', '--experimental-strip-types', '--no-warnings', '--import', LOADER, 'scripts/check-skill-eval-cases.mjs']);
  assert.deepEqual(guards[at].requires, ['generated']);
  assert.notEqual(guards[at].full, false);
});

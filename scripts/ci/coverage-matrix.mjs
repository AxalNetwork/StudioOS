#!/usr/bin/env node
/**
 * D8694 (#8694): writes documentation/operations/CI_COVERAGE.md, the CI coverage
 * matrix by source folder and Worker service, from the workflows under
 * .github/workflows/, the steps of `test:drift`, the guard catalog,
 * scripts/lib/requiredChecks.mjs and the hand-kept map beside this file
 * (coverage-matrix.json, in key order per D4134).
 *
 *   node scripts/ci/coverage-matrix.mjs           write the page
 *   node scripts/ci/coverage-matrix.mjs --check   fail on a source folder or a
 *     test-running workflow job with no row, a row naming a job, suite step,
 *     guard, file or issue that does not exist, a map out of key order, and a
 *     committed page that differs from what this writes. Runs in test:guards.
 *
 * Offline by design: an issue reference is checked against the `issues` list
 * in the map, never against GitHub (D8694 §3).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, globSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED } from '../lib/requiredChecks.mjs';
import { eventRules, mainPush } from '../workflow-inventory.mjs';

const { parse } = createRequire(new URL('../../cloudflare-worker/package.json', import.meta.url))('yaml');

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DATA = 'scripts/ci/coverage-matrix.json';
export const PAGE = 'documentation/operations/CI_COVERAGE.md';

/** The evidence levels, lowest first. A row's Level is the highest any of its checks reaches. */
export const LEVELS = Object.freeze({
  unit: 'unit and contract',
  browser: 'isolated browser',
  staging: 'staging',
  pilot: 'provider-backed pilot',
  production: 'production monitoring',
});
const RANK = Object.keys(LEVELS);

/** The job that runs the `test:drift` parts, and the job whose context reports them. */
export const SUITE = Object.freeze({ file: 'ci.yml', job: 'suite', gate: 'gate' });

/** A job runs tests when one of its `run:` steps starts a test runner or a suite part. */
const TEST_RUNNERS = [
  /\bnode\b[^\n]*\s--test\b/,
  /\bnode\b[^\n]*\.test\.(?:mjs|js|ts)\b/,
  /\bplaywright test\b/,
  /\b-m (?:unittest|pytest)\b/,
  /\bpytest\b/,
  /\bnpm (?:run )?test\b/,
  /\brun-guards\.mjs\b/,
  /\b(?:test-drift-parts|future-clock-producer)\.mjs [^-\s]/,
];

const EVENT_LABELS = Object.freeze({
  pull_request: 'pull request',
  merge_group: 'merge queue',
  schedule: 'schedule',
  workflow_dispatch: 'manual',
  workflow_call: 'called by a workflow',
  workflow_run: 'after a workflow',
});
const EVENT_ORDER = ['pull_request', 'merge_group', 'push', 'schedule', 'workflow_dispatch'];

// ---------------------------------------------------------------- expressions

function unwrap(expr) {
  let e = String(expr).trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  for (;;) {
    if (!e.startsWith('(') || closingParen(e, 0) !== e.length - 1) return e;
    e = e.slice(1, -1).trim();
  }
}

function closingParen(e, at) {
  let depth = 0, quote = null;
  for (let i = at; i < e.length; i++) {
    const c = e[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTop(e, op) {
  const parts = [];
  let depth = 0, quote = null, from = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && e.startsWith(op, i)) { parts.push(e.slice(from, i)); from = i + op.length; i += op.length - 1; }
  }
  parts.push(e.slice(from));
  return parts.map(p => p.trim());
}

/**
 * Whether a job's `if:` lets it run on `event`. Only `github.event_name == / != '<event>'`
 * terms decide; any other term may be true, so a job is left out of an event only when
 * its condition rules that event out.
 */
export function mayRun(condition, event) {
  if (condition === undefined || condition === null || condition === true) return true;
  if (condition === false) return false;
  const e = unwrap(condition);
  const any = splitTop(e, '||');
  if (any.length > 1) return any.some(p => mayRun(p, event));
  const all = splitTop(e, '&&');
  if (all.length > 1) return all.every(p => mayRun(p, event));
  const plain = /^github\.event_name\s*(==|!=)\s*(['"])([a-z_]+)\2$/.exec(e);
  if (!plain) return true;
  return (event === plain[3]) === (plain[1] === '==');
}

// ------------------------------------------------------------------- reading

/** Every workflow: `{ file: { name, events, jobs: { id: { name, if, needs, run } } } }`. */
export function loadWorkflows(root) {
  const dir = join(root, '.github/workflows');
  const out = {};
  for (const file of readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort()) {
    const data = parse(readFileSync(join(dir, file), 'utf8')) ?? {};
    const jobs = {};
    for (const [id, job] of Object.entries(data.jobs ?? {})) {
      jobs[id] = {
        name: typeof job?.name === 'string' ? job.name : id,
        if: job?.if,
        needs: [].concat(job?.needs ?? []),
        run: (job?.steps ?? []).map(s => (typeof s?.run === 'string' ? s.run : '')).join('\n'),
      };
    }
    out[file] = { name: data.name ?? file, events: eventRules(data.on), jobs };
  }
  return out;
}

export function runsTests(job) {
  return TEST_RUNNERS.some(re => re.test(job.run));
}

/** `file#job` for every job whose steps run tests. */
export function testJobs(workflows) {
  const out = [];
  for (const [file, wf] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(wf.jobs)) if (runsTests(job)) out.push(`${file}#${id}`);
  }
  return out.sort();
}

/** The events a job runs on, as page labels. */
export function whenOf(workflow, job) {
  const labels = [];
  const events = Object.keys(workflow.events);
  const ordered = [...EVENT_ORDER.filter(e => events.includes(e)), ...events.filter(e => !EVENT_ORDER.includes(e)).sort()];
  for (const event of ordered) {
    if (!mayRun(job.if, event)) continue;
    const rules = workflow.events[event];
    const paths = rules && (rules.paths || rules['paths-ignore']) ? ' (paths)' : '';
    if (event === 'push') {
      labels.push(mainPush(rules) === 'excluded' ? `push, not to main${paths}` : `push to main${paths}`);
    } else labels.push(`${EVENT_LABELS[event] ?? event}${paths}`);
  }
  return labels;
}

/** Which required check, if any, a job reports: its name, or a quoted literal in its name expression. */
export function requiredName(file, job, required) {
  for (const [check, workflow] of Object.entries(required)) {
    if (workflow !== file) continue;
    if (job.name === check || (job.name.includes('${{') && job.name.includes(`'${check}'`))) return check;
  }
  return null;
}

/** The steps of `test:drift`: `npm run <script>` steps by script name, others by their command. */
export function driftSteps(scripts) {
  const drift = scripts?.['test:drift'];
  if (typeof drift !== 'string') return [];
  return drift.split(' && ').map(s => s.trim()).map(s => /^npm run (\S+)$/.exec(s)?.[1] ?? s);
}

/** The file map's paths in CLAUDE.md, without the trailing slash. */
export function fileMapFolders(claudeMd) {
  const at = claudeMd.indexOf('## File map');
  if (at < 0) return [];
  const out = [];
  for (const line of claudeMd.slice(at).split('\n').slice(1)) {
    if (line.startsWith('## ')) break;
    const m = /^\|\s*`([^`]+)\/`\s*\|/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

const WRANGLER = /^wrangler(?:\.[\w-]+)?\.(?:toml|json|jsonc)$/;

/**
 * The top-level source folders: every path in CLAUDE.md's file map, every top-level
 * folder that holds a Worker entry (a root `wrangler*.toml` `main`, or a wrangler
 * config of its own), and every top-level folder a `test:drift` step reads.
 */
export function sourceFolders(root, scripts) {
  const found = new Set();
  const claude = join(root, 'CLAUDE.md');
  if (existsSync(claude)) for (const f of fileMapFolders(readFileSync(claude, 'utf8'))) found.add(f);
  const isDir = name => !name.startsWith('.') && name !== 'node_modules' && existsSync(join(root, name)) && statSync(join(root, name)).isDirectory();
  const top = readdirSync(root).filter(isDir);
  for (const file of readdirSync(root).filter(f => WRANGLER.test(f) && f.endsWith('.toml'))) {
    const main = /^main\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, file), 'utf8'))?.[1];
    const head = main?.split('/')[0];
    if (head && top.includes(head)) found.add(head);
  }
  for (const dir of top) if (readdirSync(join(root, dir)).some(f => WRANGLER.test(f))) found.add(dir);
  for (const step of driftSteps(scripts)) {
    const command = scripts[step] ?? step;
    for (const token of command.split(/\s+/)) {
      const head = token.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '').split('/');
      if (head.length > 1 && top.includes(head[0])) found.add(head[0]);
    }
  }
  return [...found].sort();
}

export function loadContext(root = ROOT, { required = REQUIRED } = {}) {
  const read = p => readFileSync(join(root, p), 'utf8');
  const scripts = JSON.parse(read('package.json')).scripts ?? {};
  const guards = JSON.parse(read('scripts/guard-commands.json')).filter(g => g.full !== false).map(g => g.id);
  return {
    root,
    data: JSON.parse(read(DATA)),
    workflows: loadWorkflows(root),
    scripts,
    steps: driftSteps(scripts),
    guards,
    folders: sourceFolders(root, scripts),
    required,
    page: existsSync(join(root, PAGE)) ? read(PAGE) : null,
  };
}

// ---------------------------------------------------------------- validating

const sorted = list => list.every((v, i) => i === 0 || list[i - 1] < v);
const ROW_FIELDS = { folders: ['checks', 'gaps'], services: ['checks', 'gaps', 'name', 'tests'] };

/** Parse a check reference: `file#job`, `suite:<step>` or `guard:<id>`. */
export function parseRef(ref) {
  if (ref.startsWith('suite:')) return { kind: 'suite', step: ref.slice(6) };
  if (ref.startsWith('guard:')) return { kind: 'guard', id: ref.slice(6) };
  const m = /^([\w.-]+\.ya?ml)#([\w-]+)$/.exec(ref);
  return m ? { kind: 'job', file: m[1], job: m[2] } : { kind: 'bad' };
}

/** Every reason the map, the repository and the page disagree. Empty when the page is true. */
export function validate(ctx) {
  const { data, workflows, steps, guards, folders, required, root } = ctx;
  const errors = [];
  const keys = obj => Object.keys(obj ?? {});
  for (const part of ['folders', 'issues', 'jobs', 'services']) {
    if (!data[part] || typeof data[part] !== 'object' || Array.isArray(data[part])) errors.push(`${DATA}: "${part}" is missing`);
  }
  for (const extra of keys(data).filter(k => !['$comment', 'folders', 'issues', 'jobs', 'services'].includes(k))) errors.push(`${DATA}: unknown field "${extra}"`);
  if (errors.length) return errors;
  for (const part of ['folders', 'issues', 'jobs', 'services']) {
    if (!sorted(keys(data[part]))) errors.push(`${DATA}: "${part}" is not in key order (D4134)`);
  }

  const named = new Set();
  const usedIssues = new Set();
  for (const part of ['folders', 'services']) {
    for (const [key, row] of Object.entries(data[part])) {
      const where = `${part}.${key}`;
      for (const f of keys(row)) if (!ROW_FIELDS[part].includes(f)) errors.push(`${where}: unknown field "${f}"`);
      for (const list of ['checks', 'gaps', ...(part === 'services' ? ['tests'] : [])]) {
        if (!Array.isArray(row[list])) { errors.push(`${where}: "${list}" must be a list`); continue; }
        if (!sorted(row[list])) errors.push(`${where}: "${list}" is not in key order (D4134)`);
      }
      if (part === 'folders' && !folders.includes(key) && !(existsSync(join(root, key)) && statSync(join(root, key)).isDirectory())) {
        errors.push(`${where}: names a folder that does not exist`);
      }
      if (part === 'services' && typeof row.name !== 'string') errors.push(`${where}: "name" must be text`);
      for (const ref of row.checks ?? []) {
        const r = parseRef(ref);
        if (r.kind === 'suite') {
          if (!steps.includes(r.step)) errors.push(`${where}: "${ref}" is not a step of test:drift`);
          named.add(`${SUITE.file}#${SUITE.job}`);
        } else if (r.kind === 'guard') {
          if (!guards.includes(r.id)) errors.push(`${where}: "${ref}" is not a guard test:guards runs`);
          named.add(`${SUITE.file}#${SUITE.job}`);
        } else if (r.kind === 'job') {
          if (!workflows[r.file]) errors.push(`${where}: "${ref}" names a workflow that does not exist`);
          else if (!workflows[r.file].jobs[r.job]) errors.push(`${where}: "${ref}" names a job that does not exist`);
          if (!data.jobs[ref]) errors.push(`${where}: "${ref}" has no level in "jobs"`);
          named.add(ref);
        } else errors.push(`${where}: "${ref}" is not file#job, suite:<step> or guard:<id>`);
      }
      for (const pattern of row.tests ?? []) {
        if (pattern.split('/').includes('..') || pattern.startsWith('/')) errors.push(`${where}: "${pattern}" must stay in the repository`);
        else if (!globSync(pattern, { cwd: root }).length) errors.push(`${where}: "${pattern}" matches no file`);
      }
      for (const issue of row.gaps ?? []) {
        if (!/^#[1-9]\d*$/.test(issue)) errors.push(`${where}: gap "${issue}" is not #<issue number>`);
        else if (!data.issues[issue]) errors.push(`${where}: gap ${issue} is not in "issues"`);
        usedIssues.add(issue);
      }
    }
  }
  for (const folder of folders) if (!data.folders[folder]) errors.push(`${folder}/ is a top-level source folder with no row`);
  for (const job of testJobs(workflows)) if (!named.has(job)) errors.push(`${job} runs tests and no row names it`);
  for (const [ref, level] of Object.entries(data.jobs)) {
    if (!LEVELS[level]) errors.push(`jobs.${ref}: "${level}" is not one of ${RANK.join(', ')}`);
    if (!named.has(ref)) errors.push(`jobs.${ref}: no row names it`);
  }
  for (const [issue, title] of Object.entries(data.issues)) {
    if (!/^#[1-9]\d*$/.test(issue)) errors.push(`issues.${issue}: not #<issue number>`);
    if (typeof title !== 'string' || !title) errors.push(`issues.${issue}: needs a short title`);
    if (!usedIssues.has(issue)) errors.push(`issues.${issue}: no row cites it`);
  }
  const suite = workflows[SUITE.file]?.jobs;
  if (!suite?.[SUITE.job] || !suite?.[SUITE.gate]?.needs.includes(SUITE.job)) errors.push(`${SUITE.file}: expected job "${SUITE.gate}" to need "${SUITE.job}"`);
  for (const [check, file] of Object.entries(required)) {
    const jobs = workflows[file]?.jobs ?? {};
    if (!Object.values(jobs).some(job => requiredName(file, job, required) === check)) errors.push(`required check "${check}" names no job in ${file}`);
  }
  return errors;
}

// ----------------------------------------------------------------- rendering

const code = s => `\`${s.replaceAll('|', '\\|')}\``;
const cell = s => String(s).replaceAll('|', '\\|');

function describe(ctx, ref) {
  const r = parseRef(ref);
  const suiteWf = ctx.workflows[SUITE.file];
  const suiteJob = suiteWf.jobs[SUITE.job];
  const gate = suiteWf.jobs[SUITE.gate];
  const gateCheck = requiredName(SUITE.file, gate, ctx.required);
  if (r.kind === 'suite' || r.kind === 'guard') {
    return {
      check: r.kind === 'suite' ? `suite › ${code(r.step)}` : `suite › ${code('test:guards')} › ${code(r.id)}`,
      when: whenOf(suiteWf, suiteJob).join(', '),
      required: gateCheck ? `yes, in ${code(gateCheck)}` : 'no',
      level: 'unit',
    };
  }
  const wf = ctx.workflows[r.file];
  const job = wf.jobs[r.job];
  const check = requiredName(r.file, job, ctx.required);
  const title = job.name.includes('${{') ? r.job : job.name;
  return {
    check: `${code(r.file)} › ${cell(title)}`,
    when: whenOf(wf, job).join(', '),
    required: check ? `yes, ${code(check)}` : 'no',
    level: ctx.data.jobs[ref],
  };
}

const KIND_ORDER = ['suite', 'guard', 'job'];

/** A row's checks: suite steps, then guards, then workflow jobs from the lowest level up. */
function rowCells(ctx, row) {
  const order = ref => [KIND_ORDER.indexOf(parseRef(ref).kind), RANK.indexOf(ctx.data.jobs[ref] ?? 'unit')];
  const refs = [...row.checks].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || (a < b ? -1 : a > b ? 1 : 0);
  });
  const lines = refs.map(ref => describe(ctx, ref));
  const top = lines.reduce((best, l) => Math.max(best, RANK.indexOf(l.level)), -1);
  const gaps = row.gaps.length ? row.gaps.join(', ') : 'none filed';
  if (!lines.length) return ['none', '—', '—', 'none', gaps];
  return [
    lines.map(l => l.check).join('<br>'),
    lines.map(l => l.when || '—').join('<br>'),
    lines.map(l => l.required).join('<br>'),
    LEVELS[RANK[top]],
    gaps,
  ];
}

/** The page, from the context. Deterministic: same repository, same bytes. */
export function render(ctx) {
  const { data } = ctx;
  const out = [];
  out.push('# CI coverage matrix');
  out.push('');
  out.push(`<!-- Generated by \`node scripts/ci/coverage-matrix.mjs\` from the workflows, \`test:drift\`, the guard catalog, \`scripts/lib/requiredChecks.mjs\` and \`${DATA}\`. Do not edit by hand; \`--check\` in \`npm run test:guards\` fails a stale copy. -->`);
  out.push('');
  out.push('For each source folder and each Worker service with its own release gate: which');
  out.push('checks run, when, whether main\'s ruleset requires them, the highest level of');
  out.push('evidence any of them gives, and the open issue that owns the next level. It');
  out.push('states what exists on this commit (D8694).');
  out.push('');
  out.push('A suite step runs inside `ci.yml` › `suite`, one of the parts of `npm run test:drift`;');
  out.push('those parts report through the required `test:drift (full suite)` context.');
  out.push('');
  out.push('## Levels');
  out.push('');
  out.push('| Level | What a pass shows |');
  out.push('| --- | --- |');
  const meaning = {
    unit: 'Code, contracts and guards on this commit, with fakes in place of every provider.',
    browser: 'A real browser against a local build or Worker on fixtures, with no deployed service.',
    staging: 'A hosted, isolated environment with synthetic data, torn down after the run.',
    pilot: 'A real provider call on synthetic input.',
    production: 'A read of, or a probe against, the live production system.',
  };
  for (const key of RANK) out.push(`| ${LEVELS[key]} | ${meaning[key]} |`);
  out.push('');
  const table = (title, rows, label) => {
    out.push(`## ${title}`);
    out.push('');
    out.push('| Area | Checks | When | Required | Level | Open gap |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const [key, row] of rows) out.push(`| ${label(key, row)} | ${rowCells(ctx, row).join(' | ')} |`);
    out.push('');
  };
  table('Source folders', Object.entries(data.folders), key => code(`${key}/`));
  table('Worker services', Object.entries(data.services), (key, row) => cell(row.name));
  out.push('## Service test files');
  out.push('');
  out.push('Hand-kept in the map: the test files each service owns. The Level column above counts');
  out.push('only the checks in the service\'s row.');
  out.push('');
  out.push('| Service | Test files |');
  out.push('| --- | --- |');
  for (const row of Object.values(data.services)) out.push(`| ${cell(row.name)} | ${row.tests.map(code).join('<br>')} |`);
  out.push('');
  out.push('## Required checks');
  out.push('');
  out.push('From `scripts/lib/requiredChecks.mjs`.');
  out.push('');
  out.push('| Check | Job |');
  out.push('| --- | --- |');
  for (const [check, file] of Object.entries(ctx.required).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const id = Object.entries(ctx.workflows[file]?.jobs ?? {}).find(([, job]) => requiredName(file, job, ctx.required) === check)?.[0];
    out.push(`| ${code(check)} | ${id ? code(`${file}#${id}`) : 'none'} |`);
  }
  out.push('');
  out.push('## Open gaps');
  out.push('');
  out.push('| Issue | Owns |');
  out.push('| --- | --- |');
  for (const [issue, title] of Object.entries(data.issues)) out.push(`| ${issue} | ${cell(title)} |`);
  out.push('');
  return out.join('\n');
}

// --------------------------------------------------------------------- main

export function main(args, { root = ROOT, log = console.log, error = console.error, required = REQUIRED } = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) { error('usage: coverage-matrix.mjs [--check]'); return 2; }
  const ctx = loadContext(root, { required });
  const errors = validate(ctx);
  if (errors.length) {
    for (const e of errors) error(`coverage-matrix: ${e}`);
    return 1;
  }
  const page = render(ctx);
  if (args[0] === '--check') {
    if (ctx.page !== page) { error(`coverage-matrix: ${PAGE} is stale. Run node scripts/ci/coverage-matrix.mjs and commit the result.`); return 1; }
    log(`coverage-matrix: ${PAGE} is current.`);
    return 0;
  }
  writeFileSync(join(root, PAGE), page);
  log(`coverage-matrix: wrote ${PAGE}.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}

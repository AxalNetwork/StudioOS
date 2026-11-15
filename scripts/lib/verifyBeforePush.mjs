/**
 * #6326: the `verify-before-push` skill's decisions, apart from git and the
 * shell. Which areas a set of changed paths touches, which local checks those
 * areas need and in what order (mirroring `.github/workflows/ci.yml`: the
 * generated modules, the root build, then `test:guards`, the static checks,
 * the affected tests, and the `test:drift` parts from
 * `../test-drift-parts.mjs`), which test runner a test file belongs to, the
 * known environment failures that are not the PR's, files whose names differ
 * only by case, how results from several runs combine, and the STATUS
 * `tests:` line. The selection is advisory (D5610): CI still runs everything.
 * Owned by `../verify-before-push.mjs`; tested in `verifyBeforePush.test.mjs`.
 */

/** Paths whose change can affect any test: run everything. */
const EVERYTHING = [
  /(?:^|\/)package(?:-lock)?\.json$/,
  /^\.github\//,
  /^wrangler\.toml$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /^eslint\.config\.mjs$/,
  /^(?:frontend|cloudflare-worker)\/test\/_/,
  /(?:^|\/)_(?:deck|ts)-loader[^/]*\.mjs$/,
  /^scripts\/(?:build-generated|build-route-registry|build-api-index|build-skill-library|build-frontend|test-drift-parts)\.mjs$/,
];

/** First match wins. `everything` is decided before these. */
const AREA_RULES = [
  ['sql', /^cloudflare-worker\/sql\//],
  ['worker', /^cloudflare-worker\//],
  ['frontend', /^frontend\//],
  ['meeting-bot', /^meeting-bot\//],
  ['merge-control', /^merge-control\//],
  ['scripts', /^scripts\//],
  ['backend', /^backend\//],
  ['prose', /^(?:documentation|design|attached_assets)\/|\.md$/],
  ['skills', /^\.claude\//],
];

/** The areas a list of repository-relative paths touches. An unknown path is `everything`. */
export function areasOf(paths) {
  const areas = new Set();
  for (const p of paths) {
    if (EVERYTHING.some((re) => re.test(p))) { areas.add('everything'); continue; }
    const hit = AREA_RULES.find(([, re]) => re.test(p));
    areas.add(hit ? hit[0] : 'everything');
  }
  return areas;
}

/** The `test:drift` rest commands, by id, and the areas that need each one. */
export const REST_STEPS = Object.freeze({
  // cloudflare-worker/tsconfig.json also includes ../meeting-bot/worker and ../cloudflare-worker-tail/src.
  'npm run test:types': { id: 'types', areas: ['worker', 'sql', 'meeting-bot'], timeoutMin: 10 },
  'npm run test:types:frontend': { id: 'types-frontend', areas: ['frontend'], timeoutMin: 10 },
  'npm run lint:undef': { id: 'lint-undef', areas: ['frontend'], timeoutMin: 10 },
  'node scripts/check-dark-mode.mjs': { id: 'dark-mode', areas: ['frontend'], timeoutMin: 5 },
  'npm run test:retention': { id: 'retention', areas: ['scripts'], timeoutMin: 10 },
  'npm run test:meeting-bot': { id: 'meeting-bot', areas: ['meeting-bot'], timeoutMin: 15 },
  'npm run test:merge-control': { id: 'merge-control', areas: ['merge-control'], timeoutMin: 10 },
  'npm run test:guards': { id: 'guards', areas: [], always: true, timeoutMin: 15 },
});

/** Which `test:drift` shard script each area's parts come from. */
const SHARD_AREAS = Object.freeze({
  'test:frontend': ['frontend'],
  'test:worker': ['worker', 'sql'],
});

/** Static steps run before tests; guards first among them, as `test:guards` is the cheapest whole-repo check. */
const REST_ORDER = ['guards', 'types', 'types-frontend', 'lint-undef', 'dark-mode'];
const LATE_ORDER = ['retention', 'meeting-bot', 'merge-control'];

/** A glob of the shape package.json uses (`dir/*.test.mjs`) as a RegExp. */
export function globToRegExp(glob) {
  const esc = glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${esc}$`);
}

/** The runner prefix (`node ... --test `) and patterns of one package test script. */
export function runnerOf(cmd) {
  const first = String(cmd).split(' && ')[0];
  const at = first.indexOf(' --test ');
  if (at < 0) return null;
  const patterns = (first.slice(at + 8).match(/'[^']*'|"[^"]*"|\S+/g) || []).map((s) => s.replace(/^['"]|['"]$/g, ''));
  return { prefix: first.slice(0, at + 8), patterns };
}

/** The scripts whose test files the affected step runs, each with a step id. */
export const TEST_SCRIPTS = Object.freeze([
  ['test:frontend', 'affected-frontend'],
  ['test:worker', 'affected-worker'],
  ['test:meeting-bot', 'affected-meeting-bot'],
  ['test:retention', 'affected-scripts'],
]);

/** The package script that runs a test file, or null. */
export function scriptFor(file, scripts) {
  for (const [name] of TEST_SCRIPTS) {
    const r = runnerOf(scripts[name] || '');
    if (r && r.patterns.some((p) => globToRegExp(p).test(file))) return name;
  }
  return null;
}

/**
 * The tests a change reaches through static imports: changed test files, and
 * tests whose transitive relative imports include a changed file. `graph` is
 * `importGraph()` from `../select-tests.mjs`. A test that reads a file as
 * text is not found this way, which is why the parts still run.
 */
export function affectedTests(changed, tests, graph) {
  const touched = new Set(changed);
  const hit = [];
  for (const t of tests) {
    const seen = new Set();
    const stack = [t];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const d of graph[f] || []) stack.push(d);
    }
    if ([...seen].some((f) => touched.has(f))) hit.push(t);
  }
  return hit.sort();
}

/**
 * Above this many affected files a runner's affected step is replaced by that
 * runner's `test:drift` parts, which the plan then always includes. A runner
 * with no parts keeps its affected step.
 */
export const AFFECTED_MAX = 150;

const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

/**
 * The ordered steps for a change. Input: `changed` paths, package.json
 * `scripts`, `parts` (from `partsOf()` in `../test-drift-parts.mjs`),
 * `affected` test files, `full` to run every part and every rest step,
 * `base` the ref the LFS gate compares against.
 * Each step: `{ id, cmd, why, timeoutMin, kind }`; kind `plan` is the
 * suite-plan step the CLI does itself.
 */
export function planSteps({ changed, scripts, parts, affected = [], full = false, base = 'origin/main' }) {
  const areas = full ? new Set(['everything']) : areasOf(changed);
  const all = areas.has('everything');
  const wants = (list) => all || list.some((a) => areas.has(a));
  const steps = [
    { id: 'generated', cmd: 'node scripts/build-generated.mjs', why: 'D5612: the three generated modules every build, typecheck and test reads', timeoutMin: 2, kind: 'setup' },
    { id: 'build', cmd: 'npm run build', why: 'D529: docs/ is not committed; guards and the suite read the built SPA (scripts/build-frontend.mjs)', timeoutMin: 10, kind: 'setup' },
  ];
  const rest = parts.find((p) => p.name === 'rest');
  const restCmds = rest ? rest.commands : [];
  const restSteps = restCmds.map((cmd) => {
    const known = REST_STEPS[cmd];
    // A rest step this file does not know yet always runs: never narrower than CI.
    if (!known) return { id: cmd.replace(/^npm run |^node scripts\//, '').replace(/[^\w-]+/g, '-'), cmd, why: 'in test:drift; not mapped, so always run', timeoutMin: 15, kind: 'check', run: true };
    return { id: known.id, cmd, why: known.always ? 'always: house-rule guards (CLAUDE.md, AGENTS.md § House rules)' : `test:drift step for ${known.areas.join(', ')}`, timeoutMin: known.timeoutMin, kind: 'check', run: known.always || wants(known.areas) };
  });
  const byId = new Map(restSteps.map((s) => [s.id, s]));
  const early = [...REST_ORDER.map((id) => byId.get(id)).filter(Boolean), ...restSteps.filter((s) => !REST_ORDER.includes(s.id) && !LATE_ORDER.includes(s.id))];
  for (const s of early) if (s.run) steps.push(strip(s));
  // ci / fast runs these two from the base's copy; locally the branch's copy is the same file unless the PR edits it.
  if (wants(['sql'])) steps.push({ id: 'migrations', cmd: 'GITHUB_BASE_REF=main node scripts/migration-immutability-gate.mjs', why: 'ci / fast: no migration on main was edited, deleted or renamed', timeoutMin: 3, kind: 'check' });
  steps.push({ id: 'lfs', cmd: `node scripts/lfs-size-gate.mjs --against=${base}`, why: 'ci / fast: large files go through LFS', timeoutMin: 3, kind: 'check' });
  const forced = new Set();
  if (!full) {
    for (const [script, id] of TEST_SCRIPTS) {
      const files = affected.filter((f) => scriptFor(f, scripts) === script);
      const r = runnerOf(scripts[script] || '');
      if (!files.length || !r) continue;
      if (files.length > AFFECTED_MAX && parts.some((p) => p.script === script)) {
        forced.add(script);
        steps.push({ id, cmd: null, why: `${files.length} affected files: more than ${AFFECTED_MAX}, so the ${script} parts run instead`, timeoutMin: 0, kind: 'skipped' });
        continue;
      }
      steps.push({ id, cmd: r.prefix + files.map(quote).join(' '), why: `${files.length} test file(s) that import a changed file (advisory, D5610)`, timeoutMin: 15, kind: 'affected', files });
    }
  }
  for (const id of LATE_ORDER) { const s = byId.get(id); if (s && s.run) steps.push(strip(s)); }
  const shardParts = parts.filter((p) => p.script && (forced.has(p.script) || wants(SHARD_AREAS[p.script] || [])));
  if (shardParts.length) {
    steps.push({ id: 'suite-plan', cmd: 'node scripts/test-drift-parts.mjs --plan <log-dir>/no-timings.json', why: 'equal-weight plan for the parts (CI uses main\'s timings, so the files in a part differ from CI\'s)', timeoutMin: 2, kind: 'plan' });
    for (const p of shardParts) steps.push({ id: p.name, cmd: `node scripts/test-drift-parts.mjs ${p.name} --plan-file <log-dir>/suite-plan.json`, why: `${p.script} part, as CI's suite (${p.name}) job runs it`, timeoutMin: 30, kind: 'part' });
  }
  return { areas: [...areas].sort(), steps };
}

function strip(s) { const { run, ...rest } = s; return rest; }

/** Steps chosen by `--only a,b` or `--from id`; unknown ids are returned to report. */
export function chooseSteps(steps, { only = null, from = null } = {}) {
  const ids = steps.map((s) => s.id);
  if (only) {
    const want = only.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = want.filter((w) => !ids.includes(w));
    const chosen = steps.filter((s) => want.includes(s.id));
    // A part needs its plan, so `--only worker-2-of-6` still writes the plan first.
    if (chosen.some((s) => s.kind === 'part') && !chosen.some((s) => s.kind === 'plan')) chosen.unshift(steps.find((s) => s.kind === 'plan'));
    return { chosen, unknown };
  }
  if (from) {
    const at = ids.indexOf(from);
    if (at < 0) return { chosen: [], unknown: [from] };
    const chosen = steps.slice(at);
    if (chosen.some((s) => s.kind === 'part') && !chosen.some((s) => s.kind === 'plan')) chosen.unshift(steps.find((s) => s.kind === 'plan'));
    return { chosen, unknown: [] };
  }
  return { chosen: steps, unknown: [] };
}

/**
 * Known failures that come from the session's environment, not the PR, read
 * from a failed step's log tail. Each is `{ code, note }`. None found means:
 * treat the failure as the PR's own.
 */
export const ENV_FAILURES = Object.freeze([
  { code: 'docs-not-built', re: /docs\/assets\/ does not exist|docs\/ is build output and is not committed/, note: 'docs/ is not built (D529). Run the build step, then this step again.' },
  { code: 'missing-deps', re: /Cannot find package '[^']+'|ERR_MODULE_NOT_FOUND[^\n]*node_modules|npx canceled due to missing packages|could not determine executable to run|sh: \d*:? ?(?:\S*\/)?(?:eslint|tsc|vite|wrangler): not found/, note: 'npm dependencies are missing in this worktree. Link node_modules from a full checkout (root, frontend/, cloudflare-worker/), or run npm ci where disk allows. Not the PR\'s.' },
  { code: 'workerd-version', re: /newest (?:compatibility )?date supported by this|compatibility date[^\n]*(?:newer|later) than|Workers runtime[^\n]*compatibility date/i, note: 'the local miniflare/workerd is older than the lockfile (#5815). npm ci in cloudflare-worker/ fixes it; CI installs the locked version. Not the PR\'s.' },
  { code: 'age-missing', re: /spawn age ENOENT|age: (?:command )?not found/, note: 'the age CLI is not installed; CI installs it for the frontend parts (scripts/ci/install-age-linux.sh, D5398). Not the PR\'s.' },
  { code: 'network', re: /getaddrinfo (?:ENOTFOUND|EAI_AGAIN)|ECONNREFUSED|ECONNRESET|fetch failed|UND_ERR_CONNECT_TIMEOUT/, note: 'a hint only: several worker tests throw these strings on purpose, so this can be the PR\'s own failure. Re-run the step once; if it fails again, read the failing test\'s output and treat it as the PR\'s.' },
  { code: 'disk-full', re: /ENOSPC/, note: 'the disk is full. Free space (old worktrees, docs/ in other worktrees) and re-run. Not the PR\'s.' },
]);

/** The environment failures a failed log shows. */
export function envFailures(log) {
  const text = String(log || '');
  return ENV_FAILURES.filter((f) => f.re.test(text)).map(({ code, note }) => ({ code, note }));
}

/** Pairs of tracked module paths that differ only by case (extension ignored): they collide on a case-insensitive file system. */
export function caseCollisions(paths) {
  const seen = new Map();
  const pairs = [];
  for (const p of paths) {
    if (!/\.(?:[cm]?js|jsx|tsx?)$/.test(p)) continue;
    const stem = p.replace(/\.(?:[cm]?js|jsx|tsx?)$/, '');
    const prev = seen.get(stem.toLowerCase());
    // Same stem, other extension (`x.test.mjs` beside `x.test.ts`) is no collision: only the case differs here.
    if (prev && prev.stem !== stem) pairs.push([prev.path, p]);
    else if (!prev) seen.set(stem.toLowerCase(), { stem, path: p });
  }
  return pairs;
}

/** Warnings about the environment before anything runs. */
export function preflightNotes({ nodeMajor, missingModules = [], caseInsensitive = false, collisions = [], logDirInRepo = false }) {
  const notes = [];
  if (nodeMajor < 22) notes.push(`node ${nodeMajor}: CI runs node 22, and select-tests/test-drift-parts need fs.globSync (node 22).`);
  for (const m of missingModules) notes.push(`${m} is missing: steps that need it fail with missing-deps. Link it from a full checkout or run npm ci there; never commit it.`);
  if (caseInsensitive && collisions.length) notes.push(`this file system is case-insensitive and ${collisions.length} module pair(s) differ only by case (first: ${collisions[0].join(' / ')}). The build and tests importing them can resolve the wrong file here; CI on Linux is the judge. Not the PR's.`);
  if (logDirInRepo) notes.push('the log directory is inside the repository: keep logs out of commits (pass --log-dir in your scratchpad).');
  return notes;
}

/** Combine earlier results with new ones; a result from another tree is kept but marked stale. */
export function mergeResults(prev, next, tree) {
  const out = {};
  for (const [id, r] of Object.entries(prev || {})) out[id] = { ...r, stale: r.tree !== tree };
  for (const r of next) out[r.id] = { ...r, tree, stale: false };
  return out;
}

/** The summary table, in plan order where known. */
export function renderSummary(results, order = []) {
  const ids = [...order.filter((id) => results[id]), ...Object.keys(results).filter((id) => !order.includes(id))];
  const rows = ids.map((id) => {
    const r = results[id];
    const env = r.env?.length ? ` env:${r.env.map((e) => e.code).join(',')}` : '';
    return `${r.stale ? 'STALE ' : ''}${r.status.padEnd(7)} ${id.padEnd(22)} exit=${String(r.exit ?? '-').padEnd(4)} ${String(r.seconds ?? '-').padStart(5)}s${env}  ${r.log || ''}`;
  });
  return rows.join('\n');
}

/**
 * A STATUS `tests:` line from current (non-stale) results, counted against
 * `planned` (the plan's step ids, without its skipped steps), so a partial
 * run never reads as a complete one.
 */
export function testsLine(results, planned = []) {
  const rows = Object.entries(results).filter(([, r]) => !r.stale && r.status !== 'skipped');
  const ran = new Set(rows.map(([id]) => id));
  const notRun = planned.filter((id) => !ran.has(id));
  if (!rows.length) return `tests: none run on this tree${notRun.length ? ` (not run: ${notRun.join(', ')})` : ''}`;
  const by = (s) => rows.filter(([, r]) => r.status === s).map(([id]) => id);
  const pass = by('pass');
  const fail = by('fail');
  const timeout = by('timeout');
  const total = new Set([...planned, ...ran]).size;
  const parts = [`${pass.length}/${total} planned steps exit 0 (${pass.join(', ') || 'none'})`];
  if (fail.length) parts.push(`failed: ${fail.map((id) => `${id}${results[id].env?.length ? ` [env: ${results[id].env.map((e) => e.code).join(',')}]` : ''}`).join(', ')}`);
  if (timeout.length) parts.push(`timed out: ${timeout.join(', ')}`);
  if (notRun.length) parts.push(`not run: ${notRun.join(', ')}`);
  return `tests: ${parts.join('; ')}`;
}

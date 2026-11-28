// D5610: conservative affected-test selection, honest shadow scoring and
// aggregate reporting; tests in `selectTests.test.mjs`.
//
// D5610: conservative affected-test selection and shadow scoring; no test is skipped by CI.
export const FAN_IN_MAX = 500;
export const STALE_COMMITS = 20;
export const ALWAYS = Object.freeze(['test:guards', 'test:types', 'test:types:frontend', 'build']);
const DAY = 86_400_000;
const validPath = (p) => typeof p === 'string' && !p.startsWith('/') && !p.split('/').includes('..');
const strings = (v) => Array.isArray(v) && v.every(validPath);

export const GENERATED_INPUTS = Object.freeze({
  'cloudflare-worker/src/routes/_registry.ts': ['scripts/build-route-registry.mjs', 'scripts/lib/routeRegistry.mjs', 'cloudflare-worker/src/routes/'],
  'frontend/src/lib/apiModules.generated.js': ['scripts/build-api-index.mjs', 'scripts/lib/apiModules.mjs', 'frontend/src/lib/api/'],
  'cloudflare-worker/src/services/agents/skillLibrary.generated.ts': ['scripts/build-skill-library.mjs', 'cloudflare-worker/src/services/agents/skills/'],
});

export function select({ changed, deps, tests, graph = {}, meta = {} }) {
  const all = [...new Set(tests)].sort();
  const full = (reason) => ({ mode: 'full', reason, files: all, fraction: all.length ? 1 : 0 });
  const changes = changed.map((c) => typeof c === 'string' ? { path: c, status: 'M' } : c);
  if (changes.some((c) => /(?:^|\/)package(?:-lock)?\.json$/.test(c.path))) return full('package');
  if (changes.some((c) => /(?:^|\/)(?:_deck-loader.*|_ts-loader.*|_transpile-ts)\.mjs$/.test(c.path))) return full('loader');
  if (changes.some((c) => /^(?:frontend|cloudflare-worker)\/test\/_/.test(c.path))) return full('helper');
  if (changes.some((c) => c.path.startsWith('.github/'))) return full('workflow');
  if (!deps || typeof deps !== 'object' || Array.isArray(deps) || !deps.tests || typeof deps.tests !== 'object' || Array.isArray(deps.tests)) return full('missing-or-invalid-trace');
  const age = meta.now - Date.parse(deps.generatedAt);
  if (!Number.isFinite(age) || age < 0 || age > DAY || !Number.isInteger(meta.ageCommits) || meta.ageCommits < 0 || meta.ageCommits > STALE_COMMITS) return full('stale-trace');
  const changedPaths = new Set(changes.map((c) => c.path));
  for (const [output, inputs] of Object.entries({ ...GENERATED_INPUTS, ...meta.generated })) {
    if (changes.some((c) => inputs.some((i) => i.endsWith('/') ? c.path.startsWith(i) : c.path === i))) changedPaths.add(output);
  }
  const selected = new Set(all.filter((t) => changedPaths.has(t)));
  for (const t of all) {
    const trace = deps.tests[t];
    if (trace) {
      // #5608 records reads, imports, sqlite opens and hit/miss probes separately.
      const lists = [trace.reads, trace.modules, trace.sqlite, trace.probes?.hits, trace.probes?.misses];
      const files = trace.files ?? (lists.every(strings) ? [...new Set(lists.flat())] : null);
      if (!strings(files) || !strings(trace.directories)) return full('missing-or-invalid-trace');
      if (trace.opaque || files.length > FAN_IN_MAX || files.some((f) => changedPaths.has(f))) selected.add(t);
      // Only additions/deletions affect a directory listing; modifications affect file readers.
      if (changes.some((c) => /^[ADR]/.test(c.status) && trace.directories.some((d) => (d === '.' || d === '' || c.path.startsWith(`${d.replace(/\/$/, '')}/`))))) selected.add(t);
    } else {
      // Static transitive import closure for tests not yet traced. Missing graph is unsafe.
      if (!Array.isArray(graph[t])) return full('missing-static-graph');
      const seen = new Set();
      const visit = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const dep of graph[file] || []) visit(dep);
      };
      visit(t);
      if ([...seen].some((f) => changedPaths.has(f))) selected.add(t);
    }
  }
  const files = [...selected].sort();
  const fraction = all.length ? files.length / all.length : 0;
  if (fraction > 0.4) return full('selection-over-40-percent');
  return { mode: 'selected', reason: 'affected', files, fraction };
}

export function score(selection, failure) {
  // D5610-p3: a guard failure is never a miss, because `test:guards` is in ALWAYS. It neither scores nor
  // unscores the run; the run's test failures decide.
  const failures = Array.isArray(failure?.failures) ? failure.failures.filter((f) => f?.kind !== 'guard') : null;
  if (!failure || failure.verdict !== 'pr_failure' || !failures?.length || failures.some((f) => !validPath(f.file) || !/\.test\.(?:mjs|ts)$/.test(f.file))) {
    return { scoring: 'unscored', misses: null, failing: null };
  }
  const failing = [...new Set(failures.map((f) => f.file))].sort();
  return { scoring: 'scored', failing, misses: failing.filter((f) => !selection.files.includes(f)) };
}

export function report(records) {
  const scored = records.filter((r) => r.scoring === 'scored');
  return {
    runs: records.length, failing: scored.length, unscored: records.length - scored.length,
    misses: scored.reduce((n, r) => n + r.misses.length, 0),
    fallbackFraction: records.length ? records.filter((r) => r.mode === 'full').length / records.length : null,
    gate: scored.length >= 300 && scored.every((r) => r.misses.length === 0) ? 'backtest-required' : 'not-met',
  };
}

// D5610-p3: the trace for a PR is the newest `test-deps-<sha>` artifact on its base's first-parent line, at or
// before the base: `commits` is that line, base first; `artifacts` are rows from exact-name lookups. A trace from a
// newer main commit is never chosen (the CLI's ancestry check refused those), and a merge-queue artifact counts,
// because its run tested the very SHA that landed. Beyond STALE_COMMITS the trace would be stale anyway.
export function traceAtOrBefore(commits, artifacts) {
  const rows = Array.isArray(artifacts) ? artifacts : [];
  for (const [ageCommits, sha] of (Array.isArray(commits) ? commits : []).slice(0, STALE_COMMITS + 1).entries()) {
    if (!/^[a-f0-9]{40}$/.test(sha)) return null;
    const hit = rows.filter((a) => a && !a.expired && a.name === `test-deps-${sha}` && a.workflow_run?.head_sha === sha && Number.isSafeInteger(a.id) && a.id > 0 && typeof a.created_at === 'string')
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
    if (hit) return { id: hit.id, created_at: hit.created_at, sha, ageCommits };
  }
  return null;
}

// D5610-p3: the replay inputs for one red-main episode: the first red commit's own change, judged against the
// trace at or before its parent. Tests are the trace's keys plus changed test files (new tests are selected as
// changed); a failing file outside both is never selected, so it counts as a miss, never as a pass.
export function replayInputs({ changed, deps, traceCreatedAt, ageCommits }) {
  const added = changed.filter((c) => !/^D/.test(c.status) && /\.test\.(?:mjs|ts)$/.test(c.path)).map((c) => c.path);
  const tests = [...new Set([...Object.keys(deps?.tests || {}), ...added])].sort();
  const graph = Object.fromEntries(tests.filter((t) => !deps?.tests?.[t]).map((t) => [t, []]));
  const trace = deps && { ...deps, generatedAt: deps.generatedAt || traceCreatedAt };
  return { changed, deps: trace, tests, graph, meta: { now: Date.parse(traceCreatedAt), ageCommits } };
}

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
  if (!failure || failure.verdict !== 'pr_failure' || !Array.isArray(failure.failures) || !failure.failures.length || failure.failures.some((f) => !validPath(f.file) || !/\.test\.(?:mjs|ts)$/.test(f.file))) {
    return { scoring: 'unscored', misses: null, failing: null };
  }
  const failing = [...new Set(failure.failures.map((f) => f.file))].sort();
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

// A verified queue SHA can already be main even though its artifact still names a queue branch.
export function newestMainArtifact(artifacts, commits) {
  const main = new Set(commits.map((c) => c.sha));
  return artifacts.filter((a) => !a.expired && a.name?.startsWith('test-deps-') && Number.isSafeInteger(a.id) && a.id > 0 && main.has(a.workflow_run?.head_sha))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0] || null;
}

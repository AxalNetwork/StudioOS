/**
 * D6464 (#6464): the known-flaky test list and the one rule that may retry.
 *
 * Pure functions only: no network, no clock, no file system. The collector
 * (`scripts/flaky-tests.mjs`) feeds them recent CI job logs; the suite runner
 * (`scripts/test-drift-parts.mjs`) asks `retryDecision` whether a failed
 * part may run its failed files once more.
 *
 * A test is flaky here when it failed in merge-queue runs on PRs that did not
 * touch its file, intermittently: the same commit later passed it, or it failed
 * on two days with a green run between. A one-day burst is not a flake. A retry never hides a failure: the runner writes every
 * retried test to the job summary, and a test that is not on the list, or
 * whose file the entry itself changed, is never retried.
 */

/** Clean days after which an entry leaves the list. */
export const EXPIRY_DAYS = 14;
/** Distinct runs a test must fail in before it is listed. */
export const MIN_RUNS = 2;
/** How long after a failure a green main run still counts as "main at that time". */
export const MAIN_WINDOW_MS = 24 * 60 * 60 * 1000;

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
const strip = (line) => line.replace(STAMP, '');

/** A repo-relative test file from a `location:` path, or null. */
export function repoFile(location) {
  const m = /((?:frontend|cloudflare-worker|meeting-bot|merge-control|scripts)\/[\w./-]*\.test\.(?:mjs|ts))(?::\d+(?::\d+)?)?$/.exec(location);
  return m ? m[1] : null;
}

/**
 * Failed tests in a node:test TAP log: [{ file, test }]. A failure is a
 * `not ok N - <name>` line; its file comes from the `location:` line of its
 * YAML block. A whole-file failure names the file itself.
 */
export function parseFailures(log) {
  const lines = String(log).split(/\r?\n/).map(strip);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    // TAP escapes `#` and `\` in a name (`\#`, `\\`); an unescaped ` # SKIP|TODO` is a directive.
    const m = /^\s*not ok \d+ - (.+?)(?:\s+#\s+(?:SKIP|TODO)\b.*)?\s*$/i.exec(lines[i]);
    if (!m) continue;
    const name = m[1].replace(/\\([\\#])/g, '$1');
    let file = repoFile(name);
    let suite = false;
    // The YAML block under the line: its location, and whether it is a suite.
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      if (/^\s*(?:not )?ok \d+ - /.test(lines[j]) || /^\s*\.\.\.\s*$/.test(lines[j])) break;
      const loc = /^\s*location: '([^']+)'/.exec(lines[j]);
      if (loc && !file) file = repoFile(loc[1]);
      if (/^\s*type: 'suite'/.test(lines[j])) suite = true;
    }
    // A failed describe is not a test: the failed tests inside it are listed.
    if (!file || suite) continue;
    const test = repoFile(name) === file ? file : name;
    const key = `${file}\u0000${test}`;
    if (!seen.has(key)) { seen.add(key); out.push({ file, test }); }
  }
  // A file-level line repeats a failure already named inside that file.
  return out.filter((f) => f.test !== f.file || !out.some((g) => g.file === f.file && g.test !== g.file));
}

/** The PR number of a merge-queue branch (`gh-readonly-queue/main/pr-123-<sha>`), or null. */
export function queuePr(branch) {
  const m = /^gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(String(branch || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Classify failures. `runs` are failed merge-queue runs:
 * { id, sha, at, failures: [{ file, test }], changedFiles: string[] }.
 * `greens` are successful runs: { sha, at, event }.
 *
 * A failure counts only when its file is not one the PR changed and main
 * passed within MAIN_WINDOW_MS after it, or the same commit later passed. A
 * test is flaky only when it is intermittent: the same commit failed and then
 * passed it, or it failed on two different days with a run succeeding between
 * them. A red main (D5398), or an entry ahead in the queue that broke the test
 * for the entries behind it, leaves a one-day burst that the same code repeats
 * every time: not a flake, however often it failed.
 * Returns [{ file, test, runs: [id], firstSeen, lastSeen }].
 */
const day = (iso) => String(iso).slice(0, 10);

export function classify(runs, greens) {
  const byKey = new Map();
  for (const run of runs) {
    const changed = new Set(run.changedFiles || []);
    const at = Date.parse(run.at);
    const sameCodePassed = greens.some((g) => g.sha === run.sha && Date.parse(g.at) >= at);
    const mainPassed = greens.some((g) => g.event === 'push' && Date.parse(g.at) >= at && Date.parse(g.at) - at <= MAIN_WINDOW_MS);
    if (!sameCodePassed && !mainPassed) continue;
    for (const f of run.failures) {
      if (changed.has(f.file)) continue;
      const key = `${f.file}\u0000${f.test}`;
      const row = byKey.get(key) || { file: f.file, test: f.test, runs: [], firstSeen: run.at, lastSeen: run.at, rerunPassed: false };
      if (!row.runs.includes(run.id)) row.runs.push(run.id);
      if (run.at < row.firstSeen) row.firstSeen = run.at;
      if (run.at > row.lastSeen) row.lastSeen = run.at;
      row.rerunPassed ||= sameCodePassed;
      byKey.set(key, row);
    }
  }
  // Without a same-commit pass, the failures must span two days with a green run between them. A one-day burst
  // is a queue episode: an entry ahead in the group broke the test for the entries behind it (or main was red),
  // and the same code fails the same way every time, so a retry could never turn it green.
  const intermittent = (row) => row.rerunPassed
    || (day(row.firstSeen) !== day(row.lastSeen)
      && greens.some((g) => Date.parse(g.at) > Date.parse(row.firstSeen) && Date.parse(g.at) < Date.parse(row.lastSeen)));
  return [...byKey.values()].filter(intermittent).map(({ rerunPassed, ...row }) => row)
    .sort((a, b) => b.runs.length - a.runs.length || a.file.localeCompare(b.file) || a.test.localeCompare(b.test));
}

/**
 * The next list: existing entries updated with what was found, new tests that
 * failed in at least MIN_RUNS runs added, and entries with no failure for
 * EXPIRY_DAYS dropped. `now` is an ISO time. Sorted by file, then test.
 */
export function mergeList(existing, found, now, { expiryDays = EXPIRY_DAYS, minRuns = MIN_RUNS } = {}) {
  const key = (e) => `${e.file}\u0000${e.test}`;
  const next = new Map((existing || []).map((e) => [key(e), { ...e }]));
  for (const f of found) {
    const prev = next.get(key(f));
    if (prev) {
      next.set(key(f), { ...prev, firstSeen: day(f.firstSeen) < prev.firstSeen ? day(f.firstSeen) : prev.firstSeen,
        lastSeen: day(f.lastSeen) > prev.lastSeen ? day(f.lastSeen) : prev.lastSeen, count: Math.max(prev.count, f.runs.length) });
    } else if (f.runs.length >= minRuns) {
      next.set(key(f), { file: f.file, test: f.test, firstSeen: day(f.firstSeen), lastSeen: day(f.lastSeen), count: f.runs.length });
    }
  }
  const cutoff = Date.parse(now) - expiryDays * 24 * 60 * 60 * 1000;
  return [...next.values()]
    .filter((e) => Date.parse(`${e.lastSeen}T23:59:59Z`) >= cutoff)
    .sort((a, b) => a.file.localeCompare(b.file) || a.test.localeCompare(b.test));
}

/**
 * Whether a failed part may re-run its failed files once.
 * `failures`: [{ file, test }] from the reporter; `list`: the tracked list;
 * `changedFiles`: files the queue entry changed, or null when unknown.
 * Retry only under merge_group, only when every failure is listed, and only
 * when no failed file is one the entry changed (unknown changes: no retry).
 * Returns { retry, files, reason }.
 */
export function retryDecision({ event, failures, list, changedFiles }) {
  if (event !== 'merge_group') return { retry: false, files: [], reason: `no retry under ${event || 'an unknown event'}` };
  if (!failures.length) return { retry: false, files: [], reason: 'no failed test was recorded' };
  const listed = new Set((list || []).map((e) => `${e.file}\u0000${e.test}`));
  const unlisted = failures.filter((f) => !listed.has(`${f.file}\u0000${f.test}`));
  if (unlisted.length) return { retry: false, files: [], reason: `not on the flaky list: ${unlisted.map((f) => `${f.file} › ${f.test}`).join('; ')}` };
  if (!Array.isArray(changedFiles)) return { retry: false, files: [], reason: 'the files this entry changed could not be read' };
  const changed = new Set(changedFiles);
  const own = failures.filter((f) => changed.has(f.file));
  if (own.length) return { retry: false, files: [], reason: `this entry changed ${[...new Set(own.map((f) => f.file))].join(', ')}` };
  return { retry: true, files: [...new Set(failures.map((f) => f.file))].sort(), reason: 'every failure is on the flaky list' };
}

/** Whether a failed run would have passed with the retry: every failed suite test listed, and no other job failed. */
export function wouldTurnGreen(run, list) {
  if (run.otherJobsFailed || !run.failures.length) return false;
  const listed = new Set(list.map((e) => `${e.file}\u0000${e.test}`));
  const changed = new Set(run.changedFiles || []);
  return run.failures.every((f) => listed.has(`${f.file}\u0000${f.test}`) && !changed.has(f.file));
}

/**
 * Whether a test still exists: its name appears in its file's source, quoted
 * as written (escapes and typographic quotes undone). A name built at run time
 * is not found, so it is never listed: this rule only ever shortens the list.
 */
export function stillDefined(source, name) {
  if (typeof source !== 'string' || !name) return false;
  if (source.includes(name)) return true;
  const plain = source.replace(/\\(['"`\\])/g, '$1');
  return plain.includes(name);
}

/** The title of a listed test's issue; one issue per title. */
export const issueTitle = (e) => `Flaky test: ${e.file} › ${e.test}`.slice(0, 250);

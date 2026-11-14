/**
 * D5580 (#5580 part 1): hunk-level risk classes for each overlapping PR pair, the four per-PR evidence fields
 * (merge status, required checks, CI queue delay, base age) and the dated advisory snapshot. Pure: no network, no
 * git; the CLI `../pr-overlap.mjs` reads GitHub and hands the rows in. Advisory only: nothing here blocks a merge.
 *
 * Risk classes, lowest to highest (a pair takes the highest of its shared paths):
 *   same-path-disjoint-hunks  a shared path, but the two diffs change old-side line ranges that neither overlap
 *                             nor touch (at least one unchanged base line between them)
 *   unknown-hunks             a shared path whose hunks cannot be compared: a patch is missing or truncated, or
 *                             the two PRs' merge bases differ in that file. Never read as disjoint.
 *   overlapping-hunks         old-side changed ranges overlap or touch (git's merge treats touching as a conflict)
 *   dependency                an API, schema, migration, contract, manifest, baseline, generated or hub path, or
 *                             a shared new migration stamp
 *   critical                  a security or production path (CRITICAL below) or a shared migration that alters,
 *                             drops or renames an existing table (or whose patch cannot be read to rule that out)
 * `disjoint` (no shared path) is never reported. Unknown evidence is a named state with a null value, never 0.
 */
import { percentile } from './ciScorecard.mjs';

export const RISK = ['same-path-disjoint-hunks', 'unknown-hunks', 'overlapping-hunks', 'dependency', 'critical'];
export const DEPENDENCY_CLASSES = new Set(['hub', 'migration', 'contract', 'baseline', 'generated', 'manifest', 'api', 'schema']);
export const CRITICAL = [
  [/(^|\/)wrangler[^/]*\.toml$/, 'Worker deploy configuration'],
  [/^\.github\/workflows\//, 'CI/CD workflow'],
  [/^\.github\/actions\//, 'CI/CD action'],
  [/^\.github\/(?:CODEOWNERS$|codeql\/|dependabot\.yml$)/, 'repository protection'],
  [/^cloudflare-worker\/src\/auth\.ts$/, 'authentication'],
  [/^cloudflare-worker\/src\/middleware\/[^/]+\.ts$/, 'request middleware (auth, CSRF, rate limit, security headers)'],
  [/^cloudflare-worker\/src\/routes\/auth(?:_[a-z]+)?\.ts$/, 'sign-in route'],
  [/^cloudflare-worker\/src\/util\/(?:webauthn|authErrors|oauthReturn)\.ts$/, 'authentication helper'],
  [/^frontend\/public\/_headers$/, 'security headers'],
  [/^\.(?:gitleaks\.toml|gitleaksignore|semgrepignore)$/, 'secret and code scanning configuration'],
];
const SHA = /^[a-f0-9]{40}$/;
const ALTERS = /\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER|COLUMN)|RENAME\s+(?:TO|COLUMN))\b/i;
const rank = c => RISK.indexOf(c);
const unknown = reason => ({ status: 'unknown', reason });

/** Old-side changed spans of one GitHub files-API entry. An insertion before old line L is { start: L, end: L - 1 }. */
export function parseHunks(file) {
  if (typeof file?.patch !== 'string' || !file.patch) return unknown('patch missing (binary, too large or rename only)');
  const lines = file.patch.split('\n'), spans = [];
  let i = 0, plus = 0, minus = 0;
  while (i < lines.length) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!h) return unknown('patch unparsable');
    let oldLeft = h[2] === undefined ? 1 : Number(h[2]), newLeft = h[4] === undefined ? 1 : Number(h[4]);
    let oldLine = Number(h[1]) + (oldLeft === 0 ? 1 : 0), run = null;
    const close = () => { if (run) spans.push(run); run = null; };
    for (i++; i < lines.length && !lines[i].startsWith('@@ '); i++) {
      const l = lines[i];
      if (l.startsWith('\\')) continue;
      if (l === '' && oldLeft === 0 && newLeft === 0) continue;
      if (l.startsWith('-')) {
        if (--oldLeft < 0) return unknown('patch truncated');
        run ??= { start: oldLine, end: oldLine - 1 }; run.end = oldLine++; minus++;
      } else if (l.startsWith('+')) {
        if (--newLeft < 0) return unknown('patch truncated');
        run ??= { start: oldLine, end: oldLine - 1 }; plus++;
      } else if (l.startsWith(' ')) {
        close(); oldLine++;
        if (--oldLeft < 0 || --newLeft < 0) return unknown('patch truncated');
      } else return unknown('patch unparsable');
    }
    close();
    if (oldLeft !== 0 || newLeft !== 0) return unknown('patch truncated');
  }
  if ((Number.isInteger(file.additions) && file.additions !== plus) || (Number.isInteger(file.deletions) && file.deletions !== minus)) return unknown('patch truncated');
  return { status: 'ok', spans };
}

/** Overlapping or touching: no unchanged base line lies between the two spans. */
export const spansTouch = (a, b) => a.start <= b.end + 1 && b.start <= a.end + 1;

/** Whether two PRs' old-side line numbers for a path describe the same base text. */
export function comparableBases(a, b, pathA, pathB, blobAt) {
  const ma = a?.evidence?.baseAge?.mergeBase, mb = b?.evidence?.baseAge?.mergeBase;
  if (!SHA.test(ma ?? '') || !SHA.test(mb ?? '')) return { ok: false, reason: 'merge base not measured' };
  if (ma === mb && pathA === pathB) return { ok: true, basis: 'same merge base' };
  const ba = blobAt?.(ma, pathA), bb = blobAt?.(mb, pathB);
  if (ba == null || bb == null) return { ok: false, reason: 'merge bases differ; base file not compared' };
  return ba === bb ? { ok: true, basis: 'same base file content' } : { ok: false, reason: 'merge bases differ and the file changed between them' };
}

export function hunkRisk(fileA, fileB, comparable = { ok: true }) {
  const ha = parseHunks(fileA), hb = parseHunks(fileB);
  if (ha.status !== 'ok' || hb.status !== 'ok') return { class: 'unknown-hunks', reason: [ha.status !== 'ok' && `a: ${ha.reason}`, hb.status !== 'ok' && `b: ${hb.reason}`].filter(Boolean).join('; ') };
  if (!comparable.ok) return { class: 'unknown-hunks', reason: comparable.reason };
  const ranges = [];
  for (const sa of ha.spans) for (const sb of hb.spans) if (spansTouch(sa, sb)) ranges.push({ a: sa, b: sb });
  return ranges.length ? { class: 'overlapping-hunks', ranges: ranges.slice(0, 20) }
    : { class: 'same-path-disjoint-hunks', a: ha.spans.slice(0, 20), b: hb.spans.slice(0, 20) };
}

const addedLines = patch => patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
export function criticalReason(path, pathClass, files = []) {
  const hit = CRITICAL.find(([re]) => re.test(path));
  if (hit) return hit[1];
  if (pathClass !== 'migration') return null;
  if (files.some(f => typeof f?.patch !== 'string')) return 'migration patch unavailable; ALTER/DROP not ruled out';
  return files.some(f => addedLines(f.patch).some(l => ALTERS.test(l))) ? 'migration alters, drops or renames an existing table' : null;
}

const fileFor = (pr, path) => (pr.files ?? []).find(f => typeof f === 'object' && (f.filename === path || f.previous_filename === path));
const oldPath = (f, path) => f?.previous_filename ?? f?.filename ?? path;

/** Adds `risk` and `hunks` to each shared path and `risk` to each pair. Mutates and returns the pairs. */
export function annotate(overlaps, { blobAt } = {}) {
  for (const pair of overlaps) {
    let top = -1;
    for (const entry of pair.paths) {
      const fa = fileFor(pair.a, entry.path), fb = fileFor(pair.b, entry.path);
      entry.hunks = hunkRisk(fa, fb, comparableBases(pair.a, pair.b, oldPath(fa, entry.path), oldPath(fb, entry.path), blobAt));
      const critical = criticalReason(entry.path, entry.class, [fa, fb]);
      entry.risk = critical ? 'critical' : DEPENDENCY_CLASSES.has(entry.class) ? 'dependency' : entry.hunks.class;
      if (critical) entry.why = critical;
      top = Math.max(top, rank(entry.risk));
    }
    if (pair.migrationStamps?.length) top = Math.max(top, rank('dependency'));
    pair.risk = RISK[top] ?? 'unknown-hunks';
  }
  return overlaps;
}

const MERGE_STATES = new Set(['behind', 'blocked', 'clean', 'dirty', 'draft', 'has_hooks', 'unknown', 'unstable']);
/** (a) Textual merge status against the base, as GitHub computed it; null `mergeable` means not computed yet. */
export function mergeStatus(detail) {
  const state = MERGE_STATES.has(detail?.mergeable_state) ? detail.mergeable_state : 'unknown';
  if (detail?.mergeable === false || state === 'dirty') return { status: 'conflict', mergeableState: state };
  if (detail?.mergeable === true) return { status: 'clean', mergeableState: state };
  return { status: 'unknown', mergeableState: state, reason: 'GitHub has not computed mergeability' };
}

/** Required contexts from `GET rules/branches/{ref}`; null when unreadable. */
export function requiredFromRules(rules) {
  if (!Array.isArray(rules)) return null;
  return [...new Set(rules.filter(r => r?.type === 'required_status_checks')
    .flatMap(r => r.parameters?.required_status_checks ?? []).map(c => c?.context).filter(c => typeof c === 'string'))].sort();
}

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);
/** (b) Required-check state on the head SHA. `checkRuns` null = unreadable; `required` null = ruleset unreadable. */
export function requiredChecks(checkRuns, required) {
  if (!Array.isArray(checkRuns)) return { status: 'unknown', reason: 'check runs unreadable', failed: [], pending: [], missing: [] };
  const latest = new Map();
  for (const run of checkRuns) if (typeof run?.name === 'string' && !(latest.get(run.name)?.id > run.id)) latest.set(run.name, run);
  const failedAll = [...latest.values()].filter(r => FAILED.has(r.conclusion)).map(r => r.name).sort();
  if (!Array.isArray(required)) return { status: 'unknown', reason: 'required set unreadable', failed: [], pending: [], missing: [], failedAny: failedAll };
  if (!required.length) return { status: 'none required', failed: [], pending: [], missing: [] };
  const failed = [], pending = [], missing = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run) missing.push(name); else if (FAILED.has(run.conclusion)) failed.push(name); else if (run.status !== 'completed') pending.push(name);
  }
  return { status: failed.length ? 'failed' : pending.length || missing.length ? 'pending' : 'passing', failed, pending, missing };
}

const minutesBetween = (start, end) => {
  const v = (Date.parse(end) - Date.parse(start)) / 60000;
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const round = v => Math.round(v * 10) / 10;
/** (c) Runner queue delay of the head's CI jobs: started_at - created_at, as D5603's runnerWait measures it. */
export function queueDelay(jobs, now) {
  if (!Array.isArray(jobs)) return { status: 'not measured', reason: 'no CI run on this head', maxMinutes: null };
  const waits = [], queued = [];
  for (const job of jobs) {
    if (job?.conclusion === 'skipped') continue;
    if (job?.started_at) { const w = minutesBetween(job.created_at, job.started_at); if (w !== null) waits.push(w); }
    else if (['queued', 'waiting', 'pending'].includes(job?.status)) { const w = minutesBetween(job.created_at, new Date(now).toISOString()); if (w !== null) queued.push(w); }
  }
  if (!waits.length && !queued.length) return { status: 'not measured', reason: 'no job has both timestamps', maxMinutes: null };
  return { status: 'measured', jobs: waits.length, maxMinutes: waits.length ? round(Math.max(...waits)) : null,
    p50Minutes: waits.length ? round(percentile(waits, 50).value) : null,
    stillQueued: queued.length, longestQueuedMinutes: queued.length ? round(Math.max(...queued)) : null };
}

/** (d) How far the head is behind its base, from `GET compare/{base}...{head}`. */
export function baseAge(compare, now) {
  const mb = compare?.merge_base_commit, date = mb?.commit?.committer?.date ?? mb?.commit?.author?.date;
  if (!Number.isInteger(compare?.behind_by) || !SHA.test(mb?.sha ?? '')) return { status: 'unknown', reason: 'compare unreadable', behindBy: null, mergeBase: null };
  const hours = date ? minutesBetween(date, new Date(now).toISOString()) : null;
  return { status: 'measured', behindBy: compare.behind_by, mergeBase: mb.sha, mergeBaseDate: date ?? null, ageHours: hours === null ? null : round(hours / 60) };
}

export const UNMEASURED = () => ({
  merge: { status: 'unknown', reason: 'not read', mergeableState: 'unknown' },
  checks: { status: 'unknown', reason: 'not read', failed: [], pending: [], missing: [] },
  queue: { status: 'not measured', reason: 'not read', maxMinutes: null },
  baseAge: { status: 'unknown', reason: 'not read', behindBy: null, mergeBase: null },
});

/** Removes repeated PR numbers (pagination drift), keeping the first row. */
export function dedupe(prs) {
  const seen = new Set();
  return prs.filter(pr => Number.isSafeInteger(pr?.number) && !seen.has(pr.number) && seen.add(pr.number));
}

/** Whether the head moved between the list read and the detail read. Unknown SHAs are not called stale. */
export const isStale = (listed, detail) => SHA.test(listed?.head?.sha ?? '') && SHA.test(detail?.head?.sha ?? '') && listed.head.sha !== detail.head.sha;

const pathsOf = pr => [...new Set((pr.files ?? []).flatMap(f => typeof f === 'string' ? [f] : [f.filename, f.previous_filename]).filter(Boolean))].sort();
/** The dated advisory baseline record (#5580): uploaded as a workflow artifact, never committed. */
export function snapshot({ generatedAt, repo, prs, overlaps, notes = [], partial = false }) {
  return {
    schema: 'studioos-pr-overlap-snapshot/v1', decision: 'D5580', generatedAt, repo, partial, notes,
    prs: [...prs].sort((a, b) => a.number - b.number).map(pr => ({
      number: pr.number, draft: Boolean(pr.draft), stale: Boolean(pr.stale),
      headSha: SHA.test(pr.head?.sha ?? '') ? pr.head.sha : null, baseRef: typeof pr.base?.ref === 'string' ? pr.base.ref : null,
      baseSha: SHA.test(pr.base?.sha ?? '') ? pr.base.sha : null, paths: pathsOf(pr), evidence: pr.evidence ?? UNMEASURED(),
    })),
    pairs: overlaps.map(p => ({ a: p.a.number, b: p.b.number, risk: p.risk ?? null, textualConflict: p.verdict,
      paths: p.paths.map(e => ({ path: e.path, pathClass: e.class, risk: e.risk ?? null, why: e.why ?? null, hunks: e.hunks ?? null })),
      migrationStamps: p.migrationStamps ?? [] })),
  };
}

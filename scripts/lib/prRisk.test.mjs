// D5580 (#5580 part 1): hunk risk classes, the four evidence fields, scan determinism and the baseline snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { annotate, baseAge, comparableBases, criticalReason, dedupe, hunkRisk, isStale, mergeStatus, parseHunks, queueDelay, requiredChecks, requiredFromRules, snapshot, spansTouch } from './prRisk.mjs';
import { clusters, evidenceText, pairs, render, summary } from './prOverlap.mjs';
import { makeApi, main, report } from '../pr-overlap.mjs';

const BASE = 'a'.repeat(40), OTHER = 'b'.repeat(40);
const sha = n => String(n).padStart(40, 'c');
/** A unified-diff hunk with three context lines each side, changing `del` old lines from `start` into `add` new lines. */
const hunk = (start, del, add) => {
  const ctx = k => Array.from({ length: 3 }, (_, i) => ` ctx ${k}${i}`);
  return [`@@ -${start - 3},${del + 6} +${start - 3},${add + 6} @@ fn()`, ...ctx('b'),
    ...Array.from({ length: del }, (_, i) => `-old ${start + i}`), ...Array.from({ length: add }, (_, i) => `+new ${i}`), ...ctx('a')].join('\n');
};
const file = (filename, ...hunks) => ({ filename, status: 'modified', patch: hunks.join('\n') });
const pr = (number, files, extra = {}) => ({ number, files, head: { sha: sha(number) }, base: { ref: 'main', sha: BASE }, evidence: { baseAge: { status: 'measured', mergeBase: BASE } }, ...extra });
const DELIVERY = 'cloudflare-worker/src/routes/partner_delivery.ts';
/** The Delivery cluster of 2026-11-11 (D5616): four PRs on one route file. */
const delivery = () => [
  pr(5563, [file(DELIVERY, hunk(120, 3, 4))]),
  pr(5562, [file(DELIVERY, hunk(50, 0, 2))]),
  pr(5553, [file(DELIVERY, hunk(300, 2, 2))]),
  pr(5523, [file(DELIVERY, hunk(121, 5, 1), hunk(299, 4, 4))]),
];
const pairOf = (overlaps, a, b) => overlaps.find(p => (p.a.number === a && p.b.number === b) || (p.a.number === b && p.b.number === a));

test('parseHunks returns old-side changed spans without context, and unknown for missing or truncated patches', () => {
  assert.deepEqual(parseHunks(file('x', hunk(120, 3, 4))), { status: 'ok', spans: [{ start: 120, end: 122 }] });
  assert.deepEqual(parseHunks(file('x', hunk(50, 0, 2))).spans, [{ start: 50, end: 49 }]);
  assert.deepEqual(parseHunks({ filename: 'n', status: 'added', patch: '@@ -0,0 +1,2 @@\n+a\n+b' }).spans, [{ start: 1, end: 0 }]);
  assert.deepEqual(parseHunks({ filename: 'i', patch: '@@ -5,0 +6,1 @@\n+a' }).spans, [{ start: 6, end: 5 }]);
  assert.deepEqual(parseHunks({ filename: 'n', patch: '@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file' }).spans, [{ start: 1, end: 1 }]);
  assert.equal(parseHunks({ filename: 'bin' }).status, 'unknown');
  assert.equal(parseHunks({ filename: 'x', patch: '' }).status, 'unknown');
  assert.equal(parseHunks({ filename: 'x', patch: hunk(120, 3, 4).split('\n').slice(0, -2).join('\n') }).reason, 'patch truncated');
  assert.equal(parseHunks({ ...file('x', hunk(120, 3, 4)), additions: 9, deletions: 3 }).reason, 'patch truncated');
  assert.equal(parseHunks({ ...file('x', hunk(120, 3, 4)), additions: 4, deletions: 3 }).status, 'ok');
  assert.equal(parseHunks({ filename: 'x', patch: 'Binary files differ' }).reason, 'patch unparsable');
});

test('spans touch when no unchanged base line separates them', () => {
  assert.equal(spansTouch({ start: 1, end: 2 }, { start: 3, end: 4 }), true);
  assert.equal(spansTouch({ start: 1, end: 2 }, { start: 4, end: 5 }), false);
  assert.equal(spansTouch({ start: 3, end: 2 }, { start: 4, end: 5 }), false);
  assert.equal(spansTouch({ start: 3, end: 2 }, { start: 3, end: 4 }), true);
  assert.equal(spansTouch({ start: 3, end: 2 }, { start: 3, end: 2 }), true);
});

test('the Delivery four-PR cluster: one cluster, disjoint hunks are not a hard conflict, overlapping hunks are named', () => {
  const overlaps = annotate(pairs(delivery()));
  assert.equal(overlaps.length, 6);
  assert.deepEqual(clusters(overlaps).map(c => c.map(p => p.number).sort()), [[5523, 5553, 5562, 5563]]);
  const disjoint = pairOf(overlaps, 5563, 5553);
  assert.equal(disjoint.risk, 'same-path-disjoint-hunks');
  assert.equal(disjoint.paths[0].risk, 'same-path-disjoint-hunks');
  assert.deepEqual([disjoint.paths[0].hunks.a, disjoint.paths[0].hunks.b], [[{ start: 120, end: 122 }], [{ start: 300, end: 301 }]]);
  const clash = pairOf(overlaps, 5563, 5523);
  assert.equal(clash.risk, 'overlapping-hunks');
  assert.deepEqual(clash.paths[0].hunks.ranges, [{ a: { start: 120, end: 122 }, b: { start: 121, end: 125 } }]);
  assert.equal(pairOf(overlaps, 5553, 5523).risk, 'overlapping-hunks');
  assert.equal(pairOf(overlaps, 5562, 5563).risk, 'same-path-disjoint-hunks');
  const text = summary(overlaps);
  assert.match(text, /#5563 ↔ #5553: risk: same-path-disjoint-hunks; textual conflict: not checked/);
  assert.match(text, /hunks overlap: #5563 120-122 \/ #5523 121-125/);
  assert.match(text, /disjoint hunks: #5562 before 50/);
  assert.doesNotMatch(text, /textual conflict: yes/);
});

test('hunks that cannot be compared are unknown, never disjoint', () => {
  const a = file(DELIVERY, hunk(10, 1, 1)), b = file(DELIVERY, hunk(500, 1, 1));
  assert.equal(hunkRisk(a, { filename: DELIVERY }).class, 'unknown-hunks');
  assert.match(hunkRisk(a, { filename: DELIVERY }).reason, /^b: patch missing/);
  assert.equal(hunkRisk(a, b, { ok: false, reason: 'merge base not measured' }).class, 'unknown-hunks');
  const left = pr(1, [a]), right = pr(2, [b], { evidence: { baseAge: { mergeBase: OTHER } } });
  assert.deepEqual(comparableBases(left, right, DELIVERY, DELIVERY), { ok: false, reason: 'merge bases differ; base file not compared' });
  assert.deepEqual(comparableBases(left, right, DELIVERY, DELIVERY, (s) => s === BASE ? 'blob1' : 'blob2').reason, 'merge bases differ and the file changed between them');
  assert.equal(comparableBases(left, right, DELIVERY, DELIVERY, () => 'same').ok, true);
  assert.equal(comparableBases(left, pr(3, [], { evidence: {} }), DELIVERY, DELIVERY).reason, 'merge base not measured');
  assert.equal(annotate(pairs([left, right]))[0].risk, 'unknown-hunks');
  assert.equal(annotate(pairs([left, right]), { blobAt: () => 'same' })[0].risk, 'same-path-disjoint-hunks');
  assert.equal(annotate(pairs([left, pr(4, [{ filename: DELIVERY, status: 'modified' }])]))[0].risk, 'unknown-hunks');
});

test('dependency and critical paths outrank hunks; a pair takes its highest path', () => {
  const two = paths => annotate(pairs([pr(1, paths.map(p => file(p, hunk(10, 1, 1)))), pr(2, paths.map(p => file(p, hunk(500, 1, 1))))]))[0];
  assert.equal(two(['package.json']).risk, 'dependency');
  assert.equal(two(['package-lock.json']).paths[0].class, 'manifest');
  assert.equal(two(['frontend/src/lib/api/deals.js']).risk, 'dependency');
  for (const p of ['wrangler.toml', '.github/workflows/ci.yml', 'cloudflare-worker/src/middleware/csrf.ts', 'cloudflare-worker/src/auth.ts', 'cloudflare-worker/src/routes/auth_passkey.ts', 'frontend/public/_headers', '.gitleaks.toml']) assert.equal(two([p]).risk, 'critical', p);
  const mixed = two(['x.ts', 'package.json', 'wrangler.toml']);
  assert.equal(mixed.risk, 'critical');
  assert.deepEqual(mixed.paths.map(e => e.risk), ['dependency', 'critical', 'same-path-disjoint-hunks']);
  assert.equal(two(['cloudflare-worker/src/routes/admin.ts']).risk, 'same-path-disjoint-hunks');
  const m = 'cloudflare-worker/sql/migrations/202611120000_1_x.sql';
  assert.equal(criticalReason(m, 'migration', [{ patch: '@@ -1 +1 @@\n-x\n+ALTER TABLE users ADD COLUMN y TEXT;' }]), 'migration alters, drops or renames an existing table');
  assert.equal(criticalReason(m, 'migration', [{ patch: '@@ -0,0 +1 @@\n+CREATE TABLE z (id INTEGER);' }]), null);
  assert.match(criticalReason(m, 'migration', [{}]), /not ruled out/);
  assert.equal(criticalReason('docs/x.md', 'path', [{}]), null);
  const stamps = annotate(pairs([pr(1, [{ filename: 'cloudflare-worker/sql/migrations/202611112000_1_a.sql', status: 'added' }]), pr(2, [{ filename: 'cloudflare-worker/sql/migrations/202611112000_2_b.sql', status: 'added' }])]))[0];
  assert.equal(stamps.risk, 'dependency');
});

test('evidence (a): merge status from GitHub, unknown while not computed', () => {
  assert.equal(mergeStatus({ mergeable: false, mergeable_state: 'dirty' }).status, 'conflict');
  assert.equal(mergeStatus({ mergeable: true, mergeable_state: 'blocked' }).status, 'clean');
  assert.deepEqual(mergeStatus({ mergeable: null, mergeable_state: 'unknown' }), { status: 'unknown', mergeableState: 'unknown', reason: 'GitHub has not computed mergeability' });
  assert.equal(mergeStatus(undefined).status, 'unknown');
  assert.equal(mergeStatus({ mergeable: true, mergeable_state: '<x>' }).mergeableState, 'unknown');
});

test('evidence (b): required-check failure names, latest run per name, unknown when unreadable', () => {
  const required = requiredFromRules([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'scan' }, { context: 'worker (typecheck)' }, { context: 'landing gate' }] } }, { type: 'pull_request' }]);
  assert.deepEqual(required, ['landing gate', 'scan', 'worker (typecheck)']);
  assert.equal(requiredFromRules({ message: 'Not Found' }), null);
  const runs = [{ id: 1, name: 'scan', status: 'completed', conclusion: 'failure' }, { id: 2, name: 'scan', status: 'completed', conclusion: 'success' },
    { id: 3, name: 'worker (typecheck)', status: 'completed', conclusion: 'timed_out' }, { id: 4, name: 'advisory', status: 'completed', conclusion: 'failure' }];
  assert.deepEqual(requiredChecks(runs, required), { status: 'failed', failed: ['worker (typecheck)'], pending: [], missing: ['landing gate'] });
  assert.deepEqual(requiredChecks(runs.slice(0, 2), ['scan']).status, 'passing');
  assert.deepEqual(requiredChecks([{ id: 9, name: 'scan', status: 'in_progress', conclusion: null }], ['scan']).pending, ['scan']);
  assert.equal(requiredChecks(null, required).status, 'unknown');
  const noRules = requiredChecks(runs, null);
  assert.equal(noRules.status, 'unknown');
  assert.deepEqual(noRules.failedAny, ['advisory', 'worker (typecheck)']);
  assert.equal(requiredChecks(runs, []).status, 'none required');
});

test('evidence (c): CI queue delay is started_at - created_at, and not measured is null, never 0', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const q = queueDelay([{ created_at: '2026-11-13T11:00:00Z', started_at: '2026-11-13T11:12:00Z' }, { created_at: '2026-11-13T11:00:00Z', started_at: '2026-11-13T11:02:00Z' },
    { created_at: '2026-11-13T11:00:00Z', started_at: '2026-11-13T11:59:00Z', conclusion: 'skipped' }, { created_at: '2026-11-13T11:30:00Z', status: 'queued' }], now);
  assert.deepEqual(q, { status: 'measured', jobs: 2, maxMinutes: 12, p50Minutes: 2, stillQueued: 1, longestQueuedMinutes: 30 });
  assert.deepEqual(queueDelay(null, now), { status: 'not measured', reason: 'no CI run on this head', maxMinutes: null });
  assert.equal(queueDelay([{ created_at: 'x', started_at: 'y' }], now).maxMinutes, null);
  assert.equal(queueDelay([], now).status, 'not measured');
});

test('evidence (d): base age from compare, unknown when unreadable', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.deepEqual(baseAge({ behind_by: 14, merge_base_commit: { sha: BASE, commit: { committer: { date: '2026-11-12T00:00:00Z' } } } }, now),
    { status: 'measured', behindBy: 14, mergeBase: BASE, mergeBaseDate: '2026-11-12T00:00:00Z', ageHours: 36 });
  assert.deepEqual(baseAge({ behind_by: 0, merge_base_commit: { sha: BASE, commit: {} } }, now).ageHours, null);
  assert.deepEqual(baseAge(null, now), { status: 'unknown', reason: 'compare unreadable', behindBy: null, mergeBase: null });
  assert.equal(baseAge({ behind_by: 3, merge_base_commit: { sha: 'HEAD' } }, now).status, 'unknown');
});

test('dedupe keeps the first row per PR; stale needs two valid, different SHAs', () => {
  assert.deepEqual(dedupe([{ number: 2, x: 1 }, { number: 1 }, { number: 2, x: 2 }, { number: 'x' }]), [{ number: 2, x: 1 }, { number: 1 }]);
  assert.equal(isStale({ head: { sha: BASE } }, { head: { sha: OTHER } }), true);
  assert.equal(isStale({ head: { sha: BASE } }, { head: { sha: BASE } }), false);
  assert.equal(isStale({ head: {} }, { head: { sha: OTHER } }), false);
});

/** A read-only GitHub fixture: the Delivery cluster plus a duplicate, a vanished PR, a closed PR and a moved head. */
function fixtureApi() {
  const prs = delivery(), calls = [];
  const listed = [...prs, prs[0], pr(9001, [file(DELIVERY, hunk(120, 1, 1))]), pr(9002, [file(DELIVERY, hunk(120, 1, 1))]), pr(9003, [file(DELIVERY, hunk(120, 1, 1))])]
    .map(p => ({ number: p.number, head: p.head, base: p.base, draft: false }));
  const filesOf = Object.fromEntries([...prs, pr(9002, [file(DELIVERY, hunk(120, 1, 1))]), pr(9003, [file(DELIVERY, hunk(120, 1, 1))])].map(p => [p.number, p.files]));
  const api = async (method, path) => {
    calls.push(`${method} ${path}`);
    assert.equal(method, 'GET');
    if (path.startsWith('pulls?')) return listed;
    let m = /^pulls\/(\d+)\/files/.exec(path);
    if (m) { if (m[1] === '9001') throw Object.assign(new Error('gone'), { status: 404 }); return filesOf[m[1]]; }
    m = /^pulls\/(\d+)$/.exec(path);
    if (m) {
      const n = Number(m[1]);
      if (n === 9002) return { number: n, state: 'closed', head: { sha: sha(n) } };
      return { number: n, state: 'open', head: { sha: n === 9003 ? OTHER : sha(n) }, mergeable: n === 5523 ? false : n === 5563 ? true : null, mergeable_state: n === 5523 ? 'dirty' : 'unknown' };
    }
    if (path.startsWith('rules/branches/main')) return [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'landing gate' }, { context: 'scan|<b>' }] } }];
    m = /^commits\/(\w+)\/check-runs/.exec(path);
    if (m) return { check_runs: [{ id: 1, name: 'landing gate', status: 'completed', conclusion: m[1] === sha(5523) ? 'failure' : 'success' }, { id: 2, name: 'scan|<b>', status: 'completed', conclusion: m[1] === sha(5523) ? 'failure' : 'success' }] };
    if (path.startsWith('actions/runs?')) return path.includes(sha(5553)) ? { workflow_runs: [] } : { workflow_runs: [{ id: 7, path: '.github/workflows/ci.yml' }, { id: 8, path: '.github/workflows/other.yml' }] };
    if (path.startsWith('actions/runs/7/jobs')) return { jobs: [{ created_at: '2026-11-13T11:00:00Z', started_at: '2026-11-13T11:05:00Z' }] };
    if (path.startsWith('compare/main...')) return path.includes(sha(5562)) ? null : { behind_by: 4, merge_base_commit: { sha: BASE, commit: { committer: { date: '2026-11-13T00:00:00Z' } } } };
    throw new Error(`unexpected ${path}`);
  };
  return { api, calls };
}

test('the scan drops vanished and closed PRs, dedupes, marks a moved head stale and writes a dated snapshot', async () => {
  const { api, calls } = fixtureApi(), written = [], logs = [];
  const now = Date.parse('2026-11-13T12:00:00Z');
  const result = await report({ api, dryRun: true, now, log: l => logs.push(l), snapshotPath: 'snapshots/x.json', write: (p, body) => written.push([p, body]) });
  assert.deepEqual(result.notes, ['1 duplicate PR row(s) from pagination removed', '#9001 disappeared during the scan; dropped', '#9002 closed during the scan; dropped', '#9003 head changed during the scan; marked stale, not classified']);
  assert.deepEqual(result.prs.map(p => p.number), [5563, 5562, 5553, 5523, 9003]);
  assert.equal(calls.filter(c => c === 'GET pulls/5563/files?per_page=100&page=1').length, 1);
  assert.equal(result.overlaps.some(p => p.a.number === 9003 || p.b.number === 9003), false);
  assert.equal(calls.some(c => c.includes(sha(9003)) || c.includes(OTHER)), false);
  const byNumber = Object.fromEntries(result.prs.map(p => [p.number, p]));
  assert.equal(byNumber[5523].evidence.merge.status, 'conflict');
  assert.equal(byNumber[5563].evidence.merge.status, 'clean');
  assert.equal(byNumber[5553].evidence.merge.status, 'unknown');
  assert.deepEqual(byNumber[5523].evidence.checks.failed, ['landing gate', 'scan|<b>']);
  assert.equal(byNumber[5563].evidence.checks.status, 'passing');
  assert.equal(byNumber[5563].evidence.queue.maxMinutes, 5);
  assert.equal(byNumber[5553].evidence.queue.status, 'not measured');
  assert.equal(byNumber[5562].evidence.baseAge.status, 'unknown');
  assert.equal(byNumber[5563].evidence.baseAge.ageHours, 12);
  // #5562's merge base is unmeasured, so its pairs fall back to unknown hunks rather than disjoint.
  assert.equal(pairOf(result.overlaps, 5562, 5563).risk, 'unknown-hunks');
  assert.equal(pairOf(result.overlaps, 5563, 5553).risk, 'same-path-disjoint-hunks');
  assert.equal(pairOf(result.overlaps, 5563, 5523).risk, 'overlapping-hunks');
  assert.equal(written.length, 1);
  const snap = JSON.parse(written[0][1]);
  assert.equal(snap.generatedAt, '2026-11-13T12:00:00.000Z');
  assert.equal(snap.schema, 'studioos-pr-overlap-snapshot/v1');
  assert.deepEqual(snap.prs.map(p => [p.number, p.stale]), [[5523, false], [5553, false], [5562, false], [5563, false], [9003, true]]);
  assert.deepEqual(snap.prs.find(p => p.number === 9003).evidence.queue, { status: 'not measured', reason: 'not read', maxMinutes: null });
  assert.deepEqual(snap.prs[0].paths, [DELIVERY]);
  assert.deepEqual(Object.keys(snap.prs[0].evidence).sort(), ['baseAge', 'checks', 'merge', 'queue']);
  const clash = snap.pairs.find(p => p.a === 5563 && p.b === 5523);
  assert.deepEqual(clash.paths[0].hunks.ranges, [{ a: { start: 120, end: 122 }, b: { start: 121, end: 125 } }]);
  assert.equal(clash.textualConflict, 'not checked');
  const body = render(byNumber[5523], result.overlaps);
  assert.match(body, /^<!-- studioos-pr-overlap:v1 -->/);
  assert.match(body, /Evidence: #5523: merge vs base: conflict \(dirty\) · required checks: failed: landing gate, scan&#124;&lt;b&gt; · CI queue: max 5 min over 1 jobs · base: 4 commits behind, merge base 12 h old/);
  assert.doesNotMatch(body, /<b>/);
  assert.match(logs.join('\n'), /- #9003 head changed during the scan/);
  assert.match(evidenceText(byNumber[9003]), /stale/);
  assert.match(evidenceText(byNumber[5553]), /CI queue: not measured \(no CI run on this head\)/);
});

test('a non-404 read failure keeps the remaining PRs and reports partial; a 404 from gh carries its status', async () => {
  const api = async (method, path) => {
    if (path.startsWith('pulls?')) return [pr(1, []), pr(2, []), pr(3, [])].map(p => ({ number: p.number, head: p.head, base: p.base }));
    if (path.startsWith('pulls/2/files')) throw new Error('500');
    if (/^pulls\/\d+\/files/.test(path)) return [file('x.ts', hunk(10, 1, 1))];
    return {};
  };
  const result = await report({ api, log() {} });
  assert.equal(result.partial, true);
  assert.deepEqual(result.prs.map(p => p.number), [1, 2, 3]);
  const gh = makeApi('AxalNetwork/StudioOS', { exec: () => { throw Object.assign(new Error('x'), { stdout: 'HTTP/2.0 404 Not Found\n\n{}' }); } });
  await assert.rejects(gh('GET', 'pulls/1'), e => e.status === 404);
  await assert.rejects(main(['--snapshot=../$(x).json']), /usage/);
});

test('snapshot keeps unknown evidence explicit for a PR that was never read', () => {
  const s = snapshot({ generatedAt: 't', repo: 'r', prs: [{ number: 1, files: ['b', { filename: 'a', previous_filename: 'c' }] }], overlaps: [] });
  assert.deepEqual(s.prs[0].paths, ['a', 'b', 'c']);
  assert.equal(s.prs[0].headSha, null);
  assert.equal(s.prs[0].evidence.baseAge.behindBy, null);
  assert.equal(s.prs[0].evidence.checks.status, 'unknown');
});

test('the hourly workflow uploads the dated snapshot as a 30-day artifact with a pinned action', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../.github/workflows/pr-overlap.yml', import.meta.url), 'utf8');
  assert.match(source, /node scripts\/pr-overlap\.mjs "--snapshot=\$RUNNER_TEMP\/pr-overlap\/pr-overlap-\$stamp\.json"/);
  assert.match(source, /stamp="\$\(date -u \+%Y%m%dT%H%MZ\)"/);
  assert.match(source, /uses: actions\/upload-artifact@[a-f0-9]{40} # v7\.0\.2\n {8}with:\n {10}name: pr-overlap-snapshot-\$\{\{ env\.PR_OVERLAP_STAMP \}\}\n {10}path: \$\{\{ runner\.temp \}\}\/pr-overlap\/\n {10}retention-days: 30\n/);
  assert.doesNotMatch(source, /git (?:add|commit|push)/);
});

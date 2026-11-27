/**
 * D163 — HQ's own branch-targeting acts, in a store that is not the branch.
 *
 * WHAT WAS MISSING. Every HQ→branch push reports whether it LANDED and never
 * throws (the D111 rule, `licencePush.ts:13-19`). That report is per-call and
 * ephemeral: it reaches the operator in one response and nothing keeps it. HQ's
 * D1 records the transition; it does not record that the branch refused the
 * copy or that no Worker answered. So "which branch was unreachable, and which
 * of HQ's own acts against it failed while it was" had no store to answer it.
 *
 * WHY THE WRITE IS AT HQ'S CALL SITE AND NOT IN THE RPC HANDLER — the finding
 * the whole design turns on, and the first test pins it. `HqEntrypoint` is the
 * class HQ calls and it is EXPORTED BY THE BRANCH: it runs on the branch's own
 * `env`. A data point written inside those handlers is lost in exactly the case
 * this exists to survive. So the mirror is called from HQ's side, recording
 * what HQ OBSERVED rather than what the branch managed to say.
 *
 * THE ONE THAT WOULD HAVE CORRUPTED TWO LIVE REPORTS. The dataset is shared
 * (D105) and neither existing reader filtered by row kind, because until now
 * there was only one kind. Without the `blob1 LIKE '/%'` predicate a mirror row
 * appears in the technical report as an endpoint named `hq:branch_action` and
 * is counted into a branch's `hits` in the traffic split — both figures on a
 * live HQ screen. Those two assertions read the SQL off the WIRE rather than
 * out of the source, so a predicate that is written but not sent still fails.
 *
 * WHAT IS DELIBERATELY ABSENT, and asserted to be. No actor id, no email, no
 * free-text reason. HQ's own D1 holds the actor authoritatively and is always
 * readable; the mirror exists for the one dimension D1 cannot give. Identity in
 * a shared analytics store would add exposure and no information.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/audit_mirror_d163.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mirrorBranchAction, MIRROR_KIND } from '../src/services/auditMirror.ts';
import {
  loadBranchActionMirror, loadTrafficByBranch, loadTechnical, parseRange,
} from '../src/services/analyticsReports.ts';

const AE_CREDS = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_AE_API_TOKEN: 'unit-test-ae-token',
};

interface DataPoint { indexes?: unknown[]; blobs?: unknown[]; doubles?: unknown[] }

/** An env whose AE binding records rather than sends. */
function recordingEnv(extra: Record<string, unknown> = {}) {
  const points: DataPoint[] = [];
  const env: any = {
    ...extra,
    ANALYTICS: { writeDataPoint: (p: DataPoint) => { points.push(p); } },
  };
  return { env, points };
}

/**
 * Stub `fetch`, capturing the SQL text each call actually carried.
 *
 * The rows go back inside `{ data }`, which is the envelope `aeSql` unwraps —
 * a bare array reads as zero rows there, and a fixture shaped differently from
 * the thing it stands in for is how a test passes against its own mistake.
 */
function stubFetch(rows: unknown[]) {
  const real = globalThis.fetch;
  const sent: string[] = [];
  (globalThis as any).fetch = async (_url: any, init: any) => {
    sent.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  };
  return { sent, restore: () => { (globalThis as any).fetch = real; } };
}

const RANGE = parseRange(null, null, 30);

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The write shape
// ─────────────────────────────────────────────────────────────────────────────

test('the branch rides in blob6 — THE SAME SLOT the per-request row uses', () => {
  const { env, points } = recordingEnv();
  mirrorBranchAction(env, 'licence_pushed', 'ok', 'fr');

  assert.equal(points.length, 1);
  const p = points[0];
  // Pinned WHOLE rather than "contains", so moving the branch to a free slot
  // fails here instead of quietly teaching a future reader a second layout.
  assert.deepEqual(p.blobs, [MIRROR_KIND, 'licence_pushed', 'ok', '', '', 'fr']);
  assert.equal(p.blobs?.[5], 'fr', 'blob6 is the branch, as in observability.ts');
  assert.deepEqual(p.indexes, [MIRROR_KIND], 'a constant index: its own sampling bucket');
});

test('blob1 is the sentinel the two existing readers exclude on', () => {
  const { env, points } = recordingEnv();
  mirrorBranchAction(env, 'support_session_opened', 'failed', 'dach');
  // It must not start with "/" or the readers' `blob1 LIKE '/%'` would sweep
  // it back in — which is the whole mechanism keeping these rows out of them.
  assert.equal(points[0].blobs?.[0], MIRROR_KIND);
  assert.ok(!String(points[0].blobs?.[0]).startsWith('/'), 'the sentinel cannot look like a path');
});

test('all three outcomes are recorded distinctly, not collapsed to a boolean', () => {
  const { env, points } = recordingEnv();
  mirrorBranchAction(env, 'licence_pushed', 'ok', 'fr');
  mirrorBranchAction(env, 'licence_pushed', 'failed', 'fr');
  mirrorBranchAction(env, 'licence_pushed', 'not_deployed', 'fr');
  assert.deepEqual(points.map((p) => p.blobs?.[2]), ['ok', 'failed', 'not_deployed']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · What must never reach the store
// ─────────────────────────────────────────────────────────────────────────────

test('a malformed branch code is REFUSED, never escaped and never written', () => {
  const { env, points } = recordingEnv();
  // The AE SQL API takes text/plain and has no binding mechanism, so a value
  // that could carry a quote must not be storable in the first place.
  for (const bad of ["fr'; DROP", 'FR', '', 'a', 'x'.repeat(20), 'fr branch', null, undefined]) {
    mirrorBranchAction(env, 'licence_pushed', 'ok', bad as any);
  }
  assert.equal(points.length, 0, 'nothing malformed reaches the write');
});

test('no identity reaches the mirror — not an email, not an actor id', () => {
  const { env, points } = recordingEnv();
  mirrorBranchAction(env, 'account_moved_out', 'ok', 'fr');
  const written = JSON.stringify(points[0]);
  assert.ok(!written.includes('@'), 'no email-shaped value in any slot');
  // Doubles are where the per-request row keeps `user_id`; the mirror carries
  // none at all, and that is the point rather than an omission.
  assert.equal(points[0].doubles, undefined, 'no numeric identity slot is written');
});

test('the write never throws into the act it is recording', () => {
  const env: any = { ANALYTICS: { writeDataPoint: () => { throw new Error('token bucket'); } } };
  const realWarn = console.warn;
  const warned: string[] = [];
  console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };
  try {
    // A recorded act undone by its own telemetry would be worse than the gap
    // this closes — `observability.ts:131-134`'s rule, one file over.
    assert.doesNotThrow(() => mirrorBranchAction(env, 'licence_pushed', 'ok', 'fr'));
    assert.ok(warned.some((w) => w.includes('[auditMirror]')), 'it warns rather than failing silently');
  } finally { console.warn = realWarn; }
});

test('an env with no ANALYTICS binding is a no-op, not a crash', () => {
  assert.doesNotThrow(() => mirrorBranchAction({} as any, 'licence_pushed', 'ok', 'fr'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The guard that keeps mirror rows out of two live reports
// ─────────────────────────────────────────────────────────────────────────────

test('the traffic split EXCLUDES mirror rows, asserted on the wire', async () => {
  const f = stubFetch([]);
  try {
    await loadTrafficByBranch({ ...AE_CREDS } as any, RANGE);
    assert.equal(f.sent.length, 1);
    // Drop the predicate in analyticsReports.ts and this fails: a mirror row
    // would otherwise be counted into some branch's `hits`.
    assert.match(f.sent[0], /blob1 LIKE '\/%'/, 'the per-branch split counts HTTP rows only');
  } finally { f.restore(); }
});

test('the technical report EXCLUDES mirror rows, asserted on the wire', async () => {
  const f = stubFetch([]);
  try {
    await loadTechnical({ ...AE_CREDS, DB: null } as any, RANGE).catch(() => {});
    assert.ok(f.sent.length >= 1);
    // Without this the report grows an endpoint literally named
    // `hq:branch_action`, on a live HQ screen.
    assert.match(f.sent[0], /blob1 LIKE '\/%'/, 'the by-route report counts HTTP rows only');
  } finally { f.restore(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · The reader
// ─────────────────────────────────────────────────────────────────────────────

test('the mirror reader selects ONLY mirror rows', async () => {
  const f = stubFetch([]);
  try {
    await loadBranchActionMirror({ ...AE_CREDS } as any, RANGE);
    assert.match(f.sent[0], new RegExp(`blob1 = '${MIRROR_KIND}'`), 'it reads its own kind');
    assert.match(f.sent[0], /GROUP BY blob6, blob2, blob3/, 'grouped by branch, action and outcome');
  } finally { f.restore(); }
});

test('unreadable is NOT an empty list, and it carries a reason', async () => {
  // No credentials at all — `aeSql` returns null for this exactly as it does
  // for a non-OK response and a throw.
  const out = await loadBranchActionMirror({} as any, RANGE);
  assert.equal(out.available, false);
  assert.ok(out.reason && out.reason.length > 20, 'it says why rather than showing nothing');
  assert.ok(
    /not .*HQ has pushed nothing|could not be read/i.test(out.reason as string),
    'the reason distinguishes unreadable from empty',
  );
  assert.deepEqual(out.rows, []);
});

test('a populated read maps every column, and defaults the branch to hq', async () => {
  const f = stubFetch([
    { branch: 'fr', action: 'licence_pushed', outcome: 'failed', n: 3, last_at: '2026-09-18 10:00:00' },
    { branch: '', action: 'escalation_answered', outcome: 'ok', n: 1, last_at: null },
  ]);
  try {
    const out = await loadBranchActionMirror({ ...AE_CREDS } as any, RANGE);
    assert.equal(out.available, true);
    assert.equal(out.rows.length, 2);
    assert.deepEqual(out.rows[0], {
      branch: 'fr', action: 'licence_pushed', outcome: 'failed', count: 3, last_at: '2026-09-18 10:00:00',
    });
    assert.equal(out.rows[1].branch, 'hq', 'an unbranched row is HQ, matching the write-side default');
    assert.equal(out.rows[1].last_at, null);
  } finally { f.restore(); }
});

/**
 * D4663 (#4663) — the corrected Spin-Out Lab guarantees, through the real
 * routes and the service modules they now call, over the migrated schema
 * (node:sqlite). Every value is invented.
 *
 *   · a whole programme recorded through `POST /milestone`: after every step
 *     the milestone rows, the week, the credits, the credential, `/state` and
 *     the three public reports agree, with incorporation paid first (recorded,
 *     not graduation) and paid last;
 *   · two requests at once: the same step twice records and pays once; the two
 *     final steps together issue one credential and one bonus;
 *   · a lost grant or a lost credential is restored once by its recovery path,
 *     and a retried request records nothing twice;
 *   · a read that fails mid-request writes nothing, and the retry records once;
 *   · several projects: only the enrolled venture's work counts and only its
 *     name is published; an Explorer graduates, and keeps the credential and a
 *     readable `/state` after the Lab closes;
 *   · the public reports are bounded in SQL (statements and rows do not grow
 *     with the population) and answer what an independent reading of the same
 *     tables answers.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_services_4663.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { insertRow, proveMilestone, GRADUATION_KEYS } from './_lab_evidence.ts';
import { reportingWorld, meteredD1, worldNow } from './_lab_reporting_world.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';
import certificates from '../src/routes/spinout_certificates.ts';
import { isLabGraduate, weekMet } from '../src/services/spinoutLabCatalog.ts';
import { completeLabMilestone, reconcileLabProgress } from '../src/services/labProgress.ts';
import { graduationOf } from '../src/services/labGraduation.ts';
import { getLabState } from '../src/services/labLifecycle.ts';
import { GRADUATES_SHOWN, COHORT_ACTIVE_SHOWN, COHORT_GRADUATES_SHOWN } from '../src/services/labReporting.ts';
import { backfillCertificates } from '../src/services/certificateIssuance.ts';
import { getSQL } from '../src/db.ts';

afterAll(() => removeMigratedDatabases());
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG381 = readFileSync(new URL('../sql/migrations/381_credit_reward_rules.sql', import.meta.url), 'utf8');
const F = 701, X = 702;           // a founder and an Explorer
const VENTURE = 71, SIDE = 72;    // F's enrolled venture and an unrelated project of F's
const X_SIDE = 73, X_VENTURE = 74;
const STARTED = '2026-09-01 05:00:00';

function world(): DatabaseSync {
  const db = migratedDatabase();
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_week, spinout_lab_started_at)
                        VALUES (?, ?, 'Synthetic Founder', ?, 1, ?, 1, 1, ?)`);
  u.run(F, 'founder', `u${F}@example.test`, F, STARTED);
  u.run(X, 'exploring', `u${X}@example.test`, X, STARTED);
  // The venture is F's lowest id, so the evidence helper writes to it; the side project is newer.
  insertRow(db, 'projects', { id: VENTURE, uid: 'p-venture', founder_id: F, name: 'Lab Venture', status: 'active', sector: 'health' });
  insertRow(db, 'projects', { id: SIDE, uid: 'p-side', founder_id: F, name: 'Old Side Project', status: 'active', total_funding: 900_000 });
  insertRow(db, 'projects', { id: X_SIDE, uid: 'p-x-side', founder_id: X, name: 'Explorer Side', status: 'active' });
  insertRow(db, 'projects', { id: X_VENTURE, uid: 'p-x-venture', founder_id: X, name: 'Explorer Venture', status: 'active' });
  db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind, project_id) VALUES (?, 'legacy', ?)`).run(F, VENTURE);
  db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind) VALUES (?, 'legacy')`).run(X);
  // Admitted members: D541 pays credits only to them.
  for (const id of [F, X]) db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, 'Synthetic Cohort')`).run(id);
  for (const st of MIG381.split(/;\s*\n/).filter((x) => /INSERT/i.test(x))) db.exec(st);
  return db;
}

const envOf = (db: DatabaseSync, DB: any = d1Over(db)) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB }) as any;
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; }
};
async function call(db: DatabaseSync, method: string, path: string, who?: number, body?: unknown, DB?: any, router: any = spinoutLab) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await quiet(() => router.request(path, init, envOf(db, DB)));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const step = (db: DatabaseSync, who: number, key: string, DB?: any) => call(db, 'POST', '/milestone', who, { milestone_key: key }, DB);

const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as never[])) as any[]).map((r) => ({ ...r }));
const one = (db: DatabaseSync, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as never[])) as any; return r ? { ...r } : null; };
const recorded = (db: DatabaseSync, who: number) => new Set(all(db, 'SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ?', who).map((r) => r.milestone_key as string));
const grants = (db: DatabaseSync, who: number) => all(db, `SELECT source_ref FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' ORDER BY id`, who).map((r) => r.source_ref as string);
const issued = (db: DatabaseSync, who: number) => all(db, `SELECT project_id, public_company FROM spinout_certificates WHERE user_id = ? AND status = 'issued'`, who);
/** The steps that pay a credit (migration 381's `lab:` rules). */
const RULED = (() => {
  const db = world();
  try { return new Set(all(db, `SELECT key FROM credit_reward_rules WHERE substr(key, 1, 4) = 'lab:' AND active = 1 AND credits > 0`).map((r) => String(r.key).slice(4))); }
  finally { db.close(); }
})();

/** The week the catalog says a founder with `done` is in: each met week opens the next, up to 4. */
const catalogWeek = (done: Set<string>) => { let w = 1; while (w < 4 && weekMet(w, done)) w += 1; return w; };

/**
 * Every store and reader agrees about `who`. Returns whether they graduated.
 * Mutation checked (D4663), each failing this file: the credit paid on a replay; no week-4
 * close; `graduationOf` reading "graduated" with no row; the reports joining projects by
 * founder; the cohort's graduate column uncapped; an unreadable evidence read answered 409.
 */
async function agree(db: DatabaseSync, who: number, venture: string, side: string) {
  const done = recorded(db, who);
  const rule = isLabGraduate(done);
  const u = one(db, 'SELECT spinout_lab_active AS active, spinout_lab_week AS week, is_incorporated AS inc FROM users WHERE id = ?', who);
  // Week and close: the catalog's walk over the recorded rows; the Lab closes exactly when week 4 is met.
  assert.equal(u.week, catalogWeek(done), `week for ${[...done]}`);
  const closed = catalogWeek(done) === 4 && weekMet(4, done);
  assert.deepEqual([u.active, u.inc], closed ? [0, 1] : [1, 0], 'the Lab closes when, and only when, week 4 is met');
  // Evidence: every row was proved by the venture's work or the person's own, never another project.
  for (const r of all(db, 'SELECT evidence_project_id AS p FROM spinout_lab_milestones WHERE user_id = ?', who)) {
    assert.ok(r.p === null || r.p === (who === F ? VENTURE : X_VENTURE), `evidence from project ${r.p}`);
  }
  // Credits: one grant per recorded step that pays, plus the bonus once graduated; never twice.
  const g = grants(db, who);
  assert.equal(new Set(g).size, g.length, 'no grant paid twice');
  const expected = [...done].filter((k) => RULED.has(k)).map((k) => `lab:${who}:${k}`);
  if (rule) expected.push(`lab:${who}:graduation`);
  assert.deepEqual(new Set(g), new Set(expected), 'the grants follow the recorded steps and graduation');
  // Credential and graduation: the rule, the view, the service and /state agree.
  assert.equal((await graduationOf(envOf(db), who)).by_rule, rule);
  assert.deepEqual(issued(db, who), rule ? [{ project_id: who === F ? VENTURE : X_VENTURE, public_company: venture }] : []);
  const state = await call(db, 'GET', '/state', who);
  assert.equal(state.status, 200);
  assert.equal(state.body.graduated, rule, '/state says what the rule says');
  assert.equal(state.body.active, !closed);
  // The public reports: the venture, never the side project, and only once graduated.
  const grads = (await call(db, 'GET', '/graduates')).body.map((c: any) => c.name);
  assert.deepEqual(grads, rule ? [venture] : []);
  assert.deepEqual((await call(db, 'GET', '/stats')).body.companies, rule ? 1 : 0);
  const board = (await call(db, 'GET', '/cohort')).body.map((m: any) => [m.name, m.status]);
  assert.ok(!board.some(([n]: [string]) => n === side), 'an unrelated project is never published');
  if (!closed) assert.deepEqual(board.filter(([n]: [string]) => n === venture), [[venture, 'active']]);
  return rule;
}

const ORDERED = [...GRADUATION_KEYS.filter((k) => k !== 'incorporation_completed'), 'incorporation_completed'];
for (const [label, order] of [
  ['incorporation paid last', ORDERED],
  ['incorporation paid before weeks 1-3', ['incorporation_completed', ...ORDERED.slice(0, -1)]],
] as const) {
  test(`#4663 a whole programme through POST /milestone, ${label}: every store and reader agrees after every step`, async () => {
    const db = world();
    try {
      let graduatedAt = -1;
      for (const [i, key] of order.entries()) {
        proveMilestone(db, F, key);
        const r = await step(db, F, key);
        assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.body)}`);
        if ((await agree(db, F, 'Lab Venture', 'Old Side Project')) && graduatedAt < 0) graduatedAt = i;
      }
      assert.equal(graduatedAt, order.length - 1, 'graduation is the last required step, never incorporation alone');
      // The founder keeps a readable /state and the credential after the Lab closes.
      const mine = await call(db, 'GET', '/certificates/mine', F, undefined, undefined, certificates);
      assert.equal(mine.body.certificate?.status, 'issued');
    } finally { db.close(); }
  });
}

test('#4663 two requests at once: one step records and pays once; the last two steps issue one credential and one bonus', async () => {
  const db = world();
  try {
    proveMilestone(db, F, 'okrs_created');
    const twice = await Promise.all([step(db, F, 'okrs_created'), step(db, F, 'okrs_created')]);
    assert.deepEqual(twice.map((r) => r.status), [200, 200]);
    assert.deepEqual(grants(db, F), [`lab:${F}:okrs_created`]);
    assert.equal(all(db, `SELECT 1 FROM spinout_lab_milestones WHERE user_id = ? AND milestone_key = 'okrs_created'`, F).length, 1);
    // Everything but the last two required steps, then both at once.
    for (const k of ORDERED.slice(0, -2)) { proveMilestone(db, F, k); assert.equal((await step(db, F, k)).status, 200, k); }
    const [a, b] = ORDERED.slice(-2);
    proveMilestone(db, F, a); proveMilestone(db, F, b);
    const both = await Promise.all([step(db, F, a), step(db, F, b)]);
    assert.deepEqual(both.map((r) => r.status), [200, 200]);
    assert.equal(await agree(db, F, 'Lab Venture', 'Old Side Project'), true);
    assert.equal(grants(db, F).filter((g) => g.endsWith(':graduation')).length, 1);
  } finally { db.close(); }
});

test('#4663 recovery: a retried step records nothing twice; a lost grant and a lost credential are each restored once', async () => {
  const db = world();
  try {
    proveMilestone(db, F, 'pitch_deck_drafted');
    assert.equal((await step(db, F, 'pitch_deck_drafted')).status, 200);
    // The isolate died after the insert: the grant never landed. A retried request does not pay it
    // (its insert recorded nothing); the reconciler does, once.
    db.prepare('DELETE FROM perk_credit_ledger WHERE user_id = ?').run(F);
    assert.equal((await step(db, F, 'pitch_deck_drafted')).status, 200);
    assert.deepEqual(grants(db, F), []);
    assert.equal((await quiet(() => reconcileLabProgress(envOf(db), F))).credited, 1);
    assert.equal((await quiet(() => reconcileLabProgress(envOf(db), F))).credited, 0);
    assert.deepEqual(grants(db, F), [`lab:${F}:pitch_deck_drafted`]);
    // Graduate; then lose the credential and its bonus, as an interrupted final request would.
    for (const k of ORDERED) { proveMilestone(db, F, k); assert.equal((await step(db, F, k)).status, 200, k); }
    db.prepare('DELETE FROM spinout_certificates WHERE user_id = ?').run(F);
    db.prepare(`DELETE FROM perk_credit_ledger WHERE user_id = ? AND source_ref = ?`).run(F, `lab:${F}:graduation`);
    assert.equal((await graduationOf(envOf(db), F)).by_rule, true, 'still a graduate by the rule');
    const first = await quiet(() => backfillCertificates(envOf(db), 10));
    const again = await quiet(() => backfillCertificates(envOf(db), 10));
    assert.deepEqual([first.issued, again.issued], [1, 0]);
    assert.equal(await agree(db, F, 'Lab Venture', 'Old Side Project'), true);
  } finally { db.close(); }
});

test('#4663 a read that fails mid-request writes nothing; the retry records once', async () => {
  const db = world();
  try {
    proveMilestone(db, F, 'okrs_created');
    const real = d1Over(db);
    // The evidence check's read of the venture's OKRs fails, as D1 does when it is unavailable.
    const down = { ...real, prepare: (sql: string) => { if (/FROM roadmap_okrs/.test(sql)) throw new Error('D1_ERROR: unavailable'); return real.prepare(sql); } };
    const r = await step(db, F, 'okrs_created', down);
    assert.deepEqual([r.status, r.body.code, r.body.retryable], [503, 'lab_evidence_unavailable', true]);
    assert.deepEqual([...recorded(db, F)], []);
    assert.deepEqual(grants(db, F), []);
    assert.equal(one(db, 'SELECT spinout_lab_week AS w FROM users WHERE id = ?', F).w, 1);
    assert.equal((await step(db, F, 'okrs_created')).status, 200);
    assert.equal((await step(db, F, 'okrs_created')).status, 200);
    assert.deepEqual([...recorded(db, F)], ['okrs_created']);
    assert.deepEqual(grants(db, F), [`lab:${F}:okrs_created`]);
  } finally { db.close(); }
});

test('#4663 an Explorer with two projects names the venture, graduates, and keeps the credential after the Lab closes', async () => {
  const db = world();
  try {
    // Work saved on the side project (the Explorer's lowest id, where the helper writes) proves nothing.
    proveMilestone(db, X, 'okrs_created');
    const asked = await step(db, X, 'okrs_created');
    assert.deepEqual([asked.status, asked.body.code], [409, 'lab_venture_choice_needed']);
    assert.equal((await call(db, 'POST', '/venture', X, { project_id: X_VENTURE })).status, 200);
    // Move the helper's target to the venture: the side project is retired from the helper's view only.
    db.prepare('UPDATE projects SET founder_id = -1 WHERE id = ?').run(X_SIDE);
    for (const k of ORDERED) { proveMilestone(db, X, k); assert.equal((await step(db, X, k)).status, 200, k); }
    db.prepare('UPDATE projects SET founder_id = ? WHERE id = ?').run(X, X_SIDE);
    assert.equal(await agree(db, X, 'Explorer Venture', 'Explorer Side'), true);
    // After the close: the Lab refuses new steps, and the graduate's own reads still answer.
    const late = await step(db, X, 'office_hours_booked');
    assert.equal(late.status, 409);
    const state = await call(db, 'GET', '/state', X);
    assert.deepEqual([state.status, state.body.graduated, state.body.active], [200, true, false]);
    const mine = await call(db, 'GET', '/certificates/mine', X, undefined, undefined, certificates);
    assert.deepEqual([mine.status, mine.body.certificate?.status], [200, 'issued']);
  } finally { db.close(); }
});

test('#4663 the services answer the route\'s outcome directly', async () => {
  const db = world();
  try {
    const env = envOf(db);
    assert.deepEqual((await quiet(() => completeLabMilestone(env, F, 'not_a_step'))).status, 400);
    assert.deepEqual((await quiet(() => completeLabMilestone(env, F, 42))).status, 400, 'a non-string key is no key');
    const unpaid = await quiet(() => completeLabMilestone(env, F, 'incorporation_completed'));
    assert.deepEqual([unpaid.status, unpaid.body.error], [409, 'incorporation_not_paid']);
    const sql = getSQL(env);
    try { assert.equal((await getLabState(sql as any, F)).week, 1); } finally { await sql.end(); }
    assert.deepEqual(await graduationOf(env, F), { graduated: false, by_rule: false, graduated_at: null });
    // A credential issued before the D4659 rule: a graduate, not by the rule (it issues nothing new).
    // Mutation checked: `by_rule` read as true for any row → this fails.
    insertRow(db, 'spinout_certificates', { credential_id: 'AXL-T-4663-X', user_id: X, status: 'issued', public_name: 'S', public_issued_on: '2026-10-01' });
    assert.deepEqual(await graduationOf(env, X), { graduated: true, by_rule: false, graduated_at: '2026-10-01' });
  } finally { db.close(); }
});

// ── The public reports ─────────────────────────────────────────────────────

/** An independent reading of the same tables, row by row, with the D4659 venture as each founder's company. */
function oracle(db: DatabaseSync) {
  const venture = (uid: number) => one(db, `SELECT p.* FROM spinout_lab_enrollments e JOIN projects p ON p.id = e.project_id AND p.deleted_at IS NULL
                                            WHERE e.id = (SELECT MAX(id) FROM spinout_lab_enrollments WHERE user_id = ?)`, uid);
  const appName = (uid: number) => one(db, 'SELECT company_name FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1', uid)?.company_name ?? null;
  const nameOf = (uid: number) => venture(uid)?.name || appName(uid) || null;
  const cohortOf = (uid: number) => one(db, 'SELECT spinout_lab_cohort AS c FROM user_spinout_flags WHERE user_id = ?', uid)?.c ?? null;
  const grads = all(db, 'SELECT user_id, graduated_at FROM spinout_lab_graduates')
    .sort((a, b) => b.graduated_at.localeCompare(a.graduated_at) || a.user_id - b.user_id);
  const cards = grads.filter((g) => nameOf(g.user_id)).slice(0, GRADUATES_SHOWN).map((g) => {
    const p = venture(g.user_id);
    return {
      name: nameOf(g.user_id), sector: p?.sector ?? null, stage: p?.stage ?? null, cohort: cohortOf(g.user_id),
      uid: p?.uid && !['archived', 'rejected', 'intake'].includes(String(p.status).toLowerCase()) ? p.uid : null,
      graduated_at: g.graduated_at, raised: p?.total_funding ?? null, last_round: p?.last_funding_round ?? null,
    };
  });
  const raised = grads.reduce((s, g) => s + Math.max(0, Number(venture(g.user_id)?.total_funding ?? 0)), 0);
  const active = all(db, 'SELECT id, spinout_lab_week AS week, spinout_lab_started_at AS started_at FROM users WHERE spinout_lab_active = 1')
    .sort((a, b) => String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')) || a.id - b.id)
    .filter((u) => nameOf(u.id)).slice(0, COHORT_ACTIVE_SHOWN);
  const shown = new Set(active.map((u) => u.id));
  const recent = grads.filter((g) => one(db, `SELECT datetime(?) >= datetime('now', '-45 days') AS ok`, g.graduated_at).ok === 1)
    .filter((g) => !shown.has(g.user_id) && nameOf(g.user_id)).slice(0, COHORT_GRADUATES_SHOWN);
  return {
    cards,
    stats: { companies: grads.length, total_raised: raised > 0 ? raised : null },
    board: [...active.map((u) => [nameOf(u.id), 'active', Math.max(1, Math.min(4, Number(u.week) || 1))]),
      ...recent.map((g) => [nameOf(g.user_id), 'graduated', 5])],
  };
}

test('#4663 the public reports answer what an independent reading of the tables answers', async () => {
  const db = migratedDatabase();
  try {
    reportingWorld(db, { graduates: 60, active: 40 }, worldNow());
    const want = oracle(db);
    // Mutation checked: the name filter dropped from SQL → the cards differ; the reports joining
    // projects by founder → the board names side projects and /stats adds their funding.
    assert.deepEqual((await call(db, 'GET', '/graduates')).body, want.cards);
    assert.deepEqual((await call(db, 'GET', '/stats')).body, want.stats);
    const board = (await call(db, 'GET', '/cohort')).body.map((m: any) => [m.name, m.status, m.week]);
    assert.deepEqual(board, want.board);
    assert.ok(!board.some(([n]: [string]) => / Side /.test(n)), 'never a project other than the venture');
    assert.ok(board.some(([n, st]: [string, string]) => st === 'active' && /^Active Co \d+$/.test(n)), 'the venture, not the founder\'s lowest-id project');
    assert.equal(want.board.filter(([, s]) => s === 'graduated').length, COHORT_GRADUATES_SHOWN, 'the fixture fills the graduate column');
  } finally { db.close(); }
});

test('#4663 the public reports are bounded in SQL: statements and rows do not grow with the population', async () => {
  const cost: Record<string, Array<{ statements: number; rows: number }>> = {};
  for (const size of [{ graduates: 30, active: 10 }, { graduates: 400, active: 150 }]) {
    const db = migratedDatabase();
    try {
      reportingWorld(db, size, worldNow());
      const m = meteredD1(db);
      for (const path of ['/graduates', '/stats', '/cohort']) {
        m.reset();
        assert.equal((await call(db, 'GET', path, undefined, undefined, m.DB)).status, 200);
        (cost[path] ??= []).push({ statements: m.stats.statements, rows: m.stats.rows });
      }
    } finally { db.close(); }
  }
  // Mutation checked: the graduates read bound to no real limit → 400 rows come back at the larger size.
  assert.deepEqual(cost['/graduates'], [{ statements: 1, rows: GRADUATES_SHOWN }, { statements: 1, rows: GRADUATES_SHOWN }]);
  assert.deepEqual(cost['/stats'], [{ statements: 1, rows: 1 }, { statements: 1, rows: 1 }]);
  for (const c of cost['/cohort']) {
    assert.equal(c.statements, 2);
    assert.ok(c.rows <= COHORT_ACTIVE_SHOWN + COHORT_GRADUATES_SHOWN + COHORT_ACTIVE_SHOWN, `cohort rows ${c.rows}`);
  }
  assert.ok(cost['/cohort'][1].rows <= cost['/cohort'][0].rows + COHORT_ACTIVE_SHOWN, 'a larger population costs at most one page more');
});

test('#4663 a graduate\'s unrelated project never adds to the money raised', async () => {
  const db = world();
  try {
    for (const k of ORDERED) { proveMilestone(db, F, k); await step(db, F, k); }
    db.prepare('UPDATE projects SET total_funding = 250000 WHERE id = ?').run(VENTURE);
    // SIDE carries 900,000: a founder join would report 1,150,000.
    assert.deepEqual((await call(db, 'GET', '/stats')).body, { companies: 1, total_raised: 250000 });
  } finally { db.close(); }
});


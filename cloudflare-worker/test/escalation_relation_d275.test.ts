/**
 * D275 — a content escalation that names an item records what it is TO that
 * item: `localises` or `changes` (migration 296).
 *
 * The coordinator's decision, quoted rather than re-decided: "A content
 * escalation that names an item records an explicit relation, `localises` or
 * `changes`, and the relation is required whenever an item is picked."
 *
 * WHAT THIS FILE HOLDS, each a way the relation goes quietly wrong:
 *
 *   1. EVERY REFUSAL SENDS NOTHING AND STORES NOTHING. A pick with no relation,
 *      a value outside the two, a relation with no pick, a relation on another
 *      kind — each is a 400 from the branch before HQ is called, and the lane
 *      holds no row. A relation tucked inside `concerns` is not a relation.
 *   2. ONE RELATION, BOTH TIERS, EVERY READER. A `localises` pick is stored on
 *      the branch and at HQ, and read back by HQ's list, HQ's board and the
 *      branch lane — the four column lists moved together.
 *   3. THE BOARD PARTITIONS ONE READ. Localisation is `localises`; Brand
 *      approval is `changes` plus every row with no relation, where a legacy
 *      row (a label, no relation) is never counted as a localisation. One
 *      statement, not two; past the ceiling, neither lane has a count.
 *   4. HQ VALIDATES THE VALUE AND NEVER THROWS FOR IT. An unknown value, a
 *      relation with no item, a relation on another kind: a refusal object and
 *      no row. A NULL relation beside a label is accepted and recorded as not
 *      recorded — what a branch built before 296 sends.
 *   5. EVERY HQ REFUSAL IS A REFUSAL. A code the branch does not know reaches
 *      the branch as a 400 with no row; on a retry it leaves the row
 *      undelivered with HQ's reason. And the retry re-sends the stored relation.
 *
 * Fixtures are D208's and D243's, widened to apply migration 296 — every table
 * off disk, so a fixture narrower than the schema (the D133 trap) cannot make
 * an INSERT naming `relation` fail and pass for a refusal.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_relation_d275.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import branchEscalationRoutes from '../src/routes/branch_escalations.ts';
import adminEscalations from '../src/routes/admin_escalations.ts';
import content from '../src/routes/admin_content.ts';
import { recordEscalation, OPEN_ESCALATION_CEILING } from '../src/rpc/hqOps.ts';
import { CONCERN_RELATIONS, parseRelation } from '../src/services/escalationConcerns.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (name: string) => read(`cloudflare-worker/sql/migrations/${name}.sql`);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;
const PUSHED = '2026-09-20T00:00:00Z';
const TEMPLATE_LABEL = 'HQ template · Licence agreement · v4 · licence-agreement';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/** A D1 over `node:sqlite`, recording every statement it was asked to run. */
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const reads: string[] = [];
  return {
    reads,
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { reads.push(sql); return db.prepare(sql).get(...b) ?? null; },
        async all() { reads.push(sql); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          reads.push(sql);
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}
const run = (db: InstanceType<typeof DatabaseSync>, sql: string) => {
  for (const st of splitStatements(sql)) db.exec(st);
};

/* ------------------------------------------------------------------ *
 * Fixtures — D208's branch and HQ, D243's delivery, all with 296      *
 * ------------------------------------------------------------------ */

function branchDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(ADMIN, 'admin', 'Claire Dubois', 'claire@fr.example');
  for (const m of ['256_branch_local_copies', '257_branch_licence_ref', '265_branch_licence_entity', '284_branch_licence_kind']) {
    run(db, migration(m));
  }
  db.prepare(
    `INSERT INTO branch_licence (id, licence_uid, licence_ref, status, kind, pushed_at)
     VALUES (1, 'lic_fr', 'AXL-001', 'active', 'subsidiary', ?)`,
  ).run(PUSHED);
  for (const m of ['259_hq_escalations', '261_branch_escalations', '288_escalation_delivery', '296_escalation_relation', '268_branch_templates']) {
    run(db, migration(m));
  }
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'articles')));
  db.prepare(
    'INSERT INTO branch_templates (slug, title, category, version, pushed_at, updated_at) VALUES (?,?,?,?,?,?)',
  ).run('licence-agreement', 'Licence agreement', 'gp', 4, PUSHED, PUSHED);
  db.prepare('INSERT INTO articles (id, slug, title, author_user_id) VALUES (?,?,?,?)')
    .run(7, 'launch-post', 'Launch post', ADMIN);
  return db;
}
const lane = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM branch_escalations ORDER BY id').all() as any[];

/** HQ: the licence ledger, the registry, 259/261/279/288/296, and a super admin to read with. */
function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'super_admins', 'territory_licences']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  for (const m of ['258_licence_deployments', '259_hq_escalations', '261_branch_escalations', '267_hq_escalation_sla_claim', '279_licence_kind', '288_escalation_delivery', '296_escalation_relation']) {
    run(db, migration(m));
  }
  db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)').run(ADMIN, 'sue@axal.example', 'admin', 'Sue Hart');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, kind)
     VALUES (1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'active', 'subsidiary')`,
  ).run();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES ('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'live')`,
  ).run();
  return db;
}
const hqRows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM hq_escalations ORDER BY id').all() as any[];

/** A stub HQ that records each call and answers what `answer` returns. */
function stubHq(answer: (n: number, item: any) => any = (n) => ({ uid: `esc_${n}`, due_at: '2026-09-25T00:00:00Z', status: 'open' })) {
  const seen: Array<{ code: string; item: any }> = [];
  return {
    seen,
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        return answer(seen.length, item);
      },
    },
  };
}
/** HQ for real: the binding hands the item to `recordEscalation` over HQ's database. */
function realHq(hq: InstanceType<typeof DatabaseSync>) {
  const seen: Array<{ code: string; item: any }> = [];
  const env = { DB: makeD1(hq) } as any;
  return {
    seen,
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        return recordEscalation(env, code, item);
      },
    },
  };
}

async function bearer() {
  return new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
function appFor(routes: any, prefix: string, env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.route(prefix, routes);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  return async (path: string, init: RequestInit = {}) => {
    const res = await app.request(`${prefix}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await bearer()}` },
    }, env);
    const text = await res.text();
    let body: any = {};
    try { body = JSON.parse(text); } catch { /* the status says it */ }
    return { status: res.status, body, text };
  };
}
const BRANCH = { JWT_SECRET, BRANCH_CODE: 'fr' };
const branchApp = (env: Record<string, unknown>) => appFor(branchEscalationRoutes, '/api/branch', { ...BRANCH, ...env });
const raise = (kind: string, subject: string, extra: Record<string, unknown> = {}) =>
  ({ method: 'POST', body: JSON.stringify({ kind, subject, ...extra }) });
const PICK = { type: 'template', id: 'licence-agreement' };

/** HQ's content summary, the way its page reads it. */
async function board(db: InstanceType<typeof DatabaseSync>) {
  const d1 = makeD1(db);
  const res = await content.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${await bearer()}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1 } as any,
  );
  const body = await res.json() as any;
  const laneOf = (key: string) => body.board.lanes.find((l: any) => l.key === key);
  return { status: res.status, body, laneOf, reads: d1.reads };
}

/* ------------------------------------------------------------------ *
 * 0 · the column                                                      *
 * ------------------------------------------------------------------ */

test('D275: migration 296 closes the vocabulary on both tables — two values or NULL, enforced', () => {
  const db = hqDb();
  const ins = (table: string, v: unknown) => {
    try {
      if (table === 'hq_escalations') {
        db.prepare(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, relation) VALUES (?, 'fr', 'content', 's', ?)`)
          .run(`u-${Math.random()}`, v as any);
      } else {
        db.prepare(`INSERT INTO branch_escalations (kind, subject, status, relation, created_at, updated_at) VALUES ('content', 's', 'open', ?, 'x', 'x')`)
          .run(v as any);
      }
      return 'accepted';
    } catch (e) { return String((e as Error).message); }
  };
  for (const table of ['hq_escalations', 'branch_escalations']) {
    for (const v of [...CONCERN_RELATIONS, null]) assert.equal(ins(table, v), 'accepted', `${table} refused ${v}`);
    for (const v of ['translates', '', 'Localises']) {
      assert.match(ins(table, v), /CHECK constraint failed/, `${table} stored ${JSON.stringify(v)}`);
    }
  }
  assert.deepEqual([...CONCERN_RELATIONS], ['localises', 'changes']);
  assert.equal(parseRelation(undefined), undefined);
  assert.equal(parseRelation(null), undefined);
  assert.equal(parseRelation(' Localises '), 'localises');
  assert.equal(parseRelation(''), null, 'an empty string is a value sent, and it is not one of the two');
});

/* ------------------------------------------------------------------ *
 * 1 · every branch refusal sends nothing and stores nothing           *
 * ------------------------------------------------------------------ */

test('D275: each branch refusal is a 400 that sends nothing to HQ and writes no row', async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['an item picked with no relation', { concerns: PICK }, 'relation_required'],
    // THE RELATION IS A SIBLING OF `concerns`, NEVER INSIDE IT. One tucked into
    // the pick is not read as a relation, so this is still "none given".
    ['a relation inside concerns', { concerns: { ...PICK, relation: 'localises' } }, 'relation_required'],
    ['a relation outside the two', { concerns: PICK, relation: 'translates' }, 'bad_relation'],
    ['an empty relation', { concerns: PICK, relation: '' }, 'bad_relation'],
    ['a relation with no item picked', { relation: 'localises' }, 'relation_needs_item'],
  ];
  for (const [what, extra, code] of cases) {
    const db = branchDb();
    const hq = stubHq();
    const r = await branchApp({ DB: makeD1(db), HQ: hq.HQ })('/escalations', raise('content', 'x', extra));
    assert.equal(r.status, 400, `${what}: ${r.text}`);
    assert.equal(r.body.error, code, what);
    assert.ok(String(r.body.message).length > 20, `${what}: the refusal does not say what to do`);
    assert.equal(hq.seen.length, 0, `${what}: HQ was called`);
    assert.equal(lane(db).length, 0, `${what}: a row was written`);
  }
  for (const kind of ['other', 'moderation', 'seat_increase']) {
    const db = branchDb();
    const hq = stubHq();
    const r = await branchApp({ DB: makeD1(db), HQ: hq.HQ })('/escalations', raise(kind, 'x', { relation: 'changes' }));
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, 'relation_not_for_kind');
    assert.equal(hq.seen.length, 0);
    assert.equal(lane(db).length, 0);
  }
});

/* ------------------------------------------------------------------ *
 * 2 · one relation, both tiers, every reader                          *
 * ------------------------------------------------------------------ */

test('D275: a localises pick is stored on both tiers and read back by HQ\'s list, HQ\'s board and the branch lane', async () => {
  const bdb = branchDb();
  const hdb = hqDb();
  const hq = realHq(hdb);
  const call = branchApp({ DB: makeD1(bdb), HQ: hq.HQ });
  const r = await call('/escalations', raise('content', 'French version of the licence agreement', {
    concerns: PICK, relation: 'localises',
  }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.relation, 'localises');
  assert.equal(r.body.subject_ref, TEMPLATE_LABEL);
  // SENT BESIDE THE PICK: HQ receives `relation`, and no `concerns` at all.
  assert.equal(hq.seen[0].item.relation, 'localises');
  assert.ok(!('concerns' in hq.seen[0].item), 'the pick itself was sent to HQ');

  assert.equal(lane(bdb)[0].relation, 'localises', 'the branch row lost the relation');
  assert.equal(hqRows(hdb)[0].relation, 'localises', 'HQ\'s ledger lost the relation');

  const list = await appFor(adminEscalations, '/api/admin', { DB: makeD1(hdb), JWT_SECRET })('/escalations?kind=content');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.items[0].relation, 'localises', 'HQ\'s list does not read the relation');

  const b = await board(hdb);
  assert.equal(b.status, 200);
  assert.equal(b.laneOf('localisation').parts[0].n, 1);
  assert.equal(b.laneOf('localisation').parts[0].cards[0].relation, 'localises');
  assert.equal(b.laneOf('brand_approval').parts[0].n, 0, 'a localisation was counted as a brand approval too');

  const branchLane = await call('/escalations');
  assert.equal(branchLane.body.items[0].relation, 'localises', 'the branch lane does not read the relation');
});

test('D275: a changes pick is a brand approval, and a legacy row lands there marked, never as a localisation', async () => {
  const bdb = branchDb();
  const hdb = hqDb();
  const hq = realHq(hdb);
  const r = await branchApp({ DB: makeD1(bdb), HQ: hq.HQ })('/escalations', raise('content', 'Fix clause 4', {
    concerns: { type: 'article', id: 7 }, relation: 'changes',
  }));
  assert.equal(r.status, 201, r.text);
  // A LEGACY ROW, as a branch built before 296 raised it: a label, no relation.
  hdb.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, status, due_at, created_at)
     VALUES ('esc_legacy', 'fr', 'content', 'Old submission', ?, 'open', '2099-01-01T00:00:00Z', '2026-09-01 08:00:00')`,
  ).run(TEMPLATE_LABEL);
  // And one that names nothing: a change by construction.
  hdb.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at, created_at)
     VALUES ('esc_unnamed', 'fr', 'content', 'A brand question', 'open', '2099-01-01T00:00:00Z', '2026-09-02 08:00:00')`,
  ).run();

  const b = await board(hdb);
  const brand = b.laneOf('brand_approval').parts[0];
  const loc = b.laneOf('localisation').parts[0];
  assert.equal(loc.n, 0, 'a legacy row or a change was counted as a localisation');
  assert.equal(brand.n, 3);
  const card = (uid: string) => brand.cards.find((c: any) => c.uid === uid);
  assert.equal(card('esc_legacy').relation, null);
  assert.equal(card('esc_legacy').subject_ref, TEMPLATE_LABEL, 'the legacy card cannot say it names an item');
  assert.equal(card('esc_unnamed').subject_ref, null);
  assert.equal(brand.cards.find((c: any) => c.relation === 'changes').subject_ref, 'Article · Launch post · launch-post');
  // The two lanes add up to every open content escalation, each once.
  assert.equal(loc.n + brand.n, hqRows(hdb).filter((x) => x.kind === 'content' && x.status === 'open').length);
});

test('D275: the two lanes are one read of hq_escalations, not two', async () => {
  const hdb = hqDb();
  hdb.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, status, due_at, relation)
     VALUES ('esc_1', 'fr', 'content', 's', 'L', 'open', '2099-01-01T00:00:00Z', 'localises')`,
  ).run();
  const b = await board(hdb);
  const escalationReads = b.reads.filter((sql) => /\bFROM hq_escalations\b/.test(sql));
  assert.equal(escalationReads.length, 1, `the board read hq_escalations ${escalationReads.length} times`);
  assert.equal(b.laneOf('localisation').parts[0].n, 1);
});

test('D275: past the ceiling, neither content lane has a count, and each says why', async () => {
  const hdb = hqDb();
  const ins = hdb.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, status, created_at, relation)
     VALUES (?, 'fr', 'content', 'Busy', 'L', 'open', ?, ?)`,
  );
  hdb.exec('BEGIN');
  for (let i = 0; i <= OPEN_ESCALATION_CEILING; i += 1) {
    ins.run(`bulk-${i}`, `2026-01-01 ${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
      i % 2 ? 'localises' : 'changes');
  }
  hdb.exec('COMMIT');
  const b = await board(hdb);
  for (const key of ['localisation', 'brand_approval']) {
    const part = b.laneOf(key).parts[0];
    assert.equal(part.n, null, `${key}: a count cut at the ceiling was shown as the total`);
    assert.ok(part.reason.includes(`More than ${OPEN_ESCALATION_CEILING} escalations`), `${key}: no reason`);
    assert.ok(Array.isArray(part.cards) && part.cards.length > 0, `${key}: the oldest rows were dropped`);
  }
});

/* ------------------------------------------------------------------ *
 * 4 · HQ validates the value, and never throws for it                 *
 * ------------------------------------------------------------------ */

test('D275: HQ refuses an unknown relation, one with no item and one on another kind — returned, never thrown, no row', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ kind: 'content', subject: 's', subject_ref: 'L', relation: 'translates' }, 'bad_relation'],
    [{ kind: 'content', subject: 's', relation: 'localises' }, 'relation_needs_item'],
    [{ kind: 'other', subject: 's', subject_ref: 'L', relation: 'changes' }, 'relation_not_for_kind'],
  ];
  for (const [item, code] of cases) {
    const hdb = hqDb();
    let res: any;
    await assert.doesNotReject(async () => { res = await recordEscalation({ DB: makeD1(hdb) } as any, 'fr', item as any); },
      `${code}: HQ threw, which the branch would store as undelivered and call retryable`);
    assert.equal(res.refused, code);
    assert.ok(String(res.reason).length > 20);
    assert.equal(hqRows(hdb).length, 0, `${code}: a row was recorded`);
  }
});

test('D275: HQ records a NULL relation beside a label as not recorded — what a branch built before 296 sends', async () => {
  const hdb = hqDb();
  const res: any = await recordEscalation({ DB: makeD1(hdb) } as any, 'fr', {
    kind: 'content', subject: 'From an older branch', subject_ref: TEMPLATE_LABEL,
  });
  assert.ok(res.uid, JSON.stringify(res));
  assert.equal(hqRows(hdb)[0].relation, null);
  assert.equal(hqRows(hdb)[0].subject_ref, TEMPLATE_LABEL);
});

test('D275: HQ records the relation on both insert paths — with a raise key and without one', async () => {
  // The keyed path is what every current branch uses (D243); the unkeyed one
  // is a caller that predates the key. Both name the column.
  for (const raise_key of ['raise_key_relation_1', undefined]) {
    const hdb = hqDb();
    const res: any = await recordEscalation({ DB: makeD1(hdb) } as any, 'fr', {
      kind: 'content', subject: 'Fix clause 4', subject_ref: TEMPLATE_LABEL, relation: 'changes', raise_key,
    });
    assert.ok(res.uid, JSON.stringify(res));
    assert.equal(hqRows(hdb)[0].relation, 'changes', `the ${raise_key ? 'keyed' : 'unkeyed'} insert lost the relation`);
  }
});

/* ------------------------------------------------------------------ *
 * 5 · every HQ refusal is a refusal; the retry re-sends the relation  *
 * ------------------------------------------------------------------ */

test('D275: an HQ refusal of a code the branch does not know reaches it as a 400, and no row is written', async () => {
  for (const refused of ['relation_needs_item', 'some_code_from_a_newer_hq']) {
    const db = branchDb();
    const hq = stubHq(() => ({ refused, reason: 'HQ says no, for a reason this build has not met.' }));
    const r = await branchApp({ DB: makeD1(db), HQ: hq.HQ })('/escalations', raise('content', 'x', {
      concerns: PICK, relation: 'localises',
    }));
    assert.equal(r.status, 400, `${refused}: ${r.text}`);
    assert.equal(r.body.error, refused);
    assert.equal(r.body.message, 'HQ says no, for a reason this build has not met.');
    assert.equal(hq.seen.length, 1);
    assert.equal(lane(db).length, 0, `${refused}: a refused raise was stored as undelivered`);
  }
});

test('D275: the retry re-sends the stored relation — and NULL for a row raised before it', async () => {
  const db = branchDb();
  let attempt = 0;
  const hq = stubHq((n) => {
    attempt += 1;
    if (attempt === 1) throw new Error('binding unreachable');
    return { uid: `esc_retry_${n}`, due_at: '2026-09-25T00:00:00Z', status: 'open' };
  });
  const call = branchApp({ DB: makeD1(db), HQ: hq.HQ });
  const raised = await call('/escalations', raise('content', 'Fix clause 4', { concerns: PICK, relation: 'changes' }));
  assert.equal(raised.status, 201, raised.text);
  assert.equal(raised.body.status, 'undelivered');
  assert.equal(lane(db)[0].relation, 'changes', 'an undelivered row lost its relation');

  const retried = await call(`/escalations/${raised.body.id}/retry`, { method: 'POST', body: '{}' });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(hq.seen[1].item.relation, 'changes', 'the retry dropped the relation');
  assert.equal(hq.seen[1].item.subject_ref, TEMPLATE_LABEL);

  // A row stored before 296 carries none, and the retry sends exactly that.
  db.prepare(
    `INSERT INTO branch_escalations (kind, subject, subject_ref, status, delivery_error, raise_key, created_at, updated_at)
     VALUES ('content', 'Old', ?, 'undelivered', 'lost', 'legacy_raise_key_1', 'x', 'x')`,
  ).run(TEMPLATE_LABEL);
  const legacyId = (db.prepare("SELECT id FROM branch_escalations WHERE raise_key = 'legacy_raise_key_1'").get() as any).id;
  const again = await call(`/escalations/${legacyId}/retry`, { method: 'POST', body: '{}' });
  assert.equal(again.status, 200, again.text);
  assert.equal(hq.seen[2].item.relation, null);
});

test('D275: a retry HQ refuses leaves the row undelivered, with HQ\'s reason', async () => {
  const db = branchDb();
  let attempt = 0;
  const hq = stubHq(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('binding unreachable');
    return { refused: 'bad_relation', reason: 'relation must be "localises" or "changes".' };
  });
  const call = branchApp({ DB: makeD1(db), HQ: hq.HQ });
  const raised = await call('/escalations', raise('content', 'x', { concerns: PICK, relation: 'localises' }));
  assert.equal(raised.body.status, 'undelivered');
  const retried = await call(`/escalations/${raised.body.id}/retry`, { method: 'POST', body: '{}' });
  assert.equal(retried.status, 400, retried.text);
  assert.equal(retried.body.error, 'bad_relation');
  const row = lane(db)[0];
  assert.equal(row.status, 'undelivered');
  assert.equal(row.hq_uid, null);
  assert.match(String(row.delivery_error), /HQ refused it: relation must be/);
});

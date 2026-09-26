/**
 * D272 — a licence push that did not land is re-sent, once per window.
 *
 * A branch that already holds a copy never pulls (routes/licence.ts pulls only
 * when it holds none), so until D272 a push that failed — no BRANCH_<CODE>
 * binding yet, the branch unreachable, a refusal — left that branch on its old
 * licence until some later transition happened to push. Now a failed push to
 * a DEPLOYED branch leaves a `licence_push_pending` row (migration 295), a push
 * that lands clears it, and HQ's scheduled handler retries each row at most
 * once per hour. What is asserted here is behaviour, against the migration's
 * own DDL:
 *   - a failed push is recorded, and retried exactly once per window;
 *   - a push that lands clears the row, so a current copy is never re-sent;
 *   - a retry that fails again is reported, never thrown, and stays pending;
 *   - the branch never lets an older copy overwrite a newer one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  pushLicenceToBranch, retryPendingLicencePushes, LICENCE_PUSH_RETRY_WINDOW_MINUTES,
} from '../src/services/licencePush.ts';
import { applyLicenceCopy } from '../src/rpc/branchOps.ts';

const MIGRATION_295 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/295_licence_push_pending.sql'), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind(...args: any[]) { b = coerce(args); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
  };
}

function hqDb() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(`
    CREATE TABLE territory_licences (
      id INTEGER PRIMARY KEY, uid TEXT, licence_ref TEXT, legal_entity_name TEXT, brand_name TEXT,
      registered_address TEXT, signatory_name TEXT, signatory_title TEXT, status TEXT,
      term_years INTEGER, annual_fee_cents INTEGER, currency TEXT,
      revenue_share_bps INTEGER, token_split_bps INTEGER,
      starts_on TEXT, renews_on TEXT, suspended_at TEXT, terminated_at TEXT, status_note TEXT, kind TEXT);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY, licence_uid TEXT, code TEXT);
    CREATE TABLE licence_territories (licence_id INTEGER, country_code TEXT);
    CREATE TABLE licence_seats (licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER);
    CREATE TABLE licence_contracts (id INTEGER PRIMARY KEY, licence_uid TEXT, template_version INTEGER);
  `);
  d.exec(MIGRATION_295);
  d.prepare("INSERT INTO territory_licences (id, uid, licence_ref, status) VALUES (1, 'lic_fr', 'AXL-001', 'active')").run();
  d.prepare("INSERT INTO licence_deployments (id, licence_uid, code) VALUES (1, 'lic_fr', 'fr')").run();
  d.prepare("INSERT INTO licence_territories VALUES (1, 'FR')").run();
  return d;
}
const pending = (d: any) => d.prepare('SELECT * FROM licence_push_pending').all() as any[];

/** A branch binding that records calls and answers per `mode`. */
function branch(mode: { throws?: boolean; refuse?: boolean } = {}) {
  const calls: any[] = [];
  return {
    calls,
    binding: {
      applyLicence: async (r: any) => {
        calls.push(r);
        if (mode.throws) throw new Error('branch unreachable');
        if (mode.refuse) return { ok: false, reason: 'refused' };
        return { applied: true };
      },
    },
  };
}

const T0 = new Date('2026-09-25T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

test('D272: a push to a deployed branch with no binding is recorded as pending', async () => {
  const d = hqDb();
  const res = await pushLicenceToBranch({ DB: makeD1(d) } as any, 1, T0.toISOString());
  assert.equal(res.ok, false);
  const rows = pending(d);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].licence_id, rows[0].code, rows[0].attempts], [1, 'fr', 1]);
});

test('D272: a licence with no deployment records nothing — its branch pulls on first read', async () => {
  const d = hqDb();
  d.prepare('DELETE FROM licence_deployments').run();
  await pushLicenceToBranch({ DB: makeD1(d) } as any, 1, T0.toISOString());
  assert.equal(pending(d).length, 0);
});

test('D272: a failed push is retried exactly once per window, and landing clears it', async () => {
  const d = hqDb();
  await pushLicenceToBranch({ DB: makeD1(d) } as any, 1, T0.toISOString());
  const b = branch();
  const env = { DB: makeD1(d), BRANCH_FR: b.binding } as any;

  // Inside the window: nothing is re-sent, however many ticks run.
  for (const m of [3, 13, LICENCE_PUSH_RETRY_WINDOW_MINUTES - 1]) {
    const r = await retryPendingLicencePushes(env, at(m)) as any;
    assert.equal(r.tried, 0, `retried ${m} minutes after the failure, inside the window`);
  }
  assert.equal(b.calls.length, 0, 'the throttle let a call through');

  // Past the window: exactly one retry, which lands and clears the row.
  const r = await retryPendingLicencePushes(env, at(LICENCE_PUSH_RETRY_WINDOW_MINUTES)) as any;
  assert.deepEqual([r.tried, r.ok, r.failed], [1, 1, 0]);
  assert.equal(b.calls.length, 1);
  assert.equal(pending(d).length, 0, 'a push that landed stayed pending');

  // Now current: the next window re-sends nothing.
  const again = await retryPendingLicencePushes(env, at(LICENCE_PUSH_RETRY_WINDOW_MINUTES * 3)) as any;
  assert.equal(again.tried, 0, 'a copy that is current was re-sent');
  assert.equal(b.calls.length, 1);
});

test('D272: a retry that fails again is reported, not thrown, and stays pending with its attempt counted', async () => {
  for (const mode of [{ throws: true }, { refuse: true }]) {
    const d = hqDb();
    await pushLicenceToBranch({ DB: makeD1(d) } as any, 1, T0.toISOString());
    const b = branch(mode);
    const r = await retryPendingLicencePushes({ DB: makeD1(d), BRANCH_FR: b.binding } as any, at(LICENCE_PUSH_RETRY_WINDOW_MINUTES)) as any;
    assert.deepEqual([r.available, r.tried, r.ok, r.failed], [true, 1, 0, 1], JSON.stringify(mode));
    const rows = pending(d);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].attempts, 2);
    assert.equal(rows[0].last_attempt_at, at(LICENCE_PUSH_RETRY_WINDOW_MINUTES).toISOString());
  }
});

test('D272: a database without migration 295 loses the retry, never the push', async () => {
  const d = hqDb();
  d.exec('DROP TABLE licence_push_pending');
  const b = branch();
  const res = await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: b.binding } as any, 1);
  assert.equal(res.ok, true);
  const r = await retryPendingLicencePushes({ DB: makeD1(d) } as any, T0) as any;
  assert.equal(r.available, false);
  assert.match(r.reason, /could not be read/);
});

test('D272: the branch never lets an older copy overwrite a newer one', async () => {
  // The table as the migrations that declare it build it: 256 creates it, 257,
  // 265 and 284 add columns. Each ALTER is applied on its own.
  const d = new DatabaseSync(':memory:');
  const dir = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
  for (const f of readdirSync(dir).filter((x) => /^(256|257|265|284)_/.test(x)).sort()) {
    const body = readFileSync(resolve(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const stmt of body.split(';')) {
      if (/\bbranch_licence\b/.test(stmt) && /\b(CREATE TABLE|ALTER TABLE)\b/i.test(stmt)) d.exec(stmt);
    }
  }
  assert.ok(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'branch_licence'").get(), 'branch_licence was not built');
  const env = { DB: makeD1(d), BRANCH_CODE: 'fr' } as any;
  await applyLicenceCopy(env, { licence_uid: 'lic_fr', status: 'active', territory: 'FR', pushed_at: '2026-09-25T10:00:00Z' });
  await applyLicenceCopy(env, { licence_uid: 'lic_fr', status: 'suspended', territory: 'FR', pushed_at: '2026-09-25T09:00:00Z' });
  const row = d.prepare('SELECT status, pushed_at FROM branch_licence WHERE id = 1').get() as any;
  assert.deepEqual([row.status, row.pushed_at], ['active', '2026-09-25T10:00:00Z'], 'an older push overwrote a newer copy');
  await applyLicenceCopy(env, { licence_uid: 'lic_fr', status: 'suspended', territory: 'FR', pushed_at: '2026-09-25T11:00:00Z' });
  assert.equal((d.prepare('SELECT status FROM branch_licence WHERE id = 1').get() as any).status, 'suspended', 'a newer push was refused');
});

test('D272: every licence change that alters the branch copy pushes it', () => {
  // The copy carries territories, seats, the commercial terms, the status and
  // the latest contract's template version. Each route that changes one of
  // them must push, or its branch keeps the old value until an unrelated
  // transition happens to push. Read per handler: the push must follow the
  // handler's own event, before its response.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_licences.ts'), 'utf8');
  for (const event of ["'territory_changed'", "'seats_changed'", "'terms_changed'", "'contract_instantiated'", "'reinstated', admin.id, { notice_uid"]) {
    const at = src.indexOf(event);
    assert.ok(at > 0, `no ${event} event`);
    const tail = src.slice(at, src.indexOf('return c.json(', at));
    assert.match(tail, /pushLicenceToBranch\(c\.env, licence\.id\)/, `${event} changes the branch copy and does not push it`);
  }
});

test('D272: the retry runs from HQ\'s scheduled handler only', () => {
  // Only HQ holds the ledger and the branch bindings; a branch running the
  // block would read a table it does not have, every tenth minute.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(src, /if \(hqCadences && now\.getUTCMinutes\(\) % 10 === 3\) \{\s*\n\s*try \{\s*\n\s*const \{ retryPendingLicencePushes \}/,
    'the licence push retry is not gated on hqCadences');
});

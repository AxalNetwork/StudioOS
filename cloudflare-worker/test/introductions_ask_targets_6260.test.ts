/**
 * D6260 (#6260) — GET /api/introductions names each ask's target, and only a
 * name the investor could already see (D702's profile visibility for a
 * founder, D702's `hiddenFromInvestor` for a project). Anything else reads
 * `available: false` with no name; a failed lookup reads unreadable.
 *
 * Built on node:sqlite from the whole baseline plus every migration after its
 * cutoff, as profile_pages_d702.test.ts does. Every name is made up.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/introductions_ask_targets_6260.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import introductions from '../src/routes/introductions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { splitStatements } from './_baseline.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const IAN = 1;  // the investor reading their asks
const FAY = 2;  // founder, profile never chosen (public)
const PRI = 3;  // founder, profile private
const IVY = 4;  // another investor
const OLD = 5;  // founder, account deactivated
const NET = 6;  // founder, profile "network only" (signed-in members)
const REC = 7;  // founder reached through a founder record only
const ROLE: Record<number, string> = { [IAN]: 'investor', [FAY]: 'founder', [PRI]: 'founder', [IVY]: 'investor', [OLD]: 'founder', [NET]: 'founder', [REC]: 'founder' };
const SEEN = 100;    // findable venture
const DELETED = 300; // deleted venture
const ELSEWHERE = 400; // a venture hidden from investors, asked by IVY only

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, failOn?: RegExp) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { if (failOn?.test(sql)) throw new Error('D1_ERROR: synthetic'); return db.prepare(sql).get(...b) ?? null; },
        async all() { if (failOn?.test(sql)) throw new Error('D1_ERROR: synthetic'); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

let db: InstanceType<typeof DatabaseSync>;
before(() => {
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const s of splitStatements(read('cloudflare-worker/sql/schema_baseline.sql'))) {
    try { db.exec(s); } catch { /* the baseline's two lp_investors triggers do not split; unrelated */ }
  }
  const dir = resolve(ROOT, 'cloudflare-worker/sql/migrations');
  for (const f of readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x) && Number(x.split('_')[0]) > 219).sort(compareMigrations)) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const u = db.prepare(`INSERT INTO users (id, uid, email, role, name, display_name, founder_id, is_active) VALUES (?,?,?,?,?,?,?,?)`);
  u.run(IAN, 'ian', 'ian@example.test', 'investor', 'Ian Investor', null, null, 1);
  u.run(FAY, 'fay', 'fay@example.test', 'founder', 'Fay Legal', 'Fay Founder', 10, 1);
  u.run(PRI, 'pri', 'pri@example.test', 'founder', 'Pri Private', null, 11, 1);
  u.run(IVY, 'ivy', 'ivy@example.test', 'investor', 'Ivy Investor', null, null, 1);
  u.run(OLD, 'old', 'old@example.test', 'founder', 'Old Gone', null, 12, 0);
  u.run(NET, 'net', 'net@example.test', 'founder', 'Net Member', null, 13, 1);
  u.run(REC, 'rec', 'rec@example.test', 'founder', 'Rec Record', null, 14, 1);
  db.prepare(`INSERT INTO user_settings (user_id, visibility, visibility_chosen_at) VALUES (?, 'private', '2026-10-01'), (?, 'network', '2026-10-01')`).run(PRI, NET);
  db.prepare(`INSERT INTO founders (id, name, email) VALUES (10, 'Fay', 'fay@example.test'), (11, 'Pri', 'pri@example.test'), (14, 'Rec', 'rec@example.test')`).run();
  const p = db.prepare(`INSERT INTO projects (id, uid, name, founder_id, status, investor_findable, deleted_at) VALUES (?,?,?,?,?,?,?)`);
  p.run(SEEN, 'seen', 'Seenventure', 10, 'active', null, null);
  p.run(DELETED, 'gone', 'Goneventure', 10, 'active', null, '2026-10-02');
  p.run(ELSEWHERE, 'quiet', 'Quietventure', 11, 'active', 0, null);
  const ask = db.prepare(`INSERT INTO investor_introductions (uid, investor_user_id, founder_user_id, founder_id, project_id, message, quarter, created_at)
                          VALUES (?,?,?,?,?,?,'2026Q4',?)`);
  ask.run('a-fay', IAN, FAY, null, null, 'We back lab tools.', '2026-11-10 10:00:00');
  ask.run('a-pri', IAN, PRI, null, null, null, '2026-11-09 10:00:00');
  ask.run('a-ivy', IAN, IVY, null, null, null, '2026-11-08 10:00:00');
  ask.run('a-old', IAN, OLD, null, null, null, '2026-11-07 10:00:00');
  ask.run('a-net', IAN, NET, null, null, null, '2026-11-06 10:00:00');
  ask.run('a-rec', IAN, null, 14, null, null, '2026-11-05 10:00:00');
  ask.run('a-seen', IAN, null, null, SEEN, null, '2026-11-04 10:00:00');
  ask.run('a-gone', IAN, null, null, DELETED, null, '2026-11-03 10:00:00');
  ask.run('a-missing', IAN, 999, null, null, null, '2026-11-02 10:00:00');
  // Another investor's ask: never in Ian's list, and it gives Ian no reach.
  ask.run('b-ivy', IVY, null, null, ELSEWHERE, 'Ivy only.', '2026-11-01 10:00:00');
});

async function list(as: number, failOn?: RegExp) {
  const a = new Hono<any>();
  a.route('/api/introductions', introductions);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await a.request('/api/introductions', { headers: { Authorization: `Bearer ${token}` } }, { DB: makeD1(db, failOn), JWT_SECRET } as any);
  const text = await res.text(); let body: any = {}; try { body = JSON.parse(text); } catch { body = { raw: text }; } return { status: res.status, body };
}
const byUid = (body: any) => Object.fromEntries(body.introductions.map((r: any) => [r.uid, r]));

test('a founder the investor may see is named, with the message and date kept', async () => {
  const r = await list(IAN);
  assert.equal(r.status, 200);
  assert.equal(r.body.targets_unreadable, undefined);
  const rows = byUid(r.body);
  assert.deepEqual(rows['a-fay'].target, { kind: 'founder', name: 'Fay Founder', available: true });
  assert.equal(rows['a-fay'].message, 'We back lab tools.');
  assert.equal(rows['a-fay'].created_at, '2026-11-10 10:00:00');
  // "Network only" is served to any signed-in member, so it is named too.
  assert.deepEqual(rows['a-net'].target, { kind: 'founder', name: 'Net Member', available: true });
  // A founder record resolves to its person by D702's rule, the lowest user id on the record.
  assert.deepEqual(rows['a-rec'].target, { kind: 'founder', name: 'Rec Record', available: true });
});

test('a private founder, another investor, a deactivated account and an unknown id are not available, with no name', async () => {
  const rows = byUid((await list(IAN)).body);
  for (const uid of ['a-pri', 'a-ivy', 'a-old', 'a-missing']) {
    assert.deepEqual(rows[uid].target, { kind: 'founder', name: null, available: false }, uid);
  }
  const text = JSON.stringify(rows);
  for (const leaked of ['Pri Private', 'Ivy Investor', 'Old Gone']) assert.doesNotMatch(text, new RegExp(leaked));
});

test('a findable project is named; a deleted one is not available', async () => {
  const rows = byUid((await list(IAN)).body);
  assert.deepEqual(rows['a-seen'].target, { kind: 'project', name: 'Seenventure', available: true });
  assert.deepEqual(rows['a-gone'].target, { kind: 'project', name: null, available: false });
});

test('another investor\'s ask is never listed, and its venture is not named to anyone else', async () => {
  const mine = (await list(IAN)).body;
  assert.ok(!mine.introductions.some((r: any) => r.uid === 'b-ivy'));
  assert.doesNotMatch(JSON.stringify(mine), /Quietventure|Ivy only/);
  // D702 counts an investor's own ask row as reach, so Ivy is named the venture she asked for.
  const hers = byUid((await list(IVY)).body);
  assert.deepEqual(hers['b-ivy'].target, { kind: 'project', name: 'Quietventure', available: true });
});

test('a venture D702 hides from this investor reads not available, with no name', async () => {
  // Quietventure is not findable and Ian has no deal room, ask, watch or NDA that reaches it; Ivy's ask is hers alone.
  const { askTargets } = await import('../src/services/introAskTargets.ts');
  const out = await askTargets({ DB: makeD1(db) } as any, { id: IAN, role: 'investor' } as any, [{ project_id: ELSEWHERE }, { project_id: SEEN }]);
  assert.equal(out.unreadable, false);
  assert.deepEqual(out.targets, [
    { kind: 'project', name: null, available: false },
    { kind: 'project', name: 'Seenventure', available: true },
  ]);
});

test('a failed name lookup reads unreadable for the list, never not available', async () => {
  const r = await list(IAN, /FROM projects WHERE id IN/);
  assert.equal(r.status, 200);
  assert.equal(r.body.targets_unreadable, true);
  assert.ok(r.body.introductions.length > 0);
  for (const row of r.body.introductions) assert.equal(row.target, null);
});

// ── POST /request refuses a target the investor could not see (the owner's choice B) ──

async function ask(as: number, body: Record<string, unknown>, failOn?: RegExp) {
  const a = new Hono<any>();
  a.route('/api/introductions', introductions);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await a.request('/api/introductions/request', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: makeD1(db, failOn), JWT_SECRET } as any);
  const text = await res.text(); let out: any = {}; try { out = JSON.parse(text); } catch { out = { raw: text }; } return { status: res.status, body: out };
}
const spent = (id: number) => Number((db.prepare(`SELECT investor_quota_intros_used AS n FROM users WHERE id = ?`).get(id) as any)?.n ?? 0);
const askRows = (id: number) => Number((db.prepare(`SELECT COUNT(*) AS n FROM investor_introductions WHERE investor_user_id = ?`).get(id) as any).n);

test('an ask to a founder or venture the investor may see is sent and spends one slot', async () => {
  const before = askRows(IAN);
  const r = await ask(IAN, { founder_user_id: FAY, message: 'Hello.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(spent(IAN), 1);
  const p = await ask(IAN, { project_id: SEEN });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(spent(IAN), 2);
  assert.equal(askRows(IAN), before + 2);
});

test('an ask to a hidden, private, deleted, deactivated or unknown target is refused before any slot is spent', async () => {
  const usedBefore = spent(IAN); const rowsBefore = askRows(IAN);
  const cases: Record<string, unknown>[] = [
    { project_id: ELSEWHERE },          // D702 hides it from Ian
    { project_id: DELETED },
    { project_id: 999 },                // no such venture: the same answer as a hidden one
    { founder_user_id: PRI },           // private profile
    { founder_user_id: OLD },           // deactivated
    { founder_user_id: IVY },           // not a founder
    { founder_user_id: 999 },
    { founder_user_id: FAY, project_id: ELSEWHERE }, // every id the row would store is checked
    { founder_id: 11 },                 // Pri's founder record
  ];
  for (const body of cases) {
    const r = await ask(IAN, body);
    assert.equal(r.status, 404, JSON.stringify(body));
    assert.equal(r.body.error, 'target_not_available', JSON.stringify(body));
    assert.match(r.body.message, /No ask was sent and none was used/);
    assert.doesNotMatch(JSON.stringify(r.body), /Quietventure|Pri Private|Old Gone|Ivy Investor/);
  }
  assert.equal(spent(IAN), usedBefore);
  assert.equal(askRows(IAN), rowsBefore);
  // The refused ask gave Ian no reach: the venture is still hidden from him.
  const { askTargets } = await import('../src/services/introAskTargets.ts');
  const out = await askTargets({ DB: makeD1(db) } as any, { id: IAN, role: 'investor' } as any, [{ project_id: ELSEWHERE }]);
  assert.deepEqual(out.targets, [{ kind: 'project', name: null, available: false }]);
});

test('when reach cannot be read the ask is refused as unreadable, and nothing is spent', async () => {
  const usedBefore = spent(IAN); const rowsBefore = askRows(IAN);
  const r = await ask(IAN, { project_id: SEEN }, /FROM projects WHERE id IN/);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'target_unreadable');
  assert.match(r.body.message, /could not be read/);
  assert.equal(spent(IAN), usedBefore);
  assert.equal(askRows(IAN), rowsBefore);
});

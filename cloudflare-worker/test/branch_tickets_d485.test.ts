/**
 * D485 (#1025) — the tickets a branch's administrators file on its own host
 * reach HQ · Support (H22), over RPC.
 *
 * Real SQLite at both tiers. HQ's binding to a branch calls
 * `branchOpenTickets` over that branch's own database, so what HQ shows is
 * what the branch read.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_tickets_d485.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import supportRoute from '../src/routes/admin_hq_support.ts';
import { branchOpenTickets } from '../src/rpc/branchOps.ts';
import {
  readBranchAdminTickets, branchTicketLine, BRANCH_TICKETS_UNREADABLE, OPEN_TICKET_CEILING, SUPPORT_LIST_LIMIT,
} from '../src/services/supportQueues.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 1;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const M296_HQ = splitStatements(migration('296_escalation_relation.sql'))
  .find((st: string) => /^ALTER TABLE hq_escalations\b/.test(st)) as string;

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
const db0 = () => new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });

/** A branch's database: its admins and members, and the tickets they filed on its host. */
function branchDb() {
  const db = db0();
  db.exec(ddl('users'));
  db.exec(ddl('tickets'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(1, 'admin', 'K. Weber', 'kw@fr.example', 1);
  u.run(2, 'admin', 'Former Admin', 'fa@fr.example', 0);
  u.run(3, 'founder', 'A Member', 'am@fr.example', 1);
  u.run(4, 'admin', '', 'noname@fr.example', 1);
  const t = db.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))`);
  t.run(101, 'Approvals board slow', 'open', 'high', 1, '-30 hours');
  t.run(102, 'Seat count looks wrong', 'in_progress', 'medium', 4, '-2 hours');
  t.run(103, 'From a closed admin', 'open', 'high', 2, '-50 hours');      // inactive: not sent
  t.run(104, 'A member asking', 'open', 'low', 3, '-60 hours');           // not an admin: the branch's to answer
  t.run(105, 'Already resolved', 'resolved', 'high', 1, '-90 hours');     // not open
  return db;
}

const branchEnv = (db: InstanceType<typeof DatabaseSync>, code = 'fr') =>
  ({ DB: d1Over(db), BRANCH_CODE: code, JWT_SECRET, ENVIRONMENT: 'development' }) as any;
const binding = (db: InstanceType<typeof DatabaseSync>, code: string) =>
  ({ openTickets: () => branchOpenTickets(branchEnv(db, code)) });

/** HQ's database: two deployed licences, one not deployed, and tickets filed on axal.vc. */
function hqDb(opts: { tiers?: boolean } = {}) {
  const db = db0();
  for (const t of ['users', 'super_admins', 'user_sessions', 'licence_admins', 'territory_licences', 'tickets', 'ticket_sync_events']) db.exec(ddl(t));
  for (const f of ['258_licence_deployments.sql', '259_hq_escalations.sql', '267_hq_escalation_sla_claim.sql',
    '273_ticket_sync_status.sql', '279_licence_kind.sql', ...(opts.tiers === false ? [] : ['333_ticket_category_sla_tiers.sql'])]) {
    db.exec(migration(f));
  }
  db.exec(M296_HQ);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test', 1);
  u.run(20, 'admin', 'K. Weber', 'kw@example.test', 1);
  u.run(10, 'founder', 'D. Raghunathan', 'dr@example.test', 1);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const l = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, kind) VALUES (?, ?, ?, ?, ?, 'active', 'subsidiary')`);
  l.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  l.run(2, 'lic_de', 'AXL-002', 'Axal VC DACH GmbH', 'Axal VC DACH');
  l.run(3, 'lic_es', 'AXL-003', 'Axal VC Iberia SL', 'Axal VC Iberia');
  db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (1, 20)').run();
  const dep = db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status) VALUES (?, ?, ?, ?, ?, 'live')`);
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de');
  const t = db.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (?, ?, 'open', 'medium', ?, datetime('now', ?))`);
  t.run(1, 'Data export request', 10, '-18 hours');      // HQ-held
  t.run(2, 'Asked on axal.vc instead', 20, '-10 hours'); // About Admin, filed on axal.vc by fr's admin
  return db;
}

const app = new Hono<any>();
app.route('/', supportRoute);
app.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function support(db: InstanceType<typeof DatabaseSync>, bindings: Record<string, unknown>) {
  const jwt = await new SignJWT({ user_id: HOLDER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/', { headers: { Authorization: `Bearer ${jwt}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...bindings });
  return { status: res.status, body: await res.json() as any };
}
const line = (body: any, code: string) => body.branch_tickets.lines.find((l: any) => l.code === code);
const cell = (body: any, uid: string) => body.matrix.rows.find((r: any) => r.key === uid).about_admin;

// ───────────────────────────────────────────────────────────── the branch ──

test('a branch sends its active administrators\' open tickets, oldest first, and nothing else', async () => {
  const ans = await branchOpenTickets(branchEnv(branchDb()));
  assert.equal(ans.branch, 'fr');
  const t = ans.tickets;
  assert.equal(t.available, true);
  if (!t.available) return;
  assert.equal(t.complete, true);
  assert.equal(t.count, 2);
  assert.deepEqual(t.items.map((x) => x.id), [101, 102]);
  assert.equal(t.items[0].requester, 'K. Weber');
  assert.equal(t.items[1].requester, 'noname@fr.example', 'an empty name falls back to the email');
  assert.equal(t.oldest_created_at, t.items[0].created_at);
  assert.deepEqual(Object.keys(t.items[0]).sort(), ['created_at', 'id', 'priority', 'requester', 'status', 'title']);
  assert.doesNotMatch(JSON.stringify(ans), /A member asking|From a closed admin|Already resolved/);
});

test('HQ\'s tier refuses to answer as a branch, and an unreadable queue is unreadable, not empty', async () => {
  await assert.rejects(() => branchOpenTickets({ DB: d1Over(branchDb()) } as any), /only live on a branch/);
  const db = branchDb();
  db.exec('DROP TABLE tickets');
  assert.deepEqual(await readBranchAdminTickets({ DB: d1Over(db) } as any), { available: false, reason: BRANCH_TICKETS_UNREADABLE });
});

test('past the ceiling the branch says so; only the oldest travel', async () => {
  const db = branchDb();
  const t = db.prepare(`INSERT INTO tickets (title, status, priority, user_id, created_at) VALUES ('bulk', 'open', 'low', 1, datetime('now', '-1 hours'))`);
  for (let i = 0; i < OPEN_TICKET_CEILING; i++) t.run();
  const r = await readBranchAdminTickets({ DB: d1Over(db) } as any);
  assert.equal(r.available && r.complete, false);
  assert.equal(r.available && r.items.length, SUPPORT_LIST_LIMIT);
  assert.equal(r.available && r.items[0].id, 101, 'the oldest are still exact');
  const ln = branchTicketLine('fr', 'Axal VC France', r, Date.now(), { P1: 24, P2: 48, P3: 96 } as any);
  assert.equal(ln.state === 'ok' && ln.count, null, 'a cut count is not a total');
  assert.equal(ln.state === 'ok' && ln.bands, null);
});

// ──────────────────────────────────────────────────────────────── HQ ──

test('HQ lists each branch\'s tickets, aged and banded with HQ\'s own hours, and names a branch that did not answer', async () => {
  const fr = branchDb();
  const { status, body } = await support(hqDb(), {
    BRANCH_FR: binding(fr, 'fr'),
    BRANCH_DE: { openTickets: async () => { throw new Error('connection reset'); } },
  });
  assert.equal(status, 200);
  const f = line(body, 'fr');
  assert.equal(f.state, 'ok');
  assert.equal(f.label, 'Axal VC France');
  assert.equal(f.count, 2);
  assert.equal(Math.floor(f.oldest_age_hours), 30);
  assert.deepEqual(f.items.map((x: any) => x.id), [101, 102]);
  assert.ok(f.items.every((x: any) => ['ok', 'due_soon', 'past'].includes(x.sla_band)), 'every branch ticket is banded');
  assert.equal(f.bands.ok + f.bands.due_soon + f.bands.past + f.bands.undated, 2);
  const d = line(body, 'de');
  assert.equal(d.state, 'unreadable');
  assert.equal(d.label, 'Axal VC DACH');
  assert.match(d.reason, /connection reset/);
  assert.deepEqual(body.branch_tickets.coverage, { total: 2, answered: 1, complete: false, unreadable: ['de'] });
  assert.match(body.branch_tickets.whose, /active administrators/);
});

test('the matrix cell is the whole About-Admin load: on the branch plus on axal.vc', async () => {
  const { body } = await support(hqDb(), {
    BRANCH_FR: binding(branchDb(), 'fr'),
    BRANCH_DE: { openTickets: async () => { throw new Error('timeout'); } },
  });
  const fr = cell(body, 'lic_fr');
  assert.equal(fr.value, 3, '2 filed on fr.axal.vc + 1 filed on axal.vc');
  assert.equal(fr.on_branch, 2);
  assert.equal(fr.on_hq, 1);
  assert.equal(Math.floor(fr.oldest_age_hours), 30, 'the oldest of either store');
  const de = cell(body, 'lic_de');
  assert.equal(de.value, null);
  assert.equal(de.why, 'unreadable');
  assert.match(de.reason, /de\.axal\.vc could not be read: .*timeout/);
  const es = cell(body, 'lic_es');
  assert.deepEqual(es, { value: 0, oldest_age_hours: null }, 'an undeployed licence files here, as before');
});

test('the total counts every branch\'s tickets, and is withheld while any branch cannot be read', async () => {
  const bound = await support(hqDb(), { BRANCH_FR: binding(branchDb(), 'fr'), BRANCH_DE: binding(branchDb(), 'de') });
  // HQ-held 1 + About Admin on axal.vc 1 + fr 2 + de 2; no escalations.
  assert.equal(bound.body.total.value, 6, JSON.stringify(bound.body.total));
  assert.equal(bound.body.total.oldest.queue, 'branch:de', 'the oldest names the branch it came from');
  const failed = await support(hqDb(), { BRANCH_FR: binding(branchDb(), 'fr') }); // de is deployed and unbound
  assert.equal(failed.body.total.value, null);
  assert.match(failed.body.total.reason, /filed on Axal VC DACH could not be read/);
  assert.equal(line(failed.body, 'de').state, 'not_deployed');
  assert.equal(cell(failed.body, 'lic_de').why, 'branch_database', 'unbound reads as on the branch, with the reason');
  assert.match(cell(failed.body, 'lic_de').reason, /no binding to ask it yet/);
});

test('without HQ\'s tier hours, branch tickets are aged but not banded', async () => {
  const { body } = await support(hqDb({ tiers: false }), { BRANCH_FR: binding(branchDb(), 'fr'), BRANCH_DE: binding(branchDb(), 'de') });
  const f = line(body, 'fr');
  assert.equal(f.bands, null);
  assert.ok(f.items.every((x: any) => x.sla_band === null));
  assert.ok(f.items.every((x: any) => typeof x.age_hours === 'number'));
});

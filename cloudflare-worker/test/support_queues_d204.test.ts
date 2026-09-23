/**
 * D204 — HQ Support reads what HQ records: three queues, the tenant × queue
 * matrix, and the ticket→GitHub mirror strip.
 *
 * WHAT THIS FILE HOLDS, and why each part is driven rather than read:
 *
 *   - THE PERSONA ORDER. Five rules, first match wins, each asserted against a
 *     row that the next rule down would have claimed — a closed account that is
 *     still bound, a demoted account that is still bound, a staff admin with no
 *     licence — so swapping any two rules fails a named case.
 *   - ONE DEFINITION OF OPEN. The five buckets foot to `ticketBacklog().open`,
 *     which is HQ Home's Queue backlog read, on one fixture; and HQ Home reads
 *     that one function rather than a second `GROUP BY status` of its own.
 *   - THE ROUTE END TO END, over a real fixture: the SLA bands, the queues, the
 *     matrix row by row, the sync strip, the total.
 *   - EVERY READ FAILS ALONE. A database missing the escalation board, the
 *     deployment registry, migration 273 or the tickets table costs exactly the
 *     parts that read it — and the GET never writes, so a missing 273 is
 *     reported rather than repaired by somebody looking.
 *   - THE CEILINGS. Past 2,000 escalations or 5,000 tickets a count is withheld
 *     rather than shown as a total, while the oldest items stay exact.
 *
 * REAL node:sqlite THROUGHOUT: users, super_admins, user_sessions, tickets,
 * licence_admins (with its UNIQUE index) and territory_licences are sliced from
 * schema_baseline.sql verbatim, and migrations 258, 259, 267, 273 and 279 are
 * applied off disk — the D139 lesson: a hand-typed fixture that is narrower
 * than the schema tests a table production does not have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import supportRoute, { ESCALATIONS_UNREADABLE } from '../src/routes/admin_hq_support.ts';
import {
  OPEN_TICKET_STATUSES, OPEN_TICKET_CEILING, SUPPORT_LIST_LIMIT, SYNC_WINDOW_HOURS,
  SYNC_UNREADABLE, SYNC_LAG_REASON, TICKETS_UNREADABLE, DEPLOYMENTS_UNREADABLE, MATRIX_REASONS,
  TICKET_PERSONAS, personaOf, ticketBacklog, summariseTickets,
} from '../src/services/supportQueues.ts';
import { OPEN_ESCALATION_CEILING, openEscalations, openEscalationSummary } from '../src/rpc/hqOps.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 1;
const PLAIN_ADMIN = 2;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATIONS = [
  '258_licence_deployments.sql',
  '259_hq_escalations.sql',
  '267_hq_escalation_sla_claim.sql',
  '273_ticket_sync_status.sql',
  '279_licence_kind.sql',
];
const migration = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

type Omit = 'hq_escalations' | 'licence_deployments' | 'm273' | 'tickets';

function freshDb(omit: Omit[] = []) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'user_sessions', 'licence_admins', 'territory_licences']) db.exec(ddl(t));
  db.exec('CREATE UNIQUE INDEX idx_licence_admins_user ON licence_admins(user_id);');
  if (!omit.includes('tickets')) db.exec(ddl('tickets'));
  for (const f of MIGRATIONS) {
    if (f.startsWith('258_') && omit.includes('licence_deployments')) continue;
    if (f.startsWith('259_') && omit.includes('hq_escalations')) continue;
    if (f.startsWith('267_') && omit.includes('hq_escalations')) continue;
    if (f.startsWith('273_') && (omit.includes('m273') || omit.includes('tickets'))) continue;
    db.exec(migration(f));
  }
  return db;
}

const envFor = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  return a;
}
const app = appFor(supportRoute);

async function getSupport(env: any, as = HOLDER) {
  const res = await app.request('/', { headers: { Authorization: `Bearer ${await token(as, 'admin')}` } }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const H = 3_600_000;

/**
 * The fixture every end-to-end test reads. Each row is here to separate two
 * rules, and the comment says which.
 */
function seed(db: InstanceType<typeof DatabaseSync>, omit: Omit[] = []) {
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test', 1);
  u.run(PLAIN_ADMIN, 'admin', 'HQ Staff', 'staff@example.test', 1);        // hq_staff: admin, no licence
  u.run(10, 'founder', 'D. Raghunathan', 'dr@example.test', 1);           // hq_held
  u.run(11, 'investor', 'Investor B', 'ib@example.test', 1);              // hq_held
  u.run(20, 'admin', 'K. Weber', 'kw@example.test', 1);                   // bound to the DEPLOYED licence
  u.run(21, 'admin', 'T. Roussel', 'tr@example.test', 1);                 // bound to the white-label
  u.run(22, 'founder', 'Demoted Admin', 'da@example.test', 1);            // demoted, not detached: binding beats role
  u.run(30, 'admin', 'Closed Admin', 'ca@example.test', 0);               // closed AND bound: closed wins
  u.run(40, 'admin', 'Late Admin', 'la@example.test', 1);                 // bound to a TERMINATED licence, still active
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);

  const l = db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  l.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'active', 'subsidiary');
  l.run(2, 'lic_wl', 'AXL-002', 'Studio Lyon SARL', 'Studio Lyon', 'active', 'white_label');
  l.run(3, 'lic_old', 'AXL-003', 'Axal VC Iberia SL', 'Axal VC Iberia', 'terminated', 'subsidiary');
  l.run(4, 'lic_draft', 'AXL-004', 'Axal VC Nordics AB', 'Axal VC Nordics', 'draft', 'subsidiary');
  l.run(5, 'lic_late', 'AXL-005', 'Axal VC Baltics OU', 'Axal VC Baltics', 'terminated', 'subsidiary');
  const la = db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (?, ?)');
  la.run(1, 20); la.run(2, 21); la.run(2, 22); la.run(3, 30); la.run(5, 40);

  if (!omit.includes('licence_deployments')) {
    db.prepare(
      `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
       VALUES ('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'live')`,
    ).run();
  }

  if (!omit.includes('hq_escalations')) {
    const e = db.prepare(
      `INSERT INTO hq_escalations (uid, branch_code, kind, subject, raised_by_name, status, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    );
    e.run('esc_past', 'fr', 'other', 'appeal on suspension', 'M. Dupont', 'open', iso(-1 * H), '-96 hours');
    e.run('esc_soon', 'fr', 'seat_increase', 'seat increase, Founder +20', null, 'open', iso(5 * H), '-31 hours');
    e.run('esc_ok', 'fr', 'moderation', 'flagged profile', null, 'open', iso(48 * H), '-2 hours');
    e.run('esc_done', 'fr', 'moderation', 'answered already', null, 'answered', iso(48 * H), '-200 hours');
    e.run('esc_orphan', 'xx', 'other', 'from a code no licence holds', null, 'open', iso(60 * H), '-1 hours');
  }

  if (!omit.includes('tickets')) {
    const t = db.prepare(
      `INSERT INTO tickets (id, title, status, user_id, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))`,
    );
    t.run(1, 'Data export request', 'open', 10, '-18 hours');                  // hq_held
    t.run(2, 'Cannot reach billing', 'in_progress', 11, '-3 hours');         // hq_held, in_progress counts
    t.run(3, 'Old question', 'resolved', 10, '-400 hours');                  // not open
    t.run(4, 'Approvals filter loses state', 'open', 20, '-44 hours');       // admin_product, deployed licence
    t.run(5, 'Template picker as-of time wrong', 'open', 21, '-9 hours');    // admin_product, white-label
    t.run(6, 'Brand kit upload fails', 'open', 22, '-5 hours');              // admin_product via binding, role founder
    t.run(7, 'Staff test ticket', 'open', PLAIN_ADMIN, '-1 hours');          // hq_staff
    t.run(8, 'Closed admin asking', 'open', 30, '-70 hours');                // account_closed
    t.run(9, 'Anonymous report', 'open', null, '-2 hours');                  // not_on_record: no user_id
    t.run(10, 'Deleted account', 'open', 999, '-2 hours');                   // not_on_record: row gone
    t.run(11, 'Terminated but still asking', 'open', 40, '-6 hours');        // admin_product, terminated licence
    t.run(12, 'Done', 'closed', 20, '-500 hours');                           // not open
    if (!omit.includes('m273')) {
      const s = db.prepare(
        `UPDATE tickets SET github_sync_status = ?, github_sync_attempted_at = datetime('now', ?) WHERE id = ?`,
      );
      s.run('synced', '-1 hours', 1);
      s.run('failed', '-2 hours', 2);
      s.run('synced', '-30 hours', 4); // outside the 24-hour window
      s.run('not_configured', '-10 minutes', 5);
    }
  }
  return db;
}

// ─────────────────────────────────────────────────────────── persona ──

const row = (over: Record<string, unknown>) => ({
  account_id: 5, requester_active: 1, requester_role: 'founder', licence_uid: null, ...over,
}) as any;

test('persona: first match wins, and each rule beats the one below it', () => {
  assert.equal(personaOf(row({ account_id: null })), 'not_on_record', 'no account on the ticket');
  // Closed beats bound: D145's terminate deactivates and detaches, and a closed
  // account that is still bound must not be filed as an active administrator.
  assert.equal(personaOf(row({ requester_active: 0, requester_role: 'admin', licence_uid: 'lic_x' })), 'account_closed');
  // Bound beats role: D134's demote-then-detach window.
  assert.equal(personaOf(row({ requester_role: 'founder', licence_uid: 'lic_x' })), 'admin_product');
  assert.equal(personaOf(row({ requester_role: 'admin', licence_uid: 'lic_x' })), 'admin_product');
  assert.equal(personaOf(row({ requester_role: 'admin' })), 'hq_staff');
  assert.equal(personaOf(row({})), 'hq_held');
  assert.equal(personaOf(row({ requester_role: 'investor' })), 'hq_held');
});

test('persona: the licence kind is never read, so a white-label administrator is in the Admin-product queue', () => {
  const src = read('cloudflare-worker/src/services/supportQueues.ts');
  const at = src.indexOf('export function personaOf(');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(at > 0 && body.length > 0, 'personaOf is gone');
  // A substring, not a word: a kind filter arrives as `licence_kind` or `tl.kind`.
  assert.doesNotMatch(body.replace(/\/\/.*$/gm, ''), /kind/i, 'personaOf reads a kind');
  const sql = /SELECT t\.id[\s\S]*?LIMIT \?/.exec(src)?.[0] || '';
  assert.ok(sql.length > 0, 'the open-ticket read is gone');
  assert.doesNotMatch(sql, /kind/i, 'the open-ticket read selects a licence kind');
  assert.deepEqual([...TICKET_PERSONAS], ['hq_held', 'admin_product', 'hq_staff', 'account_closed', 'not_on_record']);
});

// ──────────────────────────────────────────────── one definition of open ──

test('open means open and in progress, and the read binds exactly that many placeholders', () => {
  assert.deepEqual([...OPEN_TICKET_STATUSES], ['open', 'in_progress']);
  const src = read('cloudflare-worker/src/services/supportQueues.ts');
  const inList = /WHERE t\.status IN \(([^)]*)\)/.exec(src);
  assert.ok(inList, 'the open-ticket read no longer filters with an IN list');
  assert.equal((inList[1].match(/\?/g) || []).length, OPEN_TICKET_STATUSES.length,
    'the IN list binds a different number of statuses from the tuple that fills it');
  assert.match(src, /\.bind\(\.\.\.OPEN_TICKET_STATUSES, OPEN_TICKET_CEILING \+ 1\)/);
});

test('HQ Home reads the backlog through the one function, and no route counts it a second way', () => {
  const home = read('cloudflare-worker/src/routes/admin_hq.ts');
  assert.match(home, /await ticketBacklog\(env\)/, 'HQ Home no longer reads the shared backlog');
  assert.doesNotMatch(home, /FROM tickets GROUP BY status/, 'HQ Home counts the ticket queue with its own statement again');
  // The unreadable state keeps its own sentence on Home (hq_home.test pins it).
  assert.match(home, /queue = \{ available: false, reason:/);
});

test('the five buckets foot to the backlog HQ Home shows — on one fixture, not two definitions', async () => {
  const db = seed(freshDb());
  const env = envFor(db);
  const backlog = await ticketBacklog(env);
  assert.equal(backlog.open, 10, 'resolved and closed tickets were counted as open, or open ones were missed');
  const { status, body } = await getSupport(env);
  assert.equal(status, 200);
  const b = body.tickets.buckets;
  const sum = TICKET_PERSONAS.reduce((n, p) => n + b[p].count, 0);
  assert.equal(sum, backlog.open, 'the buckets do not foot to the backlog');
  assert.equal(body.tickets.open, backlog.open);
  assert.deepEqual(
    Object.fromEntries(TICKET_PERSONAS.map((p) => [p, b[p].count])),
    { hq_held: 2, admin_product: 4, hq_staff: 1, account_closed: 1, not_on_record: 2 },
  );
});

// ───────────────────────────────────────────────────────── the route ──

test('only the elevation reads it', async () => {
  const env = envFor(seed(freshDb()));
  assert.equal((await getSupport(env, PLAIN_ADMIN)).status, 403);
  assert.equal((await getSupport(env, HOLDER)).status, 200);
});

test('escalations: a count, three SLA bands, the oldest first, and nothing answered', async () => {
  const { body } = await getSupport(envFor(seed(freshDb())));
  const e = body.escalations;
  assert.equal(e.available, true);
  assert.equal(e.complete, true);
  assert.equal(e.count, 4, 'an answered escalation was counted, or an open one was missed');
  // due_soon is its own band — the old page folded it into "open".
  assert.deepEqual(e.bands, { ok: 2, due_soon: 1, past: 1 });
  assert.deepEqual(e.items.map((x: any) => x.uid), ['esc_past', 'esc_soon', 'esc_ok', 'esc_orphan']);
  assert.equal(Math.floor(e.oldest_age_hours), 96);
  assert.equal(e.items[0].sla, 'past');
  assert.equal(e.items[1].sla, 'due_soon');
  assert.equal(Math.floor(e.items[1].age_hours), 31);
});

test('tickets: each queue lists its oldest with who filed it, and a bound administrator names the licence', async () => {
  const { body } = await getSupport(envFor(seed(freshDb())));
  const held = body.tickets.buckets.hq_held;
  assert.deepEqual(held.items.map((x: any) => x.id), [1, 2]);
  assert.equal(held.items[0].requester, 'D. Raghunathan');
  assert.equal(held.items[0].licence, null);
  assert.equal(Math.floor(held.oldest_age_hours), 18);
  const admin = body.tickets.buckets.admin_product;
  assert.deepEqual(admin.items.map((x: any) => x.id), [4, 5, 11, 6]);
  assert.deepEqual(admin.items[0].licence, { uid: 'lic_fr', licence_ref: 'AXL-001', brand_name: 'Axal VC France' });
  assert.equal(admin.items[1].licence.uid, 'lic_wl', 'a white-label administrator left the Admin-product queue');
  assert.deepEqual(body.tickets.buckets.not_on_record.items.map((x: any) => x.id), [9, 10]);
  assert.equal(body.list_limit, SUPPORT_LIST_LIMIT);
});

test('the total is the three queues, and its oldest names the queue it came from', async () => {
  const { body } = await getSupport(envFor(seed(freshDb())));
  assert.equal(body.total.value, 4 + 2 + 4);
  assert.equal(body.total.oldest.queue, 'escalations');
  assert.equal(Math.floor(body.total.oldest.age_hours), 96);
});

test('the matrix: HQ first, a row per licence, and every blank cell says why', async () => {
  const { body } = await getSupport(envFor(seed(freshDb())));
  const m = body.matrix;
  assert.equal(m.available, true);
  assert.deepEqual(m.rows.map((r: any) => r.key), ['hq', 'lic_fr', 'lic_wl', 'lic_draft', 'lic_late', 'unattributed']);
  assert.equal(m.omitted_terminated, 1, 'the terminated licence with nothing open was not counted as omitted');

  const [hq, fr, wl, draft, late, orphan] = m.rows;
  assert.equal(hq.kind, 'hq');
  assert.deepEqual(hq.escalations, { value: null, why: 'does_not_apply', reason: MATRIX_REASONS.hqEscalations });
  assert.equal(hq.hq_held.value, 2);
  assert.equal(hq.about_admin.why, 'does_not_apply');

  // A deployed licence: escalations counted by its code; its About-Admin cell
  // is on the branch, and NEVER the smaller axal.vc count.
  assert.equal(fr.branch_code, 'fr');
  assert.equal(fr.escalations.value, 3);
  assert.equal(Math.floor(fr.escalations.oldest_age_hours), 96);
  assert.equal(fr.about_admin.value, null);
  assert.equal(fr.about_admin.why, 'branch_database');
  assert.match(fr.about_admin.reason, /fr\.axal\.vc/);
  assert.match(fr.about_admin.reason, /1 filed on axal\.vc is in the queue above\./);
  assert.equal(fr.hq_held.why, 'does_not_apply');

  // Undeployed: nothing can be raised from it, and its administrators file here.
  assert.deepEqual(wl.escalations, { value: null, why: 'does_not_apply', reason: MATRIX_REASONS.undeployedEscalations });
  assert.equal(wl.about_admin.value, 2);
  assert.equal(Math.floor(wl.about_admin.oldest_age_hours), 9);
  // A measured zero is a figure.
  assert.deepEqual(draft.about_admin, { value: 0, oldest_age_hours: null });
  // A terminated licence with an open item is still listed.
  assert.equal(late.status, 'terminated');
  assert.equal(late.about_admin.value, 1);
  // An escalation from a code no licence holds is counted, not dropped.
  assert.equal(orphan.kind, 'unattributed');
  assert.match(orphan.label, /xx/);
  assert.equal(orphan.escalations.value, 1);
});

test('the mirror strip counts the last day from each ticket, and does not invent a lag', async () => {
  const { body } = await getSupport(envFor(seed(freshDb())));
  assert.deepEqual(body.sync, {
    available: true, window_hours: SYNC_WINDOW_HOURS,
    synced: 1, failed: 1, not_configured: 1,
    lag: { value: null, reason: SYNC_LAG_REASON },
  });
});

test('the window the strip names is the window its statement counts', () => {
  const src = read('cloudflare-worker/src/services/supportQueues.ts');
  assert.ok(src.includes(`datetime('now', '-${SYNC_WINDOW_HOURS} hours')`),
    'SYNC_WINDOW_HOURS and the literal in the SQL have come apart');
  // Both sides normalised: the column is compared through datetime(), which is
  // what check-timestamp-comparisons now watches on `attempted_at`.
  assert.match(src, /WHERE datetime\(github_sync_attempted_at\) > datetime\('now'/);
  const guard = read('scripts/check-timestamp-comparisons.mjs');
  assert.match(/const TTL_COLUMN = '([^']*)'/.exec(guard)?.[1] || '', /\|attempted_at\b/,
    'attempted_at is no longer on the timestamp guard’s list');
});

// ───────────────────────────────────────────── every read fails alone ──

test('no escalation board: its queue and cells say unreadable, and the tickets are untouched', async () => {
  const db = seed(freshDb(['hq_escalations']), ['hq_escalations']);
  const { status, body } = await getSupport(envFor(db));
  assert.equal(status, 200);
  assert.deepEqual(body.escalations, { available: false, reason: ESCALATIONS_UNREADABLE });
  assert.equal(body.tickets.available, true);
  assert.equal(body.tickets.open, 10);
  assert.equal(body.total.value, null, 'a total was computed without one of its terms');
  assert.match(body.total.reason, /Escalations could not be read/);
  const fr = body.matrix.rows.find((r: any) => r.key === 'lic_fr');
  assert.deepEqual(fr.escalations, { value: null, why: 'unreadable', reason: ESCALATIONS_UNREADABLE });
  assert.equal(body.matrix.rows.some((r: any) => r.kind === 'unattributed'), false,
    'an unattributed row was drawn from a board that could not be read');
});

test('no deployment registry: which licence has a branch is unknown, so nothing is claimed about it', async () => {
  const db = seed(freshDb(['licence_deployments']), ['licence_deployments']);
  const { body } = await getSupport(envFor(db));
  const fr = body.matrix.rows.find((r: any) => r.key === 'lic_fr');
  assert.deepEqual(fr.escalations, { value: null, why: 'unreadable', reason: DEPLOYMENTS_UNREADABLE });
  assert.deepEqual(fr.about_admin, { value: null, why: 'unreadable', reason: MATRIX_REASONS.deploymentUnknown });
  // A terminated licence is omitted only when the reads PROVE it has nothing.
  assert.equal(body.matrix.omitted_terminated, 0);
  assert.ok(body.matrix.rows.some((r: any) => r.key === 'lic_old'), 'a terminated licence was dropped on an unreadable read');
  assert.equal(body.matrix.rows.some((r: any) => r.kind === 'unattributed'), false);
  // The queues do not depend on the registry.
  assert.equal(body.tickets.buckets.admin_product.count, 4);
});

test('no migration 273: the strip is unreadable, the queues are not, and the GET alters nothing', async () => {
  const db = seed(freshDb(['m273']), ['m273']);
  const { body } = await getSupport(envFor(db));
  assert.deepEqual(body.sync, { available: false, reason: SYNC_UNREADABLE });
  assert.equal(body.tickets.available, true, 'the queue read reached a column migration 273 added');
  assert.equal(body.tickets.open, 10);
  const cols = (db.prepare('PRAGMA table_info(tickets)').all() as any[]).map((c) => c.name);
  assert.equal(cols.includes('github_sync_status'), false, 'a read-only page ran the sync schema bootstrap');
});

test('no tickets table: both ticket queues are unreadable, never zero, and HQ’s cell says so', async () => {
  const db = seed(freshDb(['tickets']), ['tickets']);
  const { body } = await getSupport(envFor(db));
  assert.deepEqual(body.tickets, { available: false, reason: TICKETS_UNREADABLE });
  assert.equal(body.sync.available, false);
  assert.equal(body.total.value, null);
  assert.equal(body.escalations.available, true, 'the escalation queue failed with the tickets');
  const hq = body.matrix.rows[0];
  assert.deepEqual(hq.hq_held, { value: null, why: 'unreadable', reason: TICKETS_UNREADABLE });
});

// ──────────────────────────────────────────────────────── the ceilings ──

test('past the escalation ceiling: no count, no bands, the oldest still exact, and no total', async () => {
  const db = seed(freshDb());
  const e = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at, created_at)
     VALUES (?, 'fr', 'other', 'bulk', 'open', ?, datetime('now', '-1 minutes'))`,
  );
  db.exec('BEGIN');
  for (let i = 0; i < OPEN_ESCALATION_CEILING; i++) e.run(`bulk_${i}`, iso(48 * H));
  db.exec('COMMIT');
  const { body } = await getSupport(envFor(db));
  assert.equal(body.escalations.complete, false);
  assert.equal(body.escalations.count, null, 'a capped count was shown as the total');
  assert.equal(body.escalations.bands, null, 'bands were drawn from a cut read');
  assert.equal(body.escalations.items.length, SUPPORT_LIST_LIMIT);
  assert.equal(body.escalations.items[0].uid, 'esc_past', 'the oldest item is no longer the oldest past the ceiling');
  assert.equal(body.total.value, null);
  const fr = body.matrix.rows.find((r: any) => r.key === 'lic_fr');
  assert.deepEqual(fr.escalations, { value: null, why: 'incomplete', reason: MATRIX_REASONS.escalationsIncomplete });
});

test('past the ticket ceiling: counts are withheld while the oldest stay listed', () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1, title: `t${i}`, status: 'open', priority: 'medium', created_at: '2026-09-20 10:00:00',
    account_id: 10, requester_name: 'A', requester_email: null, requester_role: 'founder',
    requester_active: 1, licence_uid: null, licence_ref: null, licence_brand: null,
  }));
  const cut = summariseTickets({ complete: false, rows }, Date.parse('2026-09-21T10:00:00Z'));
  assert.equal(cut.open, null);
  for (const p of TICKET_PERSONAS) assert.equal(cut.buckets[p].count, null, `${p} kept a cut count`);
  assert.equal(cut.buckets.hq_held.items.length, 3);
  assert.equal(cut.buckets.hq_held.oldest_age_hours, 24);
  const whole = summariseTickets({ complete: true, rows }, Date.parse('2026-09-21T10:00:00Z'));
  assert.equal(whole.open, 3);
  assert.equal(whole.buckets.hq_held.count, 3);
  assert.equal(OPEN_TICKET_CEILING, 5000);
});

// ────────────────────────────────────────── one statement, two readers ──

test('HQ Home’s escalation list is the oldest few of the one statement', async () => {
  const env = envFor(seed(freshDb()));
  const all = await openEscalationSummary(env);
  const two = await openEscalations(env, 2);
  assert.deepEqual(two.map((x) => x.uid), all.items.slice(0, 2).map((x) => x.uid));
  const src = read('cloudflare-worker/src/rpc/hqOps.ts');
  assert.equal((src.match(/FROM hq_escalations\s+WHERE status = 'open'/g) || []).length, 1,
    'a second statement defines an open escalation');
});

test('the route is mounted before the /api/admin catch-all', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const mount = src.indexOf("app.route('/api/admin/hq-support', adminHqSupport)");
  const catchAll = src.indexOf("app.route('/api/admin', admin)");
  assert.ok(mount > -1, 'the Support route is not mounted');
  assert.ok(mount < catchAll, 'the Support route is mounted after the catch-all, which would answer it first');
});

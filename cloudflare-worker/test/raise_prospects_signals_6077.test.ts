/**
 * D6077 (#6077) — `GET /api/contacts/raise-prospects` carries each investor's
 * Fit, Source (`via_call`) and last contact, derived as the Cycle table
 * derives them (`services/raiseCycle.ts` `prospectSignals`), so Capital
 * relationships' Pipeline can filter and sort on them.
 *
 * The real contacts router against the full schema (baseline plus every
 * migration). Covers: Fit from a served directory fund and "not recorded"
 * otherwise; last contact from the stored contact's activity only; via_call
 * only while round calls are on; a read across ventures is not enriched; a
 * failing signals read leaves the prospects readable and says so; another
 * founder's venture yields nothing.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_prospects_signals_6077.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import contacts from '../src/routes/contacts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, OTHER = 11, INVESTOR = 20;
const P = 1, P_OTHER = 2;

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay', 'fay@example.test', 1001);
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(OTHER, 'founder', 'Oz', 'oz@example.test', 1002);
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(INVESTOR, 'investor', 'Ivy', 'ivy@fund.example');
  db.exec(`INSERT INTO projects (id, name, founder_id, sector) VALUES (${P}, 'Kestrel Labs', 1001, 'artificial intelligence'), (${P_OTHER}, 'Beta Works', 1002, NULL)`);
  db.exec(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on) VALUES
           ('Made-up open list', 'Open list', 'not found', 'e', 'cite only', 'r', '2026-10-01'),
           ('Made-up closed list', 'Closed list', 'not found', 'e', 'not allowed', 'r', '2026-10-01')`);
  db.exec(`INSERT INTO research_fund_directory (uid, name, sector_focus, source_name, source_url, as_of) VALUES
           ('fund-ai', 'Gridline AI Fund', 'AI', 'Made-up open list', 'https://example.test/a', '2026-10-01'),
           ('fund-fin', 'Ledger Seed', 'Fintech', 'Made-up open list', 'https://example.test/b', '2026-10-01'),
           ('fund-hid', 'Hidden Partners', 'AI', 'Made-up closed list', 'https://example.test/c', '2026-10-01')`);
  db.exec(`INSERT INTO contacts (id, uid, project_id, audience, email, name, last_activity_at) VALUES
           (100, 'c100', ${P}, 'investor', 'ivy@fund.example', 'Ivy', '2026-10-12 10:00:00'),
           (101, 'c101', ${P_OTHER}, 'investor', 'x@else.example', 'Elsewhere', '2026-10-13 10:00:00')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, contact_id, name, email, stage, research_fund_uid, updated_at) VALUES
           (20, 'p20', ${P}, 100, 'Gridline AI Fund', 'ivy@fund.example', 'contacted', 'fund-ai', '2026-10-10 09:00:00'),
           (21, 'p21', ${P}, NULL, 'Ledger Seed', NULL, 'meeting', 'fund-fin', '2026-10-11 09:00:00'),
           (22, 'p22', ${P}, NULL, 'Hidden Partners', NULL, 'contacted', 'fund-hid', '2026-10-11 09:00:00'),
           (23, 'p23', ${P}, 101, 'Plain Angel', NULL, 'to_contact', NULL, '2026-10-09 09:00:00'),
           (30, 'p30', ${P_OTHER}, 101, 'Elsewhere Fund', NULL, 'meeting', NULL, '2026-10-11 09:00:00')`);
  db.exec(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
           VALUES (5, 'rc5', ${P}, 'Seed call', 100000000, 'safe', 't', 1000000, '2026-12-01', 'sent', 'h', ${FOUNDER})`);
  db.exec(`INSERT INTO round_call_recipients (call_id, investor_user_id, origin, responded_at) VALUES (5, ${INVESTOR}, 'chosen', '2026-10-15 10:00:00')`);
  return db;
}

async function read(db: DatabaseSync, path: string, { as = FOUNDER, calls = false } = {}) {
  const token = await new SignJWT({ user_id: as, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(calls ? { ROUND_CALLS_ENABLED: 'true' } : {}) };
  const res = await contacts.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}
const byId = (items: any[]) => Object.fromEntries(items.map((p) => [p.id, { fit: p.fit, via_call: p.via_call, last_contact: p.last_contact }]));

test('a one-venture read carries Fit, Source and last contact as the Cycle table derives them', async () => {
  const r = await read(seeded(), `/raise-prospects?project_id=${P}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.signals, 'ok');
  assert.equal(r.body.round_calls, false);
  assert.deepEqual(byId(r.body.items), {
    20: { fit: 'fits', via_call: false, last_contact: '2026-10-12 10:00:00' },
    21: { fit: 'outside', via_call: false, last_contact: null },
    // A fund on a list whose terms say 'not allowed' is never read: no Fit.
    22: { fit: 'not_recorded', via_call: false, last_contact: null },
    // Contact 101 belongs to another venture: its activity is not this prospect's last contact.
    23: { fit: 'not_recorded', via_call: false, last_contact: null },
  });
});

test('Source: a responder to the venture\'s round call reads via_call only while round calls are on', async () => {
  const r = await read(seeded(), `/raise-prospects?project_id=${P}`, { calls: true });
  assert.equal(r.body.round_calls, true);
  assert.deepEqual(r.body.items.filter((p: any) => p.via_call).map((p: any) => p.id), [20]);
});

test('a read across ventures is not enriched, and says so', async () => {
  const r = await read(seeded(), '/raise-prospects');
  assert.equal(r.status, 200);
  assert.equal(r.body.signals, 'not_read');
  assert.ok(r.body.items.length > 0);
  assert.ok(r.body.items.every((p: any) => !('fit' in p) && !('via_call' in p)));
});

test('a failing signals read leaves the prospects readable and says Unreadable', async () => {
  const db = seeded();
  db.exec('DROP TABLE research_fund_sources');
  const r = await read(db, `/raise-prospects?project_id=${P}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.signals, 'unreadable');
  assert.deepEqual(r.body.items.map((p: any) => p.id).sort(), [20, 21, 22, 23]);
  assert.ok(r.body.items.every((p: any) => !('fit' in p)));
});

test('another founder\'s venture yields no prospect and no signal', async () => {
  const r = await read(seeded(), `/raise-prospects?project_id=${P_OTHER}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  const own = await read(seeded(), `/raise-prospects?project_id=${P_OTHER}`, { as: OTHER });
  assert.deepEqual(byId(own.body.items), { 30: { fit: 'not_recorded', via_call: false, last_contact: '2026-10-13 10:00:00' } });
});

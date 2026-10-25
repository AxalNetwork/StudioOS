// D1117 (#2997): the Deals list's Due diligence column and its lapsed-invitation
// cross-check are joined on the Worker (D926's list), not against the browser's
// capped lists. Real migrated SQLite and synthetic accounts; no mail is sent.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/partner_deal_list_joins_d1117.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { envFor, token } from './_esign_harness.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'partner-d1117-'));
const seed = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
schema.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
for (const name of readdirSync('cloudflare-worker/sql/migrations').filter(n => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
  schema.exec(read('cloudflare-worker/sql/migrations/' + name));
}
schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const DAY = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const stamp = (offsetDays: number) => iso(offsetDays).slice(0, 19).replace('T', ' ');

let serial = 0;
function fixture() {
  const file = join(scratch, `${++serial}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users(id,role,name,email,is_active) VALUES
    (5,'admin','Synthetic inviter','inviter@example.invalid',1),
    (10,'partner','Synthetic partner A','a.partner@example.invalid',1),
    (11,'partner','Synthetic partner B','b.partner@example.invalid',1),
    (12,'partner','Synthetic partner C','c.partner@example.invalid',1),
    (13,'partner','Synthetic partner D','d.partner@example.invalid',1)`);
  const env: any = envFor(db);
  const app = new Hono<any>().route('/', adminPartners);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function get(f: F, path: string) {
  const r = await f.app.request(path, { method: 'GET', headers: { Authorization: 'Bearer ' + await token(5, 'admin') } }, f.env);
  return { status: r.status, body: await r.json() as any };
}

function invite(f: F, status: string, expires: number): number {
  return Number(f.db.prepare(`INSERT INTO partner_invitations
      (token, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types, status, expires_at, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), `inv-${crypto.randomUUID()}@example.invalid`, 'Synthetic invitee', 5,
    JSON.stringify(['custom']), status, iso(expires), stamp(-30)).lastInsertRowid);
}
function deal(f: F, d: { inv?: number | null; user?: number | null; status: string; created: number }): number {
  return Number(f.db.prepare(`INSERT INTO partner_deals (invitation_id, user_id, deal_type, proposal_json, status, created_at)
      VALUES (?,?,?,?,?,?)`).run(d.inv ?? null, d.user ?? null, 'custom', '{}', d.status, stamp(d.created)).lastInsertRowid);
}
function ddCase(f: F, subject: number, status: string, created: number): string {
  const uid = `dd_${crypto.randomUUID().slice(0, 8)}`;
  f.db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, status, owner_user_id, created_at)
      VALUES (?, 'partner', ?, 'Synthetic', ?, 5, ?)`).run(uid, subject, status, stamp(created));
  return uid;
}
const byId = (r: any) => new Map(r.body.items.map((i: any) => [i.id, i]));

test('the Due diligence column comes with each row: right past any list cap, an open case before an older or archived one', async () => {
  const f = fixture();
  // A's open case is the oldest of 251 partner cases: past the 200 the browser's R9 read held.
  const aOpen = ddCase(f, 10, 'open', -200);
  for (let i = 0; i < 250; i++) ddCase(f, 1000 + i, 'open', -i);
  // B has an archived case newer than its open one: the open one is the live case.
  ddCase(f, 11, 'archived', -1);
  const bOpen = ddCase(f, 11, 'in_review', -50);
  // C has only finished cases: the newest.
  ddCase(f, 12, 'archived', -40);
  const cDone = ddCase(f, 12, 'completed', -10);
  const d = {
    a: deal(f, { user: 10, status: 'active', created: -5 }),
    b: deal(f, { user: 11, status: 'active', created: -4 }),
    c: deal(f, { user: 12, status: 'active', created: -3 }),
    none: deal(f, { user: 13, status: 'active', created: -2 }),
    unsigned: deal(f, { inv: invite(f, 'selected', 5), status: 'proposed', created: -1 }),
  };
  const r = await get(f, '/deals?status=all');
  assert.equal(r.status, 200);
  const rows = byId(r) as Map<number, any>;
  assert.deepEqual(rows.get(d.a).due_diligence, { state: 'case', uid: aOpen, status: 'open' });
  assert.deepEqual(rows.get(d.b).due_diligence, { state: 'case', uid: bOpen, status: 'in_review' });
  assert.deepEqual(rows.get(d.c).due_diligence, { state: 'case', uid: cDone, status: 'completed' });
  assert.deepEqual(rows.get(d.none).due_diligence, { state: 'none' }, 'a member with no case has none, never Open');
  assert.deepEqual(rows.get(d.unsigned).due_diligence, { state: 'not_opened' }, 'no member yet: not opened before signing');
  for (const row of rows.values()) {
    for (const k of ['dd_case_uid', 'dd_case_status', 'invitation_row_id', 'invitation_status', 'invitation_expires_at']) assert.equal(k in row, false, k);
  }
});

test('the lapsed cross-check comes with each row: its own invitation, by D927\'s rule', async () => {
  const f = fixture();
  const d = {
    lapsed: deal(f, { inv: invite(f, 'viewed', -2), status: 'proposed', created: -4 }),
    open: deal(f, { inv: invite(f, 'selected', 6), status: 'awaiting_signature', created: -3 }),
    signed: deal(f, { inv: invite(f, 'signed', -9), user: 10, status: 'active', created: -2 }),
    alone: deal(f, { user: 11, status: 'active', created: -1 }),
  };
  const rows = byId(await get(f, '/deals?status=all')) as Map<number, any>;
  assert.equal(rows.get(d.lapsed).invitation_lapsed, true, 'an open stage past its expiry has lapsed');
  assert.equal(rows.get(d.open).invitation_lapsed, false);
  assert.equal(rows.get(d.signed).invitation_lapsed, false, 'a signed invitation never lapses');
  assert.equal(rows.get(d.alone).invitation_lapsed, null, 'no invitation row: not known, never false');
});

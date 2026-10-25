// D926 (#2722): the invitation and deal lists' server-side search, filters,
// sorts, pages and totals, and the create lookup. Real migrated SQLite and
// synthetic accounts; no mail is sent.
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
const scratch = mkdtempSync(join(tmpdir(), 'partner-d926-'));
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
/** D1's own zone-less stamp, as CURRENT_TIMESTAMP writes it. */
const stamp = (offsetDays: number) => iso(offsetDays).slice(0, 19).replace('T', ' ');

let serial = 0;
function fixture() {
  const file = join(scratch, `${++serial}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users(id,role,name,email,is_active) VALUES
    (5,'admin','Synthetic inviter','inviter@example.invalid',1),
    (6,'admin','Synthetic second inviter','second@example.invalid',1),
    (9,'founder','Synthetic founder','Member@Example.invalid',1),
    (10,'partner','Synthetic signed partner','signed.partner@example.invalid',1)`);
  const env: any = envFor(db);
  const app = new Hono<any>().route('/', adminPartners);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function get(f: F, path: string, who: number | null = 5) {
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await token(who, who === 9 ? 'founder' : 'admin');
  const r = await f.app.request(path, { method: 'GET', headers }, f.env);
  return { status: r.status, body: await r.json() as any };
}

type Inv = { name?: string | null; email: string; status?: string; by?: number; types?: string[]; created: number; expires: number };
function invite(f: F, i: Inv): number {
  return Number(f.db.prepare(`INSERT INTO partner_invitations
      (token, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types, status, expires_at, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), i.email, i.name ?? null, i.by ?? 5, JSON.stringify(i.types ?? ['custom']),
    i.status ?? 'sent', iso(i.expires), stamp(i.created)).lastInsertRowid);
}

/**
 * Eight invitations, one of each shape the filters must tell apart:
 *   Ada   sent,      open,   newest
 *   Ben   viewed,    LAPSED  (stored stage kept)
 *   Cleo  finalized, open,   expires soonest of the open
 *   (no name) proposed, open, second inviter, offers capital in position 4
 *   Dev   signed,    past its expiry — closed, never lapsed
 *   Eve   revoked,   past its expiry — closed
 *   Fay   expired (stored: signed after the lapse), closed
 *   Gus   sent,      a wildcard-bearing address, oldest
 */
function invitations(f: F) {
  return {
    ada: invite(f, { name: 'Ada Synthetic', email: 'ada@example.invalid', status: 'sent', types: ['equity_partnership'], created: -1, expires: 13 }),
    ben: invite(f, { name: 'Ben Synthetic', email: 'ben@example.invalid', status: 'viewed', types: ['services_partnership'], created: -20, expires: -6 }),
    cleo: invite(f, { name: 'cleo Synthetic', email: 'cleo@example.invalid', status: 'finalized', types: ['custom', 'equity_partnership'], created: -10, expires: 4 }),
    anon: invite(f, { name: null, email: 'nobody@example.invalid', status: 'proposed', by: 6, types: ['custom', 'custom', 'equity_partnership', 'capital_partnership'], created: -5, expires: 9 }),
    dev: invite(f, { name: 'Dev Synthetic', email: 'dev@example.invalid', status: 'signed', created: -40, expires: -26 }),
    eve: invite(f, { name: 'Eve Synthetic', email: 'eve@example.invalid', status: 'revoked', created: -29, expires: -16 }),
    fay: invite(f, { name: 'Fay Synthetic', email: 'fay@example.invalid', status: 'expired', created: -50, expires: -36 }),
    gus: invite(f, { name: 'Gus Synthetic', email: 'gus_50%\\x@example.invalid', status: 'sent', created: -60, expires: 2 }),
  };
}
const ids = (r: any) => r.body.items.map((i: any) => i.id);

test('with no new parameters the invitation list answers as it did: the newest first, today\'s fields, plus the inviter\'s id and an exact total', async () => {
  const f = fixture();
  const v = invitations(f);
  const r = await get(f, '/invitations');
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), [v.ada, v.anon, v.cleo, v.ben, v.eve, v.dev, v.fay, v.gus]);
  assert.equal(r.body.total, 8);
  assert.equal(r.body.limit, 200);
  assert.equal(r.body.offset, 0);
  const anon = r.body.items.find((i: any) => i.id === v.anon);
  assert.equal(anon.invited_by_user_id, 6);
  assert.equal(anon.invited_by_name, 'Synthetic second inviter');
  for (const key of ['token', 'recipient_email', 'allowed_deal_types', 'status', 'expires_at', 'link', 'is_expired', 'send_count', 'last_send_ok']) {
    assert.ok(key in anon, `today's field ${key} is still answered`);
  }
  assert.ok(!('lapsed_now' in anon), 'the computed column stays inside the query');
  assert.equal(r.body.items.find((i: any) => i.id === v.ben).is_expired, true);
  // Today's two filters still apply.
  assert.deepEqual(ids(await get(f, '/invitations?status=signed')), [v.dev]);
  assert.deepEqual(ids(await get(f, '/invitations?email=CLEO')), [v.cleo]);
});

test('q searches name or email, case-insensitively, with its wildcards escaped', async () => {
  const f = fixture();
  const v = invitations(f);
  assert.deepEqual(ids(await get(f, '/invitations?q=CLEO%20syn')), [v.cleo], 'by name');
  assert.deepEqual(ids(await get(f, '/invitations?q=nobody@')), [v.anon], 'by email, for an invitation with no name');
  for (const needle of ['%', '_', '\\']) {
    const r = await get(f, '/invitations?q=' + encodeURIComponent(needle));
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r), [v.gus], `a literal ${needle} matches itself and nothing else`);
    assert.equal(r.body.total, 1);
  }
  assert.equal((await get(f, '/invitations?q=%20%20')).body.total, 8, 'a blank search is no search');
});

test('stage takes one or several stored stages and lapsed; lapsed is computed, and closed rows never lapse', async () => {
  const f = fixture();
  const v = invitations(f);
  assert.deepEqual(ids(await get(f, '/invitations?stage=lapsed')), [v.ben]);
  assert.deepEqual(ids(await get(f, '/invitations?stage=viewed')), [], 'a lapsed row answers to Lapsed, not its stored stage');
  assert.equal(f.db.prepare('SELECT status FROM partner_invitations WHERE id=?').get(v.ben).status, 'viewed', 'the read writes nothing');
  assert.deepEqual(ids(await get(f, '/invitations?stage=sent')), [v.ada, v.gus]);
  assert.deepEqual(ids(await get(f, '/invitations?stage=sent&stage=lapsed')), [v.ada, v.ben, v.gus], 'repeated');
  assert.deepEqual(ids(await get(f, '/invitations?stage=signed,revoked,expired')), [v.eve, v.dev, v.fay], 'comma-separated; past expiry yet not lapsed');
  const bad = await get(f, '/invitations?stage=lapsed,opened');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'unknown_stage');
});

test('deal_type matches a type the invitation offered among its first three; invited_by and sent_within narrow it', async () => {
  const f = fixture();
  const v = invitations(f);
  assert.deepEqual(ids(await get(f, '/invitations?deal_type=equity_partnership')), [v.ada, v.anon, v.cleo]);
  assert.deepEqual(ids(await get(f, '/invitations?deal_type=capital_partnership')), [], 'the fourth type was never offered to the invitee');
  assert.equal((await get(f, '/invitations?deal_type=founder_pro')).status, 400);
  assert.deepEqual(ids(await get(f, '/invitations?invited_by=6')), [v.anon]);
  assert.equal((await get(f, '/invitations?invited_by=six')).status, 400);
  assert.deepEqual(ids(await get(f, '/invitations?sent_within=7')), [v.ada, v.anon]);
  assert.deepEqual(ids(await get(f, '/invitations?sent_within=30')), [v.ada, v.anon, v.cleo, v.ben, v.eve]);
  assert.equal((await get(f, '/invitations?sent_within=0')).status, 400);
  assert.deepEqual(ids(await get(f, '/invitations?deal_type=equity_partnership&sent_within=7&invited_by=5')), [v.ada], 'filters combine');
});

test('every invitation sort orders as the page does', async () => {
  const f = fixture();
  const v = invitations(f);
  const sorted = async (s: string) => ids(await get(f, '/invitations?sort=' + s));
  assert.deepEqual(await sorted('newest'), [v.ada, v.anon, v.cleo, v.ben, v.eve, v.dev, v.fay, v.gus]);
  // Open rows first (Lapsed is still open), oldest first; then the closed, oldest first.
  assert.deepEqual(await sorted('oldest_open'), [v.gus, v.ben, v.cleo, v.anon, v.ada, v.fay, v.dev, v.eve]);
  assert.deepEqual(await sorted('expires_soonest'), [v.ben, v.gus, v.cleo, v.anon, v.ada, v.fay, v.dev, v.eve]);
  // A–Z regardless of case; an invitation with no name last.
  assert.deepEqual(await sorted('name'), [v.ada, v.ben, v.cleo, v.dev, v.eve, v.fay, v.gus, v.anon]);
  // Sent, Offers shown, Agreement out, Signed, Lapsed, then Revoked and stored expired.
  assert.deepEqual(await sorted('stage'), [v.ada, v.gus, v.anon, v.cleo, v.dev, v.ben, v.eve, v.fay]);
  assert.equal((await get(f, '/invitations?sort=random')).status, 400);
});

test('pages: limit and offset walk past the first page, total stays exact, and an asked-for page is at most 100', async () => {
  const f = fixture();
  const v = invitations(f);
  const p1 = await get(f, '/invitations?sort=newest&limit=3');
  const p2 = await get(f, '/invitations?sort=newest&limit=3&offset=3');
  const p3 = await get(f, '/invitations?sort=newest&limit=3&offset=6');
  const past = await get(f, '/invitations?sort=newest&limit=3&offset=30');
  assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], [v.ada, v.anon, v.cleo, v.ben, v.eve, v.dev, v.fay, v.gus]);
  assert.deepEqual([p1.body.total, p2.body.total, p3.body.total, past.body.total], [8, 8, 8, 8]);
  assert.deepEqual(ids(past), []);
  assert.equal((await get(f, '/invitations?stage=sent&limit=1&offset=1')).body.total, 2, 'total counts the filtered set, not the page');
  for (let i = 0; i < 200; i++) invite(f, { email: `bulk${i}@example.invalid`, created: -100, expires: 5 });
  const capped = await get(f, '/invitations?limit=500');
  assert.equal(capped.body.items.length, 100);
  assert.equal(capped.body.limit, 100);
  const today = await get(f, '/invitations');
  assert.equal(today.body.items.length, 200, 'with no limit the cap is today\'s 200');
  assert.equal(today.body.total, 208, 'and the total says how many there are');
});

/* ------------------------------------------------------------------ */

type Deal = { inv?: number | null; user?: number | null; type?: string; status: string; code?: string | null; expires?: number | null; created: number };
function deal(f: F, d: Deal): number {
  return Number(f.db.prepare(`INSERT INTO partner_deals
      (invitation_id, user_id, deal_type, proposal_json, referral_code, status, expires_at, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
    d.inv ?? null, d.user ?? null, d.type ?? 'custom', '{"summary":"Synthetic"}', d.code ?? null, d.status,
    d.expires === null || d.expires === undefined ? null : iso(d.expires), stamp(d.created)).lastInsertRowid);
}
function redeem(f: F, dealId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const user = Number(f.db.prepare(`INSERT INTO users (role, name, email) VALUES ('founder', 'Synthetic redeemer', ?)`)
      .run(`redeemer-${crypto.randomUUID()}@example.invalid`).lastInsertRowid);
    f.db.prepare('INSERT INTO partner_referral_redemptions (partner_deal_id, redeemed_by_user_id) VALUES (?, ?)').run(dealId, user);
  }
}

/**
 *   soon   active, ends in 10 days, 1 redemption
 *   later  active, ends in 50 days, 3 redemptions, signed partner (user 10)
 *   open   active, no end date
 *   pre    proposed, unsigned: the partner is the invitation's Cleo
 *   gone   terminated
 *   void   voided, capital partnership, unsigned under an invitation with no name
 */
function deals(f: F, v: ReturnType<typeof invitations>) {
  const d = {
    soon: deal(f, { user: 10, type: 'services_partnership', status: 'active', code: 'SYN-SOON', expires: 10, created: -30 }),
    later: deal(f, { user: 10, type: 'equity_partnership', status: 'active', code: 'SYN-LATER', expires: 50, created: -20 }),
    open: deal(f, { user: 10, type: 'custom', status: 'active', code: 'SYN-OPEN', expires: null, created: -40 }),
    pre: deal(f, { inv: v.cleo, type: 'custom', status: 'proposed', created: -2 }),
    gone: deal(f, { user: 10, type: 'custom', status: 'terminated', code: 'SYN-GONE', expires: 5, created: -60 }),
    void: deal(f, { inv: v.anon, type: 'capital_partnership', status: 'voided', created: -1 }),
  };
  redeem(f, d.soon, 1);
  redeem(f, d.later, 3);
  return d;
}

test('with no new parameters the deal list answers Active, newest first, as it did; status=all now matches every state', async () => {
  const f = fixture();
  const d = deals(f, invitations(f));
  const r = await get(f, '/deals');
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), [d.later, d.soon, d.open]);
  assert.equal(r.body.total, 3);
  assert.equal(r.body.items[0].redemptions_count, 3);
  assert.equal(r.body.items[0].proposal.summary, 'Synthetic');
  assert.equal(r.body.items[0].proposal_json, undefined);
  assert.deepEqual(ids(await get(f, '/deals?status=voided')), [d.void], 'one state, as the page calls it today');
  const all = await get(f, '/deals?status=all');
  assert.deepEqual(ids(all), [d.void, d.pre, d.later, d.soon, d.open, d.gone]);
  assert.equal(all.body.total, 6);
  assert.deepEqual(ids(await get(f, '/deals?status=proposed&status=terminated')), [d.pre, d.gone], 'several states, repeated');
  assert.deepEqual(ids(await get(f, '/deals?status=proposed,voided')), [d.void, d.pre], 'several states, comma-separated');
  const bad = await get(f, '/deals?status=pending');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'unknown_status');
});

test('before signing, a deal\'s partner name and email come from its invitation', async () => {
  const f = fixture();
  const d = deals(f, invitations(f));
  const all = (await get(f, '/deals?status=all')).body.items;
  const pre = all.find((x: any) => x.id === d.pre);
  assert.equal(pre.partner_name, 'cleo Synthetic');
  assert.equal(pre.partner_email, 'cleo@example.invalid');
  const signed = all.find((x: any) => x.id === d.soon);
  assert.equal(signed.partner_name, 'Synthetic signed partner', 'after signing, the account\'s');
  assert.equal(signed.partner_email, 'signed.partner@example.invalid');
  assert.deepEqual(ids(await get(f, '/deals?status=all&q=CLEO')), [d.pre], 'search reaches the invitation\'s name');
  assert.deepEqual(ids(await get(f, '/deals?status=all&q=nobody@example')), [d.void], 'and its address, when there is no name');
});

test('deal filters: deal_type, ends_within, q by code, has_redemptions, and their refusals', async () => {
  const f = fixture();
  const d = deals(f, invitations(f));
  assert.deepEqual(ids(await get(f, '/deals?status=all&deal_type=capital_partnership')), [d.void]);
  assert.equal((await get(f, '/deals?deal_type=founder_pro')).status, 400);
  assert.deepEqual(ids(await get(f, '/deals?status=all&ends_within=30')), [d.soon], 'only an active deal ends within; the terminated one does not');
  assert.deepEqual(ids(await get(f, '/deals?ends_within=60')), [d.later, d.soon], 'a deal with no end never ends within');
  assert.equal((await get(f, '/deals?ends_within=-1')).status, 400);
  assert.deepEqual(ids(await get(f, '/deals?status=all&q=syn-g')), [d.gone], 'by referral code');
  assert.deepEqual(ids(await get(f, '/deals?q=' + encodeURIComponent('_'))), [], 'a wildcard is a literal');
  assert.deepEqual(ids(await get(f, '/deals?has_redemptions=true')), [d.later, d.soon]);
  assert.deepEqual(ids(await get(f, '/deals?has_redemptions=false')), [d.later, d.soon, d.open]);
  assert.equal((await get(f, '/deals?has_redemptions=maybe')).status, 400);
});

test('every deal sort, and paging past the first page with an exact total', async () => {
  const f = fixture();
  const d = deals(f, invitations(f));
  const sorted = async (s: string) => ids(await get(f, '/deals?status=all&sort=' + s));
  assert.deepEqual(await sorted('newest'), [d.void, d.pre, d.later, d.soon, d.open, d.gone]);
  // Active deals with an end, soonest first; then the rest, newest first.
  assert.deepEqual(await sorted('ends_soonest'), [d.soon, d.later, d.void, d.pre, d.open, d.gone]);
  assert.deepEqual(await sorted('most_redemptions'), [d.later, d.soon, d.void, d.pre, d.open, d.gone]);
  // A–Z on the partner; ties newest first. Cleo (pre) before the signed partner; no name sorts by its address.
  assert.deepEqual(await sorted('partner'), [d.pre, d.void, d.later, d.soon, d.open, d.gone]);
  assert.equal((await get(f, '/deals?sort=oldest')).status, 400);
  const p1 = await get(f, '/deals?status=all&limit=4');
  const p2 = await get(f, '/deals?status=all&limit=4&offset=4');
  assert.deepEqual([...ids(p1), ...ids(p2)], [d.void, d.pre, d.later, d.soon, d.open, d.gone]);
  assert.deepEqual([p1.body.total, p2.body.total], [6, 6]);
  assert.equal((await get(f, '/deals?status=all&limit=1000')).body.limit, 100);
});

/* ------------------------------------------------------------------ */

test('the create lookup: an open invitation (a lapsed one counts), the newest; a member\'s role and nothing else', async () => {
  const f = fixture();
  const v = invitations(f);
  const one = async (email: string) => (await get(f, '/invitations/lookup?email=' + encodeURIComponent(email))).body;

  const ada = await one('ADA@example.invalid');
  assert.equal(ada.open_invitation.id, v.ada, 'an exact, lower-cased match');
  assert.deepEqual(Object.keys(ada.open_invitation).sort(), ['created_at', 'id']);
  assert.equal(ada.member, null);
  assert.equal((await one('ben@example.invalid')).open_invitation.id, v.ben, 'a lapsed invitation is open: a resend reopens it');
  for (const closed of ['dev@example.invalid', 'eve@example.invalid', 'fay@example.invalid']) {
    assert.equal((await one(closed)).open_invitation, null, `${closed} is closed`);
  }
  assert.equal((await one('ada@example.inval')).open_invitation, null, 'no partial match');

  const newer = invite(f, { name: 'Ada again', email: 'ada@example.invalid', created: 0, expires: 14 });
  assert.equal((await one('ada@example.invalid')).open_invitation.id, newer, 'the newest open one');

  const member = await one('member@example.invalid');
  assert.deepEqual(member.member, { role: 'founder' }, 'the role only, matched across case');
  assert.equal(member.open_invitation, null);

  assert.equal((await get(f, '/invitations/lookup?email=not-an-address')).status, 400);
  assert.equal((await get(f, '/invitations/lookup')).status, 400);
});

test('every list and the lookup are admin-only', async () => {
  const f = fixture();
  for (const path of ['/invitations?q=a', '/deals?status=all', '/invitations/lookup?email=ada@example.invalid']) {
    assert.notEqual((await get(f, path, 9)).status, 200, `${path} refuses a founder`);
    assert.notEqual((await get(f, path, null)).status, 200, `${path} refuses no session`);
  }
});

test('the list SQL is static: no request text is spliced into a statement', () => {
  const src = read('cloudflare-worker/src/routes/admin_partners.ts');
  for (const [from, to] of [['const INVITATION_FILTERED', 'export const INVITATION_STAGES'], ['const DEAL_FILTERED', 'export const DEAL_STATES']]) {
    const block = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(block.length > 200, `${from} found`);
    assert.ok(!block.includes('${'), `${from} interpolates nothing`);
  }
  for (const name of ['INVITATION_PAGE_SQL', 'INVITATION_COUNT_SQL', 'DEAL_PAGE_SQL', 'DEAL_COUNT_SQL']) {
    assert.ok(src.includes(`.prepare(${name})`), `${name} is prepared as written`);
  }
});

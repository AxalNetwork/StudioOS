/**
 * D6114 (#6114) — a partner's deal and an obligation's agenda item can be
 * corrected or removed, not only added.
 *
 *   1  The reads: each deal (for a writer) and each agenda item names its uid,
 *      with Edit carrying its own values and Remove; both declared row-only,
 *      Remove behind a confirmation with a danger tone. A reader who is not a
 *      writer gets no row action and never a customer's name.
 *   2  Deal Edit: only the sent keys change; a blank customer is refused; an
 *      amount keeps its currency, a cleared amount clears it; logged on the
 *      partner without the customer.
 *   3  Deal Remove: deletes the one deal, logged; the partner then has no deal
 *      and may itself be removed (D6115's rule).
 *   4  Agenda Edit and Remove: only the sent keys change, a blank item is
 *      refused, the one item goes; each logged on the obligation, never its text.
 *   5  Refusals: another venture's row, this venture's row under another
 *      parent, and no row at all are each a 404 that writes and logs nothing;
 *      `ownedRow` resolves both stores within their venture.
 *
 * Every name and value is made up. The database is the baseline plus every
 * migration, in memory, through `_schema_once.mjs`.
 *
 * Mutation checked (each broke a test below, then was restored):
 *   · growWriters.ts updatePartnerDeal allowing a blank customer to keep the old one → test 2 fails.
 *   · growWriters.ts updateAgendaItem's log dropped from the batch → test 4 fails.
 *   Equivalent (survives, by design): grow.ts deals section attaching actions for a reader too;
 *   cycle_records.ts strips row actions for non-writers (D6113), so test 1 still sees none.
 *   · growWriters.ts `partnerDeal` without `AND p.uid = ?` → test 5 fails (another partner's deal is changed).
 *   · growWriters.ts `agendaItem` without `AND e.id = ?` → test 5 fails (another obligation's item is changed).
 *   · owned.ts `growth_partner_deals` without `AND p.project_id = ?` → test 5 fails (venture B's deal is A's).
 *   · owned.ts `obligation_agenda_items` without `AND e.project_id = ?` → test 5 fails.
 *   · growWriters.ts updatePartnerDeal currency from `b.currency` only (not the deal's) → test 2 fails.
 *   · growWriters.ts updateAgendaItem owner always `str(b.owner_name)` → test 4 fails.
 *   · growWriters.ts removePartnerDeal's log dropped from the batch → test 3 fails.
 *   · grow.ts remove-agenda without `confirm` → test 1 fails.
 *   · grow.ts `row_only: true` dropped from edit-deal → test 1 fails.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_deal_agenda_edit_6114.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { ownedRow } from '../src/services/records/owned.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'deals', 'agenda', '6114'].join('-');
const FOUNDER = 10, OTHER_FOUNDER = 20, ADVISOR = 12;
const A = 1, B = 2;
const PEOPLE: Array<[number, string, string]> = [[FOUNDER, 'founder', 'Ana Wren'], [OTHER_FOUNDER, 'founder', 'Ola Kestrel'], [ADVISOR, 'founder', 'Dee Advisor']];
const OLD = '2026-01-01 00:00:00';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, role, name] of PEOPLE) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, role, name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Kestrel Mill', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, created_by) VALUES
    (1, 'pta1', ${A}, 'Deal Partners', 'referral', 'signed', ${FOUNDER}),
    (2, 'pta2', ${A}, 'Second Partners', 'agency', 'signed', ${FOUNDER}),
    (3, 'ptb1', ${B}, 'Mill Agency', 'agency', 'talking', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO growth_partner_deals (id, uid, partner_id, customer, closed_on, amount_cents, currency, created_at, updated_at) VALUES
    (1, 'dla1', 1, 'Rui Tomas', '2026-09-10', 9000, 'eur', '${OLD}', '${OLD}'),
    (2, 'dla2', 2, 'Lia Moss', NULL, NULL, NULL, '${OLD}', '${OLD}'),
    (3, 'dlb1', 3, 'Ivo Crane', NULL, 500, 'usd', '${OLD}', '${OLD}')`);
  db.exec(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, created_by_user_id) VALUES
    (51, ${A}, 'Unspecified', 'board_meeting', 'Board meeting', '2026-12-30', 'governance', 'quarterly', ${FOUNDER}),
    (52, ${A}, 'Unspecified', 'other', 'Investor update', '2026-12-31', 'governance', 'quarterly', ${FOUNDER}),
    (53, ${B}, 'Unspecified', 'board_meeting', 'Mill board', '2026-12-01', 'governance', 'quarterly', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO obligation_agenda_items (id, uid, event_id, text, owner_name, created_at, updated_at) VALUES
    (1, 'aga1', 51, 'Approve the budget', 'Ana', '${OLD}', '${OLD}'),
    (2, 'aga2', 51, 'Hiring plan', NULL, '${OLD}', '${OLD}'),
    (3, 'aga3', 52, 'Runway', NULL, '${OLD}', '${OLD}'),
    (4, 'agb1', 53, 'Mill budget', NULL, '${OLD}', '${OLD}')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, who = FOUNDER, body?: unknown) {
  const role = PEOPLE.find(([id]) => id === who)?.[1] ?? 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const PARTNERS = 'partner-network', DURABLE = 'durable-company-building';
const rec = (db: DatabaseSync, slug: string, id: string | number, who = FOUNDER) =>
  call(db, 'GET', `/api/cycles/grow/modules/${slug}/records/${id}?project=${A}`, who);
const act = (db: DatabaseSync, slug: string, id: string | number, key: string, body: unknown, who = FOUNDER) =>
  call(db, 'POST', `/api/cycles/grow/modules/${slug}/records/${id}/actions/${key}?project=${A}`, who, body);

const deal = (db: DatabaseSync, uid: string) => db.prepare('SELECT customer, closed_on, amount_cents, currency, updated_at FROM growth_partner_deals WHERE uid = ?').get(uid) as any;
const item = (db: DatabaseSync, uid: string) => db.prepare('SELECT text, owner_name, updated_at FROM obligation_agenda_items WHERE uid = ?').get(uid) as any;
const logs = (db: DatabaseSync, like: string) => (db.prepare(
  'SELECT action, entity_type, entity_id, project_id, details FROM activity_logs WHERE action LIKE ? ORDER BY id',
).all(like) as any[]).map((r) => ({ ...r }));
const sectionOf = (r: any, key: string) => [...(r.body.main || []), ...(r.body.side || [])].find((s: any) => s.key === key);
const declared = (r: any) => Object.fromEntries(r.body.actions.map((a: any) => [a.key, a]));

test('1: deals and agenda items name their uid with Edit and Remove; a reader gets no action and no customer', async () => {
  const db = fixture();
  const p = await rec(db, PARTNERS, 'pta1');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const dealRows = sectionOf(p, 'deals').rows;
  assert.equal(dealRows.length, 1);
  assert.equal(dealRows[0].a, 'Rui Tomas');
  assert.deepEqual(dealRows[0].actions, [
    { key: 'edit-deal', body: { deal: 'dla1' }, values: { customer: 'Rui Tomas', closed_on: '2026-09-10', amount_cents: 9000, currency: 'eur' } },
    { key: 'remove-deal', body: { deal: 'dla1' } },
  ]);
  const pd = declared(p);
  assert.equal(pd['edit-deal'].kind, 'form');
  assert.deepEqual(pd['edit-deal'].form.fields.map((f: any) => f.key), ['customer', 'closed_on', 'amount_cents', 'currency']);
  assert.equal(pd['remove-deal'].tone, 'danger');
  assert.equal(pd['remove-deal'].confirm.cta, 'Remove');
  assert.match(pd['remove-deal'].confirm.title, /Remove this deal\?/);
  for (const k of ['edit-deal', 'remove-deal']) assert.equal(pd[k].row_only, true, k);
  assert.equal(pd['edit'].form.title, 'Edit partner', 'the record\'s own Edit is unchanged');
  assert.equal(pd['edit'].row_only, undefined);

  const o = await rec(db, DURABLE, 51);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const agenda = sectionOf(o, 'agenda').rows;
  assert.deepEqual(agenda.map((x: any) => x.a), ['Approve the budget', 'Hiring plan']);
  assert.deepEqual(agenda[0].actions, [
    { key: 'edit-agenda', body: { item: 'aga1' }, values: { text: 'Approve the budget', owner_name: 'Ana' } },
    { key: 'remove-agenda', body: { item: 'aga1' } },
  ]);
  const od = declared(o);
  assert.deepEqual(od['edit-agenda'].form.fields.map((f: any) => f.key), ['text', 'owner_name']);
  assert.equal(od['remove-agenda'].tone, 'danger');
  assert.match(od['remove-agenda'].confirm.title, /Remove this agenda item\?/);
  for (const k of ['edit-agenda', 'remove-agenda']) assert.equal(od[k].row_only, true, k);

  // An advisor reads both, with no row action and the deal counted, never named.
  const pa = await rec(db, PARTNERS, 'pta1', ADVISOR);
  assert.equal(pa.status, 200);
  for (const row of sectionOf(pa, 'deals').rows) {
    assert.ok(!('actions' in row), JSON.stringify(row));
    assert.equal(row.a, 'A deal');
  }
  assert.doesNotMatch(JSON.stringify(pa.body), /Rui Tomas/);
  const oa = await rec(db, DURABLE, 51, ADVISOR);
  for (const row of sectionOf(oa, 'agenda').rows) assert.ok(!('actions' in row), JSON.stringify(row));
  assert.equal((await act(db, PARTNERS, 'pta1', 'remove-deal', { deal: 'dla1' }, ADVISOR)).status, 403);
  assert.equal((await act(db, DURABLE, 51, 'edit-agenda', { item: 'aga1', text: 'x' }, ADVISOR)).status, 403);
  assert.ok(deal(db, 'dla1'));
  assert.equal(item(db, 'aga1').text, 'Approve the budget');
});

test('2: deal Edit changes only the sent keys, keeps the currency beside an amount, and never logs the customer', async () => {
  const db = fixture();
  const out = await act(db, PARTNERS, 'pta1', 'edit-deal', { deal: 'dla1', customer: '  Rui Tomás  ', amount_cents: '12000', stray: 'x' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.record, { uid: 'dla1' });
  assert.deepEqual({ ...deal(db, 'dla1'), updated_at: undefined },
    { customer: 'Rui Tomás', closed_on: '2026-09-10', amount_cents: 12000, currency: 'eur', updated_at: undefined }, 'the amount keeps its currency');
  assert.notEqual(deal(db, 'dla1').updated_at, OLD);
  assert.equal((await act(db, PARTNERS, 'pta1', 'edit-deal', { deal: 'dla1', currency: 'GBP' })).status, 200);
  assert.equal(deal(db, 'dla1').currency, 'gbp');
  assert.equal((await act(db, PARTNERS, 'pta1', 'edit-deal', { deal: 'dla1', amount_cents: '' })).status, 200);
  assert.deepEqual([deal(db, 'dla1').amount_cents, deal(db, 'dla1').currency], [null, null], 'a cleared amount clears its currency');
  // An amount on a deal that had none takes usd when no currency is sent.
  assert.equal((await act(db, PARTNERS, 'pta2', 'edit-deal', { deal: 'dla2', amount_cents: 300 })).status, 200);
  assert.deepEqual([deal(db, 'dla2').amount_cents, deal(db, 'dla2').currency], [300, 'usd']);
  const blank = await act(db, PARTNERS, 'pta1', 'edit-deal', { deal: 'dla1', customer: '   ' });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, 'customer');
  assert.equal((await act(db, PARTNERS, 'pta1', 'edit-deal', { deal: 'dla1', closed_on: '2026-02-30' })).status, 400);
  // A currency is checked beside an amount; with no amount it is not stored (as on Add).
  assert.equal((await act(db, PARTNERS, 'pta2', 'edit-deal', { deal: 'dla2', currency: 'dollars' })).status, 400);
  assert.equal(deal(db, 'dla2').currency, 'usd');
  assert.equal(deal(db, 'dla1').customer, 'Rui Tomás');
  const l = logs(db, 'grow_deal_%');
  assert.deepEqual(l.map((x) => [x.action, x.entity_type, x.entity_id, x.project_id]), [
    ['grow_deal_updated', 'grow.partner-network', 'pta1', A],
    ['grow_deal_updated', 'grow.partner-network', 'pta1', A],
    ['grow_deal_updated', 'grow.partner-network', 'pta1', A],
    ['grow_deal_updated', 'grow.partner-network', 'pta2', A],
  ]);
  for (const x of l) assert.doesNotMatch(String(x.details), /Rui|Lia|Tom/);
  const r = await rec(db, PARTNERS, 'pta1');
  assert.ok(r.body.activity.some((a: any) => /Deal updated/.test(a.a)), JSON.stringify(r.body.activity));
});

test('3: deal Remove deletes the one deal and logs it; the partner may then be removed', async () => {
  const db = fixture();
  // D6115: a partner with a deal stays.
  assert.equal((await act(db, PARTNERS, 'pta1', 'remove', {})).status, 409);
  const out = await act(db, PARTNERS, 'pta1', 'remove-deal', { deal: 'dla1' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.record, { uid: 'dla1', deleted: true });
  assert.equal(deal(db, 'dla1'), undefined);
  assert.ok(deal(db, 'dla2'), 'another partner\'s deal stays');
  assert.deepEqual(logs(db, 'grow_deal_%').map((l) => [l.action, l.entity_id]), [['grow_deal_removed', 'pta1']]);
  for (const l of logs(db, 'grow_deal_%')) assert.doesNotMatch(String(l.details), /Rui/);
  assert.equal((await act(db, PARTNERS, 'pta1', 'remove-deal', { deal: 'dla1' })).status, 404, 'a removed deal is gone');
  assert.deepEqual(sectionOf(await rec(db, PARTNERS, 'pta1'), 'deals').rows, []);
  assert.equal((await act(db, PARTNERS, 'pta1', 'remove', {})).status, 200, 'with no deal left, the partner may be removed');
});

test('4: agenda Edit changes only the sent keys and refuses a blank item; Remove takes the one item; both logged on the obligation', async () => {
  const db = fixture();
  const edit = await act(db, DURABLE, 51, 'edit-agenda', { item: 'aga1', text: '  Approve the 2027 budget ', stray: 'x' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.deepEqual({ ...item(db, 'aga1'), updated_at: undefined }, { text: 'Approve the 2027 budget', owner_name: 'Ana', updated_at: undefined });
  assert.notEqual(item(db, 'aga1').updated_at, OLD);
  assert.equal((await act(db, DURABLE, 51, 'edit-agenda', { item: 'aga1', owner_name: '' })).status, 200);
  assert.equal(item(db, 'aga1').owner_name, null, 'an emptied owner is cleared');
  assert.equal(item(db, 'aga1').text, 'Approve the 2027 budget', 'an owner edit keeps the text');
  const blank = await act(db, DURABLE, 51, 'edit-agenda', { item: 'aga1', text: '  ' });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, 'text');
  const gone = await act(db, DURABLE, 51, 'remove-agenda', { item: 'aga2' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.deepEqual(gone.body.record, { uid: 'aga2', deleted: true });
  assert.equal(item(db, 'aga2'), undefined);
  assert.ok(item(db, 'aga1'));
  assert.equal((await act(db, DURABLE, 51, 'remove-agenda', { item: 'aga2' })).status, 404);
  const l = logs(db, 'grow_agenda_%');
  assert.deepEqual(l.map((x) => [x.action, x.entity_type, x.entity_id, x.project_id]), [
    ['grow_agenda_updated', 'grow.durable-company-building', '51', A],
    ['grow_agenda_updated', 'grow.durable-company-building', '51', A],
    ['grow_agenda_removed', 'grow.durable-company-building', '51', A],
  ]);
  for (const x of l) assert.doesNotMatch(String(x.details), /budget|Hiring/);
  assert.deepEqual(sectionOf(await rec(db, DURABLE, 51), 'agenda').rows.map((x: any) => x.a), ['Approve the 2027 budget']);
});

test('5: another venture\'s row, a row under another parent, or none at all is refused and writes nothing', async () => {
  const db = fixture();
  const deals = () => db.prepare('SELECT * FROM growth_partner_deals ORDER BY id').all().map((r: any) => ({ ...r }));
  const items = () => db.prepare('SELECT * FROM obligation_agenda_items ORDER BY id').all().map((r: any) => ({ ...r }));
  const [d0, i0] = [deals(), items()];
  for (const key of ['edit-deal', 'remove-deal']) {
    assert.equal((await act(db, PARTNERS, 'pta1', key, { deal: 'dlb1', customer: 'Taken over' })).status, 404, `${key} venture B's deal`);
    assert.equal((await act(db, PARTNERS, 'pta1', key, { deal: 'dla2', customer: 'Taken over' })).status, 404, `${key} another partner's deal`);
    assert.equal((await act(db, PARTNERS, 'pta1', key, { customer: 'Taken over' })).status, 404, `${key} no deal`);
    assert.equal((await act(db, PARTNERS, 'pta1', key, { deal: 3, customer: 'Taken over' })).status, 404, `${key} a numeric deal`);
    assert.equal((await act(db, PARTNERS, 'ptb1', key, { deal: 'dlb1', customer: 'Taken over' })).status, 404, `${key} venture B's partner`);
  }
  for (const key of ['edit-agenda', 'remove-agenda']) {
    assert.equal((await act(db, DURABLE, 51, key, { item: 'agb1', text: 'Taken over' })).status, 404, `${key} venture B's item`);
    assert.equal((await act(db, DURABLE, 51, key, { item: 'aga3', text: 'Taken over' })).status, 404, `${key} another obligation's item`);
    assert.equal((await act(db, DURABLE, 51, key, { text: 'Taken over' })).status, 404, `${key} no item`);
    assert.equal((await act(db, DURABLE, 53, key, { item: 'agb1', text: 'Taken over' })).status, 404, `${key} venture B's obligation`);
  }
  assert.deepEqual(deals(), d0);
  assert.deepEqual(items(), i0);
  assert.deepEqual(logs(db, 'grow_deal_%'), []);
  assert.deepEqual(logs(db, 'grow_agenda_%'), []);
  const env = { DB: d1Over(db) } as any;
  assert.equal(await ownedRow(env, 'growth_partner_deals', 'dla1', A), true);
  assert.equal(await ownedRow(env, 'growth_partner_deals', 'dlb1', A), false);
  assert.equal(await ownedRow(env, 'growth_partner_deals', 'dlb1', B), true);
  assert.equal(await ownedRow(env, 'obligation_agenda_items', 'aga1', A), true);
  assert.equal(await ownedRow(env, 'obligation_agenda_items', 'agb1', A), false);
  assert.equal(await ownedRow(env, 'obligation_agenda_items', 'agb1', B), true);
});

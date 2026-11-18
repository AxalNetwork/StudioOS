/**
 * D6790 (#6790) — an obligation's owner is picked from the company team.
 *
 *   1. Add and Edit take a team member (`owner_user_id`) and refuse anyone
 *      outside the company team, writing nothing.
 *   2. A row keeps a name typed before the change until someone is picked.
 *   3. The Grow record shows the member's name, offers Pick owner on an
 *      ownerless row, and its owner listbox is the company team.
 *   4. Calendar → Compliance and `GET /api/compliance/events` show the same owner.
 *   5. The reminder goes to the assignee and names them; with no team owner it
 *      goes to the founder and says why.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY MIGRATION, as D1 runs them. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/obligation_owner_d6790.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import { addObligation, updateObligation, Refused } from '../src/services/growWriters.ts';
import { GROW_RECORDS } from '../src/services/records/grow.ts';
import { complianceDueEvents } from '../src/services/calendar/sourceReaders.ts';
import { runGrowDaily } from '../src/services/growDaily.ts';
import { durableCard } from '../src/services/growCycle.ts';
import compliance from '../src/routes/compliance.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const FOUNDER = 10, MEMBER = 11, OUTSIDER = 12, LEAVER = 13;
const A = 1, COMPANY = 5;
const JWT_SECRET = ['fixture', 'key', 'for', 'd6790', 'owners'].join('-');
const NOW = Date.parse('2026-11-16T05:35:00Z');
const DAY = 86_400_000;
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

const SCRATCH = mkdtempSync(join(tmpdir(), 'owner-d6790-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const BUILT = join(SCRATCH, 'built.db');
let copies = 0;
function fixture() {
  if (!existsSync(BUILT)) {
    const db = new DatabaseSync(BUILT, { enableDoubleQuotedStringLiterals: true });
    loadSchema(db);
    db.close();
  }
  const copy = join(SCRATCH, `case-${++copies}.db`);
  copyFileSync(BUILT, copy);
  const db = new DatabaseSync(copy, { enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Ana Wren', 'ana@example.test')`);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', ${FOUNDER}, 1),
    (${MEMBER}, 'founder', 'Cai Moreno', 'cai@example.test', NULL, 1),
    (${OUTSIDER}, 'founder', 'Dee Outsider', 'dee@example.test', NULL, 1),
    (${LEAVER}, 'founder', 'Eli Leaver', 'eli@example.test', NULL, 1)`);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (${COMPANY}, 'co-harbour', 'Harbour Lantern Ltd'), (6, 'co-other', 'Other Ltd')`);
  db.exec(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES
    ('ucl-1', ${COMPANY}, ${FOUNDER}), ('ucl-2', ${COMPANY}, ${MEMBER}), ('ucl-3', ${COMPANY}, ${LEAVER}), ('ucl-4', 6, ${OUTSIDER})`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}, ${COMPANY})`);
  // Another venture, under another company, whose team is not A's.
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (2, 'Other venture', ${FOUNDER}, 6)`);
  // Typed before #6790: a name, no team member.
  db.exec(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, owner_name, remind_days_json, created_by_user_id)
    VALUES (51, ${A}, 'Unspecified', 'board_meeting', 'Board meeting', '${day(14)}', 'governance', 'quarterly', 'Sam Typed', '[14]', ${FOUNDER})`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}
const founder = { id: FOUNDER, role: 'founder' } as any;
const rowOf = (db: DatabaseSync, id: number) =>
  ({ ...(db.prepare('SELECT owner_user_id, owner_name FROM compliance_events WHERE id = ?').get(id) as any) });
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { assert.ok(e instanceof Refused); return { status: e.status, field: e.field, message: e.sentence }; }
  assert.fail('expected a refusal');
}
const ctxOf = (env: any) => ({ env, projectId: A, project: { id: A, founder_id: FOUNDER } as any, user: founder });
const durable = GROW_RECORDS['durable-company-building'];

test('1: Add and Edit take a team member and refuse anyone outside the company team', async () => {
  const { db, env } = fixture();
  const { id } = await addObligation(env, A, founder, { title: 'Annual return', kind: 'compliance', due_at: day(40), owner_user_id: String(MEMBER) });
  assert.deepEqual(rowOf(db, id), { owner_user_id: MEMBER, owner_name: null });
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM compliance_events').get() as any).n;
  const before = count();
  for (const who of [OUTSIDER, 999, 'abc', -3]) {
    assert.deepEqual(await refused(addObligation(env, A, founder, { title: 'Filing', kind: 'compliance', due_at: day(41), owner_user_id: who })),
      { status: 400, field: 'owner_user_id', message: 'Choose someone on the company team' }, String(who));
  }
  assert.equal(count(), before, 'a refused Add writes nothing');
  // The Edit refuses an outsider and leaves the row as it was.
  assert.deepEqual((await refused(updateObligation(env, A, founder, id, { owner_user_id: OUTSIDER }))).field, 'owner_user_id');
  assert.deepEqual(rowOf(db, id), { owner_user_id: MEMBER, owner_name: null });
  // No one yet clears the picked owner.
  await updateObligation(env, A, founder, id, { owner_user_id: '' });
  assert.deepEqual(rowOf(db, id), { owner_user_id: null, owner_name: null });
});

test('2: a row keeps a name typed before the change until someone on the team is picked', async () => {
  const { db, env } = fixture();
  await updateObligation(env, A, founder, 51, { title: 'Board meeting (Q4)' });
  assert.deepEqual(rowOf(db, 51), { owner_user_id: null, owner_name: 'Sam Typed' }, 'an Edit that does not touch the owner keeps the name');
  await updateObligation(env, A, founder, 51, { owner_user_id: '' });
  assert.deepEqual(rowOf(db, 51), { owner_user_id: null, owner_name: 'Sam Typed' }, 'No one yet keeps a typed name');
  await refused(updateObligation(env, A, founder, 51, { owner_user_id: OUTSIDER }));
  assert.deepEqual(rowOf(db, 51), { owner_user_id: null, owner_name: 'Sam Typed' });
  await updateObligation(env, A, founder, 51, { owner_user_id: MEMBER });
  assert.deepEqual(rowOf(db, 51), { owner_user_id: MEMBER, owner_name: null }, 'a picked member replaces the typed name');
});

test('3: the record shows the owner, Pick owner on an ownerless row, and the team as the listbox', async () => {
  const { db, env } = fixture();
  const ctx = ctxOf(env);
  const factOf = (r: any) => r.facts.find((f: any) => f.label === 'Owner');
  // Typed before: shown as typed, no Pick owner.
  let record = await durable.record(ctx, '51');
  assert.deepEqual(factOf(record), { label: 'Owner', value: 'Sam Typed' });
  let actions = await durable.actions(ctx, '51', record);
  assert.ok(!actions.some((a) => a.key === 'pick-owner'));
  const owner = actions.find((a) => a.key === 'edit')!.form!.fields.find((f) => f.key === 'owner_user_id')!;
  assert.equal(owner.kind, 'CH');
  assert.equal(owner.value, '');
  assert.deepEqual(owner.options, [{ value: '', label: 'No one yet' }, { value: String(FOUNDER), label: 'Ana Wren' },
    { value: String(MEMBER), label: 'Cai Moreno' }, { value: String(LEAVER), label: 'Eli Leaver' }], 'the company team only');
  assert.match(owner.note!, /Sam Typed/);
  // Ownerless: the fact offers Pick owner, which opens the team listbox and saves the pick.
  db.exec('UPDATE compliance_events SET owner_name = NULL WHERE id = 51');
  record = await durable.record(ctx, '51');
  assert.deepEqual(factOf(record), { label: 'Owner', value: null, reason: 'No owner named', action: 'pick-owner' });
  actions = await durable.actions(ctx, '51', record);
  const pick = actions.find((a) => a.key === 'pick-owner')!;
  assert.equal(pick.row_only, true);
  assert.deepEqual(pick.form!.fields[0].options!.map((o) => o.label), ['Ana Wren', 'Cai Moreno', 'Eli Leaver']);
  // A refusal leaves the action as the route's 400 response, naming the field.
  const thrown = await pick.execute!(ctx as any, '51', { owner_user_id: String(OUTSIDER) }).then(() => null, (e) => e);
  assert.ok(thrown instanceof Response);
  assert.equal(thrown.status, 400);
  assert.deepEqual(await thrown.json(), { detail: 'Choose someone on the company team', field: 'owner_user_id' });
  assert.deepEqual(rowOf(db, 51), { owner_user_id: null, owner_name: null });
  assert.equal((await pick.execute!(ctx as any, '51', { owner_user_id: String(MEMBER) })).ok, true);
  record = await durable.record(ctx, '51');
  assert.deepEqual(factOf(record), { label: 'Owner', value: 'Cai Moreno' });
  assert.match(record.sub, /Cai Moreno/);
  // The reminder step names the assignee.
  const reminders = await durable.sections.find((s) => s.key === 'reminders')!.read(ctx as any, '51', record);
  assert.deepEqual(reminders.rows!.at(-1), { a: 'Goes to', b: 'Cai Moreno' });
  // The Add form's listbox comes from form-options.
  assert.deepEqual(((await durable.formOptions!(ctx as any, {})) as any).owners.map((o: any) => o.value), [String(FOUNDER), String(MEMBER), String(LEAVER)]);
});

test('4: Calendar → Compliance and GET /api/compliance/events show the same owner', async () => {
  const { db, env } = fixture();
  await addObligation(env, A, founder, { title: 'Annual return', kind: 'compliance', due_at: day(20), owner_user_id: MEMBER });
  const events = await complianceDueEvents(env, FOUNDER, day(-1), day(60), { withDone: true, today: day(0) });
  const ownerOf = (title: string) => (events.find((e: any) => e.title === title) as any)?.compliance?.owner;
  assert.equal(ownerOf('Annual return'), 'Cai Moreno');
  assert.equal(ownerOf('Board meeting'), 'Sam Typed', 'a name typed before is shown as it was');
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await compliance.request(`/events?project_id=${A}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.deepEqual(body.events.map((e: any) => [e.title, e.owner]), [['Board meeting', 'Sam Typed'], ['Annual return', 'Cai Moreno']]);
  // And the Grow card's next step asks for an owner only where none is shown.
  const cardOf = () => durableCard({ env, projectId: A, now: NOW, href: (s: string) => `/grow/${s}?project=${A}` } as any);
  assert.notEqual((await cardOf()).next?.text, 'Give Board meeting an owner.', 'a typed name and a picked member are both owners');
  assert.deepEqual(((await cardOf()).series as any).calendar.map((c: any) => c.owner), ['Sam Typed', 'Cai Moreno']);
  db.exec('UPDATE compliance_events SET owner_name = NULL WHERE id = 51');
  const card = await cardOf();
  assert.equal(card.next?.text, 'Give Board meeting an owner.');
  assert.deepEqual((card.series as any).calendar.map((c: any) => c.owner), [null, 'Cai Moreno']);
});

test('5: the reminder goes to the assignee and names them; with no team owner, the founder is told why', async () => {
  const { db, env } = fixture();
  const ins = db.prepare(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, owner_user_id, owner_name, remind_days_json)
    VALUES (?, ${A}, 'Unspecified', ?, ?, ?, 'compliance', 'one_time', ?, NULL, '[14]')`);
  ins.run(52, 'filing', 'Annual return', day(14), MEMBER);
  ins.run(53, 'insurance', 'Insurance renewal', day(14), LEAVER);
  ins.run(54, 'tax', 'Franchise tax', day(14), null);
  db.exec(`DELETE FROM user_company_links WHERE user_id = ${LEAVER}`); // left the team after being picked
  const out = await runGrowDaily(env, NOW);
  assert.equal(out.reminders, 4);
  const sent = (db.prepare("SELECT user_id, title, body FROM notifications_inbox WHERE type = 'grow_obligation_reminder' ORDER BY id").all() as any[])
    .map((r) => [r.user_id, r.title, r.body]);
  assert.deepEqual(sent, [
    [FOUNDER, `Board meeting is due ${day(14)}`, '14 days before: the reminder set on this obligation. Sent to you as the founder: it names Sam Typed, who was typed in rather than picked from the company team.'],
    [MEMBER, `Annual return is due ${day(14)}`, '14 days before: the reminder set on this obligation. Sent to Cai Moreno, its owner on the company team.'],
    [FOUNDER, `Insurance renewal is due ${day(14)}`, '14 days before: the reminder set on this obligation. Sent to you as the founder: its owner is no longer on the company team.'],
    [FOUNDER, `Franchise tax is due ${day(14)}`, '14 days before: the reminder set on this obligation. Sent to you as the founder: no one on the company team is its owner yet.'],
  ]);
  assert.ok(!sent.some(([to]) => to === LEAVER), 'someone who left the team is not reminded');
});

/**
 * #4046 Group B4 — Ask on New invitation's message (Admin · Community ·
 * Partner invitations / `partner-invitation`). One composition field,
 * `partner_invitations.personal_message`; the invitee's email and name, what
 * to offer and the terms are never listed.
 *
 *   - A new invitation hangs under the caller, its inviter (`POST
 *     /api/admin/partners/invitations` is `requireAdmin` and binds the caller as
 *     `invited_by_user_id`). Any admin may draft one; a partner, a founder and
 *     anyone else are told it does not exist (concealed).
 *   - The run reads the inviter's own last few messages and nothing else: never
 *     another admin's message, the invitee's email or name, or the terms.
 *   - After Send the record step keeps the message for its inviter; another
 *     admin reads it but records nothing. An Undo is always refused
 *     (`no_prior`): the message left in the email.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_admin_partner_invitation_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'test-secret-test-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PAGE = 'Admin · Community · Partner invitations';
const FORM = 'partner-invitation';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 51 admin (the inviter); 52 another admin; 53 a Super Admin; 31 partner; 11 founder; 61 explorer.
// Invitation 400 is 51's, 401 is 52's.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (51,'Admin','ad@example.test','admin',1),
      (52,'Other admin','ad2@example.test','admin',1),
      (53,'Super','su@example.test','admin',1),
      (31,'Partner','pa@example.test','partner',1),
      (11,'Founder','fo@example.test','founder',1),
      (61,'Explorer','x@example.test','exploring',1);
    INSERT INTO super_admins(user_id) VALUES (53);
    INSERT INTO partner_invitations(id,token,recipient_email,recipient_name,invited_by_user_id,allowed_deal_types,personal_message,expires_at,terms_json) VALUES
      (400,'tok-400','earlier@invitee.test','Earlier Invitee',51,'["services_partnership"]','Admin own earlier note about our studio.','2099-01-01T00:00:00Z',NULL),
      (401,'tok-401','other@invitee.test','Other Invitee',52,'["custom"]','Other admin private note.','2099-01-01T00:00:00Z','{"revshare_bps":1250,"attribution_window_days":180,"term_months":18,"note":"Secret terms note"}');
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run = async (_env: any, input: any) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/admin/partners', adminPartners);
  const call = async (who: number, method: string, path: string, body?: unknown, opts: { support?: boolean } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(opts.support ? { impersonated_by: 53 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number> = {}, opts: { support?: boolean } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: PAGE, form: FORM, ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, opts);
  const runForm = async (who: number, body: Record<string, unknown>) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: PAGE, option: `form:${FORM}`, ...body });
    const evs = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: evs.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: the message to the invitee, in both copies; never the email, name, what to offer or the terms', () => {
  // Mutation checked: the entry dropped from the SPA copy → the deepEqual fails.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(PAGE, FORM).map((f) => [f.field, f.label, f.table, f.column, f.class, f.sources]),
    [['personal_message', 'Message to the invitee', 'partner_invitations', 'personal_message', 'composition', ['eadwyn']]]);
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'partner_invitations' && /email|name|deal_types|terms|status|token|expires/.test(f.column)));
  const undo = UNDO_WRITES['partner_invitations.personal_message'];
  assert.deepEqual([undo?.scoped, undo?.required, undo?.int], [true, true, false], 'emailed as it is made: an Undo has no prior');
  assert.doesNotMatch(undo.write, /updated_at/, 'partner_invitations has no updated_at');
  assert.equal(RECORD_SCOPES.partner_invitations.concealed, true);
  assert.equal((RECORD_SCOPES.partner_invitations.read.match(/\?/g) || []).length, 1);
});

test('who gets Ask: any admin drafts one under themselves; a partner and a founder are told it does not exist; a support session keeps nothing', async () => {
  // Mutation checked: `isAdminUser` dropped from the scope → the partner and the founder read 200.
  const f = fixture();
  for (const who of [51, 52, 53]) {
    const r = await f.sheet(who);
    assert.equal(r.status, 200, `user ${who}: ${r.text}`);
    assert.deepEqual([r.body.scope, r.body.can_fill, r.body.fields.map((x: any) => [x.field, x.trigger])], [`owner:${who}`, true, [['personal_message', true]]], `user ${who}`);
  }
  for (const who of [31, 11]) {
    const r = await f.sheet(who);
    assert.equal(r.status, 404, `user ${who} is told it does not exist: ${r.text}`);
  }
  assert.deepEqual([(await f.sheet(61)).status, (await f.sheet(61)).body.error], [403, 'no_profile']);
  assert.equal((await f.sheet(51, {}, { support: true })).body.can_fill, false);
  // A parent named by the request is ignored: the Worker names the caller.
  assert.equal((await f.sheet(51, { parent: 52 })).body.scope, 'owner:51');
});

test('a sent invitation: any admin reads it, only its inviter may fill it; a partner is told it does not exist', async () => {
  // Mutation checked: the inviter check on a saved row dropped (write: true) → the other admin reads can_fill true.
  const f = fixture();
  const mine = await f.sheet(51, { record: 400 });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.body.can_fill, true);
  const other = await f.sheet(52, { record: 400 });
  assert.equal(other.status, 200, other.text);
  assert.equal(other.body.can_fill, false, 'another admin reads it, and fills nothing');
  assert.equal((await f.sheet(31, { record: 400 })).status, 404);
  assert.deepEqual((await f.sheet(31, { record: 400 })).body, (await f.sheet(31, { record: 999 })).body, 'concealed: the same answer as none');
});

test('the run: the inviter\'s own last messages, never another admin\'s, the invitee\'s email or name, or the terms; nothing is written', async () => {
  // Mutation checked: the `invited_by_user_id = ?` filter dropped from the gather → "Other admin private note" reaches the prompt.
  const f = fixture({ fields: [{ field: 'personal_message', value: 'We would like you to join our partner bench.' }, { field: 'recipient_email', value: 'x@y.z' }] });
  const run = await f.runForm(51, { input: { values: { personal_message: '' } } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => [p.field, p.value]), [['personal_message', 'We would like you to join our partner bench.']]);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['recipient_email', 'unknown_field']]);
  const p = prompt(f.runs[0]);
  assert.match(p, /Admin own earlier note about our studio/);
  for (const never of [/Other admin private note/, /earlier@invitee\.test/, /Earlier Invitee/, /other@invitee\.test/, /Secret terms note/, /1250/, /tok-40/]) {
    assert.doesNotMatch(p, never);
  }
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM partner_invitations').get() as any).n, 2, 'the run writes nothing');
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'owner:51']);
  // A partner is refused before any hold.
  const refused = await f.runForm(31, { input: { values: { personal_message: '' } } });
  assert.equal(refused.status, 404);
  assert.equal(f.quotes.length, 1);
});

test('after Send: the 201 names the id; the inviter keeps the message they sent; another admin records nothing; an Undo is refused', async () => {
  // Mutation checked: `required: true` → false on the undo entry → the Undo writes NULL and answers 200.
  const f = fixture({ fields: [{ field: 'personal_message', value: 'We would like you to join our partner bench.' }] });
  const run = await f.runForm(51, { input: { values: { personal_message: '' } } });
  const uid = run.done.proposals[0].uid;
  const made = await f.call(51, 'POST', '/api/admin/partners/invitations', { recipient_email: 'new@invitee.test', allowed_deal_types: ['services_partnership'], personal_message: 'We would like you to join our partner bench.' });
  assert.equal(made.status, 201, made.text);
  const id = made.body.id;
  assert.ok(Number.isSafeInteger(id) && id > 401);
  assert.equal((await f.call(52, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: id, proposals: [uid] })).status, 403, 'not their invitation');
  const kept = await f.call(51, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: id, proposals: [uid] });
  assert.equal(kept.status, 200, kept.text);
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['personal_message', 'kept']]);
  const undo = await f.call(51, 'POST', `/api/fills/${kept.body.outcomes[0].provenance_id}/undo`);
  assert.deepEqual([undo.status, undo.body.error], [409, 'no_prior']);
  assert.equal((f.db.prepare('SELECT personal_message FROM partner_invitations WHERE id = ?').get(id) as any).personal_message, 'We would like you to join our partner bench.', 'the invitee reads what was sent');
});

test('after Send: a message typed over is let go', async () => {
  const f = fixture({ fields: [{ field: 'personal_message', value: 'We would like you to join our partner bench.' }] });
  const run = await f.runForm(51, { input: { values: {} } });
  const uid = run.done.proposals[0].uid;
  const made = await f.call(51, 'POST', '/api/admin/partners/invitations', { recipient_email: 'new@invitee.test', allowed_deal_types: ['services_partnership'], personal_message: 'My own words instead.' });
  assert.equal(made.status, 201, made.text);
  const kept = await f.call(51, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: made.body.id, proposals: [uid] });
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['personal_message', 'not_kept']], kept.text);
});

test('a frozen admin gets no Ask: requireAdmin refuses their Send (D135), so no run is spent', async () => {
  // Review finding (B4): the scope skipped the freeze. Mutation checked: the freeze check dropped → can_fill true.
  const f = fixture();
  f.db.exec(`INSERT INTO admin_notices(uid,user_id,kind,subject,body,respond_by,status) VALUES ('an-pi',52,'fees','Fees','Pay','2026-01-01 00:00:00','overdue')`);
  const r = await f.sheet(52);
  assert.deepEqual([r.status, r.body.can_fill], [200, false], r.text);
  assert.equal((await f.sheet(51)).body.can_fill, true, 'another admin is not frozen');
});

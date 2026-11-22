/**
 * D5828 part 2 (#5828) — the Typeform import trigger, its status, the sync
 * row following the venture's binding (#5827), and the importer reading
 * #5827's encrypted grant and recorded data center. On the real migrated
 * schema with a fake Typeform: no test reaches a real host, every id and
 * token is invented, and marker strings stand in for respondent identity,
 * hidden fields, metadata, attachments and unmapped answers.
 *
 *  1. The gate: dark without the approval flag; a stranger, a reader, a
 *     teammate whose connection does not hold the binding, a support session,
 *     an unswitched company and an unbound venture are refused before any
 *     Typeform request.
 *  2. The binding owner's run reads the EU grant from the encrypted
 *     credentials, goes only to the EU origin, counts once, and its answer,
 *     tables and logs carry no token or respondent data. GET is read only.
 *  3. Changing, re-choosing and removing the form: the sync row follows the
 *     binding, one row active at a time, history kept per form, and a
 *     stopped form proposes no review (D5829).
 *  4. A lost binding, a revoked grant, a refresh in progress and a backfill.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import typeform, { TYPEFORM_REFUSALS } from '../src/routes/typeform.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { TypeformError } from '../src/integrations/typeformOAuth.ts';
import { setTypeformMappings, syncTypeformForm, TypeformSessionBusy } from '../src/services/typeform/importer.ts';
import { formFields, TypeformReadError } from '../src/services/typeform/api.ts';
import { followTypeformBinding } from '../src/services/typeform/selection.ts';
import { sessionFailure, typeformImportDeps } from '../src/services/typeform/live.ts';
import { mapTypeformEvidence, prepareTypeformReviews } from '../src/services/typeform/review.ts';

const JWT_SECRET = 'synthetic-typeform-5828-sync-secret';
const COMPANY = 77;
const PROJECT = 41; const UNBOUND = 42;
const OWNER = 10; const TEAMMATE = 11; const ADVISOR = 12; const STRANGER = 13;
const MINE = 501; const THEIRS = 502;
const FORM_A = 'FrmSyncA1'; const FORM_B = 'FrmSyncB2';
const EU_TOKEN = 'SYNTHETIC-EU-ACCESS-NEVER-LOGGED';
const US_TOKEN = 'SYNTHETIC-US-ACCESS-NEVER-LOGGED';
const MARKERS = ['FIXTURE-HIDDEN-RESPONDENT-ZED', 'FIXTURE-METADATA-AGENT', 'fixture-contact-redacted', 'FIXTURE-UNMAPPED-ANSWER', 'fixture-attachment.pdf', EU_TOKEN, US_TOKEN, 'SYNTHETIC-REFRESH'];
const ORIGIN = { us: 'https://api.typeform.com', eu: 'https://api.eu.typeform.com' } as const;

const formDef = (id: string) => ({
  id, title: `Synthetic survey ${id}`,
  fields: [
    { id: 'fldKind', ref: 'kind_ref', type: 'multiple_choice', title: 'Would you join?', properties: { choices: [{ id: 'chYes', label: 'Yes' }, { id: 'chNo', label: 'No' }] } },
    { id: 'fldMail', ref: 'mail_ref', type: 'email', title: 'Contact' },
    { id: 'fldOther', ref: 'other_ref', type: 'short_text', title: 'Anything else?' },
  ],
});
const response = (id: string, hoursAgo: number, kind: 'chYes' | 'chNo') => ({
  response_id: id, token: id, response_type: 'completed', submitted_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(), // clock-ok: relative
  metadata: { user_agent: 'FIXTURE-METADATA-AGENT' }, hidden: { respondent: 'FIXTURE-HIDDEN-RESPONDENT-ZED' },
  answers: [
    { field: { id: 'fldKind', type: 'multiple_choice' }, type: 'choice', choice: { id: kind, label: kind === 'chYes' ? 'Yes' : 'No' } },
    { field: { id: 'fldMail', type: 'email' }, type: 'email', email: 'fixture-contact-redacted' },
    { field: { id: 'fldOther', type: 'short_text' }, type: 'text', text: 'FIXTURE-UNMAPPED-ANSWER' },
    { field: { id: 'fldFile', type: 'file_upload' }, type: 'file_url', file_url: 'https://files.example.invalid/fixture-attachment.pdf' },
  ],
});

/** A fake Typeform for both data centers: a token is accepted only on its own region's origin. */
function fakeTypeform() {
  const s = {
    items: { [FORM_A]: [response('RespA1', 30, 'chYes'), response('RespA2', 20, 'chNo'), response('RespA3', 10, 'chYes')], [FORM_B]: [response('RespB1', 5, 'chYes')] } as Record<string, any[]>,
    status: 0,
    calls: [] as Array<{ origin: string; path: string; query: URLSearchParams; auth: string }>,
  };
  const fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.origin !== ORIGIN.us && url.origin !== ORIGIN.eu) throw new Error(`unexpected origin ${url.origin}`);
    const auth = String(init.headers?.authorization ?? init.headers?.Authorization ?? '');
    s.calls.push({ origin: url.origin, path: url.pathname, query: url.searchParams, auth });
    if (s.status) return Response.json({ code: 'FIXTURE' }, { status: s.status });
    const want = url.origin === ORIGIN.eu ? EU_TOKEN : US_TOKEN;
    if (auth !== `Bearer ${want}`) return Response.json({ code: 'AUTHENTICATION_FAILED' }, { status: 401 });
    const m = /^\/forms\/([A-Za-z0-9]+)(\/responses)?$/.exec(url.pathname);
    if (!m || !s.items[m[1]]) return Response.json({ code: 'FORM_NOT_FOUND' }, { status: 404 });
    if (!m[2]) return Response.json(formDef(m[1]));
    let list = [...s.items[m[1]]].sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at));
    const since = url.searchParams.get('since');
    if (since) list = list.filter((it) => Date.parse(it.submitted_at) >= Date.parse(since));
    const after = url.searchParams.get('after');
    if (after) list = list.slice(list.findIndex((it) => it.token === after) + 1);
    return Response.json({ total_items: list.length, page_count: 1, items: list.slice(0, Number(url.searchParams.get('page_size') ?? 25)) });
  }) as typeof globalThis.fetch;
  return Object.assign(s, { fetch });
}

async function world(env0: Record<string, string> = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4), TYPEFORM_APP_APPROVED: '1', ...env0 };
  db.exec(`INSERT INTO users (id, email, name, role, is_active, founder_id) VALUES
      (${OWNER}, 'owner@example.invalid', 'Synthetic owner', 'founder', 1, 100),
      (${TEAMMATE}, 'mate@example.invalid', 'Synthetic teammate', 'founder', 1, 101),
      (${ADVISOR}, 'advisor@example.invalid', 'Synthetic advisor', 'exploring', 1, NULL),
      (${STRANGER}, 'stranger@example.invalid', 'Synthetic stranger', 'founder', 1, 102);
    INSERT INTO projects (id, name, company_id, founder_id) VALUES (${PROJECT}, 'Synthetic venture', ${COMPANY}, 100), (${UNBOUND}, 'Unbound venture', ${COMPANY}, 100);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PROJECT}, ${TEAMMATE}, 'cofounder', 'accepted'), (${PROJECT}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl-owner', ${COMPANY}, ${OWNER}), ('ucl-mate', ${COMPANY}, ${TEAMMATE});`);
  const far = Date.now() + 7 * 24 * 3600_000; // clock-ok: relative
  const connect = async (id: number, user: number, region: unknown, token: string) => {
    const uid = `typeform-5828-${id}`;
    const enc = await encryptCredentials(env, uid, { access_token: token, refresh_token: 'SYNTHETIC-REFRESH', expires_at: far, ...(region === undefined ? {} : { region }) } as any);
    db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, status, credentials_enc) VALUES (?, ?, ?, 'typeform', 'oauth2', 'active', ?)").run(id, uid, user, enc);
    db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, COMPANY);
  };
  await connect(MINE, OWNER, 'eu', EU_TOKEN);
  await connect(THEIRS, TEAMMATE, 'us', US_TOKEN);
  db.prepare("INSERT INTO typeform_form_bindings (uid, integration_id, project_id, form_id, fields_json, bound_by) VALUES ('bind-a', ?, ?, ?, '[]', ?)").run(MINE, PROJECT, FORM_A, OWNER);
  const tf = fakeTypeform();
  const app = new Hono<any>();
  app.route('/api/typeform', typeform);
  app.onError((e: any, c) => c.json({ detail: 'refused' }, AUTH_ERROR_STATUSES[e.message] || 500));
  const logs: string[] = [];
  const call = async (who: number | null, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) => {
    const headers: Record<string, string> = { 'X-Company-Id': String(COMPANY) };
    if (who != null) {
      const jwt = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      headers.Authorization = `Bearer ${jwt}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const real = globalThis.fetch; const warn = console.warn; const log = console.log; const error = console.error;
    const capture = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    globalThis.fetch = tf.fetch; console.warn = capture; console.log = capture; console.error = capture;
    try {
      const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: json, text };
    } finally { globalThis.fetch = real; console.warn = warn; console.log = log; console.error = error; }
  };
  const syncs = () => (db.prepare('SELECT integration_id, project_id, form_id, status, sync_state, region, checkpoint_submitted_at FROM typeform_form_syncs ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  const syncIdOf = (form: string) => Number((db.prepare('SELECT id FROM typeform_form_syncs WHERE form_id = ?').get(form) as any).id);
  return { db, env, tf, call, logs, syncs, syncIdOf };
}

const SYNC = '/api/typeform/sync';
const run = (w: Awaited<ReturnType<typeof world>>, who = OWNER, body: Record<string, unknown> = { project: PROJECT }, extra = {}) => w.call(who, 'POST', SYNC, body, extra);
const noLeak = (text: string) => { for (const m of MARKERS) assert.ok(!text.includes(m), `"${m}" leaked`); };

test('1. the gate: dark without the flag; only the binding owner with write access and an enabled connection, never a support session', async () => {
  const dark = await world({ TYPEFORM_APP_APPROVED: '' });
  for (const r of [await run(dark), await dark.call(OWNER, 'GET', `${SYNC}?project=${PROJECT}`)]) {
    assert.deepEqual([r.status, r.body.error, r.body.detail], [503, 'typeform_unavailable', TYPEFORM_REFUSALS.typeform_unavailable]);
  }
  assert.equal(dark.tf.calls.length, 0);

  const w = await world();
  assert.equal((await w.call(null, 'POST', SYNC, { project: PROJECT })).status, 401);
  const cases: Array<[string, Promise<any>, number, string]> = [
    ['stranger', run(w, STRANGER), 403, 'forbidden'],
    ['reader', run(w, ADVISOR), 403, 'read_only'],
    ['teammate whose connection does not hold the binding', run(w, TEAMMATE), 403, 'not_your_binding'],
    ['support session', run(w, OWNER, { project: PROJECT }, { impersonated_by: 1 }), 403, 'support_session_refused'],
    ['unbound venture', run(w, OWNER, { project: UNBOUND }), 409, 'not_bound'],
    ['no venture', run(w, OWNER, {}), 400, 'project_required'],
    ['backfill not a boolean', run(w, OWNER, { project: PROJECT, backfill: 'yes' }), 400, 'sync_request_invalid'],
    ['status for a teammate', w.call(TEAMMATE, 'GET', `${SYNC}?project=${PROJECT}`), 403, 'not_your_binding'],
    ['status in a support session', w.call(OWNER, 'GET', `${SYNC}?project=${PROJECT}`, undefined, { impersonated_by: 1 }), 403, 'support_session_refused'],
  ];
  for (const [name, p, status, code] of cases) {
    const r = await p;
    assert.deepEqual([r.status, r.body?.error], [status, code], name);
    assert.ok(TYPEFORM_REFUSALS[code], `${code} has a sentence`);
  }
  w.db.exec('UPDATE integration_companies SET enabled = 0 WHERE integration_id = 501');
  assert.deepEqual([(await run(w)).body.error], ['company_not_enabled']);
  assert.equal(w.tf.calls.length, 0, 'no refusal reached Typeform');
  assert.deepEqual(w.syncs(), [], 'no refusal created a sync row');
});

test('2. the owner\'s run uses the encrypted EU grant on the EU origin only, counts once, and leaks nothing', async () => {
  const w = await world();
  const before = await w.call(OWNER, 'GET', `${SYNC}?project=${PROJECT}`);
  assert.deepEqual([before.status, before.body.status, before.body.binding.form_id], [200, null, FORM_A], 'never followed: no status, not a zero');
  assert.deepEqual(w.syncs(), [], 'GET writes nothing');

  const first = await run(w);
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.outcome, 'ok');
  assert.ok(w.tf.calls.length >= 2);
  assert.ok(w.tf.calls.every((c) => c.origin === ORIGIN.eu && c.auth === `Bearer ${EU_TOKEN}`), 'EU grant, EU origin, every call');
  assert.ok(w.tf.calls.every((c) => c.path.startsWith(`/forms/${FORM_A}`)), 'the bound form only');
  assert.deepEqual([first.body.result.new_completed, first.body.status.completed, first.body.status.active], [3, 3, true]);
  assert.equal(first.body.status.link, `https://admin.eu.typeform.com/form/${FORM_A}/results#responses`);
  assert.deepEqual(w.syncs().map((s) => [s.integration_id, s.project_id, s.form_id, s.status, s.region]), [[MINE, PROJECT, FORM_A, 'active', 'eu']]);

  const again = await run(w);
  assert.deepEqual([again.body.result.new_completed, again.body.status.completed], [0, 3], 'a re-run lands nothing twice');
  const status = await w.call(OWNER, 'GET', `${SYNC}?project=${PROJECT}`);
  assert.deepEqual([status.body.status.completed, status.body.status.state, status.body.status.active], [3, 'ok', true]);

  for (const r of [before, first, again, status]) noLeak(r.text);
  noLeak(w.logs.join('\n'));
  const dump = JSON.stringify(['typeform_form_syncs', 'typeform_responses', 'typeform_answers', 'typeform_field_mappings', 'connector_fed_items', 'activity_logs']
    .map((t) => w.db.prepare(`SELECT * FROM ${t}`).all()));
  noLeak(dump);
});

test('3. the sync row follows the binding: one active row, history kept per form, a stopped form proposes nothing', async () => {
  const w = await world();
  await run(w);
  const fields = formFields(formDef(FORM_A));
  assert.equal(await setTypeformMappings(w.env, w.syncIdOf(FORM_A), fields, [{ field_id: 'fldKind', kind: 'waitlist', choices: ['chYes'] }], new Date().toISOString()), true); // clock-ok: relative
  w.db.exec(`INSERT INTO hypotheses (id, project_id, code, claim) VALUES (301, ${PROJECT}, 'H1', 'Synthetic claim')`);
  const backfilled = await run(w, OWNER, { project: PROJECT, backfill: true });
  assert.equal(backfilled.body.result.new_answers, 2, 'the backfill re-read the history for the new mapping');
  const scope = { projectId: PROJECT, integrationId: MINE, userId: OWNER };
  const mappingId = Number((w.db.prepare('SELECT id FROM typeform_field_mappings').get() as any).id);
  await mapTypeformEvidence(w.env, scope, { field_mapping_id: mappingId, hypothesis_id: 301 });

  // Change the form through #5827's own route: the old row stops at once.
  const changed = await w.call(OWNER, 'PUT', '/api/typeform/form', { project: PROJECT, form_id: FORM_B });
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual(w.syncs().map((s) => [s.form_id, s.status]), [[FORM_A, 'stopped'], [FORM_B, 'active']]);
  assert.deepEqual(await prepareTypeformReviews(w.env, scope), { proposed: 0 }, 'a stopped form proposes no review');
  const old = await syncTypeformForm(w.env, typeformImportDeps(w.env, { id: MINE, uid: `typeform-5828-${MINE}` }, { fetch: w.tf.fetch as any }), { integrationId: MINE, projectId: PROJECT, formId: FORM_A });
  assert.equal(old.outcome, 'stopped', 'the importer never reads an unselected form');
  const onB = await run(w);
  assert.deepEqual([onB.body.outcome, onB.body.status.completed], ['ok', 1], 'form B counts apart from form A');
  assert.equal(Number((w.db.prepare("SELECT COUNT(*) AS n FROM typeform_responses r JOIN typeform_form_syncs s ON s.id = r.sync_id WHERE s.form_id = ?").get(FORM_A) as any).n), 3, 'form A\'s history is kept');

  // Choosing form A again reactivates its row with its checkpoint; nothing lands twice.
  const checkpointA = w.syncs()[0].checkpoint_submitted_at;
  await w.call(OWNER, 'PUT', '/api/typeform/form', { project: PROJECT, form_id: FORM_A });
  assert.deepEqual(w.syncs().map((s) => [s.form_id, s.status, s.checkpoint_submitted_at === checkpointA || s.form_id !== FORM_A]), [[FORM_A, 'active', true], [FORM_B, 'stopped', true]]);
  assert.equal((await prepareTypeformReviews(w.env, scope)).proposed, 2, 'the re-chosen form\'s mapped answers are reviewable again');
  assert.deepEqual([(await run(w)).body.result.new_completed], [0]);

  // A row the binding does not name is never read, even while still active.
  w.db.exec(`INSERT INTO typeform_form_syncs (integration_id, project_id, form_id) VALUES (${THEIRS}, ${PROJECT}, '${FORM_B}')`);
  const stray = await syncTypeformForm(w.env, typeformImportDeps(w.env, { id: THEIRS, uid: `typeform-5828-${THEIRS}` }, { fetch: w.tf.fetch as any }), { integrationId: THEIRS, projectId: PROJECT, formId: FORM_B });
  assert.equal(stray.outcome, 'not_selected');
  await followTypeformBinding(w.env, PROJECT);
  assert.deepEqual(w.syncs().filter((s) => s.status === 'active').map((s) => [s.integration_id, s.form_id]), [[MINE, FORM_A]]);

  // Unbinding stops every row; the trigger then has nothing to run.
  await w.call(OWNER, 'PUT', '/api/typeform/form', { project: PROJECT, form_id: null });
  assert.deepEqual(w.syncs().filter((s) => s.status === 'active'), []);
  const calls = w.tf.calls.length;
  assert.equal((await run(w)).body.error, 'not_bound');
  assert.equal(w.tf.calls.length, calls);
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM typeform_responses').get() as any).n), 4, 'unbinding deletes no history');
  assert.ok((w.db.prepare("SELECT 1 FROM activity_logs WHERE action = 'typeform_backfill_requested'").get()), 'the backfill is on the activity log');
});

test('4. a lost binding, a revoked grant, a refresh in progress and no recorded region', async () => {
  const w = await world();
  w.db.exec("UPDATE typeform_form_bindings SET access_state = 'lost', lost_reason = 'grant_revoked'");
  assert.deepEqual([(await run(w)).status, (await run(w)).body.error], [409, 'binding_lost']);
  assert.equal(w.tf.calls.length, 0);
  const lostStatus = await w.call(OWNER, 'GET', `${SYNC}?project=${PROJECT}`);
  assert.deepEqual([lostStatus.status, lostStatus.body.binding.access_state, lostStatus.body.binding.lost_reason], [200, 'lost', 'grant_revoked']);

  w.db.exec("UPDATE typeform_form_bindings SET access_state = 'ok', lost_reason = NULL");
  w.tf.status = 401;
  const revoked = await run(w);
  assert.deepEqual([revoked.status, revoked.body.outcome, w.syncs()[0].sync_state], [200, 'access_revoked', 'access_revoked']);
  assert.match(w.logs.join('\n'), /import stopped.*access_revoked/);
  w.tf.status = 0;

  // A grant written without a data center is never routed to a guessed one.
  const bare = await encryptCredentials(w.env, `typeform-5828-${MINE}`, { access_token: EU_TOKEN, refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600_000 } as any); // clock-ok: relative
  w.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(bare, MINE);
  const calls = w.tf.calls.length;
  const unknown = await run(w);
  assert.deepEqual([unknown.body.outcome, unknown.body.status.link, w.syncs()[0].region], ['region_unknown', null, null]);
  assert.equal(w.tf.calls.length, calls, 'no request without a recorded region');

  // How #5827's grant failures read to the importer.
  assert.ok(sessionFailure(new TypeformError('typeform_refresh_busy')) instanceof TypeformSessionBusy);
  for (const [code, want] of [['typeform_token_failed', 'unreadable'], ['typeform_token_invalid', 'unreadable'], ['typeform_grant_revoked', 'access_revoked'],
    ['typeform_grant_changed', 'access_revoked'], ['typeform_not_connected', 'access_revoked'], ['typeform_connection_unreadable', 'access_revoked']] as const) {
    assert.equal((sessionFailure(new TypeformError(code)) as TypeformReadError).code, want, code);
  }
  assert.equal((sessionFailure(new Error('decrypt failed')) as TypeformReadError).code, 'access_revoked');
  const deps = typeformImportDeps(w.env, { id: MINE, uid: `typeform-5828-${MINE}` });
  await assert.rejects(deps.session(THEIRS), (e: any) => e instanceof TypeformReadError && e.code === 'access_revoked', 'a deps object serves its own connection only');

  // A refresh another caller holds: the run is busy and stores nothing.
  const state = w.syncs()[0].sync_state;
  const busy = await syncTypeformForm(w.env, { ...deps, fetch: w.tf.fetch as any, session: async () => { throw new TypeformSessionBusy(); } }, { integrationId: MINE, projectId: PROJECT, formId: FORM_A });
  assert.equal(busy.outcome, 'busy');
  assert.equal(w.syncs()[0].sync_state, state);
  assert.equal((w.db.prepare('SELECT lease_owner FROM typeform_form_syncs').get() as any).lease_owner, null, 'the lease is released');
});

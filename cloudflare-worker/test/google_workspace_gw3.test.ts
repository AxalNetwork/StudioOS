/**
 * D1092 (#2957, part 3 of #2402) — Google Workspace's Validate feeds on real
 * SQLite: D659's Validate stores, the interview session store, migration 588's
 * Workspace stores and the fed-items ledger, with the routes on a bare Hono.
 * Google is stubbed: `_google_workspace_fake.mjs` answers what part 2 reads,
 * and this file's fetcher answers the Doc, the Form and its responses. No
 * test reaches a provider host.
 *
 * What #2957 says must be tested, each below by name:
 *   · a re-sync is idempotent;
 *   · a dismissed proposal stays dismissed;
 *   · no email or name from a response is stored or logged;
 *   · a signal is counted only once the founder confirms it;
 *   · interviewIntake re-checks the venture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleValidate from '../src/routes/cycle_validate.ts';
import workspaceRoutes from '../src/routes/google_workspace.ts';
import { DRIVE_FILE_SCOPE, ensureWorkspaceIntegration } from '../src/services/google/workspace.ts';
import { docText, formMapping, noteSegments, SYNC_LIMITS } from '../src/services/google/validateFeeds.ts';
import { demandCard } from '../src/services/cycleValidate.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
import { googleWorkspaceFake } from './_google_workspace_fake.mjs';

const SECRET = 'synthetic-workspace-gw3-secret-0123456789';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mig = (f: string) => read(`../sql/migrations/${f}`);
const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.route('/api/connectors/google-workspace', workspaceRoutes);
app.onError((err, c) => c.json({ error: 'authentication_failed' }, AUTH_ERROR_STATUSES[err.message] ?? 500));

const FOUNDER = 1, OTHER = 2, PARTNER = 3;
const P = 1, P_OTHER = 2, P_MINE_TOO = 3, INTERVIEW = 101, OTHER_INTERVIEW = 201, MINE_TOO_INTERVIEW = 301;
/** What a respondent wrote about themselves: it must reach no table and no log. */
const IDENTITY = ['respondent-one@example.test', 'respondent-two@example.test', '[Respondent Name]', 'private free text'];

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('../sql/schema_baseline.sql');
  for (const t of ['users', 'founders', 'projects', 'user_company_links', 'activity_logs', 'discovery_interviews', 'interview_pain_severities',
    'pain_groups', 'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets', 'validation_decisions',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(baseline, t));
  db.exec(tableFromBaseline(mig('034_unmounted_routes.sql'), 'companies'));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(mig('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(mig('255_hypothesis_verdict_history.sql'));
  for (const m of ['440_validate_cycle_stores.sql', '460_validate_record_stores.sql', '464_verdict_decisions.sql', '438_interview_sessions.sql']) db.exec(mig(m));
  applySessionTranslationColumns(db);
  // deleteSession clears the session's proposals too (214, 246, 439, 447).
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '439_validate_proposals_structuring.sql', '447_assistant_interviews.sql']) db.exec(mig(m));
  for (const m of ['452_record_session_setup.sql', '453_interview_processing.sql', '445_connector_fed_items.sql', '588_google_workspace_files.sql']) db.exec(mig(m));
  db.exec('CREATE TABLE google_oauth_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE,refresh_token TEXT,scope TEXT,google_sub TEXT,google_email TEXT,updated_at TEXT)');
  db.exec(`INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES (${FOUNDER},'founder@example.test','Synthetic founder','founder',1,11),(${OTHER},'other@example.test','Other founder','founder',1,22),(${PARTNER},'partner@example.test','Synthetic partner','partner',1,NULL)`);
  db.exec("INSERT INTO companies(id,company_name) VALUES (1,'Synthetic venture'),(2,'Other venture')");
  db.exec(`INSERT INTO projects(id,name,founder_id,company_id) VALUES (${P},'Synthetic project',11,1),(${P_OTHER},'Other project',22,2),(${P_MINE_TOO},'Second venture',11,1)`);
  db.exec(`INSERT INTO user_company_links(uid,user_id,company_id) VALUES ('l1',${FOUNDER},1),('l2',${OTHER},2)`);
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name) VALUES (${INTERVIEW},${P},'[Customer 4]'),(${OTHER_INTERVIEW},${P_OTHER},'[Customer 9]'),(${MINE_TOO_INTERVIEW},${P_MINE_TOO},'[Customer 5]')`);
  db.exec(`INSERT INTO hypotheses(id,project_id,code,claim) VALUES (501,${P},'H1','Teams pay to skip the month-end export')`);
  for (const u of [FOUNDER, OTHER]) db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_sub,google_email,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)').run(u, 'server-refresh-only', DRIVE_FILE_SCOPE, `google-${u}`, `m${u}@example.test`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', GOOGLE_CAL_CLIENT_ID: 'public-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret', PUBLIC_BASE_URL: 'https://axal.vc' };
  await ensureIntegrationsSchema(env);
  // deleteSession also clears a session's channel rows (D684, D754), as _channels_fixture.ts applies them.
  for (const m of ['449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql', '454_channel_voice_failures.sql',
    '458_channel_link_consent.sql', '488_channel_consents.sql', '528_telegram_captures.sql', '529_meeting_transcript_source.sql']) db.exec(mig(m));
  db.exec('CREATE TABLE IF NOT EXISTS integration_companies(integration_id INTEGER,company_id INTEGER,enabled INTEGER,PRIMARY KEY(integration_id,company_id))');
  const integration = await ensureWorkspaceIntegration(env, FOUNDER);
  const other = await ensureWorkspaceIntegration(env, OTHER);
  db.prepare('INSERT INTO integration_companies VALUES (?,?,1)').run(integration.id, 1);
  db.prepare('INSERT INTO integration_companies VALUES (?,?,1)').run(other.id, 2);
  return { db, env, integration };
}

/** The Doc, the Form and its responses, as Google returns them; everything else goes to part 2's fake. */
function google(state: { docModified: string; docLines: string[]; responses: any[]; rateLimited?: boolean }) {
  const base = googleWorkspaceFake({
    notes: { name: 'Interview notes — [Customer 4]', mimeType: 'application/vnd.google-apps.document' },
    survey: { name: 'Waitlist survey', mimeType: 'application/vnd.google-apps.form' },
  });
  const calls: string[] = [];
  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if ((init.method || 'GET') !== 'GET') return base.fetcher(input, init);
    calls.push(url.hostname + url.pathname);
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files/notes') {
      return Response.json({ id: 'notes', name: 'Interview notes — [Customer 4]', mimeType: 'application/vnd.google-apps.document', modifiedTime: state.docModified });
    }
    if (url.hostname === 'docs.googleapis.com' && url.pathname === '/v1/documents/notes') {
      return Response.json({ body: { content: [
        ...state.docLines.map((l) => ({ paragraph: { elements: [{ textRun: { content: l + '\n' } }] } })),
        { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'From a table cell' } }] } }] }] }] } },
      ] } });
    }
    if (url.hostname === 'forms.googleapis.com' && url.pathname === '/v1/forms/survey') {
      return Response.json({ items: [
        { title: 'Would you pay for this?', questionItem: { question: { questionId: 'q1', choiceQuestion: { options: [{ value: 'Yes, now' }, { value: 'Yes, later' }, { value: 'No' }] } } } },
        { title: 'Your email', questionItem: { question: { questionId: 'q2', textQuestion: {} } } },
      ] });
    }
    if (url.hostname === 'forms.googleapis.com' && url.pathname === '/v1/forms/survey/responses') {
      if (state.rateLimited) return new Response('raw-private-provider-body', { status: 429 });
      assert.equal(url.searchParams.get('pageSize'), '100');
      // Two pages, so the sync follows nextPageToken.
      const second = url.searchParams.get('pageToken') === 'page-2';
      const half = Math.ceil(state.responses.length / 2);
      return Response.json(second ? { responses: state.responses.slice(half) } : { responses: state.responses.slice(0, half), nextPageToken: 'page-2' });
    }
    return base.fetcher(input, init);
  };
  return { fetcher, calls };
}
const response = (id: string, answer: string, when: string, who: string) => ({
  responseId: id, createTime: when, lastSubmittedTime: when, respondentEmail: who,
  answers: { q1: { questionId: 'q1', textAnswers: { answers: [{ value: answer }] } }, q2: { questionId: 'q2', textAnswers: { answers: [{ value: `${who} [Respondent Name] private free text` }] } } },
});
const RESPONSES = [
  response('r1', 'Yes, now', '2026-10-20T10:00:00Z', IDENTITY[0]),
  response('r2', 'No', '2026-10-21T10:00:00Z', IDENTITY[1]),
  response('r3', 'Yes, later', '2026-10-22T10:00:00Z', IDENTITY[0]),
  response('r4', ' Yes, now ', '2026-10-23T10:00:00Z', IDENTITY[1]),
];

async function call(env: any, path: string, method = 'GET', body?: unknown, as: number = FOUNDER, opts: { role?: string; support?: boolean } = {}) {
  const token = await new SignJWT({ user_id: as, role: opts.role ?? 'founder', ...(opts.support ? { impersonated_by: 9 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const V = '/api/cycles/validate';
const W = '/api/connectors/google-workspace';
/** SQLite rows have no prototype; deepEqual compares them as plain objects. */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);

async function withGoogle<T>(state: Parameters<typeof google>[0], run: (g: ReturnType<typeof google>, logged: string[]) => Promise<T>): Promise<T> {
  const g = google(state);
  const old = globalThis.fetch;
  const logged: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of ['log', 'warn', 'error', 'info'] as const) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  globalThis.fetch = g.fetcher as any;
  try { return await run(g, logged); } finally { globalThis.fetch = old; Object.assign(console, saved); }
}

async function pick(env: any, module: string, id: string) {
  assert.equal((await call(env, `${W}/files`, 'POST', { project: P, module, ids: [id] })).status, 201);
  return (await call(env, `${W}/files?project=${P}`)).body.items.find((f: any) => f.module === module).uid as string;
}

test('a Doc becomes the notes of the interview it is mapped to, once; a re-sync is idempotent, a changed Doc replaces them, and a deleted session stays deleted', async () => {
  const { db, env, integration } = await fixture();
  const state = { docModified: '2026-10-25T09:00:00Z', docLines: ['Me: How long does the month-end export take?', '[Customer 4]: A whole day, every month.', 'Asked to see the draft next week.'], responses: [] };
  await withGoogle(state, async (g) => {
    const uid = await pick(env, 'customer_research', 'notes');
    // Unmapped: nothing lands, and the file is not called unreadable.
    let r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.status, 200); assert.equal(r.body.counts.unmapped, 1); assert.equal(r.body.counts.imported, 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
    assert.equal((await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { interview_id: INTERVIEW } })).status, 200);

    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.imported, 1);
    const session = db.prepare('SELECT * FROM interview_sessions').get() as any;
    assert.equal(session.interview_id, INTERVIEW); assert.equal(session.channel, 'text');
    assert.equal(session.submitted_via, 'google_docs'); assert.equal(session.submitted_via_name, 'Google Docs');
    assert.equal(session.status, 'transcribed');
    const segs = db.prepare('SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(session.id) as any[];
    assert.deepEqual(segs.map((s) => [s.speaker_label, s.text]), [
      ['Me', 'How long does the month-end export take?'], ['[Customer 4]', 'A whole day, every month.'],
      ['Notes', 'Asked to see the draft next week.'], ['Notes', 'From a table cell'],
    ]);
    const ledger = db.prepare('SELECT * FROM connector_fed_items').get() as any;
    assert.deepEqual([ledger.module, ledger.local_table, ledger.local_id, ledger.external_id], ['customer_research', 'interview_sessions', session.id, `notes:${P}`]);
    assert.equal(ledger.integration_id, integration.id);

    // The same Doc again: nothing new, and the Doc is not even read.
    const docReads = () => g.calls.filter((c) => c === 'docs.googleapis.com/v1/documents/notes').length;
    const before = docReads();
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.unchanged, 1); assert.equal(r.body.counts.imported, 0);
    assert.equal(docReads(), before);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments'), 4);

    // The founder edits the Doc: its text replaces the session's, in the same session.
    state.docModified = '2026-10-26T09:00:00Z'; state.docLines = ['[Customer 4]: Two days now.'];
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.imported, 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 1);
    assert.deepEqual((db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(session.id) as any[]).map((s) => s.text), ['Two days now.', 'From a table cell']);

    // From Google on Customer research.
    const part = (await call(env, `${V}/modules/customer-research?project=${P}`)).body.parts.from_google;
    assert.equal(part.state, 'ok'); assert.equal(part.files[0].mapped, true); assert.equal(part.files[0].status, 'active');
    assert.deepEqual(part.facts.map((f: any) => [f.label, f.source, f.record]), [['Notes on [Customer 4]', 'Google Docs', `session-${session.id}`]]);
    assert.equal(part.deleted, 0);

    // Delete the fact: the session goes, and the next sync leaves it deleted.
    const del = await call(env, `${V}/google/facts/${ledger.id}?project=${P}`, 'DELETE');
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
    assert.equal((await call(env, `${V}/modules/customer-research?project=${P}`)).body.parts.from_google.deleted, 1);
    state.docModified = '2026-10-27T09:00:00Z';
    const readsBefore = g.calls.length;
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.imported, 0);
    assert.equal(g.calls.length, readsBefore, 'a deleted Doc is not read again');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
    assert.equal((await call(env, `${V}/modules/customer-research?project=${P}`)).body.parts.from_google.deleted, 1);
    assert.equal((await call(env, `${V}/google/facts/${ledger.id}?project=${P}`, 'DELETE')).status, 404);
    assert.ok(g.calls.every((c) => !/oauth2|accounts/.test(c)));
  });
  db.close();
});

test('interviewIntake re-checks the venture: another venture’s interview, or a session whose interview moved, lands nothing', async () => {
  const { db, env } = await fixture();
  const state = { docModified: '2026-10-25T09:00:00Z', docLines: ['[Customer 9]: Not your interview.'], responses: [] };
  await withGoogle(state, async () => {
    const uid = await pick(env, 'customer_research', 'notes');
    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { interview_id: OTHER_INTERVIEW } });
    let r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.unreadable, 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM connector_fed_items'), 0);
    assert.deepEqual(plain(db.prepare('SELECT status, last_error FROM google_workspace_files').get()), { status: 'unreadable', last_error: 'interview_not_found' });
    // An interview the member may write, on their other venture: a Doc chosen for this venture never lands there.
    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { interview_id: MINE_TOO_INTERVIEW } });
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.unreadable, 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);

    // Mapped to its own interview it lands; then the interview moves to a venture the member cannot write.
    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { interview_id: INTERVIEW } });
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.imported, 1);
    db.exec(`UPDATE discovery_interviews SET project_id = ${P_OTHER} WHERE id = ${INTERVIEW}`);
    state.docModified = '2026-10-26T09:00:00Z'; state.docLines = ['Edited after the move.'];
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.unreadable, 1);
    assert.equal((db.prepare('SELECT last_error FROM google_workspace_files').get() as any).last_error, 'interview_not_found');
    assert.equal(count(db, "SELECT COUNT(*) n FROM interview_transcript_segments WHERE text = 'Edited after the move.'"), 0);
  });
  db.close();
});

test('a Form’s qualifying responses wait at to_confirm with no respondent identity stored or logged; a re-sync is idempotent; a signal counts only once confirmed', async () => {
  const { db, env } = await fixture();
  await withGoogle({ docModified: '', docLines: [], responses: RESPONSES }, async (_g, logged) => {
    const uid = await pick(env, 'demand_signals', 'survey');
    // GW5's preview: questions with their choices, and the count the mapping would propose. Nothing is stored.
    const mapping = { question_id: 'q1', answers: ['Yes, now', 'Yes, later'], kind: 'waitlist' };
    const preview = await call(env, `${V}/google/forms/${uid}/preview?project=${P}`, 'POST', { mapping });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.questions[0], { question_id: 'q1', title: 'Would you pay for this?', choices: ['Yes, now', 'Yes, later', 'No'] });
    assert.equal(preview.body.responses, 4); assert.equal(preview.body.qualifying, 3); assert.equal(preview.body.stored, false);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM demand_signals'), 0);
    assert.equal((await call(env, `${V}/google/forms/${uid}/preview?project=${P}`, 'POST', { mapping: { ...mapping, question_id: 'q9' } })).body.error, 'invalid_mapping');

    // A mapping to a question the Form no longer has: the file says so, nothing lands.
    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { ...mapping, question_id: 'gone' } });
    let r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.unreadable, 1);
    assert.equal((db.prepare('SELECT last_error FROM google_workspace_files').get() as any).last_error, 'mapping_question_missing');

    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping });
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.status, 200); assert.equal(r.body.counts.proposed_signals, 3); assert.equal(r.body.counts.offered_evidence, 0);
    const rows = db.prepare('SELECT * FROM demand_signals ORDER BY signal_date').all() as any[];
    assert.deepEqual(rows.map((s) => [s.kind, s.status, s.source_kind, s.signal_date, s.who]), [
      ['waitlist', 'to_confirm', 'google_forms', '2026-10-20', null], ['waitlist', 'to_confirm', 'google_forms', '2026-10-22', null],
      ['waitlist', 'to_confirm', 'google_forms', '2026-10-23', null],
    ]);
    assert.equal(rows[0].note, 'From Google Forms: “Waitlist survey”');
    assert.equal((db.prepare('SELECT status FROM google_workspace_files').get() as any).status, 'active');

    // A re-sync lands nothing new.
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.proposed_signals, 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM demand_signals'), 3);
    assert.equal(count(db, "SELECT COUNT(*) n FROM connector_fed_items WHERE module = 'demand_signals' AND local_table = 'demand_signals'"), 3);

    // No respondent identity anywhere: every table, every log line, every answer.
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((t) => t.name);
    const dump = tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join('\n');
    const part = (await call(env, `${V}/modules/demand-signals?project=${P}`)).body;
    for (const s of IDENTITY) {
      assert.ok(!dump.includes(s), `stored: ${s}`);
      assert.ok(!logged.join('\n').includes(s), `logged: ${s}`);
      assert.ok(!JSON.stringify(part).includes(s), `answered: ${s}`);
      assert.ok(!JSON.stringify(preview.body).includes(s), `previewed: ${s}`);
    }

    // Counted only once the founder confirms: the card counts none, and asks for three.
    db.exec(`INSERT INTO metric_targets (project_id, metric_key, target_value) VALUES (${P}, 'waitlist_target', 100)`);
    const ctx = { env, projectId: P, today: new Date().toISOString().slice(0, 10) };
    let card = await demandCard(ctx) as any;
    assert.equal(card.series.signals.waitlist, 0);
    assert.equal(card.next.text, 'Confirm the 3 signals waiting');
    assert.equal(count(db, "SELECT COUNT(*) n FROM demand_signals WHERE status IN ('confirmed', 'counted')"), 0);
    assert.equal((await call(env, `${V}/demand-signals/${rows[0].id}/status?project=${P}`, 'PUT', { status: 'confirmed' })).status, 200);
    card = await demandCard(ctx) as any;
    assert.equal(card.series.signals.waitlist, 1);
    assert.equal(card.next.text, 'Confirm the 2 signals waiting');
    assert.deepEqual(part.parts.from_google.facts.map((f: any) => f.status), ['to_confirm', 'to_confirm', 'to_confirm']);
  });
  db.close();
});

test('confirmed signals are offered as evidence once; Accept links the hypothesis picked; a dismissed proposal stays dismissed; a withdrawn signal is no longer offered', async () => {
  const { db, env, integration } = await fixture();
  await withGoogle({ docModified: '', docLines: [], responses: RESPONSES }, async () => {
    const uid = await pick(env, 'demand_signals', 'survey');
    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { question_id: 'q1', answers: ['Yes, now', 'Yes, later'], kind: 'would_pay' } });
    await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    const ids = (db.prepare('SELECT id FROM demand_signals ORDER BY id').all() as any[]).map((r) => Number(r.id));
    for (const id of ids) await call(env, `${V}/demand-signals/${id}/status?project=${P}`, 'PUT', { status: 'confirmed' });

    let r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.offered_evidence, 3);
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.offered_evidence, 0);
    const offers = (await call(env, `${V}/modules/experiments?project=${P}`)).body.parts.from_google.proposals;
    assert.deepEqual(offers.map((o: any) => o.record), ids.map((id) => `signal-${id}`));
    assert.match(offers[0].title, /^Would pay signal from Google Forms, 2026-10-20$/);

    // Accept needs the hypothesis the founder picks; then it links the signal as evidence.
    assert.equal((await call(env, `${V}/google/proposals/${offers[0].id}/accept?project=${P}`, 'POST', {})).status, 400);
    r = await call(env, `${V}/google/proposals/${offers[0].id}/accept?project=${P}`, 'POST', { hypothesis_id: 501 });
    assert.equal(r.status, 200); assert.equal(r.body.state, 'accepted');
    assert.deepEqual(plain(db.prepare('SELECT hypothesis_id, kind, ref_id, direction FROM hypothesis_evidence_links').all()), [{ hypothesis_id: 501, kind: 'signal', ref_id: `signal-${ids[0]}`, direction: 'supports' }]);
    assert.equal((await call(env, `${V}/google/proposals/${offers[0].id}/accept?project=${P}`, 'POST', { hypothesis_id: 501 })).body.error, 'proposal_decided');
    // Decided is said before anything else is asked of the founder.
    assert.equal((await call(env, `${V}/google/proposals/${offers[0].id}/accept?project=${P}`, 'POST', {})).body.error, 'proposal_decided');

    // Dismissed stays dismissed, across syncs.
    assert.equal((await call(env, `${V}/google/proposals/${offers[1].id}/dismiss?project=${P}`, 'POST', {})).status, 200);
    assert.equal((await call(env, `${V}/google/proposals/${offers[1].id}/dismiss?project=${P}`, 'POST', {})).status, 409);
    await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.deepEqual(plain(db.prepare('SELECT fingerprint, status FROM google_workspace_proposals ORDER BY id').all()), [
      { fingerprint: `signal-${ids[0]}`, status: 'accepted' }, { fingerprint: `signal-${ids[1]}`, status: 'dismissed' }, { fingerprint: `signal-${ids[2]}`, status: 'pending' },
    ]);

    // A signal returned to "to confirm" cannot be accepted, and the next sync withdraws its offer.
    await call(env, `${V}/demand-signals/${ids[2]}/status?project=${P}`, 'PUT', { status: 'to_confirm' });
    assert.equal((await call(env, `${V}/google/proposals/${offers[2].id}/accept?project=${P}`, 'POST', { hypothesis_id: 501 })).body.error, 'signal_not_confirmed');
    r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.withdrawn_offers, 1);
    assert.equal(count(db, "SELECT COUNT(*) n FROM google_workspace_proposals WHERE status = 'pending'"), 0);

    // Deleting a landed signal takes its evidence link with it, and it never lands again.
    const ledger = db.prepare('SELECT id FROM connector_fed_items WHERE local_id = ?').get(ids[0]) as any;
    assert.equal((await call(env, `${V}/google/facts/${ledger.id}?project=${P}`, 'DELETE')).status, 200);
    assert.equal((await call(env, `${V}/google/facts/${ledger.id}?project=${P}`, 'DELETE')).status, 404);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM hypothesis_evidence_links'), 0);
    await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(count(db, 'SELECT COUNT(*) n FROM demand_signals'), 2);

    // Another member's proposal is not theirs to decide.
    db.prepare("INSERT INTO google_workspace_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title, payload_json) VALUES (?, ?, 'experiments', 'signal_evidence', 'signal:999', 'signal-999', 't', '{}')").run(integration.id + 1, P);
    const foreign = (db.prepare("SELECT id FROM google_workspace_proposals WHERE source_key = 'signal:999'").get() as any).id;
    assert.equal((await call(env, `${V}/google/proposals/${foreign}/dismiss?project=${P}`, 'POST', {})).status, 404);
  });
  db.close();
});

test('who may: another founder, a partner, an admin and a support session never sync; each From Google state is said, and one failed read is that part only', async () => {
  const { db, env } = await fixture();
  await withGoogle({ docModified: '', docLines: [], responses: RESPONSES, rateLimited: true }, async () => {
    assert.equal((await call(env, `${V}/google/sync?project=${P}`, 'POST', {}, OTHER)).body.error, 'project_not_available');
    assert.equal((await call(env, `${V}/google/sync?project=${P}`, 'POST', {}, PARTNER, { role: 'partner' })).status, 403);
    assert.equal((await call(env, `${V}/google/sync?project=${P}`, 'POST', {}, FOUNDER, { support: true })).body.error, 'support_session_refused');
    assert.equal((await call(env, `${V}/google/sync?project=abc`, 'POST', {})).status, 400);
    // A partner reads the board but not the founder's Google files.
    assert.equal((await call(env, `${V}/modules/demand-signals?project=${P}`, 'GET', undefined, PARTNER, { role: 'partner' })).body.parts.from_google.state, 'team_only');

    // A rate limit stops the sync "partly", and does not call the file unreadable.
    const uid = await pick(env, 'demand_signals', 'survey');
    await call(env, `${W}/files/${uid}/mapping`, 'PUT', { mapping: { question_id: 'q1', answers: ['Yes, now'] } });
    const r = await call(env, `${V}/google/sync?project=${P}`, 'POST', {});
    assert.equal(r.body.counts.partly, true); assert.equal(r.body.counts.unreadable, 0);
    assert.equal((db.prepare('SELECT status FROM google_workspace_files').get() as any).status, 'active');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM demand_signals'), 0);

    // The company switched off: not connected, and the sync is refused.
    db.exec('UPDATE integration_companies SET enabled = 0');
    assert.deepEqual((await call(env, `${V}/modules/demand-signals?project=${P}`)).body.parts.from_google.state, 'not_connected');
    assert.equal((await call(env, `${V}/google/sync?project=${P}`, 'POST', {})).status, 409);
    db.exec('UPDATE integration_companies SET enabled = 1');

    // The Workspace store unreadable: From Google says so, and the module's records still read.
    db.exec('ALTER TABLE google_workspace_files RENAME TO gwf_away');
    const page = (await call(env, `${V}/modules/demand-signals?project=${P}`)).body;
    assert.equal(page.parts.from_google.state, 'unreadable');
    assert.ok(Array.isArray(page.records.rows));
    // Problem discovery has no From Google part at all.
    assert.equal('from_google' in (await call(env, `${V}/modules/problem-discovery?project=${P}`)).body.parts, false);
  });
  db.close();
});

test('the readers: Doc text in order and bounded, speaker lines, and a Form mapping held to one question, 1–20 answers and a demand kind', () => {
  assert.equal(docText({ body: { content: [{ paragraph: { elements: [{ textRun: { content: 'a\n' } }, { inlineObjectElement: {} }] } }, { sectionBreak: {} }] } }), 'a\n');
  assert.equal(docText(null), '');
  assert.equal(docText({ body: { content: [{ paragraph: { elements: [{ textRun: { content: 'x'.repeat(SYNC_LIMITS.docChars + 50) } }] } }] } }).length, SYNC_LIMITS.docChars);
  assert.deepEqual(noteSegments('Me: hi\n\n  https://example.test: a link\nplain'), [
    { speaker: 'Me', text: 'hi', startMs: null, endMs: null },
    { speaker: 'Notes', text: 'https://example.test: a link', startMs: null, endMs: null },
    { speaker: 'Notes', text: 'plain', startMs: null, endMs: null },
  ]);
  assert.equal(noteSegments(Array(SYNC_LIMITS.docLines + 5).fill('l').join('\n')).length, SYNC_LIMITS.docLines);
  assert.deepEqual(formMapping({ question_id: 'q1', answers: [' Yes ', 'Yes', ''] }), { question_id: 'q1', answers: ['Yes'], kind: 'waitlist' });
  assert.equal(formMapping({ question_id: 'q1', answers: [] }), null);
  assert.equal(formMapping({ question_id: 'q1', answers: Array.from({ length: 21 }, (_, i) => `a${i}`) }), null);
  assert.equal(formMapping({ question_id: 'q1', answers: ['Yes'], kind: 'revenue' }), null);
  assert.equal(formMapping(['q1']), null);
});

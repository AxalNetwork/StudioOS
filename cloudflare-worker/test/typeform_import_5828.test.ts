/**
 * D5828 (#5828) — Typeform's incremental response importer, against a fake
 * Responses API over synthetic fixtures and the real migrated schema in
 * memory. No test reaches typeform.com; every clock is a fixed instant.
 *
 * Fixture respondents are obviously fake: no name, address or number of a
 * real person. Marker strings stand in for identity, hidden fields,
 * metadata, attachments and unmapped answers, and the last test proves none
 * of them reached a table or a log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  syncTypeformForm, reconcileTypeformDeletions, requestTypeformBackfill, withdrawTypeformAnswer, withdrawTypeformResponse,
  setTypeformMappings, typeformFormStatus, ledgerKey, OVERLAP_MS, RECONCILE_CONFIRM_MS, LEASE_MS,
} from '../src/services/typeform/importer.ts';
import { formFields, typeformUrl, responsesLink, regionOf, TypeformReadError } from '../src/services/typeform/api.ts';
import { typeformMapping, qualifyingAnswer } from '../src/services/typeform/mappings.ts';

const FORM = 'FrmSyn01';
const PROJECT = 41; const OTHER_PROJECT = 42; const USER = 7; const INTEGRATION = 501;
const T0 = Date.parse('2026-11-01T12:00:00Z');
const H = 3600_000;
const at = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** Strings that stand for what must never be stored or logged. */
const MARKERS = ['FIXTURE-HIDDEN-RESPONDENT-ZED', 'FIXTURE-METADATA-AGENT', 'FIXTURE-NETWORK-ID', 'fixture-contact-redacted', 'FIXTURE-UNMAPPED-ANSWER', 'fixture-attachment.pdf', 'FIXTURE-VARIABLE', 'SYNTHETIC-TOKEN-NEVER-LOGGED'];
const TOKEN = 'SYNTHETIC-TOKEN-NEVER-LOGGED';

const FORM_DEF = (over: Partial<Record<string, any>> = {}) => ({
  id: FORM, title: 'Synthetic waitlist survey',
  fields: [
    { id: 'fldKind', type: over.kindType ?? 'multiple_choice', title: over.kindTitle ?? 'Would you join the waitlist?', properties: { choices: [{ id: 'chYes', label: 'Yes, sign me up' }, { id: 'chNo', label: 'Not now' }] } },
    ...(over.dropPain ? [] : [{ id: 'fldPain', type: 'long_text', title: 'What is the hardest part today?' }]),
    { id: 'fldMail', type: 'email', title: 'Contact' },
    { id: 'fldOther', type: 'short_text', title: 'Anything else?' },
    { id: 'grp1', type: 'group', title: 'More', properties: { fields: [{ id: 'fldFile', type: 'file_upload', title: 'Attach a file' }] } },
  ],
});

interface Fx { id: string; type?: 'completed' | 'partial'; at: number; kind?: 'chYes' | 'chNo' | null; pain?: string | null }
/** A response as Typeform shapes it, carrying every kind of data the importer must ignore. */
function item(f: Fx) {
  const completed = (f.type ?? 'completed') === 'completed';
  const answers: any[] = [];
  if (f.kind) answers.push({ field: { id: 'fldKind', type: 'multiple_choice' }, type: 'choice', choice: { id: f.kind, label: f.kind === 'chYes' ? 'Yes, sign me up' : 'Not now' } });
  if (f.pain) answers.push({ field: { id: 'fldPain', type: 'long_text' }, type: 'text', text: f.pain });
  answers.push({ field: { id: 'fldMail', type: 'email' }, type: 'email', email: 'fixture-contact-redacted' });
  answers.push({ field: { id: 'fldOther', type: 'short_text' }, type: 'text', text: 'FIXTURE-UNMAPPED-ANSWER' });
  answers.push({ field: { id: 'fldFile', type: 'file_upload' }, type: 'file_url', file_url: 'https://files.example.invalid/fixture-attachment.pdf' });
  return {
    landing_id: f.id, token: f.id, response_id: f.id, response_type: completed ? 'completed' : 'partial',
    landed_at: at(f.at - 60_000), ...(completed ? { submitted_at: at(f.at) } : {}),
    metadata: { user_agent: 'FIXTURE-METADATA-AGENT', platform: 'other', network_id: 'FIXTURE-NETWORK-ID' },
    hidden: { respondent: 'FIXTURE-HIDDEN-RESPONDENT-ZED' }, variables: [{ key: 'v', type: 'text', text: 'FIXTURE-VARIABLE' }], calculated: { score: 3 },
    answers,
  };
}

/**
 * The fake Responses API. Items are sorted oldest first by submission (a
 * partial by when it landed); `since` keeps items at or after it, `after`
 * those after that token, `included_response_ids` only those ids. `faults`
 * answers a given call number with a status instead.
 */
function fakeTypeform(opts: { form?: any; items: any[]; faults?: Record<number, { status: number; retryAfter?: string }>; duplicateOnNextPage?: boolean }) {
  const state = { form: opts.form ?? FORM_DEF(), items: opts.items, faults: opts.faults ?? {}, calls: [] as string[], headers: [] as Record<string, string>[], gone: new Set<string>() };
  const key = (it: any) => Date.parse(it.submitted_at ?? it.landed_at);
  const fetch = async (url: string, init: any) => {
    state.calls.push(url); state.headers.push(init.headers);
    const n = state.calls.length;
    const fault = state.faults[n];
    if (fault) return new Response('{"description":"fixture fault"}', { status: fault.status, headers: fault.retryAfter ? { 'retry-after': fault.retryAfter } : {} });
    const u = new URL(url);
    if (!/^\/forms\/[A-Za-z0-9]+(\/responses)?$/.test(u.pathname)) return new Response('{}', { status: 400 });
    if (!u.pathname.endsWith('/responses')) return Response.json(state.form);
    const p = u.searchParams;
    const types = (p.get('response_type') ?? 'completed').split(',');
    let list = state.items.filter((it) => !state.gone.has(it.response_id) && types.includes(it.response_type)).sort((a, b) => key(a) - key(b));
    if (p.get('included_response_ids')) { const ids = p.get('included_response_ids')!.split(','); list = list.filter((it) => ids.includes(it.response_id)); }
    if (p.get('since')) list = list.filter((it) => key(it) >= Date.parse(p.get('since')!));
    if (p.get('after')) {
      const anchor = state.items.find((it) => it.token === p.get('after'));
      const ai = anchor ? list.indexOf(anchor) : -1;
      list = ai >= 0 ? list.slice(ai + 1) : list.filter((it) => anchor && key(it) > key(anchor));
      // A provider that repeats the last item of the previous page.
      if (opts.duplicateOnNextPage && anchor) list = [anchor, ...list];
    }
    const size = Number(p.get('page_size') ?? 25);
    return Response.json({ total_items: list.length, page_count: Math.ceil(list.length / size), items: list.slice(0, size) });
  };
  return { state, fetch };
}

function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.prepare("INSERT INTO projects (id, name) VALUES (?, 'Synthetic venture'), (?, 'Other synthetic venture')").run(PROJECT, OTHER_PROJECT);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, status) VALUES (?, 'int-5828', ?, 'typeform', 'oauth2', 'active')")
    .run(INTEGRATION, USER);
  // D5828 part 2: the venture's binding (#5827) is the selection the sync row follows.
  db.prepare("INSERT INTO typeform_form_bindings (uid, integration_id, project_id, form_id, bound_by) VALUES ('bind-5828', ?, ?, ?, ?)").run(INTEGRATION, PROJECT, FORM, USER);
  db.prepare('INSERT INTO typeform_form_syncs (id, integration_id, project_id, form_id) VALUES (1, ?, ?, ?)').run(INTEGRATION, PROJECT, FORM);
  const env: any = { DB: d1Over(db) };
  return { db, env };
}
const MAPPINGS = [
  { field_id: 'fldKind', kind: 'waitlist', choices: ['chYes'] },
  { field_id: 'fldPain', kind: 'need_to_have', keep_text: true },
];
async function mapDefault(env: any, nowIso = at(T0)) {
  assert.equal(await setTypeformMappings(env, 1, formFields(FORM_DEF()), MAPPINGS, nowIso), true);
}
const KEY = { integrationId: INTEGRATION, projectId: PROJECT, formId: FORM };
const session = (region: unknown = 'us') => async () => ({ accessToken: TOKEN, region });
const deps = (fetch: any, now: number, extra: Record<string, any> = {}) => ({ fetch, session: session(), now: () => now, runId: `run-${now}`, limits: { pageSize: 3 }, ...extra });
const checkpoint = (db: DatabaseSync) => (db.prepare('SELECT checkpoint_submitted_at AS c FROM typeform_form_syncs WHERE id = 1').get() as any).c;
const answers = (db: DatabaseSync) => (db.prepare('SELECT field_id, answer_text FROM typeform_answers ORDER BY id').all() as any[]).map((r) => ({ ...r }));

/** Nine distinct completed responses, two partials (one later completes), mixed answers. */
const HISTORY: Fx[] = [
  { id: 'R01', at: T0 - 50 * H, kind: 'chYes', pain: 'Synthetic pain: reconciling invoices' },
  { id: 'R02', at: T0 - 49 * H, kind: 'chNo', pain: null },
  { id: 'R03', at: T0 - 48 * H, kind: 'chYes', pain: null },
  { id: 'P01', type: 'partial', at: T0 - 47 * H },
  { id: 'R04', at: T0 - 46 * H, kind: null, pain: 'Synthetic pain: hiring' },
  { id: 'R05', at: T0 - 45 * H, kind: 'chNo', pain: null },
  { id: 'R06', at: T0 - 44 * H, kind: 'chYes', pain: 'Synthetic pain: onboarding' },
  { id: 'R07', at: T0 - 43 * H, kind: 'chNo', pain: null },
  { id: 'P02', type: 'partial', at: T0 - 42 * H },
  { id: 'R08', at: T0 - 41 * H, kind: 'chYes', pain: null },
  { id: 'R09', at: T0 - 40 * H, kind: null, pain: null },
];
const KNOWN_DISTINCT_COMPLETED = 9;
const KNOWN_QUALIFYING = 5; // R01 R03 R04 R06 R08; R01 and R06 qualify on both mapped questions
const KNOWN_ANSWERS = 7;

test('multi-page history lands every completed response once and counts completed, qualifying and partial apart', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: HISTORY.map(item) });
  const r = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r.outcome, 'ok');
  assert.equal(r.pages, 4, 'eleven items at three a page');
  assert.equal(r.new_completed, 9); assert.equal(r.new_partial, 2);
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.equal(s!.completed, KNOWN_DISTINCT_COMPLETED);
  assert.equal(s!.partial, 2);
  assert.equal(s!.qualifying, 5, 'R01, R03, R04, R06 and R08 qualify');
  assert.equal(answers(db).length, 7, 'R01 and R06 carry two mapped qualifying answers each');
  assert.equal(checkpoint(db), at(T0 - 40 * H));
  // Oldest first, and later pages continue from the last token.
  assert.match(fake.state.calls[1], /sort=submitted_at%2Casc/);
  assert.match(fake.state.calls[2], /after=R03/);
  assert.doesNotMatch(fake.state.calls[2], /sort=/);
  assert.match(fake.state.calls[1], /fields=fldKind%2CfldPain/);
});

test('one response with two mapped questions lands two answers and counts as one qualifying response', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: [item(HISTORY[0])] });
  const r = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r.new_answers, 2);
  assert.deepEqual(answers(db), [{ field_id: 'fldKind', answer_text: 'Yes, sign me up' }, { field_id: 'fldPain', answer_text: 'Synthetic pain: reconciling invoices' }]);
  const ledger = db.prepare("SELECT external_id, module, kind, local_table FROM connector_fed_items WHERE integration_id = ? ORDER BY id").all(INTEGRATION) as any[];
  assert.deepEqual(ledger.map((l) => l.external_id), [ledgerKey(FORM, PROJECT, 'R01', 'fldKind'), ledgerKey(FORM, PROJECT, 'R01', 'fldPain')]);
  assert.equal(ledger[0].local_table, 'typeform_answers');
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.equal(s!.qualifying, 1); assert.equal(s!.completed, 1);
});

test('a duplicate across pages and a full re-run land nothing twice', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: HISTORY.map(item), duplicateOnNextPage: true });
  const r1 = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r1.outcome, 'ok');
  assert.ok(r1.duplicates >= 3, 'each later page repeated the previous last item');
  const r2 = await syncTypeformForm(env, deps(fake.fetch, T0 + H), KEY);
  assert.equal(r2.new_completed, 0); assert.equal(r2.new_answers, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM typeform_responses').get() as any).n, 11);
  assert.equal(answers(db).length, 7);
});

test('a response Typeform shows late arrives through the overlap; one later than the overlap waits for a backfill', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const visible = HISTORY.filter((f) => f.id !== 'R07' && f.id !== 'R03').map(item);
  const fake = fakeTypeform({ items: visible });
  await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(checkpoint(db), at(T0 - 40 * H));
  // R07 (3 h before the checkpoint) and R03 (8 h before) become visible.
  fake.state.items = HISTORY.map(item);
  const r2 = await syncTypeformForm(env, deps(fake.fetch, T0 + H, { limits: { pageSize: 50 } }), KEY);
  assert.equal(r2.new_completed, 2, 'both are inside the 24 hour overlap');
  assert.match(fake.state.calls.at(-1)!, new RegExp(`since=${encodeURIComponent(at(T0 - 40 * H - OVERLAP_MS).replace('Z', '.000Z'))}`));
  // A response delayed past the overlap is not read by an ordinary run…
  const { env: env2 } = world();
  await mapDefault(env2);
  const late = { id: 'RLATE', at: T0 - 100 * H, kind: 'chYes' as const };
  const fake2 = fakeTypeform({ items: HISTORY.map(item) });
  await syncTypeformForm(env2, deps(fake2.fetch, T0, { limits: { pageSize: 50 } }), KEY);
  fake2.state.items = [...HISTORY, late].map(item);
  assert.equal((await syncTypeformForm(env2, deps(fake2.fetch, T0 + H, { limits: { pageSize: 50 } }), KEY)).new_completed, 0);
  // …and an intentional backfill reads the whole history again and finds it.
  assert.equal(await requestTypeformBackfill(env2, { integrationId: INTEGRATION, projectId: PROJECT }, FORM, at(T0 + 2 * H)), true);
  const r3 = await syncTypeformForm(env2, deps(fake2.fetch, T0 + 2 * H, { limits: { pageSize: 50 } }), KEY);
  assert.equal(r3.new_completed, 1);
  assert.doesNotMatch(fake2.state.calls.at(-1)!, /since=/);
  assert.equal((await typeformFormStatus(env2, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.completed, 10);
});

test('a partial response is counted apart and its answers land only once it completes', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: [item({ id: 'P01', type: 'partial', at: T0 - 2 * H, kind: 'chYes' })] });
  const r1 = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r1.new_partial, 1); assert.equal(answers(db).length, 0);
  assert.equal(checkpoint(db), null, 'a partial moves no checkpoint');
  fake.state.items = [item({ id: 'P01', at: T0 - H, kind: 'chYes' })];
  const r2 = await syncTypeformForm(env, deps(fake.fetch, T0 + H), KEY);
  assert.equal(r2.upgraded, 1); assert.equal(r2.new_answers, 1);
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.deepEqual([s!.completed, s!.partial, s!.qualifying], [1, 0, 1]);
});

test('zero completed responses is a true zero, not a failure', async () => {
  const { env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: [item({ id: 'P09', type: 'partial', at: T0 - H })] });
  const r = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r.outcome, 'ok');
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.deepEqual([s!.state, s!.completed, s!.partial, s!.qualifying], ['ok', 0, 1, 0]);
  const empty = fakeTypeform({ items: [] });
  const { env: env2 } = world();
  assert.equal((await syncTypeformForm(env2, deps(empty.fetch, T0), KEY)).outcome, 'ok');
  assert.equal((await typeformFormStatus(env2, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.completed, 0);
});

test('zero qualifying answers stores no answer text while completed responses still count', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: [item({ id: 'R11', at: T0 - 3 * H, kind: 'chNo' }), item({ id: 'R12', at: T0 - 2 * H, kind: null, pain: '   ' })] });
  await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(answers(db).length, 0);
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.deepEqual([s!.completed, s!.qualifying], [2, 0]);
});

test('429 stores the wait, keeps the checkpoint at the last whole page, and the next run after the wait finishes', async () => {
  const { db, env } = world();
  await mapDefault(env);
  // Call 1 is the form, 2 the first page, 3 the second page: throttled.
  const fake = fakeTypeform({ items: HISTORY.map(item), faults: { 3: { status: 429, retryAfter: '30' } } });
  const r1 = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r1.outcome, 'rate_limited');
  assert.equal(r1.retry_after, at(T0 + 30_000).replace('Z', '.000Z'));
  assert.equal(checkpoint(db), at(T0 - 48 * H), 'the first page was written, so it moved; the throttled page did not');
  const calls = fake.state.calls.length;
  const r2 = await syncTypeformForm(env, deps(fake.fetch, T0 + 10_000), KEY);
  assert.equal(r2.outcome, 'rate_limited');
  assert.equal(fake.state.calls.length, calls, 'no read before Retry-After');
  const r3 = await syncTypeformForm(env, deps(fake.fetch, T0 + 31_000), KEY);
  assert.equal(r3.outcome, 'ok');
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.equal(s!.completed, KNOWN_DISTINCT_COMPLETED);
  assert.equal(s!.state, 'ok');
});

test('a write that fails mid-page keeps the checkpoint and the retry lands only what is missing', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const real = env.DB.batch.bind(env.DB);
  let n = 0;
  env.DB.batch = async (s: any[]) => { n += 1; if (n === 3) throw new Error('synthetic D1 failure'); return real(s); };
  const warn = test.mock.method(console, 'warn', () => {});
  const fake = fakeTypeform({ items: HISTORY.map(item) });
  // The mappings were written before the wrap, so batches 1-3 are responses R01, R02 and R03.
  const r1 = await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  assert.equal(r1.outcome, 'not_stored');
  assert.equal(checkpoint(db), null, 'the first page did not finish, so nothing moved');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM typeform_responses').get() as any).n, 2);
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[typeform import] write failed: Error']);
  warn.mock.restore();
  const r2 = await syncTypeformForm(env, deps(fake.fetch, T0 + H), KEY);
  assert.equal(r2.outcome, 'ok');
  assert.equal(r2.duplicates, 2); assert.equal(r2.new_completed, 7);
  assert.equal(answers(db).length, 7);
  assert.equal((await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.completed, KNOWN_DISTINCT_COMPLETED);
});

test('two runs at once: one holds the lease, the other is busy, and everything lands once; a stale lease is taken over', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: HISTORY.map(item) });
  const [a, b] = await Promise.all([
    syncTypeformForm(env, deps(fake.fetch, T0, { runId: 'run-a' }), KEY),
    syncTypeformForm(env, deps(fake.fetch, T0, { runId: 'run-b' }), KEY),
  ]);
  assert.deepEqual([a.outcome, b.outcome].sort(), ['busy', 'ok']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM typeform_responses').get() as any).n, 11);
  assert.equal((db.prepare('SELECT lease_owner FROM typeform_form_syncs WHERE id = 1').get() as any).lease_owner, null);
  db.prepare("UPDATE typeform_form_syncs SET lease_owner = 'crashed-run', lease_until = ? WHERE id = 1").run(at(T0 + H));
  assert.equal((await syncTypeformForm(env, deps(fake.fetch, T0 + H - 1000), KEY)).outcome, 'busy');
  assert.equal((await syncTypeformForm(env, deps(fake.fetch, T0 + H + LEASE_MS), KEY)).outcome, 'ok');
  // A run that lost its lease cannot move the checkpoint.
  db.prepare("UPDATE typeform_form_syncs SET checkpoint_submitted_at = NULL WHERE id = 1").run();
  const stolen = { ...deps(fake.fetch, T0 + 3 * H), runId: 'run-late' };
  const fetchThenSteal = async (u: string, i: any) => { db.prepare("UPDATE typeform_form_syncs SET lease_owner = 'someone-else' WHERE id = 1").run(); return fake.fetch(u, i); };
  await syncTypeformForm(env, { ...stolen, fetch: fetchThenSteal }, KEY);
  assert.equal(checkpoint(db), null);
});

test('a revoked grant, a deleted or moved form and a disconnected connection stop the run and delete nothing', async () => {
  const { db, env } = world();
  await mapDefault(env);
  await syncTypeformForm(env, deps(fakeTypeform({ items: HISTORY.map(item) }).fetch, T0), KEY);
  const revoked = fakeTypeform({ items: [], faults: { 1: { status: 401 } } });
  assert.equal((await syncTypeformForm(env, deps(revoked.fetch, T0 + H), KEY)).outcome, 'access_revoked');
  const moved = fakeTypeform({ items: [], faults: { 1: { status: 404 } } });
  assert.equal((await syncTypeformForm(env, deps(moved.fetch, T0 + 2 * H), KEY)).outcome, 'form_unavailable');
  const lost = await syncTypeformForm(env, { ...deps(moved.fetch, T0 + 3 * H), session: async () => { throw new Error('no grant'); } }, KEY);
  assert.equal(lost.outcome, 'access_revoked');
  db.prepare("UPDATE integrations SET status = 'disconnected' WHERE id = ?").run(INTEGRATION);
  const quiet = fakeTypeform({ items: [] });
  assert.equal((await syncTypeformForm(env, deps(quiet.fetch, T0 + 4 * H), KEY)).outcome, 'access_revoked');
  assert.equal(quiet.state.calls.length, 0);
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.equal(s!.completed, KNOWN_DISTINCT_COMPLETED);
  assert.equal(s!.state, 'access_revoked');
  // Another venture's key reads nothing of this one.
  assert.equal(await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: OTHER_PROJECT }, FORM), null);
  assert.equal((await syncTypeformForm(env, deps(quiet.fetch, T0), { ...KEY, projectId: OTHER_PROJECT })).outcome, 'not_found');
});

test('the region chooses the origin and the response link; no validated region, no read', async () => {
  const eu = world();
  await mapDefault(eu.env);
  const fake = fakeTypeform({ items: [item(HISTORY[0])] });
  await syncTypeformForm(eu.env, deps(fake.fetch, T0, { session: session('eu') }), KEY);
  assert.ok(fake.state.calls.every((u) => u.startsWith('https://api.eu.typeform.com/forms/FrmSyn01')));
  assert.equal(fake.state.headers[0].authorization, `Bearer ${TOKEN}`);
  assert.equal((await typeformFormStatus(eu.env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.link, 'https://admin.eu.typeform.com/form/FrmSyn01/results#responses');
  const us = world();
  await syncTypeformForm(us.env, deps(fakeTypeform({ items: [] }).fetch, T0), KEY);
  assert.equal((await typeformFormStatus(us.env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.link, 'https://admin.typeform.com/form/FrmSyn01/results#responses');
  for (const region of [null, '', 'apac', 'EU', { region: 'eu' }]) {
    const w = world();
    const quiet = fakeTypeform({ items: [] });
    assert.equal((await syncTypeformForm(w.env, deps(quiet.fetch, T0, { session: session(region) }), KEY)).outcome, 'region_unknown');
    assert.equal(quiet.state.calls.length, 0);
    assert.equal((await typeformFormStatus(w.env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.link, null);
  }
  assert.equal(regionOf('{"region":"eu"}'), 'eu');
  assert.equal(responsesLink('us', '../evil'), null);
});

test('the reader builds only the two documented shapes', () => {
  assert.equal(typeformUrl('us', 'forms.get', FORM), 'https://api.typeform.com/forms/FrmSyn01');
  assert.equal(typeformUrl('eu', 'responses.list', FORM, { page_size: '3', after: 'R01' }), 'https://api.eu.typeform.com/forms/FrmSyn01/responses?page_size=3&after=R01');
  assert.throws(() => typeformUrl('us', 'responses.list', 'Frm/../x'), (e: any) => e instanceof TypeformReadError && e.code === 'form_unavailable');
  assert.throws(() => typeformUrl('us', 'responses.list', FORM, { query: 'x' }), (e: any) => e.code === 'unreadable');
  assert.throws(() => typeformUrl('us', 'responses.list', FORM, { since: 'a b' }), (e: any) => e.code === 'unreadable');
  assert.throws(() => typeformUrl(null, 'forms.get', FORM), (e: any) => e.code === 'region_unknown');
});

test('a renamed field keeps its id; a deleted or retyped mapped field is flagged for remapping and skipped', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const renamed = fakeTypeform({ form: FORM_DEF({ kindTitle: 'Join the synthetic waitlist?' }), items: [item(HISTORY[0])] });
  const r1 = await syncTypeformForm(env, deps(renamed.fetch, T0), KEY);
  assert.deepEqual(r1.needs_remap, []);
  assert.deepEqual({ ...(db.prepare("SELECT field_id, field_title, status FROM typeform_field_mappings WHERE field_id = 'fldKind'").get() as any) }, { field_id: 'fldKind', field_title: 'Join the synthetic waitlist?', status: 'active' });
  const changed = fakeTypeform({ form: FORM_DEF({ kindType: 'dropdown', dropPain: true }), items: [item(HISTORY[5]), item(HISTORY[6])] });
  const r2 = await syncTypeformForm(env, deps(changed.fetch, T0 + H), KEY);
  assert.deepEqual(r2.needs_remap.sort(), ['fldKind', 'fldPain']);
  assert.equal(r2.new_answers, 0, 'flagged mappings land nothing');
  assert.doesNotMatch(changed.state.calls[1], /fields=/);
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.deepEqual(s!.needs_remap, [{ field_id: 'fldKind', status: 'type_changed' }, { field_id: 'fldPain', status: 'field_deleted' }]);
  // D5828 part 3: no field title reaches the client, even for the connection owner.
  assert.ok(!JSON.stringify(s).includes('waitlist?') && !JSON.stringify(s).includes('hardest part'));
  // Remapping the retyped field to its new type makes it active again.
  assert.equal(await setTypeformMappings(env, 1, formFields(FORM_DEF({ kindType: 'dropdown', dropPain: true })), [{ field_id: 'fldKind', kind: 'waitlist', choices: ['chYes'] }], at(T0 + 2 * H)), true);
  assert.deepEqual((await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM))!.needs_remap, []);
});

test('mappings refuse identity-bearing fields, unknown choices and bad kinds, all or nothing', async () => {
  const { db, env } = world();
  const fields = formFields(FORM_DEF());
  assert.deepEqual(fields.map((f) => f.id), ['fldKind', 'fldPain', 'fldMail', 'fldOther', 'grp1', 'fldFile']);
  assert.equal(typeformMapping({ field_id: 'fldMail', kind: 'waitlist' }, fields), null);
  assert.equal(typeformMapping({ field_id: 'fldFile', kind: 'waitlist' }, fields), null);
  assert.equal(typeformMapping({ field_id: 'fldKind', kind: 'waitlist', choices: ['chMaybe'] }, fields), null);
  assert.equal(typeformMapping({ field_id: 'fldKind', kind: 'invented', choices: ['chYes'] }, fields), null);
  assert.equal(await setTypeformMappings(env, 1, fields, [MAPPINGS[0], { field_id: 'fldMail', kind: 'waitlist' }], at(T0)), false);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM typeform_field_mappings').get() as any).n, 0);
  // Free text is kept only when the founder chose to keep it.
  const noText = typeformMapping({ field_id: 'fldPain', kind: 'need_to_have' }, fields)!;
  assert.deepEqual(qualifyingAnswer({ type: 'text', text: 'Synthetic words' }, noText), { text: null });
  assert.deepEqual(qualifyingAnswer({ type: 'choices', choices: { ids: ['chNo', 'chYes'], labels: ['Not now', 'Yes, sign me up'] } }, typeformMapping(MAPPINGS[0], fields)!), { text: 'Yes, sign me up' });
  assert.deepEqual(qualifyingAnswer({ type: 'number', number: 9 }, { field_type: 'nps', rule: { min: 9 }, keep_text: false }), { text: '9' });
  assert.equal(qualifyingAnswer({ type: 'number', number: 8 }, { field_type: 'nps', rule: { min: 9 }, keep_text: false }), null);
});

test('a withdrawn answer or response stays withdrawn on resync and on a backfill', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: HISTORY.map(item) });
  await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  const scope = { integrationId: INTEGRATION, projectId: PROJECT };
  const r01kind = (db.prepare("SELECT a.id FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id WHERE r.response_id = 'R01' AND a.field_id = 'fldKind'").get() as any).id;
  assert.equal(await withdrawTypeformAnswer({ DB: env.DB } as any, { ...scope, projectId: OTHER_PROJECT }, r01kind), false, 'another venture cannot withdraw it');
  assert.equal(await withdrawTypeformAnswer(env, scope, r01kind), true);
  assert.equal(await withdrawTypeformResponse(env, scope, FORM, 'R06'), true);
  assert.equal(answers(db).length, 4);
  assert.equal((db.prepare('SELECT local_id FROM connector_fed_items WHERE external_id = ?').get(ledgerKey(FORM, PROJECT, 'R01', 'fldKind')) as any).local_id, null);
  await syncTypeformForm(env, deps(fake.fetch, T0 + H), KEY);
  await requestTypeformBackfill(env, scope, FORM, at(T0 + 2 * H));
  const r = await syncTypeformForm(env, deps(fake.fetch, T0 + 2 * H), KEY);
  assert.equal(r.skipped_withdrawn, 1); assert.equal(r.new_answers, 0);
  assert.equal(answers(db).length, 4);
  const s = await typeformFormStatus(env, scope, FORM);
  assert.equal(s!.completed, KNOWN_DISTINCT_COMPLETED, 'a withdrawn response still reconciles against Typeform');
  assert.equal(s!.withdrawn, 1); assert.equal(s!.qualifying, 4);
});

test('absence from a page deletes nothing; only two explicit lookups that miss an id mark it provider-deleted', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: HISTORY.map(item) });
  await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  fake.state.gone.add('R01');
  await requestTypeformBackfill(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM, at(T0 + H));
  await syncTypeformForm(env, deps(fake.fetch, T0 + H), KEY);
  assert.equal((db.prepare("SELECT status FROM typeform_responses WHERE response_id = 'R01'").get() as any).status, 'active');
  // A malformed lookup concludes nothing.
  const broken = async () => Response.json({ total_items: 0 });
  assert.equal((await reconcileTypeformDeletions(env, deps(broken, T0 + 2 * H), KEY)).outcome, 'unreadable');
  assert.equal((db.prepare("SELECT upstream_missing_at AS m FROM typeform_responses WHERE response_id = 'R01'").get() as any).m, null);
  const first = await reconcileTypeformDeletions(env, deps(fake.fetch, T0 + 3 * H), KEY);
  assert.deepEqual([first.outcome, first.checked, first.missing_once, first.provider_deleted], ['ok', 11, 1, 0]);
  assert.match(fake.state.calls.at(-1)!, /included_response_ids=R01%2CR02/);
  const tooSoon = await reconcileTypeformDeletions(env, deps(fake.fetch, T0 + 3 * H + RECONCILE_CONFIRM_MS - 1), KEY);
  assert.equal(tooSoon.provider_deleted, 0);
  const second = await reconcileTypeformDeletions(env, deps(fake.fetch, T0 + 3 * H + RECONCILE_CONFIRM_MS), KEY);
  assert.equal(second.provider_deleted, 1);
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.deepEqual([s!.completed, s!.provider_deleted, s!.qualifying], [KNOWN_DISTINCT_COMPLETED - 1, 1, 4]);
  // A missed id that comes back is cleared, not deleted.
  fake.state.gone.delete('R01'); fake.state.gone.add('R02');
  await reconcileTypeformDeletions(env, deps(fake.fetch, T0 + 10 * H), KEY);
  fake.state.gone.delete('R02');
  const back = await reconcileTypeformDeletions(env, deps(fake.fetch, T0 + 20 * H), KEY);
  assert.equal(back.reappeared, 1);
  assert.equal((db.prepare("SELECT status, upstream_missing_at AS m FROM typeform_responses WHERE response_id = 'R02'").get() as any).m, null);
});

test('D5828 part 4: a reconcile run is bounded, keeps its place, reaches every held id once per pass, and resumes after a failure', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const fake = fakeTypeform({ items: HISTORY.map(item) });
  await syncTypeformForm(env, deps(fake.fetch, T0), KEY);
  const cursor = () => (db.prepare('SELECT reconcile_after_id AS c, last_reconciled_at AS l FROM typeform_form_syncs WHERE id = 1').get() as any);
  const rowId = (rid: string) => Number((db.prepare('SELECT id FROM typeform_responses WHERE response_id = ?').get(rid) as any).id);
  const asked = (from: number) => fake.state.calls.slice(from).map((u) => new URL(u).searchParams.get('included_response_ids')!.split(','));
  // Two lookups of two ids per run: eleven held ids take three runs.
  const small = (now: number, extra: Record<string, any> = {}) => deps(fake.fetch, now, { limits: { reconcileBatch: 2, reconcileLookupsPerRun: 2 }, ...extra });
  fake.state.gone.add('R08');
  let from = fake.state.calls.length;
  const one = await reconcileTypeformDeletions(env, small(T0 + H), KEY);
  assert.deepEqual([one.outcome, one.lookups, one.checked], ['partly', 2, 4]);
  assert.deepEqual(asked(from), [['R01', 'R02'], ['R03', 'P01']]);
  assert.deepEqual([cursor().c, cursor().l], [rowId('P01'), null], 'the cursor is where the run stopped; no pass has finished');
  const mid = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.deepEqual([mid!.reconcile_in_progress, mid!.last_reconciled_at], [true, null]);
  from = fake.state.calls.length;
  const two = await reconcileTypeformDeletions(env, small(T0 + H + 1), KEY);
  assert.deepEqual([two.outcome, two.checked, two.missing_once], ['partly', 4, 0]);
  assert.deepEqual(asked(from), [['R04', 'R05'], ['R06', 'R07']], 'the next run continues; it does not re-ask the first ids');
  // The last run of the pass fails on its second lookup: the first lookup's place is kept.
  from = fake.state.calls.length;
  const failing = fakeTypeform({ items: HISTORY.map(item), faults: { 2: { status: 503 } } });
  failing.state.gone.add('R08');
  const failed = await reconcileTypeformDeletions(env, small(T0 + H + 2, { fetch: failing.fetch }), KEY);
  assert.deepEqual([failed.outcome, failed.lookups, failed.missing_once], ['unreadable', 1, 1]);
  assert.equal(cursor().c, rowId('R08'), 'the cursor moved only past the lookup whose writes resolved');
  const three = await reconcileTypeformDeletions(env, small(T0 + H + 3), KEY);
  assert.deepEqual([three.outcome, three.checked, three.missing_once], ['ok', 1, 0]);
  assert.deepEqual(asked(from), [['R09']], 'the retry re-asks only what the failed run did not conclude');
  assert.deepEqual([cursor().c, cursor().l], [null, new Date(T0 + H + 3).toISOString()], 'the pass finished: cursor cleared, time recorded');
  // A new pass starts at the beginning; a second miss an hour on concludes the deletion.
  from = fake.state.calls.length;
  const runs = [];
  for (let i = 0; i < 3; i += 1) runs.push(await reconcileTypeformDeletions(env, small(T0 + 3 * H + i), KEY));
  assert.deepEqual(runs.map((r) => r.outcome), ['partly', 'partly', 'ok']);
  assert.deepEqual(asked(from).flat(), ['R01', 'R02', 'R03', 'P01', 'R04', 'R05', 'R06', 'R07', 'P02', 'R08', 'R09'], 'every held id once per pass');
  assert.equal(runs.reduce((n, r) => n + r.provider_deleted, 0), 1);
  assert.equal((db.prepare("SELECT status FROM typeform_responses WHERE response_id = 'R08'").get() as any).status, 'provider_deleted');
  // A run whose lease is taken over mid-pass (a stale lease, part 1) cannot move the cursor.
  const stolen = async (url: string, init: any) => { db.prepare("UPDATE typeform_form_syncs SET lease_owner = 'another-run' WHERE id = 1").run(); return fake.fetch(url, init); };
  await reconcileTypeformDeletions(env, small(T0 + 3 * H + 10, { fetch: stolen }), KEY);
  assert.equal(cursor().c, null, 'only the run holding the lease moves the cursor');
  db.prepare('UPDATE typeform_form_syncs SET lease_owner = NULL, lease_until = NULL WHERE id = 1').run();
  // A pass after it skips the deleted id; the fixture can lower the bound but never raise it.
  from = fake.state.calls.length;
  const wide = await reconcileTypeformDeletions(env, deps(fake.fetch, T0 + 4 * H, { limits: { reconcileBatch: 1000, reconcileLookupsPerRun: 1000 } }), KEY);
  assert.deepEqual([wide.outcome, wide.lookups, wide.checked], ['ok', 1, 10]);
  assert.equal(new URL(fake.state.calls[from]).searchParams.get('page_size'), '25');
});

test('after throttling, a failed write, a late arrival and a resync the distinct completed count matches the fixture, and no identity reached storage or logs', async () => {
  const { db, env } = world();
  await mapDefault(env);
  const logged: string[] = [];
  for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) test.mock.method(console, m, (...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
  const fake = fakeTypeform({ items: HISTORY.filter((f) => f.id !== 'R08').map(item), faults: { 4: { status: 429, retryAfter: '5' } } });
  const real = env.DB.batch.bind(env.DB);
  let n = 0;
  env.DB.batch = async (s: any[]) => { n += 1; if (n === 2) throw new Error('synthetic D1 failure'); return real(s); };
  const runs = [T0, T0 + H, T0 + 2 * H];
  for (const t of runs) await syncTypeformForm(env, deps(fake.fetch, t), KEY);
  fake.state.items = HISTORY.map(item);
  await syncTypeformForm(env, deps(fake.fetch, T0 + 3 * H), KEY);
  await syncTypeformForm(env, deps(fake.fetch, T0 + 4 * H), KEY);
  test.mock.restoreAll();
  const s = await typeformFormStatus(env, { integrationId: INTEGRATION, projectId: PROJECT }, FORM);
  assert.equal(s!.state, 'ok');
  assert.equal(s!.completed, KNOWN_DISTINCT_COMPLETED);
  assert.equal(s!.qualifying, KNOWN_QUALIFYING);
  assert.equal(answers(db).length, KNOWN_ANSWERS);
  const dump = JSON.stringify([
    db.prepare('SELECT * FROM typeform_form_syncs').all(), db.prepare('SELECT * FROM typeform_field_mappings').all(),
    db.prepare('SELECT * FROM typeform_responses').all(), db.prepare('SELECT * FROM typeform_answers').all(),
    db.prepare('SELECT * FROM connector_fed_items').all(),
  ]);
  for (const m of MARKERS) {
    assert.equal(dump.includes(m), false, `${m} reached storage`);
    assert.equal(logged.some((l) => l.includes(m)), false, `${m} reached a log`);
  }
  assert.ok(logged.length >= 1, 'the failed write was logged, by name only');
});

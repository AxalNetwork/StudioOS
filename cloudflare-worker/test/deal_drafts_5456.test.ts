/**
 * D5456 (#5456, ADP-02) — private deal preparation drafts: validation, create, versioned save, the reads and the
 * admin router, on real `node:sqlite` with the fresh schema (baseline plus every migration, D5454's and D5456's
 * included). Every company, venture, person and amount is invented.
 *
 * What it proves, by acceptance test of #5456:
 *   T1  explicit create → save an incomplete draft → reload preserves text, terms, nulls, sources and the revision;
 *       no `deals` row is written and the preparation owns no deal (zero investor-visible release).
 *   T2  a repeated key, a lost response, a changed payload under the same key and concurrent creates/saves yield no
 *       duplicate preparation or revision.
 *   T3  two admins start at r1; one saves r2; the other's stale save conflicts, keeps r2 and its money values, and
 *       the conflict names the current revision and each differing field.
 *   T4  invalid numbers, precision, percentages, dates, URLs and an unsupported currency are refused field by field;
 *       blank is null, never zero; an incomplete valid draft saves with readiness warnings.
 *   T5  an audit or ledger write that fails undoes the content change, and the answer is "outcome unknown, retry
 *       with the same key", never "nothing changed" by guess.
 *   T6  a null-company project, a forged pair, an archived company and a project moved during editing are refused;
 *       a company with two projects may hold a draft for each; another deployment's draft is not found.
 *   T7  the deadline clock: the expiry instant and the day, month and year boundaries, from an injected clock.
 *   T8  mutations stay disabled: no caller holds `create` or `edit` today, and the router's POST and PATCH answer
 *       403 `preparation_mutations_disabled` with nothing written; the reads answer an admin and refuse a partner.
 *
 * MUTATION CHECKS (each was run; each turns at least one test here red):
 *   M1  drop the in-batch `lock_version = ?` guard (revision insert and token move) → concurrent-save test
 *   M2  drop the save's operation-key lookup                                       → save replay test
 *   M3  replay without comparing the payload digest                               → both `operation_key_reused` tests
 *   M4  drop the in-batch "no open draft" check on create                         → create race test
 *   M5  write the save's audit row unconditionally                                → save replay test (audit count)
 *   M6  drop the issuer re-check on save                                          → project-move test
 *   M7  store a blank amount as 0                                                 → T4 numbers, T1 reload
 *   M8  a deadline passes at its last instant (`>=`)                              → T7 clock
 *   M9  refuse minimum == target                                                  → T4 cross-field
 *   M10 permit EUR                                                                → T4 currency
 *   M11 the router skips the disabled-write refusal                               → T8 router
 *   M12 `in_review` editable                                                      → in-review test
 *   M13 write the audit row after the batch, best effort                          → T5 audit failure
 *   M14 drop the percentage upper bound                                           → T4 numbers, T4 store
 *   M15 allow non-http(s) URL schemes                                             → T4 URLs
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_drafts_5456.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import adminDealPreparations from '../src/routes/admin_deal_preparations.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { preparationCapabilities, type PreparationCapability } from '../src/services/dealPreparation.ts';
import {
  createPreparationDraft, readPreparationDetail, readPreparationRevisions, savePreparationDraft,
} from '../src/services/dealDraftStore.ts';
import {
  canonicalJson, crossFieldErrors, deadlinePassed, isCalendarDay, readinessWarnings, validateChanges,
} from '../src/services/dealDraftValidation.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_A = 1, ADMIN_B = 6, PARTNER = 2;
const ROLE: Record<number, string> = { 1: 'admin', 6: 'admin', 2: 'partner' };
const CO = 70, CO_OTHER = 71, CO_ARCHIVED = 72;
const PROJ = 10, PROJ_NO_CO = 11, PROJ_OTHER = 13, PROJ_ARCHIVED = 14, PROJ_SECOND = 15;
const ALL: ReadonlySet<PreparationCapability> = new Set(['read', 'create', 'edit']);
const NOW = new Date('2026-11-20T12:00:00.000Z');
const deps = (extra: Record<string, unknown> = {}) => ({ capabilities: ALL, now: () => NOW, ...extra }) as any;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, role, name, email, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', 1), (6, 'admin', 'Bea Admin', 'bea@example.test', 1),
      (2, 'partner', 'Pia Partner', 'pia@example.test', 1);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc'), (71, 'co-71', 'Other Issuer Inc'), (72, 'co-72', 'Archived Issuer Inc');
    UPDATE company_profiles SET archived_at = '2026-10-01 00:00:00' WHERE id = 72;
    INSERT INTO projects (id, name, company_id, sector) VALUES
      (10, 'Harbor Ledger', 70, 'fintech'), (11, 'Unincorporated Idea', NULL, 'health'), (13, 'Other Venture', 71, 'climate'),
      (14, 'Archived Venture', 72, 'retail'), (15, 'Harbor Ledger Labs', 70, 'fintech');
  `);
  return db;
}

const env = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), ...extra }) as any;
const user = (id: number) => ({ id, role: ROLE[id], email: `${id}@example.test` }) as any;
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);
let seq = 0;
const key = (tag = 'op') => `${tag}-${String(++seq).padStart(6, '0')}`;

async function created(db: DatabaseSync, content: Record<string, unknown> = { title: 'Harbor Ledger Seed' }, who = ADMIN_A) {
  const out: any = await createPreparationDraft(env(db), user(who), { company_id: CO, project_id: PROJ, content, operation_key: key('c') }, deps());
  assert.equal(out.ok, true, JSON.stringify(out));
  return out;
}

// ------------------------------------------------------------------------------------------------ T4 validation

test('T4 · numbers: non-finite, negative, three decimals, separators and booleans are field errors; blank is null, never zero', () => {
  const cases: Array<[string, unknown, string]> = [
    ['target_raise', 'NaN', 'not_a_number'], ['target_raise', Infinity, 'not_a_number'], ['target_raise', Number.NaN, 'not_a_number'],
    ['target_raise', -1, 'must_not_be_negative'], ['target_raise', '-5', 'must_not_be_negative'], ['valuation_cap', '1,000', 'not_a_number'],
    ['valuation_cap', 12.345, 'too_many_decimals'], ['valuation_cap', '12.345', 'too_many_decimals'], ['valuation_cap', 1e-7, 'too_many_decimals'],
    ['target_raise', true, 'not_a_number'], ['target_raise', 1e14, 'too_large'], ['minimum_check', 0, 'must_be_positive'],
    ['carry_pct', 100.01, 'percent_out_of_range'], ['management_fee_pct', -0.5, 'must_not_be_negative'], ['carry_pct', '2.555', 'too_many_decimals'],
  ];
  for (const [k, v, code] of cases) {
    const { errors, values } = validateChanges({ [k]: v });
    assert.equal(errors[k], code, `${k}=${String(v)}`);
    assert.ok(!(k in values), `${k}=${String(v)} was stored`);
  }
  const ok = validateChanges({ target_raise: '2500000.50', minimum_check: 25000, valuation_cap: 0, carry_pct: 100, management_fee_pct: '2' });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.values, { target_raise: 2500000.5, minimum_check: 25000, valuation_cap: 0, carry_pct: 100, management_fee_pct: 2 });
  const blank = validateChanges({ target_raise: '', minimum_check: null, carry_pct: '  ', title: '' });
  assert.deepEqual(blank.errors, {});
  assert.deepEqual(blank.values, { target_raise: null, minimum_check: null, carry_pct: null, title: null });
});

test('T4 · currency, instrument, dates, URLs, unknown keys, the audience and evidence are checked on the server', () => {
  const bad: Array<[Record<string, unknown>, string, string]> = [
    [{ currency: 'EUR' }, 'currency', 'unsupported_currency'], [{ currency: 7 }, 'currency', 'unsupported_currency'],
    [{ instrument: 'Warrant' }, 'instrument', 'unsupported_instrument'], [{ instrument: 'safe' }, 'instrument', 'unsupported_instrument'],
    [{ closing_deadline: '2026-02-30' }, 'closing_deadline', 'invalid_date'], [{ closing_deadline: '2026-1-5' }, 'closing_deadline', 'invalid_date'],
    [{ closing_deadline: '2026-12-31T00:00:00Z' }, 'closing_deadline', 'invalid_date'],
    [{ website: 'javascript:alert(1)' }, 'website', 'unsupported_url_scheme'], [{ website: 'ftp://files.example.test' }, 'website', 'unsupported_url_scheme'],
    [{ website: `https://example.test/${'a'.repeat(300)}` }, 'website', 'too_long'], [{ website: 'not a url' }, 'website', 'invalid_url'],
    [{ website: 'https://user:pw@example.test' }, 'website', 'invalid_url'],
    [{ title: 'x'.repeat(201) }, 'title', 'too_long'], [{ title: 42 }, 'title', 'not_text'],
    [{ amount: 5 }, 'amount', 'unknown_field'], [{ audience_manifest: { investors: [1] } }, 'audience_manifest', 'not_editable_here'],
    [{ evidence_refs: [{ field: 'target_raise', kind: 'quoted' }] }, 'evidence_refs', 'quoted_reference_needs_source'],
    [{ evidence_refs: [{ field: 'internal_notes', kind: 'typed' }] }, 'evidence_refs', 'invalid_reference_field'],
    [{ evidence_refs: [{ kind: 'rumour' }] }, 'evidence_refs', 'invalid_reference_kind'],
    [{ evidence_refs: [{ kind: 'typed', url: 'data:text/html,x' }] }, 'evidence_refs', 'invalid_reference_url'],
    [{ evidence_refs: 'term sheet' }, 'evidence_refs', 'not_a_list'],
  ];
  for (const [input, k, code] of bad) assert.equal(validateChanges(input).errors[k], code, JSON.stringify(input));
  const good = validateChanges({
    currency: 'usd', instrument: 'Convertible Note', closing_deadline: '2028-02-29', website: 'http://harbor.example.test/',
    evidence_refs: [{ field: 'valuation_cap', kind: 'quoted', source: 'Term sheet v2, page 1' }, { field: 'target_raise', kind: 'typed' }],
  });
  assert.deepEqual(good.errors, {});
  assert.equal(good.values.currency, 'USD');
  assert.deepEqual(good.values.evidence_refs, [
    { field: 'valuation_cap', kind: 'quoted', source: 'Term sheet v2, page 1', url: null },
    { field: 'target_raise', kind: 'typed', source: null, url: null },
  ]);
  assert.deepEqual(crossFieldErrors({ minimum_check: 500001, target_raise: 500000 }), { minimum_check: 'minimum_exceeds_target' });
  assert.deepEqual(crossFieldErrors({ minimum_check: 500000, target_raise: 500000 }), {});
  assert.deepEqual(crossFieldErrors({ minimum_check: 500001, target_raise: null }), {});
});

// ------------------------------------------------------------------------------------------------ T7 clock

test('T7 · a closing deadline passes at the end of its day in UTC, across day, month, year and leap boundaries', () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(deadlinePassed('2026-11-20', at('2026-11-20T23:59:59.999Z')), false, 'the last instant of the day');
  assert.equal(deadlinePassed('2026-11-20', at('2026-11-21T00:00:00.000Z')), true, 'the next day');
  assert.equal(deadlinePassed('2026-11-30', at('2026-12-01T00:00:00.000Z')), true, 'month boundary');
  assert.equal(deadlinePassed('2026-12-31', at('2026-12-31T23:59:59.999Z')), false);
  assert.equal(deadlinePassed('2026-12-31', at('2027-01-01T00:00:00.000Z')), true, 'year boundary');
  assert.equal(isCalendarDay('2027-02-29'), false);
  assert.equal(isCalendarDay('2028-02-29'), true);
  assert.equal(deadlinePassed('2028-02-29', at('2028-03-01T00:00:00.000Z')), true, 'leap day');
  assert.deepEqual(readinessWarnings({ title: 'T', instrument: 'SAFE', currency: 'USD', target_raise: 1, closing_deadline: '2026-11-19' }, NOW), ['closing_deadline_passed']);
  assert.deepEqual(readinessWarnings({ title: 'T', instrument: 'SAFE', currency: 'USD', target_raise: 1, closing_deadline: '2026-11-20' }, NOW), []);
  assert.deepEqual(readinessWarnings({ target_raise: null }, NOW), ['title_missing', 'instrument_missing', 'currency_missing', 'target_raise_missing', 'closing_deadline_missing']);
});

// ------------------------------------------------------------------------------------------------ T1 create / resume

test('T1 · create, save an incomplete draft, reload: text, terms, nulls, sources and revision survive; no deal row exists', async () => {
  const db = freshDb();
  try {
    const dealsBefore = count(db, 'SELECT COUNT(*) AS n FROM deals');
    const c = await created(db, { title: 'Harbor Ledger Seed', currency: 'USD' });
    assert.equal(c.revision, 1);
    assert.equal(c.revision_no, 1);
    assert.equal(c.replayed, false);
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, {
      expected_revision: 1, operation_key: key('s'),
      changes: {
        summary: 'A ledger for harbours.', target_raise: 2500000, minimum_check: '', valuation_cap: 12000000.25, instrument: 'SAFE',
        closing_deadline: '2026-11-19', evidence_refs: [{ field: 'valuation_cap', kind: 'quoted', source: 'Term sheet v2' }],
      },
    }, deps());
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(s.revision, 2);
    assert.equal(s.revision_no, 2);
    assert.equal(s.saved_at, '2026-11-20 12:00:00');

    const d: any = await readPreparationDetail(env(db), c.preparation_uid, deps());
    assert.equal(d.revision, 2);
    assert.equal(d.revision_no, 2);
    const content = d.preparation.content;
    assert.equal(content.title, 'Harbor Ledger Seed');
    assert.equal(content.summary, 'A ledger for harbours.');
    assert.equal(content.target_raise, 2500000);
    assert.equal(content.valuation_cap, 12000000.25);
    assert.ok(Object.hasOwn(content, 'minimum_check'), 'the blank minimum is kept');
    assert.equal(content.minimum_check, null, 'blank is null, never 0');
    assert.deepEqual(content.evidence_refs, [{ field: 'valuation_cap', kind: 'quoted', source: 'Term sheet v2', url: null }]);
    assert.deepEqual(d.warnings, ['closing_deadline_passed'], 'a past deadline saves and warns');
    assert.equal(d.preparation.deal_id, null);
    assert.equal(d.preparation.publication_state, 'unreleased');
    assert.deepEqual(d.issuer, { company_id: CO, company_name: 'Harbor Ledger Inc', project_id: PROJ, project_name: 'Harbor Ledger', drift: 'same' });

    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deals'), dealsBefore, 'no deal row is created');
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM deal_preparations WHERE deal_id IS NOT NULL OR released_revision_id IS NOT NULL`), 0);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action IN ('deal_preparation_created', 'deal_preparation_saved')`), 2);
    // r1 is untouched: the save wrote a new revision.
    const r1 = db.prepare('SELECT content_json FROM deal_preparation_revisions WHERE revision_no = 1').get() as any;
    assert.deepEqual(JSON.parse(r1.content_json), { currency: 'USD', title: 'Harbor Ledger Seed' });

    const list: any = await readPreparationRevisions(env(db), c.preparation_uid, {}, deps());
    assert.deepEqual(list.items.map((r: any) => [r.revision_no, r.working]), [[2, true], [1, false]]);
    assert.ok(!JSON.stringify(list).includes('Harbor Ledger Seed'), 'the revision list carries no content');
  } finally { db.close(); }
});

test('T1 · revisions page by revision number, and an unchanged save writes no revision', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    let rev = 1;
    for (const t of ['Two', 'Three', 'Four']) {
      const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: rev, operation_key: key(), changes: { title: t } }, deps());
      assert.equal(s.ok, true);
      rev = s.revision;
    }
    const p1: any = await readPreparationRevisions(env(db), c.preparation_uid, { limit: 3 }, deps());
    assert.deepEqual(p1.items.map((r: any) => r.revision_no), [4, 3, 2]);
    assert.equal(p1.next_before, 2);
    const p2: any = await readPreparationRevisions(env(db), c.preparation_uid, { limit: 3, before: p1.next_before }, deps());
    assert.deepEqual(p2.items.map((r: any) => r.revision_no), [1]);
    assert.equal(p2.next_before, null);
    const same: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: rev, operation_key: key(), changes: { title: 'Four' } }, deps());
    assert.equal(same.unchanged, true);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 4);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ T2 idempotency

test('T2 · create: a repeated key replays, a changed payload under the key conflicts, concurrent retries open one draft', async () => {
  const db = freshDb();
  try {
    const k = key('create');
    const input = { company_id: CO, project_id: PROJ, content: { title: 'Seed' }, operation_key: k };
    const [a, b, c2] = await Promise.all([1, 2, 3].map(() => createPreparationDraft(env(db), user(ADMIN_A), input, deps()))) as any[];
    for (const r of [a, b, c2]) assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(new Set([a, b, c2].map((r) => r.preparation_uid)).size, 1, 'one preparation for one key');
    assert.equal([a, b, c2].filter((r) => r.replayed === false).length, 1);
    const later: any = await createPreparationDraft(env(db), user(ADMIN_A), input, deps());
    assert.equal(later.replayed, true, 'a retry after a lost response returns the original outcome');
    assert.equal(later.preparation_uid, a.preparation_uid);
    const changed: any = await createPreparationDraft(env(db), user(ADMIN_A), { ...input, content: { title: 'Other' } }, deps());
    assert.deepEqual([changed.ok, changed.status, changed.code], [false, 409, 'operation_key_reused']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparations'), 1);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 1);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'deal_preparation_created'`), 1);
  } finally { db.close(); }
});

test('T2 · create: an open draft is resumed, not duplicated; a new round is an explicit choice', async () => {
  const db = freshDb();
  try {
    const first = await created(db);
    const again: any = await createPreparationDraft(env(db), user(ADMIN_B), { company_id: CO, project_id: PROJ, operation_key: key() }, deps());
    assert.deepEqual([again.status, again.code, again.extra.preparation_uid], [409, 'open_preparation_exists', first.preparation_uid]);
    // Two different keys racing for the same pair: the in-batch check lets only one through.
    const race = await Promise.all([ADMIN_A, ADMIN_B].map((who) => createPreparationDraft(env(db), user(who), { company_id: CO, project_id: PROJ_SECOND, operation_key: key('race') }, deps()))) as any[];
    assert.deepEqual(race.map((r) => r.ok).sort(), [false, true]);
    assert.equal(race.find((r) => !r.ok).code, 'open_preparation_exists');
    const round: any = await createPreparationDraft(env(db), user(ADMIN_A), { company_id: CO, project_id: PROJ, new_round: true, operation_key: key() }, deps());
    assert.equal(round.ok, true);
    assert.notEqual(round.preparation_uid, first.preparation_uid);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparations'), 3);
  } finally { db.close(); }
});

test('T2 · save: a repeated key replays, a changed payload conflicts, concurrent retries write one revision', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    const k = key('save');
    const input = { expected_revision: 1, operation_key: k, changes: { target_raise: 1000000 } };
    const all = await Promise.all([1, 2, 3].map(() => savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, input, deps()))) as any[];
    for (const r of all) assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(new Set(all.map((r) => r.revision_uid)).size, 1);
    const retry: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, input, deps());
    assert.deepEqual([retry.ok, retry.replayed, retry.revision, retry.revision_no], [true, true, 2, 2]);
    const changed: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { ...input, changes: { target_raise: 2000000 } }, deps());
    assert.deepEqual([changed.status, changed.code], [409, 'operation_key_reused']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 2);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'deal_preparation_saved'`), 1);
    // The same key from another admin is that admin's own operation, checked against the current revision.
    const other: any = await savePreparationDraft(env(db), user(ADMIN_B), c.preparation_uid, input, deps());
    assert.equal(other.code, 'revision_conflict');
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ T3 concurrency

test('T3 · two admins at r1: the second, stale save conflicts and r2 keeps its money values', async () => {
  const db = freshDb();
  try {
    const c = await created(db, { title: 'Seed', target_raise: 1000000, minimum_check: 10000 });
    const a: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key('a'), changes: { target_raise: 1500000 } }, deps());
    assert.equal(a.revision, 2);
    const b: any = await savePreparationDraft(env(db), user(ADMIN_B), c.preparation_uid, { expected_revision: 1, operation_key: key('b'), changes: { target_raise: 900000, title: 'Seed' } }, deps());
    assert.deepEqual([b.ok, b.status, b.code], [false, 409, 'revision_conflict']);
    assert.equal(b.extra.current.revision, 2);
    assert.equal(b.extra.current.revision_no, 2);
    assert.equal(b.extra.current.saved_by_user_id, ADMIN_A);
    assert.deepEqual(b.extra.fields, [{ key: 'target_raise', yours: 900000, current: 1500000 }], 'only the differing field, with both values');
    const d: any = await readPreparationDetail(env(db), c.preparation_uid, deps());
    assert.equal(d.preparation.content.target_raise, 1500000);
    assert.equal(d.preparation.content.minimum_check, 10000);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 2);
  } finally { db.close(); }
});

test('T3 · concurrent saves from one revision with different keys: exactly one lands', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    const out = await Promise.all([ADMIN_A, ADMIN_B, ADMIN_A].map((who, i) => savePreparationDraft(env(db), user(who), c.preparation_uid, {
      expected_revision: 1, operation_key: key(`r${i}`), changes: { target_raise: 100000 * (i + 1) },
    }, deps()))) as any[];
    assert.equal(out.filter((r) => r.ok).length, 1);
    assert.deepEqual(out.filter((r) => !r.ok).map((r) => r.code), ['revision_conflict', 'revision_conflict']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 2);
    assert.equal(Number((db.prepare('SELECT lock_version AS n FROM deal_preparations').get() as any).n), 2);
  } finally { db.close(); }
});

test('T3 · a draft in review is not edited in place', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    db.exec(`UPDATE deal_preparations SET preparation_state = 'in_review', submitted_revision_id = working_revision_id`);
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { title: 'Edit' } }, deps());
    assert.deepEqual([s.status, s.code], [409, 'preparation_not_editable']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 1);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ T4 through the store

test('T4 · the store refuses invalid and inconsistent values with field errors and writes nothing', async () => {
  const db = freshDb();
  try {
    const bad: any = await createPreparationDraft(env(db), user(ADMIN_A), { company_id: CO, project_id: PROJ, operation_key: key(), content: { currency: 'GBP', carry_pct: 120 } }, deps());
    assert.deepEqual([bad.status, bad.code, bad.extra.fields], [422, 'invalid_fields', { currency: 'unsupported_currency', carry_pct: 'percent_out_of_range' }]);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparations'), 0);
    const c = await created(db, { target_raise: 500000 });
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { minimum_check: 600000 } }, deps());
    assert.deepEqual([s.status, s.code, s.extra.fields], [422, 'invalid_fields', { minimum_check: 'minimum_exceeds_target' }], 'the cross-field rule reads the merged draft');
    const stale: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: undefined, operation_key: key(), changes: { title: 'x' } }, deps());
    assert.deepEqual([stale.status, stale.code], [428, 'expected_revision_required']);
    const nokey: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: 'short', changes: { title: 'x' } }, deps());
    assert.equal(nokey.code, 'invalid_operation_key');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 1);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ T5 atomic audit

test('T5 · a failing audit write undoes the save and the create, and the answer is "outcome unknown"', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    db.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit store down'); END;`);
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { target_raise: 1 } }, deps());
    assert.deepEqual([s.ok, s.status, s.code], [false, 503, 'save_outcome_unknown']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 1, 'no unaudited revision');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_operations'), 1, 'only the create');
    assert.equal(Number((db.prepare('SELECT lock_version AS n FROM deal_preparations').get() as any).n), 1);
    const k = key('lost');
    const cr: any = await createPreparationDraft(env(db), user(ADMIN_A), { company_id: CO, project_id: PROJ_SECOND, operation_key: k }, deps());
    assert.deepEqual([cr.status, cr.code], [503, 'create_outcome_unknown']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparations'), 1, 'no unaudited preparation');
    // The store recovers: the same key now reports what happened.
    db.exec('DROP TRIGGER fail_audit');
    const again: any = await createPreparationDraft(env(db), user(ADMIN_A), { company_id: CO, project_id: PROJ_SECOND, operation_key: k }, deps());
    assert.deepEqual([again.ok, again.replayed], [true, false]);
  } finally { db.close(); }
});

test('T5 · a failing ledger write undoes the revision too', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    db.exec(`CREATE TRIGGER fail_ledger BEFORE INSERT ON deal_preparation_operations BEGIN SELECT RAISE(ABORT, 'ledger down'); END;`);
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { title: 'Lost' } }, deps());
    assert.equal(s.code, 'save_outcome_unknown');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 1);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'deal_preparation_saved'`), 0);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ T6 issuer and scope

test('T6 · the issuer pair: no company, a forged pair and an archived company are refused; two projects of one company each hold a draft', async () => {
  const db = freshDb();
  try {
    const tryCreate = (company_id: number, project_id: number) =>
      createPreparationDraft(env(db), user(ADMIN_A), { company_id, project_id, operation_key: key() }, deps()) as Promise<any>;
    assert.deepEqual(((r) => [r.status, r.code])(await tryCreate(CO, PROJ_NO_CO)), [422, 'project_has_no_company']);
    assert.deepEqual(((r) => [r.status, r.code])(await tryCreate(CO, PROJ_OTHER)), [422, 'company_mismatch']);
    assert.deepEqual(((r) => [r.status, r.code])(await tryCreate(CO_ARCHIVED, PROJ_ARCHIVED)), [422, 'company_archived']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparations'), 0);
    assert.equal((await tryCreate(CO, PROJ)).ok, true);
    assert.equal((await tryCreate(CO, PROJ_SECOND)).ok, true, 'a company with two projects');
    assert.equal((await tryCreate(CO_OTHER, PROJ_OTHER)).ok, true);
  } finally { db.close(); }
});

test('T6 · a project moved to another company during editing is refused for reconciliation, and the detail says so', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    db.exec(`UPDATE projects SET company_id = ${CO_OTHER} WHERE id = ${PROJ}`);
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { title: 'Moved' } }, deps());
    assert.deepEqual([s.status, s.code, s.extra.reason], [409, 'issuer_reconciliation_required', 'company_mismatch']);
    const d: any = await readPreparationDetail(env(db), c.preparation_uid, deps());
    assert.equal(d.issuer.drift, 'moved');
    assert.equal(d.issuer.company_id, CO, 'the pinned issuer is not rewritten');
    db.exec(`UPDATE projects SET company_id = NULL WHERE id = ${PROJ}`);
    assert.equal(((await readPreparationDetail(env(db), c.preparation_uid, deps())) as any).issuer.drift, 'detached');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions'), 1);
  } finally { db.close(); }
});

test('T6 · another deployment does not see or edit this deployment\'s draft', async () => {
  const db = freshDb();
  try {
    const c = await created(db);
    const branch = env(db, { BRANCH_CODE: 'eu' });
    assert.equal(await readPreparationDetail(branch, c.preparation_uid, deps()), null);
    assert.equal(await readPreparationRevisions(branch, c.preparation_uid, {}, deps()), null);
    const s: any = await savePreparationDraft(branch, user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { title: 'x' } }, deps());
    assert.equal(s.code, 'preparation_not_found');
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ T8 still disabled

test('T8 · without create or edit the store refuses, and no caller holds either today', async () => {
  const db = freshDb();
  try {
    const readOnly = deps({ capabilities: new Set(['read']) });
    const cr: any = await createPreparationDraft(env(db), user(ADMIN_A), { company_id: CO, project_id: PROJ, operation_key: key() }, readOnly);
    assert.deepEqual([cr.status, cr.code], [403, 'preparation_create_not_permitted']);
    const c = await created(db);
    const s: any = await savePreparationDraft(env(db), user(ADMIN_A), c.preparation_uid, { expected_revision: 1, operation_key: key(), changes: { title: 'x' } }, readOnly);
    assert.deepEqual([s.status, s.code], [403, 'preparation_edit_not_permitted']);
    assert.equal(await readPreparationDetail(env(db), c.preparation_uid, deps({ capabilities: new Set() })), null);
    const caps = preparationCapabilities(env(db), user(ADMIN_A), null, { writesFrozen: false });
    assert.deepEqual([...caps], ['read']);
  } finally { db.close(); }
});

const app = (() => {
  const a = new Hono();
  a.route('/api/admin/deals', adminDealPreparations as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error', m: String(err?.message) }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/admin/deals${path}`, {
    method: init.method ?? 'GET', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}`, ...(init.headers || {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* asserted on text */ }
  return { status: res.status, body, text };
}

test('T8 · the router: reads answer an admin and refuse a partner; POST and PATCH are disabled and write nothing', async () => {
  const db = freshDb();
  try {
    const c = await created(db, { title: 'Harbor Ledger Seed', target_raise: 750000 });
    const q = await call(db, ADMIN_A, '');
    assert.equal(q.status, 200, q.text);
    assert.equal(q.body.total, 1);
    assert.ok(!q.text.includes('Harbor Ledger Seed'), 'the queue carries no content');
    const d = await call(db, ADMIN_A, `/${c.preparation_uid}`);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.preparation.content.target_raise, 750000);
    assert.deepEqual(d.body.capabilities, ['read']);
    const rv = await call(db, ADMIN_A, `/${c.preparation_uid}/revisions`);
    assert.deepEqual([rv.status, rv.body.items.length], [200, 1]);
    assert.equal((await call(db, ADMIN_A, '/00000000-0000-0000-0000-000000000000')).status, 404);
    for (const path of ['', `/${c.preparation_uid}`, `/${c.preparation_uid}/revisions`]) {
      assert.equal((await call(db, PARTNER, path)).status, 403, `partner reads ${path}`);
    }
    const before = count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions') + count(db, 'SELECT COUNT(*) AS n FROM deal_preparations');
    const post = await call(db, ADMIN_A, '', { method: 'POST', body: { company_id: CO, project_id: PROJ_SECOND, operation_key: key() } });
    assert.deepEqual([post.status, post.body.error], [403, 'preparation_mutations_disabled']);
    assert.match(post.body.message, /Nothing was saved/);
    const patch = await call(db, ADMIN_A, `/${c.preparation_uid}`, { method: 'PATCH', headers: { 'If-Match': '"1"' }, body: { operation_key: key(), changes: { title: 'x' } } });
    assert.deepEqual([patch.status, patch.body.error], [403, 'preparation_mutations_disabled']);
    assert.equal((await call(db, PARTNER, '', { method: 'POST', body: {} })).status, 403);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deal_preparation_revisions') + count(db, 'SELECT COUNT(*) AS n FROM deal_preparations'), before);
  } finally { db.close(); }
});

test('canonicalJson: key order does not change a digest; arrays keep their order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, 1], c: null } }), canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }));
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
});

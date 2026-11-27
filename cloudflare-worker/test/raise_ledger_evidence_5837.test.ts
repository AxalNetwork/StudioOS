/**
 * D5837 (#5837) — a founder pins one line of one exact ledger statement revision (D5833) to a Raise claim, over the
 * full migrated schema with signed requests and the D5833 synthetic QuickBooks fixtures:
 *   · who may choose (the founder) and who is refused (a co-founder member, an admin, an investor, a stranger);
 *   · the choice is checked against the revision (amount, date, currency, basis, line), a stale revision and another
 *     venture's revision or claim are refused, and the item it makes is Private;
 *   · every shared read (the investor's view, a pack link, the scoring pack, Eadwyn's pack, an admin's read, the
 *     narrative claims an admin reads) shows only what the founder shared, and only the one line's fact and context;
 *   · a generic `project_metrics.source` string is not ledger provenance;
 *   · a correction reads "changed", leaves every shared view and is re-reviewed onto the new revision; withdrawal,
 *     unlink, a revoked connection and a deleted revision each act, and the founder still reads the kept fact.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_ledger_evidence_5837.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import router, { mount } from '../src/routes/raise_ledger_evidence.ts';
import { fromQuickBooks } from '../src/services/financialStatements/quickbooks.ts';
import { writeSnapshot } from '../src/services/financialStatements/store.ts';
import { buildCandidates, collectEvidenceSources, evidencePack, investorEvidence, linkClaim, readRaiseEvidence, setSharing } from '../src/services/raiseEvidence.ts';
import { createPackLink, openPackLink } from '../src/services/raiseEvidenceShare.ts';
import { packFacts } from '../src/services/raiseShareProposals.ts';
import { narrativeClaims } from '../src/services/narrative/claims.ts';

const JWT_SECRET = 'synthetic-5837-only-not-a-real-credential'.repeat(2);
const FOUNDER = 1, COFOUNDER = 2, ADMIN = 3, INVESTOR = 5, STRANGER = 6, PROJECT = 1, OTHER = 2;
const REALM = '9130350000000001';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/accounting/${name}.json`, import.meta.url), 'utf8'));
const QB_PL = fixture('quickbooks_profit_and_loss'), QB_BS = fixture('quickbooks_balance_sheet');
const PL_PERIOD = { start: '2026-04-01', end: '2026-09-30' };
/** Lines of the same reports that a share must never carry: other totals, accounts and their amounts. */
const OTHER_LINES = /Total Expenses|100410\.25|Net Income|-59519\.75|Checking|184210\.07|Total Bank Accounts|232959\.67|group:Income|snapshot_uid|source_key/;

/** The migrated schema, built once and replayed into each test's database. */
const DDL = (() => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql);
  db.close(); return ddl;
})();
async function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
     (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(2,'Synthetic Cofounder','two@example.invalid','founder',200,1,0,NULL),
     (3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL),(5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0,'approved'),
     (6,'Synthetic Stranger','six@example.invalid','founder',600,1,0,NULL);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One'),(60,'company-six','Synthetic Six');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10),(2,'venture-two','Other Venture',600,60);
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('two',2,10),('three',3,10),('six',6,60);
   INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,2,'cofounder','accepted');
   INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES(1,'int-qb-founder',1,'quickbooks','active','oauth2'),(2,'int-qb-stranger',6,'quickbooks','active','oauth2');
   INSERT INTO raise_claims(id,uid,project_id,surface,surface_version,field_key,claim_kind,stated_value) VALUES
     (1,'claim-revenue',1,'narrative','v1','traction#revenue','revenue','40890'),(2,'claim-cash',1,'use_of_funds','v1','cash','cash','232959'),
     (3,'claim-other',2,'narrative','v1','traction#revenue','revenue','1');`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const founder = db.prepare('SELECT * FROM users WHERE id=1').get() as any;
  const ctx: any = { env, user: founder, projectId: PROJECT, companyId: 10, founder: true };
  const scope = { user: { ...founder, licences: ['founder'] }, projectId: PROJECT };
  const pl = await writeSnapshot(env, scope, 1, fromQuickBooks(QB_PL, { realm_id: REALM, requested: PL_PERIOD }));
  const bs = await writeSnapshot(env, scope, 1, fromQuickBooks(QB_BS, { realm_id: REALM, requested: { as_of: '2026-09-30' } }));
  const other = await writeSnapshot(env, { user: { ...(db.prepare('SELECT * FROM users WHERE id=6').get() as any), licences: ['founder'] }, projectId: OTHER }, 2,
    fromQuickBooks(QB_PL, { realm_id: REALM, requested: PL_PERIOD }));
  return { db, env, ctx, scope, pl, bs, other };
}
type World = Awaited<ReturnType<typeof world>>;
/** The correction: the P&L's income total is restated, so the next write is a new revision. */
async function correct(w: World, income = '41000.00') {
  const body = structuredClone(QB_PL);
  const walk = (n: any): boolean => {
    if (n && typeof n === 'object') {
      if (n.group === 'Income' && n.Summary?.ColData?.[1]) { n.Summary.ColData[1].value = income; return true; }
      for (const v of Object.values(n)) if (walk(v)) return true;
    }
    return false;
  };
  assert.ok(walk(body), 'the fixture has an income total to correct');
  return writeSnapshot(w.env, w.scope, 1, fromQuickBooks(body, { realm_id: REALM, requested: PL_PERIOD }));
}
const revenueFact = (w: World, extra: Record<string, unknown> = {}) => ({
  snapshot_uid: w.pl.uid, source_key: 'group:Income', amount: '40890.50', currency: 'USD', basis: 'cash', observed_on: '2026-09-30', claim_id: 'claim-revenue', ...extra,
});

const app = new Hono<any>();
app.route(mount.path, mount.router as any);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(w: World, who: number | null, method: string, tail: string, body?: unknown, project = PROJECT) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const sep = tail.includes('?') ? '&' : '?';
  const res = await app.request(`/api/raise-ledger-evidence${tail}${sep}project=${project}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  return { status: res.status, body: await res.json().catch(() => null) as any, cache: res.headers.get('cache-control') };
}
const count = (w: World, table: string) => Number((w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
async function pin(w: World, extra: Record<string, unknown> = {}) {
  const r = await call(w, FOUNDER, 'POST', '/selections', revenueFact(w, extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.selection;
}
function audience(w: World) {
  w.db.exec(`INSERT INTO data_room_grants(id,uid,project_id,investor_user_id,granted_by_user_id,status) VALUES(5,'grant-5',1,5,1,'active');
    INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(1,5,'active');`);
}
const itemOf = (w: World, uid: string) => w.db.prepare('SELECT * FROM raise_evidence_items WHERE uid=?').get(uid) as any;
async function share(w: World, uid: string, visibility: 'summary' | 'after_nda' | 'private') {
  return setSharing(w.ctx, uid, { version: itemOf(w, uid).version, visibility });
}
const ledgerRows = (view: any) => (view.items?.rows ?? []).filter((r: any) => r.kind === 'ledger-fact');

test('mounted at /api/raise-ledger-evidence; the table keeps its fact and refuses an edit to it', async () => {
  assert.equal(mount.path, '/api/raise-ledger-evidence');
  assert.equal(mount.router, router);
  const w = await world();
  const cols = (w.db.prepare('PRAGMA table_info(raise_ledger_selections)').all() as any[]).map(c => c.name);
  for (const c of ['snapshot_id', 'snapshot_uid', 'revision', 'source_key', 'line_label', 'amount', 'amount_minor', 'currency', 'basis', 'observed_on', 'figure', 'claim_id', 'item_id', 'replaces_id', 'status', 'selected_by']) {
    assert.ok(cols.includes(c), c);
  }
  const s = await pin(w);
  assert.throws(() => w.db.prepare("UPDATE raise_ledger_selections SET amount='1.00' WHERE uid=?").run(s.uid), /never edited/);
  assert.throws(() => w.db.prepare('UPDATE raise_ledger_selections SET revision=2 WHERE uid=?').run(s.uid), /never edited/);
  w.db.prepare("UPDATE raise_ledger_selections SET status='withdrawn' WHERE uid=?").run(s.uid); // the lifecycle columns stay writable
});

test('only the founder reads or chooses; a co-founder member, an admin, an investor and a stranger are refused with no figure', async () => {
  const w = await world();
  const ok = await call(w, FOUNDER, 'GET', '');
  assert.equal(ok.status, 200);
  assert.equal(ok.cache, 'private, no-store');
  const offered = ok.body.options.map((o: any) => [o.report, o.figure, o.line.source_key, o.amount, o.pinnable]);
  assert.deepEqual(offered.sort(), [
    ['balance_sheet', 'cash_balance', 'group:BankAccounts', '232959.67', true],
    ['profit_and_loss', 'profit', 'group:NetIncome', '-59519.75', true],
    ['profit_and_loss', 'revenue', 'group:Income', '40890.50', true],
  ], 'only the statement totals that may support a figure are offered, never an account line');
  for (const who of [COFOUNDER, ADMIN, INVESTOR, STRANGER]) {
    for (const [method, tail, body] of [['GET', '', undefined], ['POST', '/selections', revenueFact(w)]] as const) {
      const r = await call(w, who, method, tail, body);
      assert.ok([403, 404].includes(r.status), `${who} ${method} ${r.status}`);
      assert.ok(!/40890|232959/.test(JSON.stringify(r.body)), 'no figure in a refusal');
    }
  }
  assert.equal(count(w, 'raise_ledger_selections'), 0);
  assert.equal((await call(w, null, 'GET', '')).status, 401);
  // Another venture's founder on their own venture sees only their own statement, never this venture's.
  const theirs = await call(w, STRANGER, 'GET', '', undefined, OTHER);
  assert.equal(theirs.status, 200);
  assert.ok(theirs.body.options.every((o: any) => o.snapshot_uid === w.other.uid));
});

test('the choice is checked against the revision; refusals write nothing', async () => {
  const w = await world();
  const refused: Array<[Record<string, unknown>, number, string]> = [
    [{ amount: '40890.51' }, 409, 'mismatch'],
    [{ amount: '40,890.50' }, 409, 'mismatch'],
    [{ observed_on: '2026-04-01' }, 409, 'mismatch'],
    [{ currency: 'EUR' }, 409, 'mismatch'],
    [{ basis: 'accrual' }, 409, 'mismatch'],
    [{ source_key: 'group:Expenses', amount: '100410.25' }, 400, 'unsupported_line'],
    [{ snapshot_uid: w.bs.uid, source_key: 'account:35', amount: '184210.07' }, 400, 'unsupported_line'],
    [{ source_key: 'group:Nope' }, 404, 'not_found'],
    [{ snapshot_uid: w.other.uid }, 404, 'not_found'],
    [{ claim_id: 'claim-other' }, 404, 'not_found'],
    [{ amount: 40890.5 }, 400, 'invalid'],
    [{ extra: 1 }, 400, 'invalid'],
  ];
  for (const [extra, status, code] of refused) {
    const r = await call(w, FOUNDER, 'POST', '/selections', revenueFact(w, extra));
    assert.deepEqual([r.status, r.body.error], [status, code], JSON.stringify(extra));
  }
  w.db.exec("UPDATE integrations SET status='revoked' WHERE id=1");
  assert.deepEqual((await call(w, FOUNDER, 'POST', '/selections', revenueFact(w))).body.error, 'source_unavailable');
  w.db.exec("UPDATE integrations SET status='active' WHERE id=1");
  // A stale revision: once a correction exists, the earlier revision cannot be chosen.
  await correct(w);
  assert.deepEqual((await call(w, FOUNDER, 'POST', '/selections', revenueFact(w))).body.error, 'superseded');
  for (const t of ['raise_ledger_selections', 'raise_evidence_items', 'raise_claim_evidence', 'financial_statement_pins']) assert.equal(count(w, t), 0, t);
});

test('a pin writes the founder-chosen fact as a Private, pinned connector item linked to its claim, and the revision pin', async () => {
  const w = await world();
  const s = await pin(w, { amount: '40890.5' }); // the same amount, written to fewer places, is the same amount
  assert.equal(s.status, 'current');
  assert.equal(s.source, 'current');
  assert.deepEqual(s.fact, { figure: 'revenue', provider: 'quickbooks', report: 'profit_and_loss', revision: 1, snapshot_uid: w.pl.uid,
    line: { source_key: 'group:Income', label: 'Total Income' }, amount: '40890.50', currency: 'USD', basis: 'cash', observed_on: '2026-09-30', period: PL_PERIOD });
  assert.deepEqual([s.item.state, s.item.visibility, s.item.area], ['pinned', 'private', 'Investor narrative and Pitch deck']);
  assert.deepEqual([s.claim.uid, s.claim.state], ['claim-revenue', 'not_backed']);
  const item = itemOf(w, s.item.uid);
  assert.deepEqual([item.kind, item.source_table, item.source_label, item.provider, item.strength, item.value_num, item.value_unit, item.currency, item.private_reason, item.accepted_by],
    ['ledger-fact', 'raise_ledger_selections', 'connector', 'quickbooks', 'measured', 4089050, 'cents', 'USD', null, FOUNDER]);
  assert.equal((w.db.prepare("SELECT how FROM raise_claim_evidence WHERE item_id=?").get(item.id) as any).how, 'founder');
  assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM financial_statement_pins p JOIN financial_statement_snapshots f ON f.id=p.snapshot_id WHERE f.uid=?').get(w.pl.uid) as any).n, 1);
  assert.equal(count(w, "fill_provenance WHERE task='raise:ledger-evidence'"), 1);
  // The founder's evidence read sees it as recorded, with its value, and the hourly builder never proposes a ledger line.
  const read: any = await readRaiseEvidence(w.ctx);
  const row = read.items.rows.find((r: any) => r.uid === s.item.uid);
  assert.deepEqual([row.source_state, row.value_num], ['recorded', 4089050]);
  await buildCandidates(w.ctx, { force: true });
  assert.equal(count(w, "ai_rail_proposals WHERE json_extract(payload_json,'$.kind')='ledger-fact'"), 0);
  // The cash total pins to the Use of funds claim, in the Use of funds area.
  const cash = await pin(w, { snapshot_uid: w.bs.uid, source_key: 'group:BankAccounts', amount: '232959.67', basis: 'accrual', claim_id: 'claim-cash' });
  assert.deepEqual([cash.fact.figure, cash.item.area], ['cash_balance', 'Use of funds']);
});

test('shared reads show only what the founder shared, and only the one line with its context', async () => {
  const w = await world();
  audience(w);
  const s = await pin(w);
  // Private: no investor, link, admin or model read sees it.
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 0, 'Private is not shared');
  await share(w, s.item.uid, 'summary');
  const summary = ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR));
  assert.equal(summary.length, 1);
  assert.deepEqual([summary[0].value_num, summary[0].ledger.amount, summary[0].ledger.line], [null, null, 'Total Income'], 'a summary share carries the context, not the figure');
  await share(w, s.item.uid, 'after_nda');
  const view: any = await investorEvidence(w.env, PROJECT, INVESTOR);
  const [shared] = ledgerRows(view);
  assert.deepEqual(shared.ledger, { figure: 'revenue', report: 'profit_and_loss', line: 'Total Income', basis: 'cash', currency: 'USD', period: PL_PERIOD, revision: 1,
    provider: 'quickbooks', amount: '40890.50' });
  assert.deepEqual([shared.value_num, shared.value_unit, shared.currency], [4089050, 'cents', 'USD']);
  assert.deepEqual(view.claims.rows.map((c: any) => c.uid), ['claim-revenue']);
  assert.ok(!OTHER_LINES.test(JSON.stringify(view)), 'no other line, amount or internal key reaches the investor');
  // Cross-venture: the other venture's readers see none of it.
  assert.equal(JSON.stringify(await investorEvidence(w.env, OTHER, INVESTOR).catch(() => null)).includes('Total Income'), false);
  // A pack link outside Axal (an export): the same one fact and context.
  const link: any = await createPackLink(w.ctx, { label: 'Diligence', reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-11-01' });
  const opened: any = await openPackLink(w.env, link.path.split('/').pop());
  assert.equal(opened.ok, true);
  assert.equal(ledgerRows(opened.pack).length, 1);
  assert.ok(!OTHER_LINES.test(JSON.stringify(opened.pack)));
  // Scoring and Eadwyn never read a ledger fact; an admin's evidence read and narrative claims never list one.
  assert.equal((await evidencePack(w.env, PROJECT, { audience: 'scoring' })).items.some(i => i.kind === 'ledger-fact'), false);
  assert.equal((await packFacts(w.env, PROJECT, 'Seed fund'))!.items.some(i => i.kind === 'ledger-fact'), false);
  const admin: any = await readRaiseEvidence({ ...w.ctx, user: w.db.prepare('SELECT * FROM users WHERE id=3').get(), founder: false });
  assert.equal(admin.items.rows.length, 0);
  assert.deepEqual(admin.coverage.groups, []);
  // Even on a claim marked backed, an admin's narrative read names no ledger item as its best source.
  w.db.exec("UPDATE raise_claims SET state='backed' WHERE uid='claim-revenue'");
  const claims: any = await narrativeClaims(w.env, PROJECT, 1, { founder: false });
  assert.equal(claims.claims.find((c: any) => c.uid === 'claim-revenue').best_source, null);
});

test('a generic project_metrics.source string is not ledger provenance', async () => {
  const w = await world();
  w.db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,mrr) VALUES(9,1,'2026-09-30','quickbooks',40890)");
  w.db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,mrr) VALUES(10,1,'2026-09-30','connector:xero',40890)");
  const sources = await collectEvidenceSources(w.env, PROJECT, FOUNDER);
  const kpis = sources.candidates.filter(c => c.kind === 'kpi-snapshot');
  assert.ok(kpis.length >= 2);
  for (const c of kpis) assert.deepEqual([c.source_label, c.provider], ['typed', null], c.source_ref);
  assert.equal(sources.candidates.some(c => c.kind === 'ledger-fact'), false, 'no ledger fact without the founder’s choice');
});

test('a correction reads changed, leaves every shared view, and is re-reviewed onto the new revision as a new Private item', async () => {
  const w = await world();
  audience(w);
  const s = await pin(w);
  assert.deepEqual((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, revenueFact(w))).body.error, 'not_changed');
  await share(w, s.item.uid, 'after_nda');
  const second = await correct(w);
  // Founder: changed, with the correction named; the kept fact is still the pinned revision's.
  const read: any = await readRaiseEvidence(w.ctx);
  assert.equal(read.items.rows.find((r: any) => r.uid === s.item.uid).source_state, 'changed');
  const mine = (await call(w, FOUNDER, 'GET', '')).body.selections.find((x: any) => x.uid === s.uid);
  assert.equal(mine.source, 'corrected');
  assert.deepEqual([mine.fact.amount, mine.fact.revision], ['40890.50', 1]);
  assert.deepEqual([mine.correction.snapshot_uid, mine.correction.revision, mine.correction.line.amount], [second.uid, 2, '41000.00']);
  // Every shared read drops it, and nothing re-shares the superseded figure in place.
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 0);
  await assert.rejects(setSharing(w.ctx, s.item.uid, { version: itemOf(w, s.item.uid).version, visibility: 'after_nda', confirm_current: true }), (e: any) => e.code === 'changed');
  await assert.rejects(linkClaim(w.ctx, 'claim-cash', { item_id: s.item.uid, item_version: itemOf(w, s.item.uid).version }), (e: any) => e.code === 'changed');
  // Re-review: the old revision is stale, the old amount is not what the new revision says, the right one is accepted.
  const fix = (extra: Record<string, unknown> = {}) => { const { claim_id: _c, ...f } = revenueFact(w, { snapshot_uid: second.uid, amount: '41000.00', ...extra }); return f; };
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, { ...fix(), stated_value: 1 })).body.error, 'invalid');
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, { ...fix(), claim_id: 'claim-other' })).body.error, 'not_found');
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, fix({ snapshot_uid: w.pl.uid }))).body.error, 'superseded');
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, fix({ amount: '40890.50' }))).body.error, 'mismatch');
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, fix({ snapshot_uid: w.bs.uid, source_key: 'group:BankAccounts', amount: '232959.67', basis: 'accrual' }))).body.error, 'mismatch');
  assert.equal((await call(w, COFOUNDER, 'POST', `/selections/${s.uid}/review`, fix())).status, 404);
  const r = await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, fix());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const next = r.body.selection;
  assert.deepEqual([next.status, next.replaces, next.fact.revision, next.fact.amount, next.item.visibility, next.claim.uid], ['current', s.uid, 2, '41000.00', 'private', 'claim-revenue']);
  const old = (await call(w, FOUNDER, 'GET', '')).body.selections.find((x: any) => x.uid === s.uid);
  assert.deepEqual([old.status, old.fact.amount, old.item.state, old.item.visibility], ['replaced', '40890.50', 'unpinned', 'private'], 'the prior value stays readable to the founder');
  assert.equal(count(w, `raise_claim_evidence WHERE item_id=${itemOf(w, s.item.uid).id}`), 0);
  assert.equal(count(w, `raise_claim_evidence WHERE item_id=${itemOf(w, next.item.uid).id} AND how='founder'`), 1);
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/review`, fix())).body.error, 'decided');
  // Private until the founder shares it again; then the investor reads the corrected revision only.
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 0);
  await share(w, next.item.uid, 'after_nda');
  const rows = ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR));
  assert.deepEqual(rows.map((x: any) => [x.ledger.revision, x.ledger.amount, x.value_num]), [[2, '41000.00', 4100000]]);
});

test('withdraw and unlink: out of every claim and every shared view; the founder keeps the fact', async () => {
  const w = await world();
  audience(w);
  const s = await pin(w);
  await share(w, s.item.uid, 'after_nda');
  // Unlink through the existing claim link removes only the link.
  await linkClaim(w.ctx, 'claim-revenue', { item_id: s.item.uid }, true);
  assert.equal(count(w, 'raise_claim_evidence'), 0);
  assert.equal(itemOf(w, s.item.uid).state, 'pinned');
  await linkClaim(w.ctx, 'claim-cash', { item_id: s.item.uid, item_version: itemOf(w, s.item.uid).version });
  const r = await call(w, FOUNDER, 'POST', `/selections/${s.uid}/withdraw`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.selection.status, r.body.selection.item.state, r.body.selection.item.visibility, r.body.selection.fact.amount], ['withdrawn', 'unpinned', 'private', '40890.50']);
  assert.equal(count(w, 'raise_claim_evidence'), 0);
  assert.equal((w.db.prepare("SELECT state FROM raise_claims WHERE uid='claim-cash'").get() as any).state, 'not_backed');
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 0);
  assert.equal((await call(w, FOUNDER, 'POST', `/selections/${s.uid}/withdraw`)).body.error, 'decided');
  await assert.rejects(setSharing(w.ctx, s.item.uid, { version: itemOf(w, s.item.uid).version, state: 'pinned', visibility: 'after_nda' }), (e: any) => e.code === 'changed');
  assert.equal((await call(w, STRANGER, 'POST', `/selections/${s.uid}/withdraw`)).status, 404);
});

test('a revoked connection and a deleted revision leave every shared view; the founder still reads the pinned value', async () => {
  const w = await world();
  audience(w);
  const s = await pin(w);
  await share(w, s.item.uid, 'after_nda');
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 1);
  w.db.exec("UPDATE integrations SET status='revoked' WHERE id=1");
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 0, 'revoked access shares nothing');
  let mine = (await call(w, FOUNDER, 'GET', '')).body;
  assert.equal(mine.selections[0].source, 'access_revoked');
  assert.equal(mine.options.length, 0, 'nothing may be chosen through a revoked connection');
  const read: any = await readRaiseEvidence(w.ctx);
  const row = read.items.rows.find((r: any) => r.uid === s.item.uid);
  assert.deepEqual([row.source_state, row.value_num], ['not_recorded', 4089050], 'the pinned value stays intelligible to the founder');
  w.db.exec("UPDATE integrations SET status='active' WHERE id=1");
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 1, 'a restored grant restores the same unchanged fact');
  // Deletion: the revision goes (as a hard delete would take it); the selection keeps its own copy.
  w.db.exec('PRAGMA foreign_keys = ON');
  w.db.exec(`DELETE FROM financial_statement_pins; DELETE FROM financial_statement_snapshots WHERE uid='${w.pl.uid}'`);
  w.db.exec('PRAGMA foreign_keys = OFF');
  mine = (await call(w, FOUNDER, 'GET', '')).body;
  assert.deepEqual([mine.selections[0].source, mine.selections[0].fact.amount, mine.selections[0].fact.line.label], ['deleted', '40890.50', 'Total Income']);
  assert.equal(ledgerRows(await investorEvidence(w.env, PROJECT, INVESTOR)).length, 0, 'a deleted revision shares nothing');
});

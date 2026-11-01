/** D1264 (#3287): the claim check. Real SQLite, production schema + migrations; every figure and name is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { FIGURES, NARRATIVE_CHECK_FIGURES, parseStatedFigures, computeReadiness, checkedLabels } from '../src/services/raiseCycle.ts';
import { checkClaims, computeClaims, decideCount, decideFigure, decidePresence, type Candidate, type PinnedItem } from '../src/services/raiseClaims.ts';
import { readRaiseEvidence } from '../src/services/raiseEvidence.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); db.exec(read('../sql/schema_baseline.sql'));
  for (const f of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter((f) => /^\d+_.*\.sql$/.test(f) && migrationNumber(f) > BASELINE_CUTOFF).sort(compareMigrations)) db.exec(read('../sql/migrations/' + f));
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active) VALUES (1,'Synthetic Founder','one@example.invalid','founder',100,1,0),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic Venture',100,10);
    INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: 't'.repeat(64), ENVIRONMENT: 'development' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  return { db, env, ctx };
}
type World = ReturnType<typeof world>;
function seed(w: World, table: string, values: Record<string, unknown>) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
  const row = { ...values };
  for (const c of w.db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? table + '-' + String(values.id ?? 'one') : 'synthetic';
  const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
  w.db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map((k) => row[k] as any));
}
let next = 1;
/** A pinned item as D1263's Accept leaves it; only the fields the check reads vary. */
function pin(w: World, v: { kind: string; source_table: string; source_ref: string; label: string; value?: number | null; unit?: string | null; on?: string | null; area?: string; private_reason?: string | null; state?: string }) {
  const id = next++;
  seed(w, 'raise_evidence_items', {
    id, uid: 'item' + id, project_id: 1, area: v.area ?? 'Investor narrative and Pitch deck', kind: v.kind, source_table: v.source_table, source_ref: v.source_ref,
    source_label: v.label, strength: 'measured', observed_on: v.on ?? null, summary: 'Synthetic.', value_num: v.value ?? null, value_unit: v.unit ?? null,
    snapshot_hash: 'h'.repeat(64), state: v.state ?? 'pinned', visibility: 'after_nda', private_reason: v.private_reason ?? null, mutation_uid: 'm' + id,
  });
  return 'item' + id;
}
const narrative = (w: World, version: number, words: Record<string, string>) => {
  seed(w, 'spinout_deck_overrides', { project_id: 1, version, field_key: '_version', value: '' });
  for (const [field_key, value] of Object.entries(words)) seed(w, 'spinout_deck_overrides', { project_id: 1, version, field_key, value });
};
const claim = (w: World, surface: string, field: string) => w.db.prepare('SELECT * FROM raise_claims WHERE surface=? AND field_key=? ORDER BY id DESC LIMIT 1').get(surface, field) as any;
const links = (w: World, how = 'computed') => w.db.prepare('SELECT c.field_key, i.uid FROM raise_claim_evidence l JOIN raise_claims c ON c.id=l.claim_id JOIN raise_evidence_items i ON i.id=l.item_id WHERE l.how=? ORDER BY c.field_key, i.uid').all(how) as any[];
const item = (id: number, label: any, on: string | null = null): PinnedItem => ({ id, uid: 'i' + id, kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: id + ':mrr', source_label: label, provider: null, observed_on: on, value_num: null, value_unit: 'money', currency: null, private_reason: null });
const cand = (value: number | null, label: any, on: string | null = null, id = 1): Candidate => ({ value, label, provider: null, observed_on: on, items: [item(id, label, on)] });

test('every figure on #2430\'s list is read by its words, never from a bare number', () => {
  // D1607 (#3731): active users joins, read from the founder's PostHog.
  assert.deepEqual([...FIGURES].sort(), ['active_users', 'arr', 'cac', 'churn', 'headcount', 'interviews', 'lois', 'mrr', 'net_burn', 'paying_customers', 'pilots', 'raise', 'revenue', 'revenue_growth', 'runway', 'waitlist'].sort());
  assert.deepEqual([...NARRATIVE_CHECK_FIGURES], ['mrr', 'paying_customers', 'raise', 'revenue'], 'narrative_checks keeps its four figures for readiness');
  const got = (t: string) => Object.fromEntries(parseStatedFigures('f', t).map((s) => [s.figure, s.value]));
  assert.deepEqual(got('We have $18,400 MRR, $220k ARR and 42 paying customers, raising $2m.'), { mrr: 18400, arr: 220000, paying_customers: 42, raise: 2000000 });
  assert.deepEqual(got('15% month-over-month growth; net burn of $80k; 14.2 months of runway; 3% monthly churn; CAC of $450; $9,500 in monthly revenue'),
    { revenue: 9500, revenue_growth: 15, net_burn: 80000, runway: 14.2, churn: 3, cac: 450 });
  assert.deepEqual(got('23 customer interviews, 3 letters of intent, 1,200 people on the waitlist, 2 paid pilots and a team of 7'), { interviews: 23, lois: 3, waitlist: 1200, pilots: 2, headcount: 7 });
  assert.deepEqual(got('Founded 18 months ago in 2024 with 15 customers across 3 countries, growing fast; 40% of time saved'), {});
});

test('the best source decides: Typed-only is Founder\'s figure, a 3% gap is a Mismatch with both figures and sources, none is Not backed', () => {
  assert.deepEqual(decideFigure(100, []), { state: 'not_backed', record: null, bearing: [] });
  assert.equal(decideFigure(100, [cand(101, 'typed')]).state, 'founders_figure');
  assert.equal(decideFigure(100, [cand(101.9, 'connector')]).state, 'backed', 'within 2% agrees');
  const gap = decideFigure(100, [cand(103, 'connector', '2026-09-30')]);
  assert.equal(gap.state, 'mismatch'); assert.equal(gap.record?.value, 103); assert.equal(gap.record?.label, 'connector'); assert.equal(gap.record?.observed_on, '2026-09-30');
  // A typed record that agrees never outranks a connector that does not.
  assert.equal(decideFigure(100, [cand(100, 'typed', '2026-10-01', 1), cand(110, 'connector', '2026-01-01', 2)]).state, 'mismatch');
  assert.equal(decideFigure(100, [cand(110, 'recorded', null, 1), cand(100, 'signed', null, 2)]).state, 'backed', 'Signed outranks Recorded');
  assert.equal(decideFigure(100, [cand(110, 'connector', '2026-01-01', 1), cand(100, 'connector', '2026-09-01', 2)]).state, 'backed', 'the newest of one label');
  assert.equal(decideFigure(100, [cand(null, 'connector')]).state, 'not_backed', 'a record with no value compares nothing');
  assert.equal(decidePresence([]).state, 'not_backed');
  assert.equal(decidePresence([cand(null, 'typed')]).state, 'founders_figure');
  assert.equal(decidePresence([cand(null, 'typed', null, 1), cand(null, 'document', null, 2)]).state, 'backed');
  const items = (labels: string[]) => labels.map((l, i) => ({ ...item(i + 1, l as any), source_ref: String(i + 1) }));
  // A count agrees within 1 (`agrees`, as the narrative check has always read small counts).
  assert.equal(decideCount(3, items(['recorded', 'recorded', 'recorded'])).state, 'backed');
  assert.equal(decideCount(6, items(['recorded', 'recorded', 'recorded', 'recorded', 'typed', 'typed'])).state, 'founders_figure', 'a count that needs a Typed record');
  const short = decideCount(9, items(['recorded', 'recorded', 'recorded', 'recorded', 'typed', 'typed']));
  assert.equal(short.state, 'mismatch'); assert.equal(short.record?.value, 4, 'the mismatch names the best-sourced count');
  assert.equal(decideCount(3, []).state, 'not_backed');
});

test('narrative figures meet every pinned item of their kind and are written to raise_claims with their computed links', async () => {
  const w = world();
  try {
    narrative(w, 1, { traction: 'MRR of $10,000 and 2 letters of intent. We are raising $1m. $9,500 in monthly revenue.', problem: 'Teams close the books two days faster.' });
    seed(w, 'narrative_version_meta', { project_id: 1, version: 1, why_now: 'Churn is 3% a month.' });
    pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '1:mrr', label: 'typed', value: 10000, unit: 'money', on: '2026-09-01' });
    for (const id of [1, 2]) seed(w, 'demand_signals', { id, project_id: 1, kind: 'loi', status: 'confirmed', signal_date: '2026-09-0' + id });
    for (const id of [3, 4, 5]) seed(w, 'demand_signals', { id, project_id: 1, kind: 'waitlist', status: 'confirmed', signal_date: '2026-09-03' });
    pin(w, { kind: 'demand-signal', source_table: 'demand_signals', source_ref: '1', label: 'document' });
    pin(w, { kind: 'loi-file', source_table: 'demand_signals', source_ref: '1', label: 'document', area: 'Data room' });
    pin(w, { kind: 'demand-signal', source_table: 'demand_signals', source_ref: '2', label: 'recorded' });
    for (const ref of ['3', '4', '5']) pin(w, { kind: 'demand-signal', source_table: 'demand_signals', source_ref: ref, label: 'recorded' });
    // Another metric of the same snapshot, a bank month in cents, and an unpinned record: none of them is MRR.
    pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '3:arr', label: 'connector', value: 120000, unit: 'money', on: '2026-10-01' });
    pin(w, { kind: 'bank-revenue', source_table: 'mercury_raise_facts', source_ref: '8', label: 'connector', value: 950000, unit: 'cents', on: '2026-10-01', private_reason: 'bank' });
    pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '4:mrr', label: 'connector', value: 99999, unit: 'money', on: '2026-10-02', state: 'unpinned' });
    const first = await checkClaims(w.env, 1);
    assert.equal(first.outcome, 'recorded');
    assert.equal(claim(w, 'narrative', 'traction#mrr').state, 'founders_figure');
    assert.equal(claim(w, 'narrative', 'traction#mrr').stated_value, '10000');
    assert.equal(claim(w, 'narrative', 'traction#lois').state, 'backed', 'two LOIs, counted once each, the waitlist signal apart');
    assert.equal(claim(w, 'narrative', 'traction#raise').state, 'not_backed');
    assert.equal(claim(w, 'narrative', 'traction#revenue').state, 'backed', '950,000 cents is $9,500');
    assert.equal(claim(w, 'narrative', 'why_now#churn').state, 'not_backed');
    assert.equal(claim(w, 'narrative', 'problem#mrr'), undefined, 'a sentence with no figure states none');
    assert.equal(claim(w, 'narrative', 'traction#mrr').surface_version, 'v1');
    assert.ok(claim(w, 'narrative', 'traction#mrr').checked_at);
    assert.deepEqual(links(w).filter((l) => l.field_key === 'traction#mrr').map((l) => l.uid), ['item1']);

    // A Stripe figure 3% away is a Mismatch, with both figures and both sources.
    const stripe = pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '2:mrr', label: 'connector', value: 10300, unit: 'money', on: '2026-09-30' });
    const again = await checkClaims(w.env, 1);
    const mrr = again.claims.find((c) => c.field_key === 'traction#mrr')!;
    assert.equal(claim(w, 'narrative', 'traction#mrr').state, 'mismatch');
    assert.equal(mrr.stated_value, '10000'); assert.equal(mrr.record?.value, 10300); assert.equal(mrr.record?.label, 'connector'); assert.equal(mrr.record?.observed_on, '2026-09-30');
    assert.deepEqual(links(w).filter((l) => l.field_key === 'traction#mrr').map((l) => l.uid).sort(), ['item1', stripe].sort(), 'every item of the kind bears on it');
    // Nothing changed, nothing is written.
    assert.equal((await checkClaims(w.env, 1)).written, 0);
  } finally { w.db.close(); }
});

test('the deck, use of funds, cap table and capital model are claims too, and a claim\'s own record never backs it', async () => {
  const w = world();
  try {
    seed(w, 'pitch_decks', { id: 1, project_id: 1, version: 2, is_current: 1, slides: JSON.stringify([{ title: 'Traction', body: ['14.2 months of runway', 'team of 6'] }, { title: 'Ask' }]) });
    pin(w, { kind: 'bank-runway', source_table: 'mercury_raise_facts', source_ref: '9', label: 'connector', value: 14.3, unit: 'months', on: '2026-10-01', private_reason: 'bank' });
    pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '4:headcount', label: 'connector', value: 9, unit: 'people', on: '2026-10-01' });
    w.db.exec(`UPDATE projects SET use_of_funds='${JSON.stringify([{ label: 'Product & engineering', pct: 50 }, { label: 'GTM: sales and marketing', pct: 50 }])}' WHERE id=1`);
    seed(w, 'integrations', { id: 1, user_id: 1, provider_key: 'mercury', status: 'active' });
    for (const [id, label, cents] of [[11, 'eng', 52000], [12, 'sales', 48000], [13, 'eng', 999999]] as const) {
      seed(w, 'mercury_raise_facts', { id, integration_id: 1, project_id: 1, kind: 'spend', fact_key: 'spend:' + id, label, amount_cents: cents, months: id === 13 ? 12 : 3, as_of: '2026-10-01' });
      pin(w, { kind: 'mapped-bank-spend', source_table: 'mercury_raise_facts', source_ref: String(id), label: 'connector', value: cents, unit: 'cents', on: '2026-10-01', area: 'Use of funds', private_reason: 'bank' });
    }
    seed(w, 'mercury_raise_proposals', { id: 1, integration_id: 1, project_id: 1, kind: 'fund_mapping', source_key: 'eng', status: 'accepted', target: 'product' });
    seed(w, 'mercury_raise_proposals', { id: 2, integration_id: 1, project_id: 1, kind: 'fund_mapping', source_key: 'sales', status: 'accepted', target: 'go-to-market' });
    seed(w, 'cap_table_holders', { id: 1, user_id: 1, project_id: 1, kind: 'founder', source: 'manual', founder_role: 'ceo', shares: 1000 });
    seed(w, 'cap_table_vesting', { id: 7, user_id: 1, holder_id: 1, project_id: 1, source: 'manual', total_shares: 1000, start_date: '2026-01-01' });
    seed(w, 'cap_table_holders', { id: 2, user_id: 1, project_id: 1, kind: 'founder', source: 'manual', founder_role: 'cto', shares: 1000 });
    pin(w, { kind: 'founder-holding', source_table: 'cap_table_holders', source_ref: '1', label: 'typed', value: 1000, unit: 'shares', area: 'Fundraising readiness' });
    pin(w, { kind: 'vesting-schedule', source_table: 'cap_table_vesting', source_ref: '7', label: 'typed', value: 1000, unit: 'shares', area: 'Cap table' });
    seed(w, 'financial_models', { id: 1, project_id: 1, assumptions_json: JSON.stringify({ monthly_churn_pct: 2, cac: 400, gross_margin_pct: 80 }), updated_by: 1 });
    pin(w, { kind: 'model-assumption', source_table: 'financial_models', source_ref: '1:monthly_churn_pct', label: 'typed', value: 2, unit: 'percent', area: 'Capital model' });
    pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '5:cac', label: 'connector', value: 520, unit: 'money', on: '2026-09-15' });
    await checkClaims(w.env, 1);
    assert.equal(claim(w, 'deck', 'slide:1#runway').state, 'backed');
    assert.equal(claim(w, 'deck', 'slide:1#runway').surface_version, 'v2');
    assert.equal(claim(w, 'deck', 'slide:1#headcount').state, 'mismatch');
    assert.equal(claim(w, 'use_of_funds', 'section:product').state, 'mismatch', 'planned 50% against 52% of the 3-month spend');
    assert.equal(claim(w, 'use_of_funds', 'section:go-to-market').state, 'mismatch');
    const uof = (await computeClaims(w.env, 1)).surfaces.find((s) => s.surface === 'use_of_funds')!.claims;
    assert.deepEqual(uof.map((c) => [c.field_key, c.record?.value]), [['section:product', 52], ['section:go-to-market', 48]], 'the shortest window only');
    assert.equal(claim(w, 'cap_table', 'holder:1').state, 'founders_figure', 'typed vesting agrees; the holding itself never backs its own row');
    assert.equal(claim(w, 'cap_table', 'holder:2').state, 'not_backed', 'another holder\'s vesting backs nothing here');
    assert.equal(claim(w, 'capital_model', 'monthly_churn_pct').state, 'not_backed', 'the model does not back its own assumption');
    assert.equal(claim(w, 'capital_model', 'cac').state, 'mismatch', 'CAC $400 assumed, $520 measured');
    assert.equal(claim(w, 'capital_model', 'gross_margin_pct').state, 'not_backed');
  } finally { w.db.close(); }
});

test('readiness claims are backed by presence; a founder\'s link counts; nothing typed passes as Backed', async () => {
  const w = world();
  try {
    for (const [key, i] of [['traction', 1], ['team', 2], ['pmf', 3], ['deck', 4]] as const) seed(w, 'readiness_items', { project_id: 1, item_key: key, label: key, position: i });
    pin(w, { kind: 'revenue-receipt', source_table: 'revenue_entries', source_ref: '1', label: 'typed', value: 5000, unit: 'cents', area: 'Fundraising readiness' });
    await checkClaims(w.env, 1);
    assert.equal(claim(w, 'readiness', 'traction').state, 'founders_figure');
    assert.equal(claim(w, 'readiness', 'team').state, 'not_backed');
    assert.equal(claim(w, 'readiness', 'deck'), undefined, 'only Traction proof, Team and Product-market fit are claims');
    pin(w, { kind: 'revenue-receipt', source_table: 'revenue_entries', source_ref: '2', label: 'connector', value: 5000, unit: 'cents', area: 'Fundraising readiness' });
    const signed = pin(w, { kind: 'signed-document', source_table: 'documents', source_ref: '1', label: 'signed', area: 'Legal' });
    seed(w, 'raise_claim_evidence', { project_id: 1, claim_id: claim(w, 'readiness', 'team').id, item_id: Number(signed.slice(4)), how: 'founder', mutation_uid: 'x' });
    await checkClaims(w.env, 1);
    assert.equal(claim(w, 'readiness', 'traction').state, 'backed');
    assert.equal(claim(w, 'readiness', 'team').state, 'backed', 'the founder linked a signed record');
    assert.equal(links(w, 'founder').length, 1, 'a founder\'s link is never touched');
  } finally { w.db.close(); }
});

test('a claim no longer stated goes unless a person linked it; older versions and an unreadable surface keep theirs', async () => {
  const w = world();
  try {
    narrative(w, 1, { traction: 'MRR of $10,000 and 42 paying customers' });
    seed(w, 'pitch_decks', { id: 1, project_id: 1, version: 1, is_current: 1, slides: JSON.stringify([{ body: '3 letters of intent' }]) });
    pin(w, { kind: 'kpi-snapshot', source_table: 'project_metrics', source_ref: '1:paying_accounts', label: 'connector', value: 42, unit: 'accounts' });
    await checkClaims(w.env, 1);
    seed(w, 'raise_claim_evidence', { project_id: 1, claim_id: claim(w, 'narrative', 'traction#paying_customers').id, item_id: 1, how: 'founder', mutation_uid: 'y' });
    w.db.exec("UPDATE spinout_deck_overrides SET value='No figures now' WHERE field_key='traction'");
    w.db.exec("UPDATE pitch_decks SET slides='not json'");
    const check = await checkClaims(w.env, 1);
    assert.equal(check.outcome, 'partial');
    assert.deepEqual(check.surfaces.find((s) => s.surface === 'deck'), { surface: 'deck', state: 'unreadable', claims: null });
    assert.equal(claim(w, 'narrative', 'traction#mrr'), undefined, 'removed: nobody linked it');
    assert.ok(claim(w, 'narrative', 'traction#paying_customers'), 'kept: the founder linked it');
    assert.equal(claim(w, 'deck', 'slide:1#lois').state, 'not_backed', 'an unreadable deck leaves its claims as they were');
    narrative(w, 2, { traction: 'MRR of $12,000' });
    await checkClaims(w.env, 1);
    assert.ok(claim(w, 'narrative', 'traction#paying_customers'), 'v1 keeps its last state once v2 is the newest');
    assert.equal(claim(w, 'narrative', 'traction#mrr').surface_version, 'v2');
  } finally { w.db.close(); }
});

test('the founder\'s read runs the check and reads each record; an admin reads states only, never a bank figure', async () => {
  const w = world();
  try {
    narrative(w, 1, { traction: 'Runway of 14 months' });
    pin(w, { kind: 'bank-runway', source_table: 'mercury_raise_facts', source_ref: '9', label: 'connector', value: 18, unit: 'months', on: '2026-10-01', private_reason: 'bank' });
    const founder = await readRaiseEvidence(w.ctx);
    assert.equal((founder as any).claim_check.outcome, 'recorded');
    const row = (founder.claims as any).rows.find((r: any) => r.field_key === 'traction#runway');
    assert.equal(row.state, 'mismatch');
    assert.equal(row.record.shown, '18 months'); assert.equal(row.record.stated_shown, '14 months'); assert.equal(row.record.source_label, 'connector');
    w.db.exec("UPDATE spinout_deck_overrides SET value='Runway of 18 months' WHERE field_key='traction'");
    const admin = await readRaiseEvidence({ ...w.ctx, user: w.db.prepare('SELECT * FROM users WHERE id=3').get(), founder: false });
    assert.equal((admin as any).claim_check, null, 'an admin\'s read writes nothing');
    assert.equal(claim(w, 'narrative', 'traction#runway').state, 'mismatch', 'still the last check');
    assert.doesNotMatch(JSON.stringify(admin.claims), /18 months|14 months|"record"|stated_value/);
  } finally { w.db.close(); }
});

test('readiness cells say what each check read', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE projects SET mrr=100, funding_needed=1000000, use_of_funds='[{\"label\":\"Product & engineering\",\"pct\":100}]' WHERE id=1");
    seed(w, 'pitch_decks', { id: 1, project_id: 1, version: 1, slides: '[]' });
    seed(w, 'cap_table_holders', { id: 1, user_id: 1, project_id: 1, kind: 'founder', source: 'manual', founder_role: 'ceo' });
    const rows = Object.fromEntries((await computeReadiness(w.env, 1)).map((c) => [c.key, c.reads.map((r) => r.b).join(' | ')]));
    assert.match(rows.deck, /1 deck saved · Typed/);
    assert.match(rows.use_of_funds, /\$1,000,000 · Typed \| split stored · Typed/);
    assert.match(rows.team, /1 founder recorded · Typed/);
    assert.match(rows.traction, /Typed · Founder's figure/);
    assert.equal(checkedLabels({ mrr: { source: 'Stripe (measured) · project_metrics.mrr on 2026-09-01' }, raise: { source: 'Pipeline · raise_rounds.target_amount' } } as any,
      [{ figure: 'mrr', value: 1, source: '' }, { figure: 'raise', value: 1, source: '' }]), 'Connector and Typed');
    assert.equal(checkedLabels({ revenue: { source: 'Verified revenue · Connector · Stripe · 2026-09' } } as any,
      [{ figure: 'revenue', value: 1, source: '' }]), 'Connector');
    assert.equal(checkedLabels({ revenue: { source: 'Verified revenue · Document · revenue proof · 2026-09' } } as any,
      [{ figure: 'revenue', value: 1, source: '' }]), 'Document');
    assert.equal(checkedLabels({ runway: { source: 'Connector · Mercury · measured cash and net burn' } } as any,
      [{ figure: 'runway', value: 1, source: '' }]), 'Connector');
    assert.equal(checkedLabels({ revenue: { source: 'Mercury revenue credits · Operating · measured 2026-09-01' } } as any,
      [{ figure: 'revenue', value: 1, source: '' }]), 'Connector');
    assert.equal(checkedLabels({ mrr: { source: 'Metrics (stated: stripe) · project_metrics.mrr on 2026-09-01' } } as any,
      [{ figure: 'mrr', value: 1, source: '' }]), 'Typed');
    assert.equal(checkedLabels({ mrr: { source: 'Notes mention a connector later' } } as any,
      [{ figure: 'mrr', value: 1, source: '' }]), 'Typed');
  } finally { w.db.close(); }
});

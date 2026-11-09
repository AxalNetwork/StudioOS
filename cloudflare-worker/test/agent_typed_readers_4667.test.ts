/**
 * D4667 (#4667, second slice): the typed native readers, through the real readers on the real migrated schema, as
 * the agent's sponsor. Synthetic records only; nothing is read from Mercury, Stripe or Carta, and no model runs.
 *
 *   · each typed reader answers records with a stable reference, the unit of each amount, its currency (or null where
 *     the source records none, never assumed) and its date;
 *   · each checks the source's own rule as the sponsor: someone outside the team, or without Full cap table access,
 *     is `withheld`, with none of the source's figures; that is not "nothing recorded";
 *   · revenue in a period gives monthly totals per currency only when every entry of the period was read;
 *   · the preflight moves the skills those readers serve from not_ready to conditional or ready, and a required input
 *     the sponsor may not read keeps the skill not_ready.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { readOne, READERS, type ReadContext } from '../src/services/agents/reads.ts';
import { inputMatrix, pathsFor, preflight } from '../src/services/agents/skillInputs.ts';

after(removeMigratedDatabases);
const NOW = Date.parse('2026-11-07T12:00:00Z');

function fixture() {
  const db = migratedDatabase();
  db.exec("INSERT INTO founders(id, name, email) VALUES (7, 'Synthetic Founder', 'synthetic-7@example.invalid')");
  db.exec(`INSERT INTO users(id, role, name, email, is_active, founder_id) VALUES
    (2, 'founder', 'Synthetic Founder', 'synthetic-2@example.invalid', 1, 7),
    (3, 'founder', 'Synthetic Outsider', 'synthetic-3@example.invalid', 1, NULL)`);
  db.exec("INSERT INTO projects(id, name, founder_id, stage) VALUES (1, 'Synthetic venture', 7, 'seed'), (2, 'Other venture', NULL, 'seed')");
  const env: any = { DB: d1Over(db) };
  const ctx = (sponsor = 2, projectId = 1, page?: ReadContext['page']): ReadContext => ({
    scope: { kind: 'project', id: projectId, name: 'Synthetic venture', founder_id: 7, company_id: null } as any,
    agent: { sponsor_user_id: sponsor } as any, projectId, page,
  });
  return { db, env, ctx, close: () => db.close() };
}

const fact = (db: any, project: number, kind: string, cents: number, asOf: string) => db.prepare(
  "INSERT INTO mercury_grow_facts(integration_id, project_id, module, kind, period, amount_cents, as_of) VALUES (1, ?, 'durable_company_building', ?, 'current', ?, ?)",
).run(project, kind, cents, asOf);
let n = 0;
const revenue = (db: any, project: number, cents: number, on: string, currency = 'usd') => db.prepare(
  "INSERT INTO revenue_entries(uid, project_id, customer, amount_cents, currency, revenue_type, received_on, source, verification) VALUES (?, ?, 'Synthetic customer', ?, ?, 'recurring', ?, 'stripe', 'verified')",
).run(`rev${String(++n).padStart(29, '0')}`, project, cents, currency, on);

test('mercury.balances: the team reads its cash and treasury in cents with their date; an outsider is withheld, not empty', async () => {
  const f = fixture();
  try {
    fact(f.db, 1, 'cash', 12_345_600, '2026-11-01');
    fact(f.db, 1, 'treasury', 50_000_000, '2026-11-01');
    fact(f.db, 2, 'cash', 1, '2026-11-01');
    const r: any = await readOne(f.env, 'mercury.balances', f.ctx());
    assert.deepEqual(r.data.records.map((x: any) => [x.kind, x.amount, x.unit, x.currency, x.at]), [['cash', 12_345_600, 'cents', null, '2026-11-01'], ['treasury', 50_000_000, 'cents', null, '2026-11-01']]);
    assert.ok(r.data.records.every((x: any) => /^mercury_fact:\d+$/.test(x.ref)));
    assert.deepEqual(r.data.coverage, { returned: 2, total: 2, omitted: 0, complete: true });
    const outsider: any = await readOne(f.env, 'mercury.balances', f.ctx(3));
    assert.deepEqual(Object.keys(outsider.data).sort(), ['reason', 'withheld'], 'none of the figures');
    assert.equal(outsider.data.withheld, true);
    f.db.exec('DELETE FROM mercury_grow_facts');
    const empty: any = await readOne(f.env, 'mercury.balances', f.ctx());
    assert.deepEqual(empty.data.coverage, { returned: 0, total: 0, omitted: 0, complete: true }, 'nothing synced is empty and complete');
  } finally { f.close(); }
});

test('stripe.revenue: entries in a period with their currency; monthly totals per currency only when the whole period was read', async () => {
  const f = fixture();
  try {
    revenue(f.db, 1, 10_000, '2026-09-03');
    revenue(f.db, 1, 2_500, '2026-09-20');
    revenue(f.db, 1, 7_000, '2026-10-05', 'eur');
    revenue(f.db, 1, 9_999, '2026-08-31');
    revenue(f.db, 2, 1_000_000, '2026-09-10');
    const r: any = await readOne(f.env, 'stripe.revenue', f.ctx(2, 1, { from: '2026-09-01', to: '2026-10-31' }));
    assert.deepEqual(r.data.coverage, { returned: 3, total: 3, omitted: 0, complete: true });
    assert.ok(r.data.records.every((x: any) => /^revenue:[a-z0-9]{32}$/.test(x.ref) && x.unit === 'cents'));
    assert.deepEqual(r.data.by_month.map((m: any) => [m.month, m.currency, m.amount, m.entries]), [['2026-09', 'USD', 12_500, 2], ['2026-10', 'EUR', 7_000, 1]], 'never added across currencies');
    for (let i = 0; i < 201; i += 1) revenue(f.db, 1, 100, '2026-10-10');
    const big: any = await readOne(f.env, 'stripe.revenue', f.ctx(2, 1, { from: '2026-09-01', to: '2026-10-31' }));
    assert.equal(big.data.coverage.complete, false);
    assert.equal(big.data.by_month, null, 'no period total from a part of the period');
  } finally { f.close(); }
});

test('cap_table.read: the founder reads the record with its currency and units; someone without Full access is withheld', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO cap_table_currency(project_id, currency) VALUES (1, 'CAD')");
    f.db.exec("INSERT INTO cap_table_share_classes(id, project_id, name, kind, authorized_shares) VALUES (1, 1, 'Common', 'common', 10000000)");
    f.db.exec("INSERT INTO cap_table_issuances(project_id, kind, holder_name, class_id, shares, issued_on, source, status, origin) VALUES (1, 'founding', 'Synthetic Holder', 1, 8000000, '2026-01-01', 'typed', 'recorded', 'owner')");
    const r: any = await readOne(f.env, 'cap_table.read', f.ctx());
    assert.equal(r.data.ref, 'cap_table:1');
    assert.deepEqual([r.data.currency, r.data.currency_set], ['CAD', true]);
    assert.deepEqual(r.data.units, { shares: 'shares', money: 'cents', price_per_share: 'micros', rates: 'bps' });
    assert.equal(r.data.outstanding.shares, 8_000_000);
    const outsider: any = await readOne(f.env, 'cap_table.read', f.ctx(3));
    assert.deepEqual(Object.keys(outsider.data).sort(), ['reason', 'withheld']);
  } finally { f.close(); }
});

test('the preflight through the typed readers: complete, partial and withheld evidence give ready, conditional and not_ready', async () => {
  const f = fixture();
  try {
    assert.equal(pathsFor('board-meeting-brief')!.default_context, 'unsupported', 'board metrics still have no typed reader');
    const m = inputMatrix().find((x) => x.slug === 'safe-convertible-instrument-review')!;
    assert.equal(m.inputs.find((i) => i.read === 'cap_table.read')!.reader, 'built');

    fact(f.db, 1, 'cash', 1_000_000, '2026-11-01');
    revenue(f.db, 1, 10_000, '2026-10-03');
    const update = await preflight(f.env, 'monthly-investor-update', f.ctx(), READERS, NOW);
    const rev = update!.inputs.find((i) => i.read === 'stripe.revenue')!;
    const bal = update!.inputs.find((i) => i.read === 'mercury.balances')!;
    assert.deepEqual([rev.status, rev.source, bal.status], ['available', 'native', 'available']);
    // Raise and build progress are optional and empty here, so the brief is conditional and says why.
    assert.equal(update!.state, 'conditional');
    const outsider = await preflight(f.env, 'monthly-investor-update', f.ctx(3), READERS, NOW);
    assert.equal(outsider!.inputs.find((i) => i.read === 'mercury.balances')!.status, 'withheld');

    // The instrument's text from a stand-in document reader, so the cap table is the only thing in question.
    const withDoc = { ...READERS, 'data_room.index': async () => ({ ref: 'data_room_file:synthetic', text: 'Synthetic SAFE.' }) } as any;
    const provides = { ...(await import('../src/services/agents/reads.ts')).READER_PROVIDES, 'data_room.index': 'document_text' } as any;
    const founder = await preflight(f.env, 'safe-convertible-instrument-review', f.ctx(), withDoc, NOW, provides);
    assert.notEqual(founder!.state, 'not_ready', 'with the text and a cap table the founder may read, the review can run');
    const safe = await preflight(f.env, 'safe-convertible-instrument-review', f.ctx(3), withDoc, NOW, provides);
    assert.equal(safe!.inputs.find((i) => i.read === 'cap_table.read')!.status, 'withheld');
    assert.equal(safe!.state, 'not_ready', 'a required input the sponsor may not read leaves nothing to brief from');

    f.db.prepare("UPDATE mercury_grow_facts SET as_of = '2026-08-01'").run();
    const old = await preflight(f.env, 'monthly-investor-update', f.ctx(), READERS, NOW);
    assert.equal(old!.inputs.find((i) => i.read === 'mercury.balances')!.status, 'stale', 'a balance from August is not today\'s');
  } finally { f.close(); }
});

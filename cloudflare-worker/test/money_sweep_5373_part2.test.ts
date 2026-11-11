/**
 * D5373 part 2 — the Worker reads and writes the cap table's money at the venture's own currency decimals, and the Use of
 * Funds source text and the capital-relationship commitments do the same. Before, a JPY cap of 5,000 yen was saved to the
 * model as 50 and read back from the record as 50; a KWD 1.250 SAFE was saved as 12.5 (and one saved as 1.25 was offered
 * back as 125 minor units); the Eadwyn source text printed "JPY 50.00" for 5,000 yen; a legacy dollar column on a JPY deal
 * was mirrored to cents at x100.
 *
 * Every case runs JPY (no minor unit), KWD (three) and EUR (two; USD and EUR rows are byte-for-byte what they were), and a
 * currency the layer does not list: a read treats the amount as not recorded, a write is refused with a 400.
 *
 * Mutation-checked both ways: each function with its old `/ 100` or `* 100` body put back fails the JPY and KWD cases and
 * leaves EUR and USD green; with the new code every case passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { passage } from '../src/services/useOfFunds/eadwyn.ts';
import { recordAccessView, majorOf } from '../src/services/capTableAccessRecord.ts';
import { startFromRecord, offerFromModel } from '../src/services/capTableToday.ts';
import { addHolder, updateHolder, saveScenario, safeTerms, majorUnits, HolderError } from '../src/services/capTableWrites.ts';
import { dollarsToCents } from '../src/services/capRelReads.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

// ───────────────────────────────────────────────────── Use of Funds: the source text

test('the Eadwyn source text reads a *_cents count at its currency\'s own decimals', () => {
  assert.equal(passage(500000, 'jpy', 'cash_cents'), 'JPY 500,000', 'five hundred thousand yen, not "JPY 5,000.00"');
  assert.equal(passage(1250, 'KWD', 'amount_to_raise_cents'), 'KWD 1.250');
  assert.equal(passage(150000000, 'eur', 'amount_to_raise_cents'), 'EUR 1,500,000.00');
  assert.equal(passage(150000000, 'usd', 'cash_cents'), 'USD 1,500,000.00', 'the default currency and the wording are unchanged');
  assert.equal(passage(5, 'usd', 'cash_cents'), 'USD 0.05');
  assert.equal(passage(0, 'usd', 'cash_cents'), 'USD 0.00');
  assert.equal(passage(150000000, undefined, 'cash_cents'), 'USD 1,500,000.00', 'no currency is the plan default, usd');
  // Not a count of minor units: untouched.
  assert.equal(passage(18, 'jpy', 'target_runway_months'), '18');
  // A code the layer does not list names the stored count, never a figure at two decimals.
  assert.equal(passage(500000, 'xyz', 'cash_cents'), '500,000 minor units (currency "XYZ" is not one we can price in)');
});

test('the Eadwyn source text takes the currency of the object it reads', () => {
  const text = passage({ currency: 'JPY', amount_to_raise_cents: 5000000, cash_cents: 120000, target_runway_months: 18 });
  assert.equal(text, 'currency: JPY\namount to raise: JPY 5,000,000\ncash: JPY 120,000\ntarget runway months: 18');
  assert.match(passage({ currency: 'KWD', cash_cents: 12345 }), /cash: KWD 12\.345/);
  assert.match(passage({ currency: 'EUR', cash_cents: 12345 }), /cash: EUR 123\.45/);
});

// ───────────────────────────────────────────────────── the cap-table access record

const holder = (id: number, name: string) => ({ holder_id: id, name });
const accessRecord = (currency: string | null, amount: number, cap: number | null, venture?: string): any => ({
  ...(venture ? { currency: { code: venture, source: 'set' } } : {}),
  by_holder: { available: true, rows: [{ ...holder(2, 'Fund'), kind: 'investor', shares: 200, options: 0 }] },
  fully_diluted: { available: true, shares: 1000, unallocated_pool: 0 },
  issuances: { rows: [{ holder: holder(2, 'Fund'), status: 'recorded', document_ref: null }] },
  instruments: { rows: [{ holder: holder(2, 'Fund'), kind: 'safe', amount_cents: amount, currency, issued_on: '2026-01-01',
    terms: { cap_cents: cap, discount_bps: null, basis: 'post_money' } }] },
});
const instrumentOf = (r: any) => (recordAccessView(r, 'own_position', 'holder:2') as any).instruments[0];

test('the access record shows each instrument\'s amount and cap in whole major units of its own currency', () => {
  assert.deepEqual(['amount', 'cap'].map((k) => instrumentOf(accessRecord('JPY', 5000, 500000))[k]), [5000, 500000], 'a JPY 5,000 stays 5,000');
  assert.deepEqual(['amount', 'cap'].map((k) => instrumentOf(accessRecord('KWD', 1250, 12500))[k]), [1.25, 12.5], 'a KWD 1.250 reads 1.25');
  assert.deepEqual(['amount', 'cap'].map((k) => instrumentOf(accessRecord('EUR', 10000, 800000000))[k]), [100, 8000000]);
  assert.deepEqual(['amount', 'cap'].map((k) => instrumentOf(accessRecord('USD', 12345, 800000000))[k]), [123.45, 8000000]);
  assert.equal(instrumentOf(accessRecord('EUR', 10000, null)).cap, null, 'no cap recorded is still null');
  assert.equal(instrumentOf(accessRecord('JPY', 5000, 500000)).currency, 'JPY', 'the currency field is as recorded');
});

test('an instrument with no currency is read in the venture\'s, and a venture with none reads USD', () => {
  assert.equal(instrumentOf(accessRecord(null, 5000, null, 'JPY')).amount, 5000);
  assert.equal(instrumentOf(accessRecord(null, 5000, null, 'KWD')).amount, 5);
  assert.equal(instrumentOf(accessRecord(null, 10000, null)).amount, 100, 'the record fixture of D1130 has neither: USD, as before');
});

test('a currency the layer does not list is not recorded in the access record, never divided by a guessed factor', () => {
  const i = instrumentOf(accessRecord('XYZ', 5000, 500000));
  assert.deepEqual([i.amount, i.cap, i.currency], [null, null, 'XYZ']);
  assert.equal(majorOf(5000, 'XYZ'), null);
  assert.equal(majorOf(null, 'JPY'), null);
  assert.equal(majorOf(5000, 'jpy'), 5000, 'a lower-case code is read as the code');
});

// ───────────────────────────────────────────────────── Today and "Record them from the model"

const todayRecord = (code: string, amount: number, cap: number, instrumentCurrency: string | null = code): any => ({
  currency: { code, source: 'set' },
  fully_diluted: { available: true, shares: 1000, unallocated_pool: 100 },
  by_class: { rows: [{ uid: 'c1', kind: 'preferred', name: 'Series Seed Preferred' }] },
  by_holder: { available: true, reason: null, rows: [{ holder_id: 7, name: 'Fund', by_class: [{ class_uid: 'c1', shares: 200 }] }] },
  issuances: { rows: [{ uid: 'is1', status: 'recorded', kind: 'priced', class_uid: 'c1', holder: holder(7, 'Fund'), amount_cents: amount, currency: instrumentCurrency }] },
  instruments: { rows: [{ uid: 'in1', kind: 'safe', holder: { name: 'Angel' }, amount_cents: amount, currency: instrumentCurrency, issued_on: '2026-01-01',
    terms: { cap_cents: cap, discount_bps: null, basis: 'post_money', interest_bps: null, mfn: false } }] },
});
const startOf = (code: string, amount: number, cap: number) => startFromRecord(todayRecord(code, amount, cap)) as any;

test('Today starts the scenario from the record in whole major units of the venture\'s currency', () => {
  const jpy = startOf('JPY', 5000, 500000);
  assert.deepEqual([jpy.safes[0].amount, jpy.safes[0].cap, jpy.start.holders[0].preference], [5000, 500000, 5000], 'a JPY 5,000 is 5,000, not 50');
  const kwd = startOf('KWD', 1250, 12500);
  assert.deepEqual([kwd.safes[0].amount, kwd.safes[0].cap, kwd.start.holders[0].preference], [1.25, 12.5, 1.25]);
  const eur = startOf('EUR', 10000, 800000000);
  assert.deepEqual([eur.safes[0].amount, eur.safes[0].cap, eur.start.holders[0].preference], [100, 8000000, 100]);
  const usd = startOf('USD', 10000, 800000000);
  assert.deepEqual([usd.safes[0].amount, usd.safes[0].cap, usd.start.holders[0].preference], [100, 8000000, 100]);
});

test('Today does not read a currency the layer does not list: the instrument is not modelled and the preference is not recorded', () => {
  const s = startOf('XYZ', 5000, 500000);
  assert.deepEqual(s.safes, []);
  assert.deepEqual(s.not_modelled.map((n: any) => n.reason), ['currency_not_priced']);
  assert.equal(s.start.holders[0].preference, null);
  // Another currency than the venture's keeps its own reason, as before.
  assert.deepEqual((startFromRecord(todayRecord('EUR', 5000, 500000, 'USD')) as any).not_modelled.map((n: any) => n.reason), ['other_currency']);
});

const MODEL = { founders: [{ name: 'Mira', shares: 100 }], safes: [{ name: 'Harbor Seed Fund', amount: 0, cap: 0, discount: 0.15, basis: 'post_money' }] };
const offerSafe = (code: string, amount: number, cap: number) => {
  const offer: any = offerFromModel({ ...MODEL, safes: [{ ...MODEL.safes[0], amount, cap }] } as any, { currency: { code, source: 'set' }, issuances: { rows: [] }, proposals: { rows: [] } } as any);
  return { offer, safe: offer.rows.find((r: any) => r.kind === 'safe') };
};

test('"Record them from the model" offers the saved major units in the venture\'s own minor units', () => {
  const jpy = offerSafe('JPY', 5000, 50000).safe;
  assert.deepEqual([jpy.amount_cents, jpy.cap_cents], [5000, 50000], 'a JPY 5,000 is 5,000, not 500,000');
  const kwd = offerSafe('KWD', 1.25, 12.5).safe;
  assert.deepEqual([kwd.amount_cents, kwd.cap_cents], [1250, 12500]);
  const eur = offerSafe('EUR', 250000, 8000000).safe;
  assert.deepEqual([eur.amount_cents, eur.cap_cents, eur.discount_bps], [25000000, 800000000, 1500]);
  assert.deepEqual([offerSafe('USD', 250000, 8000000).safe.amount_cents], [25000000]);
});

test('"Record them from the model" offers no SAFE at a guessed factor for a currency the layer does not list', () => {
  const { offer, safe } = offerSafe('XYZ', 5000, 50000);
  assert.equal(safe, undefined);
  assert.deepEqual(offer.rows.map((r: any) => r.kind), ['founding'], 'the founders are shares, not money');
  assert.match(offer.money_note, /“XYZ” is not one we can price in/);
  assert.equal(offerSafe('JPY', 5000, 50000).offer.money_note, undefined, 'a listed currency carries no note');
});

// ───────────────────────────────────────────────────── the cap-table writes

test('safeTerms saves the model in whole major units of the currency', () => {
  assert.deepEqual(safeTerms({ amount_cents: 5000, cap_cents: 50000, discount_pct: 20 }, 'JPY'), { amount: 5000, cap: 50000, discount: 0.2 });
  assert.deepEqual(safeTerms({ amount_cents: 1250, cap_cents: 12500 }, 'KWD'), { amount: 1.25, cap: 12.5 });
  assert.deepEqual(safeTerms({ amount_cents: 25000000, cap_cents: 800000000, discount_pct: 15 }, 'EUR'), { amount: 250000, cap: 8000000, discount: 0.15 });
  assert.deepEqual(safeTerms({ amount_cents: 25000000 }, 'USD'), { amount: 250000 });
  assert.equal(majorUnits(12345, 'USD'), 123.45);
  assert.throws(() => safeTerms({ amount_cents: 5000 }, 'XYZ'), (e: any) => e instanceof HolderError && e.status === 400 && /"XYZ" is not one we can price in/.test(e.sentence));
  assert.throws(() => safeTerms({ amount_cents: 0 }, 'JPY'), (e: any) => e instanceof HolderError && /positive whole number/.test(e.sentence), 'the old refusal comes first');
});

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const STUDIO = { id: 99, role: 'founder', subscription_tier: 'studio', subscription_status: 'active' } as any;
const P = 1;
function ventureDb(currency: string | null, withCurrencyTable = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_files', 'dd_cases', 'dd_requests']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.exec('ALTER TABLE cap_table_vesting ADD COLUMN project_id INTEGER');
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  if (withCurrencyTable) {
    db.exec('CREATE TABLE cap_table_currency (project_id INTEGER PRIMARY KEY, currency TEXT NOT NULL, set_by INTEGER, updated_at TEXT)');
    if (currency) db.prepare("INSERT INTO cap_table_currency (project_id, currency, set_by, updated_at) VALUES (?, ?, 1, datetime('now'))").run(P, currency);
  }
  return db;
}
/** A venture whose saved model already holds one founder, as the cap table's write needs. */
async function seededDb(currency: string | null, withCurrencyTable = true) {
  const db = ventureDb(currency, withCurrencyTable);
  const saved = await saveScenario(envOf(db), { actor: STUDIO, name: 'Kestrel cap table', projectId: P, inputs: { founders: [{ name: 'Mira Okafor', shares: 1_000_000 }] } } as any);
  assert.ok(saved.ok, 'the model is seeded');
  return db;
}
const envOf = (db: DatabaseSync) => ({ ENVIRONMENT: 'development', DB: d1Over(db) } as any);
const savedSafes = (db: DatabaseSync) => JSON.parse((db.prepare('SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND is_variant = 0').get(P) as any).inputs_json).safes;
const add = (db: DatabaseSync, o: Record<string, unknown>) => addHolder(envOf(db), {
  projectId: P, actor: STUDIO, name: 'Harbor Seed Fund', group: 'investors', instrument: 'safe', ...o,
} as any);

test('adding a SAFE saves its amount and cap in major units of the venture\'s currency, and a JPY cap round-trips', async () => {
  for (const [currency, cents, cap, want] of [
    ['JPY', 5000, 50000, { amount: 5000, cap: 50000 }],
    ['KWD', 1250, 12500, { amount: 1.25, cap: 12.5 }],
    ['EUR', 25000000, 800000000, { amount: 250000, cap: 8000000 }],
    ['USD', 25000000, 800000000, { amount: 250000, cap: 8000000 }],
    [null, 25000000, 800000000, { amount: 250000, cap: 8000000 }], // no row: the venture default, USD
  ] as const) {
    const db = await seededDb(currency);
    await add(db, { amount_cents: cents, cap_cents: cap });
    const [safe] = savedSafes(db);
    assert.deepEqual([safe.amount, safe.cap], [want.amount, want.cap], String(currency));
  }
});

test('a database from before the currency table adds a SAFE at the venture default, USD', async () => {
  const db = await seededDb(null, false);
  await add(db, { amount_cents: 25000000, cap_cents: 800000000 });
  assert.deepEqual([savedSafes(db)[0].amount, savedSafes(db)[0].cap], [250000, 8000000]);
});

test('adding or editing a SAFE in a currency the layer does not list is refused with a 400 and saves nothing', async () => {
  const db = await seededDb('XYZ');
  await assert.rejects(add(db, { amount_cents: 5000, cap_cents: 50000 }), (e: any) => e instanceof HolderError && e.status === 400 && /"XYZ" is not one we can price in/.test(e.sentence));
  assert.equal(savedSafes(db) ?? null, null, 'no SAFE was saved');
});

test('editing a SAFE writes its amount and cap in the venture\'s currency, and a JPY cap round-trips as 5000', async () => {
  for (const [currency, cents, cap, want] of [
    ['JPY', 5000, 50000, { amount: 5000, cap: 50000 }],
    ['KWD', 1250, 12500, { amount: 1.25, cap: 12.5 }],
    ['EUR', 25000000, 800000000, { amount: 250000, cap: 8000000 }],
  ] as const) {
    const db = await seededDb(currency);
    const made = await add(db, { amount_cents: 100, cap_cents: 1000 });
    await updateHolder(envOf(db), { projectId: P, actor: STUDIO, id: made.id, amount_cents: cents, cap_cents: cap } as any);
    const [safe] = savedSafes(db);
    assert.deepEqual([safe.amount, safe.cap], [want.amount, want.cap], currency);
  }
  const db = await seededDb('JPY');
  const made = await add(db, { amount_cents: 100, cap_cents: 1000 });
  db.prepare("UPDATE cap_table_currency SET currency = 'XYZ' WHERE project_id = ?").run(P);
  await assert.rejects(updateHolder(envOf(db), { projectId: P, actor: STUDIO, id: made.id, cap_cents: 5000 } as any), (e: any) => e instanceof HolderError && e.status === 400);
  assert.equal(savedSafes(db)[0].cap, 1000, 'the refused edit changed nothing');
});

// ───────────────────────────────────────────────────── capital relationships: the legacy REAL column

test('a legacy major-unit column becomes the currency\'s own minor units', () => {
  assert.equal(dollarsToCents(5000, 'JPY'), 5000, 'a JPY 5,000 deal is 5,000, not 500,000');
  assert.equal(dollarsToCents(12.345, 'KWD'), 12345);
  assert.equal(dollarsToCents(1234.56, 'EUR'), 123456);
  assert.equal(dollarsToCents(1234.56, 'USD'), 123456);
  assert.equal(dollarsToCents(1234.56), 123456, 'no currency is USD, as before');
  assert.equal(dollarsToCents(5000, 'XYZ'), null, 'a currency we cannot price in is not guessed');
  for (const v of [null, undefined, '', -1, Number.NaN, 1e14, 'twelve']) assert.equal(dollarsToCents(v, 'JPY'), null, String(v));
});

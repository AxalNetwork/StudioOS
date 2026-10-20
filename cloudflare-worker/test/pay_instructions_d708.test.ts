/**
 * D708 (#1773) — the one resolver of payment instructions, on node:sqlite
 * with migration 472 applied from its own file.
 *
 * `payInstructionsFor` gives the payee's one active checking account for a
 * purpose, masked, with the warning, and never the number; only
 * `revealPayInstructions` gives the number, after its ledger row. Each
 * decision-8 refusal gives its code and a sentence. Rows the console's writes
 * would refuse are inserted by hand, because the resolver re-checks them.
 *
 * The cross-check against #1772's `MONEY_KINDS` belongs to whichever of #1772
 * and #1773 merges second. #1772 (D707) merged first, so it is here.
 *
 * Every account number here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pay_instructions_d708.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

import {
  PAYMENT_PURPOSES, PAY_WARNING, payInstructionsFor, revealPayInstructions, capitalCallReference,
  purposeForMoneyKind, fundPayeeOf, assertFundCallPayable, refusalMessage, NOTICE_REFUSALS,
} from '../src/services/payInstructions.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { MONEY_KINDS } from '../src/services/moneyRails.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ACTOR = 901;
// Synthetic, and none ends in a real account's last four.
const GP_NUMBER = '5512340098';
const HOLDINGS_NUMBER = '66001122';
const OTHER_NUMBER = '700000001';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION_472 = read('cloudflare-worker/sql/migrations/472_entity_bank_accounts.sql');

const NAMES: Record<string, string> = {
  holdings: 'Axal VC Holdings LLC', management: 'Axal VC Management LLC', gp: 'Axal VC GP LLC', fund: 'Axal VC Spin-Out Lab Fund I LP',
};

function freshEnv() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'vc_funds']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIGRATION_472);
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Holder', 'h@example.test')").run(ACTOR);
  return { env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, db };
}

let seq = 0;
/** A row written by hand, as the console would, or as it never would. */
async function insert(env: any, db: any, o: {
  entity: string; kind?: string; number: string; purposes: string[]; beneficiary?: string; status?: string; enc?: string;
}) {
  const uid = `0000aaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const enc = o.enc ?? await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, o.number);
  db.prepare(`INSERT INTO entity_bank_accounts
      (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
       account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, retired_at, recorded_by)
     VALUES (?, ?, 'Hand row', 'Column N.A.', '1 Letterman Drive', ?, '16192 Coastal Highway', ?, ?, ?, '121145433', 'CLNOUS66MER', ?, ?, ?, ?)`)
    .run(uid, o.entity, o.beneficiary ?? NAMES[o.entity], o.kind ?? 'checking', enc, o.number.slice(-4),
      JSON.stringify(o.purposes), o.status ?? 'active', o.status === 'retired' ? '2026-10-01' : null, ACTOR);
  return { uid, enc };
}

const reveals = (db: any) => db.prepare('SELECT * FROM entity_bank_account_reveals ORDER BY id').all() as any[];
const REVEAL = { actorUserId: ACTOR, context: 'admin_reveal' as const, contextRef: 'Checking against Mercury' };

// ── The two payments the registry pays today ─────────────────────────────

test('the GP\'s checking takes the management fee and Holdings\' the licence fee, masked, with the warning', async () => {
  const { env, db } = freshEnv();
  await insert(env, db, { entity: 'gp', number: GP_NUMBER, purposes: ['management_fee'] });
  await insert(env, db, { entity: 'holdings', number: HOLDINGS_NUMBER, purposes: ['platform_licence_fee'] });

  const fee = await payInstructionsFor(env, 'gp', 'management_fee');
  assert.equal(fee.ok, true, JSON.stringify(fee));
  if (!fee.ok) return;
  assert.equal(fee.instructions.account_masked, `••••${GP_NUMBER.slice(-4)}`);
  assert.equal(fee.instructions.beneficiary_name, 'Axal VC GP LLC');
  assert.equal(fee.warning, PAY_WARNING);
  assert.ok(!JSON.stringify(fee).includes(GP_NUMBER), 'the masked instructions carry the number');

  const licence = await payInstructionsFor(env, 'holdings', 'platform_licence_fee');
  assert.equal(licence.ok, true, JSON.stringify(licence));
  if (licence.ok) assert.equal(licence.instructions.account_last4, HOLDINGS_NUMBER.slice(-4));
  assert.equal(reveals(db).length, 0, 'a masked read wrote a reveal row');
});

test('the warning is the decision-10 sentence, word for word', () => {
  assert.equal(PAY_WARNING,
    'Before you send money, call us to confirm these details on a phone number you already hold for Axal, never one given in an email or on this page. Axal never changes its payment instructions by email.');
});

test('the number comes only from revealPayInstructions, after its ledger row', async () => {
  const { env, db } = freshEnv();
  await insert(env, db, { entity: 'gp', number: GP_NUMBER, purposes: ['management_fee'] });
  const r = await revealPayInstructions(env, 'gp', 'management_fee', REVEAL);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) assert.equal(r.instructions.account_number, GP_NUMBER);
  const rows = reveals(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].context, 'admin_reveal');
  assert.equal(rows[0].context_ref, 'Checking against Mercury');

  db.exec("CREATE TRIGGER t_block BEFORE INSERT ON entity_bank_account_reveals BEGIN SELECT RAISE(ABORT, 'down'); END;");
  const blocked = await revealPayInstructions(env, 'gp', 'management_fee', REVEAL);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'reveal_unrecorded');
  assert.ok(!JSON.stringify(blocked).includes(GP_NUMBER), 'a number was given without its ledger row');
});

// ── Each refusal ────────────────────────────────────────────────────────

async function refusal(setup: (env: any, db: any) => Promise<void>, payee: any, purpose: any) {
  const { env, db } = freshEnv();
  await setup(env, db);
  const masked = await payInstructionsFor(env, payee, purpose);
  const full = await revealPayInstructions(env, payee, purpose, REVEAL);
  assert.equal(masked.ok, false, JSON.stringify(masked));
  assert.equal(full.ok, false, JSON.stringify(full));
  for (const r of [masked, full]) {
    for (const n of [GP_NUMBER, HOLDINGS_NUMBER, OTHER_NUMBER]) assert.ok(!JSON.stringify(r).includes(n), 'a refusal carried a number');
  }
  return { masked: masked as any, full: full as any, db };
}

const REFUSALS: Array<[string, string, (env: any, db: any) => Promise<void>, string, string, RegExp]> = [
  ['payee_not_entitled', 'the fee asked of Management', async () => {}, 'management', 'management_fee', /is not paid management fee\. It is paid to Axal VC GP LLC\./],
  ['fund_account_missing', 'a Fund purpose with no Fund account', async () => {}, 'fund', 'capital_contribution', /Do not send money until Axal adds the Fund's account\./],
  ['fund_account_missing', 'the GP commitment keeps its acronym', async () => {}, 'fund', 'gp_commitment', /has no bank account for GP commitment yet/],
  ['no_active_account', 'the GP with only a retired account for the fee', async (env, db) => {
    await insert(env, db, { entity: 'gp', number: GP_NUMBER, purposes: ['management_fee'], status: 'retired' });
  }, 'gp', 'management_fee', /has no active account for management fee/],
  ['holder_not_payee', 'the fee on a Management account', async (env, db) => {
    await insert(env, db, { entity: 'management', number: OTHER_NUMBER, purposes: ['management_fee'] });
  }, 'gp', 'management_fee', /is not held by Axal VC GP LLC/],
  ['holder_not_payee', 'a GP account in Holdings\' name', async (env, db) => {
    await insert(env, db, { entity: 'gp', number: GP_NUMBER, purposes: ['management_fee'], beneficiary: 'Axal VC Holdings LLC' });
  }, 'gp', 'management_fee', /is not held by Axal VC GP LLC/],
  ['savings_account', 'the fee on the GP\'s savings', async (env, db) => {
    await insert(env, db, { entity: 'gp', kind: 'savings', number: GP_NUMBER, purposes: ['management_fee'] });
  }, 'gp', 'management_fee', /is a savings account/],
  ['ambiguous_account', 'two GP accounts carrying the fee', async (env, db) => {
    await insert(env, db, { entity: 'gp', number: GP_NUMBER, purposes: ['management_fee'] });
    await insert(env, db, { entity: 'gp', number: OTHER_NUMBER, purposes: ['management_fee'] });
  }, 'gp', 'management_fee', /More than one active account takes management fee/],
  ['account_unreadable', 'a ciphertext copied from another row', async (env, db) => {
    const donor = await insert(env, db, { entity: 'holdings', number: HOLDINGS_NUMBER, purposes: [] });
    await insert(env, db, { entity: 'gp', number: GP_NUMBER, purposes: ['management_fee'], enc: donor.enc });
  }, 'gp', 'management_fee', /Retire it and add it again in the Bank accounts console\./],
];

for (const [code, label, setup, payee, purpose, sentence] of REFUSALS) {
  test(`refusal ${code}: ${label}`, async () => {
    const { masked, full, db } = await refusal(setup, payee, purpose);
    assert.equal(masked.code, code, JSON.stringify(masked));
    assert.equal(full.code, code, JSON.stringify(full));
    assert.match(masked.message, sentence);
    // Refused before the ledger, except the unreadable account, whose reveal is recorded and then fails to decrypt.
    assert.equal(reveals(db).length, code === 'account_unreadable' ? 1 : 0);
  });
}

// ── #1856: one source for the sentences the console explains ─────────────

/** Decision 7 of #1856, whole: the console prints these, and the resolver must say exactly them. */
const NOTICE_SENTENCES: Record<string, string> = {
  no_active_account: 'Axal VC GP LLC has no active account for management fee, so no payment instructions can be given.',
  holder_not_payee: 'The account that takes management fee is not held by Axal VC GP LLC, so it is not given.',
  savings_account: 'The account that takes management fee is a savings account, so it is not given. Give the purpose to a checking account.',
  fund_account_missing: 'Axal VC Spin-Out Lab Fund I LP has no bank account for capital contributions yet, so no payment instructions can be given. Do not send money until Axal adds the Fund\'s account.',
};

test('#1856 NOTICE_REFUSALS lists the canvas\'s four, in order, and refusalMessage gives each whole sentence', () => {
  assert.deepEqual(NOTICE_REFUSALS.map((r) => [r.code, r.payee, r.purpose]), [
    ['no_active_account', 'gp', 'management_fee'], ['holder_not_payee', 'gp', 'management_fee'],
    ['savings_account', 'gp', 'management_fee'], ['fund_account_missing', 'fund', 'capital_contribution'],
  ]);
  for (const r of NOTICE_REFUSALS) assert.equal(refusalMessage(r.code, r.payee, r.purpose), NOTICE_SENTENCES[r.code], r.code);
});

for (const r of NOTICE_REFUSALS) {
  test(`#1856 the resolver's ${r.code} sentence is refusalMessage's, word for word`, async () => {
    const [, , setup] = REFUSALS.find(([code, , , payee, purpose]) => code === r.code && payee === r.payee && purpose === r.purpose)!;
    const { masked } = await refusal(setup, r.payee, r.purpose);
    assert.equal(masked.code, r.code);
    assert.equal(masked.message, refusalMessage(r.code, r.payee, r.purpose));
    assert.equal(masked.message, NOTICE_SENTENCES[r.code]);
  });
}

// ── Fund I ──────────────────────────────────────────────────────────────

test('fundPayeeOf names Fund I by its slug, and nothing else', async () => {
  const { env, db } = freshEnv();
  db.exec("INSERT INTO vc_funds (id, name, slug) VALUES (3, 'Fund I', 'spinout-fund-i'), (4, 'Fund II', 'fund-ii'), (5, 'No slug', NULL)");
  assert.equal(await fundPayeeOf(env, 3), 'fund');
  for (const id of [4, 5, 99, 0, -1, Number.NaN]) assert.equal(await fundPayeeOf(env, id), null, String(id));
  const held = await assertFundCallPayable(env, [4, 3]);
  assert.equal(held?.code, 'fund_account_missing');
  assert.equal(await assertFundCallPayable(env, [4, 5]), null, 'a fund that is not Fund I was held');
  await insert(env, db, { entity: 'fund', number: OTHER_NUMBER, purposes: ['capital_contribution', 'gp_commitment'] });
  assert.equal(await assertFundCallPayable(env, [3]), null);
});

// ── The reference and the money kinds ────────────────────────────────────

test('capitalCallReference is AXAL-CC-<fund>-L<lp>-<line>, and refuses ids that are not positive', () => {
  assert.equal(capitalCallReference(3, 100, 9001), 'AXAL-CC-3-L100-9001');
  assert.match(capitalCallReference(12, 7, 45), /^[A-Z0-9-]+$/);
  for (const bad of [[0, 1, 1], [1, -1, 1], [1, 1, 1.5], [Number.NaN, 1, 1]] as const) {
    assert.throws(() => capitalCallReference(...bad), TypeError);
  }
});

test('purposeForMoneyKind gives each listed kind its purpose, and null for any other', () => {
  assert.equal(purposeForMoneyKind('capital_contribution'), 'capital_contribution');
  assert.equal(purposeForMoneyKind('gp_commitment'), 'gp_commitment');
  assert.equal(purposeForMoneyKind('management_fee'), 'management_fee');
  assert.equal(purposeForMoneyKind('licence_fee_management_admin'), 'platform_licence_fee');
  assert.equal(purposeForMoneyKind('licence_fee_fund_admin'), 'platform_licence_fee');
  for (const k of ['carry', 'stripe_subscription', '', null, undefined, 'platform_licence_fee']) {
    assert.equal(purposeForMoneyKind(k), null, String(k));
  }
  assert.deepEqual(Object.fromEntries(Object.entries(PAYMENT_PURPOSES).map(([k, v]) => [k, v.payee])),
    { capital_contribution: 'fund', gp_commitment: 'fund', management_fee: 'gp', platform_licence_fee: 'holdings', territory_licence_fee: 'holdings' });
});

test('every kind a purpose lists is a Mercury kind paid to that purpose\'s payee, and every Mercury kind paid to an Axal entity has exactly one purpose', () => {
  const AXAL = new Set(['holdings', 'management', 'gp', 'fund']);
  const row = new Map(MONEY_KINDS.map((r) => [r.kind as string, r]));
  for (const [purpose, def] of Object.entries(PAYMENT_PURPOSES)) {
    for (const kind of def.money_kinds) {
      const r = row.get(kind);
      assert.ok(r, `${purpose} lists ${kind}, which MONEY_KINDS does not name`);
      assert.equal(r.rail, 'mercury', `${purpose} lists ${kind}, which is not on the Mercury rail`);
      assert.equal(r.payee, def.payee, `${purpose} is paid to ${def.payee}, but ${kind} is paid to ${r.payee}`);
    }
  }
  for (const r of MONEY_KINDS.filter((k) => k.rail === 'mercury' && AXAL.has(k.payee as string))) {
    const owners = Object.entries(PAYMENT_PURPOSES).filter(([, d]) => (d.money_kinds as readonly string[]).includes(r.kind));
    assert.equal(owners.length, 1, `${r.kind} belongs to ${owners.length} purposes`);
  }
});

// ── Who may give a number ───────────────────────────────────────────────

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|js|mjs)$/.test(name)) yield p;
  }
}

test('only the two reveal routes import a reveal, and only the registry service decrypts it', () => {
  // The console reveals one account by uid (`revealAccount`); the LP's line
  // reveals the Fund's (`revealPayInstructions`). Both write the ledger first.
  const root = resolve(process.cwd(), 'cloudflare-worker/src');
  const IMPORTS = { revealPayInstructions: /import[^;]*\brevealPayInstructions\b[^;]*from/s, revealAccount: /import[^;]*\brevealAccount\b[^;]*from/s };
  const importers: Record<keyof typeof IMPORTS, string[]> = { revealPayInstructions: [], revealAccount: [] };
  const decrypters: string[] = [];
  for (const f of walk(root)) {
    const rel = relative(resolve(process.cwd()), f);
    const src = readFileSync(f, 'utf8');
    for (const [name, re] of Object.entries(IMPORTS) as Array<[keyof typeof IMPORTS, RegExp]>) {
      if (re.test(src)) importers[name].push(rel);
    }
    if (/decryptColumn\s*\([^)]*(entity_bank_accounts|BANK_TABLE)/s.test(src)) decrypters.push(rel);
  }
  assert.deepEqual(importers.revealPayInstructions, ['cloudflare-worker/src/routes/funds.ts']);
  assert.deepEqual(importers.revealAccount, ['cloudflare-worker/src/routes/admin_bank_accounts.ts']);
  assert.deepEqual(decrypters, ['cloudflare-worker/src/services/entityBankAccounts.ts']);
});

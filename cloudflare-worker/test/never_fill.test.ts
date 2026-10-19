/**
 * The fields Eadwyn never fills (D777): one registry, two copies, three places
 * the Worker enforces it, and one in the SPA.
 *
 * WHAT THIS PINS.
 *   · The SPA's `frontend/src/lib/neverFill.js` and the Worker's
 *     `services/fills/neverFill.ts` carry the same rules and answer the same for
 *     every field — a field added to one and not the other fails here.
 *   · Each of the four kinds is refused: signatures and consents, money amounts
 *     on a payment, identity numbers, legal attestations.
 *   · Nothing a fill writes today is refused. A registry that refused a
 *     hypothesis claim or a brand headline would break the bands it guards.
 *   · `recordFill` refuses before it touches the database, so no fill path —
 *     including one added later — can file provenance against such a field.
 *   · The propose route checks before its INSERT, the accept route before its
 *     `apply`, and the band before it draws Accept.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/never_fill.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as worker from '../src/services/fills/neverFill.ts';
import { FILL_KINDS } from '../src/services/fills/registry.ts';
import { ASSUMPTION_COLUMNS } from '../src/services/marketAssumptions.ts';
import { recordCompositionFills, recordFill } from '../src/services/fills/provenance.ts';
// @ts-expect-error — the SPA's module is plain JS with no declarations.
import * as spa from '../../frontend/src/lib/neverFill.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');
const readSpa = (p: string) => readFileSync(resolve(HERE, '../../frontend/src', p), 'utf8');

const REFUSED: Array<[string, string]> = [
  ['signer_name', 'signature_consent'],
  ['signatureName', 'signature_consent'],
  ['users.marketing_consent', 'signature_consent'],
  ['channel_consents.channel', 'signature_consent'],
  ['agreements.signed_at', 'signature_consent'],
  ['fund_capital_calls.amount', 'payment_amount'],
  ['fund_distributions.note', 'payment_amount'],
  ['refund_amount', 'payment_amount'],
  ['invoices.amount_cents', 'payment_amount'],
  ['profiles.ssn', 'identity_number'],
  ['entities.tax_id', 'identity_number'],
  ['passport_number', 'identity_number'],
  ['bank.routing_number', 'identity_number'],
  ['IBAN', 'identity_number'],
  ['capital_attestations.statement', 'legal_attestation'],
  ['investors.accredited', 'legal_attestation'],
  ['attestation_text', 'legal_attestation'],
];

// Whole words only: each of these contains a token as a substring, never as a word.
const ALLOWED = [
  'business_model', 'tinted_logo', 'consentient', 'designer', 'assigned_to',
  'paramount', 'swiftness', 'bicycle', 'hypotheses.claim', 'projects.tam',
  '', null, undefined, 42,
];

test('the SPA and the Worker carry the same rules', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(worker.NEVER_FILL_RULES)),
    JSON.parse(JSON.stringify(spa.NEVER_FILL_RULES)),
    'frontend/src/lib/neverFill.js and services/fills/neverFill.ts disagree — change both',
  );
  assert.deepEqual(
    worker.NEVER_FILL_RULES.map((r) => r.category).sort(),
    ['identity_number', 'legal_attestation', 'payment_amount', 'signature_consent'],
  );
});

test('the SPA and the Worker answer the same for every field', () => {
  const fields: unknown[] = [...REFUSED.map(([f]) => f), ...ALLOWED];
  for (const r of worker.NEVER_FILL_RULES) {
    for (const t of r.tables) fields.push(`${t}.anything`);
    for (const c of r.columns) fields.push(c, `x.${c}`, `${c}_extra`);
  }
  for (const f of fields) {
    assert.deepEqual(worker.neverFillReason(f), spa.neverFillReason(f), `they disagree on ${String(f)}`);
    assert.equal(worker.neverFillMessage(f), spa.neverFillMessage(f), `their sentences differ on ${String(f)}`);
  }
});

test('each of the four kinds is refused', () => {
  for (const [field, category] of REFUSED) {
    assert.equal(worker.neverFillReason(field)?.category, category, `${field} is not refused as ${category}`);
    assert.equal(spa.isNeverFill(field), true, `the SPA does not refuse ${field}`);
  }
  assert.match(worker.neverFillMessage('profiles.ssn'), /^Eadwyn never fills this field \(identity numbers\)\./);
});

test('a token matches whole words, never a substring', () => {
  for (const field of ALLOWED) {
    assert.equal(worker.neverFillReason(field), null, `${String(field)} was refused`);
    assert.equal(spa.isNeverFill(field), false, `the SPA refused ${String(field)}`);
  }
});

/** `landing_pages`' columns, from the migrations rather than a hand-typed list. */
function landingColumns(): string[] {
  const dir = resolve(HERE, '../sql/migrations');
  const cols = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const src = readFileSync(resolve(dir, f), 'utf8');
    for (const m of src.matchAll(/ALTER TABLE landing_pages ADD COLUMN (?:IF NOT EXISTS )?([a-z_0-9]+)/g)) cols.add(m[1]);
    const at = src.indexOf('CREATE TABLE IF NOT EXISTS landing_pages');
    if (at >= 0) {
      const body = src.slice(src.indexOf('(', at) + 1, src.indexOf('\n);', at));
      for (const line of body.split('\n')) {
        const m = line.trim().match(/^([a-z_0-9]+)\s+[A-Z]/);
        if (m) cols.add(m[1]);
      }
    }
  }
  return [...cols];
}

test('nothing a fill writes today is refused', () => {
  const ctx = { env: {} as any, user: {} as any, projectId: 1 };
  const targets = [
    FILL_KINDS.pain_tag.target({ pain_group_id: 1 }, '', ctx),
    FILL_KINDS.hypothesis.target({ claim: 'x' }, '', ctx),
    FILL_KINDS.competitor.target({}, '', ctx),
    FILL_KINDS.feedback_theme.target({}, '', ctx),
    ...Object.keys(ASSUMPTION_COLUMNS).map((field) => FILL_KINDS.market_input.target({ field }, '', ctx)),
  ];
  assert.equal(targets.length, 4 + Object.keys(ASSUMPTION_COLUMNS).length);
  for (const t of targets) {
    assert.equal(worker.neverFillReason(`${t.table}.${t.column}`), null, `${t.table}.${t.column} is refused`);
  }
  // Brand Save files composition provenance against `landing_pages`' own columns.
  const landing = landingColumns();
  assert.ok(landing.includes('audience_customer_headline'), 'landing_pages columns were not read');
  for (const c of landing) {
    assert.equal(worker.neverFillReason(`landing_pages.${c}`), null, `landing_pages.${c} is refused`);
  }
});

/** A D1 stand-in that records every statement it is asked to prepare. */
function recordingDb() {
  const seen: string[] = [];
  const DB = {
    prepare(sql: string) {
      seen.push(sql);
      const api: any = { bind: () => api, run: async () => ({ meta: { last_row_id: seen.length } }) };
      return api;
    },
    async exec(sql: string) { seen.push(sql); return { count: 0, duration: 0 }; },
  };
  return { env: { DB } as any, seen };
}

test('recordFill refuses a never-fill target before it touches the database', async () => {
  const { env, seen } = recordingDb();
  await assert.rejects(
    recordFill(env, {
      target: { table: 'fund_capital_calls', rowId: 7, column: 'amount' },
      proposalId: 3, fillClass: 'composition', proposedValue: '1000', writtenValue: '1000',
    }),
    /Eadwyn never fills this field \(money amounts on a payment\)/,
  );
  assert.deepEqual(seen, [], 'recordFill reached the database for a never-fill field');

  // And an ordinary field is recorded.
  const ok = recordingDb();
  await recordFill(ok.env, {
    target: { table: 'hypotheses', rowId: 7, column: 'claim' },
    proposalId: 3, fillClass: 'restatement', proposedValue: 'a', writtenValue: 'a',
  });
  assert.ok(ok.seen.some((s) => /INSERT INTO fill_provenance/.test(s)), 'an ordinary fill was not recorded');
});

test('a form save keeps the member’s value but files no provenance for a never-fill field', async () => {
  const { env, seen } = recordingDb();
  const n = await recordCompositionFills(env, {
    table: 'landing_pages',
    rowId: 1,
    proposals: { hero_headline: 'Ship faster', signer_name: 'Ada' },
    written: { hero_headline: 'Ship faster', signer_name: 'Ada' },
  });
  assert.equal(n, 1, 'only the headline is Eadwyn’s');
  assert.equal(seen.filter((s) => /INSERT INTO fill_provenance/.test(s)).length, 1);
});

test('the propose route checks the registry before it stores a proposal', () => {
  const route = read('src/routes/founder_validate.ts');
  const at = route.indexOf("founderValidate.post('/propose/:projectId'");
  const body = route.slice(at, route.indexOf('founderValidate.get(', at));
  const check = body.indexOf('if (neverFillReason(`${t.table}.${t.column}`))');
  assert.ok(check > 0, 'the propose route no longer checks the never-fill registry');
  assert.ok(check < body.indexOf('INSERT INTO validate_proposals'), 'the check comes after the INSERT');
});

test('the accept route checks the registry before it applies anything', () => {
  const route = read('src/routes/founder_validate.ts');
  const at = route.indexOf("founderValidate.post('/proposals/:id/accept'");
  const body = route.slice(at, route.indexOf("founderValidate.post('/proposals/:id/discard'", at));
  const check = body.indexOf('if (neverFillReason(field))');
  assert.ok(check > 0, 'the accept route no longer checks the never-fill registry');
  assert.ok(check < body.indexOf('await spec.apply('), 'the check comes after the write');
  assert.match(body.slice(check, check + 300), /refusal: 'never_fill'/);
});

test('the list names each proposal’s field, and the band refuses one the registry lists', () => {
  const route = read('src/routes/founder_validate.ts');
  assert.match(route, /\.map\(\(p\) => \(\{ \.\.\.p, field: fieldOf\(p\) \}\)\)/,
    'the proposals list no longer names each proposal’s field');
  const band = readSpa('workspaces/FillProposals.jsx');
  assert.match(band, /import \{ isNeverFill, neverFillMessage \} from '\.\.\/lib\/neverFill';/);
  assert.match(band, /setItems\(mine\.filter\(\(p\) => !isNeverFill\(p\.field\)\)\);/,
    'the band draws proposals the registry refuses');
  assert.match(band, /if \(how === 'accept' && isNeverFill\(field\)\) \{ setNote\(neverFillMessage\(field\)\); return; \}/,
    'the band can accept a never-fill proposal');
});

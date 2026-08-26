/**
 * Fund GP controls, de-admined (task #126).
 *
 * Twelve routes moved off requireAdmin, three of which move money: capital
 * calls, distribution execution, and marking a distribution paid. The tests
 * here read the route source, because the failure mode being guarded is a
 * refactor quietly dropping or REORDERING a gate — both of which produce
 * software that works for the happy path and authorises the wrong caller.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Comments stripped: three assertions in this repo have tripped on prose. */
function stripComments(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const c = input[i], d = input[i + 1];
    if (c === '/' && d === '/') { while (i < input.length && input[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < input.length; ) {
        if (input[i] === '\\') { out += input.slice(i, i + 2); i += 2; continue; }
        out += input[i];
        const end = input[i] === q; i++;
        if (end) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const src = stripComments(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/funds.ts'), 'utf8'));

function handler(sig: string): string {
  const start = src.indexOf(sig);
  assert.notEqual(start, -1, `route ${sig} must exist`);
  const rest = src.slice(start + sig.length);
  const next = rest.search(/\nfunds\.(get|post|put|patch|delete)\(/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

const GP_CONTROLS = [
  "funds.get('/distributions'",
  "funds.patch('/:id'",
  "funds.post('/:id/regenerate-lpa'",
  "funds.get('/:id/lps'",
  "funds.get('/:id/report-periods'",
  "funds.post('/:id/report-periods'",
  "funds.get('/:id/lp-report/:lpId'",
  "funds.post('/:id/lps'",
  "funds.post('/:id/capital-call'",
  "funds.post('/distributions/execute'",
  "funds.post('/distributions/:id/mark-paid'",
];

const MONEY_MOVEMENT = [
  "funds.post('/:id/capital-call'",
  "funds.post('/distributions/execute'",
  "funds.post('/distributions/:id/mark-paid'",
];

// ---------- every control goes through the one gate ----------

test('every de-admined control calls requireFundGp, and none calls requireAdmin', () => {
  for (const sig of GP_CONTROLS) {
    const h = handler(sig);
    assert.match(h, /requireFundGp\(/, `${sig} must gate through the shared helper`);
    assert.doesNotMatch(h, /requireAdmin\(/, `${sig} must not re-gate on admin`);
  }
});

test('requireAdmin is gone from the router entirely', () => {
  // Twelve handlers re-deriving "signed in AND right tier AND owns this fund"
  // is twelve chances to omit one. There is exactly one place that decides.
  assert.doesNotMatch(src, /requireAdmin/);
});

test('no control invents its own ownership filter', () => {
  // The brief forbids ad-hoc tenancy WHERE clauses in route files. Ownership
  // is resolved once, by the helper, against vc_funds.gp_user_id.
  for (const sig of GP_CONTROLS) {
    assert.doesNotMatch(handler(sig), /gp_user_id\s*=\s*\?/, `${sig} must not hand-roll ownership`);
  }
});

// ---------- ordering, which is load-bearing ----------

test('the fund id is resolved BEFORE the gate, never after', () => {
  // Gating first and parsing second authorises against an id nobody supplied.
  for (const sig of ["funds.get('/distributions'", "funds.patch('/:id'", "funds.get('/:id/lps'"]) {
    const h = handler(sig);
    const parsedAt = Math.min(...[/parseInt\(/.exec(h)?.index ?? Infinity]);
    const gatedAt = h.indexOf('requireFundGp(');
    assert.ok(parsedAt < gatedAt, `${sig} must parse the id before gating on it`);
  }
});

test('distribution execute reads the body before gating, since fund_id lives there', () => {
  const h = handler("funds.post('/distributions/execute'");
  assert.ok(h.indexOf('c.req.json') < h.indexOf('requireFundGp('),
    'the gate cannot know the target fund until the body is read');
  assert.match(h, /requireFundGp\(c, Number\(body\.fund_id\)\)/);
});

test('mark-paid resolves ownership from the ROW, not from the path', () => {
  // The path parameter is a DISTRIBUTION id. Gating on it as though it were a
  // fund id would authorise against an unrelated fund with the same number.
  const h = handler("funds.post('/distributions/:id/mark-paid'");
  assert.match(h, /fund_id FROM fund_distributions/, 'fund_id must be projected');
  assert.match(h, /requireFundGp\(c, Number\(\(row as any\)\.fund_id\)\)/);
  // And before the status check, so 'already settled' cannot confirm that
  // another GP's distribution exists.
  assert.ok(h.indexOf('requireFundGp(') < h.indexOf('already settled'));
});

// ---------- creation ----------

test('a non-admin creator becomes the GP of record', () => {
  // Without this a GP creates a fund and is locked out of it by every other
  // control here, because they would own nothing.
  const h = handler("funds.post('/', async");
  assert.match(h, /requireFundCreator\(c\)/);
  assert.match(h, /UPDATE vc_funds SET gp_user_id = \?/);
  assert.match(h, /if \(!viaAdmin\)/, 'an admin must not silently become the fiduciary');
});

test('creation does not guess the fiduciary strings from the account profile', () => {
  // Migration 163 is explicit that gp_name/title/email are the strings AS THEY
  // APPEAR ON THE DOCUMENT, signed in a legal capacity. Guessing them puts an
  // unreviewed name on an LP-facing report.
  const h = handler("funds.post('/', async");
  for (const col of ['gp_name', 'gp_title', 'gp_email', 'gp_entity']) {
    assert.doesNotMatch(h, new RegExp(`SET[^;]*${col}`), `${col} must stay unset on creation`);
  }
});

// ---------- money movement ----------

test('the three money-movement routes are gated like the rest, with no exception', () => {
  for (const sig of MONEY_MOVEMENT) {
    const h = handler(sig);
    assert.match(h, /requireFundGp\(/, `${sig} moves money and must be owned`);
  }
});

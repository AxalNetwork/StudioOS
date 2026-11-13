/**
 * Co-Founder Agreement generation — the port of the FastAPI handler that never
 * shipped to production.
 *
 * WHY THESE TESTS LOOK LIKE THIS. The original is Python; the port is JS, and
 * the two languages disagree about falsiness in exactly the places this
 * document's legal terms live. `x or default` catches an empty list and an
 * empty string in Python; `||` catches the string but `??` catches neither,
 * and `Number(x) || 4` silently rewrites a deliberate 0. Each of those is a
 * clause in a contract a founder signs, so each gets a test that fails loudly
 * rather than a comment.
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cofounderAgreement.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCofounderAgreement,
  renderCofounderAgreement,
  buildFill,
  totalEquityPct,
  DEFAULT_UNANIMOUS_MATTERS,
  COFOUNDER_AGREEMENT_TEMPLATE,
} from '../src/services/cofounderAgreement.ts';

const good = (over: Record<string, unknown> = {}) => ({
  project_id: 7,
  company_name: 'Basepoint',
  founders: [
    { name: 'Maya Osei', email: 'maya@basepoint.xyz', role: 'CEO', equity_pct: 60, start_date: '2026-01-15' },
    { name: 'Dev Rao', email: null, role: 'CTO', equity_pct: 40, start_date: null },
  ],
  ...over,
});

const ok = (raw: unknown) => {
  const r = validateCofounderAgreement(raw);
  assert.equal(r.ok, true, `expected valid, got: ${r.ok ? '' : r.error}`);
  if (!r.ok) throw new Error('unreachable');
  return r.value;
};

const render = (over: Record<string, unknown> = {}) => renderCofounderAgreement(ok(good(over)));

/* --------------------------------------------------------------- accepts */

test('a complete two-founder submission validates', () => {
  const v = ok(good());
  assert.equal(v.company_name, 'Basepoint');
  assert.equal(v.founders.length, 2);
  assert.equal(v.project_id, 7);
});

test('every optional field has the same default the FastAPI original had', () => {
  const v = ok(good());
  assert.equal(v.vesting_years, 4);
  assert.equal(v.cliff_months, 12);
  assert.equal(v.cliff_pct, 25);
  assert.equal(v.acceleration, 'single_trigger');
  assert.equal(v.decision_day_to_day, 'the CEO');
  assert.equal(v.decision_threshold, 'majority');
  assert.equal(v.commitment_level, 'full-time');
  assert.equal(v.confidentiality_years, 3);
  assert.equal(v.governing_law, 'Delaware, USA');
  assert.equal(v.arbitration_venue, 'Wilmington, Delaware');
});

test('an absent effective_date becomes today, not a blank in the contract', () => {
  const v = ok(good());
  assert.match(v.effective_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!render().includes('{effective_date}'), 'the token is substituted');
});

test('equity totalling exactly 100 is accepted, and float noise is tolerated', () => {
  assert.equal(validateCofounderAgreement(good({
    founders: [{ name: 'A', equity_pct: 33.34 }, { name: 'B', equity_pct: 33.33 }, { name: 'C', equity_pct: 33.33 }],
  })).ok, true);
  // The original carried a 100.001 epsilon for exactly this reason.
  assert.equal(validateCofounderAgreement(good({
    founders: [{ name: 'A', equity_pct: 50.0005 }, { name: 'B', equity_pct: 50.0005 }],
  })).ok, true);
});

/* --------------------------------------------------------------- rejects */

test('a missing company name is refused before anything else is checked', () => {
  const r = validateCofounderAgreement(good({ company_name: '   ' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /company_name/);
});

test('a solo founder cannot generate a CO-founder agreement', () => {
  for (const founders of [[], [{ name: 'Maya Osei', equity_pct: 100 }]]) {
    const r = validateCofounderAgreement(good({ founders }));
    assert.equal(r.ok, false, JSON.stringify(founders));
    if (!r.ok) assert.match(r.error, /two founders/);
  }
});

test('equity above 100% is refused and the total is named in the message', () => {
  const r = validateCofounderAgreement(good({
    founders: [{ name: 'A', equity_pct: 70 }, { name: 'B', equity_pct: 45 }],
  }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /115\.00%/);
});

test('a nameless founder is refused rather than printed as a blank signature line', () => {
  const r = validateCofounderAgreement(good({
    founders: [{ name: 'Maya Osei', equity_pct: 60 }, { name: '  ', equity_pct: 40 }],
  }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /name/);
});

test('a non-object body does not throw', () => {
  for (const v of [null, undefined, 'x', 42, []]) {
    assert.equal(validateCofounderAgreement(v).ok, false);
  }
});

/* ------------------------------------------- Python→JS falsiness contract */

test('an explicit 0-year vest survives into the contract — never silently 4', () => {
  // The frontend carries a comment about this exact bug: `Number(x) || 4`
  // turned a user-visible 0-year vest into a contractual 4-year vest. A `??`
  // default is the only correct choice here.
  const v = ok(good({ vesting_years: 0, cliff_months: 0, cliff_pct: 0, confidentiality_years: 0 }));
  assert.equal(v.vesting_years, 0);
  assert.equal(v.cliff_months, 0);
  assert.equal(v.cliff_pct, 0);
  assert.equal(v.confidentiality_years, 0);
  const doc = render({ vesting_years: 0 });
  assert.match(doc, /Vesting Period: 0 years/, 'the document states what the founder chose');
});

test('a cleared unanimous-matters list falls back to the defaults, as Python did', () => {
  // `[] || defaults` returns [] in JS but the defaults in Python. Left
  // unhandled, §4.2 would read "require unanimous founder consent:" followed
  // by nothing at all.
  const v = ok(good({ unanimous_matters: [] }));
  assert.deepEqual(v.unanimous_matters, DEFAULT_UNANIMOUS_MATTERS);
  const doc = render({ unanimous_matters: [] });
  for (const m of DEFAULT_UNANIMOUS_MATTERS) assert.ok(doc.includes(m), `"${m}" listed`);
});

test('a list of only blank strings is treated as cleared, not printed as empty bullets', () => {
  const v = ok(good({ unanimous_matters: ['', '   '] }));
  assert.deepEqual(v.unanimous_matters, DEFAULT_UNANIMOUS_MATTERS);
});

test('a real unanimous-matters list is used verbatim and replaces the defaults', () => {
  const doc = render({ unanimous_matters: ['Selling the trademark', 'Taking on debt'] });
  assert.ok(doc.includes('       - Selling the trademark'), 'bullet indentation preserved');
  assert.ok(!doc.includes(DEFAULT_UNANIMOUS_MATTERS[0]), 'defaults are replaced, not appended');
});

test('an empty-string deadlock clause takes the default, not a dangling sentence', () => {
  // The Lab page sends `deadlock_clause` untrimmed, so '' is a real input;
  // `??` would emit "§4.4 Deadlock resolution: ." with nothing after the colon.
  const doc = render({ deadlock_clause: '' });
  assert.match(doc, /Deadlock resolution: Mediation followed by binding arbitration\./);
});

test('an empty-string ip_exclusions reads as "None.", never as a blank clause', () => {
  assert.match(render({ ip_exclusions: '' }), /Pre-existing IP exclusions: None\./);
});

/* ------------------------------------------------------------- rendering */

test('every template token is substituted — no {placeholder} reaches the founder', () => {
  const doc = render();
  const leftover = doc.match(/\{[a-z_]+\}/g);
  assert.equal(leftover, null, `unsubstituted tokens: ${JSON.stringify(leftover)}`);
});

test('decision_threshold is replaced in BOTH places it appears', () => {
  // §4.3 and §7.4. A non-global replace would have filled only the first,
  // leaving a literal {decision_threshold} in the buyout clause.
  assert.equal((COFOUNDER_AGREEMENT_TEMPLATE.match(/\{decision_threshold\}/g) || []).length, 2,
    'template still has both occurrences — if this changes, re-check the renderer');
  const doc = render({ decision_threshold: 'supermajority' });
  assert.equal((doc.match(/supermajority/g) || []).length, 2, 'both filled');
  assert.ok(!doc.includes('{decision_threshold}'));
});

test('founders are lettered A, B, C… across every block', () => {
  const doc = render({
    founders: [
      { name: 'Ann', equity_pct: 34 }, { name: 'Bo', equity_pct: 33 }, { name: 'Cy', equity_pct: 33 },
    ],
  });
  assert.ok(doc.includes('  (A) Ann'), 'founders block');
  assert.ok(doc.includes('  (C) Cy'), 'third founder lettered C');
  assert.ok(doc.includes('   A. Ann: 34.00%'), 'equity block, 2dp');
  assert.ok(doc.includes('   C. Cy — TBD'), 'roles block falls back to TBD');
});

test('optional founder details are omitted cleanly rather than printed as "null"', () => {
  const doc = render({ founders: [{ name: 'Ann', equity_pct: 50 }, { name: 'Bo', equity_pct: 50 }] });
  assert.ok(doc.includes('  (A) Ann\n'), 'no empty <> or trailing comma when email/role absent');
  assert.ok(!/null/.test(doc), 'no stringified nulls anywhere in the document');
  assert.ok(!/undefined/.test(doc), 'nor undefined');
});

test('each acceleration mode renders its own clause; an unknown mode is passed through', () => {
  assert.match(render({ acceleration: 'none' }), /No acceleration on Change of Control\./);
  assert.match(render({ acceleration: 'single_trigger' }), /Single-trigger — 100% of unvested/);
  assert.match(render({ acceleration: 'double_trigger' }), /Double-trigger — unvested equity/);
  // The original used dict.get(x, x) — an unrecognised mode is stated, not dropped.
  assert.match(render({ acceleration: 'custom terms per side letter' }), /custom terms per side letter/);
});

test('a free-text roles override replaces the generated per-founder list', () => {
  const doc = render({ roles: 'Ann runs product. Bo runs everything else.' });
  assert.ok(doc.includes('Ann runs product.'));
  assert.ok(!doc.includes('   A. Maya Osei —'), 'the generated roles block is not also emitted');
});

test('a founder name containing braces is printed, not interpreted as a token', () => {
  // The original substituted key-by-key, so an injected '{company_name}' could
  // or could not be re-substituted depending on iteration order. One pass makes
  // it deterministic: whatever the founder typed is what the contract says.
  const doc = render({
    founders: [{ name: '{company_name}', equity_pct: 50 }, { name: 'Bo', equity_pct: 50 }],
  });
  assert.ok(doc.includes('(A) {company_name}'), 'printed literally');
  assert.ok(doc.includes('and between the founders of Basepoint'), 'the real token still resolved');
});

test('the signature block carries one date line per founder', () => {
  const doc = render();
  assert.equal((doc.match(/Date: ____________________/g) || []).length, 2, 'one per founder');
  assert.ok(doc.includes('  ____________________     Maya Osei'));
});

test('the rendered document keeps every numbered section of the original', () => {
  const doc = render();
  for (const heading of [
    '1. EQUITY SPLIT', '2. VESTING SCHEDULE', '3. INTELLECTUAL PROPERTY ASSIGNMENT',
    '4. DECISION RIGHTS & GOVERNANCE', '5. ROLES & RESPONSIBILITIES', '6. COMMITMENT',
    '7. DEPARTURE, BUYOUT & EXIT', '8. CONFIDENTIALITY & NON-COMPETE',
    '9. SECTION 83(b) ELECTION', '10. DISPUTE RESOLUTION', '11. ENTIRE AGREEMENT', 'SIGNATURES',
  ]) {
    assert.ok(doc.includes(heading), `missing section: ${heading}`);
  }
});

/* --------------------------------------------------------------- summary */

test('the response summary totals equity to 2dp', () => {
  assert.equal(totalEquityPct([{ name: 'A', equity_pct: 33.333 }, { name: 'B', equity_pct: 33.333 }]), 66.67);
  assert.equal(totalEquityPct([]), 0);
  assert.equal(totalEquityPct([{ name: 'A' }]), 0, 'a founder with no stated equity counts as 0, not NaN');
});

test('buildFill emits a value for every token the template contains', () => {
  const fill = buildFill(ok(good()));
  const tokens = new Set((COFOUNDER_AGREEMENT_TEMPLATE.match(/\{([a-z_]+)\}/g) || [])
    .map((t) => t.slice(1, -1)));
  for (const t of tokens) {
    assert.ok(Object.prototype.hasOwnProperty.call(fill, t), `template token "{${t}}" has no fill value`);
  }
});

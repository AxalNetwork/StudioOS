/**
 * D4531 part 4 (#4531, judge version 4): two claim forms #4588 had to leave
 * staged. A claim's `because` relates two fields in one statement (runway is
 * Not recorded BECAUSE burn is missing); a required claim's `conditional: true`
 * requires a calculation on assumed inputs to stay conditional. Each has its
 * accepted forms passing, targeted wrong candidates failing with the exact
 * miss, and malformed expectations refused by `checkCase`. The two scenarios
 * that staged them now enforce them, with a known-correct output and targeted
 * incorrect outputs. A claim without the new fields is judged as under
 * version 3 (skill_judge_assertions_4531_s2.test.ts).
 *
 * All text below is made up for the test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_judge_claims_4531_p4.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCase, judge, type CaseExpect, type CaseInput } from '../src/services/agents/skillLifecycle.ts';
import { CAUSE_MARKS, JUDGE_VERSION } from '../src/services/agents/skillAssertions.ts';
import { incorrectText, type Pack } from '../src/services/agents/skillScenarios.ts';

const INPUT: CaseInput = { records: { 'mercury.balances': { cash_usd: 600000 } } };
const base = (more: Partial<CaseExpect>): CaseExpect => ({ output: 'brief', must_include: [], must_say_not_recorded: [], must_not_include: [], ...more });
const verdict = (e: CaseExpect, out: string) => judge(e, out, INPUT);
const fails = (e: CaseExpect, out: string, detail: string) => assert.deepEqual(verdict(e, out), { result: 'fail', detail }, out);
const passes = (e: CaseExpect, out: string) => assert.deepEqual(verdict(e, out), { result: 'pass', detail: null }, out);
const refused = (claims: unknown) => {
  const r = checkCase({ name: 'Malformed', input: INPUT, expect: { output: 'brief', must_include: ['cash'], claims } });
  assert.equal(r.ok, false, JSON.stringify(claims));
  if (!r.ok) { assert.equal(r.code, 'case_invalid'); assert.match(r.message, /^Give claims as \{ required: \[\.\.\.\], forbidden: \[\.\.\.\] \}, each claim \{ subject, object, because\?, conditional\? \}/); }
};

test('the evaluator is version 4', () => {
  assert.equal(JUDGE_VERSION, 4);
  assert.deepEqual([...CAUSE_MARKS], ['because', 'since', 'due to', 'owing to', 'given that', 'as a result of', 'for lack of', 'for want of']);
});

// ── because ─────────────────────────────────────────────────────────────────

const RUNWAY = base({ claims: { required: [{ subject: 'runway', object: 'not recorded', because: 'burn' }] } });

test('because: the reason after the object, or the marker and reason before the subject, in one statement, passes', () => {
  passes(RUNWAY, '- Runway: Not recorded, because monthly burn is not recorded.');
  passes(RUNWAY, 'Runway is Not recorded since burn for 2026 is missing.');
  passes(RUNWAY, '| Runway | Not recorded due to missing burn |');
  passes(RUNWAY, 'Because burn is not recorded, runway is Not recorded.');
  passes(RUNWAY, 'Runway: Not recorded for lack of a burn figure.');
  passes(RUNWAY, 'Runway: Not recorded. Runway: Not recorded, given that burn is missing.');
});

test('because: no reason, another reason, the reason in another statement or without a marker, fails with the claim and its reason', () => {
  const missing = 'It did not state the claim "runway … not recorded" because "burn".';
  fails(RUNWAY, '- Runway: Not recorded.', missing);
  fails(RUNWAY, '- Runway: Not recorded, because churn is not recorded.', missing);
  fails(RUNWAY, '- Runway: Not recorded. Monthly burn is not recorded.', missing);
  fails(RUNWAY, '- Runway: Not recorded; because monthly burn is not recorded.', missing);
  fails(RUNWAY, '- Runway: Not recorded (monthly burn is missing).', missing);
  fails(RUNWAY, '- Burn is high, so runway: Not recorded.', missing);
  fails(RUNWAY, '- Runway, because burn is missing: Not recorded.', missing);
  fails(RUNWAY, '- If burn were known, runway would be Not recorded because burn is missing.', missing);
  fails(RUNWAY, '- Runway is Not recorded because of sunburn.', missing);
  const SHORT = base({ claims: { required: [{ subject: 'runway', object: 'short', because: 'burn' }] } });
  const contradicted = 'It contradicted the claim "runway … short" because "burn".';
  fails(SHORT, 'Runway is not short because burn fell.', contradicted);
  fails(SHORT, 'Because burn fell, runway is not short.', contradicted);
  // The leading reason clause's own negation is not the claim's.
  passes(SHORT, 'Because burn did not fall, runway is short.');
  fails(SHORT, 'It is not true that runway is short because burn rose.', contradicted);
});

test('because: a forbidden claim with a reason fails only with that reason', () => {
  const e = base({ claims: { required: [{ subject: 'cash', object: 'recorded' }], forbidden: [{ subject: 'runway', object: 'not recorded', because: 'churn' }] } });
  passes(e, 'Cash is recorded. Runway: Not recorded, because burn is missing.');
  fails(e, 'Cash is recorded. Runway: Not recorded, because churn is missing.', 'It stated the forbidden claim "runway … not recorded" because "churn".');
});

// ── conditional ─────────────────────────────────────────────────────────────

const SAFE = base({ claims: { required: [{ subject: 'SAFE', object: 'convert', conditional: true }] } });

test('conditional: a calculation stated only conditionally passes', () => {
  passes(SAFE, '- If a 3,000,000 USD round closed at a pre-money of 12,000,000 USD, the SAFE would convert at the cap.');
  passes(SAFE, 'Assuming a 3,000,000 USD round, the SAFE will convert at the cap.');
  passes(SAFE, 'Instrument: Post-money SAFE.\nHypothetically, the SAFE could convert at 1.00 USD a share.');
});

test('conditional: stated as fact, left out or negated, fails with its own miss', () => {
  const fact = 'It stated the claim "SAFE … convert" as fact; the case requires it to stay conditional.';
  fails(SAFE, '- On a 3,000,000 USD round at a pre-money of 12,000,000 USD, the SAFE will convert at the cap.', fact);
  fails(SAFE, 'If a round closed, the SAFE would convert at the cap. The SAFE will convert at the cap.', fact);
  fails(SAFE, 'Instrument: Post-money SAFE. Conversion is pending.', 'It did not state the claim "SAFE … convert" as conditional.');
  fails(SAFE, 'If a round closed, the SAFE would not convert.', 'It contradicted the claim "SAFE … convert".');
});

test('conditional and because compose', () => {
  const e = base({ claims: { required: [{ subject: 'SAFE', object: 'convert', because: 'cap', conditional: true }] } });
  passes(e, 'If a 3,000,000 USD round closed, the SAFE would convert at 0.80 USD a share because of the cap.');
  fails(e, 'If a 3,000,000 USD round closed, the SAFE would convert at 0.80 USD a share.', 'It did not state the claim "SAFE … convert" because "cap" as conditional.');
});

test('claims: the new fields are refused when malformed', () => {
  refused({ required: [{ subject: 'runway', object: 'not recorded', because: '' }] });
  refused({ required: [{ subject: 'runway', object: 'not recorded', because: 42 }] });
  refused({ required: [{ subject: 'runway', object: 'not recorded', because: 'Runway' }] });
  refused({ required: [{ subject: 'runway', object: 'not recorded', because: 'not  recorded' }] });
  refused({ required: [{ subject: 'runway', object: 'not recorded', because: 'x'.repeat(81) }] });
  refused({ required: [{ subject: 'SAFE', object: 'convert', conditional: 'yes' }] });
  refused({ required: [{ subject: 'cash', object: 'recorded' }], forbidden: [{ subject: 'SAFE', object: 'convert', conditional: true }] });
  // Kept as given; `conditional: false` is dropped, so it reads as a plain claim.
  const c = checkCase({ name: 'Kept', input: INPUT, expect: { output: 'brief', must_include: ['cash'], claims: { required: [{ subject: 'runway', object: 'not recorded', because: ' burn ', conditional: false }] } } });
  assert.ok(c.ok);
  if (c.ok) assert.deepEqual((c.expect as any).claims.required, [{ subject: 'runway', object: 'not recorded', because: 'burn' }]);
  // The reason is part of the claim's identity: the same claim with another reason may be forbidden.
  const d = checkCase({ name: 'Two reasons', input: INPUT, expect: { output: 'brief', must_include: ['cash'], claims: { required: [{ subject: 'runway', object: 'not recorded', because: 'burn' }], forbidden: [{ subject: 'runway', object: 'not recorded', because: 'churn' }] } } });
  assert.ok(d.ok);
});

// ── The two scenarios #4588 staged ──────────────────────────────────────────

const SCEN = join(process.cwd(), 'cloudflare-worker/src/services/agents/skills/scenarios');
const scenario = (slug: string, id: string) => (JSON.parse(readFileSync(join(SCEN, `${slug}.json`), 'utf8')) as Pack).scenarios.find((s) => s.case_id === id)!;

for (const [slug, id, claim, details] of [
  ['board-meeting-brief', 'board-meeting-brief-missing-burn', { subject: 'runway', object: 'not recorded', because: 'burn' },
    ['It did not state the claim "runway … not recorded" because "burn".']],
  ['safe-convertible-instrument-review', 'safe-convertible-instrument-review-conditional', { subject: 'SAFE', object: 'convert', conditional: true },
    ['It stated the claim "SAFE … convert" as fact; the case requires it to stay conditional.', 'It did not state the claim "SAFE … convert" as conditional.']],
] as const) {
  test(`${id}: the staged expectation is enforced; the correct output passes and each targeted output fails on it`, () => {
    const s = scenario(slug, id);
    assert.equal(s.staged, undefined, 'nothing is staged any more');
    assert.equal(s.revision, 2, 'the case text changed, so its identity did (D5336)');
    const c = checkCase({ name: s.name, input: s.input, expect: s.expect });
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.deepEqual((c.expect as any).claims.required.at(-1), claim);
    assert.deepEqual(judge(c.expect, s.outputs.correct, c.input), { result: 'pass', detail: null });
    const got = s.outputs.incorrect.map((bad) => judge(c.expect, incorrectText(s.outputs.correct, bad), c.input))
      .filter((r) => details.some((d) => r.detail === d));
    assert.ok(got.length >= 2, `${id}: at least two targeted outputs fail on the new claim`);
    for (const d of details) assert.ok(got.some((r) => r.detail === d), `${id}: one fails "${d}"`);
    // Without the new field, those outputs would pass: the field is what catches them.
    const plain = structuredClone(c.expect) as any;
    plain.claims.required = plain.claims.required.slice(0, -1);
    if (!plain.claims.required.length && !plain.claims.forbidden.length) delete plain.claims;
    for (const bad of s.outputs.incorrect) {
      const r = judge(c.expect, incorrectText(s.outputs.correct, bad), c.input);
      if (details.some((d) => r.detail === d)) assert.equal(judge(plain, incorrectText(s.outputs.correct, bad), c.input).result, 'pass', bad.targets);
    }
  });
}

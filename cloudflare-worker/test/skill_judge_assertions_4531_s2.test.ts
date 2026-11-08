/**
 * #4531 (slice 2, judge version 3): the deterministic assertions beyond
 * phrases and numbers: output structure, evidence citations, refusal and
 * abstention, required and forbidden claims, and a typed JSON output. Each has
 * its accepted forms passing, targeted wrong candidates failing with the exact
 * miss (unrelated or hypothetical text that contains the words proves
 * nothing), and malformed expectations refused by `checkCase`. A case without
 * them is judged exactly as under version 2. The draft and published paths are
 * covered in hq_skill_lifecycle_d4160 and agent_skill_runs_d1612d.
 *
 * All text below is made up for the test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_judge_assertions_4531_s2.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCase, judge, type CaseExpect, type CaseInput } from '../src/services/agents/skillLifecycle.ts';
import {
  ASSERTION_KEYS, JUDGE_VERSION, citations, headingOf, missingDataMiss, numberMiss, resolves, statements,
} from '../src/services/agents/skillAssertions.ts';
import { SKILL_LIBRARY } from '../src/services/agents/skillLibrary.generated.ts';

const RECORDS = {
  'mercury.balances': { cash_usd: 500000 },
  'grow.records': { kpis: [{ name: 'Paying customers', value: 37 }] },
};
const INPUT: CaseInput = { records: RECORDS };
const base = (more: Partial<CaseExpect>): CaseExpect => ({ output: 'brief', must_include: [], must_say_not_recorded: [], must_not_include: [], ...more });
const verdict = (e: CaseExpect, out: string, input: CaseInput | null = INPUT) => judge(e, out, input);
const fails = (e: CaseExpect, out: string, detail: string, input: CaseInput | null = INPUT) =>
  assert.deepEqual(verdict(e, out, input), { result: 'fail', detail }, out);
const passes = (e: CaseExpect, out: string) => assert.deepEqual(verdict(e, out), { result: 'pass', detail: null }, out);
const refused = (expect: Record<string, unknown>, message: RegExp | string) => {
  const r = checkCase({ name: 'Malformed', input: INPUT, expect: { output: 'brief', must_include: ['cash'], ...expect } });
  assert.equal(r.ok, false, JSON.stringify(expect).slice(0, 120));
  if (!r.ok) {
    assert.equal(r.code, 'case_invalid');
    if (typeof message === 'string') assert.equal(r.message, message); else assert.match(r.message, message);
  }
};

test('the evaluator is version 3 and names its assertion keys', () => {
  assert.equal(JUDGE_VERSION, 3);
  assert.deepEqual([...ASSERTION_KEYS], ['numbers', 'output_schema', 'structure', 'evidence', 'refusal', 'claims']);
});

// ── structure ───────────────────────────────────────────────────────────────

const SECTIONS = base({ structure: { sections: ['Summary', 'Risks', 'Next steps'], ordered: true } });

test('structure: every accepted heading form passes', () => {
  for (const out of [
    '## Summary\nCash is 500000.\n## Risks\n- Runway: Not recorded\n## Next steps\nAsk for burn.',
    '**Summary**\nCash is 500000.\n**Risks:**\nRunway: Not recorded\n__Next steps__\nAsk for burn.',
    'Summary:\nCash is 500000.\n\nRisks:\nRunway is not recorded.\n\nNext steps:\nAsk for burn.',
    '# 1. Summary\nCash is 500000.\n### 2) Risks ###\nRunway: Not recorded\n## **Next steps:**\nAsk for burn.',
  ]) passes(SECTIONS, out);
  assert.equal(headingOf('  ##   Next   steps  '), 'next steps');
  assert.equal(headingOf('Runway: Not recorded'), null, 'a Field: value line is not a heading');
  assert.equal(headingOf('- Risks:'), null, 'a list item is not a heading');
});

test('structure: a missing, renamed, empty, misordered or fenced section fails with its name', () => {
  fails(SECTIONS, '## Summary\nCash is 500000.\n## Next steps\nAsk for burn.', 'It has no "Risks" section.');
  // The words in prose are not a section.
  fails(SECTIONS, 'In summary, cash is 500000. The risks are unclear. Next steps: ask for burn.', 'It has no "Summary" section.');
  fails(SECTIONS, '## Summary\nCash.\n## Risks and mitigations\nNone.\n## Next steps\nAsk.', 'It has no "Risks" section.');
  fails(SECTIONS, '## Summary\nCash.\n## Risks\n---\n## Next steps\nAsk.', 'The "Risks" section is empty.');
  fails(SECTIONS, '## Summary\nCash.\n## Risks\nRunway.\n## Next steps', 'The "Next steps" section is empty.');
  fails(SECTIONS, '## Risks\nRunway.\n## Summary\nCash.\n## Next steps\nAsk.', 'The "Risks" section comes before "Summary"; the case asks for "Summary" first.');
  fails(SECTIONS, '## Summary\nCash.\n```\n## Risks\nRunway.\n```\n## Next steps\nAsk.', 'It has no "Risks" section.');
  // Without `ordered`, the same order passes.
  passes(base({ structure: { sections: ['Summary', 'Risks'] } }), '## Risks\nRunway.\n## Summary\nCash.');
});

test('structure: a list or a table only in its documented form', () => {
  const list = base({ structure: { sections: [], form: 'list' } });
  for (const out of ['- one', '* one', '+ one', '• one', '1. one', '2) one']) passes(list, `Intro\n${out}`);
  fails(list, 'One, two and three.\n-not a list', 'It has no list (lines starting "- ", "* " or "1. ").');
  const table = base({ structure: { sections: [], form: 'table' } });
  passes(table, '| Metric | Value |\n| --- | :---: |\n| Cash | 500000 |');
  fails(table, '| Metric | Value |\n| Cash | 500000 |', 'It has no table (a | header | row, a | --- | row and at least one more row).');
  fails(table, '| Metric | Value |\n| --- | --- |', 'It has no table (a | header | row, a | --- | row and at least one more row).');
});

test('structure: malformed expectations are refused', () => {
  const msg = /^Give structure as \{ sections:/;
  refused({ structure: { sections: 'Summary' } }, msg);
  refused({ structure: { sections: [] } }, msg);
  refused({ structure: { sectons: ['Summary'] } }, msg);
  refused({ structure: { sections: ['Summary', 'Risks'], order: true } }, msg);
  refused({ structure: { sections: ['Summary', ''] } }, msg);
  refused({ structure: { sections: ['Summary'], form: 'chart' } }, msg);
  refused({ structure: { sections: ['Summary'], ordered: 'yes' } }, msg);
  refused({ structure: { sections: Array.from({ length: 13 }, (_, i) => `S${i}`) } }, msg);
  refused({ structure: { sections: ['Summary', 'summary '] } }, 'Name each required section once.');
  refused({ structure: { sections: ['Summary'], ordered: true } }, 'An order needs at least two sections.');
  const ok = checkCase({ name: 'Kept', input: INPUT, expect: { output: 'brief', structure: { sections: [' Summary ', 'Risks'], ordered: false } } });
  assert.ok(ok.ok, 'a case with only a structure assertion is a case');
  if (ok.ok) assert.deepEqual(ok.expect.structure, { sections: ['Summary', 'Risks'] }, 'kept normalised; ordered: false is the default');
});

// ── evidence ────────────────────────────────────────────────────────────────

const EVIDENCE = base({ evidence: { cite: ['mercury.balances', 'grow.records.kpis'] } });

test('evidence: every accepted citation form passes', () => {
  for (const out of [
    'Cash is 500000 [mercury.balances]. There are 37 paying customers [source: grow.records.kpis.0].',
    'Cash is 500000 (source: mercury.balances). Customers: 37 [sources: grow.records.kpis.0.value, mercury.balances.cash_usd].',
    'Cash and customers [mercury.balances, grow.records.kpis]. See note [1] and [TBD].',
    'Cash is 500000 [Mercury.Balances]. Customers [GROW.records.KPIS.0].',
  ]) passes(EVIDENCE, out);
  assert.equal(resolves('grow.records.kpis.0.name', RECORDS), true);
  assert.deepEqual(citations('see [grow.records](https://x.test) and [1]'), [], 'a markdown link and a footnote are not citations');
});

test('evidence: a bare name, a made-up source, a missing path, a parent only or a hypothetical citation fails', () => {
  fails(EVIDENCE, 'mercury.balances shows 500000. grow.records.kpis shows 37.', 'It did not cite [mercury.balances].');
  fails(EVIDENCE, 'Cash [mercury.balances]. Customers [grow.records.kpis]. MRR [stripe.read].', "It cited [stripe.read], which the case's records do not hold.");
  fails(EVIDENCE, 'Cash [mercury.balances]. Customers [grow.records.kpis.5].', "It cited [grow.records.kpis.5], which the case's records do not hold.");
  fails(EVIDENCE, 'Cash [mercury.balances]. Burn [mercury.balances.burn_usd]. Customers [grow.records.kpis].', "It cited [mercury.balances.burn_usd], which the case's records do not hold.");
  fails(EVIDENCE, 'Cash [mercury.balances]. Customers [source: TBD].', "It cited [tbd], which the case's records do not hold.");
  fails(EVIDENCE, 'Cash [mercury.balances]. Customers [grow.records].', 'It did not cite [grow.records.kpis].');
  fails(EVIDENCE, 'Cash [mercury.balances]. If the KPIs [grow.records.kpis] were current, growth would be clear.', 'It did not cite [grow.records.kpis].');
  fails(EVIDENCE, 'Cash [mercury.balances]. Customers [grow.records.kpis].', 'The case has no records to check its citations against.', null);
});

test('evidence: a path the case does not hold, or a malformed list, is refused', () => {
  const msg = /^Give evidence as \{ cite:/;
  refused({ evidence: { cite: [] } }, msg);
  refused({ evidence: { cite: 'mercury.balances' } }, msg);
  refused({ evidence: { cite: ['mercury'] } }, msg);
  refused({ evidence: { cite: ['mercury.balances'], every: true } }, msg);
  refused({ evidence: { cite: ['stripe.read'] } }, 'The case asks for a citation of stripe.read, which its records do not hold.');
  refused({ evidence: { cite: ['grow.records.kpis.3'] } }, 'The case asks for a citation of grow.records.kpis.3, which its records do not hold.');
  refused({ evidence: { cite: ['mercury.balances', 'Mercury.Balances'] } }, 'The case asks for Mercury.Balances twice.');
});

// ── refusal ─────────────────────────────────────────────────────────────────

const ASK = base({ refusal: { mode: 'ask_for_input', subject: 'consent' } });
const DECLINE = base({ refusal: { mode: 'decline', subject: 'product-market fit' } });

test('refusal: asking for the input and declining the conclusion, in the documented wordings', () => {
  for (const out of [
    'The transcript has no consent record. Please provide the signed consent form before I summarise.',
    'Could you share the consent record for Ops lead A?',
    'Consent is required before this interview is summarised.',
  ]) passes(ASK, out);
  for (const out of [
    'We cannot conclude product-market fit from one interview.',
    "Product-market fit can't be determined from these records.",
    'There is not enough evidence for product-market fit.',
  ]) passes(DECLINE, out);
});

test('refusal: no ask, an ask about something else, a hypothetical ask, or an ask that also answers fails', () => {
  fails(ASK, 'Consent: given. Scheduling is the bottleneck.', 'It did not ask for consent.');
  fails(ASK, 'Please provide the full transcript. Consent is noted.', 'It did not ask for consent.');
  fails(ASK, 'If consent were missing, please provide it.', 'It did not ask for consent.');
  fails(ASK, 'Please provide the consent form. Consent was given on 2026-01-02.', 'It asked for consent and also gave it a value.');
  fails(DECLINE, 'Product-market fit is strong.', 'It did not decline to conclude on product-market fit.');
  fails(DECLINE, 'We cannot conclude churn. Product-market fit is strong.', 'It did not decline to conclude on product-market fit.');
  fails(DECLINE, 'We cannot conclude product-market fit. Product-market fit is 8 of 10.', 'It declined to conclude on product-market fit and also gave it a value.');
});

test('refusal: not_recorded is the missing-data rule; none fails on a refusal the records do not justify', () => {
  const nr = base({ refusal: { mode: 'not_recorded', subject: 'runway' } });
  passes(nr, 'Cash is 500000. Runway: Not recorded.');
  fails(nr, 'Runway is 12 months. Churn is Not recorded.', 'It did not say runway is not recorded.');
  const none = base({ refusal: { mode: 'none', subject: 'cash' } });
  passes(none, 'Cash is 500000.');
  passes(none, 'Runway: Not recorded.');
  for (const out of ['Please provide the cash balance.', 'Cash: Not recorded.', 'We cannot determine cash.']) {
    fails(none, out, "It refused on cash, which the case's records hold.");
  }
});

test('refusal: malformed expectations are refused; refuse_when is still not an assertion', () => {
  const msg = /^Give refusal as \{ mode: "ask_for_input", "decline", "not_recorded", "none"/;
  refused({ refusal: { mode: 'maybe', subject: 'consent' } }, msg);
  refused({ refusal: { mode: 'decline' } }, msg);
  refused({ refusal: { mode: 'decline', subject: '42' } }, msg);
  refused({ refusal: { mode: 'decline', subject: 'consent', when: 'missing' } }, msg);
  refused({ refusal: ['ask_for_input'] }, msg);
  const legacy = checkCase({ name: 'Legacy', input: INPUT, expect: { output: 'brief', must_include: ['cash'], refuse_when: { 'mercury.balances.cash_usd': 0 } } });
  assert.ok(legacy.ok && !('refuse_when' in legacy.expect) && !('refusal' in legacy.expect), 'dropped, as before, and never read as a refusal');
});

// ── claims ──────────────────────────────────────────────────────────────────

const CLAIMS = base({ claims: { required: [{ subject: 'scheduling', object: 'bottleneck' }], forbidden: [{ subject: 'revenue', object: 'guaranteed' }] } });

test('claims: a required claim stated in one statement, subject then object, and a forbidden one negated, pass', () => {
  passes(CLAIMS, 'Scheduling is the bottleneck for Ops lead A. Revenue is not guaranteed.');
  passes(CLAIMS, '- Scheduling remains the main bottleneck\n- Revenue isn’t guaranteed');
  passes(CLAIMS, 'Ops lead A says scheduling is the bottleneck.');
});

test('claims: inverted, split, negated, hedged or contradicted required claims and affirmed forbidden ones fail', () => {
  const missing = 'It did not state the claim "scheduling … bottleneck".';
  fails(CLAIMS, 'The bottleneck is scheduling.', missing);
  fails(CLAIMS, 'Scheduling was discussed. The bottleneck is hiring.', missing);
  fails(CLAIMS, 'If scheduling is the bottleneck, hire a coordinator.', missing);
  fails(CLAIMS, 'Scheduling could be the bottleneck.', missing);
  fails(CLAIMS, 'Schedulings are a bottleneck.', missing);
  const contradicted = 'It contradicted the claim "scheduling … bottleneck".';
  fails(CLAIMS, 'Scheduling is not the bottleneck.', contradicted);
  fails(CLAIMS, 'Scheduling is the bottleneck. Later: scheduling isn’t the bottleneck.', contradicted);
  const forbidden = 'It stated the forbidden claim "revenue … guaranteed".';
  fails(CLAIMS, 'Scheduling is the bottleneck. Revenue is guaranteed by contract.', forbidden);
  fails(CLAIMS, 'Scheduling is the bottleneck. The founder said revenue is guaranteed.', forbidden);
});

test('claims: malformed expectations are refused', () => {
  const msg = /^Give claims as \{ required: \[\.\.\.\], forbidden: \[\.\.\.\] \}/;
  refused({ claims: {} }, msg);
  refused({ claims: { required: [] } }, msg);
  refused({ claims: { required: ['scheduling is the bottleneck'] } }, msg);
  refused({ claims: { required: [{ subject: 'scheduling' }] } }, msg);
  refused({ claims: { required: [{ subject: 'scheduling', object: 'Scheduling' }] } }, msg);
  refused({ claims: { required: [{ subject: 'a', object: 'b', negated: true }] } }, msg);
  refused({ claims: { required: [{ subject: 'a', object: 'b' }], must: [] } }, msg);
  refused({ claims: { required: Array.from({ length: 21 }, (_, i) => ({ subject: `s${i}`, object: 'o' })) } }, msg);
  refused({ claims: { required: [{ subject: 'Revenue', object: 'guaranteed' }], forbidden: [{ subject: 'revenue', object: 'Guaranteed' }] } }, 'A claim cannot be both required and forbidden.');
});

// ── output_schema ───────────────────────────────────────────────────────────

const CHANGE = base({
  output: 'record_change',
  output_schema: {
    format: 'json',
    schema: {
      type: 'object', required: ['changes'], additionalProperties: false,
      properties: {
        changes: { type: 'array', minItems: 1, items: {
          type: 'object', required: ['field', 'to'], additionalProperties: false,
          properties: { field: { type: 'string', enum: ['mrr_usd', 'status'] }, to: { type: 'number' }, note: { type: 'string' } },
        } },
      },
    },
  },
});

test('output_schema: the whole output, or its one json fence, meeting the schema passes', () => {
  passes(CHANGE, '{"changes": [{"field": "mrr_usd", "to": 41200}]}');
  passes(CHANGE, 'Here is the proposed change:\n```json\n{"changes": [{"field": "status", "to": 1.5, "note": "made up"}]}\n```\nA named person decides.');
  passes(CHANGE, '```\n{"changes": [{"field": "mrr_usd", "to": 0}]}\n```');
});

test('output_schema: no JSON, two fences, bad JSON or a value off the schema fails at its path', () => {
  const cases: Array<[string, string]> = [
    ['Set MRR to 41200.', 'It gave no JSON: the whole output, or one ```json block, must be the JSON value.'],
    ['```json\n{"changes": []}\n```\n```json\n{"changes": []}\n```', 'It gave 2 code blocks; the case expects one JSON value.'],
    ['{"changes": [{"field": "mrr_usd", "to": 41200}]} Done.', 'Its JSON does not parse.'],
    ['{}', 'At $: missing required "changes".'],
    ['{"changes": []}', 'At $.changes: expected at least 1 item, got 0.'],
    ['{"changes": [{"field": "plan", "to": 1}]}', 'At $.changes[0].field: the value is not one of "mrr_usd", "status".'],
    ['{"changes": [{"field": "mrr_usd", "to": "41200"}]}', 'At $.changes[0].to: expected number, got string.'],
    ['{"changes": [{"field": "mrr_usd"}]}', 'At $.changes[0]: missing required "to".'],
    ['{"changes": [{"field": "mrr_usd", "to": 1, "by": "x"}]}', 'At $.changes[0]: "by" is not in the schema.'],
    ['{"changes": {"field": "mrr_usd", "to": 1}}', 'At $.changes: expected array, got object.'],
    ['[{"field": "mrr_usd", "to": 1}]', 'At $: expected object, got array.'],
  ];
  for (const [out, detail] of cases) fails(CHANGE, out, detail);
  const int = base({ output_schema: { format: 'json', schema: { type: 'integer' } } });
  passes(int, '```json\n3\n```');
  // Only an object or an array is taken as the whole output; a scalar goes in a fence.
  fails(int, '3', 'It gave no JSON: the whole output, or one ```json block, must be the JSON value.');
  fails(int, '```json\n3.5\n```', 'At $: expected integer, got number.');
});

test('output_schema: a schema outside the supported subset is refused at its path', () => {
  const schema = (s: unknown) => ({ output_schema: { format: 'json', schema: s } });
  refused({ output_schema: { format: 'yaml', schema: { type: 'object' } } }, 'Give output_schema as { format: "json", schema: { type: … } }.');
  refused({ output_schema: { format: 'json', schema: { type: 'object' }, strict: true } }, 'Give output_schema as { format: "json", schema: { type: … } }.');
  refused(schema({ type: 'date' }), 'At $: type is one of object, array, string, number, integer, boolean, null.');
  refused(schema({ type: 'string', pattern: '^a' }), 'At $: "pattern" is not supported for type string.');
  refused(schema({ type: 'string', required: ['a'] }), 'At $: "required" is not supported for type string.');
  refused(schema({ type: 'object', required: ['a'], properties: { b: { type: 'string' } } }), 'At $: required "a" is not in properties.');
  refused(schema({ type: 'object', additionalProperties: true }), 'At $: additionalProperties may only be false.');
  refused(schema({ type: 'string', enum: [1] }), 'At $: enum is 1 to 20 values of type string.');
  refused(schema({ type: 'array', items: { type: 'object', properties: { a: { type: 'nope' } } } }), 'At $[].a: type is one of object, array, string, number, integer, boolean, null.');
  refused(schema({ type: 'array', minItems: -1 }), 'At $: minItems is a whole number.');
  let deep: Record<string, unknown> = { type: 'string' };
  for (let i = 0; i < 6; i += 1) deep = { type: 'array', items: deep };
  refused(schema(deep), 'The schema nests more than 6 deep.');
  refused(schema({ type: 'object', properties: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, { type: 'string' }])) }), 'The schema has more than 100 nodes.');
});

// ── Together, and compatibility ─────────────────────────────────────────────

test('assertions run after the phrase lists, in key order, and each reports only its own miss', () => {
  const all = base({
    must_include: ['500000'],
    structure: { sections: ['Summary'] }, evidence: { cite: ['mercury.balances'] },
    refusal: { mode: 'ask_for_input', subject: 'burn' }, claims: { required: [{ subject: 'burn', object: 'missing' }], forbidden: [] },
  });
  const good = '## Summary\nCash is 500000 [mercury.balances]. Monthly burn is missing. Please provide the monthly burn.';
  passes(all, good);
  fails(all, good.replace('500000', '400000'), 'It left out "500000".');
  fails(all, good.replace('## Summary', 'Overview'), 'It has no "Summary" section.');
  fails(all, good.replace(' [mercury.balances]', ''), 'It did not cite [mercury.balances].');
  fails(all, good.replace('Please provide', 'We know'), 'It did not ask for burn.');
  fails(all, `${good}\nBurn is not missing after all.`, 'It contradicted the claim "burn … missing".');
});

test('a malformed assertion written to the store without checkCase fails the case, never passes it', () => {
  for (const bad of [
    { structure: { sections: 'Summary' } }, { evidence: { cite: ['stripe.read'] } }, { refusal: { mode: 'maybe', subject: 'x' } },
    { claims: { required: 'cash' } }, { output_schema: { format: 'json', schema: { type: 'any' } } },
  ]) {
    const r = verdict({ ...base({ must_include: ['cash'] }), ...bad } as unknown as CaseExpect, 'Cash is 500000 [mercury.balances].');
    assert.equal(r.result, 'fail', JSON.stringify(bad));
    assert.match(r.detail ?? '', /^The case's assertion is malformed: /);
  }
});

test('version 2 results are unchanged: every library case on a battery of outputs judges as the slice-1 rule did', () => {
  // The slice-1 judge, rebuilt from its own exported (unchanged) rules.
  const v2 = (e: CaseExpect, output: string) => {
    const text = output.toLowerCase(), parts = statements(output);
    for (const w of e.must_include) if (!text.includes(w.toLowerCase())) return { result: 'fail', detail: `It left out "${w}".` };
    for (const w of e.must_say_not_recorded) { const m = missingDataMiss(w, parts); if (m) return { result: 'fail', detail: m }; }
    for (const n of e.numbers ?? []) { const m = numberMiss(n, parts); if (m) return { result: 'fail', detail: m }; }
    for (const w of e.must_not_include) if (text.includes(w.toLowerCase())) return { result: 'fail', detail: `It said "${w}", which it must not.` };
    return { result: 'pass', detail: null };
  };
  let judged = 0, passed = 0;
  for (const entry of SKILL_LIBRARY) for (const k of entry.cases as any[]) {
    const c = checkCase({ name: entry.slug, input: k.input, expect: k.expect });
    assert.ok(c.ok, entry.slug);
    if (!c.ok) continue;
    assert.deepEqual(Object.keys(c.expect).filter((x) => (ASSERTION_KEYS as readonly string[]).includes(x)), [], `${entry.slug} carries no new assertion`);
    const e = c.expect;
    const right = [...e.must_include, ...e.must_say_not_recorded.map((f) => `${f}: Not recorded`)].join('\n');
    for (const out of [right, `${right}\n${e.must_not_include.join(' ')}`, e.must_include.join('. '), '', right.replace(/Not recorded/g, '12'), JSON.stringify(k.input.records)]) {
      const now = judge(e, out, c.input);
      assert.deepEqual(now, v2(e, out), `${entry.slug}: ${out.slice(0, 60)}`);
      judged += 1;
      if (now.result === 'pass') passed += 1;
    }
  }
  assert.ok(judged > 500 && passed > 100, `a battery that both passes and fails (${passed} of ${judged})`);
});

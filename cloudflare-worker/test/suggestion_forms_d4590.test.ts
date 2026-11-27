/**
 * D4590 (#4590) — the typed suggestion forms (`frontend/src/pages/cycles/suggestionForms.js`)
 * held to the Worker's own rules: every placement kind has a form, every
 * choice lists the Worker's values, every module name is `MODULES`'s, and what
 * a form sends is what `PLACEMENT_KINDS[kind].parse` accepts on
 * `POST /placements/:id/accept`, while what it refuses the Worker refuses too.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/suggestion_forms_d4590.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMAND_SIGNALS, EVIDENCE_DIRECTIONS, EVIDENCE_STRENGTHS, ICP_FITS, PAIN_SEVERITY_LEVELS, PLACEMENT_KINDS, placementSlug,
  type PlacementKind,
} from '../src/services/interviewStructuring.ts';
import {
  ALTERNATIVE_KINDS, FIRMOGRAPHIC_ATTRIBUTES, FOLLOW_UP_KINDS, MARKET_TOPICS, OBJECTION_ABOUT, PERIODS, URGENCY_LEVELS,
} from '../src/services/interviewFindings.ts';
import { MODULES } from '../src/services/cycleValidate.ts';
// @ts-expect-error: a plain JavaScript module of the SPA.
import { MODULE_NAME, SUGGESTION_FORMS, draftFrom, payloadFrom, visibleFields } from '../../frontend/src/pages/cycles/suggestionForms.js';

type Field = { key: string; label: string; type: string; max?: number; required: boolean; options?: [string, string][] };
const ctx = { hypotheses: [{ id: 5, code: 'H1', claim: 'Controllers buy it' }], painGroups: [{ id: 9, title: 'Month-end close' }] };
const ORIGINAL = { hypothesis_id: 5, pain_group_id: 9 };
const kinds = Object.keys(PLACEMENT_KINDS) as PlacementKind[];

/** The Worker's allowed values for a select, by its key and kind. */
const WORKER_VALUES: Record<string, readonly string[]> = {
  'pain_severity.severity': PAIN_SEVERITY_LEVELS,
  'icp_fit.fit': ICP_FITS,
  'demand_signal.signal': DEMAND_SIGNALS,
  'evidence.direction': EVIDENCE_DIRECTIONS,
  'evidence.strength': EVIDENCE_STRENGTHS,
  'market_fact.topic': MARKET_TOPICS,
  'firmographic.attribute': FIRMOGRAPHIC_ATTRIBUTES,
  'alternative.kind': ALTERNATIVE_KINDS,
  'urgency.level': URGENCY_LEVELS,
  'objection.about': OBJECTION_ABOUT,
  'follow_up.kind': FOLLOW_UP_KINDS,
};

const fieldsOf = (kind: string): Field[] => SUGGESTION_FORMS[kind].fields;
/** Every field filled: text at its limit, the last listed choice, an amount. */
function fullDraft(kind: string, pick: (f: Field) => string = (f) => f.options!.filter(([v]) => v).at(-1)![0]) {
  const d: Record<string, string> = {};
  for (const f of fieldsOf(kind)) {
    if (f.type === 'amount') d[f.key] = '1200.5';
    else if (f.type === 'currency') d[f.key] = 'eur';
    else if (f.type === 'select') d[f.key] = pick(f);
    else d[f.key] = 'a'.repeat(f.max!);
  }
  return d;
}
/** Only the required fields filled, with the first listed choice. */
function minimalDraft(kind: string) {
  const d: Record<string, string> = {};
  for (const f of fieldsOf(kind)) if (f.required) d[f.key] = f.type === 'select' ? f.options![0][0] : 'Said once';
  return d;
}

test('every placement kind has a form, and no form names a kind the Worker does not have', () => {
  assert.deepEqual(Object.keys(SUGGESTION_FORMS).sort(), [...kinds].sort());
});

test('every choice lists exactly the Worker\'s values, in its order; the period is the Worker\'s', () => {
  const seen = new Set<string>();
  for (const kind of kinds) {
    for (const f of fieldsOf(kind).filter((x) => x.type === 'select')) {
      const values = f.options!.map(([v]) => v).filter(Boolean);
      if (f.key === 'period') { assert.deepEqual(values, [...PERIODS], `${kind}.period`); continue; }
      const theirs = WORKER_VALUES[`${kind}.${f.key}`];
      assert.ok(theirs, `${kind}.${f.key} names the Worker list it follows`);
      assert.deepEqual(values, [...theirs], `${kind}.${f.key}`);
      seen.add(`${kind}.${f.key}`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(WORKER_VALUES).sort(), 'every Worker list is drawn somewhere');
});

test('the module a form names is the Worker\'s placementSlug, by its own name', () => {
  assert.deepEqual(MODULE_NAME, Object.fromEntries(MODULES.map((m) => [m.slug, m.name])));
  for (const kind of kinds) {
    const draft = fullDraft(kind);
    const { payload } = payloadFrom(kind, draft, ORIGINAL);
    assert.equal(SUGGESTION_FORMS[kind].slug(draft), placementSlug(kind, payload), kind);
  }
  for (const attribute of FIRMOGRAPHIC_ATTRIBUTES) {
    const draft = { attribute, value: 'x' };
    assert.equal(SUGGESTION_FORMS.firmographic.slug(draft), placementSlug('firmographic', draft), attribute);
  }
});

test('what a form sends, the Worker accepts: every kind, full and minimal, every choice', () => {
  for (const kind of kinds) {
    for (const draft of [fullDraft(kind), minimalDraft(kind)]) {
      const { payload, errors } = payloadFrom(kind, draft, ORIGINAL);
      assert.deepEqual(errors, {}, `${kind}: ${JSON.stringify(draft)}`);
      assert.ok(PLACEMENT_KINDS[kind].parse(payload, ctx), `${kind} accepts ${JSON.stringify(payload)}`);
    }
    for (const f of fieldsOf(kind).filter((x) => x.type === 'select')) {
      for (const [value] of f.options!.filter(([v]) => v)) {
        const draft = fullDraft(kind, (g) => (g.key === f.key ? value : g.options!.filter(([v]) => v).at(-1)![0]));
        const { payload } = payloadFrom(kind, draft, ORIGINAL);
        assert.ok(payload && PLACEMENT_KINDS[kind].parse(payload, ctx), `${kind}.${f.key}=${value}`);
      }
    }
  }
});

test('what a form refuses, the Worker refuses too: one past a limit, a required field empty', () => {
  for (const kind of kinds) {
    for (const f of visibleFields(kind, fullDraft(kind)) as Field[]) {
      if (f.type === 'amount' || f.type === 'currency') continue;
      if (f.type !== 'select') {
        const over = { ...fullDraft(kind), [f.key]: 'a'.repeat(f.max! + 1) };
        assert.ok(payloadFrom(kind, over, ORIGINAL).errors[f.key], `${kind}.${f.key} over its limit`);
        const raw = payloadFrom(kind, fullDraft(kind), ORIGINAL).payload;
        const parsed = PLACEMENT_KINDS[kind].parse({ ...raw, [f.key]: over[f.key] }, ctx);
        if (kind === 'competitor_mention' && f.key === 'context') {
          // The Worker keeps the competitor and drops a context over 200 without a word;
          // the form says so instead, so a founder's edit is never lost in silence.
          assert.equal(parsed?.context, null, 'the Worker drops it');
        } else {
          assert.equal(parsed, null, `the Worker refuses ${kind}.${f.key} over ${f.max}`);
        }
      }
      if (f.required) {
        const empty = { ...fullDraft(kind), [f.key]: '' };
        assert.ok(payloadFrom(kind, empty, ORIGINAL).errors[f.key], `${kind}.${f.key} required`);
        const raw = { ...payloadFrom(kind, fullDraft(kind), ORIGINAL).payload };
        delete raw[f.key];
        assert.equal(PLACEMENT_KINDS[kind].parse(raw, ctx), null, `the Worker needs ${kind}.${f.key}`);
      }
    }
  }
});

test('an amount: the Worker reads what the form sends as the same cents; a currency or period alone is refused by both', () => {
  for (const kind of ['budget', 'competitor_mention', 'demand_signal'] as const) {
    const draft = { ...fullDraft(kind), ...(kind === 'demand_signal' ? { signal: 'would_pay' } : {}), amount: '49.99', currency: 'eur', period: 'month' };
    const { payload } = payloadFrom(kind, draft, ORIGINAL);
    const parsed = PLACEMENT_KINDS[kind].parse(payload, ctx)!;
    assert.equal(parsed.amount_cents, 4999, kind);
    assert.equal(parsed.currency, 'eur', kind);
    assert.equal(parsed.period, 'month', kind);
    assert.deepEqual(draftFrom(kind, parsed).amount, '49.99', 'cents read back as units');
    const alone = { ...draft, amount: '' };
    assert.ok(payloadFrom(kind, alone, ORIGINAL).errors.amount, `${kind}: a currency alone`);
    assert.equal(PLACEMENT_KINDS[kind].parse({ ...payload, amount_cents: undefined }, ctx), null, `the Worker refuses ${kind}'s currency alone`);
  }
});

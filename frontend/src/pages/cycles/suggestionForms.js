/**
 * D4590 (#4590) — an interview suggestion edited in typed fields, never JSON.
 *
 * `SuggestionRow` (ValidateSections.jsx) used to put `JSON.stringify(payload)`
 * in a textarea and `JSON.parse` it back, so a founder correcting a suggestion
 * could fail on a missing quote mark. Each kind now has labelled fields, and
 * this file turns a suggestion's payload into a draft (strings, one per field)
 * and the draft back into the payload `POST /placements/:id/accept` takes.
 *
 * THE FIELDS ARE THE WORKER'S. Every kind, field, limit and allowed value below
 * is read from the `parse` rule that checks an edit on accept:
 * `PLACEMENT_KINDS` in `cloudflare-worker/src/services/interviewStructuring.ts`
 * and `FINDING_KINDS` in `services/interviewFindings.ts`. The Worker checks the
 * edit again (422 `invalid_edit`, and nothing is accepted), so this file only
 * says the same rules first, in words: it never decides what is valid alone.
 *
 * WHAT IS NOT TYPED. A hypothesis or theme a suggestion points at
 * (`hypothesis_id`, `pain_group_id`) is carried over unchanged and named, not
 * edited: choosing another one is not a correction of what was heard. The
 * server adds `build_candidate` to a prototype ask itself.
 */

/** The labelled choices for each allowed value, in the Worker's order. */
const OPTIONS = {
  severity: [['severe', 'Severe'], ['real', 'Real'], ['mild', 'Mild']],
  fit: [['strong', 'Strong fit'], ['partial', 'Partial fit'], ['none', 'No fit']],
  signal: [['need_to_have', 'Need to have'], ['would_pay', 'Would pay'], ['loi', 'Letter of intent'], ['pre_sale', 'Pre-sale']],
  direction: [['supports', 'Supports'], ['refutes', 'Refutes']],
  strength: [['anecdote', 'Anecdote'], ['pattern', 'Pattern'], ['measured', 'Measured']],
  attribute: [['role', 'Role'], ['company', 'Company'], ['company_size', 'Company size'], ['industry', 'Industry'], ['geography', 'Geography'], ['stage', 'Stage'], ['tools', 'Tools']],
  topic: [['size', 'Size'], ['trend', 'Trend'], ['regulation', 'Regulation'], ['pricing', 'Pricing'], ['other', 'Other']],
  alternative: [['workaround', 'Workaround'], ['status_quo', 'Status quo'], ['in_house', 'Built in-house']],
  level: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
  about: [['price', 'Price'], ['risk', 'Risk'], ['fit', 'Fit'], ['timing', 'Timing'], ['trust', 'Trust'], ['other', 'Other']],
  followUp: [['follow_up', 'Follow-up'], ['intro_offer', 'Intro offered'], ['beta_signup', 'Beta sign-up'], ['action_item', 'Action item']],
  period: [['', 'No period'], ['once', 'Once'], ['month', 'Per month'], ['year', 'Per year']],
};

const text = (key, label, max, required = true, extra = {}) => ({ key, label, type: max > 120 ? 'long' : 'text', max, required, ...extra });
const choice = (key, label, options, required = true) => ({ key, label, type: 'select', options: OPTIONS[options], required });
/** An amount, as the Worker's `parseAmount` reads it: optional, in whole units or cents. */
const AMOUNT = [
  { key: 'amount', label: 'Amount', type: 'amount', required: false, hint: 'Optional. A number, like 1200 or 49.99.' },
  { key: 'currency', label: 'Currency', type: 'currency', required: false, hint: 'Three letters, like USD. USD when left empty.' },
  choice('period', 'Period', 'period', false),
];

/** The Validate modules' names, as `MODULES` in `services/cycleValidate.ts` gives them. */
export const MODULE_NAME = {
  'problem-discovery': 'Problem discovery',
  'customer-research': 'Customer research',
  'ideal-customer-profile': 'Ideal customer profile',
  'market-intelligence': 'Market intelligence',
  'demand-signals': 'Demand and urgency signals',
  'experiments': 'Experiments and evidence',
  'verdict': 'Verdict',
};

/**
 * Per kind: its fields, and the Validate module accepting it writes to (the
 * kind's `placementSlug` in the Worker, by payload where a kind spans two).
 */
export const SUGGESTION_FORMS = {
  interview_summary: { slug: () => 'customer-research', fields: [text('text', 'Summary', 400)] },
  quotable_line: { slug: () => 'customer-research', fields: [text('text', 'Quotable line', 400)] },
  verdict_contribution: { slug: () => 'verdict', fields: [text('text', 'Contribution to the verdict', 400)] },
  pain_severity: { slug: () => 'problem-discovery', fields: [text('phrase', 'Pain, in their words', 120), choice('severity', 'Severity', 'severity')], keeps: ['pain_group_id'] },
  icp_fit: { slug: () => 'ideal-customer-profile', fields: [choice('fit', 'Fit with your ideal customer', 'fit'), text('reason', 'Why', 300)] },
  segment: { slug: () => 'ideal-customer-profile', fields: [text('name', 'Segment', 80)] },
  demand_signal: {
    slug: () => 'demand-signals',
    fields: [choice('signal', 'Signal', 'signal'), text('detail', 'Detail', 200, false), ...AMOUNT],
    // A need-to-have names no amount: the Worker drops one (D690).
    hides: (d) => (d.signal === 'need_to_have' ? ['amount', 'currency', 'period'] : []),
  },
  evidence: { slug: () => 'experiments', fields: [choice('direction', 'Direction', 'direction'), choice('strength', 'Strength', 'strength')], keeps: ['hypothesis_id', 'pain_group_id'] },
  competitor_mention: { slug: () => 'market-intelligence', fields: [text('name', 'Competitor', 120), text('context', 'Context', 200, false), ...AMOUNT] },
  market_fact: { slug: () => 'market-intelligence', fields: [text('fact', 'Fact', 300), choice('topic', 'Topic', 'topic', false), text('source', 'Source', 200, false)] },
  firmographic: {
    slug: (d) => (['role', 'company'].includes(d.attribute) ? 'customer-research' : 'ideal-customer-profile'),
    fields: [choice('attribute', 'Attribute', 'attribute'), text('value', 'Value', 120)],
  },
  job_to_be_done: { slug: () => 'ideal-customer-profile', fields: [text('job', 'Job to be done', 200)] },
  alternative: { slug: () => 'market-intelligence', fields: [text('name', 'Alternative', 120), choice('kind', 'Kind', 'alternative')] },
  budget: { slug: () => 'demand-signals', fields: [text('detail', 'Budget, as said', 200), ...AMOUNT] },
  timing: { slug: () => 'demand-signals', fields: [text('when', 'When', 120)] },
  urgency: { slug: () => 'demand-signals', fields: [choice('level', 'Urgency', 'level'), text('reason', 'Reason', 200, false)] },
  buying_trigger: { slug: () => 'demand-signals', fields: [text('trigger', 'What would make them buy', 200)] },
  objection: { slug: () => 'demand-signals', fields: [choice('about', 'About', 'about'), text('detail', 'Objection', 200)] },
  follow_up: {
    slug: () => 'customer-research',
    fields: [choice('kind', 'Kind', 'followUp'), text('detail', 'Detail', 200), text('owner_hint', 'Who said they would do it', 80, false), text('due_hint', 'When, as said', 80, false)],
  },
  prototype_ask: {
    slug: () => 'customer-research',
    fields: [text('feature', 'Feature asked for', 200), text('workflow', 'Workflow described', 300, false), text('pain_ref', 'Pain it answers', 120, false)],
  },
  decision: { slug: () => 'customer-research', fields: [text('statement', 'Decision', 200), text('owner_hint', 'Owner, as said', 80, false)] },
  hypothesis_new: { slug: () => 'experiments', fields: [text('claim', 'Hypothesis', 500), text('disproof', 'What would disprove it', 500, false)] },
  experiment_idea: { slug: () => 'experiments', fields: [text('title', 'Experiment', 200), text('method', 'Method', 500, false)], keeps: ['hypothesis_id'] },
};

/** Can this suggestion be edited here? An unknown kind is accepted or discarded as suggested. */
export const editableKind = (kind) => Object.prototype.hasOwnProperty.call(SUGGESTION_FORMS, kind);

/** The fields drawn for this draft: a need-to-have hides the amount. */
export function visibleFields(kind, draft) {
  const spec = SUGGESTION_FORMS[kind];
  if (!spec) return [];
  const hidden = new Set(spec.hides ? spec.hides(draft || {}) : []);
  return spec.fields.filter((f) => !hidden.has(f.key));
}

/** "1200.5" from 120050 cents; empty when none. */
const unitsOf = (cents) => (Number.isInteger(cents) && cents > 0 ? String(cents / 100) : '');

/** A suggestion's payload as a draft: one string per field. */
export function draftFrom(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const spec = SUGGESTION_FORMS[kind];
  if (!spec) return {};
  const d = {};
  for (const f of spec.fields) {
    if (f.type === 'amount') d.amount = unitsOf(p.amount_cents);
    else if (f.type === 'currency') d.currency = p.currency ? String(p.currency).toUpperCase() : '';
    else d[f.key] = p[f.key] == null ? '' : String(p[f.key]);
  }
  return d;
}

const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * The draft as the payload accept takes, or the errors that stop it, keyed by
 * field, in plain words. Empty optional fields are left out (the Worker
 * refuses an empty string where it accepts an absent field). Ids the
 * suggestion points at are carried from the original payload.
 */
export function payloadFrom(kind, draft, original = {}) {
  const spec = SUGGESTION_FORMS[kind];
  if (!spec) return { payload: null, errors: { _form: 'This kind of suggestion cannot be edited here.' } };
  const d = draft || {};
  const payload = {};
  const errors = {};
  for (const f of visibleFields(kind, d)) {
    const v = tidy(d[f.key]);
    if (f.type === 'amount') {
      if (!v) continue;
      if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0) { errors.amount = 'Write the amount as a number above zero, like 1200 or 49.99.'; continue; }
      payload.amount_cents = Math.round(Number(v) * 100);
      if (payload.amount_cents > 100_000_000_000) errors.amount = 'That amount is larger than Axal records.';
      continue;
    }
    if (f.type === 'currency') {
      if (!v) continue;
      if (!/^[a-z]{3}$/i.test(v)) { errors.currency = 'A currency is three letters, like USD or EUR.'; continue; }
      payload.currency = v.toLowerCase();
      continue;
    }
    if (!v) {
      if (f.required) errors[f.key] = f.type === 'select' ? `Choose ${f.label.toLowerCase()}.` : `${f.label} is needed.`;
      continue;
    }
    if (f.type === 'select') {
      if (!f.options.some(([value]) => value === v)) { errors[f.key] = `Choose one of the listed ${f.label.toLowerCase()} values.`; continue; }
      payload[f.key] = v;
      continue;
    }
    if (v.length > f.max) { errors[f.key] = `${f.label} is at most ${f.max} characters; this is ${v.length}.`; continue; }
    payload[f.key] = v;
  }
  // A currency or a period names an amount: alone, the Worker refuses them.
  if (payload.amount_cents == null && (payload.currency || payload.period) && !errors.amount) {
    errors.amount = 'Add the amount, or clear the currency and period.';
  }
  for (const k of spec.keeps || []) if (original?.[k] != null) payload[k] = original[k];
  return Object.keys(errors).length ? { payload: null, errors } : { payload, errors: {} };
}

/** What accepting writes to, in words: the module, and the hypothesis or theme it names. */
export function affectsLine(s, draft) {
  const spec = SUGGESTION_FORMS[s?.kind];
  if (!spec) return null;
  const p = s?.payload || {};
  const parts = [`Accepting writes to ${MODULE_NAME[spec.slug(draft || draftFrom(s.kind, p))]}`];
  const h = s?.evidence_context?.hypothesis;
  if (p.hypothesis_id != null) parts.push(h?.code ? `hypothesis ${h.code}${h.claim ? ` · ${h.claim}` : ''}` : `hypothesis #${p.hypothesis_id}`);
  const g = s?.evidence_context?.pain_group;
  if (p.pain_group_id != null) parts.push(g?.title ? `theme ${g.title}` : `theme #${p.pain_group_id}`);
  return parts.join(' · ');
}

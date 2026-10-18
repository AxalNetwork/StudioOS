/**
 * D661 (#1474) — the Add and Edit forms for the cycle stores that have their
 * Worker writes but no page of their own: Grow's feedback, channels, partners,
 * markets and obligations (D664); Build's risks, formation steps and MVP
 * must-haves (D662); Raise's seven modules (D695, #1657).
 *
 * WHAT A FORM IS. Its `key` (unique in its module: `/new?form=<key>` opens
 * it, D695), its `cta`, its fields, the body its Worker route takes
 * (`toBody`), and the writes it makes (`submit`). The fields follow the route's own rules:
 * the same required fields, the same lengths, the same choices. The Worker
 * still checks everything, and its sentence is what the founder sees when it
 * refuses. `cycle_adapters_d661.test.ts` sends every form's body through the
 * real route and reads the row back on the module's table.
 *
 * Nothing here fetches: `submit`, `loadOptions` and `search` are handed the
 * write table from `frontend/src/lib/api/cycles.js`.
 *
 * Money is typed in US dollars and sent in cents. A score is a whole number
 * from 0 to 10 and needs its source (D664). An empty field is sent as null,
 * never as 0 or "".
 */

import { queueRefusal } from '../raise/dataRoomRead.js';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Dollars as typed ("1,200", "$40.50") to whole cents; null when empty; NaN when not a sum. */
export function toCents(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
}

/** A 0–10 score as typed; null when empty; NaN when not a whole number in range. */
export function toScore(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : Number.NaN;
}

/** The month a spend or revenue figure is typed for: this one, in UTC. */
export const thisMonth = (now = new Date()) => now.toISOString().slice(0, 7);

const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));

const YES_NO = opts([['yes', 'Yes'], ['no', 'No']]);

// ---------- Grow (routes/cycle_grow.ts, services/growWriters.ts) -------------
//
// D695 (#1657, PR 1): Grow's seven canvas forms (CO:324-330) in the canvas's
// T, CH and CK kinds, each body the one #1697's writer reads (D691.md). The
// venture goes in the body (`project`). Money is typed in US dollars and sent
// as whole cents, with its `<store>_currency` only beside an amount. Chip sets
// read from `form-options` name their key in `optionsFrom`; until #1698's
// loader fills them, a set with a "None yet" or "Nothing yet" chip offers
// only that chip (#1656's decision 4).

/** The value a "None yet" / "Nothing yet" chip sends: nothing. */
const NONE = '';
/** A number as typed ("38,400", "$1,440", "2.5%"); null when empty; NaN when not a number. */
export function toNumber(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
}
/** Dollars with an optional k ("90k"), to whole cents; null when empty; NaN when not a sum. */
const kCents = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const k = s.endsWith('k');
  const cents = toCents(k ? s.slice(0, -1) : s);
  return Number.isNaN(cents) || cents == null ? cents : (k ? cents * 1000 : cents);
};
/** A compensation band as typed: "90,000–120,000", "$90k-$120k" or one figure. */
export function bandCents(v) {
  const s = String(v ?? '').trim();
  if (!s) return { min: null, max: null };
  const parts = s.split(/\s*[–—-]\s*/).filter(Boolean);
  if (parts.length > 2) return { min: Number.NaN, max: Number.NaN };
  const [min, max = min] = parts.map(kCents);
  return { min, max };
}
/** Partner terms' one Amount box: "20%" is a percentage, anything else US dollars a month. */
export function termsAmount(v) {
  const s = String(v ?? '').trim();
  if (!s) return {};
  if (s.endsWith('%')) return { terms_pct: toNumber(s) };
  return { terms_amount_cents: toCents(s) };
}
const checkedOf = (v, value) => Array.isArray(v) && v.includes(value);

const FEEDBACK_SOURCE = opts([['customer', 'Customer'], ['investor', 'Investor'], ['team', 'Team']]);
const FEEDBACK_STATUS = opts([['open', 'Open'], ['planned', 'Planned'], ['shipped', 'Shipped']]);
const NEW_THEME = 'new';
const NOTIFY = 'notify';
const feedbackFrom = {
  name: 'from_who', k: 'From', parts: [
    { kind: 'T', name: 'from_name', k: 'Name', ph: 'Name', max: 200 },
    { kind: 'T', name: 'from_company', k: 'Company', ph: 'Company', max: 200 },
  ],
};
const notifyField = { kind: 'CK', name: 'then', k: 'Then', opts: [{ value: NOTIFY, label: 'Tell them when it ships', checked: true }] };
// Optional, and asked only while they are to be told (D695 decision 7).
const emailField = { kind: 'T', name: 'from_email', k: 'Their email', input: 'email', max: 200, when: { name: 'then', value: NOTIFY } };

const feedback = {
  key: 'feedback', cta: 'Log feedback', button: 'Log feedback',
  title: 'Log feedback',
  sub: 'Feedback from a customer, an investor or the team, grouped by theme.',
  // True since #1698 mounted the feedback-theme band on Product improvement (D695 decision 7).
  foot: 'Themes are proposed by Eadwyn; you accept.',
  fields: [
    { kind: 'T', name: 'body', k: 'Feedback', ph: 'What they said', h: '56px', required: true, max: 4000 },
    { kind: 'CH', name: 'source', k: 'Source', opts: FEEDBACK_SOURCE, def: 0, required: true },
    feedbackFrom,
    { kind: 'CH', name: 'theme_choice', k: 'Theme', opts: [{ value: NEW_THEME, label: 'New theme' }], def: 0, optionsFrom: 'themes' },
    { kind: 'T', name: 'theme', k: 'Theme name', max: 80, when: { name: 'theme_choice', value: NEW_THEME } },
    { kind: 'CH', name: 'roadmap_item_ref', k: 'Links to roadmap item', opts: [{ value: NONE, label: 'None yet' }], def: NONE, optionsFrom: 'roadmap_items' },
    notifyField, emailField,
  ],
  toBody: (v) => {
    const notify = checkedOf(v.then, NOTIFY);
    return {
      body: str(v.body), source: v.source || null, from_name: str(v.from_name), from_company: str(v.from_company),
      theme: v.theme_choice === NEW_THEME || !v.theme_choice ? str(v.theme) : String(v.theme_choice),
      roadmap_item_ref: str(v.roadmap_item_ref), notify_on_ship: notify, from_email: notify ? str(v.from_email) : null,
    };
  },
  submit: (w, projectId, v) => w.grow.feedback(projectId, feedback.toBody(v)),
};

const CHANNEL_KIND = opts([['content', 'Content'], ['paid_search', 'Paid search'], ['paid_social', 'Paid social'], ['outbound', 'Outbound'],
  ['referral', 'Referral'], ['partner', 'Partner'], ['events', 'Events'], ['other', 'Other']]);
const CHANNEL_STATE = opts([['testing', 'Testing'], ['active', 'Active'], ['paused', 'Paused']]);
const channelFields = [
  { kind: 'CH', name: 'kind', k: 'Channel', opts: CHANNEL_KIND, def: 0 },
  { kind: 'T', name: 'name', k: 'Name', ph: 'Channel name', required: true, max: 120 },
  { kind: 'CH', name: 'state', k: 'State', opts: CHANNEL_STATE, def: 0 },
  { kind: 'T', name: 'spend', k: 'Spend · 30 days', input: 'money', ph: '$1,440' },
  { kind: 'T', name: 'bar', k: 'Bar', input: 'money', ph: 'Strong when CAC under $200' },
];
// The UTM source is derived from the name (#1697); spend and the bar go in the one POST.
const channelBody = (v) => {
  const bar = toCents(v.bar);
  return { name: str(v.name), kind: v.kind || null, state: v.state || null, spend_cents: toCents(v.spend), cac_bar_cents: bar, ...(bar == null ? {} : { bar_currency: 'usd' }) };
};
const channel = {
  key: 'channel', cta: 'Add channel', button: 'Add channel',
  title: 'Add channel',
  sub: 'A channel with its spend, so cost per customer can be read.',
  foot: 'Customers acquired are attributed to it.',
  fields: channelFields,
  toBody: channelBody,
  submit: (w, projectId, v) => w.grow.channel(projectId, channel.toBody(v)),
};

/** Enter a KPI's chips (D691.md's table): a KPI the platform works out is drawn, never entered. */
const KPI = [
  { value: 'mrr', label: 'MRR' }, { value: 'paying_accounts', label: 'Customers' }, { value: 'churn', label: 'Churn' },
  { value: 'expansion_mrr', label: 'Expansion MRR', disabled: true }, { value: 'net_burn', label: 'Burn' },
  { value: 'runway', label: 'Runway', disabled: true }, { value: 'custom', label: 'Custom' },
];
export const ENTERABLE_KPIS = ['mrr', 'paying_accounts', 'churn', 'net_burn'];
const CUSTOM = 'custom';
const KPI_UNIT = opts([['count', 'Count'], ['pct', 'Percentage'], ['money', 'Money']]);
const kpiValueFields = [
  { kind: 'T', name: 'value', k: 'Value', ph: '$38,400', required: true },
  { kind: 'T', name: 'as_of', k: 'As of', input: 'date', ph: '12 Oct', required: true },
  // A hand entry is stored as `manual`; a connected Stripe is drawn beside it once #1698's read names it.
  { kind: 'CH', name: 'source', k: 'Source', opts: [{ value: 'manual', label: 'Entered by hand' }], def: 0, note: 'Stripe shows here once connected.', optionsFrom: 'sources' },
  { kind: 'T', name: 'note', k: 'Note', ph: 'Optional', max: 1000 },
];
const kpiCheck = (v) => (Number.isNaN(toNumber(v.value)) ? { value: 'Type a number.' } : {});
// Value is a number in the KPI's own unit: US dollars, not cents, for money (D691.md).
const kpiBody = (v) => ({
  kpi: v.kpi || null, value: toNumber(v.value), as_of: str(v.as_of), note: str(v.note),
  ...(v.kpi === CUSTOM ? { label: str(v.label), unit: v.unit || 'count' } : {}),
});
const kpi = {
  key: 'kpi', cta: 'Save KPI', button: 'Enter a KPI',
  title: 'Enter a KPI',
  sub: 'A figure by hand, with its source. Connected sources fill the rest.',
  foot: 'A connected source overrides a hand entry.',
  fields: [
    { kind: 'CH', name: 'kpi', k: 'KPI', opts: KPI, def: 0, required: true, optionsFrom: 'kpis',
      note: 'Expansion MRR is worked out from the revenue ledger. Runway is worked out from cash and burn.' },
    { kind: 'T', name: 'label', k: 'Name', required: true, max: 80, when: { name: 'kpi', value: CUSTOM } },
    { kind: 'CH', name: 'unit', k: 'Unit', opts: KPI_UNIT, def: 0, when: { name: 'kpi', value: CUSTOM } },
    ...kpiValueFields,
  ],
  check: kpiCheck,
  // `/grow/revenue-and-traction/new?kpi=mrr` opens it with that KPI chosen.
  fromQuery: (q) => (ENTERABLE_KPIS.includes(q.get('kpi')) ? { kpi: q.get('kpi') } : {}),
  toBody: kpiBody,
  submit: (w, projectId, v) => w.grow.kpi(projectId, kpi.toBody(v)),
};

const ROLE_TEAM = opts([['Engineering', 'Engineering'], ['Product', 'Product'], ['Go-to-market', 'Go-to-market'], ['Operations', 'Operations']]);
const ROLE_TYPE = opts([['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract'], ['fractional', 'Fractional']]);
const POST_AXAL = 'axal';
const roleFields = [
  { kind: 'T', name: 'title', k: 'Role', ph: 'Title', required: true, max: 200 },
  { kind: 'CH', name: 'team', k: 'Team', opts: ROLE_TEAM, def: 0, optionsFrom: 'teams' },
  { kind: 'CH', name: 'type', k: 'Type', opts: ROLE_TYPE, def: 0 },
  { kind: 'T', name: 'target_start', k: 'Target start', input: 'date', ph: 'Jan' },
  { name: 'compensation', k: 'Compensation band', parts: [
    { kind: 'T', name: 'band', k: 'Band', ph: '$90k–$120k' },
    { kind: 'T', name: 'equity', k: 'Equity', ph: 'equity 0.5%' },
  ] },
];
const roleCheck = (v) => {
  const { min, max } = bandCents(v.band);
  const e = toNumber(v.equity);
  return {
    ...(Number.isNaN(min) || Number.isNaN(max) ? { band: 'Type the band in US dollars, such as 90,000–120,000.' } : min != null && max != null && min > max ? { band: 'The band starts below where it ends.' } : {}),
    ...(Number.isNaN(e) || (e != null && (e < 0 || e > 100)) ? { equity: 'Equity is a percentage from 0 to 100.' } : {}),
  };
};
const roleBody = (v) => {
  const { min, max } = bandCents(v.band);
  return {
    title: str(v.title), team: str(v.team), type: v.type || null, target_start: str(v.target_start),
    comp_min_cents: min, comp_max_cents: max, ...(min ?? max) == null ? {} : { comp_currency: 'usd' }, equity_pct: toNumber(v.equity),
  };
};
const role = {
  key: 'role', cta: 'Open role', button: 'Open a role',
  title: 'Open a role',
  sub: 'A role with its team and the stage it is at.',
  foot: 'Applicants land in the pipeline.',
  // No LinkedIn row (D-q): Post to is the Axal jobs board, sent for review.
  fields: [...roleFields, { kind: 'CK', name: 'post_to', k: 'Post to', opts: [{ value: POST_AXAL, label: 'Axal jobs board', checked: true }] }],
  check: roleCheck,
  toBody: (v) => ({ ...roleBody(v), publish: checkedOf(v.post_to, POST_AXAL) }),
  submit: (w, projectId, v) => w.grow.role(projectId, role.toBody(v)),
};

const PARTNER_TYPE = opts([['reseller', 'Reseller'], ['integration', 'Integration'], ['agency', 'Agency'], ['referral', 'Referral'], ['co_marketing', 'Co-marketing']]);
const PARTNER_STAGE = opts([['talking', 'Talking'], ['terms', 'Terms'], ['signed', 'Signed'], ['paused', 'Paused']]);
const TERMS_KIND = opts([['rev_share', 'Rev-share'], ['services_fee', 'Services fee'], ['referral_fee', 'Referral fee'], ['none', 'None yet']]);
const termsFields = [
  { kind: 'CH', name: 'terms_kind', k: 'Terms', opts: TERMS_KIND, def: 3 },
  { kind: 'T', name: 'amount', k: 'Amount', ph: '20% or $4,000 / month', when: (v) => Boolean(v.terms_kind) && v.terms_kind !== 'none' },
  { name: 'contact', k: 'Contact', parts: [
    { kind: 'T', name: 'contact_name', k: 'Name', ph: 'Name', max: 200 },
    { kind: 'T', name: 'contact_email', k: 'Email', ph: 'email', input: 'email', max: 200 },
  ] },
];
const termsCheck = (v) => {
  if (!v.terms_kind || v.terms_kind === 'none') return {};
  const t = termsAmount(v.amount);
  if (Number.isNaN(t.terms_amount_cents)) return { amount: 'Type a percentage, such as 20%, or an amount in US dollars.' };
  if (t.terms_pct != null && (Number.isNaN(t.terms_pct) || t.terms_pct < 0 || t.terms_pct > 100)) return { amount: 'A percentage is from 0 to 100.' };
  return {};
};
// A percentage or an amount, never both (#1697), and nothing while terms are None yet.
const termsBody = (v) => {
  const t = v.terms_kind && v.terms_kind !== 'none' ? termsAmount(v.amount) : {};
  return { terms_kind: v.terms_kind || null, ...t, ...(t.terms_amount_cents == null ? {} : { terms_currency: 'usd' }), contact_name: str(v.contact_name), contact_email: str(v.contact_email) };
};
const partner = {
  key: 'partner', cta: 'Add partner', button: 'Add partner',
  title: 'Add partner',
  sub: 'A partner with its type, stage and terms.',
  foot: 'Revenue they source is attributed to them.',
  fields: [
    { kind: 'T', name: 'name', k: 'Partner', ph: 'Company', required: true, max: 200 },
    { kind: 'CH', name: 'type', k: 'Type', opts: PARTNER_TYPE, def: 0, required: true },
    { kind: 'CH', name: 'stage', k: 'Stage', opts: PARTNER_STAGE, def: 0 },
    ...termsFields,
  ],
  check: termsCheck,
  toBody: (v) => ({ name: str(v.name), type: v.type || null, stage: v.stage || null, ...termsBody(v) }),
  submit: (w, projectId, v) => w.grow.partner(projectId, partner.toBody(v)),
};

/** Market parts: a checked row reveals its score and source, because a score needs its source. */
const MARKET_PARTS = [['demand', 'Demand evidence', true], ['regulation', 'Regulation', false], ['partners', 'Partners', true], ['cost', 'Cost to enter', false]];
const MARKET_STATE = opts([['considering', 'Considering'], ['served', 'Served']]);
// Every row reads "add a source": no read sources a part itself yet (#1698).
const scoreField = { kind: 'CK', name: 'parts', k: 'Score with sources', opts: MARKET_PARTS.map(([value, label, checked]) => ({ value, label, meta: 'add a source', checked })) };
const partFields = MARKET_PARTS.map(([k, label]) => ({
  name: `${k}_part`, k: label, when: { name: 'parts', value: k }, parts: [
    { kind: 'T', name: `${k}_score`, k: `${label}: score`, input: 'score', ph: 'Score 0–10' },
    { kind: 'T', name: `${k}_source`, k: `${label}: source`, ph: 'Source', max: 200 },
  ],
}));
const attachField = { kind: 'CH', name: 'geography_ref', k: 'Attach', opts: [{ value: NONE, label: 'Nothing yet' }], def: 0, optionsFrom: 'geographies' };
const marketCheck = (v) => Object.fromEntries(MARKET_PARTS
  .filter(([k]) => checkedOf(v.parts, k) && toScore(v[`${k}_score`]) != null && !str(v[`${k}_source`]))
  .map(([k, label]) => [`${k}_source`, `The ${label.toLowerCase()} score needs its source.`]));
// A checked row sends its pair (an empty score as null); an unchecked row sends nothing.
const marketPartsBody = (v) => Object.fromEntries(MARKET_PARTS.filter(([k]) => checkedOf(v.parts, k)).flatMap(([k]) => {
  const sc = toScore(v[`${k}_score`]);
  return [[`${k}_score`, sc], [`${k}_source`, sc == null ? null : str(v[`${k}_source`])]];
}));
const market = {
  key: 'market', cta: 'Add market', button: 'Add market',
  title: 'Add market',
  sub: 'A market served or considered, scored on four parts with sources.',
  foot: 'Readiness is scored out of 40.',
  fields: [
    { kind: 'T', name: 'name', k: 'Market', ph: 'Country or region', required: true, max: 120 },
    { kind: 'CH', name: 'state', k: 'State', opts: MARKET_STATE, def: 0 },
    scoreField, ...partFields, attachField,
  ],
  check: marketCheck,
  toBody: (v) => ({ name: str(v.name), state: v.state || null, ...marketPartsBody(v), ...(str(v.geography_ref) ? { geography_ref: str(v.geography_ref) } : {}) }),
  submit: (w, projectId, v) => w.grow.market(projectId, market.toBody(v)),
};

const OBLIGATION_KIND = opts([['governance', 'Governance'], ['compliance', 'Compliance'], ['risk', 'Risk'], ['culture', 'Culture']]);
const REPEATS = opts([['once', 'Once'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']]);
const remindField = { kind: 'CK', name: 'remind', k: 'Remind', opts: [{ value: '14', label: '14 days before', checked: true }, { value: '1', label: 'The day before', checked: true }] };
const remindDays = (v) => (Array.isArray(v.remind) ? v.remind.map(Number).filter(Number.isInteger) : []);
const obligation = {
  key: 'obligation', cta: 'Add obligation', button: 'Add obligation',
  title: 'Add obligation',
  sub: 'Governance, compliance or risk, with an owner and a date.',
  foot: 'Appears on the compliance calendar.',
  fields: [
    { kind: 'T', name: 'title', k: 'Obligation', ph: 'Board meeting, filing, review…', required: true, max: 200 },
    { kind: 'CH', name: 'kind', k: 'Kind', opts: OBLIGATION_KIND, def: 0, required: true },
    // The route refuses an obligation without a date (#1696).
    { kind: 'T', name: 'due_at', k: 'Due', input: 'date', ph: '12 Dec', required: true },
    { kind: 'T', name: 'owner_name', k: 'Owner', ph: 'Name', max: 120 },
    { kind: 'CH', name: 'repeats', k: 'Repeats', opts: REPEATS, def: 2 },
    remindField,
  ],
  toBody: (v) => ({ title: str(v.title), kind: v.kind || null, due_at: str(v.due_at), owner_name: str(v.owner_name), repeats: v.repeats || null, remind_days: remindDays(v) }),
  submit: (w, projectId, v) => w.grow.obligation(projectId, obligation.toBody(v)),
};

// ---------- Build (routes/cycle_build.ts) ------------------------------------

const risk = {
  key: 'risk', cta: 'Add risk',
  button: 'Add risk',
  title: 'Add a risk',
  lead: 'A risk to the venture, with how bad it is and what you are doing about it.',
  fields: [
    { name: 'title', label: 'Risk', type: 'text', required: true, max: 200 },
    { name: 'severity', label: 'Severity', type: 'select', required: true, options: opts([['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) },
    { name: 'mitigation', label: 'Mitigation', type: 'textarea', max: 2000 },
  ],
  toBody: (v) => ({ title: str(v.title), severity: v.severity || null, mitigation: str(v.mitigation) }),
  submit: (w, projectId, v) => w.build.risk(projectId, risk.toBody(v)),
};

const formationStep = {
  key: 'formation-step', cta: 'Add formation step',
  button: 'Add formation step',
  title: 'Add a formation step',
  lead: 'A step in forming the company, such as filing the certificate or getting a tax ID.',
  fields: [
    { name: 'title', label: 'Step', type: 'text', required: true, max: 200 },
    { name: 'due_date', label: 'Due', type: 'date' },
  ],
  toBody: (v) => ({ title: str(v.title), due_date: str(v.due_date) }),
  submit: (w, projectId, v) => w.build.formationStep(projectId, formationStep.toBody(v)),
};

const mustHave = {
  key: 'must-have', cta: 'Add a must-have',
  button: 'Add a must-have',
  title: 'Add a must-have',
  lead: 'A feature the MVP cannot ship without. It joins your MVP scope, marked as a must-have.',
  fields: [
    { name: 'title', label: 'Feature', type: 'text', required: true, max: 200 },
    { name: 'added_value', label: 'Value it adds', type: 'select', initial: 'High', options: opts([['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']]) },
    { name: 'effort', label: 'Effort', type: 'select', initial: 'M', options: opts([['S', 'Small'], ['M', 'Medium'], ['L', 'Large'], ['XL', 'Extra large']]) },
    { name: 'delivery_status', label: 'State', type: 'select', initial: 'Backlog', options: opts([['Backlog', 'Backlog'], ['In Progress', 'In progress'], ['Review', 'Review'], ['Done', 'Done'], ['Blocked', 'Blocked']]) },
    { name: 'due_date', label: 'Due', type: 'date' },
  ],
  toBody: (v) => ({ title: str(v.title), added_value: v.added_value || 'High', effort: v.effort || 'M', delivery_status: v.delivery_status || 'Backlog' }),
  // MVP scope adds the feature (progress.ts); D662's feature route marks it a
  // must-have and sets its date. The route returns the feature it made.
  async submit(w, projectId, v) {
    const made = await w.build.mvpFeature(projectId, mustHave.toBody(v));
    if (made?.id) await w.build.feature(projectId, made.id, { is_must_have: true, due_date: str(v.due_date) });
    return made;
  },
};

const feature = {
  key: 'feature', cta: 'Add feature',
  button: 'Add feature', title: 'Add a feature',
  lead: 'A feature of the solution. It can be linked to a pain theme later.',
  fields: mustHave.fields.slice(0, 3),
  toBody: (v) => ({ title: str(v.title), added_value: v.added_value || 'High', effort: v.effort || 'M', delivery_status: 'Backlog' }),
  submit: (w, projectId, v) => w.build.mvpFeature(projectId, feature.toBody(v)),
};

// ---------- Raise (routes/cycle_raise.ts, services/raiseWriters.ts) ---------
//
// D695 (#1657, PR 2): Raise's seven canvas forms (CO:317-323) in the canvas's
// T, CH and CK kinds, each body the one #1700's writer reads (D691.md "Part 2").
// The venture goes in the query (`?project=N`); the data room's routes take its
// uid in the path, which Data room's `form-options` returns as `project_uid`.
// Each form's chips come from its module's `form-options` through
// `loadOptions`, which answers the fields it fills; the dialog reads "Reading
// the choices…" until then. Where the canvas's sub or foot is not true, the
// words are D691.md decision 11's.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A stored day as the canvas writes it: "2026-10-12" is "12 Oct"; '' when it is not a day. */
export function shortDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
}
/** Dollars as typed, with an optional k or M ("$500k", "1.5M", "8,000,000"), to whole cents; null when empty; NaN when not a sum. */
export function scaledCents(v) {
  const s = String(v ?? '').trim().replace(/\s*cap$/i, '');
  if (!s) return null;
  const unit = { k: 1000, m: 1000000 }[s.slice(-1).toLowerCase()] ?? 1;
  const cents = toCents(unit === 1 ? s : s.slice(0, -1));
  return cents == null || Number.isNaN(cents) ? (cents == null ? Number.NaN : cents) : Math.round(cents * unit);
}
const wholeOf = (v) => { const n = toNumber(v); return Number.isInteger(n) ? n : Number.NaN; };
const posId = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
/** A list from `form-options` as chips: `{ value, label }` with text values. */
const chipsOf = (list) => (Array.isArray(list) ? list : []).filter((o) => o && o.value != null && o.value !== '')
  .map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
const raiseOptions = (w, projectId, slug) => w.formOptions('raise', projectId, slug);

const BY_HAND = 'team';
/** Re-score's seven rows, labelled as the canvas draws them (CO:317), in its order. */
const RESCORE_ITEMS = opts([['narrative', 'Narrative'], ['deck', 'Deck'], ['data_room', 'Data room'], ['cap_table', 'Cap table'],
  ['use_of_funds', 'Use of funds'], ['traction', 'Traction'], ['team', 'Team']]);
/** Each item with when it was last scored; Team is scored by a person on its record, so it is never sent (#1700 refuses it). */
export function rescoreRows(items) {
  const read = new Map((Array.isArray(items) ? items : []).map((i) => [String(i?.value), i]));
  return RESCORE_ITEMS.map(({ value, label }) => {
    const last = shortDay(read.get(value)?.last_scored);
    const when = last ? `last ${last}` : 'never scored';
    return value === BY_HAND
      ? { value, label, meta: `${when} · scored on its record`, checked: false, disabled: true }
      : { value, label, meta: when, checked: true };
  });
}
const rescore = {
  key: 'rescore', cta: 'Re-score now', button: 'Re-score',
  title: 'Re-score',
  sub: 'Re-reads the evidence of each item you tick and rescores it.',
  foot: 'Scores now, from what is recorded. Earlier scores are kept.',
  fields: [
    { kind: 'CK', name: 'items', k: 'Items to re-score', opts: rescoreRows([]), required: true },
    { kind: 'CH', name: 'since', k: 'Evidence read', opts: opts([['all', 'Everything'], ['last', 'Since the last score']]), def: 1 },
  ],
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'fundraising-readiness').then((r) => ({ items: { opts: rescoreRows(r?.items) } })),
  toBody: (v) => ({ items: (Array.isArray(v.items) ? v.items : []).filter((k) => k !== BY_HAND), since: v.since === 'all' ? 'all' : 'last' }),
  submit: (w, projectId, v) => w.raise.rescore(projectId, rescore.toBody(v)),
};

/** The seven investor types the Worker accepts (`raiseCycle.ts` INVESTOR_TYPES). */
const INVESTOR_TYPE = opts([['angel', 'Angel'], ['pre_seed_fund', 'Pre-seed fund'], ['seed_fund', 'Seed fund'],
  ['series_a_fund', 'Series A fund'], ['strategic', 'Strategic'], ['grant', 'Grant'], ['other', 'Other']]);
const LIVE = 'live';
const BLANK = 'blank';
const VERSION = 'version-';
/** Start from: each saved version, newest first, then the live deck, then blank. */
export function startFromChips(versions) {
  const saved = chipsOf(versions).filter((o) => /^[1-9][0-9]{0,8}$/.test(o.value)).sort((a, b) => Number(b.value) - Number(a.value));
  return [...saved.map((o) => ({ value: VERSION + o.value, label: o.label })), { value: LIVE, label: 'The live deck' }, { value: BLANK, label: 'Blank' }];
}
/** Check against: the deck and the metrics, not the data room (D691 decision 7). */
const CHECK_AGAINST = [{ value: 'deck', label: 'Pitch deck', checked: true }, { value: 'metrics', label: 'Metrics', checked: true }];
const narrativeWords = [
  { kind: 'T', name: 'one_liner', k: 'One-liner', ph: 'One line', max: 500 },
  { kind: 'T', name: 'why_now', k: 'Why now', ph: 'Line', max: 1000 },
  { kind: 'T', name: 'ask', k: 'The ask', ph: '$1.5M for n months', max: 500 },
  { kind: 'CK', name: 'check_against', k: 'Check against', opts: CHECK_AGAINST },
];
const listOf = (v) => (Array.isArray(v) && v.length ? v.map(String) : null);
const narrativeWordsBody = (v) => ({ one_liner: str(v.one_liner), why_now: str(v.why_now), ask: str(v.ask), check_against: listOf(v.check_against) });
const narrative = {
  key: 'narrative-version', cta: 'Create version', button: 'New version',
  title: 'New version',
  sub: 'One narrative per investor type. Each is checked for consistency.',
  foot: 'Start from a version or blank; you edit.',
  fields: [
    { kind: 'CH', name: 'investor_type', k: 'Investor type', opts: INVESTOR_TYPE, def: 'seed_fund', required: true },
    { kind: 'CH', name: 'start_from', k: 'Start from', opts: startFromChips([]), def: 0 },
    ...narrativeWords,
  ],
  // The newest saved version is chosen; with none, the live deck.
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'investor-narrative').then((r) => ({ start_from: { opts: startFromChips(r?.versions), def: 0 } })),
  toBody: (v) => {
    const from = String(v.start_from || LIVE);
    const based = from.startsWith(VERSION) ? posId(from.slice(VERSION.length)) : null;
    return {
      investor_type: v.investor_type || null,
      start_from: based ? 'version' : from === BLANK ? BLANK : LIVE,
      ...(based ? { based_on_version: based } : {}),
      ...narrativeWordsBody(v),
    };
  },
  submit: (w, projectId, v) => w.raise.narrativeVersion(projectId, narrative.toBody(v)),
};

const TYPED = 'typed';
const NEVER = 'never';
const EXPIRES = [...opts([['7', '7 days'], ['14', '14 days'], ['30', '30 days']]), { value: NEVER, label: 'Never' }];
const linkInvestor = [
  // A Capital relationships investor, or a name typed in (#1700 takes one, never both).
  { kind: 'CH', name: 'prospect_id', k: 'Investor', opts: [{ value: TYPED, label: 'Type a name' }], def: 0, required: true },
  { kind: 'T', name: 'investor_label', k: 'Fund or name', ph: 'Fund or name', max: 200, required: true, when: { name: 'prospect_id', value: TYPED } },
];
const ALLOW = [{ value: 'download', label: 'Download as PDF' }, { value: 'forwarding', label: 'Forwarding', meta: 'views by others are tracked too' }];
const investorBody = (v) => (v.prospect_id === TYPED ? { investor_label: str(v.investor_label) } : posId(v.prospect_id) ? { prospect_id: posId(v.prospect_id) } : {});
/** Its prospects first, then "Type a name"; the first is chosen. */
const prospectChips = (r) => [...chipsOf(r?.prospects), { value: TYPED, label: 'Type a name' }];
/** The raw link, once (D695 decision 3): only its hash is stored, so it is never shown again. */
export function shareLinkUrl(path, origin = globalThis.location?.origin ?? '') {
  return typeof path === 'string' && /^\/share\/deck\/[A-Za-z0-9._~-]+$/.test(path) ? `${origin}${path}` : null;
}
const BUILD_DECK = '/raise/pitch';
const deckLink = {
  key: 'deck-link', cta: 'Create link', button: 'New link',
  title: 'New link',
  sub: 'A link per investor, with an expiry. Views are tracked per slide.',
  foot: 'Expired links stop opening; their views stay.',
  fields: [
    ...linkInvestor,
    { kind: 'CH', name: 'deck_id', k: 'Deck version', opts: [], def: 0, required: true, empty: 'No deck yet.' },
    { kind: 'CH', name: 'expires_days', k: 'Expires', opts: EXPIRES, def: 2 },
    { kind: 'CK', name: 'allow', k: 'Allow', opts: ALLOW },
  ],
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'pitch-deck').then((r) => {
    const decks = chipsOf(r?.decks);
    return {
      prospect_id: { opts: prospectChips(r), def: 0 },
      deck_id: decks.length ? { opts: decks, def: 0 } : { opts: [], note: { text: '', href: BUILD_DECK, link: 'Build your deck' } },
    };
  }),
  // A link needs a deck: with none the CTA cannot be pressed.
  blocked: (fields) => !fields.find((f) => f.name === 'deck_id')?.options?.length,
  toBody: (v) => ({
    deck_id: posId(v.deck_id), ...investorBody(v),
    expires_days: v.expires_days === NEVER ? null : Number(v.expires_days || 30),
    allow_download: checkedOf(v.allow, 'download'), allow_forwarding: checkedOf(v.allow, 'forwarding'),
  }),
  submit: (w, projectId, v) => w.raise.deckLink(projectId, deckLink.toBody(v)),
  done: (result) => {
    const copy = shareLinkUrl(result?.share_path);
    return copy ? { text: 'Copy the link now. It is shown only once.', copy } : null;
  },
};

/** The size the file tool's queue refuses before sending (`DataRoomPage.jsx`). */
export const MAX_UPLOAD_MB = 20;
const PROJECT_UID = /^[A-Za-z0-9_-]{1,80}$/;
const NEW_FOLDER = 'name:';
const CANVAS_FOLDERS = ['Financials', 'Legal', 'Team', 'Product', 'Customers'];
/** Folder: the room's own top-level folders by uid, then the canvas's names not made yet, which the upload creates. */
export function folderChips(list) {
  return (Array.isArray(list) ? list : []).flatMap((f) => {
    if (f?.value != null && f.value !== '') return [{ value: String(f.value), label: String(f.label ?? f.value) }];
    return typeof f?.folder_name === 'string' && f.folder_name.trim() ? [{ value: NEW_FOLDER + f.folder_name.trim(), label: String(f.label ?? f.folder_name) }] : [];
  });
}
const REQUEST = 'request-';
const ITEM = 'item-';
const NONE_ANSWER = { value: NONE, label: 'None' };
/** Answers request: the venture's open diligence requests, then the checklist's items, then None. */
export function answerChips(r) {
  return [
    ...chipsOf(r?.requests).map((o) => ({ value: REQUEST + o.value, label: o.label })),
    ...chipsOf(r?.checklist).map((o) => ({ value: ITEM + o.value, label: o.label })),
    NONE_ANSWER,
  ];
}
const answerBody = (v) => {
  const a = String(v.answers ?? '');
  if (a.startsWith(REQUEST)) return { dd_request_id: posId(a.slice(REQUEST.length)) };
  if (a.startsWith(ITEM)) return { checklist_item: a.slice(ITEM.length) };
  return {};
};
const TIER = opts([['invited', 'Invited investors'], ['committed', 'Committed investors only'], ['nobody', 'Nobody yet']]);
const EXPIRE = 'expire';
const filesOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((f) => f && typeof f.name === 'string');
/** A picked file as the data URI the upload route takes. */
async function dataUri(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}
/** The venture's uid, which every data-room path carries, from Data room's `form-options`. */
async function roomUid(w, projectId) {
  const uid = String((await raiseOptions(w, projectId, 'data-room'))?.project_uid ?? '');
  if (!PROJECT_UID.test(uid)) throw new Error('This venture’s data room could not be found.');
  return uid;
}
const roomOptions = (w, projectId) => raiseOptions(w, projectId, 'data-room').then((r) => {
  const requests = chipsOf(r?.requests);
  return {
    folder: { opts: folderChips(r?.folders), def: 0 },
    // The first open request is chosen, as the canvas draws it; with none, None.
    answers: { opts: answerChips(r), def: requests.length ? REQUEST + requests[0].value : NONE },
  };
});
const upload = {
  key: 'upload', cta: 'Upload', button: 'Upload',
  title: 'Upload',
  // Every file goes behind the NDA gate (decision 5), which makes the sub true.
  sub: 'Files land in a folder, behind the NDA gate.',
  foot: 'Access is per investor, per file.',
  fields: [
    // A file box draws no placeholder, so the canvas's is its note.
    { kind: 'T', name: 'files', k: 'Files', input: 'file', multiple: true, note: 'Drop files here, or browse' },
    { kind: 'CH', name: 'folder', k: 'Folder', opts: CANVAS_FOLDERS.map((n) => ({ value: NEW_FOLDER + n, label: n })), def: 0 },
    { kind: 'CH', name: 'answers', k: 'Answers request', opts: [NONE_ANSWER], def: 0 },
    { kind: 'CH', name: 'access_tier', k: 'Access', opts: TIER, def: 0 },
    // No watermark row: the room does not watermark (D-q).
    { kind: 'CK', name: 'protect', k: 'Protect', opts: [{ value: EXPIRE, label: 'Expire access on' }] },
    { kind: 'T', name: 'access_expires_at', k: 'Expire access on', input: 'date', required: true, when: { name: 'protect', value: EXPIRE } },
  ],
  check: (v) => (filesOf(v.files).length ? {} : { files: 'Pick a file to upload.' }),
  loadOptions: roomOptions,
  toBody: (v, name, data) => {
    const folder = String(v.folder ?? '');
    return {
      name, data, visibility: 'nda',
      ...(folder.startsWith(NEW_FOLDER) ? { folder_name: folder.slice(NEW_FOLDER.length) } : folder ? { folder_uid: folder } : {}),
      ...answerBody(v), access_tier: v.access_tier || 'invited',
      access_expires_at: checkedOf(v.protect, EXPIRE) ? str(v.access_expires_at) : null,
    };
  },
  // One POST per file. A file over the limit is refused by name before sending,
  // and one the Worker refuses is named with its sentence; the others still go.
  submit: async (w, projectId, v) => {
    const uid = await roomUid(w, projectId);
    const sent = [];
    const refused = [];
    for (const file of filesOf(v.files)) {
      const why = queueRefusal(file, MAX_UPLOAD_MB);
      if (why) { refused.push(`${file.name}: ${why}.`); continue; }
      try {
        await w.raise.upload(uid, upload.toBody(v, file.name, await dataUri(file)));
        sent.push(file.name);
      } catch (error) { refused.push(`${file.name}: ${error?.message || 'The upload did not go through.'}`); }
    }
    if (refused.length) throw new Error([sent.length ? `Uploaded ${sent.join(', ')}.` : '', ...refused].filter(Boolean).join(' '));
    return { uploaded: sent.length };
  },
};

const FOUNDERS = 'founders';
const INVESTORS = 'investors';
const GROUP = opts([[FOUNDERS, 'Founders'], [INVESTORS, 'Investors']]);
const HOLDER_VESTING = opts([['none', 'None'], ['4y-1y', '4 years, 1-year cliff'], ['custom', 'Custom']]);
const inGroup = (group) => ({ name: 'group', value: group });
const vests = (v) => v.group === FOUNDERS && Boolean(v.vesting) && v.vesting !== 'none';
const holderMoney = [
  { kind: 'T', name: 'amount', k: 'Amount', ph: '$500k' },
  { kind: 'T', name: 'cap', k: 'Cap', ph: '$8M cap' },
];
const NO_PROSPECT = { value: NONE, label: 'None' };
const holderCheck = (v) => {
  const e = {};
  for (const k of ['amount', 'cap']) if (Number.isNaN(scaledCents(v[k]))) e[k] = 'Type an amount in US dollars, such as 500,000 or $500k.';
  if (v.group === INVESTORS && scaledCents(v.amount) == null) e.amount = 'Amount is required.';
  // #1700's writer refuses a SAFE or a note with neither a cap nor a discount, and Add holder takes no discount.
  if (v.group === INVESTORS && scaledCents(v.cap) == null && !e.cap) e.cap = 'A SAFE or a note needs its cap.';
  const shares = wholeOf(v.shares);
  if (v.group === FOUNDERS && str(v.shares) && !(shares > 0)) e.shares = 'Shares are a whole number above 0.';
  if (v.vesting === 'custom' && v.group === FOUNDERS) {
    const total = wholeOf(v.total_months);
    const cliff = wholeOf(v.cliff_months);
    if (!(total > 0)) e.total_months = 'Months are a whole number above 0.';
    else if (!(cliff >= 0) || cliff > total) e.cliff_months = 'The cliff is a whole number of months, no longer than the vesting.';
  }
  return e;
};
const vestingBody = (v) => {
  if (!vests(v)) return {};
  const [total, cliff] = v.vesting === '4y-1y' ? [48, 12] : [wholeOf(v.total_months), wholeOf(v.cliff_months)];
  return { vesting: { start_date: str(v.vesting_start), total_months: total, cliff_months: cliff } };
};
const holder = {
  key: 'holder', cta: 'Add holder', button: 'Add holder',
  title: 'Add holder',
  sub: 'A holder with their group and instrument.',
  foot: 'Ownership recomputes before and after the planned round.',
  // Only the pairs #1700's writer takes; the pool and priced rounds stay in the cap-table tool.
  fields: [
    { kind: 'T', name: 'name', k: 'Holder', ph: 'Name or fund', required: true, max: 200 },
    { kind: 'CH', name: 'group', k: 'Group', opts: GROUP, def: 1, required: true },
    { kind: 'CH', name: 'instrument_founders', k: 'Instrument', opts: opts([['common', 'Common']]), def: 0, when: inGroup(FOUNDERS) },
    { kind: 'CH', name: 'instrument', k: 'Instrument', opts: opts([['safe', 'SAFE'], ['note', 'Convertible note']]), def: 0, when: inGroup(INVESTORS) },
    { name: 'investment', k: 'Amount or shares', parts: holderMoney, when: inGroup(INVESTORS) },
    { kind: 'T', name: 'shares', k: 'Amount or shares', ph: 'Shares', required: true, when: inGroup(FOUNDERS) },
    { kind: 'CH', name: 'prospect_id', k: 'Investor in Capital relationships', opts: [NO_PROSPECT], def: 0, when: inGroup(INVESTORS) },
    { kind: 'CH', name: 'vesting', k: 'Vesting', opts: HOLDER_VESTING, def: 0, when: inGroup(FOUNDERS) },
    { kind: 'T', name: 'vesting_start', k: 'Vesting starts', input: 'date', required: true, when: vests },
    { name: 'vesting_terms', k: 'Vesting · months', when: (v) => vests(v) && v.vesting === 'custom', parts: [
      { kind: 'T', name: 'total_months', k: 'Months in all', ph: '48 months' },
      { kind: 'T', name: 'cliff_months', k: 'Cliff', ph: '12 months' },
    ] },
  ],
  check: holderCheck,
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'cap-table').then((r) => ({ prospect_id: { opts: [NO_PROSPECT, ...chipsOf(r?.prospects)], def: 0 } })),
  toBody: (v) => (v.group === FOUNDERS
    ? { name: str(v.name), group: FOUNDERS, instrument: 'common', shares: wholeOf(v.shares), ...vestingBody(v) }
    : { name: str(v.name), group: INVESTORS, instrument: v.instrument === 'note' ? 'note' : 'safe',
      amount_cents: scaledCents(v.amount), cap_cents: scaledCents(v.cap), ...(posId(v.prospect_id) ? { prospect_id: posId(v.prospect_id) } : {}) }),
  submit: (w, projectId, v) => w.raise.holder(projectId, holder.toBody(v)),
};

/** The five stored sections, by their stored labels (`components/FundAllocator.jsx`), not renamed (D691 decision 9). */
export const FUND_SECTIONS = [['product', 'Product & engineering'], ['go-to-market', 'GTM: sales and marketing'],
  ['infrastructure', 'Infrastructure & data'], ['operations', 'Operations, legal & compliance'], ['reserve', 'Hiring / runway reserve']];
const RUNWAY = opts([['18', '18 months'], ['24', '24 months'], ['custom', 'Custom']]);
const MONTH_BY = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;
const usdText = (cents) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
/** A section's amount, worked out from its share of Amount to raise, so the two cannot disagree. */
export function sectionAmount(v, key) {
  const total = scaledCents(v?.amount_to_raise);
  const pct = toNumber(v?.[`pct.${key}`]);
  return total > 0 && pct >= 0 && pct <= 100 ? `${usdText((total * pct) / 100)} of the raise` : '';
}
const splitFields = [
  { kind: 'T', name: 'amount_to_raise', k: 'Amount to raise', ph: '$1.5M' },
  ...FUND_SECTIONS.flatMap(([key, label]) => [
    { kind: 'T', name: `pct.${key}`, k: label, ph: '%', required: true, note: (v) => sectionAmount(v, key) },
    { name: `milestone.${key}`, k: 'Milestone · by', parts: [
      { kind: 'T', name: `milestone_label.${key}`, k: 'Milestone', ph: 'Milestone', max: 200 },
      { kind: 'T', name: `milestone_by.${key}`, k: 'By', ph: 'YYYY-MM' },
    ] },
  ]),
  { kind: 'CH', name: 'runway', k: 'Runway it buys', opts: RUNWAY, def: 1 },
  { kind: 'T', name: 'runway_months', k: 'Months', ph: 'months', required: true, when: { name: 'runway', value: 'custom' } },
];
const splitCheck = (v) => {
  const e = {};
  if (Number.isNaN(scaledCents(v.amount_to_raise))) e.amount_to_raise = 'Type an amount in US dollars, such as 1,500,000 or $1.5M.';
  let sum = 0;
  for (const [key] of FUND_SECTIONS) {
    const pct = wholeOf(v[`pct.${key}`]);
    if (!(pct >= 0 && pct <= 100)) e[`pct.${key}`] = 'A share is a whole number from 0 to 100.';
    else sum += pct;
    if (str(v[`milestone_by.${key}`]) && !MONTH_BY.test(str(v[`milestone_by.${key}`]))) e[`milestone_by.${key}`] = 'Type the month as YYYY-MM.';
  }
  if (!Object.keys(e).length && sum !== 100) e[`pct.${FUND_SECTIONS[0][0]}`] = `The split adds up to ${sum}%. It must add up to 100%.`;
  if (v.runway === 'custom' && !(wholeOf(v.runway_months) >= 1 && wholeOf(v.runway_months) <= 120)) e.runway_months = 'Runway is a whole number of months from 1 to 120.';
  return e;
};
/** The stored split, so the form opens with it every time (decision 9). */
const splitOptions = (w, projectId) => raiseOptions(w, projectId, 'use-of-funds').then((r) => {
  const out = {};
  const stored = new Map((Array.isArray(r?.sections) ? r.sections : []).map((s) => [String(s?.value), s]));
  for (const [key] of FUND_SECTIONS) {
    const s = stored.get(key);
    out[`pct.${key}`] = { value: s?.pct != null ? String(s.pct) : '' };
    out[`milestone_label.${key}`] = { value: s?.milestone_label ?? '' };
    out[`milestone_by.${key}`] = { value: s?.milestone_by ?? '' };
  }
  if (Number(r?.amount_to_raise) > 0) out.amount_to_raise = { value: Math.round(Number(r.amount_to_raise)).toLocaleString('en-US') };
  const runway = Number(r?.runway_months);
  if (Number.isInteger(runway) && runway > 0) {
    out.runway = { def: runway === 18 || runway === 24 ? String(runway) : 'custom' };
    out.runway_months = { value: String(runway) };
  }
  return out;
});
const useOfFunds = {
  key: 'split', cta: 'Save split', button: 'Edit split',
  title: 'Edit split',
  sub: 'How the round is spent, by category. Each buys a milestone.',
  foot: 'The pitch deck fills its use-of-funds slide from this split.',
  fields: splitFields,
  check: splitCheck,
  loadOptions: splitOptions,
  toBody: (v) => ({
    amount_to_raise_cents: scaledCents(v.amount_to_raise),
    sections: FUND_SECTIONS.map(([key]) => ({
      key, pct: wholeOf(v[`pct.${key}`]), milestone_label: str(v[`milestone_label.${key}`]), milestone_by: str(v[`milestone_by.${key}`]),
    })),
    runway_months: v.runway === 'custom' ? wholeOf(v.runway_months) : Number(v.runway || 24),
  }),
  submit: (w, projectId, v) => w.raise.useOfFunds(projectId, useOfFunds.toBody(v)),
};

/** The stages, stored as #1700 stores them: Identified is `to_contact`. */
const STAGE = opts([['to_contact', 'Identified'], ['contacted', 'Contacted'], ['meeting', 'Meeting'], ['diligence', 'Diligence'], ['committed', 'Committed'], ['passed', 'Passed']]);
const NO_PATH = { value: NONE, label: 'No path yet' };
/** Warm path: "<Name> can introduce" for each person in the founder's own network, then No path yet. */
export function warmPathChips(people) {
  return [...chipsOf(people).map((o) => ({ value: o.value, label: `${o.value.split(' · ')[0]} can introduce` })), NO_PATH];
}
const nextStep = { name: 'next', k: 'Next step · due', parts: [
  { kind: 'T', name: 'next_step', k: 'Next step', ph: 'Send deck', max: 300 },
  { kind: 'T', name: 'next_step_due', k: 'Due', input: 'date', ph: 'Fri' },
] };
const prospect = {
  key: 'investor', cta: 'Add investor', button: 'Add investor',
  title: 'Add investor',
  sub: 'An investor in the pipeline, with how you reach them.',
  foot: 'Fit is read from their sector focus and fund size.',
  fields: [
    // Typing searches the fund directory; a fund picked is sent as `research_fund_uid`, else the name typed.
    { kind: 'T', name: 'name', k: 'Investor', ph: 'Search funds and angels, or type a name', required: true, max: 200, search: { into: 'research_fund_uid' } },
    { kind: 'CH', name: 'stage', k: 'Stage', opts: STAGE, def: 0 },
    { kind: 'CH', name: 'warm_path', k: 'Warm path', opts: [NO_PATH], def: 0 },
    nextStep,
    { kind: 'T', name: 'notes', k: 'Notes', ph: 'One line', max: 4000 },
  ],
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'capital-relationships').then((r) => ({ warm_path: { opts: warmPathChips(r?.warm_paths), def: 0 } })),
  /** The funds whose name matches what is typed, through #1656's `formOptions` query (decision 16). */
  search: (w, projectId, q) => w.formOptions('raise', projectId, 'capital-relationships', { q }).then((r) => chipsOf(r?.funds)),
  toBody: (v) => ({
    ...(str(v.research_fund_uid) ? { research_fund_uid: str(v.research_fund_uid) } : { name: str(v.name) }),
    stage: v.stage || 'to_contact', warm_path: str(v.warm_path), next_step: str(v.next_step), next_step_due: str(v.next_step_due), notes: str(v.notes),
  }),
  submit: (w, projectId, v) => w.raise.prospect(projectId, prospect.toBody(v)),
};

/** The forms, by cycle and module slug. A slug not here has no Add form. */
export const FORMS = {
  raise: {
    'fundraising-readiness': [rescore],
    'investor-narrative': [narrative],
    'pitch-deck': [deckLink],
    'data-room': [upload],
    'cap-table': [holder],
    'use-of-funds': [useOfFunds],
    'capital-relationships': [prospect],
  },
  grow: {
    'product-improvement': [feedback],
    distribution: [channel],
    'revenue-and-traction': [kpi],
    'team-expansion': [role],
    'partner-network': [partner],
    'market-expansion': [market],
    'durable-company-building': [obligation],
  },
  build: {
    'solution-design': [feature, risk],
    'prototype-mvp': [mustHave],
    'company-creation': [formationStep],
  },
};

/** All Add forms for a module, in button order. */
export function formsFor(cycle, slug) {
  const byCycle = Object.prototype.hasOwnProperty.call(FORMS, cycle) ? FORMS[cycle] : null;
  return byCycle && Object.prototype.hasOwnProperty.call(byCycle, slug) ? byCycle[slug] : [];
}

/** The form for a cycle's module, or null. Own entries only: a slug never reaches Object.prototype. */
export function formFor(cycle, slug) {
  return formsFor(cycle, slug)[0] || null;
}

// ---------- Edit a row -------------------------------------------------------
//
// An Edit form is an Add form's shape plus two readers: `idOf(row)`, the
// store's own id for the row (null when the row is not one the route can
// change, which draws no Edit), and `valuesOf(row)`, the row's current values.
// Grow's rows carry them as `edit` (`adapters/grow.js`); Build's rows carry
// `edit` too, their stored values (D690, #1693), and a row without it is read
// from its cells. `submit` takes the id.

const asText = (v) => (v == null ? '' : String(v));
const dateText = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const growEdit = (row) => (row && typeof row.edit === 'object' && row.edit ? row.edit : null);
/** A Build row id the routes take: a positive whole number, from `prefix<n>` or a bare number. */
const buildId = (prefix) => (row) => {
  const id = String(row?.id ?? '');
  const digits = id.startsWith(prefix) ? id.slice(prefix.length) : '';
  const n = /^\d+$/.test(digits) ? Number(digits) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** An Edit saves with "Save" (D695 decision 7); its row button stays "Edit". */
const EDIT = { button: 'Edit', cta: 'Save' };

// Grow's Edits (D695 decision 9, #1657): the Add's fields each PATCH takes.
// A row carries only some current values (`adapters/grow.js`), so an Edit's
// chips have no default and a field is sent only when the row carried it or
// the founder filled it: a field the row lacks and nobody touched sends no key.
const filled = (x) => (Array.isArray(x) ? x.length > 0 : x != null && String(x).trim() !== '');
/** Only the body keys whose field the row carried or the founder filled; `from` names a key's field. */
const sentOnly = (v, body, carried, from = {}) => Object.fromEntries(Object.entries(body).filter(([k]) => {
  const f = from[k] ?? k;
  return carried.includes(f) || filled(v[f]);
}));
/** A field with no default, so an Edit never sends a value the founder did not choose. */
const bare = ({ def: _def, required: _required, ...f }) => f;
// A stored value the Add does not offer is still a choice on Edit.
const withChips = (f, extra) => ({ ...bare(f), opts: [...f.opts, ...opts(extra)] });

const FEEDBACK_CARRIED = ['status', 'theme', 'roadmap_item_label'];
const editFeedback = {
  ...EDIT,
  key: 'edit-feedback',
  title: 'Edit feedback',
  sub: feedback.sub,
  fields: [
    { ...feedback.fields[0], required: false },
    bare(feedback.fields[1]),
    feedbackFrom,
    // Free text until #1698's read names the themes and roadmap items as chips.
    { kind: 'T', name: 'theme', k: 'Theme', max: 80 },
    { kind: 'T', name: 'roadmap_item_label', k: 'Roadmap item', max: 200 },
    { kind: 'CH', name: 'status', k: 'Status', opts: FEEDBACK_STATUS, required: true },
    { ...notifyField, opts: notifyField.opts.map((o) => ({ ...o, checked: false })) }, emailField,
  ],
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { status: asText(e.status), theme: asText(e.theme), roadmap_item_label: asText(e.roadmap_item_label) }; },
  toBody: (v) => {
    const notify = checkedOf(v.then, NOTIFY);
    return sentOnly(v, {
      body: str(v.body), source: v.source || null, from_name: str(v.from_name), from_company: str(v.from_company),
      theme: str(v.theme), roadmap_item_label: str(v.roadmap_item_label), status: v.status,
      notify_on_ship: notify, from_email: notify ? str(v.from_email) : null,
    }, FEEDBACK_CARRIED, { notify_on_ship: 'then' });
  },
  submit: (w, projectId, id, v) => w.grow.feedbackUpdate(projectId, id, editFeedback.toBody(v)),
};

const CHANNEL_CARRIED = ['name', 'state'];
const editChannel = {
  ...EDIT,
  key: 'edit-channel',
  title: 'Edit channel',
  sub: 'Its kind, name, state, bar and this month’s spend. Its UTM source is what counts its customers, so it stays as added.',
  fields: [bare(channelFields[0]), channelFields[1], { ...bare(channelFields[2]), required: true }, channelFields[4], channelFields[3]],
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { name: asText(e.name), state: asText(e.state) }; },
  toBody: (v) => sentOnly(v, channelBody(v), CHANNEL_CARRIED, { spend_cents: 'spend', cac_bar_cents: 'bar', bar_currency: 'bar' }),
  submit: (w, projectId, id, v) => w.grow.channelUpdate(projectId, id, editChannel.toBody(v)),
};

// A KPI keeps its history, so its Edit posts a new value with the KPI fixed.
const enterKpi = {
  ...EDIT,
  key: 'edit-kpi', button: 'Enter by hand', cta: 'Save',
  title: 'Enter a KPI',
  sub: kpi.sub,
  fields: kpiValueFields,
  check: kpiCheck,
  idOf: (row) => {
    // A KPI's record id is its key (`mrr`, `custom-<uid>`); a row carries it as `recordId`.
    const id = String(row?.recordId ?? row?.id ?? '');
    return ENTERABLE_KPIS.includes(id) || /^custom-[a-z0-9]+$/.test(id) ? id : null;
  },
  valuesOf: () => ({}),
  toBody: (v, key) => kpiBody({ ...v, kpi: key }),
  submit: (w, projectId, id, v) => w.grow.kpi(projectId, enterKpi.toBody(v, id)),
};

// Opened from a row it draws no Post to: publishing is the role's host's, declared on the record (#1698).
const editRole = {
  ...EDIT,
  key: 'edit-role',
  title: 'Edit role',
  sub: role.sub,
  fields: [{ ...roleFields[0], required: false }, bare(roleFields[1]), bare(roleFields[2]), roleFields[3], roleFields[4]],
  check: roleCheck,
  idOf: (row) => { const n = Number(row?.recordId ?? row?.edit?.id ?? row?.id); return Number.isSafeInteger(n) && n > 0 ? n : null; },
  valuesOf: () => ({}),
  toBody: (v) => sentOnly(v, roleBody(v), [], { comp_min_cents: 'band', comp_max_cents: 'band', comp_currency: 'band', equity_pct: 'equity' }),
  submit: (w, projectId, id, v) => w.grow.roleUpdate(projectId, id, editRole.toBody(v)),
};

const PARTNER_CARRIED = ['type', 'stage', 'terms'];
const editPartner = {
  ...EDIT,
  key: 'edit-partner',
  title: 'Edit partner',
  sub: partner.sub,
  fields: [
    { ...withChips(partner.fields[1], [['other', 'Other']]), required: true },
    { ...withChips(partner.fields[2], [['ended', 'Ended']]), required: true },
    bare(termsFields[0]), termsFields[1], termsFields[2],
    // The free text an older partner was added with.
    { kind: 'T', name: 'terms', k: 'Notes on terms', input: 'textarea', max: 400 },
  ],
  check: termsCheck,
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { type: asText(e.type), stage: asText(e.stage), terms: asText(e.terms) }; },
  toBody: (v) => sentOnly(v, { type: v.type, stage: v.stage, ...termsBody(v), terms: str(v.terms) }, PARTNER_CARRIED,
    { terms_pct: 'amount', terms_amount_cents: 'amount', terms_currency: 'amount' }),
  submit: (w, projectId, id, v) => w.grow.partnerUpdate(projectId, id, editPartner.toBody(v)),
};

const MARKET_CARRIED = ['state', 'decision', ...MARKET_PARTS.flatMap(([k]) => [`${k}_score`, `${k}_source`])];
const editMarket = {
  ...EDIT,
  key: 'edit-market',
  title: 'Edit market',
  sub: 'Its state, your decision, and each part’s score with its source. Emptying a score clears it.',
  fields: [
    { ...withChips(market.fields[1], [['entering', 'Entering'], ['not_now', 'Not now']]), required: true },
    { kind: 'CH', name: 'decision', k: 'Decision', opts: opts([['enter', 'Enter'], ['not_yet', 'Not yet'], ['exit', 'Exit']]) },
    { ...scoreField, opts: scoreField.opts.map((o) => ({ ...o, checked: false })) }, ...partFields, bare(attachField),
  ],
  check: marketCheck,
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => {
    const e = growEdit(row) || {};
    const scored = MARKET_PARTS.map(([k]) => k).filter((k) => e[`${k}_score`] != null);
    return { state: asText(e.state), decision: asText(e.decision), parts: scored,
      ...Object.fromEntries(MARKET_PARTS.flatMap(([k]) => [[`${k}_score`, asText(e[`${k}_score`])], [`${k}_source`, asText(e[`${k}_source`])]])) };
  },
  // Every carried part is sent: a row scored before is cleared only when its score is emptied.
  toBody: (v) => {
    const parts = Object.fromEntries(MARKET_PARTS.flatMap(([k]) => {
      const sc = toScore(v[`${k}_score`]);
      return [[`${k}_score`, sc], [`${k}_source`, sc == null ? null : str(v[`${k}_source`])]];
    }));
    return sentOnly(v, { state: v.state, decision: v.decision || null, ...parts, geography_ref: str(v.geography_ref) }, MARKET_CARRIED);
  },
  submit: (w, projectId, id, v) => w.grow.marketUpdate(projectId, id, editMarket.toBody(v)),
};

const OBLIGATION_STATE = opts([['upcoming', 'Upcoming'], ['scheduled', 'Scheduled'], ['draft', 'Draft'], ['done', 'Done'], ['not_set_up', 'Not set up']]);
const OBLIGATION_CARRIED = ['status', 'owner_name', 'due_at'];
const editObligation = {
  ...EDIT,
  key: 'edit-obligation',
  title: 'Edit obligation',
  sub: 'Its kind, date, owner, how it repeats, its reminders and its state.',
  fields: [
    withChips(obligation.fields[1], [['tax', 'Tax'], ['other', 'Other']]),
    { kind: 'T', name: 'due_at', k: 'Due', input: 'date' },
    obligation.fields[3],
    bare(obligation.fields[4]),
    { ...remindField, opts: remindField.opts.map((o) => ({ ...o, checked: false })) },
    { kind: 'CH', name: 'status', k: 'State', opts: OBLIGATION_STATE, required: true },
  ],
  idOf: (row) => growEdit(row)?.id ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { status: asText(e.status), owner_name: asText(e.owner_name), due_at: dateText(e.due_at) }; },
  toBody: (v) => sentOnly(v, { kind: v.kind || null, due_at: str(v.due_at), owner_name: str(v.owner_name), repeats: v.repeats || null, remind_days: remindDays(v), status: v.status },
    OBLIGATION_CARRIED, { remind_days: 'remind' }),
  submit: (w, projectId, id, v) => w.grow.obligationUpdate(projectId, id, editObligation.toBody(v)),
};

// Raise's Edits (D695 decision 9, #1657): the fields each PATCH takes. A
// record's Edit opens with the values its read declares (#1658's
// `recordFormFor`); a field it carries is sent, and one it does not carry is
// sent only once filled. Fundraising readiness has none: a re-score adds a
// score and keeps the rest. Only a record resolves an id (`{ id, edit: { id,
// uid } }`): a module row carries no `edit`, so no row draws these Edits.
const recordEdit = (row) => (row && typeof row.edit === 'object' && row.edit ? row.edit : null);
const recordNumber = (row) => posId(recordEdit(row)?.id);
const EDIT_LINK_EXPIRES = opts([['7', '7 days'], ['14', '14 days'], ['30', '30 days']]);
const YES_NO_CHIPS = opts([['yes', 'Yes'], ['no', 'No']]);
const yesNo = (v) => (v === 'yes' ? true : v === 'no' ? false : null);

const NARRATIVE_CARRIED = ['investor_type', 'one_liner', 'why_now', 'ask', 'check_against'];
const editNarrative = {
  ...EDIT,
  key: 'edit-version',
  title: 'Edit version',
  sub: 'Its investor type, its words and what it is checked against. Start from is set when a version is made.',
  fields: [{ ...bare(narrative.fields[0]), required: true }, ...narrativeWords.slice(0, 3), { ...narrativeWords[3], opts: CHECK_AGAINST.map((o) => ({ ...o, checked: false })) }],
  idOf: recordNumber,
  valuesOf: () => ({}),
  toBody: (v) => sentOnly(v, { investor_type: v.investor_type || null, ...narrativeWordsBody(v) }, NARRATIVE_CARRIED),
  submit: (w, projectId, id, v) => w.raise.narrativeVersionUpdate(projectId, id, editNarrative.toBody(v)),
};

// The deck version is fixed: the token's scope carries it. An edit can bring
// the expiry forward, never extend it (#1700), so Never is not offered.
const editLink = {
  ...EDIT,
  key: 'edit-link',
  title: 'Edit link',
  sub: 'Who it is for, its expiry, and what it allows.',
  fields: [
    bare(linkInvestor[0]), linkInvestor[1],
    { kind: 'CH', name: 'expires_days', k: 'Expires', opts: EDIT_LINK_EXPIRES, note: 'A later expiry needs a new link.' },
    { kind: 'CH', name: 'allow_download', k: 'Download as PDF', opts: YES_NO_CHIPS },
    { kind: 'CH', name: 'allow_forwarding', k: 'Forwarding', opts: YES_NO_CHIPS },
  ],
  idOf: recordNumber,
  valuesOf: () => ({}),
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'pitch-deck').then((r) => ({ prospect_id: { opts: prospectChips(r) } })),
  toBody: (v) => sentOnly(v, {
    ...investorBody(v), expires_days: posId(v.expires_days),
    allow_download: yesNo(v.allow_download), allow_forwarding: yesNo(v.allow_forwarding),
  }, [], { investor_label: 'prospect_id', expires_days: 'expires_days' }),
  submit: (w, projectId, id, v) => w.raise.deckLinkUpdate(projectId, id, editLink.toBody(v)),
};

// A file's path takes its uid, which #1699's record carries beside its integer
// id: `{ id, edit: { id, uid } }`. The PATCH moves a file only into a folder
// that exists, so the names not made yet are not offered.
const editFile = {
  ...EDIT,
  key: 'edit-file',
  title: 'Edit file',
  sub: 'Its folder, the request it answers, and who can open it.',
  fields: [
    { ...bare(upload.fields[1]), opts: [] , empty: 'No folder made yet.' },
    bare(upload.fields[2]),
    bare(upload.fields[3]),
    { kind: 'T', name: 'access_expires_at', k: 'Expire access on', input: 'date' },
  ],
  idOf: (row) => { const uid = String(recordEdit(row)?.uid ?? ''); return PROJECT_UID.test(uid) ? uid : null; },
  valuesOf: () => ({}),
  loadOptions: (w, projectId) => roomOptions(w, projectId).then((r) => ({
    folder: { opts: r.folder.opts.filter((o) => !o.value.startsWith(NEW_FOLDER)) },
    answers: { opts: r.answers.opts.filter((o) => o.value !== NONE) },
  })),
  toBody: (v) => sentOnly(v, {
    folder_uid: str(v.folder), ...answerBody(v), access_tier: v.access_tier || null, access_expires_at: str(v.access_expires_at),
  }, [], { folder_uid: 'folder', dd_request_id: 'answers', checklist_item: 'answers' }),
  submit: async (w, projectId, uid, v) => w.raise.fileUpdate(await roomUid(w, projectId), uid, editFile.toBody(v)),
};

// A holder keeps its group and instrument (#1700 refuses a change). A founder
// is edited by shares, a SAFE or a note by its amount, cap and discount.
const editHolder = {
  ...EDIT,
  key: 'edit-holder',
  title: 'Edit holder',
  sub: 'Shares for a founder; the amount, cap and discount for a SAFE or a note.',
  fields: [
    { ...holder.fields[0], required: false },
    { kind: 'T', name: 'shares', k: 'Shares', ph: 'Shares' },
    { name: 'investment', k: 'Amount or shares', parts: holderMoney },
    { kind: 'T', name: 'discount_pct', k: 'Discount', ph: '20%' },
    { kind: 'CH', name: 'prospect_id', k: 'Investor in Capital relationships', opts: [NO_PROSPECT] },
  ],
  check: (v) => {
    const e = holderCheck({ ...v, group: 'edit' });
    delete e.amount;
    const d = toNumber(v.discount_pct);
    if (Number.isNaN(d) || (d != null && (d < 0 || d > 90))) e.discount_pct = 'A discount is a percentage from 0 to 90.';
    if (str(v.shares) && !(wholeOf(v.shares) > 0)) e.shares = 'Shares are a whole number above 0.';
    return e;
  },
  // A cap-table record id is `h-<n>` or `e-<n>` (D691 decision 3); `pool` has no Edit.
  idOf: (row) => (recordEdit(row) ? [row.id, row.edit.id].map((x) => String(x ?? '')).find((id) => /^(h|e)-[1-9][0-9]{0,9}$/.test(id)) ?? null : null),
  valuesOf: () => ({}),
  loadOptions: (w, projectId) => raiseOptions(w, projectId, 'cap-table').then((r) => ({ prospect_id: { opts: [NO_PROSPECT, ...chipsOf(r?.prospects)] } })),
  toBody: (v) => sentOnly(v, {
    name: str(v.name), shares: str(v.shares) ? wholeOf(v.shares) : null, amount_cents: scaledCents(v.amount), cap_cents: scaledCents(v.cap),
    discount_pct: toNumber(v.discount_pct), prospect_id: posId(v.prospect_id),
  }, [], { amount_cents: 'amount', cap_cents: 'cap' }),
  submit: (w, projectId, id, v) => w.raise.holderUpdate(projectId, id, editHolder.toBody(v)),
};

// Use of funds' Edit is its Add: the PUT replaces the split, and the form opens
// with the stored one every time, so it keeps "Edit split" and "Save split".
const editSplit = {
  ...useOfFunds,
  idOf: (row) => { const key = String(recordEdit(row) ? row.id : ''); return FUND_SECTIONS.some(([k]) => k === key) ? key : null; },
  valuesOf: () => ({}),
  loadOptions: (w, projectId) => splitOptions(w, projectId),
  submit: (w, projectId, _id, v) => useOfFunds.submit(w, projectId, v),
};

const PROSPECT_CARRIED = ['name', 'stage'];
const editProspect = {
  ...EDIT,
  key: 'edit-investor',
  title: 'Edit investor',
  sub: 'Its stage, how you reach them, the next step and your notes.',
  fields: [
    { kind: 'T', name: 'name', k: 'Investor', max: 200 },
    { kind: 'T', name: 'email', k: 'Email', input: 'email', max: 200 },
    { ...bare(prospect.fields[1]), required: true },
    { kind: 'T', name: 'warm_path', k: 'Warm path', ph: 'Who can introduce you', max: 300 },
    nextStep,
    prospect.fields[4],
  ],
  idOf: recordNumber,
  valuesOf: () => ({}),
  toBody: (v) => sentOnly(v, {
    name: str(v.name), email: str(v.email), stage: v.stage || null, warm_path: str(v.warm_path),
    next_step: str(v.next_step), next_step_due: str(v.next_step_due), notes: str(v.notes),
  }, PROSPECT_CARRIED),
  submit: (w, projectId, id, v) => w.raise.prospectUpdate(projectId, id, editProspect.toBody(v)),
};

const editFormationStep = {
  ...EDIT,
  key: 'edit-formation-step',
  title: 'Edit formation step',
  lead: 'Its name, its date and where it stands. A step the Lab or a filing obligation tracks is changed where it lives.',
  fields: [
    { name: 'title', label: 'Step', type: 'text', required: true, max: 200 },
    { name: 'due_date', label: 'Due', type: 'date' },
    { name: 'state', label: 'State', type: 'select', required: true, options: opts([['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']]) },
  ],
  // Only `step-<id>` rows are formation steps; Lab steps and obligations share the table.
  idOf: buildId('step-'),
  valuesOf: (row) => { const e = growEdit(row); return e ? { ...e, title: asText(e.title), due_date: dateText(e.due_date), state: asText(e.state) } : { title: asText(row?.cells?.filing), due_date: dateText(row?.cells?.due), state: asText(row?.cells?.state) }; },
  toBody: (v) => ({ title: str(v.title), due_date: str(v.due_date), state: v.state }),
  submit: (w, projectId, id, v) => w.build.formationStepUpdate(projectId, id, editFormationStep.toBody(v)),
};

const editMustHave = {
  ...EDIT,
  key: 'edit-must-have',
  title: 'Edit must-have',
  lead: 'Its date, or take it off the must-haves. The feature stays in your MVP scope.',
  fields: [
    { name: 'is_must_have', label: 'Must-have for the MVP', type: 'select', required: true, options: YES_NO },
    { name: 'due_date', label: 'Due', type: 'date' },
  ],
  idOf: buildId(''),
  valuesOf: (row) => { const e = growEdit(row); return e ? { ...e, is_must_have: 'yes', due_date: dateText(e.due_date) } : { is_must_have: 'yes', due_date: dateText(row?.cells?.due) }; },
  toBody: (v) => ({ is_must_have: v.is_must_have === 'yes', due_date: str(v.due_date) }),
  submit: (w, projectId, id, v) => w.build.feature(projectId, id, editMustHave.toBody(v)),
};

const editFeature = {
  ...EDIT,
  key: 'edit-feature',
  button: 'Mark',
  title: 'Must-have or not',
  lead: 'A must-have is a feature the MVP cannot ship without. Marked ones are listed under Prototype / MVP.',
  fields: [
    { name: 'is_must_have', label: 'Must-have for the MVP', type: 'select', required: true, options: YES_NO },
  ],
  idOf: buildId(''),
  // The feature table does not carry the mark, so nothing is pre-chosen.
  valuesOf: () => ({ is_must_have: '' }),
  toBody: (v) => ({ is_must_have: v.is_must_have === 'yes' }),
  submit: (w, projectId, id, v) => w.build.feature(projectId, id, editFeature.toBody(v)),
};

/** The Edit forms, by cycle and module slug. A slug not here draws no Edit. */
// D686 §5.4 (#1597): a core system's connector, on Operating systems' rows.
// The row's id is its kind (`cycle_build.ts` records each system by kind).
export const SYSTEM_KINDS = ['bank', 'accounting', 'payroll', 'crm', 'workspace'];
const SYSTEM_LABEL = { bank: 'Bank', accounting: 'Accounting', payroll: 'Payroll', crm: 'CRM', workspace: 'Workspace' };
export const UNMAP = 'none';
const connectHref = (projectId) => {
  const id = Number(projectId);
  return Number.isSafeInteger(id) && id > 0 ? `/build/connect?project_id=${id}` : '/build/connect';
};

/**
 * The select's options for one kind, from `GET /systems/choices`, plus
 * unmapping. The no-choice note's link keeps the venture (`project_id`).
 */
export function systemOptions(read, kind, projectId = null) {
  const entry = (Array.isArray(read?.kinds) ? read.kinds : []).find((k) => k?.kind === kind);
  const choices = (Array.isArray(entry?.choices) ? entry.choices : []).map((c) => (c?.uid
    ? { value: `uid:${c.uid}`, label: c.display_name || c.provider_key || 'Connector' }
    : c?.provider_key ? { value: `provider:${c.provider_key}`, label: c.display_name || c.provider_key } : null)).filter(Boolean);
  const label = entry?.label || SYSTEM_LABEL[kind] || kind;
  return {
    // Unmapping Workspace deletes its row (cycle_build.ts), Used by with it; the choice says so (#1597).
    options: [...choices, { value: UNMAP, label: kind === 'workspace' ? '— None (removes Workspace, Used by included) —' : '— None (unmap) —' }],
    note: choices.length ? null : { text: `No connected ${label} tool is enabled for this company.`, href: connectHref(projectId) },
  };
}

const editSystem = {
  key: 'edit-system', cta: 'Save',
  button: 'Choose connector',
  title: 'Choose a connector',
  lead: 'Which of your connected tools is this system, and who uses it. Only connections enabled for this project’s company are offered.',
  fields: [
    { name: 'choice', label: 'Connector', type: 'select', required: true, options: [], optionsFrom: 'systems' },
    { name: 'used_by', label: 'Used by', type: 'text', max: 200 },
  ],
  idOf: (row) => (SYSTEM_KINDS.includes(String(row?.id)) ? String(row.id) : null),
  valuesOf: (row) => { const e = growEdit(row); if (e) return { ...e, choice: '', used_by: asText(e.used_by) }; const u = row?.cells?.used_by; return { choice: '', used_by: typeof u === 'string' ? u : asText(u?.text) }; },
  // Loaded before the form draws: the choices for this row's kind.
  loadOptions: async (w, projectId, kind) => ({ choice: systemOptions(await w.build.systemChoices(projectId), kind, projectId) }),
  toBody: (v, kind) => {
    const usedBy = str(v.used_by);
    const choice = String(v.choice || '');
    const key = kind === 'workspace' ? 'provider_key' : 'integration_uid';
    if (choice === UNMAP) return { [key]: null, used_by: usedBy };
    if (choice.startsWith('uid:')) return { integration_uid: choice.slice(4), used_by: usedBy };
    if (choice.startsWith('provider:')) return { provider_key: choice.slice(9), used_by: usedBy };
    return { used_by: usedBy };
  },
  submit: (w, projectId, kind, v) => w.build.system(projectId, kind, editSystem.toBody(v, kind)),
  // A project with no company has no systems to map: the card is not_recorded.
  hiddenFor: (module) => module?.card?.state === 'not_recorded',
};

export const EDITS = {
  raise: {
    'investor-narrative': editNarrative,
    'pitch-deck': editLink,
    'data-room': editFile,
    'cap-table': editHolder,
    'use-of-funds': editSplit,
    'capital-relationships': editProspect,
  },
  grow: {
    'product-improvement': editFeedback,
    distribution: editChannel,
    'revenue-and-traction': enterKpi,
    'team-expansion': editRole,
    'partner-network': editPartner,
    'market-expansion': editMarket,
    'durable-company-building': editObligation,
  },
  build: {
    'solution-design': editFeature,
    'prototype-mvp': editMustHave,
    'company-creation': editFormationStep,
    'operating-systems': editSystem,
  },
};

/** The Edit form for a cycle's module, or null. Own entries only, as `formFor`. */
export function editFor(cycle, slug) {
  const byCycle = Object.prototype.hasOwnProperty.call(EDITS, cycle) ? EDITS[cycle] : null;
  return byCycle && Object.prototype.hasOwnProperty.call(byCycle, slug) ? byCycle[slug] : null;
}

// ---------- Validate (routes/cycle_validate.ts, D690 #1692) ------------------
//
// D695 PR 2a (#1656): the five canvas forms (CO:306-310) and their Edits, as
// specs in the canvas's T, CH and CK kinds. Each body is the one its route on
// `main` takes, and each Edit sends only that route's PATCH fields. PR 2b
// registers them as `FORMS.validate` and `EDITS.validate`, with the
// `validate` write group they call. A chip set read from `form-options` names
// its key in `optionsFrom`, and the form's `loadOptions` fills it; before the
// read answers, or with nothing recorded, it draws its "None yet" chip or its
// empty sentence (decision 4).

const NONE_YET = { value: '', label: 'None yet' };
/** A whole-number id as typed or chosen; null when there is none. */
const idOrNull = (v) => (/^[1-9]\d*$/.test(String(v ?? '')) ? Number(v) : null);
const checked = (v, value) => Array.isArray(v) && v.includes(value);

const SEVERITY = [{ value: 'mild', label: 'Mild' }, { value: 'real', label: 'Real' }, { value: 'severe', label: 'Severe' }];
const severityField = {
  kind: 'CH', name: 'severity', k: 'How severe', opts: SEVERITY, def: 1,
  // Decision 8: the writer sets the level on quotes no one has judged yet.
  note: 'Mild: a nuisance. Real: costs time or money. Severe: blocks the job. Applies to quotes not judged yet.',
};
/** A quote chip's value: the interview's id and the phrase it recorded. */
export const quoteValue = (interviewId, phrase) => `${interviewId}:${phrase}`;
const quoteOf = (value) => {
  const s = String(value ?? '');
  const at = s.indexOf(':');
  const id = idOrNull(s.slice(0, at));
  return at > 0 && id != null && s.slice(at + 1) ? { interview_id: id, phrase: s.slice(at + 1) } : null;
};

const chipList = (list) => (Array.isArray(list) ? list : []).filter((o) => o && o.value != null && o.value !== '')
  .map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/**
 * New theme's choices (#1692's form-options): each quote as its interview and
 * phrase (the Worker's own value is `<id>|<phrase>`), unthemed ones checked
 * and a themed one's meta the Worker's "in <theme>",
 * with the count of those waiting; then None yet and the hypotheses.
 */
export function themeOptions(read) {
  const quotes = (Array.isArray(read?.quotes) ? read.quotes : []).filter((x) => idOrNull(x?.interview_id) != null && typeof x?.phrase === 'string' && x.phrase)
    .map((x) => ({ value: quoteValue(x.interview_id, x.phrase), label: String(x.label ?? x.phrase), meta: x.theme ? String(x.theme) : 'unthemed', checked: !x.theme }));
  const waiting = Number(read?.unthemed_total);
  return {
    quotes: { options: quotes, ...(waiting > 0 ? { note: `${plural(waiting, 'unthemed quote is', 'unthemed quotes are')} waiting.` } : {}) },
    hypothesis_id: { options: [NONE_YET, ...chipList(read?.hypotheses)] },
  };
}

const theme = {
  key: 'theme', cta: 'Create theme', button: 'Create theme',
  title: 'New theme',
  sub: 'A pain theme groups quotes that describe the same problem.',
  foot: 'Quotes keep their interview and consent.',
  fields: [
    { kind: 'T', name: 'title', k: 'Theme', ph: 'Name the pain in the customer’s words', required: true, max: 120 },
    severityField,
    // The note counts the waiting quotes only once a read says how many (decision 3).
    { kind: 'CK', name: 'quotes', k: 'Quotes to attach', opts: [], optionsFrom: 'quotes', empty: 'No unthemed quotes recorded yet.' },
    { kind: 'CH', name: 'hypothesis_id', k: 'Feeds hypothesis', opts: [NONE_YET], def: 0, optionsFrom: 'hypotheses' },
  ],
  toBody: (v) => ({
    title: str(v.title), severity: v.severity || null,
    quotes: (Array.isArray(v.quotes) ? v.quotes : []).map(quoteOf).filter(Boolean),
    hypothesis_id: idOrNull(v.hypothesis_id),
  }),
  loadOptions: (w, projectId) => w.formOptions('validate', projectId, 'problem-discovery').then(themeOptions),
  submit: (w, projectId, v) => w.validate.theme(projectId, theme.toBody(v)),
};

const URGENCY = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }];
const SINCE = 'since';
const segmentFields = [
  { kind: 'T', name: 'name', k: 'Segment', ph: 'Segment name', required: true, max: 120 },
  { kind: 'T', name: 'who_they_are', k: 'Who they are', ph: 'Role at company type, size, where', max: 1000 },
  { kind: 'T', name: 'job_to_be_done', k: 'Job to be done', ph: 'What they are trying to get done', max: 1000 },
  { kind: 'CH', name: 'urgency', k: 'Urgency', opts: URGENCY, def: 2 },
  { kind: 'T', name: 'value_promised', k: 'Value promised', ph: 'What changes for them', max: 1000 },
  { kind: 'CH', name: 'score_against', k: 'Score against', opts: [{ value: 'all', label: 'All interviews' }, { value: SINCE, label: 'Interviews since a date' }], def: 0 },
  // The second chip reveals its date (decision 2).
  { kind: 'T', name: 'score_since', k: 'Interviews since', input: 'date', required: true, when: { name: 'score_against', value: SINCE } },
];
const segmentBody = (v) => ({
  name: str(v.name), who_they_are: str(v.who_they_are), job_to_be_done: str(v.job_to_be_done),
  urgency: v.urgency || null, value_promised: str(v.value_promised),
  score_since: v.score_against === SINCE ? str(v.score_since) : null,
});
const segment = {
  key: 'segment', cta: 'Create segment', button: 'Create segment',
  title: 'New segment',
  sub: 'A segment is one answer to who the customer is. Compare several.',
  foot: 'Interviews are listed against it with their ICP fit.',
  fields: segmentFields,
  toBody: segmentBody,
  submit: (w, projectId, v) => w.validate.segment(projectId, segment.toBody(v)),
};

const COMPETITOR_KIND = [{ value: 'direct', label: 'Direct' }, { value: 'adjacent', label: 'Adjacent' }];
const WATCH = [
  { value: 'funding', label: 'Funding', meta: 'rounds and amounts', checked: true },
  { value: 'launch', label: 'Launches', meta: 'products and features', checked: true },
  { value: 'hiring', label: 'Hires', meta: 'roles and team size', checked: false },
];
const kindField = { kind: 'CH', name: 'kind', k: 'Kind', opts: COMPETITOR_KIND, def: 0, note: 'Direct: solves the same problem for the same customer. Adjacent: one of the two.' };
const watchField = { kind: 'CK', name: 'watch', k: 'Watch for', opts: WATCH };
const whyField = { kind: 'T', name: 'why', k: 'Why it matters', ph: 'One line, optional', max: 1000 };
const watchBody = (v) => Object.fromEntries(WATCH.map((o) => [o.value, checked(v.watch, o.value)]));
/**
 * Add competitor's search (decision 8): first the caller's own analyses'
 * candidates whose name holds what is typed, sent as `company_ref`; then the
 * Research › Companies matches the read gives for it, sent as `directory_uid`.
 * Each group is drawn under a label naming its source.
 */
export function companyMatches(read, q) {
  const typed = String(q ?? '').trim().toLowerCase();
  const own = chipList(read?.candidates).filter((o) => o.label.toLowerCase().includes(typed))
    .map((o) => ({ ...o, into: 'company_ref', group: 'Your competitor analyses' }));
  const directory = chipList(read?.directory).map((o) => ({ ...o, into: 'directory_uid', group: 'Research › Companies' }));
  return [...own, ...directory];
}

const competitor = {
  key: 'competitor', cta: 'Add competitor', button: 'Add competitor',
  title: 'Add competitor',
  sub: 'Tracked from Research › Companies, or added by name.',
  foot: 'Signals appear as you record them or re-run the analysis.',
  fields: [
    // A search box (decision 8): PR 2b's picker sets `company_ref` for one of
    // the caller's own candidates, or `directory_uid` for a Research match;
    // otherwise the typed name is sent.
    { kind: 'T', name: 'company', k: 'Company', ph: 'Search Research › Companies, or type a name', required: true, max: 120, search: { into: 'company_ref' } },
    kindField, watchField, whyField,
  ],
  // The route takes exactly one of the three keys.
  toBody: (v) => {
    const picked = str(v.company_ref) ? { company_ref: str(v.company_ref) }
      : str(v.directory_uid) ? { directory_uid: str(v.directory_uid) } : { name: str(v.company) };
    return { ...picked, kind: v.kind || 'direct', watch: watchBody(v), why: str(v.why) };
  },
  search: (w, projectId, q) => w.formOptions('validate', projectId, 'market-intelligence', { q }).then((read) => companyMatches(read, q)),
  submit: (w, projectId, v) => w.validate.competitor(projectId, competitor.toBody(v)),
};

const SIGNAL_KIND = [
  { value: 'need_to_have', label: 'Need-to-have mention' }, { value: 'waitlist', label: 'Waitlist sign-up' },
  { value: 'pre_sale', label: 'Pre-sale' }, { value: 'loi', label: 'Letter of intent' },
];
/** The kinds the route takes an amount for (`writeDemandSignal`). */
export const AMOUNT_KINDS = ['pre_sale', 'loi'];
const SIGNAL_STATUS = [{ value: 'confirmed', label: 'Confirmed' }, { value: 'to_confirm', label: 'To confirm' }];
const signalFields = [
  { kind: 'CH', name: 'kind', k: 'Kind', opts: SIGNAL_KIND, def: 2, required: true },
  { kind: 'T', name: 'who', k: 'Who', ph: 'Customer, lead or interviewee', max: 200 },
  { kind: 'T', name: 'amount', k: 'Amount', input: 'money', ph: '$1,200 · pre-sales and letters of intent only', when: (v) => AMOUNT_KINDS.includes(v.kind) },
  { kind: 'T', name: 'signal_date', k: 'Date', input: 'date', ph: '12 Oct' },
  { kind: 'CH', name: 'status', k: 'Status', opts: SIGNAL_STATUS, def: 0, note: 'To confirm: said, not yet in writing.' },
];
// A hidden Amount is not submitted, so a kind that takes none sends null.
const signalBody = (v) => {
  const amount = AMOUNT_KINDS.includes(v.kind) ? toCents(v.amount) : null;
  return { kind: v.kind || null, who: str(v.who), amount_cents: amount, currency: amount == null ? null : 'usd', signal_date: str(v.signal_date), status: v.status || null };
};
const signal = {
  key: 'signal', cta: 'Record signal', button: 'Record signal',
  title: 'Record a signal',
  sub: 'Evidence that someone wants this, with its date.',
  foot: 'Waitlist sign-ups count toward the bar you set.',
  fields: signalFields,
  toBody: signalBody,
  submit: (w, projectId, v) => w.validate.signal(projectId, signal.toBody(v)),
};

const DIRECTION = [{ value: 'supports', label: 'Supporting' }, { value: 'contradicts', label: 'Contradicting' }];
const claimFields = [
  { kind: 'T', name: 'claim', k: 'Claim', ph: 'We believe that …', h: '56px', required: true, max: 500 },
  { kind: 'T', name: 'success_bar', k: 'What would prove it', ph: 'Success bar · e.g. 5 of 8 interviewees …', max: 500 },
  { kind: 'T', name: 'disproof', k: 'What would disprove it', ph: 'Condition', max: 500 },
];
// Two boxes on one row (decision 2): the owner is a member the route accepts.
const ownerDeadline = {
  name: 'owner_deadline', k: 'Owner · deadline', parts: [
    { kind: 'CH', name: 'owner_user_id', k: 'Owner', opts: [], optionsFrom: 'owners', empty: 'No owner to choose yet.' },
    { kind: 'T', name: 'deadline', k: 'Deadline', input: 'date', ph: '31 Oct' },
  ],
};
/** New hypothesis's and Edit hypothesis's choices: the venture's pain themes and the members who can own it. */
export const hypothesisOptions = (read) => ({ pain_group_id: { options: chipList(read?.themes) }, owner_user_id: { options: chipList(read?.owners) } });

const hypothesis = {
  key: 'hypothesis', cta: 'Create hypothesis', button: 'Create hypothesis',
  title: 'New hypothesis',
  sub: 'A claim you most need to be true, and how you would know.',
  foot: 'Its status comes from the evidence linked to it.',
  fields: [
    ...claimFields,
    // Optional, and empty until themes are recorded (decision 4).
    { kind: 'CH', name: 'pain_group_id', k: 'Pain themes it links to', opts: [], optionsFrom: 'themes', empty: 'No pain themes recorded yet.' },
    { kind: 'CH', name: 'direction', k: 'Direction', opts: DIRECTION, def: 0 },
    ownerDeadline,
  ],
  toBody: (v) => {
    const linked = idOrNull(v.pain_group_id);
    const owner = idOrNull(v.owner_user_id);
    return {
      claim: str(v.claim), success_bar: str(v.success_bar), disproof: str(v.disproof),
      pain_group_ids: linked == null ? [] : [linked], direction: v.direction || 'supports',
      ...(owner == null ? {} : { owner_user_id: owner }), deadline: str(v.deadline),
    };
  },
  loadOptions: (w, projectId) => w.formOptions('validate', projectId, 'experiments').then(hypothesisOptions),
  submit: (w, projectId, v) => w.validate.hypothesis(projectId, hypothesis.toBody(v)),
};

/** Validate's Add forms, by module slug, registered as `FORMS.validate`. */
export const VALIDATE_FORMS = {
  'problem-discovery': [theme],
  'ideal-customer-profile': [segment],
  'market-intelligence': [competitor],
  'demand-signals': [signal],
  experiments: [hypothesis],
};

// The Edits (decision 7): the Add form's fields its PATCH takes, titled
// "Edit <noun>", with "Save". A record's id is its own `id`, or the `edit`'s.
const recordId = (pattern) => (row) => {
  const id = String(growEdit(row)?.id ?? row?.id ?? '');
  return pattern.test(id) ? id : null;
};
/** The current values a row's `edit` carries for these fields, and no others. */
const carried = (names) => (row) => {
  const e = growEdit(row) || {};
  return Object.fromEntries(names.filter((n) => Object.hasOwn(e, n) && e[n] != null).map((n) => [n, e[n]]));
};

/**
 * An Edit form with only the fields its current values carry (decision 7), so
 * a save never blanks a stored value it did not show. A paired field keeps
 * the parts that are carried; one with none left goes.
 */
export function editFieldsFor(form, current) {
  const has = (f) => current != null && Object.hasOwn(current, f.name);
  const keep = (fields) => (fields || []).flatMap((f) => {
    if (Array.isArray(f.parts)) { const parts = keep(f.parts); return parts.length ? [{ ...f, parts }] : []; }
    // A revealed box stays with the field that reveals it (Interviews since with Score against).
    return has(f) || (f.when && typeof f.when === 'object' && has({ name: f.when.name })) ? [f] : [];
  });
  return form ? { ...form, fields: keep(form.fields) } : form;
}
/**
 * Only the keys of a body whose field was submitted (a shown field, after
 * `editFieldsFor`): an Edit sends nothing else. `from` names a key's field
 * where they differ.
 */
const onlyShown = (v, body, from = {}) => Object.fromEntries(Object.entries(body).filter(([k]) => Object.hasOwn(v, from[k] ?? k)));

/**
 * Validate's rows carry no `edit`, so each Edit opens from its record's own
 * Edit action (#1658's `cyclesApi.record`), on a row or the record page: its
 * values go through `valuesOf` as the row's `edit`, then `editFieldsFor`
 * (`recordModel.js`'s `recordFormFor`).
 */
const FROM_RECORD = { readsRecord: true };

const editTheme = {
  ...EDIT, ...FROM_RECORD,
  key: 'edit-theme', title: 'Edit theme', sub: theme.sub,
  fields: [theme.fields[0], severityField],
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: carried(['title', 'severity']),
  toBody: (v) => onlyShown(v, { title: str(v.title), severity: v.severity || null }),
  submit: (w, projectId, id, v) => w.validate.themeUpdate(projectId, id, editTheme.toBody(v)),
};

const editSegment = {
  ...EDIT, ...FROM_RECORD,
  key: 'edit-segment', title: 'Edit segment', sub: segment.sub,
  fields: segmentFields,
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: (row) => {
    const v = carried(['name', 'who_they_are', 'job_to_be_done', 'urgency', 'value_promised', 'score_since'])(row);
    if (Object.hasOwn(growEdit(row) || {}, 'score_since')) v.score_against = v.score_since ? SINCE : 'all';
    if (v.score_since) v.score_since = dateText(v.score_since);
    return v;
  },
  toBody: (v) => onlyShown(v, segmentBody(v), { score_since: 'score_against' }),
  submit: (w, projectId, id, v) => w.validate.segmentUpdate(projectId, id, editSegment.toBody(v)),
};

const editCompetitor = {
  ...EDIT, ...FROM_RECORD,
  key: 'edit-competitor', title: 'Edit competitor', sub: competitor.sub,
  fields: [kindField, watchField, whyField],
  // A candidate id the record route takes (D690 decision 4).
  idOf: recordId(/^[a-z0-9][a-z0-9_-]*$/),
  valuesOf: (row) => {
    const e = growEdit(row) || {};
    const v = carried(['kind', 'why'])(row);
    // The record's Edit gives the keys watched; a row gave the three switches.
    if (Array.isArray(e.watch)) v.watch = WATCH.map((o) => o.value).filter((k) => e.watch.includes(k));
    else if (e.watch && typeof e.watch === 'object') v.watch = WATCH.map((o) => o.value).filter((k) => e.watch[k] === true);
    return v;
  },
  toBody: (v) => onlyShown(v, { kind: v.kind || 'direct', watch: watchBody(v), why: str(v.why) }),
  submit: (w, projectId, id, v) => w.validate.competitorUpdate(projectId, id, editCompetitor.toBody(v)),
};

const editSignal = {
  ...EDIT, ...FROM_RECORD,
  key: 'edit-signal', title: 'Edit signal', sub: signal.sub,
  fields: signalFields,
  // Only a `signal-` record is the founder's own (a `revenue-` or `waitlist-` one is not).
  idOf: recordId(/^signal-[1-9]\d*$/),
  valuesOf: (row) => {
    const e = growEdit(row) || {};
    const v = carried(['kind', 'who', 'signal_date', 'status'])(row);
    if (v.signal_date) v.signal_date = dateText(v.signal_date);
    // The record's Edit gives no amount as '', which is no amount, not 0.
    if (Object.hasOwn(e, 'amount_cents')) v.amount = e.amount_cents == null || e.amount_cents === '' ? '' : String(Number(e.amount_cents) / 100);
    return v;
  },
  // An amount is sent when its box was shown, and cleared when the kind takes none.
  toBody: (v) => {
    const body = onlyShown(v, signalBody(v), { amount_cents: 'amount', currency: 'amount' });
    if (Object.hasOwn(v, 'kind') && !AMOUNT_KINDS.includes(v.kind)) Object.assign(body, { amount_cents: null, currency: null });
    return body;
  },
  submit: (w, projectId, id, v) => w.validate.signalUpdate(projectId, id, editSignal.toBody(v)),
};

const editHypothesis = {
  ...EDIT, ...FROM_RECORD,
  key: 'edit-hypothesis', title: 'Edit hypothesis', sub: hypothesis.sub,
  // Its pain links and direction are the record's own section (D690), not PATCH fields.
  fields: [...claimFields, ownerDeadline],
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: (row) => {
    const v = carried(['claim', 'success_bar', 'disproof', 'owner_user_id', 'deadline'])(row);
    if (v.deadline) v.deadline = dateText(v.deadline);
    return v;
  },
  toBody: (v) => {
    const body = { claim: str(v.claim), success_bar: str(v.success_bar), disproof: str(v.disproof), deadline: str(v.deadline), owner_user_id: idOrNull(v.owner_user_id) };
    return onlyShown(v, body);
  },
  loadOptions: (w, projectId) => w.formOptions('validate', projectId, 'experiments').then((read) => ({ owner_user_id: hypothesisOptions(read).owner_user_id })),
  submit: (w, projectId, id, v) => w.validate.hypothesisUpdate(projectId, id, editHypothesis.toBody(v)),
};

/** Validate's Edit forms, by module slug, registered as `EDITS.validate`. */
export const VALIDATE_EDITS = {
  'problem-discovery': editTheme,
  'ideal-customer-profile': editSegment,
  'market-intelligence': editCompetitor,
  'demand-signals': editSignal,
  experiments: editHypothesis,
};

// Registered here, after the specs, since `FORMS` and `EDITS` are declared
// above them. #1704 adds Verdict's `verdict` to `FORMS.validate`.
FORMS.validate = { ...VALIDATE_FORMS };
EDITS.validate = { ...VALIDATE_EDITS };

// ---------- Build (routes/cycle_build.ts, D690 #1695) ------------------------
//
// D695 PR 3a (#1656): Build's six canvas forms (CO:311-316) and their Edits,
// as specs in the canvas's T, CH and CK kinds, each body the one #1695's write
// table gives. They are registered nowhere (decision 15), and today's Build
// forms stay as they are: PR 3b adds the client methods each `submit` names,
// the chip loaders and the registration, after #1695's closing PR brings the
// roadmap and formation-step routes and Build's `form-options`.

/** A number as typed ("40", "40%"); null when empty; NaN when not a number. */
const numberOf = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[%,\s]/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
};
const NOTHING = { value: '', label: 'Nothing' };
const NONE_CHIP = { value: '', label: 'None' };
const LEVEL = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }];
// A two-part owner box (decision 2): a member the route accepts, then a date.
const ownerPart = { kind: 'CH', name: 'owner_user_id', k: 'Owner', opts: [], optionsFrom: 'owners', empty: 'No member to choose yet.' };
const buildHypothesis = { kind: 'CH', name: 'hypothesis_id', k: 'Tests hypothesis', opts: [NONE_YET], def: 0, optionsFrom: 'hypotheses' };

const featureFields = [
  { kind: 'T', name: 'title', k: 'Feature', ph: 'What it lets the customer do', required: true, max: 200 },
  // "None yet" sits last, as the canvas draws it; a loader puts the themes before it.
  { kind: 'CH', name: 'pain_group_id', k: 'Answers pain theme', opts: [NONE_YET], def: 0, optionsFrom: 'pain_themes',
    note: 'Pick None yet and the feature is flagged until you link it.' },
  buildHypothesis,
  { kind: 'CH', name: 'impact', k: 'Impact', opts: LEVEL, def: 2 },
  { kind: 'CH', name: 'effort', k: 'Effort', opts: LEVEL, def: 0 },
  { kind: 'CH', name: 'scope', k: 'Scope', opts: [{ value: 'core', label: 'Core' }, { value: 'out', label: 'Out of scope' }], def: 0 },
];
const featureBody = (v) => ({
  title: str(v.title), pain_group_id: idOrNull(v.pain_group_id), hypothesis_id: idOrNull(v.hypothesis_id),
  impact: v.impact || null, effort: v.effort || null, scope: v.scope || null,
});
const buildFeature = {
  key: 'feature', cta: 'Add feature', button: 'Add feature',
  title: 'Add feature',
  sub: 'A feature answers a pain theme and tests a hypothesis. One that links to nothing is flagged.',
  foot: 'Counted on Solution design’s chart as linked or unlinked.',
  fields: featureFields,
  toBody: featureBody,
  submit: (w, projectId, v) => w.build.addFeature(projectId, buildFeature.toBody(v)),
};

const MVP_STATE = [{ value: 'not_started', label: 'Not started' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' }, { value: 'blocked', label: 'Blocked' }];
const LINKS = [{ value: 'figma', label: 'Figma file', meta: 'design' }, { value: 'github', label: 'GitHub issue', meta: 'code' }];
const ownerDue = { name: 'owner_due', k: 'Owner · due', parts: [ownerPart, { kind: 'T', name: 'due_date', k: 'Due', input: 'date', ph: '8 Nov' }] };
const mustHaveFields = [
  { kind: 'T', name: 'title', k: 'Must-have', ph: 'What must work', required: true, max: 200 },
  buildHypothesis,
  { kind: 'CH', name: 'state', k: 'State', opts: MVP_STATE, def: 0 },
  ownerDue,
];
const mustHaveBody = (v) => {
  const owner = idOrNull(v.owner_user_id);
  return { title: str(v.title), hypothesis_id: idOrNull(v.hypothesis_id), state: v.state || null, ...(owner == null ? {} : { owner_user_id: owner }), due_date: str(v.due_date) };
};
const buildMustHave = {
  key: 'must-have', cta: 'Add must-have', button: 'Add must-have',
  title: 'Add must-have',
  sub: 'What has to work before the MVP ships.',
  foot: 'Counts toward the burn-up to the ship date.',
  fields: [
    ...mustHaveFields,
    // Each "Linked" check reveals its URL box (decision 2): an attached https link, not a sync.
    { kind: 'CK', name: 'linked', k: 'Linked', opts: LINKS },
    { kind: 'T', name: 'figma_url', k: 'Figma file URL', ph: 'https://www.figma.com/…', max: 1000, when: { name: 'linked', value: 'figma' } },
    { kind: 'T', name: 'github_url', k: 'GitHub issue URL', ph: 'https://github.com/…/issues/…', max: 1000, when: { name: 'linked', value: 'github' } },
  ],
  toBody: (v) => ({ ...mustHaveBody(v), links: LINKS.filter((l) => checked(v.linked, l.value)).map((l) => str(v[`${l.value}_url`])).filter(Boolean) }),
  submit: (w, projectId, v) => w.build.addMustHave(projectId, buildMustHave.toBody(v)),
};

const COLUMN = [{ value: 'now', label: 'Now' }, { value: 'next', label: 'Next' }, { value: 'later', label: 'Later' }];
const itemFields = [
  { kind: 'T', name: 'title', k: 'Item', ph: 'What ships', required: true, max: 200 },
  { kind: 'CH', name: 'column', k: 'Column', opts: COLUMN, def: 1 },
  { kind: 'CH', name: 'kpi_key', k: 'Moves KPI', opts: [NONE_CHIP], def: 0, optionsFrom: 'kpis' },
  { kind: 'CH', name: 'feedback_theme', k: 'Answers feedback theme', opts: [NONE_CHIP], def: 0, optionsFrom: 'feedback_themes' },
  { name: 'owner_date', k: 'Owner · date', parts: [ownerPart, { kind: 'T', name: 'target_date', k: 'Date', input: 'date', ph: 'Dec' }] },
];
const itemBody = (v) => {
  const owner = idOrNull(v.owner_user_id);
  return { title: str(v.title), column: v.column || null, kpi_key: str(v.kpi_key), feedback_theme: str(v.feedback_theme), ...(owner == null ? {} : { owner_user_id: owner }), target_date: str(v.target_date) };
};
const buildItem = {
  key: 'item', cta: 'Add item', button: 'Add item',
  title: 'Add item',
  sub: 'A roadmap item moves a KPI or answers a feedback theme.',
  foot: 'Issues from a connected GitHub repository land here too.',
  fields: [...itemFields, { kind: 'CH', name: 'waits_on_id', k: 'Waits on', opts: [NOTHING], def: 0, optionsFrom: 'roadmap_items' }],
  toBody: (v) => ({ ...itemBody(v), waits_on_id: idOrNull(v.waits_on_id) }),
  submit: (w, projectId, v) => w.build.roadmapItem(projectId, buildItem.toBody(v)),
};

const VESTING = [{ value: '4y_1y_cliff', label: '4 years, 1-year cliff' }, { value: '4y_no_cliff', label: '4 years, no cliff' }, { value: 'custom', label: 'Custom' }];
const founderFields = [
  { name: 'founder', k: 'Founder', parts: [
    { kind: 'T', name: 'name', k: 'Name', ph: 'Name', required: true, max: 200 },
    { kind: 'T', name: 'email', k: 'Email', input: 'email', ph: 'email', max: 320 },
  ] },
  { kind: 'T', name: 'role', k: 'Role', ph: 'CEO, CTO, …', max: 100 },
  // "unallocated now" is drawn only once `form-options` reads it (decision 3).
  { kind: 'T', name: 'equity_pct', k: 'Equity', ph: '40%' },
  { kind: 'CH', name: 'vesting', k: 'Vesting', opts: VESTING, def: 0 },
  { kind: 'T', name: 'total_months', k: 'Vesting months', input: 'number', required: true, when: { name: 'vesting', value: 'custom' } },
  { kind: 'T', name: 'cliff_months', k: 'Cliff months', input: 'number', required: true, when: { name: 'vesting', value: 'custom' } },
  { kind: 'T', name: 'vesting_start', k: 'Vesting starts', input: 'date', ph: '12 Mar 2026', required: true },
];
const founderCheck = (v) => {
  const e = numberOf(v.equity_pct);
  return Number.isNaN(e) || (e != null && (e <= 0 || e >= 100)) ? { equity_pct: 'Equity is a percentage between 0 and 100.' } : {};
};
const founderBody = (v) => ({
  name: str(v.name), email: str(v.email), role: str(v.role), equity_pct: numberOf(v.equity_pct),
  vesting: v.vesting || null, vesting_start: str(v.vesting_start),
  ...(v.vesting === 'custom' ? { total_months: numberOf(v.total_months), cliff_months: numberOf(v.cliff_months) } : {}),
});
const buildFounder = {
  key: 'founder', cta: 'Add founder', button: 'Add founder',
  title: 'Add founder',
  // Decision 8: nothing is drafted or sent for signature from here.
  sub: 'Role, equity and vesting. Then draft the agreement in the legal engine.',
  foot: 'Changes the unallocated share.',
  fields: [
    ...founderFields,
    // Founding team lists its founders from the cap table, so that check is locked (decision 11).
    { kind: 'CK', name: 'then', k: 'Then', opts: [
      { value: 'agreement', label: 'Draft the co-founder agreement', meta: 'in the legal engine', checked: true },
      { value: 'cap_table', label: 'Add to the cap table', meta: 'founder stock', checked: true, disabled: true },
    ] },
  ],
  check: founderCheck,
  toBody: founderBody,
  // The route returns the legal engine's link as `next`; the dialog shows it once saved.
  done: (result) => (result?.next?.href ? { text: 'Founder added to the cap table.', href: result.next.href } : null),
  submit: (w, projectId, v) => w.build.founder(projectId, buildFounder.toBody(v)),
};

const FILING = [
  { value: 'formation', label: 'Formation' }, { value: 'ein', label: 'EIN' }, { value: '83b', label: '83(b) election' },
  { value: 'annual_report', label: 'Annual report' }, { value: 'franchise_tax', label: 'Franchise tax' }, { value: 'other', label: 'Other' },
];
const FILING_STATE = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'filed', label: 'Filed' }, { value: 'due_soon', label: 'Due soon' }];
const filingFields = [
  { kind: 'CH', name: 'kind', k: 'Filing', opts: FILING, def: 2 },
  // The entity's jurisdiction joins Federal once `form-options` reads it.
  { kind: 'CH', name: 'jurisdiction', k: 'Jurisdiction', opts: [{ value: 'Federal', label: 'Federal' }, { value: '', label: 'Other' }], def: 0, optionsFrom: 'jurisdictions' },
  { kind: 'T', name: 'due_date', k: 'Due', input: 'date', ph: '11 Nov' },
  { kind: 'CH', name: 'for_holder_id', k: 'For', opts: [], optionsFrom: 'founders', empty: 'No founder recorded yet.', when: { name: 'kind', value: '83b' } },
  { kind: 'CH', name: 'state', k: 'State', opts: FILING_STATE, def: 0 },
];
const filingBody = (v) => ({
  kind: v.kind || null, jurisdiction: str(v.jurisdiction), due_date: str(v.due_date),
  for_holder_id: v.kind === '83b' ? str(v.for_holder_id) : null, state: v.state || null,
});
const buildFiling = {
  key: 'filing', cta: 'Add filing', button: 'Add filing',
  title: 'Add filing',
  sub: 'A filing with its jurisdiction, due date and proof.',
  // No foot: no job sends filing reminders (decision 8). Proof is the record's
  // Upload proof once #1658's record page is on main.
  fields: filingFields,
  toBody: filingBody,
  submit: (w, projectId, v) => w.build.formationStep(projectId, buildFiling.toBody(v)),
};

const SYSTEM = [{ value: 'bank', label: 'Bank' }, { value: 'accounting', label: 'Accounting' }, { value: 'payroll', label: 'Payroll' }, { value: 'crm', label: 'CRM' }, { value: 'workspace', label: 'Workspace' }];
const SYNC = [{ value: 'live', label: 'Live' }, { value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }, { value: 'manual', label: 'Manual' }];
const FEEDS = [
  { value: 'use_of_funds', label: 'Use of funds', meta: 'bank and accounting', checked: true },
  { value: 'kpis', label: 'KPIs', meta: 'accounting', checked: true },
  { value: 'team', label: 'Team', meta: 'payroll', checked: false },
];
const systemLabel = (kind) => SYSTEM.find((s) => s.value === kind)?.label ?? 'system';
/** The hand-off to Connect a tool (decision 10), for this venture and the chosen catalogue key. */
export function connectToolHref(projectId, tool) {
  const id = Number(projectId);
  const q = new URLSearchParams(Number.isSafeInteger(id) && id > 0 ? { project_id: String(id) } : {});
  if (/^[a-z0-9_-]{1,64}$/.test(String(tool ?? ''))) q.set('tool', String(tool));
  const s = q.toString();
  return `/build/connect${s ? `?${s}` : ''}`;
}
const buildSystem = {
  key: 'system', cta: 'Continue to sign-in', button: 'Connect a system',
  title: 'Connect a system',
  sub: 'Each system shows its state and last sync once connected.',
  foot: 'Opens the provider’s own sign-in.',
  fields: [
    // No Calendar (D-k): Calendar is the Workspace store.
    { kind: 'CH', name: 'system', k: 'System', opts: SYSTEM, def: 1 },
    // The catalogue providers `form-options` lists for the kind, never filtered here.
    { kind: 'CH', name: 'provider', k: 'Provider', opts: [], optionsFrom: 'providers', required: true, empty: 'No provider can be connected yet.',
      note: (v) => ({ text: `No ${systemLabel(v.system)} provider can be connected yet.`, href: '/build/connect' }) },
    // Workspace has no connection row, so it draws no Sync (decision 10).
    { kind: 'CH', name: 'sync', k: 'Sync', opts: SYNC, def: 2, when: (v) => v.system !== 'workspace' },
    { kind: 'CK', name: 'feeds', k: 'Feeds', opts: FEEDS },
  ],
  // Never a connector key: an absent key keeps a mapping (decision 10).
  toBody: (v) => ({ feeds: Array.isArray(v.feeds) ? v.feeds : [], ...(v.system !== 'workspace' && v.sync ? { sync: v.sync } : {}) }),
  // An unmapped Workspace has no row for Feeds, so it goes straight to the hand-off.
  async submit(w, projectId, v) {
    if (v.system !== 'workspace') await w.build.system(projectId, v.system, buildSystem.toBody(v));
    return { next: connectToolHref(projectId, v.provider) };
  },
  done: (result) => (result?.next ? { text: 'Continue to the provider’s sign-in.', href: result.next } : null),
};

/** Build's Add forms, by module slug (PR 3b registers them as `FORMS.build`). */
export const BUILD_FORMS = {
  'solution-design': [buildFeature],
  'prototype-mvp': [buildMustHave],
  'product-roadmap': [buildItem],
  'founding-team': [buildFounder],
  'company-creation': [buildFiling],
  'operating-systems': [buildSystem],
};

// The Edits (decision 7): the Add's fields each PATCH takes. A record's or a
// row's `edit` carries the current values (#1695, decision 13).
const editBuildFeature = {
  ...EDIT,
  key: 'edit-feature', title: 'Edit feature', sub: buildFeature.sub,
  fields: [...featureFields, { kind: 'CH', name: 'is_must_have', k: 'Must-have for the MVP', opts: YES_NO }],
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: (row) => {
    const v = carried(['title', 'pain_group_id', 'hypothesis_id', 'impact', 'effort', 'scope', 'is_must_have'])(row);
    if (Object.hasOwn(v, 'is_must_have')) v.is_must_have = v.is_must_have === true || Number(v.is_must_have) === 1 ? 'yes' : 'no';
    return v;
  },
  toBody: (v) => onlyShown(v, { ...featureBody(v), is_must_have: v.is_must_have === 'yes' }),
  submit: (w, projectId, id, v) => w.build.feature(projectId, id, editBuildFeature.toBody(v)),
};

// Linked, Waits on and Proof are the record's own sections (#1695), so no Edit carries them.
const editBuildMustHave = {
  ...EDIT,
  key: 'edit-must-have', title: 'Edit must-have', sub: buildMustHave.sub,
  fields: mustHaveFields,
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: (row) => {
    const v = carried(['title', 'hypothesis_id', 'state', 'owner_user_id', 'due_date'])(row);
    if (v.due_date) v.due_date = dateText(v.due_date);
    return v;
  },
  toBody: (v) => onlyShown(v, { ...mustHaveBody(v), owner_user_id: idOrNull(v.owner_user_id) }),
  submit: (w, projectId, id, v) => w.build.feature(projectId, id, editBuildMustHave.toBody(v)),
};

const editBuildItem = {
  ...EDIT,
  key: 'edit-item', title: 'Edit item', sub: buildItem.sub,
  fields: itemFields,
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: (row) => {
    const v = carried(['title', 'column', 'kpi_key', 'feedback_theme', 'owner_user_id', 'target_date'])(row);
    if (v.target_date) v.target_date = dateText(v.target_date);
    return v;
  },
  toBody: (v) => onlyShown(v, { ...itemBody(v), owner_user_id: idOrNull(v.owner_user_id) }),
  submit: (w, projectId, id, v) => w.build.roadmapItemUpdate(projectId, id, editBuildItem.toBody(v)),
};

const editBuildFounder = {
  ...EDIT,
  key: 'edit-founder', title: 'Edit founder', sub: buildFounder.sub,
  fields: founderFields,
  check: founderCheck,
  // A cap-table register row, as the record route addresses it.
  idOf: recordId(/^h-[1-9]\d*$/),
  valuesOf: (row) => {
    const v = carried(['name', 'email', 'role', 'equity_pct', 'vesting', 'total_months', 'cliff_months', 'vesting_start'])(row);
    if (v.vesting_start) v.vesting_start = dateText(v.vesting_start);
    return v;
  },
  toBody: (v) => onlyShown(v, founderBody(v)),
  submit: (w, projectId, id, v) => w.build.founderUpdate(projectId, id, editBuildFounder.toBody(v)),
};

const editBuildFiling = {
  ...EDIT,
  key: 'edit-filing', title: 'Edit filing', sub: buildFiling.sub,
  fields: filingFields,
  // Only `step-<id>` rows are the venture's own filings; Lab steps and obligations are changed where they live.
  idOf: buildId('step-'),
  valuesOf: (row) => {
    const v = carried(['kind', 'jurisdiction', 'due_date', 'for_holder_id', 'state'])(row);
    if (v.due_date) v.due_date = dateText(v.due_date);
    return v;
  },
  toBody: (v) => onlyShown(v, filingBody(v)),
  submit: (w, projectId, id, v) => w.build.formationStepUpdate(projectId, id, editBuildFiling.toBody(v)),
};

/** Build's Edit forms, by module slug. Operating systems keeps today's Choose connector (decision 10). */
export const BUILD_EDITS = {
  'solution-design': editBuildFeature,
  'prototype-mvp': editBuildMustHave,
  'product-roadmap': editBuildItem,
  'founding-team': editBuildFounder,
  'company-creation': editBuildFiling,
};

// ---------- Fields: today's types and the canvas's kinds ---------------------
//
// D695 decision 2: a field is today's `{ name, label, type }`, or the
// canvas's `{ name, kind: 'T'|'CH'|'CK', k, opts?, def?, input?, parts?, when? }`.
// CH is one choice from its options, CK any number of them (an array), and T a
// box whose `input` (text, date, money, score, email, file) is today's `type`.
// A `parts` field is two boxes on one row, each its own field; a `when` field
// counts only while another field holds the value it names.

/** A field's kind: its own, else what today's type draws as. */
export const kindOf = (f) => f?.kind || (f?.type === 'select' ? 'CH' : 'T');
const labelOf = (f) => f?.label ?? f?.k ?? f?.name;
const inputOf = (f) => f?.input ?? f?.type ?? 'text';
/** A field's choices as `{ value, label, checked }`, from `options` or the canvas's `opts`. */
const choicesOf = (f) => (f?.options ?? f?.opts ?? []).map((o) => (typeof o === 'string'
  ? { value: o, label: o, checked: false }
  : Array.isArray(o) ? { value: String(o[0]), label: String(o[0]), checked: !!o[2] }
    : { value: String(o?.value ?? o?.t ?? o?.label), label: String(o?.label ?? o?.t ?? o?.value), checked: !!(o?.checked ?? o?.on) }));
/** The fields a form holds values for: a `parts` field's own parts in its place. */
const leafFields = (fields) => (fields || []).flatMap((f) => (Array.isArray(f?.parts) ? leafFields(f.parts) : [f]));
/** Whether a `when` field counts now (D695 decision 2). */
export function shownWith(field, values) {
  if (!field?.when) return true;
  if (typeof field.when === 'function') return !!field.when(values || {});
  const v = values?.[field.when.name];
  return Array.isArray(v) ? v.includes(field.when.value) : v === field.when.value;
}

/**
 * The first value of each field, then a row's own values: a CK field's is an
 * array (its checked options), every other field's is text. A CH field's
 * `def` may be its option's index, as the canvas writes it.
 */
export function initialValues(form, current = null) {
  const base = {};
  for (const f of leafFields(form?.fields)) {
    const kind = kindOf(f);
    const has = current != null && Object.prototype.hasOwnProperty.call(current, f.name);
    if (kind === 'CK') {
      const v = has ? current[f.name] : null;
      base[f.name] = Array.isArray(v) ? v.map(String) : choicesOf(f).filter((o) => o.checked).map((o) => o.value);
      continue;
    }
    if (has) { base[f.name] = current[f.name] == null ? '' : String(current[f.name]); continue; }
    let v = f.initial ?? f.def;
    if (kind === 'CH') {
      const choices = choicesOf(f);
      if (typeof v === 'number' && !choices.some((o) => o.value === String(v))) v = choices[v]?.value;
      if (v == null) v = choices.find((o) => o.checked)?.value;
    }
    base[f.name] = v == null ? '' : String(v);
  }
  return base;
}

/** `{ field: sentence }` for what the form can tell before sending; empty when it may be sent. */
export function validate(form, values) {
  const errors = {};
  for (const f of leafFields(form?.fields)) {
    if (!shownWith(f, values)) continue;
    const kind = kindOf(f);
    const label = labelOf(f);
    const raw = values?.[f.name];
    if (kind === 'CK') {
      const picked = Array.isArray(raw) ? raw : [];
      if (f.required && picked.length === 0) errors[f.name] = `${label} is required.`;
      else if (picked.some((v) => !choicesOf(f).some((o) => o.value === String(v)))) errors[f.name] = `Pick the recorded choices for ${String(label).toLowerCase()}.`;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (f.required && (text == null || text === '')) { errors[f.name] = `${label} is required.`; continue; }
    if (typeof text === 'string' && f.max && text.length > f.max) errors[f.name] = `${label} is at most ${f.max} characters.`;
    const input = inputOf(f);
    if (input === 'money' && Number.isNaN(toCents(raw))) errors[f.name] = 'Type an amount in US dollars, 0 or more.';
    if (input === 'score' && Number.isNaN(toScore(raw))) errors[f.name] = 'A score is a whole number from 0 to 10.';
    if (input === 'date' && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) errors[f.name] = 'Pick a date.';
    if (kind === 'CH' && text && !choicesOf(f).some((o) => o.value === text)) errors[f.name] = `Pick one of the choices for ${String(label).toLowerCase()}.`;
  }
  return { ...errors, ...(typeof form?.check === 'function' ? form.check(values || {}) : {}) };
}

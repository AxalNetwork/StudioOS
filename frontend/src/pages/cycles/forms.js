/**
 * D661 (#1474) — the Add and Edit forms for the cycle stores that have their
 * Worker writes but no page of their own: Grow's feedback, channels, partners,
 * markets and obligations (D664); Build's risks, formation steps and MVP
 * must-haves (D662).
 *
 * WHAT A FORM IS. Its `key` (unique in its module: `/new?form=<key>` opens
 * it, D695), its `cta`, its fields, the body its Worker route takes
 * (`toBody`), and the writes it makes (`submit`). The fields follow the route's own rules:
 * the same required fields, the same lengths, the same choices. The Worker
 * still checks everything, and its sentence is what the founder sees when it
 * refuses. `cycle_adapters_d661.test.ts` sends every form's body through the
 * real route and reads the row back on the module's table.
 *
 * Nothing here fetches: `submit` is handed the write table from
 * `frontend/src/lib/api/cycles.js`.
 *
 * Money is typed in US dollars and sent in cents. A score is a whole number
 * from 0 to 10 and needs its source (D664). An empty field is sent as null,
 * never as 0 or "".
 */

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
  // No foot until #1698's band proposes themes (decision 7): "Themes are proposed by Eadwyn; you accept."
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

const readiness = {
  key: 'readiness', cta: 'Score readiness',
  button: 'Score readiness', title: 'Score readiness',
  lead: 'Check the deck, use of funds, cap table, traction, data room and narrative against their recorded evidence.',
  fields: [], submit: (w, projectId) => w.raise.rescore(projectId),
};

const narrative = {
  key: 'narrative-version', cta: 'New version',
  button: 'New version', title: 'New narrative version',
  lead: 'Save the current narrative for an investor type and check it against recorded metrics.',
  fields: [{ name: 'investor_type', label: 'Investor type', type: 'select', required: true, options: opts([
    ['angel', 'Angel'], ['pre_seed_fund', 'Pre-seed fund'], ['seed_fund', 'Seed fund'],
    ['series_a_fund', 'Series A fund'], ['strategic', 'Strategic'], ['grant', 'Grant'], ['other', 'Other'],
  ]) }],
  toBody: (v) => ({ investor_type: v.investor_type || null }),
  submit: (w, projectId, v) => w.raise.narrativeVersion(projectId, narrative.toBody(v)),
};

/** The forms, by cycle and module slug. A slug not here has no Add form. */
export const FORMS = {
  raise: {
    'fundraising-readiness': [readiness],
    'investor-narrative': [narrative],
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
// `main` takes, and each Edit sends only that route's PATCH fields. They are
// registered nowhere (decision 15): PR 2b adds the `validate` write group they
// call, the chip loaders, and `FORMS.validate` / `EDITS.validate`. A chip set
// read from `form-options` names its key in `optionsFrom`; until a loader
// fills it, it draws its own "None yet" chip, or its empty sentence.

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
const competitor = {
  key: 'competitor', cta: 'Add competitor', button: 'Add competitor',
  title: 'Add competitor',
  sub: 'Tracked from Research › Companies, or added by name.',
  foot: 'Signals appear as you record them or re-run the analysis.',
  fields: [
    // A search box (decision 8): PR 2b's picker sets `company_ref` for one of
    // the caller's own candidates, or `directory_uid` for a Research match;
    // otherwise the typed name is sent.
    { kind: 'T', name: 'company', k: 'Company', ph: 'Search Research › Companies, or type a name', required: true, max: 120, optionsFrom: 'companies', search: 'q' },
    kindField, watchField, whyField,
  ],
  // The route takes exactly one of the three keys.
  toBody: (v) => {
    const picked = str(v.company_ref) ? { company_ref: str(v.company_ref) }
      : str(v.directory_uid) ? { directory_uid: str(v.directory_uid) } : { name: str(v.company) };
    return { ...picked, kind: v.kind || 'direct', watch: watchBody(v), why: str(v.why) };
  },
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
  submit: (w, projectId, v) => w.validate.hypothesis(projectId, hypothesis.toBody(v)),
};

/** Validate's Add forms, by module slug (PR 2b registers them as `FORMS.validate`). */
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

const editTheme = {
  ...EDIT,
  key: 'edit-theme', title: 'Edit theme', sub: theme.sub,
  fields: [theme.fields[0], severityField],
  idOf: recordId(/^[1-9]\d*$/),
  valuesOf: carried(['title', 'severity']),
  toBody: (v) => onlyShown(v, { title: str(v.title), severity: v.severity || null }),
  submit: (w, projectId, id, v) => w.validate.themeUpdate(projectId, id, editTheme.toBody(v)),
};

const editSegment = {
  ...EDIT,
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
  ...EDIT,
  key: 'edit-competitor', title: 'Edit competitor', sub: competitor.sub,
  fields: [kindField, watchField, whyField],
  // A candidate id the record route takes (D690 decision 4).
  idOf: recordId(/^[a-z0-9][a-z0-9_-]*$/),
  valuesOf: (row) => {
    const e = growEdit(row) || {};
    const v = carried(['kind', 'why'])(row);
    if (e.watch && typeof e.watch === 'object') v.watch = WATCH.map((o) => o.value).filter((k) => e.watch[k] === true);
    return v;
  },
  toBody: (v) => onlyShown(v, { kind: v.kind || 'direct', watch: watchBody(v), why: str(v.why) }),
  submit: (w, projectId, id, v) => w.validate.competitorUpdate(projectId, id, editCompetitor.toBody(v)),
};

const editSignal = {
  ...EDIT,
  key: 'edit-signal', title: 'Edit signal', sub: signal.sub,
  fields: signalFields,
  // Only a `signal-` record is the founder's own (a `revenue-` or `waitlist-` one is not).
  idOf: recordId(/^signal-[1-9]\d*$/),
  valuesOf: (row) => {
    const e = growEdit(row) || {};
    const v = carried(['kind', 'who', 'signal_date', 'status'])(row);
    if (v.signal_date) v.signal_date = dateText(v.signal_date);
    if (Object.hasOwn(e, 'amount_cents')) v.amount = e.amount_cents == null ? '' : String(Number(e.amount_cents) / 100);
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
  ...EDIT,
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
  submit: (w, projectId, id, v) => w.validate.hypothesisUpdate(projectId, id, editHypothesis.toBody(v)),
};

/** Validate's Edit forms, by module slug (PR 2b registers them as `EDITS.validate`). */
export const VALIDATE_EDITS = {
  'problem-discovery': editTheme,
  'ideal-customer-profile': editSegment,
  'market-intelligence': editCompetitor,
  'demand-signals': editSignal,
  experiments: editHypothesis,
};

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

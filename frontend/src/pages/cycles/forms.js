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

/**
 * D661 (#1474) — the Add and Edit forms for the cycle stores that have their
 * Worker writes but no page of their own: Grow's feedback, channels, partners,
 * markets and obligations (D664); Build's risks, formation steps and MVP
 * must-haves (D662).
 *
 * WHAT A FORM IS. Its fields, the body its Worker route takes (`toBody`),
 * and the writes it makes (`submit`). The fields follow the route's own rules:
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

const MARKET_PARTS = [['demand', 'Demand'], ['regulation', 'Regulation'], ['partners', 'Partners'], ['cost', 'Cost to enter']];

// The choices each store takes, shared by its Add and Edit forms.
const FEEDBACK_STATUS = opts([['open', 'Open'], ['planned', 'Planned'], ['shipped', 'Shipped']]);
const CHANNEL_STATE = opts([['active', 'Active'], ['testing', 'Testing'], ['paused', 'Paused']]);
const PARTNER_TYPE = opts([['reseller', 'Reseller'], ['integration', 'Integration'], ['agency', 'Agency'], ['referral', 'Referral'], ['other', 'Other']]);
const PARTNER_STAGE = opts([['talking', 'Talking'], ['terms', 'Terms'], ['signed', 'Signed'], ['ended', 'Ended']]);
const MARKET_STATE = opts([['considering', 'Considering'], ['entering', 'Entering'], ['served', 'Served'], ['not_now', 'Not now']]);
const OBLIGATION_STATE = opts([['upcoming', 'Upcoming'], ['scheduled', 'Scheduled'], ['draft', 'Draft'], ['done', 'Done'], ['not_set_up', 'Not set up']]);
const YES_NO = opts([['yes', 'Yes'], ['no', 'No']]);

/** The four market parts as fields: a score and its source each. */
const marketPartFields = () => MARKET_PARTS.flatMap(([k, label]) => [
  { name: `${k}_score`, label: `${label}: score (0–10)`, type: 'score' },
  { name: `${k}_source`, label: `${label}: source`, type: 'text', max: 200 },
]);
// A score needs its source: the Worker refuses one without, and so does the form.
const marketCheck = (v) => Object.fromEntries(MARKET_PARTS
  .filter(([k]) => toScore(v[`${k}_score`]) != null && !str(v[`${k}_source`]))
  .map(([k, label]) => [`${k}_source`, `The ${label.toLowerCase()} score needs its source.`]));
// Every part is sent, an empty one as null: an edit that empties a score clears it.
const marketPartsBody = (v) => Object.fromEntries(MARKET_PARTS.flatMap(([k]) => {
  const sc = toScore(v[`${k}_score`]);
  return [[`${k}_score`, sc], [`${k}_source`, sc == null ? null : str(v[`${k}_source`])]];
}));

// ---------- Grow (routes/cycle_grow.ts) --------------------------------------

const feedback = {
  button: 'Log feedback',
  title: 'Log feedback',
  lead: 'One piece of feedback, from a customer, an investor or the team.',
  fields: [
    { name: 'body', label: 'Feedback', type: 'textarea', required: true, max: 4000 },
    { name: 'source', label: 'From', type: 'select', required: true, options: opts([['customer', 'A customer'], ['investor', 'An investor'], ['team', 'The team']]) },
    { name: 'from_name', label: 'Their name', type: 'text', max: 200 },
    { name: 'from_email', label: 'Their email', type: 'email', max: 200, hint: 'So you can tell them when it ships.' },
    { name: 'theme', label: 'Theme', type: 'text', max: 80 },
    { name: 'roadmap_item_label', label: 'Roadmap item', type: 'text', max: 200 },
    { name: 'status', label: 'Status', type: 'select', initial: 'open', options: FEEDBACK_STATUS },
  ],
  toBody: (v) => ({
    body: str(v.body), source: v.source || null, from_name: str(v.from_name), from_email: str(v.from_email),
    theme: str(v.theme), roadmap_item_label: str(v.roadmap_item_label), status: v.status || 'open',
  }),
  submit: (w, projectId, v) => w.grow.feedback(projectId, feedback.toBody(v)),
};

const channel = {
  button: 'Add channel',
  title: 'Add a channel',
  lead: 'A channel is counted by the UTM source its links carry. Spend is what you type; it is shown as typed.',
  fields: [
    { name: 'name', label: 'Channel', type: 'text', required: true, max: 120 },
    { name: 'utm_source', label: 'UTM source', type: 'text', required: true, max: 80, hint: 'The utm_source on this channel’s links, such as linkedin.' },
    { name: 'state', label: 'State', type: 'select', initial: 'active', options: CHANNEL_STATE },
    { name: 'spend', label: 'Spend this month (US$)', type: 'money', hint: 'Leave empty if you have not recorded it.' },
  ],
  toBody: (v) => ({ name: str(v.name), utm_source: str(v.utm_source), state: v.state || 'active' }),
  async submit(w, projectId, v, now = new Date()) {
    const made = await w.grow.channel(projectId, channel.toBody(v));
    const spend = toCents(v.spend);
    if (spend != null && made?.uid) await w.grow.channelSpend(projectId, made.uid, thisMonth(now), { spend_cents: spend });
    return made;
  },
};

const partner = {
  button: 'Add partner',
  title: 'Add a partner',
  lead: 'A reseller, an integration, an agency or a referrer. Revenue is what you type; it is shown as typed.',
  fields: [
    { name: 'name', label: 'Partner', type: 'text', required: true, max: 200 },
    { name: 'type', label: 'Type', type: 'select', required: true, options: PARTNER_TYPE },
    { name: 'stage', label: 'Stage', type: 'select', initial: 'talking', options: PARTNER_STAGE },
    { name: 'terms', label: 'Terms', type: 'textarea', max: 400 },
    { name: 'revenue', label: 'Revenue they sourced this month (US$)', type: 'money', hint: 'Leave empty if you have not recorded it.' },
  ],
  toBody: (v) => ({ name: str(v.name), type: v.type || null, stage: v.stage || 'talking', terms: str(v.terms) }),
  async submit(w, projectId, v, now = new Date()) {
    const made = await w.grow.partner(projectId, partner.toBody(v));
    const revenue = toCents(v.revenue);
    if (revenue != null && made?.uid) await w.grow.partnerRevenue(projectId, made.uid, thisMonth(now), { amount_cents: revenue });
    return made;
  },
};

const market = {
  button: 'Add market',
  title: 'Add a market',
  lead: 'Score each part from 0 to 10 when you have evidence, and say where it came from. A part you have not scored stays not recorded.',
  fields: [
    { name: 'name', label: 'Market', type: 'text', required: true, max: 120 },
    { name: 'state', label: 'State', type: 'select', initial: 'considering', options: MARKET_STATE },
    ...marketPartFields(),
  ],
  check: marketCheck,
  toBody: (v) => ({ name: str(v.name), state: v.state || 'considering', ...marketPartsBody(v) }),
  submit: (w, projectId, v) => w.grow.market(projectId, market.toBody(v)),
};

const obligation = {
  button: 'Add obligation',
  title: 'Add an obligation',
  lead: 'A filing, a board meeting, a renewal: anything with a date the company must keep.',
  fields: [
    { name: 'title', label: 'Obligation', type: 'text', required: true, max: 200 },
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: opts([['governance', 'Governance'], ['compliance', 'Compliance'], ['risk', 'Risk'], ['tax', 'Tax'], ['other', 'Other']]) },
    { name: 'due_at', label: 'Due', type: 'date' },
    { name: 'owner_name', label: 'Owner', type: 'text', max: 120 },
    { name: 'status', label: 'State', type: 'select', initial: 'upcoming', options: OBLIGATION_STATE },
  ],
  toBody: (v) => ({ title: str(v.title), kind: v.kind || null, due_at: str(v.due_at), owner_name: str(v.owner_name), status: v.status || 'upcoming' }),
  submit: (w, projectId, v) => w.grow.obligation(projectId, obligation.toBody(v)),
};

// ---------- Build (routes/cycle_build.ts) ------------------------------------

const risk = {
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

/** The forms, by cycle and module slug. A slug not here has no Add form. */
export const FORMS = {
  grow: {
    'product-improvement': feedback,
    distribution: channel,
    'partner-network': partner,
    'market-expansion': market,
    'durable-company-building': obligation,
  },
  build: {
    'solution-design': risk,
    'prototype-mvp': mustHave,
    'company-creation': formationStep,
  },
};

/** The form for a cycle's module, or null. Own entries only: a slug never reaches Object.prototype. */
export function formFor(cycle, slug) {
  const byCycle = Object.prototype.hasOwnProperty.call(FORMS, cycle) ? FORMS[cycle] : null;
  return byCycle && Object.prototype.hasOwnProperty.call(byCycle, slug) ? byCycle[slug] : null;
}

// ---------- Edit a row -------------------------------------------------------
//
// An Edit form is an Add form's shape plus two readers: `idOf(row)`, the
// store's own id for the row (null when the row is not one the route can
// change, which draws no Edit), and `valuesOf(row)`, the row's current values.
// Grow's rows carry them as `edit` (`adapters/grow.js`); Build's rows are the
// read's own cells. `submit` takes the id.

const asText = (v) => (v == null ? '' : String(v));
const dateText = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const growEdit = (row) => (row && typeof row.edit === 'object' && row.edit ? row.edit : null);
/** A Build row id the routes take: a positive whole number, from `prefix<n>` or a bare number. */
const buildId = (prefix) => (row) => {
  const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(row?.id ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

const EDIT = { button: 'Edit' };

const editFeedback = {
  ...EDIT,
  title: 'Edit feedback',
  lead: 'Where it stands, and what it belongs to. What was said, and by whom, stays as logged.',
  fields: [
    { name: 'status', label: 'Status', type: 'select', required: true, options: FEEDBACK_STATUS },
    { name: 'theme', label: 'Theme', type: 'text', max: 80 },
    { name: 'roadmap_item_label', label: 'Roadmap item', type: 'text', max: 200 },
  ],
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { status: asText(e.status), theme: asText(e.theme), roadmap_item_label: asText(e.roadmap_item_label) }; },
  toBody: (v) => ({ status: v.status, theme: str(v.theme), roadmap_item_label: str(v.roadmap_item_label) }),
  submit: (w, projectId, id, v) => w.grow.feedbackUpdate(projectId, id, editFeedback.toBody(v)),
};

const editChannel = {
  ...EDIT,
  title: 'Edit channel',
  lead: 'Its name and its state. Its UTM source is what counts its customers, so it stays as added.',
  fields: [
    { name: 'name', label: 'Channel', type: 'text', required: true, max: 120 },
    { name: 'state', label: 'State', type: 'select', required: true, options: CHANNEL_STATE },
  ],
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { name: asText(e.name), state: asText(e.state) }; },
  toBody: (v) => ({ name: str(v.name), state: v.state }),
  submit: (w, projectId, id, v) => w.grow.channelUpdate(projectId, id, editChannel.toBody(v)),
};

const editPartner = {
  ...EDIT,
  title: 'Edit partner',
  lead: 'Its type, its stage and its terms.',
  fields: [
    { name: 'type', label: 'Type', type: 'select', required: true, options: PARTNER_TYPE },
    { name: 'stage', label: 'Stage', type: 'select', required: true, options: PARTNER_STAGE },
    { name: 'terms', label: 'Terms', type: 'textarea', max: 400 },
  ],
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { type: asText(e.type), stage: asText(e.stage), terms: asText(e.terms) }; },
  toBody: (v) => ({ type: v.type, stage: v.stage, terms: str(v.terms) }),
  submit: (w, projectId, id, v) => w.grow.partnerUpdate(projectId, id, editPartner.toBody(v)),
};

const editMarket = {
  ...EDIT,
  title: 'Edit market',
  lead: 'Its state, your decision, and each part\'s score with its source. Emptying a score clears it.',
  fields: [
    { name: 'state', label: 'State', type: 'select', required: true, options: MARKET_STATE },
    { name: 'decision', label: 'Decision', type: 'select', options: opts([['enter', 'Enter'], ['not_yet', 'Not yet'], ['exit', 'Exit']]) },
    ...marketPartFields(),
  ],
  check: marketCheck,
  idOf: (row) => growEdit(row)?.uid ?? null,
  valuesOf: (row) => {
    const e = growEdit(row) || {};
    return { state: asText(e.state), decision: asText(e.decision),
      ...Object.fromEntries(MARKET_PARTS.flatMap(([k]) => [[`${k}_score`, asText(e[`${k}_score`])], [`${k}_source`, asText(e[`${k}_source`])]])) };
  },
  toBody: (v) => ({ state: v.state, decision: v.decision || null, ...marketPartsBody(v) }),
  submit: (w, projectId, id, v) => w.grow.marketUpdate(projectId, id, editMarket.toBody(v)),
};

const editObligation = {
  ...EDIT,
  title: 'Edit obligation',
  lead: 'Its state, its owner and its date.',
  fields: [
    { name: 'status', label: 'State', type: 'select', required: true, options: OBLIGATION_STATE },
    { name: 'owner_name', label: 'Owner', type: 'text', max: 120 },
    { name: 'due_at', label: 'Due', type: 'date' },
  ],
  idOf: (row) => growEdit(row)?.id ?? null,
  valuesOf: (row) => { const e = growEdit(row) || {}; return { status: asText(e.status), owner_name: asText(e.owner_name), due_at: dateText(e.due_at) }; },
  toBody: (v) => ({ status: v.status, owner_name: str(v.owner_name), due_at: str(v.due_at) }),
  submit: (w, projectId, id, v) => w.grow.obligationUpdate(projectId, id, editObligation.toBody(v)),
};

const editFormationStep = {
  ...EDIT,
  title: 'Edit formation step',
  lead: 'Its name, its date and where it stands. A step the Lab or a filing obligation tracks is changed where it lives.',
  fields: [
    { name: 'title', label: 'Step', type: 'text', required: true, max: 200 },
    { name: 'due_date', label: 'Due', type: 'date' },
    { name: 'state', label: 'State', type: 'select', required: true, options: opts([['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']]) },
  ],
  // Only `step-<id>` rows are formation steps; Lab steps and obligations share the table.
  idOf: buildId('step-'),
  valuesOf: (row) => ({ title: asText(row?.cells?.filing), due_date: dateText(row?.cells?.due), state: asText(row?.cells?.state) }),
  toBody: (v) => ({ title: str(v.title), due_date: str(v.due_date), state: v.state }),
  submit: (w, projectId, id, v) => w.build.formationStepUpdate(projectId, id, editFormationStep.toBody(v)),
};

const editMustHave = {
  ...EDIT,
  title: 'Edit must-have',
  lead: 'Its date, or take it off the must-haves. The feature stays in your MVP scope.',
  fields: [
    { name: 'is_must_have', label: 'Must-have for the MVP', type: 'select', required: true, options: YES_NO },
    { name: 'due_date', label: 'Due', type: 'date' },
  ],
  idOf: buildId(''),
  valuesOf: (row) => ({ is_must_have: 'yes', due_date: dateText(row?.cells?.due) }),
  toBody: (v) => ({ is_must_have: v.is_must_have === 'yes', due_date: str(v.due_date) }),
  submit: (w, projectId, id, v) => w.build.feature(projectId, id, editMustHave.toBody(v)),
};

const editFeature = {
  ...EDIT,
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
export const EDITS = {
  grow: {
    'product-improvement': editFeedback,
    distribution: editChannel,
    'partner-network': editPartner,
    'market-expansion': editMarket,
    'durable-company-building': editObligation,
  },
  build: {
    'solution-design': editFeature,
    'prototype-mvp': editMustHave,
    'company-creation': editFormationStep,
  },
};

/** The Edit form for a cycle's module, or null. Own entries only, as `formFor`. */
export function editFor(cycle, slug) {
  const byCycle = Object.prototype.hasOwnProperty.call(EDITS, cycle) ? EDITS[cycle] : null;
  return byCycle && Object.prototype.hasOwnProperty.call(byCycle, slug) ? byCycle[slug] : null;
}

/** The first value of each field: its `initial`, else empty; then a row's own values, as text. */
export function initialValues(form, current = null) {
  const base = Object.fromEntries((form?.fields || []).map((f) => [f.name, f.initial ?? '']));
  if (!current) return base;
  for (const f of form?.fields || []) {
    if (Object.prototype.hasOwnProperty.call(current, f.name)) base[f.name] = current[f.name] == null ? '' : String(current[f.name]);
  }
  return base;
}

/** `{ field: sentence }` for what the form can tell before sending; empty when it may be sent. */
export function validate(form, values) {
  const errors = {};
  for (const f of form?.fields || []) {
    const raw = values?.[f.name];
    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (f.required && (text == null || text === '')) { errors[f.name] = `${f.label} is required.`; continue; }
    if (typeof text === 'string' && f.max && text.length > f.max) errors[f.name] = `${f.label} is at most ${f.max} characters.`;
    if (f.type === 'money' && Number.isNaN(toCents(raw))) errors[f.name] = 'Type an amount in US dollars, 0 or more.';
    if (f.type === 'score' && Number.isNaN(toScore(raw))) errors[f.name] = 'A score is a whole number from 0 to 10.';
    if (f.type === 'date' && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) errors[f.name] = 'Pick a date.';
    if (f.type === 'select' && text && !(f.options || []).some((o) => o.value === text)) errors[f.name] = `Pick one of the choices for ${f.label.toLowerCase()}.`;
  }
  return { ...errors, ...(typeof form?.check === 'function' ? form.check(values || {}) : {}) };
}

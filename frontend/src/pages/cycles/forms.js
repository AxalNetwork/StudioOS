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
  key: 'feedback', cta: 'Log feedback',
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
  key: 'channel', cta: 'Add channel',
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
  key: 'partner', cta: 'Add partner',
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
  key: 'market', cta: 'Add market',
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
  key: 'obligation', cta: 'Add obligation',
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

const editFeedback = {
  ...EDIT,
  key: 'edit-feedback',
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
  key: 'edit-channel',
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
  key: 'edit-partner',
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
  key: 'edit-market',
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
  key: 'edit-obligation',
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

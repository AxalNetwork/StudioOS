/**
 * D661 (#1474) — the Add forms for the cycle stores that have their Worker
 * writes but no page of their own: Grow's feedback, channels, partners,
 * markets and obligations (D664) and Build's risks and formation steps (D662).
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
    { name: 'status', label: 'Status', type: 'select', initial: 'open', options: opts([['open', 'Open'], ['planned', 'Planned'], ['shipped', 'Shipped']]) },
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
    { name: 'state', label: 'State', type: 'select', initial: 'active', options: opts([['active', 'Active'], ['testing', 'Testing'], ['paused', 'Paused']]) },
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
    { name: 'type', label: 'Type', type: 'select', required: true, options: opts([['reseller', 'Reseller'], ['integration', 'Integration'], ['agency', 'Agency'], ['referral', 'Referral'], ['other', 'Other']]) },
    { name: 'stage', label: 'Stage', type: 'select', initial: 'talking', options: opts([['talking', 'Talking'], ['terms', 'Terms'], ['signed', 'Signed'], ['ended', 'Ended']]) },
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
    { name: 'state', label: 'State', type: 'select', initial: 'considering', options: opts([['considering', 'Considering'], ['entering', 'Entering'], ['served', 'Served'], ['not_now', 'Not now']]) },
    ...MARKET_PARTS.flatMap(([k, label]) => [
      { name: `${k}_score`, label: `${label}: score (0–10)`, type: 'score' },
      { name: `${k}_source`, label: `${label}: source`, type: 'text', max: 200 },
    ]),
  ],
  // A score needs its source: the Worker refuses one without, and so does the form.
  check: (v) => Object.fromEntries(MARKET_PARTS
    .filter(([k]) => toScore(v[`${k}_score`]) != null && !str(v[`${k}_source`]))
    .map(([k, label]) => [`${k}_source`, `The ${label.toLowerCase()} score needs its source.`])),
  toBody: (v) => ({
    name: str(v.name), state: v.state || 'considering',
    ...Object.fromEntries(MARKET_PARTS.flatMap(([k]) => {
      const s = toScore(v[`${k}_score`]);
      return [[`${k}_score`, s], [`${k}_source`, s == null ? null : str(v[`${k}_source`])]];
    })),
  }),
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
    { name: 'status', label: 'State', type: 'select', initial: 'upcoming', options: opts([['upcoming', 'Upcoming'], ['scheduled', 'Scheduled'], ['draft', 'Draft'], ['done', 'Done'], ['not_set_up', 'Not set up']]) },
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
    'company-creation': formationStep,
  },
};

/** The form for a cycle's module, or null. Own entries only: a slug never reaches Object.prototype. */
export function formFor(cycle, slug) {
  const byCycle = Object.prototype.hasOwnProperty.call(FORMS, cycle) ? FORMS[cycle] : null;
  return byCycle && Object.prototype.hasOwnProperty.call(byCycle, slug) ? byCycle[slug] : null;
}

/** The first value of each field: its `initial`, else empty. */
export function initialValues(form) {
  return Object.fromEntries((form?.fields || []).map((f) => [f.name, f.initial ?? '']));
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

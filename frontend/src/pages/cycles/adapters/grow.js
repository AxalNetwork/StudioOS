/**
 * D661 (#1474) — Grow's read (#1488, D664) in the page's shape.
 *
 * WHY AN ADAPTER. D664's read returns each card's `series` as the module's own
 * data (`[{ theme, open, planned, shipped }]`, `{ channels, funnel }`,
 * `{ movements, cohorts, churn }`, …), `records.cols` as labels and
 * `records.rows` as plain objects, as Validate's does. S1 decided on #1474
 * that the page adapts and the Worker is not changed. Each function below
 * follows the canvas's helper for that card (`Cycle Overview.dc.html`,
 * `D.Grow.cards`).
 *
 * THE RULES IT KEEPS, as `validate.js` does:
 * - A missing value is null, drawn as "Not recorded", never 0. A month no one
 *   recorded is a gap in the bars, not a zero bar.
 * - Money arrives in cents (spend, CAC, movements, partner revenue) except
 *   the metric snapshots' MRR, which is in dollars; every chart gets dollars
 *   and `unit: 'usd'`.
 * - A series it cannot read gives no spec, so an `ok` card with nothing to
 *   draw reads as unreadable (`cardView`), never as an invented chart.
 * - Nothing here fetches. `cycle_adapters_d661.test.ts` runs the Worker's
 *   real output through every function.
 */

/**
 * The seven modules, as `services/growCycle.ts` lists them (`GROW_MODULES`);
 * `cycle_adapters_d661.test.ts` holds this to the Worker's own list.
 */
export const MODULES = [
  { slug: 'product-improvement', name: 'Product improvement' },
  { slug: 'distribution', name: 'Distribution' },
  { slug: 'revenue-and-traction', name: 'Revenue and traction' },
  { slug: 'team-expansion', name: 'Team expansion' },
  { slug: 'partner-network', name: 'Partner network' },
  { slug: 'market-expansion', name: 'Market expansion' },
  { slug: 'durable-company-building', name: 'Durable company-building' },
];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const dollars = (cents) => (num(cents) ? Math.round(cents / 100) : null);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct" for 2026-10; null for anything else. */
export function monthLabel(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])/.test(month)) return null;
  return MON[Number(month.slice(5, 7)) - 1];
}

/** "12 Dec" for 2026-12-12; null for anything else. */
export function dayLabel(day) {
  if (typeof day !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(day)) return null;
  return `${Number(day.slice(8, 10))} ${MON[Number(day.slice(5, 7)) - 1]}`;
}

/** First, middle and last tick of a monthly axis, as the canvas labels it. */
function monthTicks(months) {
  const n = months.length;
  if (!n) return [];
  const at = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return at.map((i) => ({ at: i, label: monthLabel(months[i]) })).filter((t) => t.label);
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- Cards ------------------------------------------------------------

/** The overview card draws this many themes; the rest are counted. */
const THEMES_SHOWN = 6;

function productImprovement(s) {
  const themes = list(s);
  if (!themes.length) return [];
  const out = [{
    kind: 'stack',
    rows: themes.slice(0, THEMES_SHOWN).map((t) => ({
      label: String(t?.theme ?? 'Not recorded'),
      parts: [t?.open, t?.planned, t?.shipped].map((v) => (num(v) ? v : 0)),
    })),
    tones: ['v3', 'v2', 'v1'],
    legend: [{ label: 'Open', tone: 'v3' }, { label: 'Planned', tone: 'v2' }, { label: 'Shipped', tone: 'v1' }],
  }];
  if (themes.length > THEMES_SHOWN) out.push({ kind: 'rows', items: [{ label: 'More themes', value: themes.length - THEMES_SHOWN }] });
  return out;
}

function distribution(s) {
  const d = obj(s);
  if (!d) return [];
  const out = [];
  const channels = list(d.channels);
  if (channels.length) {
    out.push({
      kind: 'hbar', unit: 'usd',
      items: channels.map((c) => ({ label: String(c?.name ?? ''), value: dollars(c?.cac_cents) })),
    });
  }
  // The funnel is drawn from its first recorded step: a funnel's bars are
  // shares of that step. A step before it that no store records (visits, as
  // D664 says) is listed with the read's own reason rather than drawn as an
  // empty bar.
  const steps = list(d.funnel).map((x) => ({ label: String(x?.stage ?? ''), value: num(x?.value) ? x.value : null, reason: x?.reason }));
  const first = steps.findIndex((x) => x.value != null);
  const before = first === -1 ? steps : steps.slice(0, first);
  if (first !== -1) out.push({ kind: 'funnel', steps: steps.slice(first).map(({ label, value }) => ({ label, value })) });
  if (before.length) out.push({ kind: 'rows', items: before.map((x) => ({ label: x.label, value: typeof x.reason === 'string' && x.reason ? x.reason : 'Not recorded' })) });
  return out;
}

/** The cohorts the heat map draws, newest last, and the months each spans. */
const COHORTS_SHOWN = 6;
const COHORT_MONTHS = 12;

function revenueAndTraction(s) {
  const d = obj(s);
  if (!d) return [];
  const out = [];
  const mv = list(d.movements);
  if (mv.length) {
    const months = mv.map((m) => m?.month);
    const unsplit = mv.some((m) => num(m?.unsplit) && m.unsplit > 0);
    out.push({
      kind: 'vstack', unit: 'usd',
      rows: mv.map((m) => [m?.new, m?.expansion, ...(unsplit ? [m?.unsplit] : [])].map((v) => dollars(v) ?? 0)),
      tones: ['v1', 'v2', 'grey'],
      labels: monthTicks(months),
      legend: [
        { label: 'New', tone: 'v1' }, { label: 'Expansion', tone: 'v2' },
        ...(unsplit ? [{ label: 'Not split from new', tone: 'grey' }] : []),
      ],
    });
    // The canvas draws churn below the line; the page draws it as its own
    // bars under the stack, in the bad tone.
    const churned = mv.map((m) => dollars(m?.churned));
    if (churned.some((v) => v != null && v > 0)) {
      out.push({ kind: 'vbars', unit: 'usd', tone: 'bad', values: churned, labels: monthTicks(months), legend: [{ label: 'Churned', tone: 'bad' }] });
    }
  }
  const cohorts = list(d.cohorts).slice(-COHORTS_SHOWN);
  if (cohorts.length) {
    out.push({
      kind: 'heat',
      rows: cohorts.map((c) => ({
        label: monthLabel(c?.cohort) ?? String(c?.cohort ?? ''),
        cells: list(c?.retention).slice(0, COHORT_MONTHS).map((v) => (num(v) ? v / 100 : null)),
      })),
      axis: 'Customers still paying, by month since their first',
    });
  }
  const churn = obj(d.churn);
  if (churn && churn.value == null) out.push({ kind: 'rows', items: [{ label: 'Churn', value: churn.reason || 'Not recorded' }] });
  return out;
}

const APPLICATION_STAGE = { applied: 'Applied', screen: 'Screen', interview: 'Interview', offer: 'Offer' };

function teamExpansion(s) {
  const d = obj(s);
  if (!d) return [];
  const out = [];
  const months = list(d.months);
  const headcount = list(d.headcount).map((v) => (num(v) ? v : null));
  const plan = list(d.plan).map((v) => (num(v) ? v : null));
  const planned = plan.some((v) => v != null);
  if (months.length && headcount.some((v) => v != null)) {
    out.push({
      kind: 'line',
      values: headcount,
      ...(planned ? { plan } : {}),
      labels: monthTicks(months),
      legend: [{ label: 'Headcount', tone: 'v1' }, ...(planned ? [{ label: 'Hiring plan (dashed)', tone: 'muted' }] : [])],
    });
  }
  const stages = list(d.roles_by_stage);
  if (stages.length) {
    out.push({ kind: 'funnel', steps: stages.map((x) => ({ label: APPLICATION_STAGE[x?.stage] || String(x?.stage ?? ''), value: num(x?.count) ? x.count : null })) });
  }
  return out;
}

const PARTNER_STAGE = { talking: 'Talking', terms: 'Terms', signed: 'Signed', ended: 'Ended' };

function partnerNetwork(s) {
  const d = obj(s);
  if (!d) return [];
  const out = [];
  const stages = list(d.by_stage);
  if (stages.length) {
    out.push({ kind: 'hbar', items: stages.map((x) => ({ label: PARTNER_STAGE[x?.stage] || String(x?.stage ?? ''), value: num(x?.count) ? x.count : null })) });
  }
  const revenue = list(d.revenue);
  const values = revenue.map((r) => dollars(r?.cents));
  if (values.some((v) => v != null && v > 0)) {
    out.push({ kind: 'vbars', unit: 'usd', values, labels: monthTicks(revenue.map((r) => r?.month)) });
  } else if (revenue.length) {
    // No month has partner-sourced revenue above zero: a recorded zero reads
    // as $0, and no recorded month at all reads as not recorded.
    out.push({ kind: 'rows', unit: 'usd', items: [{ label: 'Partner-sourced revenue', value: values.some((v) => v != null) ? 0 : 'Not recorded' }] });
  }
  return out;
}

const MARKET_PARTS = [['Demand', 'v1'], ['Regulation', 'v2'], ['Partners', 'v3'], ['Cost to enter', 'grey']];

function marketExpansion(s) {
  const markets = list(s);
  if (!markets.length) return [];
  const scoreOf = (m, part) => {
    const p = list(m?.parts).find((x) => x?.part === part);
    return num(p?.score) ? p.score : null;
  };
  const out = [{
    kind: 'stack',
    rows: markets.map((m) => ({ label: String(m?.market ?? ''), parts: MARKET_PARTS.map(([part]) => scoreOf(m, part)) })),
    tones: MARKET_PARTS.map(([, tone]) => tone),
    legend: MARKET_PARTS.map(([label, tone]) => ({ label, tone })),
  }];
  // A part with no score has no width to draw; the card says which.
  const gaps = markets
    .map((m) => ({ market: String(m?.market ?? ''), missing: MARKET_PARTS.map(([part]) => part).filter((part) => scoreOf(m, part) == null) }))
    .filter((g) => g.missing.length);
  if (gaps.length) out.push({ kind: 'rows', items: gaps.map((g) => ({ label: g.market, value: `${g.missing.join(', ')} not scored`, tone: 'warn' })) });
  return out;
}

/** The calendar draws this many obligations; the rest are counted. */
const EVENTS_SHOWN = 4;

function durableCompanyBuilding(s) {
  const d = obj(s);
  if (!d) return [];
  const out = [];
  const events = list(d.calendar);
  const shown = events.slice(0, EVENTS_SHOWN).map((e) => ({ label: clip(String(e?.title ?? ''), 22), date: dayLabel(e?.due), done: false }));
  if (shown.length >= 2) out.push({ kind: 'timeline', steps: shown });
  else if (shown.length === 1) out.push({ kind: 'rows', items: [{ label: shown[0].label, value: shown[0].date }] });
  if (events.length > EVENTS_SHOWN) out.push({ kind: 'rows', items: [{ label: 'More due in the next 90 days', value: events.length - EVENTS_SHOWN }] });
  const c = obj(d.checklist);
  if (c && num(c.total) && c.total > 0) {
    out.push({ kind: 'progress', items: [{ label: `Checklist · ${num(c.done) ? c.done : 0} of ${c.total}`, pct: num(c.pct) ? c.pct : null }] });
  }
  return out;
}

export const CARDS = {
  'product-improvement': productImprovement,
  distribution,
  'revenue-and-traction': revenueAndTraction,
  'team-expansion': teamExpansion,
  'partner-network': partnerNetwork,
  'market-expansion': marketExpansion,
  'durable-company-building': durableCompanyBuilding,
};

// ---------- Figures ----------------------------------------------------------

/**
 * D664's figures are already in the page's units (`usd`, `pct`, `count`),
 * except the fallback it writes when MRR cannot be read, which says
 * `usd_cents`. That one becomes `usd`, in dollars.
 */
export function figure(f) {
  if (!f || typeof f !== 'object') return f;
  if (f.unit === 'usd_cents') return { ...f, unit: 'usd', value: num(f.value) ? f.value / 100 : f.value };
  if (['usd', 'pct', 'score', 'of', 'count'].includes(f.unit)) return f;
  return { ...f, unit: 'count' };
}

// ---------- Records ----------------------------------------------------------

const pill = (map, v) => (Object.prototype.hasOwnProperty.call(map, v) ? { text: map[v][0], tone: map[v][1] } : (v == null ? null : String(v)));
const word = (map, v) => (v == null ? null : Object.prototype.hasOwnProperty.call(map, v) ? map[v] : String(v));
const usd = (cents) => (num(cents) ? (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : null);
const typed = (text, source) => (text == null ? null : source === 'manual' ? `${text} · typed` : text);
const reasonCell = (reason) => (reason ? { text: String(reason), tone: 'muted' } : null);
const options = (map) => Object.entries(map).map(([value, v]) => ({ value, label: Array.isArray(v) ? v[0] : v }));

const FEEDBACK_SOURCE = { customer: 'Customer', investor: 'Investor', team: 'Team' };
const FEEDBACK_STATUS = { open: ['Open', 'warn'], planned: ['Planned', 'v2'], shipped: ['Shipped', 'ok'] };
const CHANNEL_STATE = { active: ['Active', 'ok'], testing: ['Testing', 'v2'], paused: ['Paused', 'grey'] };
const ROLE_STATUS = { open: 'Open', published: 'Published', draft: 'Draft' };
const PARTNER_TYPE = { reseller: 'Reseller', integration: 'Integration', agency: 'Agency', referral: 'Referral', other: 'Other' };
const PARTNER_PILL = { talking: ['Talking', 'v3'], terms: ['Terms', 'v2'], signed: ['Signed', 'ok'], ended: ['Ended', 'grey'] };
const MARKET_STATE = { considering: 'Considering', entering: 'Entering', served: 'Served', not_now: 'Not now' };
const DECISION = { enter: 'Enter', not_yet: 'Not yet', exit: 'Exit' };
const OBLIGATION_KIND = { governance: 'Governance', compliance: 'Compliance', risk: 'Risk', tax: 'Tax', other: 'Other' };
const OBLIGATION_STATE = { scheduled: ['Scheduled', 'v2'], upcoming: ['Upcoming', 'v3'], draft: ['Draft', 'grey'], done: ['Done', 'ok'], not_set_up: ['Not set up', 'warn'] };

/** A KPI row's value: MRR is in dollars, a movement in cents, customers a count. */
function kpiValue(r) {
  if (!num(r.value)) return reasonCell(r.reason) || null;
  if (r.unit === 'usd_cents') return usd(r.value);
  if (r.kpi === 'MRR') return usd(r.value * 100);
  return r.value.toLocaleString('en-US');
}

function kpiChange(r) {
  if (!num(r.change_30d)) return null;
  if (r.change_30d === 0) return 'no change';
  const size = r.kpi === 'MRR' ? usd(Math.abs(r.change_30d) * 100) : Math.abs(r.change_30d).toLocaleString('en-US');
  return `${r.change_30d > 0 ? '▲' : '▼'} ${size}`;
}

/**
 * What an Edit form starts from (`forms.js`): the row's own store id and the
 * raw values its route takes, only when the read named the id. A row without
 * one draws no Edit.
 */
const editOf = (id, r, keys) => (id == null ? null : { ...Object.fromEntries(keys.map((k) => [k, r[k] ?? null])), ...id });
const MARKET_FIELDS = ['state', 'decision', 'demand_score', 'demand_source', 'regulation_score', 'regulation_source', 'partners_score', 'partners_source', 'cost_score', 'cost_source'];

/**
 * Column keys in the order the read lists its labels; each row builder fills
 * them. D664's records take ONE `field:value` filter and sort on a row field
 * (`-` for descending), so each table offers one filter and sorts by field.
 */
export const RECORDS = {
  'product-improvement': {
    keys: ['feedback', 'source', 'theme', 'roadmap_item', 'status'],
    row: (r, i) => ({ id: r.uid ?? `feedback-${i}`, cells: {
      feedback: r.body ?? null,
      source: r.source == null ? null : `${word(FEEDBACK_SOURCE, r.source)}${r.from_name ? ` · ${r.from_name}` : ''}`,
      theme: r.theme ?? null,
      roadmap_item: r.roadmap_item_label ?? null,
      status: pill(FEEDBACK_STATUS, r.status),
    }, edit: editOf(r.uid == null ? null : { uid: r.uid }, r, ['status', 'theme', 'roadmap_item_label']) }),
    filters: [{ key: 'status', label: 'Status', options: options(FEEDBACK_STATUS) }],
    sorts: [{ key: '-created_at', label: 'Newest' }, { key: 'created_at', label: 'Oldest' }, { key: 'theme', label: 'Theme' }],
  },
  distribution: {
    keys: ['channel', 'state', 'spend', 'customers', 'cac'],
    row: (r, i) => ({ id: r.uid ?? `channel-${i}`, cells: {
      channel: r.name ?? null,
      state: pill(CHANNEL_STATE, r.state),
      spend: typed(usd(r.spend_cents), r.spend_source),
      customers: num(r.customers) ? r.customers : null,
      cac: usd(r.cac_cents) ?? reasonCell(r.cac_reason),
    }, edit: editOf(r.uid == null ? null : { uid: r.uid }, r, ['name', 'state']) }),
    filters: [{ key: 'state', label: 'State', options: options(CHANNEL_STATE) }],
    sorts: [{ key: '-cac_cents', label: 'Highest CAC' }, { key: 'cac_cents', label: 'Lowest CAC' }, { key: 'name', label: 'Name' }],
  },
  'revenue-and-traction': {
    keys: ['kpi', 'value', 'change', 'source', 'as_of'],
    row: (r, i) => ({ id: `kpi-${i}-${r.kpi}`, cells: {
      kpi: r.kpi ?? null,
      value: kpiValue(r),
      change: kpiChange(r),
      source: r.source ?? null,
      as_of: r.as_of ?? null,
    } }),
    filters: [],
    sorts: [],
  },
  'team-expansion': {
    keys: ['role', 'team', 'applicants', 'in_interview', 'target_start'],
    row: (r, i) => ({ id: r.id ?? `role-${i}`, cells: {
      // The role's applicants are reviewed on the job board's own page.
      role: r.title == null ? null : num(r.id) ? { text: String(r.title), href: `/jobs/${r.id}/manage` } : String(r.title),
      team: r.team ?? null,
      applicants: num(r.applicants) ? r.applicants : null,
      in_interview: num(r.in_interview) ? r.in_interview : null,
      target_start: r.target_start ?? null,
    } }),
    filters: [{ key: 'status', label: 'Status', options: options(ROLE_STATUS) }],
    sorts: [{ key: '-applicants', label: 'Most applicants' }, { key: 'title', label: 'Role' }, { key: 'target_start', label: 'Target start' }],
  },
  'partner-network': {
    keys: ['partner', 'type', 'stage', 'terms', 'revenue'],
    row: (r, i) => ({ id: r.uid ?? `partner-${i}`, cells: {
      partner: r.name ?? null,
      type: word(PARTNER_TYPE, r.type),
      stage: pill(PARTNER_PILL, r.stage),
      terms: r.terms ?? null,
      revenue: typed(usd(r.revenue_cents), r.revenue_source),
    }, edit: editOf(r.uid == null ? null : { uid: r.uid }, r, ['type', 'stage', 'terms']) }),
    filters: [{ key: 'stage', label: 'Stage', options: options(PARTNER_PILL) }],
    sorts: [{ key: 'name', label: 'Name' }, { key: '-revenue_cents', label: 'Revenue sourced' }],
  },
  'market-expansion': {
    keys: ['market', 'state', 'readiness', 'weakest_part', 'decision'],
    row: (r, i) => ({ id: r.uid ?? `market-${i}`, cells: {
      market: r.name ?? null,
      state: word(MARKET_STATE, r.state),
      readiness: num(r.readiness) ? `${r.readiness} / 40` : reasonCell(r.readiness_reason),
      weakest_part: r.weakest_part ?? null,
      decision: r.decision == null ? null : `${word(DECISION, r.decision)}${r.decided_on ? ` · ${r.decided_on}` : ''}`,
    }, edit: editOf(r.uid == null ? null : { uid: r.uid }, r, MARKET_FIELDS) }),
    filters: [{ key: 'state', label: 'State', options: options(MARKET_STATE) }],
    sorts: [{ key: '-readiness', label: 'Readiness' }, { key: 'name', label: 'Name' }],
  },
  'durable-company-building': {
    keys: ['obligation', 'kind', 'due', 'owner', 'state'],
    row: (r, i) => ({ id: r.id ?? `obligation-${i}`, cells: {
      obligation: r.title ?? null,
      kind: word(OBLIGATION_KIND, r.kind),
      due: typeof r.due_at === 'string' ? r.due_at.slice(0, 10) : null,
      owner: r.owner_name ?? { text: 'No owner', tone: 'warn' },
      state: pill(OBLIGATION_STATE, r.status),
    }, edit: editOf(num(r.id) ? { id: r.id } : null, r, ['status', 'owner_name', 'due_at']) }),
    filters: [{ key: 'status', label: 'State', options: options(OBLIGATION_STATE) }],
    sorts: [{ key: 'due_at', label: 'Due soonest' }, { key: '-due_at', label: 'Due latest' }],
  },
};

/**
 * D1061 (#2931, part 5 of #2427) — Portfolio › Reports (RPT9), the company
 * page's Figures, Reports and Terms (RPT10), the reader's words (RPT11) and
 * the holding variants (RPT13), as pure rules. No React here, so
 * `frontend/test/portfolio_reports_d1061.test.mjs` loads it alone.
 *
 * WHAT IS READ (all the investor's own, scoped by the Worker):
 *   - `GET /api/reporting/portfolio` and `/companies/:uid` (D1058): each
 *     company that owes the caller, its duties (with the holding's route,
 *     D1061) and periods (each state worked out on read, with the report that
 *     met it);
 *   - `GET /api/reporting/companies/:uid/figures` (D1061): the frozen figures
 *     of each report received, which records no open;
 *   - `GET /api/reporting/reports/:uid` (D1059): one report, in the reader;
 *   - `GET /api/positions`: the investor's own holding in the company.
 *
 * NEVER ANOTHER INVESTOR, NO SCORE, NO RED. A late period is amber, a sent one
 * green, and nothing ranks a company. A missing value is "Not recorded" with
 * its reason, never 0, and a chart draws a gap as a dashed line, never a drop.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;

/** "14 Nov 2026" from a stored day or stamp; null when unreadable. */
export function dayOf(raw, withYear = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  if (!m || !MONTHS[Number(m[2]) - 1]) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${withYear ? ` ${m[1]}` : ''}`;
}
const at = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
const todayOf = (now) => new Date(now).toISOString().slice(0, 10);

/** A period label as people say it: `2026-09` Sep 2026, `2026-Q3` Q3 2026, `FY2026` FY 2026, `B2027` the 2027 budget. */
export function periodWord(label) {
  const s = String(label ?? '');
  let m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && MONTHS[Number(m[2]) - 1]) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})-Q([1-4])$/.exec(s);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = /^FY(\d{4})$/.exec(s);
  if (m) return `FY ${m[1]}`;
  m = /^B(\d{4})$/.exec(s);
  if (m) return `${m[1]} budget`;
  return s || 'Period not recorded';
}

export const KIND_WORDS = Object.freeze({
  monthly_financials: 'Monthly financial statements',
  quarterly_kpi: 'Quarterly KPI report',
  quarterly_update: 'Quarterly investor update',
  annual_audited: 'Annual audited statements',
  annual_budget: 'Annual budget',
});
export const DOCUMENT_WORDS = Object.freeze({
  voting_rights: 'Investors’ Rights Agreement',
  term_sheet: 'Term Sheet',
  deal_pack_term_sheet: 'Term Sheet (deal pack)',
  deal_pack_side_letter: 'Side Letter (deal pack)',
});

/** The holding's route as the investor reads it (RPT13). Null when the line carries none. */
export const ROUTE_WORDS = Object.freeze({
  direct: 'Direct',
  syndicate: 'Via a syndicate (SPV)',
  axal_fund: 'Via an Axal VC fund',
  third_party_fund: 'Via a third-party fund',
});
export const routeOf = (company) => {
  const routes = [...new Set((company?.duties || []).map((d) => d?.holding?.route).filter(Boolean))];
  return routes.length === 1 ? routes[0] : routes.length ? 'mixed' : null;
};

/** RPT13's notes, one per route that changes what the investor sees. */
export const HOLDING_NOTES = Object.freeze({
  syndicate: 'You hold this through a syndicate (SPV). Reports reach you through the SPV, and only the SPV’s lead can waive a period.',
  axal_fund: 'Feeds the fund’s quarterly LP report. The company reports to the fund, and its LPs read the fund’s report.',
  third_party_fund: 'You hold this through a third-party fund. StudioOS records what the company sends that fund; the fund reports to its own investors.',
});

// ───────────────────────────────────────────────────────────── a period

/** Whether a sent period went out after its due day, and by how many days. */
export function sentLate(p) {
  if (p?.state !== 'sent' || !p.sent_at || !p.due_on) return null;
  const d = Math.round((at(p.sent_at) - at(p.due_on)) / DAY);
  return d > 0 ? d : 0;
}

/**
 * A period's pill: its words and its tone. No red: late and missing are
 * amber, sent is green, the rest are neutral.
 */
export function periodPill(p) {
  const s = p?.state;
  if (s === 'sent') {
    const late = sentLate(p);
    return { tone: 'ok', text: late ? `Sent · ${late} ${late === 1 ? 'day' : 'days'} late` : 'Sent · on time' };
  }
  if (s === 'waived') return { tone: 'neutral', text: `Waived${p.waived_at ? ` · ${dayOf(p.waived_at)}` : ''}` };
  if (s === 'late') return { tone: 'late', text: `Late · ${p.days_late} ${p.days_late === 1 ? 'day' : 'days'}` };
  if (s === 'missing') return { tone: 'late', text: 'Missing' };
  if (s === 'due') return { tone: 'neutral', text: p.days_left === 0 ? 'Due today' : `Due in ${p.days_left} ${p.days_left === 1 ? 'day' : 'days'}` };
  if (s === 'upcoming') return { tone: 'neutral', text: `Due ${dayOf(p.due_on)}` };
  return { tone: 'neutral', text: 'Not recorded' };
}

/** The strip's symbol, oldest to newest (RPT9's legend). */
export function stripMark(p) {
  if (p?.state === 'sent') return sentLate(p) ? '✓●' : '✓';
  if (p?.state === 'waived') return '–';
  if (p?.state === 'late') return '◷';
  if (p?.state === 'missing') return '⌀';
  return '○';
}
export const STRIP_LEGEND = 'Strip, oldest to newest: ✓ sent on time · ✓● sent late · – waived · ◷ late now · ⌀ missing · ○ upcoming.';

const open = (p) => p && p.state !== 'sent' && p.state !== 'waived';
const SEVERITY = { missing: 4, late: 3, due: 2, upcoming: 1 };

// ───────────────────────────────────────────────────────────── RPT9: Portfolio › Reports

/**
 * One row per company that owes the caller: the holding (route, and the
 * position's amount when held directly), the next due, the last received, the
 * state of the period that needs the most attention, and the last 8 periods.
 */
export function companyRows(companies, positions = []) {
  const posOf = new Map((Array.isArray(positions) ? positions : []).map((p) => [String(p?.project?.uid ?? ''), p]));
  return (Array.isArray(companies) ? companies : []).map((c) => {
    const kindOf = new Map((c.duties || []).map((d) => [d.uid, d.kind]));
    const periods = (Array.isArray(c.periods) ? c.periods : []).map((p) => ({ ...p, kind: kindOf.get(p.duty_uid) || null }))
      .sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
    const next = periods.filter(open).sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)))[0] || null;
    const last = periods.filter((p) => p.state === 'sent' && p.sent_at).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0] || null;
    const worst = periods.filter(open).sort((a, b) => (SEVERITY[b.state] || 0) - (SEVERITY[a.state] || 0) || String(a.due_on).localeCompare(String(b.due_on)))[0] || null;
    const route = routeOf(c);
    const pos = posOf.get(String(c.uid)) || null;
    const amount = Number(pos?.total_invested);
    return {
      uid: c.uid,
      name: c.name || 'Company',
      route,
      holding: [route && route !== 'mixed' ? ROUTE_WORDS[route] : route === 'mixed' ? 'Several holdings' : null,
        Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} invested` : null]
        .filter(Boolean).join(' · ') || 'Not recorded',
      kinds: [...new Set((c.duties || []).map((d) => d.kind).filter(Boolean))],
      next: next ? { label: periodWord(next.label), kind: KIND_WORDS[next.kind] || 'Report', due: dayOf(next.due_on), due_on: next.due_on } : null,
      last: last ? { label: periodWord(last.label), kind: KIND_WORDS[last.kind] || 'Report', on: dayOf(last.sent_at), at: last.sent_at } : null,
      state: worst ? { key: worst.state, ...periodPill(worst), expected: worst.expected_on ? dayOf(worst.expected_on) : null } : periods.length ? { key: 'sent', tone: 'ok', text: 'All sent', expected: null } : { key: 'none', tone: 'neutral', text: 'No period yet', expected: null },
      strip: periods.slice(-8).map((p) => ({ uid: p.uid, mark: stripMark(p), title: `${periodWord(p.label)} · ${periodPill(p).text}` })),
    };
  });
}

/** RPT9's four tiles. Each counts the caller's own periods; nothing ranks a company. */
export function reportTiles(companies, now = new Date()) {
  const today = todayOf(now);
  const month = today.slice(0, 7);
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const qStart = `${today.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const all = (Array.isArray(companies) ? companies : []).flatMap((c) => (c.periods || []).map((p) => ({ ...p, company: c.name || 'Company' })));
  const names = (xs) => [...new Set(xs.map((p) => p.company))];
  const dueMonth = all.filter((p) => open(p) && String(p.due_on).slice(0, 7) === month);
  const dueQuarter = all.filter((p) => String(p.due_on) >= qStart && String(p.due_on) <= today);
  const receivedQuarter = all.filter((p) => p.state === 'sent' && p.sent_at && String(p.sent_at).slice(0, 10) >= qStart);
  const late = all.filter((p) => p.state === 'late');
  const missing = all.filter((p) => p.state === 'missing');
  return [
    { key: 'due', label: 'Due this month', value: String(dueMonth.length), sub: dueMonth.length ? names(dueMonth).join(', ') : 'Nothing due this month' },
    { key: 'received', label: 'Received this quarter', value: `${receivedQuarter.length} of ${dueQuarter.length}`, sub: `since ${dayOf(qStart, false)}` },
    { key: 'late', label: 'Late', value: String(late.length), sub: late.length ? late.map((p) => `${p.company}${p.expected_on ? ` · expected ${dayOf(p.expected_on, false)}` : ''}`).join(', ') : 'Nothing late' },
    { key: 'missing', label: 'Missing', value: String(missing.length), sub: missing.length ? names(missing).join(', ') : 'Nothing came due unsent' },
  ];
}

export const STATE_FILTERS = Object.freeze([['', 'Every state'], ['missing', 'Missing'], ['late', 'Late'], ['due', 'Due'], ['upcoming', 'Upcoming'], ['sent', 'All sent']]);
export const SORTS = Object.freeze([['due', 'Due soonest'], ['company', 'Company'], ['received', 'Last received']]);

/** Search, state, kind and holding filters, and the sort. A row with no next due sorts last. */
export function filterRows(rows, { q = '', state = '', kind = '', route = '', sort = 'due' } = {}) {
  const needle = String(q).trim().toLowerCase();
  const out = (Array.isArray(rows) ? rows : []).filter((r) => (!needle || r.name.toLowerCase().includes(needle))
    && (!state || r.state.key === state) && (!kind || r.kinds.includes(kind)) && (!route || r.route === route));
  const by = {
    due: (a, b) => (a.next ? 0 : 1) - (b.next ? 0 : 1) || String(a.next?.due_on || '').localeCompare(String(b.next?.due_on || '')) || a.name.localeCompare(b.name),
    company: (a, b) => a.name.localeCompare(b.name),
    received: (a, b) => (a.last ? 0 : 1) - (b.last ? 0 : 1) || String(b.last?.at || '').localeCompare(String(a.last?.at || '')) || a.name.localeCompare(b.name),
  };
  return [...out].sort(by[sort] || by.due);
}

// ───────────────────────────────────────────────────────────── RPT10: Figures

/** The five small multiples, in the canvas's order. */
export const FIGURE_KEYS = Object.freeze(['mrr', 'customers', 'net_burn', 'runway', 'headcount']);
export const FIGURE_LABELS = Object.freeze({ mrr: 'MRR', customers: 'Customers', net_burn: 'Net burn', runway: 'Runway', headcount: 'Headcount' });

const PROVIDER = { stripe: 'Stripe', mercury: 'Mercury', manual: 'typed by the company', founder: 'typed by the company', roster: 'the team roster',
  job_postings: 'job postings', growth_partners: 'the partner list', markets: 'the market list', checklist: 'the checklist', shipped: 'the roadmap' };

/** A figure's source in words: "Connector · Stripe", "Typed · typed by the company", with "computed" when it was. */
export function sourceWords(source) {
  if (!source || typeof source !== 'object') return null;
  return [source.word, PROVIDER[source.provider] || source.provider, source.computed ? 'computed' : null].filter(Boolean).join(' · ');
}

/** A value in its unit, or null (drawn "Not recorded"), never "0" for a missing one. */
export function formatValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  if (unit === 'usd') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (unit === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'months') return `${Math.round(v * 10) / 10} mo`;
  return v.toLocaleString('en-US');
}

/**
 * One figure across the reports received, oldest first: each report's
 * period, its value or null with the reason it is missing, whether that
 * report is a correction (a ring), and the same period a year earlier when a
 * report carried it (the dotted line).
 */
export function seriesOf(reports, key) {
  const list = (Array.isArray(reports) ? reports : []).slice().sort((a, b) => String(a?.period?.start).localeCompare(String(b?.period?.start)));
  const pointOf = (r) => {
    const f = (r.figures || []).find((x) => x.key === key);
    return {
      uid: r.uid,
      label: periodWord(r.period?.label),
      start: r.period?.start || null,
      value: f && f.value != null && Number.isFinite(Number(f.value)) ? Number(f.value) : null,
      reason: !f ? 'Not in this report' : f.value == null ? (f.left_out_reason || 'Not recorded') : null,
      unit: f?.unit || null,
      source: f ? sourceWords(f.source) : null,
      corrected: !!r.corrected,
    };
  };
  const points = list.map(pointOf);
  const byStart = new Map(points.map((p) => [p.start, p]));
  const yearBefore = (start) => (start ? `${Number(start.slice(0, 4)) - 1}${start.slice(4)}` : null);
  const prior = points.map((p) => byStart.get(yearBefore(p.start))?.value ?? null);
  const shown = points.filter((p) => p.value != null);
  return {
    key, label: FIGURE_LABELS[key] || key,
    unit: shown[0]?.unit || points.find((p) => p.unit)?.unit || null,
    points,
    prior: prior.some((v) => v != null) ? prior : null,
    recorded: shown.length,
    sources: [...new Set(points.map((p) => p.source).filter(Boolean))],
  };
}

/** A chart's sentence for a screen reader and under it. */
export function seriesLine(s) {
  const shown = s.points.filter((p) => p.value != null);
  if (!shown.length) return `${s.label} is not recorded in any report you received.`;
  const first = shown[0]; const last = shown[shown.length - 1];
  const parts = [shown.length === 1
    ? `${s.label} was ${formatValue(first.value, s.unit)} in ${first.label}.`
    : `${s.label} went from ${formatValue(first.value, s.unit)} in ${first.label} to ${formatValue(last.value, s.unit)} in ${last.label}.`];
  const gaps = s.points.filter((p) => p.value == null);
  if (gaps.length) parts.push(`${gaps.map((p) => p.label).join(', ')}: not recorded.`);
  const fixed = s.points.filter((p) => p.corrected && p.value != null);
  if (fixed.length) parts.push(`${fixed.map((p) => p.label).join(', ')} ${fixed.length === 1 ? 'was' : 'were'} corrected.`);
  return parts.join(' ');
}

/**
 * Eadwyn's "What changed since the last report", from frozen figures only:
 * each figure the last two reports both carried, then each period that is
 * late or missing. It never fills in a figure.
 */
export function whatChanged(reports, periods = []) {
  const list = (Array.isArray(reports) ? reports : []).slice().sort((a, b) => String(a?.period?.start).localeCompare(String(b?.period?.start)));
  const out = [];
  if (list.length >= 2) {
    const [prev, last] = list.slice(-2);
    for (const f of last.figures || []) {
      const p = (prev.figures || []).find((x) => x.key === f.key);
      if (f.value == null || !p || p.value == null || Number(p.value) === Number(f.value)) continue;
      out.push({
        key: f.key,
        text: `${f.label} ${formatValue(p.value, f.unit)} → ${formatValue(f.value, f.unit)}`,
        sub: [sourceWords(f.source), `${periodWord(prev.period?.label)} → ${periodWord(last.period?.label)}`].filter(Boolean).join(' · '),
      });
    }
  }
  for (const p of (Array.isArray(periods) ? periods : []).filter((x) => x.state === 'late' || x.state === 'missing')) {
    out.push({ key: `late-${p.uid}`, text: `The ${periodWord(p.label)} report has not arrived`, sub: [`Due ${dayOf(p.due_on)}`, p.expected_on ? `expected ${dayOf(p.expected_on)}` : null].filter(Boolean).join(' · ') });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── RPT10r: the Reports timeline

/** Each period, newest first, with its words and what the investor can do: read, ask, or waive. */
export function timelineRows(company) {
  const kindOf = new Map((company?.duties || []).map((d) => [d.uid, d.kind]));
  return (Array.isArray(company?.periods) ? company.periods : []).slice()
    .sort((a, b) => String(b.due_on).localeCompare(String(a.due_on)))
    .map((p) => {
      const pill = periodPill(p);
      const kind = KIND_WORDS[kindOf.get(p.duty_uid)] || 'Report';
      const late = p.state === 'late' || p.state === 'missing';
      let sub;
      if (p.state === 'sent') sub = `Sent ${dayOf(p.sent_at) || 'on a day not recorded'}`;
      else if (p.state === 'waived') sub = 'You waived this period';
      else sub = [`Due ${dayOf(p.due_on)}`, p.expected_on ? `expected ${dayOf(p.expected_on)}` : null].filter(Boolean).join(' · ') + (p.expected_note ? `: ‘${p.expected_note}’` : '');
      return {
        uid: p.uid,
        period: periodWord(p.label),
        title: `${periodWord(p.label)} · ${kind}`,
        kind,
        pill,
        sub,
        reportUid: p.state === 'sent' ? p.report_uid || null : null,
        canAsk: late && !p.asked,
        asked: !!p.asked,
        canWaive: p.state !== 'sent' && p.state !== 'waived',
      };
    });
}

// ───────────────────────────────────────────────────────────── RPT10t: Terms

/** The due rule in words. A blank deadline is the default and says so (owner question 4). */
export function dueRuleWords(d) {
  const unit = d.cadence === 'monthly' ? 'month' : d.cadence === 'quarterly' ? 'quarter' : 'year';
  if (d.due_rule === 'before_start') return `${d.due_days} days before the year starts`;
  return `${d.due_days} days after ${unit} end`;
}

/** What the company owes the caller, read only, each from its document. */
export function termsRows(company, figureLabel = (k) => k) {
  return (Array.isArray(company?.duties) ? company.duties : []).map((d) => {
    const src = d.source || {};
    return {
      uid: d.uid,
      title: d.title || KIND_WORDS[d.kind] || 'Reporting duty',
      rule: dueRuleWords(d),
      figures: Array.isArray(d.required_figures) && d.required_figures.length ? d.required_figures.map(figureLabel).join(', ') : null,
      document: DOCUMENT_WORDS[src.document] || src.document || 'Document not recorded',
      clause: src.clause || null,
      signed: !!src.signed,
      defaulted: Array.isArray(d.defaulted) && d.defaulted.length > 0,
      route: d.holding?.route ? ROUTE_WORDS[d.holding.route] || null : null,
    };
  });
}

// ───────────────────────────────────────────────────────────── RPT11: the reader

export const MODULE_TITLES = Object.freeze({
  'revenue-and-traction': 'Revenue and traction',
  'team-expansion': 'Team expansion',
  'partner-network': 'Partner network',
  'market-expansion': 'Market expansion',
  'product-improvement': 'Product improvement',
  'durable-company-building': 'Durable company-building',
});

/** A report's figures grouped by Grow module, in tab order; and what was left out, with the founders' reason. */
export function readerModules(report) {
  const figs = Array.isArray(report?.figures) ? report.figures : [];
  const order = Object.keys(MODULE_TITLES);
  const groups = order.map((m) => ({
    module: m, title: MODULE_TITLES[m],
    figures: figs.filter((f) => f.module === m && !f.left_out).map((f) => ({
      key: f.key, label: f.label, value: formatValue(f.value, f.unit),
      source: f.typed ? 'Typed · entered by the company' : f.shared_from_mercury ? `${sourceWords(f.source) || 'Connector · Mercury'} · shared by the founder` : sourceWords(f.source),
      asOf: dayOf(f.as_of),
    })),
  })).filter((g) => g.figures.length);
  const leftOut = figs.filter((f) => f.left_out).map((f) => ({ key: f.key, label: f.label, reason: f.left_out_reason || 'No reason was given' }));
  return { groups, leftOut };
}

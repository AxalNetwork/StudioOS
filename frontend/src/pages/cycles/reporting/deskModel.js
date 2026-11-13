/**
 * D1060 (#2930, part 4 of #2427) — the Reporting desk's rules over part 2's
 * `GET /api/reporting/desk` (D1058): the state words, Due next, Needs you, the
 * twelve-month calendar, Duties and its drawer, and the reminder words. No
 * React here, so `node --test` loads it alone.
 *
 * THE READ. `desk` is `{ today, project, can_write, duties[], periods[],
 * asks[], reminders }`. Each period carries its state worked out by the Worker
 * (`sent`, `waived`, `upcoming`, `due`, `late`, `missing`) with `days_left` or
 * `days_late`. Nothing here works a state out again: the Worker's word is the
 * one drawn.
 *
 * LATENESS IS NEVER RED. A late or missing period is amber; a refusal is the
 * only red on the desk. A count is drawn only when the read gave the rows it
 * counts; a holder the read does not name says so, never a blank.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

/** `2026-11-14` → `14 Nov`; with `year`, `14 Nov 2026`. Anything else is null, never a guessed date. */
export function shortDay(v, year = false) {
  const d = dayOf(v);
  if (!d || d.m < 1 || d.m > 12) return null;
  return `${d.d} ${MONTHS[d.m - 1]}${year ? ` ${d.y}` : ''}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const HOLDER_UNNAMED = 'Holder not named';
/** The founder's view names the holder; a duty with none says so. */
export const holderName = (duty) => (duty?.holder?.name ? String(duty.holder.name) : HOLDER_UNNAMED);

/** The Worker's state, in the canvas's words. */
export function stateWord(p) {
  switch (p?.state) {
    case 'sent': return '✓ Sent';
    case 'waived': return '– Waived';
    case 'upcoming': return 'Upcoming';
    case 'due': return p.days_left === 0 ? 'Due today' : `Due in ${plural(Number(p.days_left), 'day')}`;
    case 'late': return `◷ Late · ${plural(Number(p.days_late), 'day')}`;
    case 'missing': return 'Missing';
    default: return 'Not recorded';
  }
}

/** The cell's colours. Late and missing are amber, never red (#2427's house rule). */
export const STATE_TONE = Object.freeze({
  sent: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  waived: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  upcoming: 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
  due: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200',
  late: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  missing: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100',
});
export const toneOf = (p) => STATE_TONE[p?.state] || STATE_TONE.upcoming;

const OPEN = new Set(['upcoming', 'due', 'late', 'missing']);
export const isOpen = (p) => OPEN.has(p?.state);
export const isLate = (p) => p?.state === 'late' || p?.state === 'missing';

const list = (v) => (Array.isArray(v) ? v : []);
const byDue = (a, b) => String(a.due_on).localeCompare(String(b.due_on)) || String(a.uid).localeCompare(String(b.uid));

/** Each period with its duty beside it; a period whose duty the read lacks is dropped, never drawn half. */
export function withDuties(desk) {
  const duties = new Map(list(desk?.duties).map((d) => [d.uid, d]));
  return list(desk?.periods).filter((p) => duties.has(p.duty_uid)).map((p) => ({ ...p, duty: duties.get(p.duty_uid) }));
}

/** Names, joined: `A`, `A and B`, `A, B and C`. */
export function names(xs) {
  const u = [...new Set(xs)];
  return u.length <= 1 ? (u[0] || '') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

/**
 * Due next: the earliest open period that is not yet late, with every period
 * of the same window (one report meets them all, D1059 §4), grouped by the
 * duty's title with its holders. With nothing ahead, the earliest late one.
 * Null when nothing is open.
 */
export function dueNext(desk) {
  const open = withDuties(desk).filter(isOpen).sort(byDue);
  const head = open.find((p) => !isLate(p)) || open[0];
  if (!head) return null;
  const same = open.filter((p) => p.start === head.start && p.end === head.end);
  const groups = new Map();
  for (const p of same) {
    const g = groups.get(p.duty.title) || { title: p.duty.title, holders: [], periods: [] };
    g.holders.push(holderName(p.duty)); g.periods.push(p);
    groups.set(p.duty.title, g);
  }
  const holders = new Set(same.map((p) => holderName(p.duty)));
  return {
    period: head, label: head.label, due: shortDay(head.due_on), word: stateWord(head), state: head.state,
    investors: holders.size, groups: [...groups.values()].map((g) => ({ ...g, holders: names(g.holders) })),
  };
}

/** The primary's words: "Prepare [period] report", or a plain "Prepare a report" while nothing is open. */
export const prepareLabel = (next) => (next ? `Prepare ${next.label} report` : 'Prepare a report');

/**
 * Needs you: each late or missing period, oldest first, then each investor's
 * ask (the holder of the period asked is the asker: only a holder may ask).
 */
export function needsYou(desk) {
  const rows = withDuties(desk);
  const late = rows.filter(isLate).sort(byDue).map((p) => ({
    kind: 'late', key: `late-${p.uid}`, period: p, word: stateWord(p),
    line: `${p.label} ${p.duty.title.toLowerCase()} to ${holderName(p.duty)} is ${p.state === 'missing' ? 'missing: the next period has come due too' : `${plural(Number(p.days_late), 'day')} late`}.`,
    expected: p.expected_on ? `Expected ${shortDay(p.expected_on, true)}${p.expected_note ? ` · ${p.expected_note}` : ''}` : null,
  }));
  const byUid = new Map(rows.map((p) => [p.uid, p]));
  const asks = list(desk?.asks).filter((a) => byUid.has(a.period_uid)).map((a, i) => {
    const p = byUid.get(a.period_uid);
    const on = shortDay(a.asked_at);
    return { kind: 'ask', key: `ask-${a.period_uid}-${i}`, period: p, word: '? Asked', line: `${holderName(p.duty)} asked for the ${p.label} ${p.duty.title.toLowerCase()}${on ? ` on ${on}` : ''}.` };
  });
  return [...late, ...asks];
}
export const NEEDS_YOU_LINE = 'Only you and your co-founders see this list. Investors see the state of what they are owed, nothing more.';

// ---------------------------------------------------------------- the calendar

const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/** Twelve months: the five before today's, today's, and the six after (RPT1). */
export function calendarMonths(today) {
  const t = dayOf(today);
  if (!t) return [];
  return Array.from({ length: 12 }, (_, i) => {
    const n = (t.y * 12 + (t.m - 1)) - 5 + i;
    const y = Math.floor(n / 12); const m = (n % 12) + 1;
    return { key: monthKey(y, m), label: MONTHS[m - 1].toUpperCase(), year: y, today: i === 5 };
  });
}

/**
 * One row per duty, its cells by the month a period comes due. A month with
 * no period of the duty is empty, which is not a claim about anything.
 */
export function calendarRows(desk) {
  const months = calendarMonths(desk?.today);
  const keys = new Set(months.map((m) => m.key));
  const periods = withDuties(desk);
  const rows = list(desk?.duties).map((d) => {
    const cells = Object.fromEntries(months.map((m) => [m.key, []]));
    for (const p of periods) {
      if (p.duty_uid !== d.uid) continue;
      const k = String(p.due_on).slice(0, 7);
      if (keys.has(k)) cells[k].push(p);
    }
    return { duty: d, holder: holderName(d), title: d.title, cells };
  });
  return { months, rows };
}

/** One cell's words: its state, and an expected date the founders gave. */
export function cellWords(p) {
  const w = p.state === 'sent' ? '✓ Sent' : stateWord(p);
  return { word: w, expected: p.expected_on && isOpen(p) ? `Exp. ${shortDay(p.expected_on)}` : null, title: `${p.label} · due ${shortDay(p.due_on, true) || 'not recorded'}` };
}

/** Where an arrow key moves on the grid of `rows` × `cols`, held inside it. */
export function moveCell(at, key, rows, cols) {
  const [r, c] = at;
  const next = key === 'ArrowRight' ? [r, c + 1] : key === 'ArrowLeft' ? [r, c - 1] : key === 'ArrowDown' ? [r + 1, c] : key === 'ArrowUp' ? [r - 1, c]
    : key === 'Home' ? [r, 0] : key === 'End' ? [r, cols - 1] : null;
  if (!next) return null;
  return [Math.min(Math.max(next[0], 0), Math.max(rows - 1, 0)), Math.min(Math.max(next[1], 0), Math.max(cols - 1, 0))];
}

/** The calendar as a table: every period, by due date. */
export function calendarTable(desk) {
  return withDuties(desk).sort(byDue).map((p) => ({ key: p.uid, holder: holderName(p.duty), title: p.duty.title, label: p.label, due: shortDay(p.due_on, true), word: cellWords(p).word, period: p }));
}

/** The selected period's panel (RPT7): its words, and what the founders may do on it. */
export function selectedPanel(p, canWrite) {
  if (!p) return null;
  const lines = [`Due ${shortDay(p.due_on, true) || 'not recorded'}${p.state === 'late' || p.state === 'missing' ? ` · ${plural(Number(p.days_late), 'day')} late` : ''}`];
  if (p.expected_on && isOpen(p)) lines.push(`You gave ${shortDay(p.expected_on, true)}${p.expected_note ? `: ${p.expected_note}` : ''}. ${holderName(p.duty)} sees this date.`);
  if (p.state === 'sent' && p.sent_at) lines.push(`Sent ${shortDay(p.sent_at, true)}.`);
  if (p.state === 'waived' && p.waived_at) lines.push(`Waived by ${holderName(p.duty)} on ${shortDay(p.waived_at, true)}.`);
  return {
    title: `${p.label} ${p.duty.title.toLowerCase()} to ${holderName(p.duty)}`, word: stateWord(p), lines,
    prepare: canWrite && isOpen(p), expect: canWrite && isOpen(p),
  };
}

export const CALENDAR_LINE = (today) => `Columns are the months a period comes due. The line marks today, ${shortDay(today, true) || 'not recorded'}.`;

// ---------------------------------------------------------------- duties

export const CADENCE_WORDS = Object.freeze({ monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Yearly' });
const PERIOD_END = Object.freeze({ monthly: 'month end', quarterly: 'quarter end', annual: 'year end' });

/** The due rule as the document says it: "30 days after month end", "30 days before the year starts". */
export function dueRuleWords(d) {
  const n = Number(d?.due_days);
  if (!Number.isFinite(n)) return 'Not recorded';
  if (d.due_rule === 'before_start') return `${plural(n, 'day')} before the ${d.cadence === 'annual' ? 'year' : d.cadence === 'quarterly' ? 'quarter' : 'month'} starts`;
  return `${plural(n, 'day')} after ${PERIOD_END[d.cadence] || 'the period ends'}`;
}

/** The registry's labels (`services/reportFigures.ts` `REPORT_FIGURES`), keys and aliases both. */
export const FIGURE_LABELS = Object.freeze({
  mrr: 'MRR', growth: 'Growth', customers: 'Customers', paying_accounts: 'Customers', arr: 'ARR', revenue: 'Revenue',
  net_retention: 'Net revenue retention', nrr_pct: 'Net revenue retention', gross_margin: 'Gross margin', net_burn: 'Net burn', burn: 'Net burn',
  cash_balance: 'Cash', cash: 'Cash', headcount: 'Headcount', open_roles: 'Open roles', partners_signed: 'Signed partners',
  markets_entering: 'Markets entering', shipped_items: 'Items shipped', runway: 'Runway', runway_months: 'Runway', checklist_done: 'Durability checklist done',
});
/** Migration 168's required KPI rules (D1059 §2), which a duty naming no figure requires. A test holds it to the Worker's. */
export const KPI_RULES_REQUIRED = Object.freeze({ monthly: ['cash_balance', 'net_burn', 'runway_months', 'revenue'], quarterly: ['arr', 'headcount'] });

/** The figures a duty requires, as `requiredFiguresOf` decides them, with where the list comes from. */
export function requiredFigures(d) {
  const named = list(d?.required_figures).map((k) => FIGURE_LABELS[k]).filter(Boolean);
  if (named.length) return { labels: [...new Set(named)], from: 'document' };
  const keys = d?.kind === 'monthly_financials' ? KPI_RULES_REQUIRED.monthly
    : d?.kind === 'quarterly_kpi' ? [...KPI_RULES_REQUIRED.monthly, ...KPI_RULES_REQUIRED.quarterly] : [];
  return { labels: [...new Set(keys.map((k) => FIGURE_LABELS[k]))], from: keys.length ? 'kpi_rules' : 'none' };
}
export function requiredFiguresLine(d) {
  const r = requiredFigures(d);
  if (r.from === 'none') return 'None';
  const shown = r.labels.length > 4 ? `${r.labels.length} figures · ${r.labels.slice(0, 3).join(', ')} +${r.labels.length - 3}` : r.labels.join(' · ');
  return r.from === 'kpi_rules' ? `${shown} (the studio’s KPI rules; the document names none)` : shown;
}

export const DOCUMENT_WORDS = Object.freeze({
  unaudited_statements: 'Unaudited statements', board_approved_statements: 'Board-approved statements', audited_statements: 'Audited statements',
  budget: 'Budget', financial_report: 'Financial report', financial_summary: 'Financial summary',
});
export const documentsLine = (d) => {
  const xs = list(d?.required_documents).map((k) => DOCUMENT_WORDS[k] || String(k).replace(/_/g, ' '));
  return xs.length ? xs.join(' · ') : '—';
};

/** Where the duty came from: a signed envelope, or the closing's template when no envelope was found. */
export function sourceWords(d) {
  const s = d?.source || {};
  return {
    signed: !!s.signed,
    word: s.signed ? 'Signed' : 'From the closing’s template',
    clause: s.clause || 'Clause not recorded',
    defaulted: list(d?.defaulted).includes('due_days') ? `The document names no deadline, so ${dueRuleWords(d).toLowerCase()} is the template’s default.` : null,
  };
}

export const recordLine = (r) => (r ? `${r.sent} sent · ${r.late} late · ${r.missing} missing · ${r.waived} waived` : 'Not recorded');

export const DUTY_GROUPS = Object.freeze([{ id: 'holder', label: 'Group: Investor' }, { id: 'kind', label: 'Group: Kind' }]);
export const DUTY_STATES = Object.freeze([{ id: '', label: 'Any state' }, { id: 'late', label: 'Late or missing' }, { id: 'due', label: 'Due within 14 days' }, { id: 'clear', label: 'Nothing open late' }]);

/** Duties, searched, filtered and grouped. `state` reads each duty's periods; `clear` is a duty with nothing late. */
export function dutyRows(desk, { q = '', kind = '', cadence = '', state = '', group = 'holder' } = {}) {
  const periods = withDuties(desk);
  const needle = q.trim().toLowerCase();
  const rows = list(desk?.duties).map((d) => {
    const own = periods.filter((p) => p.duty_uid === d.uid).sort(byDue);
    const next = own.find(isOpen) || null;
    return { duty: d, holder: holderName(d), next, late: own.some(isLate), due: own.some((p) => p.state === 'due') };
  }).filter((r) => (!needle || `${r.holder} ${r.duty.title}`.toLowerCase().includes(needle))
    && (!kind || r.duty.kind === kind) && (!cadence || r.duty.cadence === cadence)
    && (!state || (state === 'late' ? r.late : state === 'due' ? r.due : !r.late)));
  const by = group === 'kind' ? (r) => r.duty.title : (r) => r.holder;
  const groups = new Map();
  for (const r of rows) { const k = by(r); groups.set(k, [...(groups.get(k) || []), r]); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({ label, items }));
}

/** A duty's record strip (RPT8): each period, newest due last, in the canvas's words. */
export function recordStrip(desk, dutyUid) {
  return withDuties(desk).filter((p) => p.duty_uid === dutyUid).sort(byDue).map((p) => ({ key: p.uid, label: p.label, word: stateWord(p), state: p.state }));
}

// ---------------------------------------------------------------- reminders and expected date

export const REMINDER_DEFAULTS = Object.freeze([14, 3, 0, -7]);
/** An offset in days before the due day (negative is after): "14 days before", "On the day", "7 days late". */
export function offsetWords(n) {
  const v = Number(n);
  if (v === 0) return 'On the day';
  return v > 0 ? `${plural(v, 'day')} before` : `${plural(-v, 'day')} late`;
}
export const CHANNEL_WORDS = Object.freeze({ in_app: 'In-app', email: 'Email' });
export const REMINDERS_LINE = 'Reminders go to your team only.';
export const NOTE_MAX = 280;

/** The offsets the dialog offers: the defaults and any saved, soonest-before first. */
export const reminderChoices = (saved) => [...new Set([...REMINDER_DEFAULTS, ...list(saved).map(Number).filter(Number.isFinite)])].sort((a, b) => b - a);

/** Expected date: a day from today on, and a note within 280 characters. */
export function expectedError(day, note, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return 'Give a date.';
  if (String(day) < String(today || '')) return 'Give a date from today on.';
  if (String(note || '').trim().length > NOTE_MAX) return `Keep the note to ${NOTE_MAX} characters.`;
  return null;
}

/** Who sees the expected date: the period's holder (an expected date is one period's). */
export const expectedAudience = (period) => (period ? `${holderName(period.duty)} sees this date and note.` : '');

// ---------------------------------------------------------------- who reads the desk

/** RPT14, RPT15: the read-only line under the header for anyone the Worker gives `can_write: false`. */
export function readOnlyLine(role) {
  if (role === 'admin') return 'Read only: admins never prepare or send a company’s report.';
  return 'Read only. You can see the calendar and what was sent. The founders prepare and send reports.';
}

export const EMPTY = Object.freeze({
  title: 'No reporting duties yet.',
  line: 'They appear when an investor signs on Axal VC’s templates.',
});
export const NOT_SHARED = 'This venture’s reporting is not shared with you. The founders, their co-founders, the venture’s advisors and the studio read it.';

/**
 * D1193 (#3127) — Capital relationships part 5: Match (CRL7), Outreach
 * (CRL8), Commitments (CRL9, CRL10), Eadwyn's proposals (CRL11) and Activity
 * (CRL12), kept pure so `frontend/test/caprel_tabs_d1193.test.mjs` holds each
 * rule without a browser.
 *
 * READS. Match and Commitments draw D1190's reads; Outreach the prospects
 * (`api.raiseProspects`), the materials read and the caller's own drafts;
 * Activity its read. Every value nobody recorded reads "Not recorded", never
 * 0, and a commitment with no status is never counted.
 */
import { NO_STATUS, PASSED, STAGE_LABEL, centsText } from './capRelModel';

const day = (v) => (v ? String(v).slice(0, 10) : null);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* Match (CRL7) ------------------------------------------------------------ */

export const FIT_WORDS = { fits: 'Fits', outside: 'Outside its focus', unclear: 'Unclear' };
export const FIT_FILTERS = [{ value: '', label: 'Any fit' }, { value: 'fits', label: 'Fits' }, { value: 'unclear', label: 'Unclear' }, { value: 'outside', label: 'Outside its focus' }];
export const MATCH_PAGE = 25;
export const MATCH_SORTS = [{ value: 'name', label: 'Name' }, { value: '-size', label: 'Largest fund first' }, { value: '-vintage', label: 'Newest fund first' }];

/** The match read's query from the filters on screen: an empty filter is no filter. */
export function matchQuery(f = {}) {
  const q = {};
  if (String(f.q || '').trim()) q.q = String(f.q).trim();
  for (const k of ['hq_country', 'focus', 'size_band', 'fit', 'sort']) if (f[k]) q[k] = f[k];
  if (f.warm) q.warm = 1;
  q.limit = MATCH_PAGE;
  q.offset = Math.max(0, Number(f.offset) || 0);
  return q;
}

/** A fund's size: the directory's figure in its currency, or "Not recorded" with why. */
export const fundSize = (fund) => (fund?.fund_size_cents != null && fund?.size_currency
  ? centsText(fund.fund_size_cents, fund.size_currency) : 'Not recorded');

/** The verified investors on Axal: a count, never names (#2457 owner question 10). */
export function verifiedLine(v, venture = 'your venture') {
  if (!v || v.count == null) return v?.reason || 'Not recorded.';
  const n = Number(v.count);
  return `${n} verified ${n === 1 ? 'investor' : 'investors'} on Axal ${n === 1 ? 'has' : 'have'} a published focus that fits ${venture}. Their names stay private until they answer a Call for Capital.`;
}

/** "1–25 of 312". */
export const pageLine = (offset, count, total) => (total ? `${offset + 1}–${offset + count} of ${total}` : 'None found');

/* Outreach (CRL8) --------------------------------------------------------- */

/**
 * The follow-ups, in the canvas's four groups: overdue, today, this week
 * (the next seven days), and in conversation with no next step. A passed
 * investor is never in them.
 */
export function followUpGroups(prospects = [], today = new Date().toISOString().slice(0, 10)) {
  const live = (Array.isArray(prospects) ? prospects : []).filter((p) => p && p.stage !== PASSED);
  const week = addDays(today, 7);
  const due = (p) => (p.next_step ? day(p.next_step_due) : null);
  const byDue = (a, b) => due(a).localeCompare(due(b));
  return [
    { key: 'overdue', label: 'Overdue', items: live.filter((p) => due(p) && due(p) < today).sort(byDue) },
    { key: 'today', label: 'Today', items: live.filter((p) => due(p) === today) },
    { key: 'week', label: 'This week', items: live.filter((p) => due(p) && due(p) > today && due(p) <= week).sort(byDue) },
    { key: 'none', label: 'No next step', items: live.filter((p) => !p.next_step && ['contacted', 'meeting', 'diligence'].includes(p.stage)) },
  ];
}

/** "3 overdue · 5 due in 7 days". */
export function followUpMeta(groups) {
  const n = (k) => groups.find((g) => g.key === k)?.items.length || 0;
  return `${n('overdue')} overdue · ${n('today') + n('week')} due in 7 days`;
}

/** Snooze moves a next step a week from today, or from its own date when that is later. */
export const snoozedDue = (due, today = new Date().toISOString().slice(0, 10)) => addDays(day(due) && day(due) > today ? day(due) : today, 7);

/** A draft as an email the founder sends from their own client. No address is ever sent anywhere by Axal. */
export function mailtoHref(email, subject, body) {
  const q = new URLSearchParams();
  if (subject) q.set('subject', subject);
  if (body) q.set('body', body);
  const s = q.toString().replace(/\+/g, '%20');
  return `mailto:${email ? encodeURIComponent(email).replace(/%40/g, '@') : ''}${s ? `?${s}` : ''}`;
}

export const DRAFT_PURPOSES = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'thank_you', label: 'Thank-you after a pass' },
  { value: 'intro', label: 'Intro request' },
];

/* Commitments (CRL9, CRL10) ----------------------------------------------- */

export const COUNTED_ORDER = ['received', 'signed', 'wired', 'confirmed', 'pending'];
export const LISTED_ORDER = ['indicated', 'soft'];

/**
 * "Committed against the target": a segment per status with money, counted
 * first, then what is listed and not counted. A status with no money is not
 * drawn, and a share of the target only exists with a target.
 */
export function commitmentBar(read) {
  const by = read?.totals?.by_status || {};
  const words = read?.words?.status || {};
  const currency = read?.currency || 'USD';
  const target = read?.round?.target_cents ?? null;
  const seg = (s, counted) => {
    const cents = Number(by[s]?.cents) || 0;
    return cents > 0 ? { status: s, label: words[s] || s, cents, text: centsText(cents, currency), counted, share: target ? Math.min(100, (cents / target) * 100) : null } : null;
  };
  const counted = COUNTED_ORDER.map((s) => seg(s, true)).filter(Boolean);
  const listed = LISTED_ORDER.map((s) => seg(s, false)).filter(Boolean);
  const total = read?.totals?.counted_cents;
  return {
    counted, listed,
    total: total == null ? 'Not recorded' : centsText(total, currency),
    target: target == null ? null : centsText(target, currency),
    percent: read?.totals?.percent_of_target ?? null,
    noStatus: Number(by.not_recorded?.investors) || 0,
    noStatusCents: Number(by.not_recorded?.cents) || 0,
  };
}

/** Every commitment as a row: each line under its investor, with whether it counts and why not. */
export function commitmentRows(read, f = {}) {
  const words = read?.words || { status: {}, source: {} };
  const q = String(f.q || '').trim().toLowerCase();
  const rows = [];
  for (const inv of read?.investors || []) {
    for (const l of inv.lines || []) {
      rows.push({
        key: `${inv.key}:${l.key}`,
        prospect_id: inv.prospect_id,
        investor: inv.name,
        amount: l.cents == null ? 'Not recorded' : centsText(l.cents, l.currency),
        status: l.status,
        status_label: l.status_label || words.status?.[l.status] || NO_STATUS,
        source_label: l.source_label || words.source?.[l.source] || 'Not recorded',
        on: day(l.on),
        counted: !!l.counted && l.key === inv.chosen?.key,
        why: l.why_not_counted || (l.counted && l.key !== inv.chosen?.key ? 'Counted once, by this investor’s strongest line.' : null),
      });
    }
  }
  return rows.filter((r) => (!f.status || r.status === f.status) && (!q || r.investor.toLowerCase().includes(q)));
}

/** A source of the read that did not answer, with why, so a gap is never read as none. */
export const sourceGaps = (read) => Object.entries(read?.sources || {})
  .filter(([, s]) => s && s.state && s.state !== 'ok')
  .map(([key, s]) => ({ key, state: s.state, reason: s.reason || 'Not recorded.' }));

/** The round settings body (CRL10): only what the founder typed, the target in dollars as the writer takes it. */
export function roundBody(projectId, f) {
  const target = String(f.target ?? '').replace(/[$,\s]/g, '');
  if (target !== '' && !(Number.isFinite(Number(target)) && Number(target) >= 0)) return { error: 'Type the target as an amount, such as 1500000.' };
  if (f.currency && !/^[A-Z]{3}$/.test(f.currency)) return { error: 'The currency is three capital letters, such as USD.' };
  return {
    body: {
      project_id: projectId, name: String(f.name ?? '').trim() || null,
      target_amount: target === '' ? null : Number(target), currency: f.currency || 'USD',
      close_date: f.close_date || null, notes: String(f.notes ?? '').trim() || null,
    },
  };
}

export const CLOSE_STATES = [{ value: 'planned', label: 'Planned' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }];

/* Eadwyn's proposals (CRL11) ---------------------------------------------- */

/** The proposals grouped under the note they came from, newest note first. */
export function proposalGroups(proposals = []) {
  const groups = new Map();
  for (const p of Array.isArray(proposals) ? proposals : []) {
    const key = `${p.payload?.prospect_id}:${p.payload?.event_id}`;
    if (!groups.has(key)) {
      groups.set(key, { key, investor: p.investor || 'An investor', prospect_id: p.payload?.prospect_id, on: p.payload?.note_on || null, kind: p.payload?.note_kind || 'note', note: p.payload?.note || null, items: [] });
    }
    groups.get(key).items.push(p);
  }
  return [...groups.values()].sort((a, b) => String(b.on || '').localeCompare(String(a.on || '')));
}

/** What a proposal says it will do, in the person's words. */
export function proposalLine(p) {
  const x = p?.payload || {};
  if (x.type === 'next_step') return `Next step: ${x.text}${x.due ? ` by ${x.due}` : ''}`;
  if (x.type === 'stage_move') return `Move to ${STAGE_LABEL[x.to] || x.to}${x.why ? `: ${x.why}` : ''}`;
  return 'A proposal';
}

/** The moves Eadwyn may propose, and a person may edit one to: never Committed or Passed. */
export const PROPOSABLE = ['contacted', 'meeting', 'diligence'].map((s) => ({ value: s, label: STAGE_LABEL[s] }));

/** Accept all takes at most this many at a time (CRL11's foot). */
export const ACCEPT_ALL_MAX = 50;

/* Activity (CRL12) -------------------------------------------------------- */

export const ACTIVITY_PAGE = 25;

/** The activity read's query from the filters on screen. */
export function activityQuery(f = {}) {
  const q = {};
  if (String(f.q || '').trim()) q.q = String(f.q).trim();
  if (f.kind) q.kind = f.kind;
  if (f.investor) q.investor = f.investor;
  if (Number(f.page) > 1) q.page = Number(f.page);
  return q;
}

/** "21 Oct 2026 09:12", from the log's UTC time. */
export function whenText(iso) {
  if (!iso) return 'Not recorded';
  const d = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(iso);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The loaded rows as a CSV the person saves: when, who, what, investor, source. */
export function activityCsv(items = []) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['When (UTC)', 'Who', 'What', 'Investor', 'Source'];
  return [head, ...items.map((i) => [i.at, i.who, i.what, i.investor?.name ?? '', i.source_label])].map((r) => r.map(cell).join(',')).join('\n');
}

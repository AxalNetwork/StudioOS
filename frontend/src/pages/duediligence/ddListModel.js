/**
 * D1250 (#3265, part 6 of #2385) — the rules of Due diligence's list tabs, from
 * the owner's canvas (DDL1, DDL2, DDL13, DDL16, DDL17, DDL19): the four tiles
 * and the two charts from `GET /api/dd/overview`, the stage strip, each row's
 * cells from `GET /api/dd/cases`, the filters and their chips, Open a case's
 * checks, and the template table. Pure, so `frontend/test/dd_cases_d1250.test.mjs`
 * holds each rule.
 *
 * NEVER A ZERO FOR AN UNKNOWN. A block the overview could not read is
 * Unreadable with Try again; a request count with no due date says so; a
 * month before the first recorded decision is "Not recorded", drawn as a
 * dashed hairline, never an empty column.
 */
import { bandWord, decisionWord } from './ddModel.js';

export const READING = 'Reading…';
export const UNREADABLE = 'Unreadable';
export const PAUSED = 'Diligence changes are paused for 24 hours after an account recovery. You can still read cases.';
export const LIST_FAILED = 'We could not load the cases.';
export const LIST_FAILED_SUB = 'The rest of Approvals still works. This is not an empty list.';
export const ADVISOR_NOTE = 'Advisors review the sections they are invited to.';
export const TEMPLATES_NOTE = 'HQ edits templates. You choose one when you open a case.';
export const CHANGE_REFUSED = 'Only the case lead or an Admin can change this case.';

const nf = (n) => Number(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Who may open a case: the Worker's `POST /cases` gate. An advisor reviews and never opens. */
export const canOpenCase = (role) => role === 'admin' || role === 'partner' || role === 'investor';

/** Who may change a row from its menu: an Admin or the case lead (`PATCH /cases/:uid`, D1246). */
export const canChangeCase = (me, row) => Boolean(me) && (me.role === 'admin' || Number(row?.lead_user_id) === Number(me.id)) && row?.status !== 'archived';

/** A failed write, in the Worker's own sentence; the recovery cool-off (423) is the canvas's. */
export function refusalText(e, fallback = 'That could not be saved. Try again.') {
  if (e?.status === 423) return PAUSED;
  return e?.data?.error || e?.data?.detail || e?.message || fallback;
}

/* ------------------------------------------------------------------ *
 * The tiles (DDL1, DDL16a)
 * ------------------------------------------------------------------ */

/**
 * The four tiles from the overview. `ov` is the read, `null` while reading, or
 * `{ failed: true }`. A tile never says 0 for a figure it could not read.
 */
export function overviewTiles(ov) {
  const keys = ['open', 'ready', 'flags', 'requests'];
  const labels = { open: 'Open cases', ready: 'Ready for sign-off', flags: 'Open High or Critical flags', requests: 'Requests waiting on subjects' };
  if (!ov) return keys.map((k) => ({ key: k, label: labels[k], value: null, sub: READING, state: 'loading' }));
  if (ov.failed) return keys.map((k) => ({ key: k, label: labels[k], value: null, sub: UNREADABLE, state: 'failed' }));
  const s = ov.stages || {};
  const f = ov.severe_flags || {};
  const r = ov.requests || {};
  const tile = (key, available, value, sub, tone = '') => (available === false
    ? { key, label: labels[key], value: null, sub: UNREADABLE, state: 'failed' }
    : { key, label: labels[key], value: Number(value) || 0, sub, tone, state: 'ok' });
  const open = Number(s.open) || 0;
  const inReview = (Number(s.in_review) || 0) + (Number(s.ready) || 0);
  const flags = Number(f.open) || 0;
  const waiting = Number(r.waiting) || 0;
  let reqSub;
  if (!waiting) reqSub = 'None waiting';
  else if (r.past_due == null) reqSub = r.past_due_reason || 'No waiting request has a due date.';
  else reqSub = `${nf(r.past_due)} past due`;
  return [
    tile('open', s.available, open, open ? `${nf(inReview)} in review · ${nf(Number(s.not_started) || 0)} not started` : 'None yet'),
    tile('ready', s.available, s.ready, 'Every section has a verdict'),
    tile('flags', f.available, flags, flags ? `Across ${nf(f.cases)} ${Number(f.cases) === 1 ? 'case' : 'cases'}` : 'None raised', flags ? 'bad' : ''),
    tile('requests', r.available, waiting, reqSub, r.past_due ? 'warn' : ''),
  ];
}

/* ------------------------------------------------------------------ *
 * The charts (DDL1)
 * ------------------------------------------------------------------ */

const AGE_LABEL = { '0-7': '0–7 days', '8-14': '8–14', '15-30': '15–30', '31-60': '31–60', '60+': 'Over 60' };

/** Open cases by age: each bucket stacked before target, past target and no target date. */
export function ageChart(ages) {
  if (!ages || ages.available === false) return null;
  const rows = (ages.buckets || []).map((b) => ({
    label: AGE_LABEL[b.label] || b.label,
    parts: [
      { key: 'before', label: 'Before target IC date', value: Number(b.before_target) || 0, tone: 'violet' },
      { key: 'past', label: 'Past target IC date', value: Number(b.past_target) || 0, tone: 'amber' },
      { key: 'none', label: 'Target date not recorded', value: Number(b.no_target) || 0, tone: 'dash' },
    ],
  }));
  const sum = (k) => rows.reduce((a, r) => a + r.parts.find((p) => p.key === k).value, 0);
  const total = sum('before') + sum('past') + sum('none');
  const sentence = total
    ? `${nf(total)} open ${total === 1 ? 'case' : 'cases'}. ${nf(sum('past'))} ${sum('past') === 1 ? 'is' : 'are'} past ${sum('past') === 1 ? 'its' : 'their'} target IC date; ${nf(sum('none'))} ${sum('none') === 1 ? 'has' : 'have'} no target date recorded.`
    : 'No case is open.';
  return {
    rows,
    total,
    sentence,
    note: ages.note || null,
    legend: [{ label: 'Before target IC date', tone: 'violet' }, { label: 'Past target IC date', tone: 'amber' }, { label: 'Target date not recorded', tone: 'dash' }],
    table: { head: ['Days open', 'Before target IC date', 'Past target IC date', 'Target date not recorded'], rows: rows.map((r) => [r.label, ...r.parts.map((p) => nf(p.value))]) },
  };
}

export const DECISION_PARTS = Object.freeze([
  { key: 'proceed', label: 'Proceed', tone: 'violet' },
  { key: 'proceed_with_conditions', label: 'Proceed with conditions', tone: 'sky' },
  { key: 'do_not_proceed', label: 'Do not proceed', tone: 'amber' },
  { key: 'withdrawn', label: 'Withdrawn', tone: 'emerald' },
  { key: 'archived_without_decision', label: 'Archived without a decision', tone: 'muted' },
]);

const monthWord = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : String(ym);
};

/**
 * Decisions, the last 12 months. A month before the first recorded decision
 * is `recorded: false`: a dashed hairline saying "Not recorded", never zero.
 * The last month is this month, so far ("to date").
 */
export function decisionsChart(decisions) {
  if (!decisions || decisions.available === false) return null;
  const months = decisions.months || [];
  const rows = months.map((m, i) => {
    const label = MONTHS[Number(String(m.month).slice(5, 7)) - 1] || m.month;
    if (!m.recorded) return { label, month: m.month, recorded: false, parts: [], total: null, toDate: i === months.length - 1 };
    const parts = DECISION_PARTS.map((p) => ({ ...p, value: Number(m[p.key]) || 0 }));
    return { label, month: m.month, recorded: true, parts, total: parts.reduce((a, p) => a + p.value, 0), toDate: i === months.length - 1 };
  });
  const recorded = rows.filter((r) => r.recorded);
  const byPart = DECISION_PARTS.slice(0, 4).map((p) => ({ ...p, n: recorded.reduce((a, r) => a + r.parts.find((x) => x.key === p.key).value, 0) }));
  const top = byPart.reduce((best, p) => (p.n > (best?.n ?? 0) ? p : best), null);
  const last = rows[rows.length - 1];
  const bits = [];
  if (!recorded.length) bits.push('No decision is recorded yet.');
  else bits.push(top ? `${top.label} is the most common decision.` : 'No decision was recorded in these 12 months.');
  if (decisions.recorded_from && rows.some((r) => !r.recorded)) bits.push(`Decisions were not recorded before ${monthWord(decisions.recorded_from)}.`);
  if (last?.recorded) bits.push(`${MONTHS[Number(String(last.month).slice(5, 7)) - 1]} so far: ${nf(last.total)}.`);
  const legend = DECISION_PARTS.map((p) => ({ label: p.label, tone: p.tone }));
  if (rows.some((r) => !r.recorded)) legend.push({ label: decisions.recorded_from ? `Not recorded before ${monthWord(decisions.recorded_from)}` : 'Not recorded', tone: 'dash' });
  return {
    rows,
    sentence: bits.join(' '),
    legend,
    table: {
      head: ['Month', ...DECISION_PARTS.map((p) => p.label)],
      rows: rows.map((r) => [`${monthWord(r.month)}${r.toDate ? ' (so far)' : ''}`, ...(r.recorded ? r.parts.map((p) => nf(p.value)) : DECISION_PARTS.map(() => 'Not recorded'))]),
    },
  };
}

/* ------------------------------------------------------------------ *
 * The stage strip and the filters (DDL1, DDL16b)
 * ------------------------------------------------------------------ */

/**
 * The strip filters by one stage at a time, as `GET /cases?stage=` reads it.
 * Decided counts every decided case, as its filter lists them all; the last
 * 90 days are its sub-line.
 */
export function stageStrip(ov) {
  const s = ov && !ov.failed && ov.stages?.available !== false ? ov.stages : null;
  const n = (v) => (s ? Number(v) || 0 : null);
  return [
    { key: 'not_started', label: 'Not started', n: n(s?.not_started) },
    { key: 'in_review', label: 'In review', n: n(s?.in_review) },
    { key: 'ready', label: 'Ready for sign-off', n: n(s?.ready) },
    { key: 'decided', label: 'Decided', n: n(s?.decided), sub: s ? `${nf(Number(s.decided_90_days) || 0)} in the last 90 days` : null },
    { key: 'archived', label: 'Archived', n: n(s?.archived) },
  ];
}

export const SORTS = Object.freeze([
  { key: 'opened', label: 'Newest opened' },
  { key: 'activity', label: 'Last activity' },
  { key: 'target', label: 'Target IC date' },
  { key: 'flags', label: 'Most open flags' },
  { key: 'name', label: 'Subject name' },
]);
export const PAGE_SIZES = Object.freeze([10, 25, 50]);

export const SUBJECT_TYPES = Object.freeze([
  { key: 'project', label: 'Startup' },
  { key: 'founder', label: 'Founder' },
  { key: 'advisor', label: 'Advisor' },
  { key: 'investor', label: 'Investor' },
  { key: 'partner', label: 'Partner' },
]);
export const subjectTypeWord = (t) => SUBJECT_TYPES.find((x) => x.key === t)?.label || 'Not recorded';
export const DEPTH_WORD = Object.freeze({ lite: 'Lite', standard: 'Standard', deep: 'Deep' });
export const depthWord = (d) => DEPTH_WORD[d] || 'Not recorded';

/** The filters the panel sets, each a chip with its words. Stage, search, sort and page are not chips. */
export const FILTER_KEYS = Object.freeze(['subject_type', 'risk_band', 'template', 'decision', 'lead', 'past_target']);

export function filterChips(filters, me) {
  const out = [];
  const f = filters || {};
  if (f.subject_type) out.push({ key: 'subject_type', label: `Type: ${subjectTypeWord(f.subject_type)}` });
  if (f.risk_band) out.push({ key: 'risk_band', label: `Risk band: ${f.risk_band === 'none' ? 'Not scored yet' : bandWord(f.risk_band)}` });
  if (f.template) out.push({ key: 'template', label: `Template: ${depthWord(f.template)}` });
  if (f.decision) out.push({ key: 'decision', label: `Decision: ${f.decision === 'none' ? 'Not recorded' : decisionWord(f.decision)}` });
  if (f.lead) out.push({ key: 'lead', label: Number(f.lead) === Number(me?.id) ? 'Led by me' : 'Lead: chosen person' });
  if (f.past_target) out.push({ key: 'past_target', label: 'Past target IC date' });
  return out;
}

/** The query `GET /cases` reads: only what is set, so an empty filter is never sent. */
export function listQuery({ filters = {}, stage = '', q = '', sort = 'opened', page = 1, pageSize = 10 }) {
  const out = { sort, page, page_size: pageSize };
  for (const k of FILTER_KEYS) if (filters[k]) out[k] = k === 'past_target' ? 1 : filters[k];
  if (stage) out.stage = stage;
  if (String(q).trim()) out.q = String(q).trim();
  return out;
}

/** "1–10 of 26", or "0 of 26" when the filters match nobody. */
export function rangeText(page, pageSize, shown, total) {
  if (!shown) return `0 of ${nf(total)}`;
  const from = (page - 1) * pageSize + 1;
  return `${nf(from)}–${nf(from + shown - 1)} of ${nf(total)}`;
}
export const pageCount = (total, pageSize) => Math.max(1, Math.ceil((Number(total) || 0) / pageSize));

/** The sentence under "No cases match these filters.", from what is set. */
export function noMatchText({ filters = {}, stage = '', q = '' }, me) {
  const bits = filterChips(filters, me).map((c) => c.label.toLowerCase());
  if (stage) bits.unshift(`stage ${stageStrip(null).find((s) => s.key === stage)?.label.toLowerCase() || stage}`);
  if (String(q).trim()) bits.unshift(`“${String(q).trim()}”`);
  return bits.length ? `No case matches ${bits.join(', ')}.` : 'No case matches.';
}

/* ------------------------------------------------------------------ *
 * The rows (DDL1, DDL19)
 * ------------------------------------------------------------------ */

export const STAGE_WORD = Object.freeze({ not_started: 'Not started', in_review: 'In review', ready: 'Ready for sign-off', decided: 'Decided', archived: 'Archived' });
export const stageWord = (s) => STAGE_WORD[s] || 'Not recorded';
export const SEVERITY_WORD = Object.freeze({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' });

/** A short id: the first and last four of the uid, as the canvas writes it. */
export const shortUid = (uid) => {
  const u = String(uid || '');
  return u.length > 10 ? `${u.slice(0, 4)}…${u.slice(-4)}` : u;
};

const DAY = 86400000;
const dayOf = (v) => {
  if (!v) return null;
  const s = String(v);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : (s.includes('T') ? s : `${s.replace(' ', 'T')}Z`));
  return Number.isFinite(t) ? t : null;
};
/** "14 Nov 2026" in UTC, or null for a value that is not a day. */
export function dayText(v) {
  const t = dayOf(v);
  if (t == null) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The target IC date cell: the day and how far it is, "4 days past" in amber
 * for an open case; a decided case says when it was decided. No date is "Not
 * recorded", never a guess.
 */
export function targetCell(row, now = Date.now()) {
  const day = dayText(row?.target_ic_date);
  if (row?.stage === 'decided') {
    const dec = dayOf(row.decided_at);
    const d = dec == null ? null : new Date(dec);
    return { day: day || 'Not recorded', sub: d ? `Decided ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : null, tone: '' };
  }
  if (!day) return { day: 'Not recorded', sub: null, tone: 'muted' };
  if (row?.stage === 'archived') return { day, sub: null, tone: '' };
  const today = Math.floor(now / DAY) * DAY;
  const diff = Math.round((dayOf(row.target_ic_date) - today) / DAY);
  if (diff > 0) return { day, sub: `In ${diff} ${diff === 1 ? 'day' : 'days'}`, tone: '' };
  if (diff === 0) return { day, sub: 'Today', tone: 'warn' };
  return { day, sub: `${-diff} ${diff === -1 ? 'day' : 'days'} past`, tone: 'bad' };
}

/** Each row as the table draws it. */
export function rowCells(row, now = Date.now()) {
  const total = Number(row.checklist_total) || 0;
  const worked = Number(row.checklist_worked) || 0;
  const flags = Number(row.open_flags) || 0;
  return {
    uid: row.uid,
    name: row.subject_label || 'Not recorded',
    short: shortUid(row.uid),
    type: subjectTypeWord(row.subject_type),
    template: depthWord(row.template_depth),
    stage: row.stage,
    stageWord: stageWord(row.stage),
    decision: row.stage === 'decided' ? decisionWord(row.decision) : null,
    lead: row.lead_name || 'Not recorded',
    checklist: total ? `${nf(worked)} of ${nf(total)}` : 'No items',
    checklistPct: total ? Math.round((worked / total) * 100) : 0,
    flags,
    severity: flags && row.worst_severity ? SEVERITY_WORD[row.worst_severity] || null : null,
    severityKey: flags ? row.worst_severity || null : null,
    requests: Number(row.requests_waiting) || 0,
    band: bandWord(row.risk_band),
    bandKey: row.risk_band || null,
    target: targetCell(row, now),
    opened: dayText(row.created_at) || 'Not recorded',
  };
}

/* ------------------------------------------------------------------ *
 * Open a case (DDL2, DDL2b)
 * ------------------------------------------------------------------ */

export const CURRENCIES = Object.freeze(['EUR', 'USD', 'GBP', 'CHF']);

/**
 * "2,000,000" or "2000000.50" → whole cents; '' → null (no cheque); anything
 * else → NaN, which the dialog refuses in words.
 */
export function chequeCents(text) {
  const s = String(text ?? '').replace(/[\s,]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : NaN;
}

/** A deal as the Linked deal picker names it: the startup, the instrument or state, and when it opened. */
export function dealLabel(subjectName, deal) {
  const kind = deal.instrument || (deal.status ? deal.status[0].toUpperCase() + deal.status.slice(1) : 'Deal');
  const when = dayText(deal.created_at);
  return `${subjectName} · ${kind}${when ? ` · opened ${when}` : ''}`;
}

/**
 * What Open case sends, or the first thing the dialog must say instead. Only
 * the context fields that are filled are sent, so an empty field records
 * nothing; the Worker checks each one as `PATCH` does (D1250 §1).
 */
export function openCasePayload(form, me) {
  if (!form.subject) return { error: 'Choose the subject from the search.' };
  const label = String(form.label ?? '').trim();
  if (!label) return { error: 'Give the case a label.' };
  if (label.length > 200) return { error: 'The label is at most 200 characters.' };
  const out = {
    subject_type: form.subject_type,
    subject_id: Number(form.subject.id),
    subject_label: label,
    template_depth: form.template_depth || 'standard',
  };
  const round = String(form.round_label ?? '').trim();
  if (round.length > 80) return { error: 'The round is at most 80 characters.' };
  if (round) out.round_label = round;
  const cents = chequeCents(form.cheque);
  if (Number.isNaN(cents)) return { error: 'Write the cheque as an amount, such as 2,000,000.' };
  if (cents != null) { out.cheque_cents = cents; out.cheque_currency = form.cheque_currency || 'EUR'; }
  if (form.target_ic_date) out.target_ic_date = form.target_ic_date;
  if (form.lead && Number(form.lead.id) !== Number(me?.id)) out.lead_user_id = Number(form.lead.id);
  if (form.deal_id && form.subject_type === 'project') out.deal_id = Number(form.deal_id);
  for (const k of ['subject_legal_name', 'subject_email', 'notes']) {
    const v = String(form[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return { payload: out };
}

/** The footer's line: what opening seeds and who is told. */
export function openCaseLine(form, templates) {
  const depth = form.template_depth || 'standard';
  const t = (templates || []).find((x) => x.depth === depth)?.current;
  const version = t ? (t.built_in ? 'the built-in version' : `version v${t.version}`) : null;
  const subject = subjectTypeWord(form.subject_type).toLowerCase();
  const seeds = `This seeds the ${depthWord(depth)} template${version ? `, ${version},` : ''} for a ${subject}.`;
  const told = form.lead && !form.lead.isMe
    ? `${form.lead.name} is told they lead it. Nobody else is told until you assign a reviewer or send a request.`
    : 'Nobody is told until you assign a reviewer or send a request.';
  return `${seeds} ${told}`;
}

/* ------------------------------------------------------------------ *
 * Templates (DDL13)
 * ------------------------------------------------------------------ */

export const TEMPLATE_BLURB = Object.freeze({
  lite: 'Founders, advisors, investors, partners',
  standard: 'Default for startups · includes Lite',
  deep: 'Includes Standard',
});

/** A depth's card: its version, sections and items, or Unreadable. */
export function templateCard(t) {
  const cur = t?.current;
  if (!cur) return { depth: t?.depth, name: depthWord(t?.depth), version: null, counts: UNREADABLE, blurb: TEMPLATE_BLURB[t?.depth] || '' };
  return {
    depth: t.depth,
    name: depthWord(t.depth),
    version: cur.built_in ? 'Built-in' : `v${cur.version}`,
    counts: `${nf(cur.sections.length)} sections · ${nf(cur.item_count)} items`,
    blurb: TEMPLATE_BLURB[t.depth] || '',
  };
}

/** Each section's share of the weights, as a whole percent; the shares are of the total, never of 5. */
export function weightShares(sections) {
  const total = sections.reduce((a, s) => a + (Number(s.weight) > 0 ? Number(s.weight) : 0), 0);
  return sections.map((s) => (total > 0 && Number(s.weight) > 0 ? Math.round((Number(s.weight) / total) * 100) : null));
}

/** The editor's draft against the current version: what changed, and whether it may be saved. */
export function templateDraftState(current, draft) {
  const out = { changed: [], error: null };
  for (const s of draft) {
    const was = current.sections.find((x) => x.key === s.key);
    const w = Number(s.weight);
    if (!Number.isFinite(w) || w <= 0 || w > 5) { out.error = `${s.title}: a weight is above 0 and at most 5.`; return out; }
    if (!was) continue;
    if (Math.round(w * 100) / 100 !== Number(was.weight)) out.changed.push(`${s.title}: weight ${was.weight} → ${Math.round(w * 100) / 100}`);
    if (Boolean(s.blocking) !== Boolean(was.blocking)) out.changed.push(`${s.title}: ${s.blocking ? 'now blocks' : 'no longer blocks'}`);
  }
  if (!out.changed.length) out.error = 'Change a weight or a blocking section to save a new version.';
  return out;
}

/** What `POST /templates` takes: every section with its weight, blocking and the items it already seeds. */
export function templateBody(depth, current, draft) {
  const items = new Map((current.body?.sections || []).map((s) => [s.key, s.items]));
  return {
    depth,
    sections: draft.map((s) => ({ key: s.key, weight: Math.round(Number(s.weight) * 100) / 100, blocking: Boolean(s.blocking), items: items.get(s.key) || [] })),
  };
}

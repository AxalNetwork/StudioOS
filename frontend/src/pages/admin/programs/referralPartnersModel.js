import { parseStamp } from '../../../ui/parseStamp.js';
import { NONE_CLAIM, NOT_READ_YET, NOT_RECORDED, HQ_READS_MONEY, isFailed, isLoading, isReady } from './programsModel.js';
import { refusalSentence } from './programPagesModel.js';

/**
 * D963 (#2796, Programs part 10) — Referral partners (PG7) and Custom terms
 * (PG8), on part 5's reads (D958, `frontend/src/lib/api/referralPartners.js`).
 * Pure: the page draws what these return.
 *
 * MONEY FOLLOWS O-MONEY (A). The Worker sends accrued and paid figures to the
 * Super Admin only; a plain Admin's read carries `{ available: false, reason:
 * 'hq_reads' }`, which reads "Not read here yet" with "HQ reads these
 * figures.", never a 0. Money is never summed across currencies: one line per
 * currency, and one currency per chart.
 *
 * INTRODUCTIONS. Part 5 records two outcomes: a sign-up with the partner's
 * code (`pending`) and one that earned a commission (`converted`). The
 * canvas's In conversation and Closed are Refer & Earn's statuses, another
 * store, so they read "Not recorded" with that reason, never a zero bar.
 */

const nf = (n) => Number(n).toLocaleString('en-US');

/** Part 5's three segments (`SEGMENT_LABEL`, services/referralPartnerTerms.ts), with All first. */
export const SEGMENTS = Object.freeze([
  { key: '', label: 'All' },
  { key: 'event_organisers', label: 'Event organisers' },
  { key: 'venture_scouts', label: 'Venture scouts' },
  { key: 'deal_makers', label: 'Deal makers' },
]);
export const SEGMENT_ONE = Object.freeze({ event_organisers: 'Event organiser', venture_scouts: 'Venture scout', deal_makers: 'Deal maker' });

/** A terms state in PG8's words: the five steps, and the states around them. */
export const TERMS_WORD = Object.freeze({
  none: 'Standard rules',
  draft: 'Draft',
  submitted: 'Sent to HQ',
  approved: 'Approved by HQ',
  sent: 'Sent for signature',
  signed: 'Signed, not started',
  active: 'Active',
  ended: 'Ended',
  expired: 'Expired',
});
export const TERMS_FILTERS = Object.freeze(['none', 'draft', 'submitted', 'approved', 'sent', 'signed', 'active', 'ended', 'expired']);
export const SORTS = Object.freeze([
  { key: 'added', label: 'Added' },
  { key: 'name', label: 'Name' },
  { key: 'introductions', label: 'Introductions' },
  { key: 'last_activity', label: 'Last activity' },
]);

/** PG8's steps, in order. `submitted` sits on Draft, sent to HQ. */
export const STEPS = Object.freeze(['Draft', 'Approved by HQ', 'Sent for signature', 'Signed', 'Active']);
const STEP_OF = { draft: 0, submitted: 0, approved: 1, sent: 2, signed: 3, active: 4 };
export const stepOf = (state) => (state in STEP_OF ? STEP_OF[state] : null);

export const TERMS_FOOT = 'Send for signature opens once HQ approves. Terms take effect only when signed. Until then the standard rules apply.';
export const QUEUE_EMPTY = 'Nothing is waiting.';
export const QUEUE_WHO = 'An admin sends a partner’s custom terms to HQ from Set custom terms. The Super Admin approves them here.';
export const RULES_LOCK = 'HQ sets the standard rules.';
export const RULES_NOTE = 'What a referral code earns without custom terms.';
export const NO_EVENT_YET = 'No event pays this yet';
export const PARTNERS_EMPTY = 'No referral partner yet. HQ adds a member as a partner, in one of the three segments.';
export const INTRO_MEANS = 'An introduction is a member who signed up with the partner’s referral code. Converted: their referral earned a commission.';
export const UNRECORDED_OUTCOMES = 'In conversation and Closed are Refer & Earn’s statuses, so this program does not record them.';

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/** Whole cents as money in its own currency, never converted. */
export function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return NOT_RECORDED;
  const cur = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: n % 100 ? 2 : 0 }).format(n / 100);
  } catch {
    return `${cur} ${(n / 100).toFixed(2)}`;
  }
}

/** Is this money block one the viewer may read? */
export const moneyReadable = (m) => Boolean(m && m.available === true);

/** One line per currency: "$4,250 accrued · $2,000 paid", or "Nothing accrued yet." for none. */
export function moneyLines(m) {
  if (!moneyReadable(m)) return [];
  const currencies = [...new Set([...(m.accrued || []), ...(m.paid || [])].map((x) => x.currency))].sort();
  // A currency is listed once either side has it, so the other side's sum is a real none.
  const sumIn = (list, cur) => (list || []).filter((x) => x.currency === cur).reduce((t, x) => t + (Number(x.cents) || 0), 0);
  return currencies.map((cur) => `${money(sumIn(m.accrued, cur), cur)} accrued · ${money(sumIn(m.paid, cur), cur)} paid`);
}

/** One currency's figure on a row, or "—" when it has none in it. */
export function rowMoney(list, currency) {
  const hit = (list || []).filter((x) => !currency || x.currency === currency);
  if (!hit.length) return '—';
  return hit.map((x) => money(x.cents, x.currency)).join(' · ');
}

/* ------------------------------------------------------------------ *
 * The tiles (PG7, `dc:395`)
 * ------------------------------------------------------------------ */

export function quarterLabel(d) {
  const from = String(d?.from || '');
  return d?.quarter ? `${d.quarter}${from ? `, from ${from}` : ''} · UTC` : '';
}

/**
 * The four tiles from the summary: Active partners; With signed terms, with
 * waiting to sign; Introductions this quarter; Commission accrued · paid, one
 * line per currency, or "Not read here yet" for an Admin (O-MONEY).
 */
export function partnerTiles(read) {
  const keys = [['active', 'Active partners'], ['signed', 'With signed terms'], ['intros', 'Introductions this quarter'], ['money', 'Commission accrued · paid']];
  if (isLoading(read)) return keys.map(([key, label]) => ({ key, label, state: 'loading' }));
  if (isFailed(read) || !isReady(read) || typeof read.data !== 'object') {
    return keys.map(([key, label]) => ({ key, label, state: 'unreadable', reason: `The referral partners’ summary could not be read. ${NONE_CLAIM}` }));
  }
  const d = read.data;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const tile = (key, label, v, sub) => (v === null
    ? { key, label, state: 'placeholder', word: NOT_RECORDED, reason: 'The summary did not carry this figure.' }
    : { key, label, state: 'ready', value: nf(v), sub });
  const waiting = num(d.waiting_to_sign);
  const tiles = [
    tile('active', 'Active partners', num(d.active_partners), 'Partners whose account is active.'),
    tile('signed', 'With signed terms', num(d.with_signed_terms), waiting === null ? null : `${nf(waiting)} waiting to sign`),
    tile('intros', 'Introductions this quarter', num(d.introductions), quarterLabel(d)),
  ];
  if (!moneyReadable(d.money)) {
    tiles.push({ key: 'money', label: 'Commission accrued · paid', state: 'placeholder', word: NOT_READ_YET, reason: d.money?.message || HQ_READS_MONEY });
  } else {
    const lines = moneyLines(d.money);
    tiles.push(lines.length
      ? { key: 'money', label: 'Commission accrued · paid', state: 'ready', value: lines[0], extra: lines.slice(1), sub: quarterLabel(d) }
      : { key: 'money', label: 'Commission accrued · paid', state: 'ready', value: 'None yet', sub: `No commission accrued or paid in ${d.quarter || 'this quarter'}.` });
  }
  return tiles;
}

/* ------------------------------------------------------------------ *
 * The two charts (`dc:396-397`)
 * ------------------------------------------------------------------ */

const OUTCOME = Object.freeze({ pending: { label: 'Signed up', tone: 'sky' }, converted: { label: 'Converted', tone: 'violet' } });

/**
 * Introductions by outcome: one bar per segment, stacked by the two outcomes
 * part 5 records, over the series' 12 weeks. `segment` narrows it to one.
 */
export function introductionsChart(read, segment = '') {
  const base = { key: 'intros', title: 'Introductions by outcome' };
  if (isLoading(read)) return { ...base, state: 'loading' };
  if (isFailed(read) || !Array.isArray(read.data?.introductions)) return { ...base, state: 'unreadable', reason: `The introductions could not be read. ${NONE_CLAIM}` };
  const outcomes = (Array.isArray(read.data.outcomes) ? read.data.outcomes : ['pending', 'converted']).filter((o) => OUTCOME[o]);
  const segs = SEGMENTS.filter((s) => s.key && (!segment || s.key === segment));
  const rows = segs.map((s) => {
    const parts = outcomes.map((o) => ({
      key: o, label: OUTCOME[o].label, tone: OUTCOME[o].tone,
      value: read.data.introductions.filter((x) => x.segment === s.key && x.outcome === o).reduce((t, x) => t + (Number(x.n) || 0), 0),
    }));
    const total = parts.reduce((t, p) => t + p.value, 0);
    return { key: s.key, label: s.label, total: `${nf(total)} ${total === 1 ? 'introduction' : 'introductions'}`, parts, n: total };
  });
  const all = rows.reduce((t, r) => t + r.n, 0);
  return {
    ...base, state: 'ready',
    chart: { type: 'stackbars', head: 'Segment', parts: outcomes.map((o) => ({ key: o, label: OUTCOME[o].label })), rows },
    alt: `Introductions by segment over 12 weeks: ${rows.map((r) => `${r.label.toLowerCase()} ${nf(r.n)}`).join(', ')}.`,
    legend: outcomes.map((o) => ({ label: OUTCOME[o].label, tone: OUTCOME[o].tone })),
    missing: [{ key: 'unrecorded', label: 'In conversation and Closed', word: NOT_RECORDED, reason: UNRECORDED_OUTCOMES }],
    lines: [all ? `${nf(all)} in the 12 weeks from ${read.data.weeks_from || 'the series’ start'}.` : 'No introduction in the last 12 weeks.', INTRO_MEANS],
  };
}

/** The currencies a commission series carries, sorted, USD first when present. */
export function currenciesOf(commission) {
  if (!moneyReadable(commission)) return [];
  const all = [...new Set([...(commission.accrued || []), ...(commission.paid || [])].map((x) => x.currency))].sort();
  return all.includes('USD') ? ['USD', ...all.filter((c) => c !== 'USD')] : all;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The twelve months from `from` (YYYY-MM-DD), as YYYY-MM. */
export function monthsFrom(from, n = 12) {
  const m = /^(\d{4})-(\d{2})/.exec(String(from || ''));
  if (!m) return [];
  let y = Number(m[1]); let mo = Number(m[2]) - 1;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(mo + 1).padStart(2, '0')}`);
    mo += 1; if (mo === 12) { mo = 0; y += 1; }
  }
  return out;
}

/**
 * Commission by month, accrued and paid, in one currency. An Admin's reads
 * "Not read here yet" (O-MONEY). A month with no commission is a real 0
 * here: the read covers every commission of every partner.
 */
export function commissionChart(read, currency = null) {
  const base = { key: 'commission', title: 'Commission by month' };
  if (isLoading(read)) return { ...base, state: 'loading' };
  if (isFailed(read) || !read.data || typeof read.data !== 'object') return { ...base, state: 'unreadable', reason: `The commission could not be read. ${NONE_CLAIM}` };
  const c = read.data.commission;
  if (!moneyReadable(c)) return { ...base, state: 'pending', word: NOT_READ_YET, reason: c?.message || HQ_READS_MONEY };
  const currencies = currenciesOf(c);
  if (!currencies.length) return { ...base, state: 'unrecorded', word: 'None yet', reason: 'No commission was accrued or paid in the last 12 months.', currencies };
  const cur = currencies.includes(currency) ? currency : currencies[0];
  const months = monthsFrom(read.data.months_from);
  const pick = (list) => months.map((mo) => (list || []).filter((x) => x.month === mo && x.currency === cur).reduce((t, x) => t + (Number(x.cents) || 0), 0));
  const accrued = pick(c.accrued);
  const paid = pick(c.paid);
  const labels = months.map((mo) => MONTH[Number(mo.slice(5)) - 1]);
  const sum = (v) => v.reduce((t, x) => t + x, 0);
  return {
    ...base, state: 'ready', currency: cur, currencies,
    chart: {
      type: 'lines', labels,
      series: [{ label: 'Accrued', tone: 'violet', values: accrued.map((x) => x / 100) }, { label: 'Paid', tone: 'sky', dash: true, values: paid.map((x) => x / 100) }],
      table: { head: ['Month', `Accrued (${cur})`, `Paid (${cur})`], rows: months.map((mo, i) => [mo, money(accrued[i], cur), money(paid[i], cur)]) },
    },
    axis: cur,
    alt: `Commission accrued and paid per month in ${cur}, the last 12 months: ${money(sum(accrued), cur)} accrued and ${money(sum(paid), cur)} paid in all.`,
    legend: [{ label: 'Accrued', tone: 'violet' }, { label: 'Paid', tone: 'sky', mark: 'dashed' }],
    lines: [`${money(sum(accrued), cur)} accrued · ${money(sum(paid), cur)} paid, in ${cur} only. Paid is payouts completed.`],
  };
}

/* ------------------------------------------------------------------ *
 * The standard rules (`dc:398`)
 * ------------------------------------------------------------------ */

/** A rule's line: what it pays, and "No event pays this yet" where nothing fires it (OD4). */
export function ruleLine(rule) {
  const pays = rule.percentage_bps != null && Number(rule.percentage_bps) > 0
    ? `${(Number(rule.percentage_bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
    : rule.amount_cents != null ? money(rule.amount_cents, rule.currency || 'USD') : NOT_RECORDED;
  return {
    key: rule.rule_key,
    text: `${pays} · ${rule.description || rule.rule_key}`,
    off: Number(rule.active) !== 1,
    fires: rule.fires === true,
  };
}

/* ------------------------------------------------------------------ *
 * The partners table (`dc:399`)
 * ------------------------------------------------------------------ */

export const PAGE = 25;

/** The list read's query for the toolbar: search from two characters, the filters and the page. */
export function listParams({ q = '', segment = '', terms = '', status = '', sort = 'added', page = 0 } = {}) {
  const needle = q.trim();
  return {
    ...(needle.length >= 2 ? { q: needle } : {}),
    ...(segment ? { segment } : {}),
    ...(terms ? { terms } : {}),
    ...(status ? { status } : {}),
    ...(sort && sort !== 'added' ? { sort } : {}),
    limit: PAGE, offset: page * PAGE,
  };
}

export const dayLabel = (stamp) => {
  const ms = parseStamp(stamp);
  return ms === null ? '—' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** The row menu: what this row's terms state allows (no Pause: OD-PAUSE). */
export function rowActions(row, superAdmin) {
  const s = row?.terms_state || 'none';
  const out = [{ key: 'terms', label: 'Set custom terms' }];
  if (s === 'submitted' && superAdmin) out.push({ key: 'approve', label: 'Approve terms' });
  if (s === 'approved') out.push({ key: 'send', label: 'Send contract' });
  if (s === 'active' || s === 'signed') out.push({ key: 'end', label: 'End terms' });
  return out;
}

/* ------------------------------------------------------------------ *
 * Custom terms (PG8)
 * ------------------------------------------------------------------ */

/**
 * The triggers terms may pay on: those an event fires today (part 5's
 * `FIRING_RULES`; OD4 is open). Kept equal to the Worker's set by the test.
 * An identity check carries no amount, so it pays a flat amount only.
 */
export const FIRING_TRIGGERS = Object.freeze([
  { key: 'referral_kyc_approved', label: 'A referred member completes KYC', flatOnly: true },
]);
export const triggerLabel = (key) => FIRING_TRIGGERS.find((t) => t.key === key)?.label || key;

/** The two contracts terms are sent on (D958's `contract_slug`). */
export const CONTRACTS = Object.freeze([
  { slug: 'partner_custom', label: 'Partner Custom Deal' },
  { slug: 'finders_fee_intro_agreement', label: 'Finder’s Fee / Intro Agreement' },
]);
export const contractLabel = (slug) => CONTRACTS.find((c) => c.slug === slug)?.label || slug || NOT_RECORDED;

/** Which terms row the dialog opens: the newest draft to edit, else a live row to read, else a new draft. */
export function termsInDialog(items) {
  const list = Array.isArray(items) ? items : [];
  const draft = list.find((t) => t.state === 'draft');
  if (draft) return { mode: 'edit', terms: draft };
  const live = list.find((t) => ['submitted', 'approved', 'sent', 'signed', 'active'].includes(t.state));
  if (live) return { mode: 'read', terms: live };
  return { mode: 'new', terms: null };
}

const dollars = (cents) => (cents == null ? '' : String(Number(cents) / 100));
/** A terms row as the form holds it: dollars and percents as text. */
export function formOf(terms) {
  const t = terms || {};
  return {
    contract_slug: t.contract_slug || 'partner_custom',
    triggers: (t.triggers?.length ? t.triggers : [{ rule_key: FIRING_TRIGGERS[0].key, amount_cents: null, percentage_bps: null }]).map((g) => ({
      rule_key: g.rule_key,
      kind: g.percentage_bps != null ? 'share' : 'flat',
      value: g.percentage_bps != null ? String(Number(g.percentage_bps) / 100) : dollars(g.amount_cents),
    })),
    cap_per_intro: dollars(t.cap_per_intro_cents),
    overall_cap: dollars(t.overall_cap_cents),
    currency: t.currency || 'USD',
    starts_on: t.starts_on || '',
    ends_on: t.ends_on || '',
    sectors: (t.sectors || []).join(', '),
  };
}

const toCents = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'bad';
  const c = Math.round(Number(s) * 100);
  return c > 0 ? c : 'bad';
};
const toBps = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'bad';
  const b = Math.round(Number(s) * 100);
  return b > 0 && b <= 10000 ? b : 'bad';
};

/**
 * The form as part 5's body, or the one sentence that says what to fix. A
 * trigger pays a flat amount or a share, never both: the form holds one kind
 * per trigger, so the body carries exactly one of the two.
 */
export function termsBody(form) {
  const triggers = [];
  for (const g of form.triggers || []) {
    const def = FIRING_TRIGGERS.find((t) => t.key === g.rule_key);
    if (!def) return { error: 'Choose a trigger an event pays today.' };
    if (g.kind === 'share') {
      if (def.flatOnly) return { error: 'An identity check carries no amount, so it pays a flat amount.' };
      const bps = toBps(g.value);
      if (bps === 'bad') return { error: 'A share is a percent from 0.01 to 100.' };
      triggers.push({ rule_key: g.rule_key, amount_cents: null, percentage_bps: bps });
    } else {
      const c = toCents(g.value);
      if (c === null || c === 'bad') return { error: 'A flat amount is above 0, in the terms’ currency.' };
      triggers.push({ rule_key: g.rule_key, amount_cents: c, percentage_bps: null });
    }
  }
  if (!triggers.length) return { error: 'Name at least one trigger the terms pay on.' };
  if (new Set(triggers.map((t) => t.rule_key)).size !== triggers.length) return { error: 'Name each trigger once.' };
  const perIntro = toCents(form.cap_per_intro);
  const overall = toCents(form.overall_cap);
  if (perIntro === 'bad' || overall === 'bad') return { error: 'A cap is an amount above 0, or left empty.' };
  const currency = String(form.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'The currency is a three-letter code, such as USD.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.starts_on || '')) return { error: 'Give the date the terms start.' };
  if (form.ends_on && (!/^\d{4}-\d{2}-\d{2}$/.test(form.ends_on) || form.ends_on < form.starts_on)) return { error: 'The end date is on or after the start date.' };
  const sectors = String(form.sectors || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    body: {
      contract_slug: form.contract_slug || null,
      triggers,
      cap_per_intro_cents: perIntro,
      overall_cap_cents: overall,
      currency,
      starts_on: form.starts_on,
      ends_on: form.ends_on || null,
      sectors: sectors.length ? sectors : null,
    },
  };
}

const longDate = (iso) => {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : iso;
};

/** PG8's live sentence, built from the fields as they stand, or null until they make terms. */
export function termsSentence(name, body) {
  if (!body?.triggers?.length || !body.starts_on) return null;
  const who = name || 'This partner';
  const pays = body.triggers.map((g) => {
    const what = triggerLabel(g.rule_key).replace(/^A /, 'a ');
    return g.percentage_bps != null
      ? `${(g.percentage_bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}% when ${what}`
      : `${money(g.amount_cents, body.currency)} when ${what}`;
  }).join(', and ');
  const caps = [
    body.cap_per_intro_cents != null ? `up to ${money(body.cap_per_intro_cents, body.currency)} per introduction` : null,
    body.overall_cap_cents != null ? `${money(body.overall_cap_cents, body.currency)} in all` : null,
  ].filter(Boolean).join(' and ');
  const when = body.ends_on ? `from ${longDate(body.starts_on)} to ${longDate(body.ends_on)}` : `from ${longDate(body.starts_on)}, with no end date`;
  return `${who} earns ${pays}${caps ? `, ${caps}` : ''}, ${when}.`;
}

/* ------------------------------------------------------------------ *
 * Refusals (part 5's codes), one sentence in place
 * ------------------------------------------------------------------ */

export const PARTNER_REFUSALS = Object.freeze({
  trigger_amount_ambiguous: 'Each trigger pays a flat amount or a share, never both. Nothing was saved.',
  trigger_unknown: 'Terms can pay only on a trigger an event fires today: a referred member’s identity check. Nothing was saved.',
  trigger_share_unpaid: 'An identity check carries no amount, so a share of it pays nothing. Give a flat amount.',
  trigger_repeated: 'Name each trigger once. Nothing was saved.',
  triggers_required: 'Name at least one trigger the terms pay on. Nothing was saved.',
  trigger_amount_invalid: 'A flat amount is above 0; a share is from 0.01% to 100%. Nothing was saved.',
  invalid_dates: 'Give a start date, and an end date on or after it. Nothing was saved.',
  invalid_cap: 'A cap is an amount above 0, or left empty. Nothing was saved.',
  invalid_currency: 'The currency is a three-letter code, such as USD. Nothing was saved.',
  invalid_sectors: 'Sectors are up to 20 names. Nothing was saved.',
  terms_overlap: 'These dates overlap the partner’s other terms. A partner holds one set of terms at a time. Nothing changed.',
  terms_not_draft: 'These terms are no longer a draft, so they cannot be edited. Read them again.',
  terms_not_submitted: 'These terms are not waiting for HQ now. Read them again.',
  terms_not_approved: 'Only terms HQ approved are sent for signature. Nothing was sent.',
  terms_contract_missing: 'Name the contract before sending these terms. Nothing was sent.',
  terms_not_active: 'Only signed terms can be ended. Nothing changed.',
  terms_changed: 'These terms changed while you were looking at them. Read them again.',
  super_admin_required: 'Only the Super Admin approves a partner’s terms.',
  reason_required: 'Say why the terms end, in at least 10 characters.',
  preview_changed: 'The contract changed since the preview. Preview it again before sending.',
  referral_partner_not_found: 'That member is not a referral partner now.',
  terms_not_found: 'These terms are not on record now. Read the partner again.',
  referral_partners_unreadable: 'Referral partners could not be read just now. Nothing changed; try again.',
});
const codeOf = (err) => err?.code || err?.data?.code || (typeof err?.data?.error === 'string' ? err.data.error : null);
export function partnerRefusal(err, fallback) {
  const c = codeOf(err);
  return (c && PARTNER_REFUSALS[c]) || refusalSentence(err, fallback);
}

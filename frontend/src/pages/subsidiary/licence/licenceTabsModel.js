// D804 (#2241) — the Licences page's Contract, Statements and Requests tabs
// (canvas boards L3, L4, L5 and L8), as pure functions the tabs and their tests
// share. Every value comes from D798's and D799's answers; a fact they do not
// carry reads "Not recorded", never a guess.
import { NOT_RECORDED } from '../../../lib/absence';

export { NOT_RECORDED };

export const day = (v) => (v ? String(v).slice(0, 10) : null);

/** Cents as money in the statement's currency; null as "Not recorded". */
export function money(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return NOT_RECORDED;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(Number(cents) / 100);
  } catch { return `${(Number(cents) / 100).toLocaleString('en-GB')} ${currency || ''}`.trim(); }
}

/** Basis points as a percentage: 3500 → "35%", 1250 → "12.5%". */
export function share(bps) {
  if (bps === null || bps === undefined || !Number.isFinite(Number(bps))) return NOT_RECORDED;
  return `${Number(bps) / 100}%`;
}

// ───────────────────────────────────────────────────────────── L3 contract

/** Drafted → Sent → Signed, each with its date or "Not recorded" for a step not reached. */
export function contractSteps(c) {
  if (!c) return [];
  const signed = c.status === 'signed';
  return [
    { t: 'Drafted', d: day(c.drafted_at) || (c.sent_at || signed ? 'Done' : NOT_RECORDED), reached: true },
    { t: 'Sent', d: day(c.sent_at) || (signed ? 'Done' : NOT_RECORDED), reached: Boolean(c.sent_at) || signed || c.status === 'sent' },
    { t: 'Signed', d: day(c.signed_at) || NOT_RECORDED, reached: signed },
  ];
}

/** The Summary's two lines: "Sent 12 Oct · waiting for your signature" and "In force: v6, signed 2 Mar 2025". */
export function contractSummary(answer) {
  const lines = [];
  if (answer?.pending) lines.push(`Sent ${day(answer.pending.sent_at) || NOT_RECORDED} · waiting for your signature`);
  if (answer?.in_force) lines.push(`In force: v${answer.in_force.template_version}, signed ${day(answer.in_force.signed_at) || NOT_RECORDED}`);
  return lines;
}

const HEADING = /^#{2,3}\s+(?:§\s*)?(\d+)\.?\s+(.+?)\s*$/;

/** The section index from the body's own headings: "## 4. Fees" → { n: '4', t: 'Fees' }. */
export function sectionIndex(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) {
    const m = HEADING.exec(line);
    if (m) out.push({ n: m[1], t: m[2], id: `contract-s${m[1]}` });
  }
  return out;
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * The stored body as blocks to draw: headings (with the index's anchor) and
 * paragraphs, each paragraph a run of text and the merge fields the licence has
 * not filled, which stay in the stored body as `{{name}}` (D451) and are drawn
 * "[not filled]". Nothing is re-rendered from a template.
 */
export function bodyBlocks(body) {
  const blocks = [];
  for (const chunk of String(body || '').split(/\n{2,}/)) {
    const line = chunk.trim();
    if (!line) continue;
    const h = HEADING.exec(line);
    if (h) { blocks.push({ kind: 'heading', n: h[1], text: h[2], id: `contract-s${h[1]}` }); continue; }
    if (/^#\s+/.test(line)) { blocks.push({ kind: 'title', text: line.replace(/^#\s+/, '') }); continue; }
    const runs = [];
    let at = 0;
    for (const m of line.matchAll(TOKEN)) {
      if (m.index > at) runs.push({ text: line.slice(at, m.index) });
      runs.push({ gap: m[1] });
      at = m.index + m[0].length;
    }
    if (at < line.length) runs.push({ text: line.slice(at) });
    blocks.push({ kind: 'para', runs });
  }
  return blocks;
}

// ───────────────────────────────────────────────────────────── L4 statements

/** The four streams the canvas draws, in its order; D802 adds the royalty. */
export const STREAM_LABELS = {
  subscriptions: 'Subscriptions',
  licence_fees: 'Licence fees',
  token_margin: 'Token margin',
  platform_licence_royalties: 'Platform licence royalties',
};
const STREAM_ORDER = Object.keys(STREAM_LABELS);

/**
 * A statement's streams as rows. The four the canvas draws are always listed,
 * a missing one "Not reported"; a stream HQ stored that is not one of them
 * follows, under its key. `streams_json` is read as stored (D798).
 */
export function streamRows(streams, currency) {
  const list = Array.isArray(streams) ? streams : [];
  const by = new Map(list.map((s) => [s?.stream, s]));
  const keys = [...STREAM_ORDER, ...list.map((s) => s?.stream).filter((k) => k && !STREAM_ORDER.includes(k))];
  return keys.map((k) => {
    const s = by.get(k);
    const label = STREAM_LABELS[k] || String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    if (!s || s.available === false || s.gross_cents === null || s.gross_cents === undefined) {
      return { key: k, t: label, v: NOT_RECORDED, chip: 'Not reported' };
    }
    return { key: k, t: label, v: money(s.gross_cents, s.currency || currency), chip: s.is_estimate ? 'Estimated' : null };
  });
}

const STATUS_WORD = { issued: 'Issued', paid: 'Paid', void: 'Void' };

/** The statements table's rows; the first is open on its streams. */
export function statementRows(statements) {
  return (statements || []).map((s, i) => ({
    uid: s.uid,
    p: s.period,
    g: money(s.gross_cents, s.currency),
    s: share(s.revenue_share_bps),
    o: money(s.owed_cents, s.currency),
    pd: money(s.paid_cents, s.currency),
    d: Number(s.disputed_cents) ? money(s.disputed_cents, s.currency) : '—',
    st: Number(s.disputed_cents) > 0 && s.status !== 'void' ? 'Disputed' : (STATUS_WORD[s.status] || s.status),
    disputable: s.status === 'issued' || s.status === 'paid',
    owed_cents: Number(s.owed_cents) || 0,
    currency: s.currency,
    reference: s.payment_reference || null,
    open: i === 0,
    streams: streamRows(s.streams, s.currency),
  }));
}

/**
 * "How to pay HQ" from D798's masked `payment`: its lines, or the refusal's
 * sentence when no account carries the purpose. Never a full account number:
 * the lines are what the Worker masked.
 */
export function payRows(payment) {
  if (!payment) return { refusal: 'Payment instructions could not be read.', rows: [] };
  if (payment.refusal) return { refusal: payment.refusal, rows: [] };
  const rows = [];
  if (payment.method) rows.push({ k: 'Method', v: payment.method });
  if (payment.payee_name) rows.push({ k: 'Payee', v: payment.payee_name });
  for (const l of payment.lines || []) rows.push({ k: l.label, v: l.value, mono: !!l.mono });
  return { refusal: null, rows, warning: payment.warning || null };
}

const USAGE_WORD = { sent: 'Sent', late: 'Late', due: 'Due', not_sent: 'Not sent' };

/** Each period's usage report: "Sent 4 Sep", "Late", "Due by 5 Oct" or "Not sent". */
export function usageRows(usage) {
  return (usage?.periods || []).map((u) => ({
    m: u.period,
    st: u.status === 'sent' ? `Sent ${day(u.sent_at) || ''}`.trim()
      : u.status === 'due' && u.due_on ? `Due by ${u.due_on}` : (USAGE_WORD[u.status] || u.status),
    late: u.status === 'late',
  }));
}

/** "Send now" shows only where the Worker says a send is possible: on a branch (D808). */
export const canSendNow = (usage) => usage?.send_now === true;

/** A dispute's amount, typed in the statement's currency, as whole cents; or the sentence that refuses it. */
export function disputeCents(raw, owedCents) {
  const t = String(raw ?? '').trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false, message: 'Type the amount you dispute, with at most two decimals.' };
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  if (cents <= 0) return { ok: false, message: 'The amount must be more than zero.' };
  if (cents > owedCents) return { ok: false, message: 'You cannot dispute more than the statement says is owed.' };
  return { ok: true, cents };
}

// ───────────────────────────────────────────────────────────── L5 requests

const DAY_MS = 24 * 3600 * 1000;
const at = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)
  ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : null);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Today → Notice deadline → Renewal. The deadline is the renewal date less
 * D797's `non_renewal_notice_days`; with either unrecorded it says so.
 */
export function renewalTimeline(renewsOn, noticeDays, today) {
  const renews = at(renewsOn);
  const days = noticeDays === null || noticeDays === undefined || noticeDays === '' ? null : Number(noticeDays);
  return [
    { t: 'Today', d: isoDay(at(today) ?? Date.now()) },
    { t: 'Notice deadline', d: renews !== null && days !== null && Number.isFinite(days) ? isoDay(renews - days * DAY_MS) : NOT_RECORDED },
    { t: 'Renewal', d: renews !== null ? isoDay(renews) : NOT_RECORDED },
  ];
}

export const REQUEST_WORDS = {
  renewal: 'Renewal', terms_change: 'Change', seat_increase: 'Seats', delegate: 'Delegate', non_renewal: 'Notice of non-renewal',
  moderation: 'Moderation', content: 'Content', other: 'Other',
};

const upper = (v) => String(v).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A request's kind as the table reads it: "Seats · Founder +20", "Change · Fee". */
export function requestKind(item) {
  const r = item?.request || {};
  const w = REQUEST_WORDS[item?.kind] || upper(item?.kind || '');
  if (item?.kind === 'seat_increase' && r.seat_type) return `${w} · ${upper(r.seat_type)} +${r.seats}`;
  if (item?.kind === 'terms_change' && r.term) return `${w} · ${upper(r.term)}`;
  if (item?.kind === 'delegate') return `${w} · ${r.name || r.email || item.subject || ''}`.replace(/ · $/, '');
  return w;
}

/** Open, Answered, Declined, Withdrawn, or Past response time when an open one is past its band. */
export function requestStatus(item) {
  if (item?.status === 'open') return item.sla === 'past' ? 'Past response time' : 'Open';
  return upper(item?.status || '');
}

/** "Your requests": kind, sent, HQ's response time, status and HQ's answer inline. */
export function requestRows(items, responseHours = {}) {
  return (items || []).map((it) => {
    const h = responseHours[it.kind];
    let a = it.answer || NOT_RECORDED;
    if (!it.answer && it.status === 'open') {
      a = it.sla === 'past' ? `Not recorded · HQ is past its ${h ? `${h} h` : 'response time'}` : 'Not recorded · awaiting HQ';
    }
    return {
      uid: it.uid,
      k: requestKind(it),
      w: day(it.created_at) || NOT_RECORDED,
      rt: h ? `${h} h` : NOT_RECORDED,
      st: requestStatus(it),
      a,
    };
  });
}

// ───────────────────────────────────────────────────────────── the sheet

/**
 * The sheet's chips and the D799 request each sends: Seats is a
 * `seat_increase`; Territory, Fee and Term are a `terms_change` of that term;
 * "A deal term" is a `terms_change` of one of the terms the Worker accepts
 * beyond those four (D797's keys join `requestable_terms` when it merges).
 */
export const CHANGE_CHIPS = [
  { id: 'territory', t: 'Territory', kind: 'terms_change', term: 'territory' },
  { id: 'seats', t: 'Seats', kind: 'seat_increase' },
  { id: 'fee', t: 'Fee', kind: 'terms_change', term: 'fee' },
  { id: 'term', t: 'Term', kind: 'terms_change', term: 'term' },
  { id: 'deal', t: 'A deal term', kind: 'terms_change', term: null },
];
const LEDGER_TERMS = ['territory', 'seats', 'fee', 'term'];

/** The deal terms the Worker accepts today: `requestable_terms` less the four ledger terms. */
export const dealTerms = (requestable) => (requestable || []).filter((t) => !LEDGER_TERMS.includes(t));

/** Which chip a prefilled term opens: a ledger term its own chip, any other term "A deal term". */
export function chipForTerm(term) {
  if (!term) return 'territory';
  if (term === 'seats') return 'seats';
  return LEDGER_TERMS.includes(term) ? term : 'deal';
}

/** "As it stands", read-only, from `/mine`'s licence and D797's contract sections when present. */
export function asItStands(chip, { licence, sections, dealTerm, terms } = {}) {
  const L = licence || {};
  const sec = (k) => (sections && sections[k] ? ` · Contract ${String(sections[k]).startsWith('§') ? '' : '§'}${sections[k]}` : '');
  switch (chip) {
    case 'territory':
      return `${(L.territories || []).length ? L.territories.join(', ') : 'No territory held'}${sec('territory')}`;
    case 'seats': {
      const seats = Object.entries(L.seats || {}).filter(([, n]) => Number(n) > 0);
      const used = L.seats_used_by_type || null;
      const text = seats.length
        ? seats.map(([k, n]) => `${upper(k)} seats: ${n} licensed${used && used[k] !== undefined ? `, ${used[k]} used` : ''}`).join(' · ')
        : 'No seats licensed';
      return `${text}${sec('seats')}`;
    }
    case 'fee':
      return `Annual fee ${money(L.annual_fee_cents, L.currency)}${sec('fee')}`;
    case 'term':
      return `${L.term_years ? `${L.term_years} years` : 'Term not recorded'}${L.renews_on ? `, renews ${day(L.renews_on)}` : ''}${sec('term')}`;
    case 'deal':
      if (!dealTerm) return 'Pick the deal term to change.';
      return `${upper(dealTerm)}: ${terms && terms[dealTerm] !== undefined && terms[dealTerm] !== null ? terms[dealTerm] : NOT_RECORDED}${sec(dealTerm)}`;
    default:
      return NOT_RECORDED;
  }
}

/**
 * The POST body for the sheet, or the sentence that refuses it. `asked` is
 * what the Administrator asks for, `why` the reason HQ reads; `current` is
 * "As it stands", which a `terms_change` must carry (D799).
 */
export function buildChangeRequest(chipId, { asked, why, current, seatType, seats, dealTerm } = {}) {
  const chip = CHANGE_CHIPS.find((c) => c.id === chipId);
  if (!chip) return { ok: false, message: 'Pick what to change.' };
  const reason = String(why ?? '').trim();
  if (chip.kind === 'seat_increase') {
    const n = Number(seats);
    if (!seatType) return { ok: false, message: 'Pick the seat type.' };
    if (!Number.isInteger(n) || n < 1 || n > 10000) return { ok: false, message: 'Ask for a whole number of seats, from 1 to 10,000.' };
    return {
      ok: true,
      body: {
        kind: 'seat_increase', subject: `Seats · ${upper(seatType)} +${n}`,
        request: { seat_type: seatType, seats: n },
        ...(reason || asked ? { detail: [String(asked ?? '').trim(), reason].filter(Boolean).join('\n\n') } : {}),
      },
    };
  }
  const term = chip.term || dealTerm;
  if (!term) return { ok: false, message: 'Pick the deal term to change.' };
  const ask = String(asked ?? '').trim();
  if (!ask) return { ok: false, message: 'Say what you are asking for.' };
  return {
    ok: true,
    body: {
      kind: 'terms_change', subject: `Change · ${upper(term)}`,
      request: { term, current: String(current ?? '').slice(0, 500) || NOT_RECORDED, asked: ask.slice(0, 500) },
      ...(reason ? { detail: reason } : {}),
    },
  };
}

/** The sentence under the sheet: HQ's response time for the request it will send. */
export function responseSentence(chipId, responseHours = {}) {
  const chip = CHANGE_CHIPS.find((c) => c.id === chipId);
  const kind = chip?.kind || 'terms_change';
  const h = responseHours[kind];
  const what = kind === 'seat_increase' ? 'seat requests' : 'requests to change a term';
  return h ? `HQ answers ${what} within ${h} hours. Nothing changes until HQ does.` : 'Nothing changes until HQ does.';
}

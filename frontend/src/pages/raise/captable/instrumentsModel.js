/**
 * D1023 (#2860, part 8 of #2432) — the Instruments tab (CT3, CT3b) and the
 * instrument drawer (CT4), kept pure so the tests read them without a browser.
 *
 * WHAT IS READ. Every figure comes from a read on `main`:
 *   - the record (D1017, `GET /api/captable/record/:projectId`): the SAFEs and
 *     notes on record, each with its terms, source and document. These are On
 *     record;
 *   - Today (D1018, `GET …/scenarios/by-project/:id/today`): the record as the
 *     engine's start, with each MFN read, the post-money check, and the
 *     instruments it could not model, each with its sentence;
 *   - a round from Today (D1018, `POST …/simulate`): each instrument's
 *     conversion, as the engine worked it out. These are Modelled.
 *
 * NOTHING HERE RE-DERIVES A CONVERSION. The page draws the engine's numbers
 * (`conversions`): cap price, discount price, the price that won, shares and
 * the % after the round. The one figure worked out here is the cap's share
 * count in the drawer's first line, the cap divided by the cap price the
 * engine returned, so the line reads as the arithmetic it is.
 *
 * NEVER A RESCALED TABLE. When post-money caps promise 100% or more, the
 * engine says so (`post_money_check`), and so does the red notice here. Nothing
 * is scaled down to make the numbers fit.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { documentWord } from './historyModel.js';
import { BASIS_CHECK, day, dollars, money, shares } from './capTableModel.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const SOURCE_LABEL = { connector_mercury: 'Mercury', connector_carta: 'Carta', signed: 'Signed', document: 'Document', typed: 'Typed' };
export const sourceLabel = (s) => SOURCE_LABEL[s] || NOT_RECORDED;

export const TYPE_OPTIONS = [{ value: '', label: 'Any type' }, { value: 'safe', label: 'SAFE' }, { value: 'note', label: 'Convertible note' }];
export const BASIS_OPTIONS = [
  { value: '', label: 'Any basis' }, { value: 'post_money', label: 'Post-money' },
  { value: 'pre_money', label: 'Pre-money' }, { value: 'unknown', label: 'Basis not recorded' },
];
export const STATUS_OPTIONS = [{ value: 'outstanding', label: 'Outstanding' }, { value: 'converted', label: 'Converted' }, { value: '', label: 'Any status' }];
export const SORT_OPTIONS = [
  { value: 'largest', label: 'Largest first' }, { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' }, { value: 'holder', label: 'Holder A–Z' },
];
export const EMPTY_FILTERS = { q: '', type: '', basis: '', status: 'outstanding', sort: 'largest' };

export const NOTES_ONLY = 'Notes only';
export const CANNOT_CONVERT_BAR = 'Cannot convert';
export const CANNOT_CONVERT_LINE = 'Cannot convert: no cap and no discount recorded. Record either in the instrument.';
export const OVER_100_TAIL = 'They cannot all be honoured. Check the terms.';

export const instrumentHref = (uid, search = '') => `/raise/cap-table/instrument/${encodeURIComponent(uid)}${search}`;

/** "15%" from basis points; missing is "Not recorded", never 0%. */
const bpsWord = (bps) => (num(bps) == null ? NOT_RECORDED : `${Math.round(bps) / 100}%`);

/** A price per share, to the cent, or to four places under ten cents. */
export function price(v) {
  const n = num(v);
  if (n == null) return NOT_RECORDED;
  return `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

function basisOf(terms) {
  if (terms?.basis === 'post_money') return { word: 'Post-money', check: false, key: 'post_money' };
  if (terms?.basis === 'pre_money') return { word: 'Pre-money', check: true, key: 'pre_money' };
  return { word: NOT_RECORDED, check: false, key: 'unknown' };
}

/** The record's instruments that a recorded conversion has converted, by uid. */
function convertedUids(record) {
  return new Set((record?.issuances?.rows || [])
    .filter((r) => r.kind === 'conversion' && r.status === 'recorded' && r.related_uid)
    .map((r) => r.related_uid));
}

/** CT3: each SAFE and note on record, in the record's own units and words. */
export function recordInstruments(record) {
  const code = record?.currency?.code || 'USD';
  const converted = convertedUids(record);
  return (record?.instruments?.rows || []).map((r) => {
    const t = r.terms || {};
    const note = r.kind === 'note';
    const b = basisOf(t);
    const cur = r.currency || code;
    return {
      uid: r.uid,
      holder: String(r.holder?.name || '').trim() || NOT_RECORDED,
      kind: note ? 'note' : 'safe',
      type: note ? 'Convertible note' : 'SAFE',
      amountCents: num(r.amount_cents),
      amount: money(r.amount_cents, cur),
      cap: num(t.cap_cents) > 0 ? money(t.cap_cents, cur) : NOT_RECORDED,
      discount: bpsWord(t.discount_bps),
      basis: b.word,
      basisKey: b.key,
      check: b.check,
      mfn: t.mfn == null ? NOT_RECORDED : t.mfn ? 'Yes' : 'No',
      // A SAFE has no interest or maturity; for a note each missing part says so.
      interest: note ? `${bpsWord(t.interest_bps)} · ${t.maturity_on ? `matures ${day(t.maturity_on)}` : `maturity ${NOT_RECORDED.toLowerCase()}`}` : null,
      signed: day(r.issued_on),
      signedOn: r.issued_on || null,
      document: r.document_ref ? documentWord(r) : null,
      status: converted.has(r.uid) ? 'converted' : 'outstanding',
      statusWord: converted.has(r.uid) ? 'Converted' : 'Outstanding',
      source: sourceLabel(r.source),
      cannotConvert: !(num(t.cap_cents) > 0) && num(t.discount_bps) == null,
      raw: r,
    };
  });
}

const SORTS = {
  largest: (a, b) => (b.amountCents ?? -1) - (a.amountCents ?? -1),
  newest: (a, b) => String(b.signedOn || '').localeCompare(String(a.signedOn || '')),
  oldest: (a, b) => String(a.signedOn || '￿').localeCompare(String(b.signedOn || '￿')),
  holder: (a, b) => a.holder.localeCompare(b.holder),
};

/** The toolbar: Type, Basis and Status filters, a sort and a search by holder. */
export function filterInstruments(rows, f = EMPTY_FILTERS) {
  const q = String(f.q || '').trim().toLowerCase();
  return rows
    .filter((r) => (!f.type || r.kind === f.type)
      && (!f.basis || r.basisKey === f.basis)
      && (!f.status || r.status === f.status)
      && (!q || r.holder.toLowerCase().includes(q)))
    .sort(SORTS[f.sort] || SORTS.largest);
}

/** The red notice (CT3b) from part 3's check; null when the caps fit. */
export function over100(check) {
  if (!check || check.over_100 !== true) return null;
  return `These post-money caps promise ${num(check.pct) == null ? 'more than 100' : check.pct}% of the company. ${OVER_100_TAIL}`;
}

/** Today's fully diluted share count as the engine counts it: every line of its start. */
export function todayShares(today) {
  const founding = today?.today?.result?.founding;
  if (!Array.isArray(founding) || !founding.length) return null;
  const total = founding.reduce((s, h) => s + (num(h?.shares) ?? 0), 0);
  return total > 0 ? total : null;
}

const toNumber = (v) => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * "Convert at" as part 3's simulate body. A next-round price becomes a round
 * whose pre-money is that price times Today's share count, so the engine's
 * round price is the price typed; the amount raised sets the % after. A
 * scenario's first round goes as the scenario holds it.
 */
export function convertBody(mode, form, { today = null, scenario = null } = {}) {
  if (mode === 'scenario') {
    const round = scenario?.inputs?.rounds?.[0];
    if (!round) return { body: null, sentence: 'That scenario plans no round, so nothing converts in it.' };
    return { body: { rounds: [round] }, sentence: null, label: String(scenario.name || 'the scenario') };
  }
  const p = toNumber(form?.price);
  const raise = toNumber(form?.raise);
  const missing = [p == null && 'a price per share', raise == null && 'the amount raised'].filter(Boolean);
  if (missing.length) return { body: null, sentence: `It still needs ${missing.join(' and ')}.` };
  if (!(p > 0)) return { body: null, sentence: 'The price per share is a number above zero.' };
  if (!(raise > 0)) return { body: null, sentence: 'The amount raised is a number above zero.' };
  const total = todayShares(today);
  if (total == null) return { body: null, sentence: 'Today’s share count could not be read, so no round can be priced from it.' };
  return { body: { rounds: [{ name: 'Next round', pre_money: p * total, investment: raise }] }, sentence: null, label: price(p) };
}

/** Which price won, in a sentence (CT3's sub-line under the conversion price). */
export function bindingLine(c) {
  if (!c) return NOT_RECORDED;
  const cap = num(c.cap_price);
  const disc = num(c.discount_price);
  const round = num(c.round_price);
  if (c.binding === 'cap' && cap != null) {
    if (disc != null) return `Cap price ${price(cap)} beats the discount price ${price(disc)}: cap wins`;
    if (round != null && cap > round) return `Cap price ${price(cap)} is above the round price ${price(round)}, and still applies: no discount is recorded`;
    return `Cap price ${price(cap)} beats the round price ${price(round)}: cap wins`;
  }
  if (c.binding === 'discount' && disc != null) {
    return cap != null ? `Discount price ${price(disc)} beats the cap price ${price(cap)}: discount wins` : `Discount price ${price(disc)} beats the round price ${price(round)}: discount wins`;
  }
  return `The round price ${price(round)} applies`;
}

/** Pairs each conversion with its instrument by holder name, in order, as the engine names them. */
function conversionsByInstrument(instruments, conversions) {
  const queue = new Map();
  for (const c of conversions || []) {
    const k = String(c?.name || '').trim();
    if (!queue.has(k)) queue.set(k, []);
    queue.get(k).push(c);
  }
  return new Map(instruments.map((i) => [i.uid, queue.get(i.holder)?.shift() || null]));
}

/**
 * CT3's modelled half: the table, the chart and the notice, from a round run
 * from Today. An instrument the engine did not convert reads its reason.
 */
export function convertView(sim, instruments, label) {
  const round = sim?.result?.rounds?.[0];
  if (!round) return null;
  const outstanding = instruments.filter((i) => i.status === 'outstanding');
  const paired = conversionsByInstrument(outstanding, round.conversions);
  const skipped = new Map((sim.not_modelled || []).map((n) => [n.uid, n]));
  const rows = outstanding.map((i) => {
    const c = paired.get(i.uid);
    const why = skipped.get(i.uid);
    return {
      uid: i.uid, holder: i.holder, amount: i.amount,
      converted: !!c,
      price: c ? price(c.price_per_share) : null,
      binding: c ? bindingLine(c) : null,
      shares: c ? num(c.shares) : null,
      sharesWord: c ? shares(c.shares) : null,
      pctAfter: c ? `${Number(c.pct_after_round).toFixed(2)}%` : null,
      cannotConvert: !c && (why?.reason === 'no_cap_or_discount' || i.cannotConvert),
      reason: c ? null : why?.sentence || (i.cannotConvert ? CANNOT_CONVERT_LINE : 'It did not convert in this round.'),
    };
  });
  const most = rows.filter((r) => r.converted).sort((a, b) => b.shares - a.shares)[0] || null;
  const max = most ? most.shares : 0;
  return {
    title: `As converted at ${label}`,
    roundPrice: price(round.price_per_share),
    rows,
    bars: rows.map((r) => ({ uid: r.uid, label: `${r.holder} · ${r.amount}`, value: r.converted ? r.sharesWord : CANNOT_CONVERT_BAR, width: r.converted && max ? `${((r.shares / max) * 100).toFixed(1)}%` : '0', hairline: !r.converted, tip: r.converted ? null : r.reason })),
    lead: most ? `${most.holder} converts into the most shares at ${most.price}.` : 'Nothing converts in this round.',
    summary: rows.filter((r) => r.converted).map((r) => `${r.holder} ${r.sharesWord}`).join(', '),
    cannotConvert: rows.some((r) => r.cannotConvert) ? CANNOT_CONVERT_LINE : null,
    notice: over100(round.post_money_check) || over100(sim.result.post_money_check),
    warnings: Array.isArray(sim.result.warnings) ? sim.result.warnings : [],
  };
}

/** CT4: one instrument's terms with sources, how it converts, MFN and the exit before conversion. */
export function instrumentView(inst, { today = null, sim = null } = {}) {
  if (!inst) return null;
  const r = inst.raw;
  const t = r.terms || {};
  const doc = inst.document;
  const sub = `${inst.source}${doc ? ` · ${doc}` : ''}`;
  const facts = [
    { k: 'Amount', v: inst.amount, sub },
    { k: 'Valuation cap', v: inst.cap === NOT_RECORDED ? NOT_RECORDED : `${inst.cap}${inst.basisKey === 'unknown' ? '' : ` ${inst.basis.toLowerCase()}`}`, sub },
    { k: 'Discount', v: inst.discount, sub },
    { k: 'Basis', v: inst.basis, sub, check: inst.check ? BASIS_CHECK : null },
    { k: 'MFN', v: inst.mfn, sub },
    { k: 'Signed', v: inst.signed, sub },
  ];
  if (inst.kind === 'note') facts.push({ k: 'Interest · maturity', v: inst.interest, sub });

  const round = sim?.result?.rounds?.[0] || null;
  const c = round ? conversionsByInstrument([inst], round.conversions).get(inst.uid) : null;
  let steps = null;
  if (c) {
    const lines = [];
    const cap = num(t.cap_cents) > 0 ? t.cap_cents / 100 : null;
    if (num(c.cap_price) != null && cap != null) lines.push(`Cap price = ${dollars(cap)} ÷ ${shares(Math.round(cap / c.cap_price))} shares = ${price(c.cap_price)}`);
    if (num(c.discount_price) != null) lines.push(`Discount price = ${price(c.round_price)} × (1 − ${inst.discount}) = ${price(c.discount_price)}`);
    const won = c.binding === 'cap' ? 'cap' : c.binding === 'discount' ? 'discount' : 'round price';
    lines.push(`${c.binding === 'none' ? 'No cap or discount applies' : 'Lower price wins'}: ${won} → ${shares(c.shares)} shares → ${Number(c.pct_after_round).toFixed(2)}% after the round`);
    const interest = inst.kind === 'note' && num(c.accrued_interest) > 0
      ? `Accrued interest converts too: ${dollars(c.amount)} + ${dollars(c.accrued_interest)} interest = ${dollars(c.converting_amount)} converts.`
      : null;
    steps = { lines, interest };
  }
  const skipped = (today?.today?.not_modelled || sim?.not_modelled || []).find((n) => n.uid === inst.uid) || null;

  let mfn;
  if (t.mfn === true) {
    const read = (today?.today?.result?.mfn || []).find((m) => String(m.name || '').trim() === inst.holder);
    mfn = {
      note: 'MFN: yes. If a later SAFE has better terms, this holder may take them.',
      later: read ? read.later.map((l) => ({
        line: `${l.name} · ${l.cap == null ? 'cap not recorded' : `cap ${dollars(l.cap)}`}`,
        verdict: l.cap == null ? NOT_RECORDED : l.verdict === 'better_cap' ? 'Better cap' : 'No change',
      })) : null,
    };
  } else mfn = { note: t.mfn === false ? 'MFN: no.' : `MFN: ${NOT_RECORDED.toLowerCase()}.`, later: [] };

  const exit = inst.kind === 'note'
    ? 'An exit before conversion is not modelled for a convertible note.'
    : inst.cap !== NOT_RECORDED
      ? `Cash back ${inst.amount}, or common at the cap, whichever pays more.`
      : `Cash back ${inst.amount}, or common as converted, whichever pays more.`;

  return {
    title: `${inst.holder} · ${inst.type}`,
    source: inst.source,
    facts,
    steps,
    unconverted: c ? null : skipped?.sentence || (inst.status === 'converted' ? 'It has converted, on record.' : round ? 'It does not convert in this round.' : null),
    mfn,
    exit,
    document: r.document_ref || null,
  };
}

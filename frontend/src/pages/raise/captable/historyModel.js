/**
 * D1025 (#2862, part 10 of #2432) — History (CT10), the proposal drawers
 * (CT11a–c) and the three dialogs (CT12a–c), pure: every line is derived from
 * a read or a form here, so the tests read them without a browser.
 *
 * WHAT IS READ:
 *   - `GET /api/captable/record/:projectId/history?section=record` (D1017,
 *     D1025's filters) → the timeline: recorded, void and dismissed rows,
 *     newest by the date issued, each with who recorded it ("an admin" for an
 *     admin), its document or "No document", and its source;
 *   - `…/history?section=changes` → "Changes to scenarios and access";
 *   - `GET /api/captable/record/:projectId` → the proposals, the classes, the
 *     register holders, the currency;
 *   - `GET /api/captable/record/:projectId/closes/:closeUid` (D1021) → a close;
 *   - the Cap table module read's `parts.mercury` (D840) → a SAFE request.
 *
 * WHAT IS WRITTEN, ONLY ON A PERSON'S PRESS: D1017's record, propose, accept,
 * dismiss and void routes; D840's Mercury Accept (with the SAFE's discount,
 * D1025); D1021's document read, which drafts non-money terms only. Eadwyn never
 * fills an amount, cap, discount, price or share count (#2431).
 *
 * A missing value is "Not recorded" or empty, never 0.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { day, money, shares } from './capTableModel';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const HISTORY_PAGE = 25;
export const CHANGES_PAGE = 10;

/** The kinds a person records (CT12a's chips), in the canvas's order and words. */
export const RECORD_TYPES = [
  { kind: 'founding', label: 'Founding shares' },
  { kind: 'priced', label: 'Priced round shares' },
  { kind: 'safe', label: 'SAFE' },
  { kind: 'note', label: 'Convertible note' },
  { kind: 'grant', label: 'Option grant' },
  { kind: 'exercise', label: 'Exercise' },
  { kind: 'transfer', label: 'Transfer' },
];
export const KIND_LABEL = {
  ...Object.fromEntries(RECORD_TYPES.map((t) => [t.kind, t.label])),
  conversion: 'Conversion', cancellation: 'Cancellation', correction: 'Correction',
};
export const SOURCE_LABEL = { typed: 'Typed', document: 'Document', signed: 'Signed', connector_mercury: 'Mercury', connector_carta: 'Carta' };
const STATUS_WORD = { recorded: 'recorded', void: 'void', dismissed: 'dismissed', proposed: 'proposed' };

/** The History toolbar's lists (CT10): Type, Source and Has document; "" is any. */
export const TYPE_OPTIONS = [{ value: '', label: 'Any type' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))];
export const SOURCE_OPTIONS = [{ value: '', label: 'Any source' }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))];
export const DOC_OPTIONS = [{ value: '', label: 'With or without a document' }, { value: '1', label: 'Has a document' }, { value: '0', label: 'No document' }];
export const EMPTY_FILTERS = { q: '', kind: '', source: '', has_document: '', from: '', to: '' };

/** The filters the read takes: blanks dropped, a date range that runs backwards refused here first. */
export function filterQuery(f = EMPTY_FILTERS) {
  const out = {};
  for (const k of Object.keys(EMPTY_FILTERS)) {
    const v = String(f[k] ?? '').trim();
    if (v) out[k] = v;
  }
  if (out.from && out.to && out.from > out.to) return { error: 'The date range ends before it starts.', query: null };
  return { error: null, query: out };
}

/** "1–25 of 40", "Nothing yet" for an empty first page. */
export function pageLine(page, size, total, count) {
  const t = num(total) ?? 0;
  if (!t) return 'Nothing yet';
  if (!count) return `Nothing on this page · ${t.toLocaleString('en-US')} in all`;
  const from = (page - 1) * size + 1;
  return `${from.toLocaleString('en-US')}–${(from + count - 1).toLocaleString('en-US')} of ${t.toLocaleString('en-US')}`;
}

const classMap = (record) => new Map((record?.classes?.rows || []).map((c) => [c.uid, c]));
const holderName = (r) => String(r?.holder?.name || '').trim() || 'An unnamed holder';

/** A price per share in micros, to six places when it needs them ($0.0001). */
export function price(micros, code = 'USD') {
  const n = num(micros);
  if (n == null) return NOT_RECORDED;
  const v = n / 1_000_000;
  try {
    return v.toLocaleString('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 6 });
  } catch {
    return `${v} ${code}`;
  }
}

const basisWord = (b) => (b === 'post_money' ? 'post-money' : b === 'pre_money' ? 'pre-money' : null);

/** What an issuance carries, in words: its money or its shares, never a figure it does not hold. */
export function figures(row, record) {
  const code = row.currency || record?.currency?.code || 'USD';
  if (row.kind === 'safe' || row.kind === 'note') {
    const bits = [num(row.amount_cents) != null ? money(row.amount_cents, code) : 'amount not recorded'];
    if (num(row.terms?.cap_cents) != null) bits.push(`${basisWord(row.terms.basis) ? `${basisWord(row.terms.basis)} ` : ''}cap ${money(row.terms.cap_cents, code)}`);
    if (num(row.terms?.discount_bps) != null) bits.push(`${(row.terms.discount_bps / 100).toLocaleString('en-US')}% discount`);
    return bits.join(' · ');
  }
  const cls = classMap(record).get(row.class_uid);
  const unit = cls?.kind === 'option_pool' || row.kind === 'grant' ? 'options' : cls?.name || 'shares';
  if (num(row.shares) == null) return 'shares not recorded';
  const n = `${row.shares < 0 ? '−' : row.kind === 'correction' ? '+' : ''}${shares(Math.abs(row.shares))} ${unit}`;
  return num(row.price_per_share_micros) != null ? `${n} at ${price(row.price_per_share_micros, code)}` : n;
}

/** Who recorded it: a name, "an admin", or nobody named. */
export function byWho(who) {
  if (!who) return null;
  if (who.admin) return 'an admin';
  return String(who.name || '').trim() || null;
}

/** The document behind a row, by the kind of reference it is; none is "No document". */
export function documentWord(row) {
  if (row.safe_issuance_uid) return 'SAFE sent through StudioOS';
  const ref = String(row.document_ref || '');
  if (ref.startsWith('data_room_files:')) return 'Data room file';
  if (ref.startsWith('legal_documents:')) return 'Signed legal document';
  return null;
}

/** One timeline row (CT10): its date, its line, who recorded it, its document and source, and what voided or corrected it. */
export function timelineRow(entry, record) {
  const r = entry.issuance;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(entry.at || r.issued_on || ''));
  const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const kind = KIND_LABEL[r.kind] || r.kind;
  let text;
  if (r.kind === 'correction') {
    text = r.correction_reason
      ? `Correction: ‘${r.correction_reason}’ on ${holderName(r)}’s record · ${figures(r, record)}`
      : `Correction on ${holderName(r)}’s record · ${figures(r, record)}`;
  } else {
    text = `${holderName(r)} · ${kind} ${STATUS_WORD[r.status] || r.status} · ${figures(r, record)}`;
  }
  const who = r.status === 'void' ? byWho(r.voided_by_who) : r.status === 'dismissed' ? byWho(r.dismissed_by_who) : byWho(r.recorded_by_who);
  const verb = r.status === 'void' ? 'Voided by' : r.status === 'dismissed' ? 'Dismissed by' : 'Recorded by';
  return {
    uid: r.uid,
    date: m ? { m: M[Number(m[2]) - 1], d: m[3], y: m[1] } : null,
    text,
    by: who ? `${verb} ${who}` : null,
    document: documentWord(r),
    source: SOURCE_LABEL[r.source] || NOT_RECORDED,
    struck: r.status === 'void' || r.status === 'dismissed',
    reason: r.status === 'void' ? r.void_reason : r.status === 'dismissed' ? r.dismiss_reason : null,
    // An admin's reason, on any row an admin wrote, is the founder's to read.
    adminReason: r.kind !== 'correction' && r.correction_reason ? r.correction_reason : null,
    row: r,
  };
}

const LEVEL = { none: 'None', own_position: 'Own position', summary: 'Summary', investor: 'Investor', full: 'Full' };
const CHANGE = {
  captable_scenario_updated: () => 'changed a scenario',
  captable_scenario_deleted: () => 'deleted a scenario',
  captable_variant_created: () => 'made a scenario',
  captable_access_granted: (d) => (LEVEL[d?.level] ? `set someone to ${LEVEL[d.level]} level` : 'changed who sees the cap table'),
  captable_access_revoked: () => 'removed someone’s access',
  captable_link_created: (d) => (LEVEL[d?.level] ? `shared a ${LEVEL[d.level]} link` : 'shared a link'),
  captable_link_revoked: () => 'revoked a share link',
};

/** One row of "Changes to scenarios and access": who did what, and when. */
export function changeRow(entry) {
  const a = entry.activity || {};
  const who = String(a.user_name || '').trim() || 'A member';
  const what = (CHANGE[a.action] || (() => 'changed the cap table'))(a.details || {});
  return { text: `${who} ${what}`, when: day(entry.at) };
}

// ─────────────────────────────────────────────────────────── the dialogs (CT12)

export const RECORD_FOOT = 'This is recorded, not modelled. Co-founders see it at once.';
export const PROPOSE_FOOT = 'This is a proposal. It changes nothing until the owner records it.';
export const ADMIN_FOOT = 'As a studio admin. The founder sees your reason and the change.';

/** Which classes a kind may name: a grant draws on a pool; shares go into common or preferred. */
export function classesFor(kind, record) {
  const rows = record?.classes?.rows || [];
  if (kind === 'grant') return rows.filter((c) => c.kind === 'option_pool');
  return rows.filter((c) => c.kind !== 'option_pool');
}
export const poolsOf = (record) => (record?.classes?.rows || []).filter((c) => c.kind === 'option_pool');

/** The register's holders, for the holder list; a new name is typed instead. */
export function registerHolders(record) {
  const seen = new Map();
  for (const h of record?.by_holder?.rows || []) if (h.holder_id != null && !seen.has(h.holder_id)) seen.set(h.holder_id, h.name);
  return [...seen].map(([id, name]) => ({ id, name: String(name || '').trim() || `Holder ${id}` }));
}

/** The currency's minor digits (USD 2, JPY 0), as the Worker counts them. */
export function minorDigits(code) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}

const decimal = (v) => {
  const s = String(v ?? '').replace(/[$,\s€£¥]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
};

/** A typed amount ("150,000") in the currency's smallest unit; blank is null, nonsense NaN. */
export function toMinor(v, code = 'USD') {
  const n = decimal(v);
  if (n == null || Number.isNaN(n)) return n;
  return Math.round(n * 10 ** minorDigits(code));
}
/** A typed price ("0.42") in micros. */
export function toMicros(v) {
  const n = decimal(v);
  if (n == null || Number.isNaN(n)) return n;
  return Math.round(n * 1_000_000);
}
/** A typed percent ("20") in basis points. */
export function toBps(v) {
  const n = decimal(v);
  if (n == null || Number.isNaN(n)) return n;
  return Math.round(n * 100);
}
/** A typed whole count ("40,000"). */
export function toCount(v) {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

/** The fields each kind asks for, in the order the dialog draws them. */
export const FIELDS = {
  founding: ['holder', 'class', 'shares', 'date', 'document'],
  priced: ['holder', 'class', 'shares', 'price', 'date', 'document'],
  safe: ['holder', 'amount', 'cap', 'basis', 'discount', 'date', 'document'],
  note: ['holder', 'amount', 'cap', 'discount', 'interest', 'maturity', 'date', 'document'],
  grant: ['holder', 'pool', 'shares', 'price', 'date', 'document'],
  exercise: ['holder', 'pool', 'class', 'shares', 'price', 'date', 'document'],
  transfer: ['from', 'holder', 'class', 'shares', 'date', 'document'],
};
export const PRICE_LABEL = { grant: 'Strike price', exercise: 'Exercise price', priced: 'Price per share' };

/** What a kind cannot be recorded without, beyond what the Worker also checks. */
const NEEDS = {
  founding: ['holder', 'class', 'shares', 'date'],
  priced: ['holder', 'class', 'shares', 'price', 'date'],
  safe: ['holder', 'amount'],
  note: ['holder', 'amount'],
  grant: ['holder', 'pool', 'shares', 'date'],
  exercise: ['holder', 'pool', 'class', 'shares', 'date'],
  transfer: ['from', 'holder', 'class', 'shares', 'date'],
};
const FIELD_WORD = {
  holder: 'a holder', from: 'who it is from', class: 'a class', pool: 'the pool', shares: 'a share count', price: 'a price',
  amount: 'an amount', date: 'a date', reason: 'a reason',
};

/**
 * The body a form posts (D1017's fields), or what it still lacks. Nothing is
 * guessed: a blank field is left out, never 0, and the source is the
 * document's when one is chosen.
 */
export function issuanceBody(form, { currency = 'USD', admin = false } = {}) {
  const kind = form.kind;
  const errors = [];
  const missing = [];
  const body = { kind };
  const want = new Set(FIELDS[kind] || []);
  const holder = (h, idKey, nameKey) => {
    if (h?.id != null) body[idKey] = h.id;
    else if (String(h?.name || '').trim()) body[nameKey] = String(h.name).trim();
    else return false;
    return true;
  };
  if (want.has('holder') && !holder(form.holder, 'holder_id', 'holder_name')) missing.push('holder');
  if (want.has('from') && !holder(form.from, 'from_holder_id', 'from_holder_name')) missing.push('from');
  if (want.has('class')) { if (form.class_uid) body.class_uid = form.class_uid; else missing.push('class'); }
  if (want.has('pool')) {
    if (!form.pool_uid) missing.push('pool');
    else if (kind === 'grant') body.class_uid = form.pool_uid;
    else body.from_class_uid = form.pool_uid;
  }
  const put = (key, field, value, word) => {
    if (value == null) { if ((NEEDS[kind] || []).includes(field)) missing.push(field); return; }
    if (Number.isNaN(value)) { errors.push(`${word} is not a number.`); return; }
    body[key] = value;
  };
  if (want.has('shares')) {
    const n = toCount(form.shares);
    if (n === 0) errors.push('The share count is above 0.');
    else put('shares', 'shares', n, 'The share count');
  }
  if (want.has('price')) put('price_per_share_micros', 'price', toMicros(form.price), 'The price');
  if (want.has('amount')) put('amount_cents', 'amount', toMinor(form.amount, currency), 'The amount');
  if (want.has('cap')) {
    const c = toMinor(form.cap, currency);
    if (c === 0) errors.push('A valuation cap is above 0.'); else put('cap_cents', 'cap', c, 'The cap');
  }
  if (want.has('discount')) {
    const d = toBps(form.discount);
    if (d != null && !Number.isNaN(d) && d > 9999) errors.push('A discount is below 100%.'); else put('discount_bps', 'discount', d, 'The discount');
  }
  if (want.has('interest')) put('interest_bps', 'interest', toBps(form.interest), 'The interest rate');
  if (want.has('basis') && form.basis) body.basis = form.basis;
  if (want.has('maturity') && form.maturity) body.maturity_on = form.maturity;
  if (want.has('date')) { if (form.date) body.issued_on = form.date; else if ((NEEDS[kind] || []).includes('date')) missing.push('date'); }
  if (form.document_ref) { body.document_ref = form.document_ref; body.source = 'document'; } else body.source = 'typed';
  if (admin) { if (String(form.reason || '').trim()) body.reason = String(form.reason).trim(); else missing.push('reason'); }
  const lacks = missing.length ? `It still needs ${missing.map((m) => FIELD_WORD[m] || m).join(', ')}.` : null;
  return { body, errors, missing, sentence: errors[0] || lacks };
}

/** CT12b's line: when, who, and what, as the record holds it. */
export function voidLine(row, record) {
  return `${day(row.issued_on)} · ${holderName(row)} · ${figures(row, record)}. It stays in History, struck through, with your reason.`;
}

/**
 * CT12c, the admin's correction: the record's row, the share count it should
 * have, and the reason the founder reads. It is recorded as a correction that
 * moves the difference (D1017), never an edit of the row.
 */
export function correctionBody(row, nextShares, reason, today) {
  const n = toCount(nextShares);
  if (n == null || Number.isNaN(n)) return { body: null, sentence: 'Enter the share count this record should have.' };
  if (num(row?.shares) == null) return { body: null, sentence: 'This record has no share count to correct.' };
  const delta = n - row.shares;
  if (!delta) return { body: null, sentence: 'That is the share count already on record.' };
  if (!String(reason || '').trim()) return { body: null, sentence: 'Write the reason the founder will see.' };
  const body = { kind: 'correction', related_uid: row.uid, shares: delta, issued_on: today, source: 'typed', reason: String(reason).trim() };
  if (row.holder?.holder_id != null) body.holder_id = row.holder.holder_id; else body.holder_name = row.holder?.name;
  if (row.class_uid) body.class_uid = row.class_uid;
  return { body, sentence: null };
}
/** A recorded share row an admin may correct; a correction is corrected by another, never edited. */
export const correctable = (row) => row?.status === 'recorded' && num(row?.shares) != null && !['safe', 'note', 'correction'].includes(row.kind);
export const voidable = (row) => row?.status === 'recorded';

/** Today in the venture's records (YYYY-MM-DD), from a Date; the tests pass their own. */
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────── the proposal drawers (CT11)

/** The address of a proposal's drawer: a record proposal by its uid, a Mercury SAFE request by its id. */
export const proposalHref = (id, search = '') => `/raise/cap-table/proposal/${encodeURIComponent(id)}${search}`;
export const MERCURY_ID = /^mercury-([1-9]\d*)$/;

export const CONFIRM_TAIL = 'Co-founders see it at once; investors as their access allows.';

/** CT11a, a Mercury SAFE request: its facts, as Mercury sends them. */
export function mercuryView(p, code = 'USD') {
  const name = String(p?.investor_name || '').trim() || 'Investor not named';
  const amount = num(p?.amount_cents) != null ? money(p.amount_cents, code) : NOT_RECORDED;
  return {
    title: `SAFE request · ${name}`,
    facts: [
      ['Investor', name], ['Amount', amount],
      ['Post-money cap', num(p?.cap_cents) != null ? money(p.cap_cents, code) : NOT_RECORDED],
      ['Request status', String(p?.status || '').trim() || NOT_RECORDED],
      ['Date', day(p?.date)], ['From', 'Your Mercury SAFE requests'],
    ],
    confirm: `Record ${name}’s SAFE for ${amount}? ${CONFIRM_TAIL}`,
  };
}

/**
 * CT11b, a close: each investor's line, signed or waiting, and how many Accept
 * records now. The close's read (D1021) says who and whether signed; the
 * proposal on the record carries the class, shares and price a priced close
 * was given.
 */
export function closeView(close, record) {
  const code = record?.currency?.code || 'USD';
  const cls = classMap(record);
  const props = new Map((record?.proposals?.rows || []).map((p) => [p.uid, p]));
  const rows = (close?.rows || []).map((i) => {
    const p = i.proposal?.uid ? props.get(i.proposal.uid) : null;
    const amount = num(i.amount_cents) != null ? money(i.amount_cents, i.currency || code) : NOT_RECORDED;
    const c = p?.class_uid ? cls.get(p.class_uid)?.name : null;
    const sub = num(p?.shares) != null
      ? `${c ? `${c} · ` : ''}${shares(p.shares)} shares${num(p.price_per_share_micros) != null ? ` at ${price(p.price_per_share_micros, code)}` : ''}`
      : KIND_LABEL[i.instrument] || 'Instrument not recorded';
    return {
      key: i.prospect_uid, holder: String(i.holder_name || '').trim() || NOT_RECORDED, amount, sub,
      signed: !!i.signature?.signed, label: i.signature?.label || 'Not signed yet',
      uid: i.proposal?.uid || null, status: i.proposal?.status || null, skipped: i.skipped || null,
    };
  });
  const ready = rows.filter((r) => r.uid && r.status === 'proposed' && r.signed);
  const waiting = rows.filter((r) => r.uid && r.status === 'proposed' && !r.signed);
  return {
    title: `${close?.close?.name || 'A close'}${close?.close?.round_name ? ` of ${close.close.round_name}` : ''}`,
    closed: day(close?.close?.closed_date),
    rows, ready, waiting,
    foot: waiting.length
      ? `${waiting.map((w) => w.holder).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not signed yet, so ${waiting.length === 1 ? 'its row waits' : 'their rows wait'}. This is the same proposal as the closing room’s: accepted once, here or there.`
      : 'This is the same proposal as the closing room’s: accepted once, here or there.',
    action: ready.length === 1 ? 'Record 1 issuance' : `Record ${ready.length} issuances`,
    confirm: `Accepting here also closes it in the closing room. ${CONFIRM_TAIL}`,
  };
}

/** A proposal from a person or an import: its line and the one-line confirmation. */
export function proposalView(row, record) {
  const who = holderName(row);
  return {
    title: `${KIND_LABEL[row.kind] || row.kind} · ${who}`,
    line: `${who} · ${KIND_LABEL[row.kind] || row.kind} · ${figures(row, record)}`,
    confirm: `Record ${who}’s ${(KIND_LABEL[row.kind] || row.kind).toLowerCase()}${row.kind === 'safe' || row.kind === 'note' ? ` for ${num(row.amount_cents) != null ? money(row.amount_cents, row.currency || record?.currency?.code || 'USD') : 'an amount not recorded'}` : ''}? ${CONFIRM_TAIL}`,
  };
}

// ─────────────────────────────────────────────────────────── Eadwyn's draft (CT11c)

export const NOT_FOUND = 'Not found in the document';
const TERM_LABEL = { holder: 'Holder', instrument_type: 'Instrument type', basis: 'Basis', mfn: 'MFN', executed_on: 'Date signed' };
const INSTRUMENT = { safe: 'SAFE', note: 'Convertible note', priced: 'Priced round shares', grant: 'Option grant' };
const AMOUNT_LABEL = { amount: 'Amount', valuation_cap: 'Valuation cap', discount: 'Discount', price_per_share: 'Price per share', shares: 'Shares' };

const byKey = (list) => new Map((Array.isArray(list) ? list : []).map((x) => [x.key, x]));

/**
 * The draft as the drawer draws it (D1021's shape): each term with its page,
 * and each money field as the page it sits on, never a figure. A field the
 * read did not find says so.
 */
export function draftView(draft) {
  const t = byKey(draft?.terms);
  const word = (k, v) => {
    if (k === 'instrument_type') return INSTRUMENT[v] || null;
    if (k === 'basis') return basisWord(v) ? `${basisWord(v)[0].toUpperCase()}${basisWord(v).slice(1)}` : null;
    if (k === 'mfn') return v === true ? 'Yes' : v === false ? 'No' : null;
    if (k === 'executed_on') return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? day(v) : null;
    return String(v || '').trim() || null;
  };
  const terms = Object.keys(TERM_LABEL).map((k) => {
    const e = t.get(k);
    const w = e?.found && e.value != null ? word(k, e.value) : null;
    return { key: k, label: TERM_LABEL[k], value: w || NOT_FOUND, page: w && e.page ? `page ${e.page}` : null };
  });
  const a = byKey(draft?.amounts);
  const amounts = Object.keys(AMOUNT_LABEL).map((k) => {
    const e = a.get(k);
    return { key: k, label: AMOUNT_LABEL[k], hint: e?.found && e.page ? `Enter from page ${e.page}` : NOT_FOUND };
  });
  const kindValue = t.get('instrument_type')?.found ? t.get('instrument_type').value : null;
  const kind = ['safe', 'note', 'priced', 'grant'].includes(kindValue) ? kindValue : null;
  const holderValue = t.get('holder')?.found ? String(t.get('holder').value || '').trim() : '';
  const holder = holderValue || null;
  return { terms, amounts, kind, holder, title: `${kind ? INSTRUMENT[kind] : 'A document'} · ${holder || 'holder not found'}`, document: draft?.document_name || null };
}

/**
 * The body a person's Accept posts from Eadwyn's draft: the terms it found and
 * the amounts the person typed, with the document as its source. A SAFE or a
 * note opens once its amount and cap are entered; shares need their count.
 */
export function draftBody(draft, typed, { currency = 'USD' } = {}) {
  const v = draftView(draft);
  if (!v.kind) return { body: null, sentence: 'Eadwyn did not find the instrument type. Record it yourself instead.' };
  if (!v.holder) return { body: null, sentence: 'Eadwyn did not find the holder. Record it yourself instead.' };
  const body = { kind: v.kind, holder_name: v.holder, source: 'document', document_ref: draft.document_ref };
  const t = byKey(draft.terms);
  const found = (k) => (t.get(k)?.found ? t.get(k).value : null);
  if (found('basis') && v.kind !== 'priced' && v.kind !== 'grant') body.basis = found('basis');
  if (typeof found('mfn') === 'boolean' && v.kind !== 'priced' && v.kind !== 'grant') body.mfn = found('mfn');
  if (found('executed_on')) body.issued_on = found('executed_on');
  if (v.kind === 'safe' || v.kind === 'note') {
    const amount = toMinor(typed.amount, currency), cap = toMinor(typed.valuation_cap, currency), disc = toBps(typed.discount);
    if (amount == null || Number.isNaN(amount) || !amount) return { body: null, sentence: 'Enter the amount from the document.' };
    if (cap == null || Number.isNaN(cap) || !cap) return { body: null, sentence: 'Enter the valuation cap from the document.' };
    body.amount_cents = amount; body.cap_cents = cap;
    if (disc != null && !Number.isNaN(disc)) body.discount_bps = disc;
  } else {
    const n = toCount(typed.shares), p = toMicros(typed.price_per_share);
    if (n == null || Number.isNaN(n) || !n) return { body: null, sentence: 'Enter the share count from the document.' };
    body.shares = n;
    if (p != null && !Number.isNaN(p)) body.price_per_share_micros = p;
  }
  return { body, sentence: null };
}

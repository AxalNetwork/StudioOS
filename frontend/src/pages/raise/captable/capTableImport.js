/**
 * D1026 (#2863) — From a spreadsheet (CT14): the template, the CSV parse, the
 * column map, the preview's checks against the record, and the rows the
 * import proposes. Pure, so the tests read it without a browser.
 *
 * IMPORTS LAND AS PROPOSALS, NEVER ON THE RECORD (D1020 §5). The rows go to
 * `POST /api/captable/record/:projectId/proposals/import` (origin `import`),
 * and each waits for the owner's Accept like any proposal (D1017 §5).
 *
 * THE PREVIEW'S THREE CHECKS:
 *   - red, left out: a row the record cannot take (no holder, shares or amount
 *     missing, a class not on the record, a date that cannot be read);
 *   - amber, proposed: a row that changes a holder's recorded shares in a class;
 *   - left out, not counted twice: a row that matches the record exactly.
 * Eadwyn fills none of it (#2431): every figure is the file's own.
 */

export const ROWS_MAX = 500;

export const FIELDS = [
  { id: 'holder', label: 'Holder', required: true },
  { id: 'type', label: 'Type' },
  { id: 'class', label: 'Class' },
  { id: 'shares', label: 'Shares' },
  { id: 'amount', label: 'Amount' },
  { id: 'price', label: 'Price per share' },
  { id: 'date', label: 'Date' },
];

const SYNONYMS = {
  holder: ['holder', 'name', 'shareholder', 'stakeholder', 'investor', 'holder name'],
  type: ['type', 'kind', 'instrument', 'security type', 'issuance type'],
  class: ['class', 'share class', 'security class', 'security'],
  shares: ['shares', 'quantity', 'number of shares', 'share count'],
  amount: ['amount', 'investment', 'principal', 'amount invested'],
  price: ['price', 'price per share', 'strike', 'strike price', 'issue price'],
  date: ['date', 'issued', 'issue date', 'issued on', 'date issued'],
};

/** The template's header and one example row, so the columns match. */
export const TEMPLATE_CSV = 'Holder,Type,Class,Shares,Amount,Price per share,Date\r\nExample Holder,Founding shares,Common,1000000,,,2025-01-03\r\n';

/** The canvas's issuance types, as a person writes them, to the record's kinds. */
const TYPE_WORDS = {
  'founding shares': 'founding', founding: 'founding', 'priced round shares': 'priced', priced: 'priced', 'priced round': 'priced',
  safe: 'safe', 'convertible note': 'note', note: 'note', 'option grant': 'grant', grant: 'grant', options: 'grant',
  exercise: 'exercise', transfer: 'transfer', cancellation: 'cancellation',
};
const KIND_WORDS = {
  founding: 'Founding shares', priced: 'Priced round shares', safe: 'SAFE', note: 'Convertible note', grant: 'Option grant',
  exercise: 'Exercise', transfer: 'Transfer', cancellation: 'Cancellation',
};
/** Kinds a spreadsheet row can propose: an exercise, a transfer or a cancellation needs more than one row says. */
const IMPORTABLE = new Set(['founding', 'priced', 'safe', 'note', 'grant']);
const MONEY = new Set(['safe', 'note']);

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const [headers, ...body] = nonEmpty;
  return { headers: headers.map((h) => String(h).trim()), rows: body };
}

/** Each field to the header that names it, by the words people use. */
export function guessMap(headers) {
  const map = {};
  const norm = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const f of FIELDS) {
    const i = headers.findIndex((h) => SYNONYMS[f.id].includes(norm(h)));
    map[f.id] = i >= 0 ? i : null;
  }
  return map;
}

/** "Holder ← Name": the column map's words. */
export const mapWords = (map, headers) => FIELDS.filter((f) => map[f.id] != null).map((f) => `${f.label} ← ${headers[map[f.id]]}`);

const M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** ISO, or "3 Jan 2025". Anything else is unread, never guessed. */
export function readDate(v) {
  const s = String(v ?? '').trim();
  let y; let m; let d;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (r) { [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])]; } else {
    r = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s);
    if (!r || !M[r[2].toLowerCase()]) return null;
    [y, m, d] = [Number(r[3]), M[r[2].toLowerCase()], Number(r[1])];
  }
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "4,400,000" → 4400000. A fraction or anything else is not a share count. */
export function readShares(v) {
  const s = String(v ?? '').trim().replace(/[,\s_]/g, '');
  if (!s) return { empty: true };
  if (!/^\d+$/.test(s)) return { bad: true };
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? { value: n } : { bad: true };
}

/** "$500,000.50" → 50000050 minor units. */
export function readMoney(v, scale = 100) {
  const s = String(v ?? '').trim().replace(/^[A-Za-z]{3}\s*/, '').replace(/[$€£,\s]/g, '');
  if (!s) return { empty: true };
  if (!/^\d+(\.\d+)?$/.test(s)) return { bad: true };
  const n = Math.round(Number(s) * scale);
  return Number.isSafeInteger(n) ? { value: n } : { bad: true };
}

const key = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The preview: each data row with its check. `record` is D1017's record read
 * (its classes and its holders by class); without it, nothing can be checked
 * and nothing is proposed.
 */
export function preview(parsed, map, record) {
  const classes = new Map((record?.classes?.rows || []).map((c) => [key(c.name), c]));
  const held = new Map();
  const byClassUid = new Map((record?.classes?.rows || []).map((c) => [c.uid, c]));
  for (const h of record?.by_holder?.rows || []) {
    for (const bc of h.by_class || []) held.set(`${key(h.name)}|${bc.class_uid}`, bc.shares);
  }
  const at = (row, f) => (map[f] == null ? '' : String(row[map[f]] ?? '').trim());
  return (parsed?.rows || []).map((row, i) => {
    const n = i + 1;
    const holder = at(row, 'holder');
    const className = at(row, 'class');
    const cls = className ? classes.get(key(className)) : null;
    const typed = at(row, 'type');
    let kind = typed ? TYPE_WORDS[key(typed)] : (cls?.kind === 'option_pool' ? 'grant' : cls ? 'founding' : null);
    const sh = readShares(at(row, 'shares'));
    const amount = readMoney(at(row, 'amount'));
    const price = readMoney(at(row, 'price'), 1_000_000);
    const rawDate = at(row, 'date');
    const date = rawDate ? readDate(rawDate) : null;
    const out = { row: n, holder: holder || null, className: className || null, type: kind ? KIND_WORDS[kind] : (typed || null), shares: sh.value ?? null, date, check: null, tone: 'plain', propose: false, body: null };
    const fail = (check) => ({ ...out, check, tone: 'red' });
    if (!holder) return fail('Holder missing');
    if (typed && !kind) return fail(`Type not read: ${typed}`);
    if (!kind) return fail(className ? `Class not on the record: ${className}` : 'Type missing');
    if (!IMPORTABLE.has(kind)) return fail(`${KIND_WORDS[kind]} needs more than one row says; record it on its own`);
    if (rawDate && !date) return fail('Date not read; use YYYY-MM-DD');
    if (amount.bad) return fail('Amount not read');
    if (price.bad) return fail('Price not read');
    if (MONEY.has(kind)) {
      if (amount.empty) return fail('Amount missing');
      if (!sh.empty) return fail('A SAFE or a note is money, never shares');
    } else {
      if (sh.empty) return fail('Shares missing');
      if (sh.bad) return fail('Shares are not a whole number');
      if (!className) return fail('Class missing');
      if (!cls) return fail(`Class not on the record: ${className}`);
      if ((kind === 'grant') !== (cls.kind === 'option_pool')) return fail(kind === 'grant' ? 'An option grant is made from an option pool' : 'Shares are issued in a common or preferred class');
      if (!date) return fail('Date missing');
      if (kind === 'priced' && price.empty) return fail('Price missing');
    }
    const body = {
      row: n, kind, holder_name: holder,
      ...(cls ? { class_uid: cls.uid } : {}),
      ...(sh.value != null ? { shares: sh.value } : {}),
      ...(amount.value != null ? { amount_cents: amount.value } : {}),
      ...(price.value != null ? { price_per_share_micros: price.value } : {}),
      ...(date ? { issued_on: date } : {}),
    };
    if (cls && sh.value != null) {
      const recorded = held.get(`${key(holder)}|${cls.uid}`);
      if (recorded === sh.value) return { ...out, check: 'Matches the record; left out so nothing counts twice', tone: 'green' };
      if (recorded != null) return { ...out, check: `Changes ${holder}’s recorded shares (${byClassUid.get(cls.uid)?.name || className}: ${recorded.toLocaleString('en-US')} on record)`, tone: 'amber', propose: true, body };
    }
    return { ...out, check: `New ${KIND_WORDS[kind].toLowerCase()}`, tone: 'plain', propose: true, body };
  });
}

/** The counts the filter chips and the button read. */
export function counts(rows) {
  return {
    all: rows.length,
    errors: rows.filter((r) => r.tone === 'red').length,
    changes: rows.filter((r) => r.tone === 'amber').length,
    propose: rows.filter((r) => r.propose).length,
  };
}

export const proposeLabel = (n) => `Propose ${n} ${n === 1 ? 'row' : 'rows'}`;

/** The import's body: the rows to propose and the file's SHA-256, so one file's rows are proposed once. */
export const importBody = (rows, fileRef) => ({ file_ref: fileRef, rows: rows.filter((r) => r.propose).map((r) => r.body) });

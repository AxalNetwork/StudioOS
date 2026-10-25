/**
 * D1022 (#2859, part 7 of #2432) — Overview's record blocks and the holder
 * drawer, pure: every figure is derived from a read here, so the tests read
 * them without a browser.
 *
 * WHAT IS READ:
 *   - `GET /api/captable/record/:projectId` (D1017) → Needs you, Who owns by
 *     holder and by class, the tiles, the fully diluted and outstanding bars,
 *     the outstanding instruments, the drawer's positions and issuances. Each
 *     of these is On record.
 *   - `GET /api/captable/scenarios/by-project/:id/compare` → the third bar,
 *     "After [round]", from the saved model's last round. Modelled.
 *   - `GET /api/captable/409a/:projectId` → the 409A chip and line.
 *   - `GET /api/integrations` → Carta's chip.
 *   - `GET /api/captable/access/:projectId/grants` (D1019) → who may record
 *     (`can_change` is the owner's) and the drawer's "What they can see".
 *   - `GET /api/captable/equity-plan?project_id=` (D1020) → a person's vesting.
 *   - `GET /api/cycles/build/modules/company-creation` → a person's 83(b).
 *
 * THE RULES. A missing value is "Not recorded", never 0 or 0%. A block the
 * record cannot compute says the Worker's sentence and draws no number. On
 * record and Modelled never share a figure without their tag.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { day, harbour, money, pct, shares } from './capTableModel';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const AS_OF_NONE = 'As of · nothing recorded';
export const UNREADABLE_LINE = 'The cap table could not be read. That is not the same as an empty cap table. Nothing can be saved until it reads.';
export const SAVE_BLOCKED = 'Nothing can be saved until it reads.';
export const COFOUNDER_LINE = 'You are a co-founder. Issuances you propose wait for the owner to accept.';
export const PLAN_LINE = 'Recording and scenarios are on the Raise + Grow plan.';
export const PLANS_PATH = '/pricing/products';
export const EXPLORER_TITLE = 'Cap tables open once your profile is set.';
export const EXPLORER_LINE = 'An Explorer has no profile yet, so there is no cap table to open.';
export const OTHER_TITLE = 'This cap table belongs to another company.';
export const OTHER_LINE = 'Switch company, or ask its founder for access.';
export const EMPTY_TITLE = 'Nothing is recorded yet.';
export const EMPTY_LINE = 'Start with the founding shares, import a spreadsheet, or connect Carta.';
export const MODEL_TITLE = 'Your earlier model is kept as a scenario, Cap table · model.';
export const MODEL_LINE = 'Its founders and SAFEs are not recorded yet.';
export const NO_ROUND = 'No round is planned. Plan one in Scenarios.';
export const FD_LEGEND = 'The legend shows fully diluted. Outstanding leaves out options and the unallocated pool.';
export const NEEDS_MAX = 4;

// ─────────────────────────────────────────────────────────── groups

/** Who owns groups holders as the canvas does; the pool's unallocated shares are their own group. */
export const GROUPS = [
  { id: 'founders', label: 'Founders' },
  { id: 'investors', label: 'Investors' },
  { id: 'people', label: 'Employees and advisors' },
  { id: 'other', label: 'Other holders' },
  { id: 'pool', label: 'Option pool · unallocated' },
];
const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));

const classMap = (record) => new Map((record?.classes?.rows || []).map((c) => [c.uid, c]));

/**
 * A holder's group: the register's kind when it names one; otherwise what
 * they hold (preferred is an investor's, options alone a person's). A holder
 * of common who is not a recorded founder is "Other holders", never guessed.
 */
export function groupOf(holder, classes) {
  const kind = String(holder?.kind || '').toLowerCase();
  if (kind === 'founder') return 'founders';
  if (kind === 'investor') return 'investors';
  if (kind === 'employee' || kind === 'advisor') return 'people';
  const kinds = new Set((holder?.by_class || []).map((b) => classes.get(b.class_uid)?.kind));
  if (kinds.has('preferred')) return 'investors';
  if (kinds.size && [...kinds].every((k) => k === 'option_pool')) return 'people';
  return 'other';
}

const SOURCE_WORD = { signed: 'Signed', document: 'Document', typed: 'Typed', connector_carta: 'Carta', connector_mercury: 'Mercury' };
export const sourceWord = (s) => SOURCE_WORD[s] || NOT_RECORDED;

/** The recorded issuances naming a holder, newest first. */
function issuancesOf(record, holderId, name) {
  const rows = record?.issuances?.rows || [];
  const key = String(name || '').trim().toLowerCase();
  return rows.filter((r) => (holderId != null ? r.holder?.holder_id === holderId
    : r.holder?.holder_id == null && String(r.holder?.name || '').trim().toLowerCase() === key))
    .sort((a, b) => String(b.issued_on || b.recorded_at || '').localeCompare(String(a.issued_on || a.recorded_at || '')));
}

export const holderHref = (holderId, search = '') => `/raise/cap-table/h-${holderId}${search}`;

/** Percent of a total, or null when the total is unknown or zero. */
const share = (part, total) => (num(part) != null && num(total) ? (part / total) * 100 : null);

/**
 * Who owns, by holder (CT1). `basis` is 'fd' (fully diluted) or 'out'
 * (outstanding): outstanding leaves out options and the pool, so a holder of
 * options alone and the unallocated group drop out.
 */
export function whoOwns(record, basis = 'fd', search = '') {
  const bh = record?.by_holder;
  if (!bh || bh.available === false) return { available: false, reason: bh?.reason || null, sentence: bh?.sentence || null };
  const classes = classMap(record);
  const fd = record?.fully_diluted?.available ? record.fully_diluted.shares : null;
  const out = record?.outstanding?.available ? record.outstanding.shares : null;
  const rows = (bh.rows || []).map((h) => {
    const held = num(h.shares) ?? 0;
    const opts = num(h.options) ?? 0;
    const last = issuancesOf(record, h.holder_id, h.name).find((r) => r.status === 'recorded');
    return {
      key: h.holder_id != null ? `h-${h.holder_id}` : `n-${h.name}`,
      name: String(h.name || '').trim() || NOT_RECORDED,
      href: h.holder_id != null ? holderHref(h.holder_id, search) : null,
      group: groupOf(h, classes),
      classes: (h.by_class || []).map((b) => classes.get(b.class_uid)?.name).filter(Boolean).join(', ') || NOT_RECORDED,
      shares: basis === 'out' ? held : held + opts,
      optionsOnly: held === 0 && opts > 0,
      pctFd: fd == null ? NOT_RECORDED : pct(share(held + opts, fd)),
      pctOut: held === 0 ? '—' : out == null ? NOT_RECORDED : pct(share(held, out)),
      source: last ? sourceWord(last.source) : NOT_RECORDED,
      changed: last ? day(last.issued_on || last.recorded_at) : NOT_RECORDED,
    };
  }).filter((r) => (basis === 'out' ? !r.optionsOnly : true));
  const pools = basis === 'fd' ? (record?.by_class?.rows || []).filter((c) => c.kind === 'option_pool' && num(c.unallocated) != null && c.unallocated > 0) : [];
  const groups = GROUPS.map((g) => {
    const members = g.id === 'pool'
      ? pools.map((p) => ({ key: `pool-${p.uid}`, name: `${p.name} · unallocated`, href: null, group: 'pool', classes: p.name, shares: p.unallocated, optionsOnly: true, pctFd: fd == null ? NOT_RECORDED : pct(share(p.unallocated, fd)), pctOut: '—', source: NOT_RECORDED, changed: NOT_RECORDED }))
      : rows.filter((r) => r.group === g.id).sort((a, b) => b.shares - a.shares);
    if (!members.length) return null;
    const total = members.reduce((t, m) => t + m.shares, 0);
    const outTotal = members.filter((m) => !m.optionsOnly).reduce((t, m) => t + m.shares, 0);
    return {
      id: g.id, label: g.label, rows: members, shares: total,
      pctFd: fd == null ? NOT_RECORDED : pct(share(total, fd)),
      pctOut: g.id === 'pool' || (g.id === 'people' && outTotal === 0) ? '—' : out == null ? NOT_RECORDED : pct(share(outTotal, out)),
    };
  }).filter(Boolean);
  const granted = record?.fully_diluted?.available ? record.fully_diluted.options_granted : null;
  return {
    available: true, groups,
    fdSentence: record?.fully_diluted?.available === false ? record.fully_diluted.sentence || null : null,
    foot: `Fully diluted ${fd == null ? NOT_RECORDED : shares(fd)} · Outstanding ${out == null ? NOT_RECORDED : shares(out)}. Percentages are rounded to two places. A row opens the holder.`,
    grantedLine: num(granted) > 0 ? `${shares(granted)} granted options are held by the people above.` : null,
  };
}

// ─────────────────────────────────────────────────────────── by class (CT1c)

/** A price per share, stored in millionths of the currency unit: up to six places, since a founder's common is often $0.0001. */
export function perShare(v, currency = 'USD') {
  if (num(v) == null) return NOT_RECORDED;
  const code = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'USD';
  try {
    return (v / 1e6).toLocaleString('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 6 });
  } catch {
    return `${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${code}`;
  }
}
const micros = perShare;

export function byClass(record) {
  const bc = record?.by_class;
  if (!bc || bc.available === false) return { available: false, reason: bc?.reason || null, sentence: bc?.sentence || null };
  const code = record?.currency?.code || 'USD';
  const holders = record?.by_holder?.available ? record.by_holder.rows || [] : [];
  const rows = (bc.rows || []).map((c) => {
    const pool = c.kind === 'option_pool';
    const preferred = c.kind === 'preferred';
    const count = holders.filter((h) => (h.by_class || []).some((b) => b.class_uid === c.uid)).length;
    return {
      uid: c.uid, name: c.name, kind: c.kind,
      authorized: shares(c.authorized_shares),
      issued: pool ? `${shares(c.options_granted)} granted` : shares(c.issued),
      outstanding: pool ? 'Not outstanding until exercised' : shares(c.issued),
      price: micros(c.price_per_share_micros, code),
      preference: preferred && num(c.liquidation_multiple_bps) != null ? `${c.liquidation_multiple_bps / 10000}×, ${c.participating ? 'participating' : 'non-participating'}` : '—',
      ratio: preferred && num(c.conversion_ratio) != null ? `1 : ${c.conversion_ratio}` : '—',
      holders: String(count),
    };
  });
  const out = record?.outstanding;
  const parts = (bc.rows || []).filter((c) => c.kind !== 'option_pool' && num(c.issued) > 0).map((c) => `${c.name} ${shares(c.issued)}`);
  return {
    available: true, rows,
    foot: out?.available ? `Outstanding ${shares(out.shares)}${parts.length ? ` = ${parts.join(' + ')}` : ''}.` : (out?.sentence || null),
  };
}

// ─────────────────────────────────────────────────────────── the side column

/** The tiles, each a share of fully diluted with its count beside it. */
export function tiles(record) {
  const fdOk = record?.fully_diluted?.available === true;
  const fd = fdOk ? record.fully_diluted.shares : null;
  const view = whoOwns(record, 'fd');
  const sumOf = (id) => (view.available ? view.groups.find((g) => g.id === id)?.shares ?? 0 : null);
  const tile = (label, n, unit) => ({ label, value: n == null || fd == null ? NOT_RECORDED : pct(share(n, fd)), sub: n == null ? NOT_RECORDED : `${shares(n)} ${unit}` });
  const granted = fdOk ? record.fully_diluted.options_granted : null;
  const unallocated = fdOk ? record.fully_diluted.unallocated_pool : null;
  const inst = record?.instruments?.rows || [];
  const codes = [...new Set(inst.map((r) => r.currency || record?.currency?.code || 'USD'))];
  const total = inst.reduce((t, r) => t + (num(r.amount_cents) ?? 0), 0);
  const known = inst.every((r) => num(r.amount_cents) != null);
  return [
    tile('Founders', sumOf('founders'), 'shares'),
    tile('Investors', sumOf('investors'), 'shares'),
    tile('Pool granted', granted, 'options'),
    // No pool class on record is not a pool of zero (D1017 §4).
    unallocated == null
      ? { label: 'Pool unallocated', value: NOT_RECORDED, sub: fdOk ? 'No pool is recorded' : NOT_RECORDED }
      : tile('Pool unallocated', unallocated, 'options'),
    {
      label: 'SAFEs and notes outstanding', value: String(inst.length),
      sub: inst.length === 0 ? 'None recorded'
        : codes.length === 1 && known ? `${money(total, codes[0])} · converts in a scenario` : 'Mixed currencies · converts in a scenario',
    },
  ];
}

export const BAR_GROUPS = [
  { id: 'founders', label: 'Founders' },
  { id: 'investors', label: 'Investors' },
  { id: 'people', label: 'Employees and advisors' },
  { id: 'other', label: 'Other holders' },
  { id: 'pool', label: 'Pool unallocated' },
];

const parts = (pairs) => {
  const total = pairs.reduce((t, [, n]) => t + n, 0);
  if (!total) return null;
  return pairs.filter(([, n]) => n > 0).map(([id, n]) => ({ id, label: BAR_GROUPS.find((g) => g.id === id)?.label || id, pct: (n / total) * 100 }));
};

/**
 * The three 100% bars: fully diluted and outstanding from the record, and
 * "After [round]" from the saved model's last round (Modelled). A bar the
 * record cannot draw carries its sentence; no planned round is a dashed note.
 */
export function bars(record, compare) {
  const fd = whoOwns(record, 'fd');
  const out = whoOwns(record, 'out');
  const of = (view) => (view.available ? parts(BAR_GROUPS.map((g) => [g.id, view.groups.find((x) => x.id === g.id)?.shares ?? 0])) : null);
  const fdBar = record?.fully_diluted?.available ? of(fd) : null;
  const outBar = record?.outstanding?.available ? of(out) : null;
  const scenario = compare?.canonical || null;
  const rounds = Array.isArray(scenario?.result?.rounds) ? scenario.result.rounds : [];
  const planned = Array.isArray(scenario?.inputs?.rounds) ? scenario.inputs.rounds : [];
  let after;
  if (!scenario || !rounds.length || !planned.length) after = { label: 'After the next round', modelled: true, parts: null, note: NO_ROUND };
  else {
    const last = rounds[rounds.length - 1];
    const sum = (types) => (last.ledger || []).filter((h) => types.includes(h?.type)).reduce((t, h) => t + (num(h.shares) ?? 0), 0);
    after = {
      label: `After ${String(last.name || 'the round').trim()} · Cap table · model`, modelled: true,
      parts: parts([['founders', sum(['founder'])], ['investors', sum(['safe', 'preferred'])], ['pool', sum(['option_pool'])]]),
      note: null,
    };
  }
  return [
    { label: 'Fully diluted by group', modelled: false, parts: fdBar, note: fdBar ? null : record?.fully_diluted?.sentence || 'Not recorded.' },
    { label: 'Outstanding', modelled: false, parts: outBar, note: outBar ? null : record?.outstanding?.sentence || 'Not recorded.' },
    after,
  ];
}

/** The outstanding instruments: recorded SAFEs and notes, listed, never added into a count. */
export function instruments(record) {
  const code = record?.currency?.code || 'USD';
  return (record?.instruments?.rows || []).map((r) => ({
    uid: r.uid,
    holder: String(r.holder?.name || '').trim() || NOT_RECORDED,
    line: `${r.kind === 'note' ? 'Note' : 'SAFE'} · ${money(r.amount_cents, r.currency || code)} · cap ${money(r.terms?.cap_cents, r.currency || code)} · ${r.terms?.basis === 'post_money' ? 'Post-money' : r.terms?.basis === 'pre_money' ? 'Pre-money' : 'Basis not recorded'}`,
    source: sourceWord(r.source),
  }));
}

// ─────────────────────────────────────────────────────────── the tool bar

/** "As of": the latest recorded change, never today's date passed off as one. */
export function asOf(record) {
  const dates = (record?.issuances?.rows || []).filter((r) => r.status === 'recorded').map((r) => String(r.recorded_at || r.issued_on || '')).filter(Boolean).sort();
  return dates.length ? `As of ${day(dates[dates.length - 1])}` : AS_OF_NONE;
}

/** Carta's chip from the integrations list: not connected, synced, or a failed sync. */
export function cartaChip(read, status = 'ready') {
  if (status === 'loading') return { text: 'Reading…', tone: 'muted' };
  if (status !== 'ready') return { text: 'Carta · could not be read', tone: 'warn' };
  const c = (read?.items || []).find((i) => String(i.provider_key || '').toLowerCase() === 'carta');
  if (!c || c.status === 'disconnected' || c.status === 'revoked') return { text: 'Carta · Not connected', tone: 'muted', title: 'Connect Carta on Import and export.' };
  if (c.last_error || c.status === 'error') return { text: 'Carta · last sync failed', tone: 'warn', title: String(c.last_error || '') };
  return { text: c.last_synced_at ? `Carta · synced ${day(c.last_synced_at)}` : 'Carta · connected', tone: 'good' };
}

const HARBOUR_CHIP = { valid: 'good', expiring: 'warn', expired: 'bad', invalidated: 'bad', none: 'muted' };

/** The 409A chip in the Worker's state; a failed read says so, never "no 409A". */
export function harbourChip(read, status = 'ready') {
  if (status === 'loading') return { text: 'Reading…', tone: 'muted' };
  const h = status === 'ready' ? harbour(read) : null;
  if (!h) return { text: '409A · could not be read', tone: 'warn' };
  const words = { valid: `409A · Valid until ${h.expires}`, expiring: `409A · Expiring ${h.expires}`, expired: '409A · Expired', invalidated: '409A · No longer valid', none: '409A · None on file' };
  return { text: words[h.state] || `409A · ${h.reason}`, tone: HARBOUR_CHIP[h.state] || 'muted' };
}

// ─────────────────────────────────────────────────────────── Needs you

const KIND_WORD = {
  founding: 'founding shares', priced: 'shares in a priced round', safe: 'a SAFE', note: 'a convertible note', grant: 'an option grant',
  exercise: 'an exercise', transfer: 'a transfer', conversion: 'a conversion', cancellation: 'a cancellation', correction: 'a correction',
};

/** One proposal in words: who, what, and the figures it carries; a missing one is not invented. */
export function describe(row, record) {
  const code = row.currency || record?.currency?.code || 'USD';
  const who = String(row.holder?.name || '').trim() || 'an unnamed holder';
  const cls = classMap(record).get(row.class_uid)?.name;
  const what = KIND_WORD[row.kind] || row.kind;
  if (row.kind === 'safe' || row.kind === 'note') {
    const bits = [num(row.amount_cents) != null ? money(row.amount_cents, code) : 'amount not recorded'];
    if (num(row.terms?.cap_cents) != null) bits.push(`${row.terms.basis === 'post_money' ? 'post-money' : row.terms.basis === 'pre_money' ? 'pre-money' : ''} cap ${money(row.terms.cap_cents, code)}`.replace('  ', ' ').trim());
    return `${what[0].toUpperCase()}${what.slice(1)} for ${who}, ${bits.join(', ')}.`;
  }
  const n = num(row.shares) != null ? `${shares(row.shares)} shares${cls ? ` of ${cls}` : ''}` : 'shares not recorded';
  return `${what[0].toUpperCase()}${what.slice(1)} for ${who}: ${n}.`;
}

const ORIGIN = {
  mercury: { pill: 'Mercury', lead: 'A SAFE request from Mercury.' },
  close: { pill: 'Close', lead: 'A close proposes the issuances it made.' },
  import: { pill: 'Import', lead: 'An import proposes this row.' },
  cofounder: { pill: 'Co-founder', lead: 'A co-founder proposed recording this.' },
  owner: { pill: 'You', lead: 'You proposed this.' },
  admin: { pill: 'Admin', lead: 'An admin proposed this.' },
};

/** Needs you: the proposals waiting, newest first, at most four, and how many in all. */
export function needsYou(record) {
  const rows = [...(record?.proposals?.rows || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return {
    count: rows.length,
    meta: rows.length === 1 ? '1 proposal waiting' : `${rows.length} proposals waiting`,
    rows: rows.slice(0, NEEDS_MAX).map((r) => ({
      uid: r.uid, origin: r.origin, pill: ORIGIN[r.origin]?.pill || 'Proposal', lead: ORIGIN[r.origin]?.lead || 'A proposal waits.',
      text: describe(r, record), reason: r.correction_reason || null, row: r,
    })),
  };
}

/** The proposals "Record them from the model" makes (CT19b): each founder's shares and each SAFE, as the model holds them. */
export function proposalsFromModel(scenario) {
  const inputs = scenario?.inputs || {};
  const founders = (Array.isArray(inputs.founders) ? inputs.founders : []).filter((f) => String(f?.name || '').trim() && num(f?.shares) > 0)
    .map((f) => ({ kind: 'founding', holder_name: String(f.name).trim(), shares: Math.round(f.shares), note: 'From your saved model (Cap table · model).' }));
  const safes = (Array.isArray(inputs.safes) ? inputs.safes : []).filter((s) => String(s?.name || '').trim())
    .map((s) => {
      const body = { kind: s.instrument === 'note' ? 'note' : 'safe', holder_name: String(s.name).trim(), note: 'From your saved model (Cap table · model).' };
      // The model is in whole dollars and fractions; the record is cents and basis points.
      if (num(s.amount) > 0) body.amount_cents = Math.round(s.amount * 100);
      if (num(s.cap) > 0) body.cap_cents = Math.round(s.cap * 100);
      if (num(s.discount) > 0) body.discount_bps = Math.round(s.discount * 10000);
      if (s.basis === 'post_money' || s.basis === 'pre_money') body.basis = s.basis;
      if (s.instrument === 'note' && num(s.interest_rate) > 0) body.interest_bps = Math.round(s.interest_rate * 10000);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(s.issue_date || ''))) body.issued_on = s.issue_date;
      return body;
    });
  return [...founders, ...safes];
}

// ─────────────────────────────────────────────────────────── the holder drawer (CT2)

export const holderIdOf = (id) => (/^h-([1-9]\d*)$/.test(String(id || '')) ? Number(String(id).slice(2)) : null);

const LEVEL_WORD = { none: 'None', own_position: 'Own position', summary: 'Summary', investor: 'Investor', full: 'Full' };

/** CT2: one holder's positions, issuances, vesting and 83(b), and what they can see. */
export function holderView(record, holderId, { grants = null, plan = null, filings = null } = {}) {
  const row = record?.by_holder?.available ? (record.by_holder.rows || []).find((h) => h.holder_id === holderId) : null;
  const issued = (record?.issuances?.rows || []).filter((r) => r.holder?.holder_id === holderId || r.from_holder?.holder_id === holderId);
  const name = String(row?.name || issued[0]?.holder?.name || '').trim() || null;
  const classes = classMap(record);
  const code = record?.currency?.code || 'USD';
  const fd = record?.fully_diluted?.available ? record.fully_diluted.shares : null;
  const held = row ? (num(row.shares) ?? 0) + (num(row.options) ?? 0) : null;
  const group = row ? groupOf(row, classes) : null;
  const person = group === 'founders' || group === 'people';
  const grantRows = Array.isArray(plan?.grants) ? plan.grants.filter((g) => g.holder_id === holderId) : null;
  const filing = Array.isArray(filings) ? filings.find((f) => f.kind === '83b' && Number(f.for_holder_id) === holderId) : undefined;
  const key = String(name || '').toLowerCase();
  const grant = Array.isArray(grants?.grants)
    ? grants.grants.find((g) => String(g.holder_ref || '').trim().toLowerCase() === key || (g.user_uid && String(g.name || '').trim().toLowerCase() === key))
    : undefined;
  return {
    found: Boolean(row || issued.length),
    name: name || NOT_RECORDED,
    group: group ? GROUP_LABEL[group] : null,
    pctFd: held == null || fd == null ? NOT_RECORDED : pct(share(held, fd)),
    positions: row ? (row.by_class || []).map((b) => ({ key: b.class_uid, line: `${classes.get(b.class_uid)?.name || 'A class not on record'} · ${shares(b.shares)} ${classes.get(b.class_uid)?.kind === 'option_pool' ? 'options' : 'shares'}` })) : [],
    issuances: issued.map((r) => ({
      uid: r.uid, void: r.status === 'void',
      line: `${day(r.issued_on)} · ${describe(r, record)}`.replace(/\.$/, ''),
      sub: r.status === 'void' ? `Void: ${r.void_reason || NOT_RECORDED}` : num(r.price_per_share_micros) != null ? `Paid ${perShare(r.price_per_share_micros, r.currency || code)} a share` : null,
      document: r.document_ref || null,
      source: sourceWord(r.source),
      correction: r.correction_reason || null,
    })),
    person,
    vesting: !person ? null : grantRows == null ? { status: 'unreadable' } : grantRows.map((g) => ({
      key: g.id,
      terms: `Start ${day(g.start_date)} · cliff ${num(g.cliff_months) == null ? NOT_RECORDED : `${g.cliff_months} months`} · total ${num(g.total_months) == null ? NOT_RECORDED : `${g.total_months} months`}`,
      vested: `Vested ${shares(g.vested_shares)} of ${shares(g.total_shares)}`,
      pct: num(g.vested_shares) != null && num(g.total_shares) ? (g.vested_shares / g.total_shares) * 100 : null,
    })),
    election: !person ? null : filing === undefined && filings == null ? { status: 'unreadable' }
      : filing && filing.state === 'done' ? { text: '83(b) filed' }
      : filing ? { text: `83(b) · not filed yet${filing.due_date ? `, due ${day(filing.due_date)}` : ''}` }
      : { text: `83(b) · ${NOT_RECORDED}` },
    access: grants == null ? { status: 'unreadable' }
      : grant ? { level: grants.levels?.[grant.level]?.label || LEVEL_WORD[grant.level] || grant.level, scope: grants.levels?.[grant.level]?.sees || null }
      : { level: 'Not shared', scope: 'They see nothing of the cap table until a level is granted.' },
  };
}

/** The 83(b) filings from Build's company-creation read: each step's kind, holder and state. */
export function filingsOf(read) {
  const rows = Array.isArray(read?.records?.rows) ? read.records.rows : [];
  return rows.map((r) => r?.edit).filter((e) => e && e.kind).map((e) => ({ kind: e.kind, for_holder_id: e.for_holder_id ?? null, state: e.state ?? null, due_date: e.due_date ?? null }));
}

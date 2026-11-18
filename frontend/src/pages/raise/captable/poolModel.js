/**
 * D1023 (#2860, part 8 of #2432) — the Option pool tab (CT5, CT5c), kept pure
 * so the tests read it without a browser.
 *
 * WHAT IS READ, AND WHICH WINS.
 *   - The record (D1017): a pool is a class of kind `option_pool`, with its
 *     size, the options granted from it, those exercised and what is left.
 *     When the record holds a pool, the tiles and the burn-down read it.
 *   - The venture's equity plan (D1020, `GET /api/captable/equity-plan?project_id=`):
 *     pools and grants with their vesting, entered on StudioOS or synced from
 *     Carta. The grants table reads it, and Vested comes from it. With no pool
 *     on the record, the tiles read its pools instead, and say so.
 *   - The 409A (`GET /api/captable/409a/:projectId`), in the Worker's words.
 *   - The saved model (`…/compare`), for the burn-down's dotted target only,
 *     tagged Modelled.
 *
 * NO ZERO FOR A MISSING VALUE. A tile with nothing stored reads "Not recorded"
 * on a dashed tile. Exercised is "Not recorded" until an exercise is on record,
 * because no exercise rows is not the same as none exercised.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { documentWord } from './historyModel.js';
import { day, shares } from './capTableModel.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A total of a column: null with no rows, and null when any row lacks the figure. */
const knownSum = (rows, f) => (rows.length && rows.every((r) => num(f(r)) != null) ? rows.reduce((s, r) => s + f(r), 0) : null);

export const CARTA_URL = 'https://app.carta.com/';
export const TOP_UP_LINE = 'Top up the pool opens a scenario. Nothing is recorded until you record it.';
export const EXERCISES_NOT_RECORDED = 'Record exercises in History';

const poolClasses = (record) => (record?.by_class?.available ? (record.by_class.rows || []) : []).filter((c) => c.kind === 'option_pool');
const recordedRows = (record) => (record?.issuances?.rows || []).filter((r) => r.status === 'recorded');

const tile = (label, value, sub = null) => ({ label, value: num(value) == null ? NOT_RECORDED : shares(value), missing: num(value) == null, sub: num(value) == null ? sub : null });

/**
 * CT5's five tiles. `plan` is undefined while it is read and null when it
 * could not be, which makes Vested unreadable rather than "Not recorded".
 */
export function poolTiles(record, plan) {
  const pools = poolClasses(record);
  const exercisedRows = recordedRows(record).filter((r) => r.kind === 'exercise');
  let source;
  let authorized; let granted; let exercised; let available;
  if (pools.length) {
    source = 'record';
    authorized = knownSum(pools, (p) => p.authorized_shares);
    granted = knownSum(pools, (p) => p.options_granted);
    exercised = exercisedRows.length ? knownSum(pools, (p) => p.options_exercised) : null;
    available = knownSum(pools, (p) => p.unallocated);
  } else if (Array.isArray(plan?.pools) && plan.pools.length) {
    source = plan.pools.every((p) => p.source === 'connector_carta') ? 'carta' : 'register';
    authorized = plan.summary?.shares_authorized ?? null;
    granted = plan.summary?.shares_issued ?? null;
    exercised = null;
    available = plan.summary?.shares_available ?? null;
  } else {
    source = 'none';
    authorized = null; granted = null; exercised = null; available = null;
  }
  const vested = plan === undefined ? { label: 'Vested', value: 'Reading…', missing: true, sub: null }
    : plan === null ? { label: 'Vested', value: 'Could not be read', missing: true, sub: 'That is not a claim that none has vested.', unreadable: true }
      : tile('Vested', plan.summary?.vested_shares ?? null);
  return {
    source,
    sourceLine: source === 'record' ? null
      : source === 'carta' ? 'No pool is on the record. These figures are Carta’s, read only.'
        : source === 'register' ? 'No pool is on the record. These figures are the pools entered on StudioOS.'
          : 'No option pool is recorded for this venture.',
    tiles: [
      tile('Authorized', authorized),
      tile('Granted', granted),
      vested,
      tile('Exercised', exercised, EXERCISES_NOT_RECORDED),
      tile('Available', available),
    ],
  };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (s) => (/^\d{4}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 7) : null);
function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The target pool in the saved model's first round: the pool's shares after it. Modelled. */
export function poolTarget(compare) {
  const round = compare?.canonical?.result?.rounds?.[0];
  const pool = (round?.ledger || []).find((h) => h?.type === 'option_pool');
  if (!pool || num(pool.shares) == null) return null;
  return { shares: pool.shares, label: `Target pool · Cap table · model, ${String(round.name || 'the round')} · Modelled` };
}

/**
 * CT5's burn-down by month, from the record's grants, exercises and
 * cancellations in its pools: granted and exercised to date, and what is
 * available. Null without a pool on the record. At most the last 24 months.
 */
export function burnDown(record, compare, thisMonth) {
  const pools = poolClasses(record);
  if (!pools.length) return null;
  const poolUids = new Set(pools.map((p) => p.uid));
  const authorized = knownSum(pools, (p) => p.authorized_shares);
  const rows = recordedRows(record);
  const moves = [];
  for (const r of rows) {
    const m = monthOf(r.issued_on);
    const n = num(r.shares);
    if (!m || n == null) continue;
    if (r.kind === 'grant' && poolUids.has(r.class_uid)) moves.push({ m, granted: n });
    else if (r.kind === 'cancellation' && poolUids.has(r.class_uid)) moves.push({ m, granted: -Math.abs(n) });
    else if (r.kind === 'exercise' && poolUids.has(r.from_class_uid)) moves.push({ m, exercised: n });
  }
  const exercisesRecorded = moves.some((x) => x.exercised != null);
  const starts = moves.map((x) => x.m).sort();
  const end = monthOf(thisMonth) || starts[starts.length - 1];
  if (!starts.length || !end) return { empty: 'No grant from the pool is on record yet.', authorized, target: poolTarget(compare) };
  let months = monthsBetween(starts[0], end > starts[0] ? end : starts[0]);
  let granted = 0; let exercised = 0;
  const before = months.length > 24 ? months[months.length - 25] : null;
  const points = months.map((m) => {
    for (const x of moves) if (x.m === m) { granted += x.granted ?? 0; exercised += x.exercised ?? 0; }
    return { month: m, granted, exercised: exercisesRecorded ? exercised : null, available: authorized == null ? null : authorized - granted - exercised };
  });
  const kept = before ? points.filter((p) => p.month > before) : points;
  months = kept.map((p) => p.month);
  const last = kept[kept.length - 1];
  const target = poolTarget(compare);
  const label = (m) => `${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
  return {
    points: kept.map((p) => ({ ...p, label: label(p.month) })),
    authorized,
    target,
    exercisesRecorded,
    summary: `Option pool by month, ${label(months[0])} to ${label(months[months.length - 1])}: granted rose to ${shares(last.granted)}${authorized == null ? '; the pool’s size is not recorded' : ` of ${shares(authorized)} shares and available is ${shares(last.available)}`}.${exercisesRecorded ? ` Exercised ${shares(last.exercised)}.` : ' Exercises are not recorded.'}${target ? ` The model targets ${shares(target.shares)}.` : ''}`,
    foot: exercisesRecorded ? null : 'Exercises are not recorded yet: record them in History.',
  };
}

const ROLE = { employee: 'Employee', advisor: 'Advisor', founder: 'Founder', investor: 'Investor' };
export const GRANT_SORTS = [{ value: 'date', label: 'Grant date' }, { value: 'shares', label: 'Largest first' }, { value: 'holder', label: 'Holder A–Z' }];

function perShareMicros(micros, code = 'USD') {
  const n = num(micros);
  if (n == null) return NOT_RECORDED;
  const v = n / 1e6;
  return `${code === 'USD' ? '$' : `${code} `}${v.toFixed(v < 0.1 ? 4 : 2)}`;
}

/**
 * CT5's grants, from the venture's equity plan, each named and dated from the
 * record where the record holds the same holder's grant.
 */
/**
 * D1130 (#3010): the holder's 83(b), from the plan read's `elections` (one per
 * holder, not per grant). An unreadable election store says so on its own line
 * and never blanks the grants. A plan read that carries no `elections` draws no
 * 83(b) line at all.
 */
export function electionWord(elections, holderId) {
  if (!elections?.available) return 'Unreadable · Try again';
  const row = (elections.rows || []).find((e) => e.holder_id === holderId);
  if (!row) return NOT_RECORDED;
  return row.state === 'done'
    ? `Filed · ${row.has_document ? 'Proof on file' : 'No document'} · Filing date not recorded`
    : `Not filed yet${row.due_date ? ` · due ${row.due_date}` : ''}`;
}

export function grantRows(plan, record) {
  if (!Array.isArray(plan?.grants)) return null;
  const code = record?.currency?.code || 'USD';
  const holders = new Map((record?.by_holder?.available ? record.by_holder.rows || [] : []).map((h) => [h.holder_id, h]));
  const grants = recordedRows(record).filter((r) => r.kind === 'grant');
  const exercises = recordedRows(record).filter((r) => r.kind === 'exercise');
  return plan.grants.map((g) => {
    const h = holders.get(g.holder_id);
    // D6086: a row written with a grant names it; any other row takes the holder's latest grant, as before.
    const own = g.issuance_uid ? grants.filter((r) => r.uid === g.issuance_uid)
      : grants.filter((r) => g.holder_id != null && r.holder?.holder_id === g.holder_id).sort((a, b) => String(b.issued_on || '').localeCompare(String(a.issued_on || '')));
    const rec = own[0] || null;
    const exercised = exercises.filter((r) => r.holder?.holder_id === g.holder_id).reduce((s, r) => s + (num(r.shares) ?? 0), 0);
    const name = String(h?.name || rec?.holder?.name || '').trim();
    return {
      key: g.id,
      holder: name || NOT_RECORDED,
      role: ROLE[h?.kind] || NOT_RECORDED,
      roleKey: h?.kind || '',
      sharesN: num(g.total_shares),
      shares: shares(g.total_shares),
      strike: rec ? perShareMicros(rec.price_per_share_micros, rec.currency || code) : NOT_RECORDED,
      grantDate: rec ? day(rec.issued_on) : NOT_RECORDED,
      grantOn: rec?.issued_on || '',
      vesting: `${num(g.total_months) == null ? `Term ${NOT_RECORDED.toLowerCase()}` : `${g.total_months} months`} · ${num(g.cliff_months) == null ? `cliff ${NOT_RECORDED.toLowerCase()}` : num(g.cliff_months) === 0 ? 'no cliff' : `${g.cliff_months}-month cliff`} · from ${day(g.start_date)}`,
      onGrant: Boolean(g.issuance_uid),
      vested: shares(g.vested_shares),
      unvested: shares(g.unvested_shares),
      vestedBasis: vestedBasis(g),
      ...(plan.elections ? { election: electionWord(plan.elections, g.holder_id) } : {}),
      exercise: exercised > 0 ? `Exercised ${shares(exercised)}` : 'Not exercised',
      document: rec?.document_ref ? documentWord(rec) : null,
      carta: g.source === 'connector_carta',
    };
  });
}

/** D6086: where a grant's Vested comes from, in words, or null when it is the stored count. */
export function vestedBasis(g) {
  if (g?.vested_basis === 'schedule') return `Worked out from the schedule on ${day(g.vested_as_of)}`;
  if (g?.vested_basis === 'recorded' && g.source === 'connector_carta') return 'As Carta reports it';
  return null;
}

/** The toolbar over the grants: a search, a role and a sort. */
export function filterGrants(rows, { q = '', role = '', sort = 'date' } = {}) {
  const t = String(q).trim().toLowerCase();
  const by = {
    date: (a, b) => String(b.grantOn).localeCompare(String(a.grantOn)),
    shares: (a, b) => (b.sharesN ?? -1) - (a.sharesN ?? -1),
    holder: (a, b) => a.holder.localeCompare(b.holder),
  };
  return rows.filter((r) => (!t || r.holder.toLowerCase().includes(t)) && (!role || r.roleKey === role)).sort(by[sort] || by.date);
}

/** "Vested 183,000 adds up the three rows." Only when every row records it. */
export function vestedFoot(plan) {
  const v = num(plan?.summary?.vested_shares);
  const n = Array.isArray(plan?.grants) ? plan.grants.length : 0;
  if (v == null || !n) return null;
  return `Vested ${shares(v)} adds up the ${n === 1 ? 'one row' : `${n} rows`}.`;
}

// ───────────────────────────────────────────────────────────── a grant's vesting (D6086)

/** RA-27's presets. Custom leaves Months and Cliff months as typed. */
export const VESTING_PRESETS = [
  { key: '4y1c', label: '4 years, 1-year cliff', months: '48', cliff: '12' },
  { key: '4y0c', label: '4 years, no cliff', months: '48', cliff: '0' },
  { key: 'custom', label: 'Custom' },
];
export const VESTING_MONTHS_MAX = 600;
export const VESTING_HELP = 'Worked out from the schedule typed above. It is not the record.';
export const VESTING_BLANK = 'Leave Start blank to record the grant without a schedule.';
export const emptyVesting = () => ({ preset: '4y1c', start: '', months: '48', cliff: '12' });

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const whole = (v) => { const t = String(v ?? '').trim(); return /^\d+$/.test(t) ? Number(t) : null; };

/** `n` months after an ISO day, on the same day of the month or the month's last day. */
export function addMonths(iso, n) {
  const m = ISO_DAY.exec(String(iso || ''));
  if (!m) return null;
  const at = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(at / 12); const mo = (at % 12) + 1;
  const d = Math.min(Number(m[3]), daysIn(y, mo));
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const realDay = (iso) => { const m = ISO_DAY.exec(String(iso || '')); return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= daysIn(Number(m[1]), Number(m[2])); };

/**
 * The schedule a grant's form posts (`{ start_date, total_months, cliff_months }`),
 * nothing when Start is blank, or the sentence that says what is wrong. The
 * Worker checks the same (`capTableRecord.ts`, D6086).
 */
export function vestingBody(vest) {
  if (!vest || !String(vest.start || '').trim()) return { vesting: null, sentence: null };
  if (!realDay(vest.start)) return { vesting: null, sentence: 'The vesting start is a date.' };
  const months = whole(vest.months); const cliff = whole(vest.cliff);
  if (months == null || months < 1 || months > VESTING_MONTHS_MAX) return { vesting: null, sentence: `Vesting runs for a whole number of months, 1 to ${VESTING_MONTHS_MAX}.` };
  if (cliff == null) return { vesting: null, sentence: 'The cliff is a whole number of months, 0 for none.' };
  if (cliff > months) return { vesting: null, sentence: `The cliff can’t be longer than the vesting: ${cliff} months is more than ${months}.` };
  return { vesting: { start_date: vest.start, total_months: months, cliff_months: cliff }, sentence: null };
}

const pctOf = (part, total) => { const p = (part / total) * 100; return `${Number.isInteger(p) ? p : p.toFixed(1)}%`; };

/**
 * RA-27's Modelled preview of a schedule: when the cliff vests and when the
 * last month does. Null until the schedule is whole; it is never the record.
 */
export function vestingPreview(vest) {
  const { vesting: v } = vestingBody(vest);
  if (!v) return null;
  const end = day(addMonths(v.start_date, v.total_months));
  if (v.cliff_months === v.total_months) return `All of it vests on ${end}`;
  if (v.cliff_months === 0) return `Vests monthly from ${day(addMonths(v.start_date, 1))} to ${end}`;
  return `${pctOf(v.cliff_months, v.total_months)} vests on ${day(addMonths(v.start_date, v.cliff_months))}, then monthly to ${end}`;
}

/** A schedule in words, as a proposal or a grant carries it: "4 years, 1-year cliff, from 1 Mar 2026". */
export function vestingWords(v) {
  if (!v) return 'No schedule';
  const preset = VESTING_PRESETS.find((p) => p.months === String(v.total_months) && p.cliff === String(v.cliff_months));
  const length = preset ? preset.label : `${v.total_months} months, ${v.cliff_months ? `${v.cliff_months}-month cliff` : 'no cliff'}`;
  return `${length}, from ${day(v.start_date)}`;
}

/** CT5c: Carta is the record while connected, and its grants are read only here. */
export const isCarta = (plan) => Array.isArray(plan?.grants) && plan.grants.some((g) => g.source === 'connector_carta');

// ───────────────────────────────────────────────────────────── the 409A

export const METHODS = [
  { value: '', label: 'Method not stated' }, { value: 'income', label: 'Income' }, { value: 'market', label: 'Market' },
  { value: 'asset', label: 'Asset' }, { value: 'obm', label: 'Option pricing (OPM)' }, { value: 'backsolve', label: 'Backsolve' }, { value: 'other', label: 'Other' },
];
export const EVENT_KINDS = [
  { value: 'priced_round', label: 'A priced financing round' },
  { value: 'material_change', label: 'A material change in the business' },
  { value: 'secondary_transaction', label: 'A secondary sale of shares' },
  { value: 'acquisition_discussion', label: 'Acquisition discussions' },
  { value: 'financial_restatement', label: 'A financial restatement' },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const positive = (v) => { const t = String(v ?? '').replace(/[$,\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

/** Record a valuation: the Worker's body, or what is missing in a sentence. */
export function valuationBody(f) {
  const fmv = positive(f?.fmv);
  const pref = positive(f?.preferred);
  const missing = [!ISO.test(String(f?.date || '')) && 'the valuation date', fmv == null && 'the FMV per common share'].filter(Boolean);
  if (missing.length) return { body: null, sentence: `It still needs ${missing.join(' and ')}.` };
  if (!(fmv > 0)) return { body: null, sentence: 'The FMV per common share is a number above zero.' };
  if (pref != null && !(pref > 0)) return { body: null, sentence: 'The preferred price is a number above zero, or left blank.' };
  const body = { valuation_date: f.date, fmv_per_share: fmv };
  if (String(f.provider || '').trim()) body.provider = String(f.provider).trim();
  if (f.method) body.method = f.method;
  if (pref != null) body.preferred_price_per_share = pref;
  if (String(f.notes || '').trim()) body.notes = String(f.notes).trim();
  return { body, sentence: null };
}

/** Record an event: the Worker's body, or what is missing in a sentence. */
export function eventBody(f) {
  const missing = [!EVENT_KINDS.some((k) => k.value === f?.kind) && 'what happened', !ISO.test(String(f?.date || '')) && 'the date'].filter(Boolean);
  if (missing.length) return { body: null, sentence: `It still needs ${missing.join(' and ')}.` };
  const body = { kind: f.kind, occurred_on: f.date };
  if (String(f.note || '').trim()) body.note = String(f.note).trim();
  return { body, sentence: null };
}

/** The 409A's checks, in the Worker's own labels: a fired one is a warning, the rest are clear. */
export function harbourChecks(read) {
  const cap = (t) => `${String(t || '').charAt(0).toUpperCase()}${String(t || '').slice(1)}`;
  return (Array.isArray(read?.triggers) ? read.triggers : []).map((t) => ({
    key: t.kind,
    fired: !!t.fired,
    line: t.fired ? `${cap(t.label)} on ${day(t.occurred_on)} may end the safe harbour.` : `${cap(t.label)} · none recorded`,
  }));
}

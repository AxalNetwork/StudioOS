/**
 * D1155 (#3060, part 7 of #2421) — who sees what on a deal page (DL15), and
 * the commitments table the founder (DL16), an Admin (DL17a) and an Operating
 * Partner (DL17b) read. Pure, so `frontend/test/deal_views_d1155.test.mjs`
 * holds each rule and `cloudflare-worker/test/deal_who_sees_what_d1155.test.ts`
 * reads the Worker's replies against the same table.
 *
 * THE TABLE IS THE CANVAS'S WORDS. Each cell is what one viewer sees, in a
 * word, never a colour alone (DL15's own rule). `source` names the read that
 * holds the kind, and `departs` names each cell today's Worker does not give
 * as the canvas draws it, with why. A departure is said, never hidden.
 */
import { dealMoney } from '../../components/deals/dealMoney';
import { isSuperAdminUser } from '../../lib/shellRole';

export const VIEWERS = Object.freeze([
  { key: 'you', label: 'You' },
  { key: 'colleague', label: 'Your firm colleagues' },
  { key: 'other', label: 'Other investors on this deal' },
  { key: 'founder', label: 'Founder' },
  { key: 'partner', label: 'Operating Partner' },
  { key: 'admin', label: 'Admin' },
  { key: 'super', label: 'Super Admin' },
]);

const FULL = 'Full';
const NEVER = 'Never';
const COUNT = 'Count and total only';

/** DL15's twelve kinds, in its order. Cells follow `VIEWERS`. */
export const WHO_SEES = Object.freeze([
  {
    key: 'score', label: 'Score and evidence',
    cells: [FULL, FULL, FULL, FULL, FULL, FULL, FULL],
    source: 'No per-deal score or evidence read yet: Scorecard and Evidence say so (D1253, D1261).',
    departs: {},
  },
  {
    key: 'room', label: 'Data room files',
    cells: ['By the founder’s grant and your NDA', 'By their grant and NDA', 'By their grant and NDA', FULL, NEVER, 'Counts only', 'Counts only'],
    source: '`data_room.ts` for an investor, by grant and NDA, with withheld files counted (D1153); the founder’s own data room.',
    departs: {
      admin: 'The deal page reads no data-room counts for staff: their Documents tab lists the documents’ titles only.',
      super: 'As an Admin.',
    },
  },
  {
    key: 'case', label: 'Diligence case',
    cells: [FULL, 'Only if you share', NEVER, NEVER, NEVER, NEVER, NEVER],
    source: '`/api/dd/cases`, scoped to the cases you opened, lead or review (D1153).',
    departs: {},
  },
  {
    key: 'ic', label: 'IC record and votes',
    cells: [FULL, FULL, NEVER, NEVER, NEVER, NEVER, NEVER],
    source: '`ic.ts`, `icDecisionScope`: the creator, a voter and the firm.',
    departs: {
      admin: 'An Admin is unscoped in `icDecisionScope` and reads every IC record; that is `ic.ts`’s rule, not changed here.',
      super: 'As an Admin.',
    },
  },
  {
    key: 'mine', label: 'Your commitment and its note',
    cells: [FULL, FULL, COUNT, 'Amount and status, never the note', 'Full, never the note', 'Full, never the note', 'Full, never the note'],
    source: '`GET /api/deals/:id/commitments` (D1155): your own rows with your note; every row with no note for the founder and staff; a count and a total for other investors (`/round`, D1153).',
    departs: {
      colleague: 'The read is per person, so a colleague at your firm does not read your commitment; sharing it with the firm needs a firm scope the read does not have yet.',
      founder: 'The founder also reads each investor’s name, as DL16 draws it.',
    },
  },
  {
    key: 'others', label: 'Other investors’ commitments',
    cells: [COUNT, COUNT, COUNT, 'Full, never the notes', 'Full, never the notes', 'Full, never the notes', 'Full, never the notes'],
    source: '`GET /api/deals/:id/commitments` for the founder and staff (D1155); `GET /api/deals/:id/round` for an investor (D1153).',
    departs: {},
  },
  {
    key: 'syndicates', label: 'Syndicate members',
    cells: ['Own only', 'Own only', 'Own only', COUNT, FULL, FULL, FULL],
    source: '`GET /api/networkfx/syndicates`: the syndicates you lead or belong to (D1153 §5); a lead sees its members by name.',
    departs: {
      founder: 'The founder reads the syndicates they lead or belong to, as everyone does; no count of a deal’s syndicates is read yet.',
      partner: 'Staff read the syndicates they lead or belong to, as everyone does.',
      admin: 'As the Operating Partner.',
      super: 'As the Operating Partner.',
    },
  },
  {
    key: 'notes', label: 'Your notes',
    cells: [FULL, FULL, NEVER, NEVER, NEVER, NEVER, NEVER],
    source: 'Part 2’s deal notes, your firm’s only (D1150, D1152).',
    departs: {},
  },
  {
    key: 'references', label: 'Reference calls',
    cells: [FULL, FULL, NEVER, NEVER, NEVER, NEVER, NEVER],
    source: '`/api/references?deal_id=`, each firm’s own (D609, #2437); an Operating Partner has no Diligence tab (D1148).',
    departs: {
      admin: 'An Admin keeps the Diligence tab (D1148) and its reference calls; the canvas’s Never is not today’s rule.',
      super: 'As an Admin.',
    },
  },
  {
    key: 'activity', label: 'Activity',
    cells: ['Deal events · others unnamed', 'Deal events · others unnamed', 'Their own and deal events', 'Their deal’s events', FULL, FULL, FULL],
    source: '`GET /api/deals/:id/activity` (D1152): names for the founder and staff (an Operating Partner since D1155); "You" and "An investor" for an investor.',
    departs: {},
  },
  {
    key: 'mercury', label: 'Mercury capacity',
    cells: [FULL, NEVER, NEVER, NEVER, NEVER, NEVER, NEVER],
    source: 'Your own Mercury figures are yours (D752). An Admin on HQ reads only a proof-of-funds statement an investor chose to share, never the figures.',
    departs: {
      admin: 'An Admin on HQ reads a proof-of-funds statement an investor chose to share with the studio (D752); never the balance behind it.',
      super: 'As an Admin.',
    },
  },
  {
    key: 'studio_notes', label: 'The studio’s internal deal notes',
    cells: [NEVER, NEVER, NEVER, NEVER, FULL, FULL, FULL],
    source: '`GET /api/deals/:id`, `serializeDeal`: notes and pass reasons for an Admin and an Operating Partner only (#2647).',
    departs: {},
  },
]);

export const cellOf = (kind, viewer) => {
  const k = WHO_SEES.find((x) => x.key === kind);
  const i = VIEWERS.findIndex((v) => v.key === viewer);
  return k && i >= 0 ? k.cells[i] : null;
};

// ---------------------------------------------------------------- the viewer

/**
 * Who is reading the deal page, for DL16 and DL17: the deal's own founder, an
 * Admin (a Super Admin is an admin by role), an Operating Partner, an
 * investor, or nobody this table draws for.
 */
export function viewerOf(role, user, deal) {
  if (role === 'admin') return isSuperAdminUser(user) ? 'super' : 'admin';
  if (role === 'partner') return 'partner';
  if (role === 'investor') return 'investor';
  if (role === 'founder' && user?.founder_id != null && deal?.project_founder_id != null
    && Number(user.founder_id) === Number(deal.project_founder_id)) return 'founder';
  return null;
}

// ---------------------------------------------------------------- the commitments table

/** The line's word, as the closing room says it (D1213 §2). */
const WORD = { pending: 'Committed', confirmed: 'Received', withdrawn: 'Withdrawn' };
export const statusWord = (s) => WORD[s] || 'Not recorded';
export const STATUS_FILTERS = Object.freeze([
  { key: '', label: 'Every status' },
  { key: 'pending', label: 'Committed' },
  { key: 'confirmed', label: 'Received' },
  { key: 'withdrawn', label: 'Withdrawn' },
]);
export const SORTS = Object.freeze([
  { key: 'amount', label: 'Amount, largest first' },
  { key: 'recorded', label: 'Recorded, newest first' },
  { key: 'name', label: 'Investor, A to Z' },
]);
export const PAGE_SIZE = 25;

const amountOf = (r) => (r?.amount == null || !Number.isFinite(Number(r.amount)) ? null : Number(r.amount));
const live = (r) => r.status === 'pending' || r.status === 'confirmed';

/** The table's rows: search on the investor's name, a status, a sort and a page. */
export function tableRows(items, { q = '', status = '', sort = 'amount', page = 1 } = {}) {
  const needle = String(q).trim().toLowerCase();
  let rows = (Array.isArray(items) ? items : [])
    .filter((r) => !needle || String(r.investor_name || '').toLowerCase().includes(needle))
    .filter((r) => !status || r.status === status);
  const by = {
    amount: (a, b) => (amountOf(b) ?? -1) - (amountOf(a) ?? -1),
    recorded: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    name: (a, b) => String(a.investor_name || '').localeCompare(String(b.investor_name || '')),
  }[sort] || (() => 0);
  rows = [...rows].sort(by);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const slice = rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const range = rows.length ? `${(p - 1) * PAGE_SIZE + 1}–${(p - 1) * PAGE_SIZE + slice.length} of ${rows.length}` : '0 of 0';
  return { rows: slice, total: rows.length, page: p, pages, range };
}

/**
 * The table's heading: "Commitments · 8 in · $950,000". A withdrawn one is not
 * in, and a line with no amount is not counted and is named as not counted,
 * never a zero.
 */
export function heading(items, currency = 'USD') {
  const list = (Array.isArray(items) ? items : []).filter(live);
  const counted = list.filter((r) => amountOf(r) != null);
  const sum = counted.reduce((n, r) => n + amountOf(r), 0);
  const money = counted.length ? dealMoney(sum, currency) : null;
  const missing = list.length - counted.length;
  return [
    `Commitments · ${list.length} in`,
    money ? ` · ${money}` : '',
    missing ? ` · ${missing} with no amount recorded, not counted` : '',
  ].join('');
}

/** What each viewer may do on a row. Only an Admin records a wire (D1215); only the founder matches to Mercury. */
export function rowAction(viewer, row) {
  if (viewer === 'founder' && (row.status === 'pending' || row.status === 'confirmed')) return 'match';
  if ((viewer === 'admin' || viewer === 'super') && row.status === 'pending') return 'wire';
  return null;
}

/** The line under the table, per viewer (DL16, DL17a, DL17b). */
export const FOOT = Object.freeze({
  founder: 'Investors’ notes are private to them. A withdrawn commitment does not count toward the round.',
  admin: 'Admins see every commitment with names, never a note.',
  super: 'Admins see every commitment with names, never a note.',
  partner: 'Investors’ notes and Mercury figures are not shown to you. An Admin records wires; you tick the closing checklist.',
});

/** DL17b's pill beside the header. */
export const READ_ONLY = 'Read only';

/** The wire dialog's words for the gate read (DL17a). */
export function gateLine(gate) {
  if (gate.status === 'loading') return { held: null, text: 'Reading whether an IC condition holds wires…' };
  if (gate.status === 'failed') return { held: null, text: 'Whether an IC condition holds wires could not be read. The Worker checks again when you record, and refuses a held wire.' };
  if (gate.data?.held) {
    const n = gate.data.open_conditions;
    return { held: true, text: n ? `${n} IC condition${n === 1 ? ' is' : 's are'} open on this deal. Wires are refused until ${n === 1 ? 'it is' : 'they are'} met.` : 'A condition is open on this deal. Wires are refused until it is met.' };
  }
  return { held: false, text: null };
}

/** A commitment's dollars as the wire's whole cents, or null when no amount is recorded. */
export function wireCents(row) {
  const a = amountOf(row);
  return a == null || a <= 0 ? null : Math.round(a * 100);
}

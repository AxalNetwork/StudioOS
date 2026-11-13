/**
 * The portfolio support ledger — canvas IP3, `/portfolio/value-add`.
 *
 * WHAT THIS EXISTS FOR. The licence axiom is invest in AND SUPPORT companies,
 * and the artboard's own words are that this desk is "where the second half
 * becomes auditable". It could not be. Migration 237's header lists every table
 * in the schema that joins an investor to a company and shows that each one
 * records the investor GAINING ACCESS to a company rather than doing work for
 * one — so the zone's three `unbuilt` reasons were true, and the fix was a
 * store rather than a rewording.
 *
 * READS ARE SCOPED LIKE EVERY OTHER PORTFOLIO READ: `canViewLpData`, then
 * `investorProjectIds`, then the CSV predicate. The predicate treats NULL as
 * "all rows", so an empty accessible set short-circuits BEFORE the query — an
 * investor with no book gets an empty ledger, never the firm's.
 *
 * WRITES ARE NOT ADMIN-ONLY, AND THAT IS DELIBERATE. Every write in
 * `routes/positions.ts` is `requireAdmin`, because a mark changes what an LP is
 * told a position is worth and that is a governed assertion. A support entry is
 * not a valuation: it is a record of what a person did. Making it admin-only
 * would mean the people doing the work cannot record it, which leaves the
 * ledger empty and the axiom unauditable — the exact state this route was
 * built to end. So an investor may write against a project ALREADY IN THEIR OWN
 * ACCESSIBLE BOOK, checked against the same scope as the read, and admin may
 * write anywhere. Nobody gains a project they could not already see.
 *
 * DELIVERING IS A WRITE. `state` defaults to 'promised' and only `PATCH
 * /:uid` moves it. Without that transition this table would repeat the defect
 * that makes `investor_introductions` useless as a ledger: a status column
 * written once and never updated, so every row reads outstanding forever.
 *
 * AN AMENDMENT IS GUARDED, ATTRIBUTED AND RECORDED (D4642, #4642). `PATCH
 * /:uid` used to be an unconditional UPDATE: two members who both opened the
 * same entry both saved, and the second silently overwrote the first, with
 * nothing to say who had amended it or what the first member had written. It
 * now follows the same shape D4636 gave a company update:
 *
 *   · the caller may name the record it believes it is editing (`project_uid`),
 *     and a mismatch is refused rather than applied to whatever that uid is;
 *   · the write is conditional on `expected_revision`, so the loser of a race
 *     is refused with `changed_since_open` and handed the row as it now stands,
 *     which preserves the newer accepted work;
 *   · `revision` is bumped, `updated_by` records who, and an append-only row in
 *     `portfolio_support_entry_events` records the transition and the fields
 *     that changed, readable at `GET /:uid/history`;
 *   · every refusal names the entry and its company, so the page can say which
 *     record it is talking about.
 *
 * Mounted at /api/portfolio-support.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canViewLpData } from '../auth';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { investorActiveCompany } from './_investorProjectScope';
import { supportBookIds } from '../services/profileWriteGates';
import { pageFacts, pageWindow } from '../services/listPage';

/** #4647: one page of the ledger. The totals beside it are over the whole scope, never over this. */
const SUPPORT_PAGE = 400;
/** The states an entry can be filtered to, so an outstanding promise stays reachable at any depth. */
const STATES = ['promised', 'delivered', 'withdrawn'] as const;

/** One project's figures over the WHOLE authorized population, read by its own GROUP BY. */
type AggRow = {
  project_id: number; project_uid: string | null; project_name: string | null;
  entries: number; delivered: number; withdrawn: number; promised: number;
  hours: number; entries_without_hours: number;
};

const r = new Hono<{ Bindings: Env }>();

export const SUPPORT_KINDS = new Set(['intro', 'board_prep', 'hiring', 'customer', 'fundraising', 'other']);
export const SUPPORT_STATES = new Set(['promised', 'delivered', 'withdrawn']);

type SupportRow = {
  uid: string; fund_id: number | null; project_id: number;
  kind: string; state: string; hours: number | null;
  promised_at: string | null; delivered_at: string | null; withdrawn_at: string | null;
  summary: string; outcome: string | null;
  recorded_by: number | null; created_at: string; updated_at: string;
  /** D4642: bumped by every amendment; the compare-and-swap key. */
  revision?: number | null;
  /** D4642: who made the latest amendment. NULL until one is recorded. */
  updated_by?: number | null;
  project_uid?: string | null; project_name?: string | null;
};

/**
 * D4642: the revision a client must send back to amend an entry. A row written
 * before the migration reads 1, which is what its first read reports, so a
 * client that round-trips the value it was given always matches.
 */
const revisionOf = (row: SupportRow): number => {
  const n = Number(row.revision);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
};

/** The amendable fields, and how to read each one off a PATCH body. */
const AMENDABLE = ['hours', 'outcome', 'summary', 'delivered_at'] as const;

/** YYYY-MM-DD or null. A malformed date is dropped rather than stored. */
function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const [yStr, mStr, dStr] = s.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;

  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d ? s : null;
}

/**
 * Hours, or null.
 *
 * `''` and a non-number are null — NOT zero. Zero is a real answer ("I said I
 * would and it took no time"), and defaulting an unfilled field to it would
 * make an unrecorded duration indistinguishable from a measured one.
 */
function hoursOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The caller's accessible project set, or a short-circuit.
 *
 * Returns `{ ids }` where `ids` is null for an operator (no narrowing) or an
 * array. `{ empty: true }` means the caller has an accessible set with nothing
 * in it, which every caller must answer WITHOUT reaching a query.
 */
async function scopeFor(c: any, user: User): Promise<{ ids: number[] | null; empty: boolean }> {
  // D1595 (#3868): the book is services/profileWriteGates.ts' `supportBookIds`, shared with Fill's scope for this table.
  return supportBookIds(c.env, user, await investorActiveCompany(c, user));
}

// GET /api/portfolio-support — the ledger, the per-company rollup, and the
// companies in the book that carry no entry at all.
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const { ids, empty } = await scopeFor(c, user);
    if (empty) {
      return c.json({
        entries: [], companies: [], untouched: [],
        page: { offset: 0, limit: SUPPORT_PAGE, total: 0, matching_total: 0, next_offset: null },
        page_state: 'recorded', filter: { state: null },
        totals_basis: 'all_entries_in_scope',
        totals: {
          delivered: 0, promised: 0, withdrawn: 0, entries: 0,
          hours_recorded: 0, entries_without_hours: 0,
          companies_in_book: 0, companies_supported: 0,
        },
        totals_reason: null,
      });
    }
    const csv = ids == null ? null : ids.join(',');
    // #4647 (D4647): the ledger is a PAGE, and every total is read over the
    // whole authorized population instead of over that page. See the GROUP BY
    // below. `state=` narrows the page so an outstanding promise stays
    // reachable however deep the history is — bound as `? IS NULL OR s.state = ?`,
    // the shape the scope predicate beside it already uses, so no fragment
    // reaches the query text (`check-sql-prepare`).
    const win = pageWindow({ limit: c.req.query('limit'), offset: c.req.query('offset') }, SUPPORT_PAGE);
    const stateFilter = STATES.includes(String(c.req.query('state') || '') as any)
      ? String(c.req.query('state')) : null;

    const [entries, book, agg] = await Promise.all([
      c.env.DB.prepare(
        `SELECT s.uid, s.fund_id, s.project_id, s.kind, s.state, s.hours,
                s.promised_at, s.delivered_at, s.withdrawn_at, s.summary, s.outcome,
                s.recorded_by, s.created_at, s.updated_at,
                -- D4642: the revision a client sends back to amend the row, and
                -- who last amended it. A row from before the migration reads 1.
                s.revision, s.updated_by,
                p.uid AS project_uid, p.name AS project_name
           FROM portfolio_support_entries s
           LEFT JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(s.project_id AS TEXT) || ',') > 0)
            AND (? IS NULL OR s.state = ?)
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT ? OFFSET ?`,
      ).bind(csv, csv, stateFilter, stateFilter, win.limit, win.offset)
        .all<SupportRow>().catch(() => ({ results: [] as SupportRow[] })),
      // The book itself, so "no support at all" is an anti-join over two stored
      // sets rather than an inference from the ledger's silence.
      c.env.DB.prepare(
        `SELECT DISTINCT pp.project_id, pr.uid AS project_uid, pr.name AS project_name
           FROM portfolio_positions pp
           LEFT JOIN projects pr ON pr.id = pp.project_id AND pr.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(pp.project_id AS TEXT) || ',') > 0)`,
      ).bind(csv, csv).all<{ project_id: number; project_uid: string | null; project_name: string | null }>(),
      // #4647: THE LEDGER'S FIGURES, over the whole authorized population.
      //
      // Every total here used to be accumulated from the 400 rows the page
      // returned — `delivered`, `promised`, `withdrawn`, `hours_recorded`,
      // `entries_without_hours`, `companies_supported` and every per-company
      // count. Past 400 entries each of them described the newest 400 while
      // reading as the ledger's own totals, and the entries beyond them could
      // not be reached at all. They are read by their own GROUP BY now, which
      // also means the per-company counts do not move when the reader turns a
      // page. The `state` filter is NOT applied here: a page of outstanding
      // promises must not change what the ledger says it holds.
      c.env.DB.prepare(
        `SELECT s.project_id, p.uid AS project_uid, p.name AS project_name,
                COUNT(*) AS entries,
                SUM(CASE WHEN s.state = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN s.state = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
                SUM(CASE WHEN s.state NOT IN ('delivered','withdrawn') THEN 1 ELSE 0 END) AS promised,
                COALESCE(SUM(CASE WHEN s.hours IS NULL THEN 0 ELSE s.hours END), 0) AS hours,
                SUM(CASE WHEN s.hours IS NULL THEN 1 ELSE 0 END) AS entries_without_hours
           FROM portfolio_support_entries s
           LEFT JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(s.project_id AS TEXT) || ',') > 0)
          GROUP BY s.project_id`,
      ).bind(csv, csv).all<AggRow>().catch(() => ({ results: null })),
    ]);

    const rows = entries.results || [];
    const bookRows = book.results || [];
    // #4647: a failed aggregate read is not zero. `agg.results` is null only
    // when the read itself failed, and the figures then say Unreadable rather
    // than claiming an empty ledger.
    const aggRows = agg.results as AggRow[] | null;

    const byProject = new Map<number, {
      project_id: number; project_uid: string | null; name: string;
      delivered: number; promised: number; withdrawn: number;
      hours: number; entries_without_hours: number; entries: number;
    }>();
    const bump = (pid: number, uid: string | null, name: string | null) => {
      let x = byProject.get(pid);
      if (!x) {
        x = {
          project_id: pid, project_uid: uid || null, name: name || `Startup ${pid}`,
          delivered: 0, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0, entries: 0,
        };
        byProject.set(pid, x);
      }
      return x;
    };
    for (const row of bookRows) bump(Number(row.project_id), row.project_uid, row.project_name);

    let hoursRecorded = 0;
    let withoutHours = 0;
    let entriesTotal = 0;
    const counts = { delivered: 0, promised: 0, withdrawn: 0 } as Record<string, number>;
    for (const a of aggRows || []) {
      const x = bump(Number(a.project_id), a.project_uid ?? null, a.project_name ?? null);
      x.entries = Number(a.entries) || 0;
      x.delivered = Number(a.delivered) || 0;
      x.withdrawn = Number(a.withdrawn) || 0;
      x.promised = Number(a.promised) || 0;
      // An entry with no hours is COUNTED, never summed as zero: the reader is
      // told how much of the total is unmeasured rather than shown a total that
      // silently understates it.
      x.hours = Math.round((Number(a.hours) || 0) * 100) / 100;
      x.entries_without_hours = Number(a.entries_without_hours) || 0;
      entriesTotal += x.entries;
      counts.delivered += x.delivered;
      counts.withdrawn += x.withdrawn;
      counts.promised += x.promised;
      hoursRecorded += Number(a.hours) || 0;
      withoutHours += x.entries_without_hours;
    }

    const companies = [...byProject.values()].sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));
    // "No support at all" is only meaningful for companies the book actually
    // holds. An entry against a project that is not a position (a company the
    // investor supported before investing, say) is a real row and appears in
    // the ledger; it just is not a gap in the book.
    const inBook = new Set(bookRows.map((x) => Number(x.project_id)));
    const untouched = companies.filter((x) => x.entries === 0 && inBook.has(x.project_id))
      .map((x) => ({ project_id: x.project_id, project_uid: x.project_uid, name: x.name }));

    // #4647: the figures are Unreadable, not zero, when their own read failed.
    const unreadable = aggRows == null;
    const matchingEntries = stateFilter === 'delivered' ? counts.delivered
      : stateFilter === 'promised' ? counts.promised
        : stateFilter === 'withdrawn' ? counts.withdrawn : entriesTotal;
    return c.json({
      entries: rows,
      // The page the `entries` above are, and where the next one starts. The
      // ordering ends in `s.id`, which is unique, so a row cannot repeat or
      // fall between two pages as `created_at DESC` alone allowed.
      page: {
        ...pageFacts(win, unreadable ? win.offset + rows.length : matchingEntries, rows.length),
        total: unreadable ? win.offset + rows.length : entriesTotal,
        matching_total: unreadable ? null : matchingEntries,
      },
      page_state: unreadable ? 'unreadable' : 'recorded',
      filter: { state: stateFilter },
      companies,
      untouched,
      // What these figures are over, said rather than assumed: every entry in
      // the caller's authorized population, whatever the page or filter shows.
      totals_basis: 'all_entries_in_scope',
      totals: unreadable ? null : {
        ...counts,
        entries: entriesTotal,
        hours_recorded: Math.round(hoursRecorded * 100) / 100,
        entries_without_hours: withoutHours,
        companies_in_book: inBook.size,
        companies_supported: companies.filter((x) => x.entries > 0 && inBook.has(x.project_id)).length,
      },
      totals_reason: unreadable ? 'Unreadable — the support ledger\'s figures could not be read' : null,
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-support — log support against a company already in the
// caller's accessible book.
r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const { ids, empty } = await scopeFor(c, user);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    const projectUid = body.project_uid ? String(body.project_uid) : '';
    if (!projectUid) return c.json({ detail: 'project_uid required' }, 400);
    const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 2000) : '';
    // An entry with no description is a count, and a count of unnamed favours
    // is not a ledger. The column is NOT NULL for the same reason.
    if (!summary) return c.json({ detail: 'summary required' }, 400);

    const kind = SUPPORT_KINDS.has(String(body.kind)) ? String(body.kind) : 'other';
    // AN UNKNOWN STATE IS REFUSED, NOT COERCED. This read
    // `SUPPORT_STATES.has(String(body.state)) ? String(body.state) : 'promised'`,
    // so a typo — 'delivred' — was silently recorded as a promise and answered
    // 201, while PATCH one handler down refuses the same typo with a 400. Two
    // answers to one question about one vocabulary. Delivered stays a legal
    // state to open in: the log form offers it, and work is often recorded
    // after it is done rather than before.
    const asked = body.state === undefined || body.state === null ? null : String(body.state);
    if (asked !== null && !SUPPORT_STATES.has(asked)) {
      return c.json({ detail: 'state must be promised or delivered' }, 400);
    }
    const state = asked ?? 'promised';
    // Withdrawn is a state an entry REACHES, never one it opens in — a promise
    // that was never made cannot be withdrawn. PATCH owns that transition.
    if (state === 'withdrawn') {
      return c.json({ detail: 'an entry cannot be logged as already withdrawn' }, 400);
    }

    const proj = await c.env.DB.prepare(
      'SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL',
    ).bind(projectUid).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    // THE WRITE GATE. Same accessible set as the read: an investor may record
    // work against a company they can already see and nothing else. `empty`
    // is checked first because an empty set must never fall through to the
    // `ids == null` operator branch.
    if (empty || (ids != null && !ids.includes(Number(proj.id)))) {
      return c.json({ detail: 'Project not found' }, 404);
    }

    const uid = newUid();
    const now = nowIso();
    const delivered = state === 'delivered';
    await c.env.DB.prepare(
      `INSERT INTO portfolio_support_entries
         (uid, fund_id, project_id, kind, state, hours, promised_at, delivered_at,
          summary, outcome, recorded_by, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid, proj.id, kind, state, hoursOrNull(body.hours),
      isoDate(body.promised_at), delivered ? (isoDate(body.delivered_at) || now.slice(0, 10)) : null,
      summary, typeof body.outcome === 'string' ? body.outcome.slice(0, 2000) : null,
      user.id, now, now,
    ).run();

    const row = await c.env.DB.prepare(
      'SELECT * FROM portfolio_support_entries WHERE uid = ?',
    ).bind(uid).first<SupportRow>();
    return c.json({ item: row }, 201);
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/portfolio-support/:uid — deliver, withdraw, or amend an entry.
//
// This is what keeps `state` from freezing. Both destinations stamp their own
// date, so the record says WHEN a promise was kept or retired rather than only
// that it no longer counts as outstanding.
r.patch('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const { ids, empty } = await scopeFor(c, user);
    const existing = await c.env.DB.prepare(
      'SELECT * FROM portfolio_support_entries WHERE uid = ?',
    ).bind(c.req.param('uid')).first<SupportRow>();
    if (!existing) return c.json({ detail: 'Not found' }, 404);
    if (empty || (ids != null && !ids.includes(Number(existing.project_id)))) {
      return c.json({ detail: 'Not found' }, 404);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    // D4642: the record the caller believes it is editing. Optional, because an
    // older client does not send it; when it IS sent and does not match, the
    // amendment is refused rather than applied to whatever that uid resolves
    // to. A stale list in one tab must not edit another company's entry.
    const meantFor = body.project_uid === undefined ? null : String(body.project_uid);
    const company = await c.env.DB.prepare(
      'SELECT uid, name FROM projects WHERE id = ?',
    ).bind(existing.project_id).first<{ uid: string | null; name: string | null }>();
    const names = { entry_uid: existing.uid, project_uid: company?.uid ?? null, project_name: company?.name ?? null };
    if (meantFor !== null && meantFor !== (company?.uid ?? null)) {
      return c.json({
        code: 'record_mismatch',
        detail: 'That entry belongs to a different company. Reload the ledger and try again.',
        ...names,
      }, 409);
    }

    const asked = body.state === undefined ? null : String(body.state);
    if (asked !== null && !SUPPORT_STATES.has(asked)) {
      return c.json({ detail: 'state must be promised, delivered or withdrawn' }, 400);
    }

    // D4642: the compare-and-swap key. A client that read revision N sends it
    // back; if the row has moved on, the amendment is refused and the caller is
    // handed the row as it now stands, so the newer accepted work survives and
    // the member can re-apply their edit to it.
    //
    // This is checked BEFORE the terminal-state rule on purpose. When a
    // colleague has just delivered the entry, both refusals are true, but
    // "someone else changed this since you opened it, here is their work" is
    // the one that explains why the state is now terminal; answering
    // `state_is_terminal` would describe the symptom and hide the cause.
    const current = revisionOf(existing);
    const expected = body.expected_revision === undefined ? null : Number(body.expected_revision);
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) {
      return c.json({ detail: 'expected_revision must be a positive integer' }, 400);
    }
    if (expected !== null && expected !== current) {
      const fresh = await c.env.DB.prepare(
        'SELECT * FROM portfolio_support_entries WHERE uid = ?',
      ).bind(existing.uid).first<SupportRow>();
      return c.json({
        code: 'changed_since_open',
        detail: 'Someone else changed this entry since you opened it. Its current state is shown; apply your change again if it still applies.',
        ...names,
        expected_revision: expected,
        revision: current,
        item: fresh,
      }, 409);
    }

    // Delivered and withdrawn are terminal. Re-opening one would let a kept
    // promise be quietly un-kept, which is the audit this ledger exists to
    // survive. D4642: the refusal now names the record, so a page showing many
    // entries can say which one it is talking about, and says what a member
    // CAN still do, because amending a terminal entry is allowed.
    if (asked !== null && asked !== existing.state && existing.state !== 'promised') {
      return c.json({
        code: 'state_is_terminal',
        detail: `This entry is already ${existing.state}, so its state cannot change. Its hours, outcome and description can still be amended.`,
        ...names,
        state: existing.state,
      }, 409);
    }

    const state = asked ?? existing.state;
    const now = nowIso();
    const day = now.slice(0, 10);
    // D4642: only the TRANSITION stamps its own date. An entry that is already
    // delivered with no recorded date keeps none unless a date is supplied:
    // back-stamping today onto an amendment would claim a delivery date the
    // store never had, on a delivery that happened at some other time.
    const moving = asked !== null && asked !== existing.state;
    const deliveredAt = state === 'delivered'
      ? (existing.delivered_at || isoDate(body.delivered_at) || (moving ? day : null))
      : existing.delivered_at;
    const withdrawnAt = state === 'withdrawn'
      ? (existing.withdrawn_at || (moving ? day : null))
      : existing.withdrawn_at;
    const hours = body.hours === undefined ? existing.hours : hoursOrNull(body.hours);
    const outcome = body.outcome === undefined
      ? existing.outcome
      : (typeof body.outcome === 'string' ? body.outcome.slice(0, 2000) : null);
    // An empty summary keeps the stored one: migration 237 makes it NOT NULL
    // because an entry with no description is a count, not a ledger line.
    const summary = typeof body.summary === 'string' && body.summary.trim()
      ? body.summary.trim().slice(0, 2000)
      : existing.summary;

    // What this amendment changed, for the history row. A field the caller did
    // not send, or sent unchanged, is not recorded as a change.
    const changed = AMENDABLE.filter((field) => {
      if (body[field] === undefined && !(field === 'delivered_at' && deliveredAt !== existing.delivered_at)) return false;
      if (field === 'hours') return hours !== existing.hours;
      if (field === 'outcome') return outcome !== existing.outcome;
      if (field === 'summary') return summary !== existing.summary;
      return deliveredAt !== existing.delivered_at;
    });
    const moved = state !== existing.state;
    if (!moved && changed.length === 0) {
      // Nothing to apply. Answering 200 with the row keeps a double-click or a
      // replayed request from bumping the revision and writing a history row
      // that records no change.
      return c.json({ item: existing, revision: current, unchanged: true });
    }

    const nextRevision = current + 1;
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE portfolio_support_entries
            SET state = ?, hours = ?, outcome = ?, summary = ?,
                delivered_at = ?, withdrawn_at = ?, updated_at = ?,
                revision = ?, updated_by = ?
          WHERE uid = ? AND revision = ?`,
      ).bind(state, hours, outcome, summary, deliveredAt, withdrawnAt, now,
        nextRevision, user.id, existing.uid, current),
      // The history row is written by the same batch, from the row the UPDATE
      // just wrote: its SELECT matches on the revision the UPDATE produced AND
      // on this request's own `updated_at` and `updated_by`, so it cannot fire
      // off another writer's amendment. Matching the revision alone was not
      // enough — a writer that lands between the read and the UPDATE bumps the
      // row to that same revision, the conditional UPDATE above is then refused,
      // and a predicate of `revision = nextRevision` would still have found
      // their row and recorded this request's rejected change as history.
      // (entry_id, revision) is unique on top of that, so the history can never
      // hold two amendments for one revision.
      c.env.DB.prepare(
        `INSERT INTO portfolio_support_entry_events
           (uid, entry_id, revision, action, from_state, to_state, changed_json, actor_user_id, created_at)
         SELECT ?, id, ?, ?, ?, ?, ?, ?, ? FROM portfolio_support_entries
          WHERE uid = ? AND revision = ? AND updated_at = ? AND updated_by = ?`,
      ).bind(newUid(), nextRevision, moved ? state : 'amended',
        moved ? existing.state : null, moved ? state : null,
        JSON.stringify(changed), user.id, now, existing.uid, nextRevision, now, user.id),
    ]);
    if (results.some((result) => !result.success)) throw new Error('Support amendment batch failed');
    // The guard did not match: another writer landed between the read and the
    // UPDATE. Same answer as a stale `expected_revision`, read back from D1
    // rather than inferred from the statement having run.
    if (results[0].meta.changes !== 1) {
      const fresh = await c.env.DB.prepare(
        'SELECT * FROM portfolio_support_entries WHERE uid = ?',
      ).bind(existing.uid).first<SupportRow>();
      return c.json({
        code: 'changed_since_open',
        detail: 'Someone else changed this entry while this change was being saved. Its current state is shown; apply your change again if it still applies.',
        ...names,
        expected_revision: current,
        revision: fresh ? revisionOf(fresh) : current,
        item: fresh,
      }, 409);
    }

    const row = await c.env.DB.prepare(
      'SELECT * FROM portfolio_support_entries WHERE uid = ?',
    ).bind(existing.uid).first<SupportRow>();
    return c.json({ item: row, revision: row ? revisionOf(row) : nextRevision, ...names });
  } catch (e) { return mapError(c, e); }
});

/**
 * GET /api/portfolio-support/:uid/history — the entry's amendments, oldest
 * first (D4642). Scoped exactly like the read and the amendment: an entry
 * outside the caller's book is Not found, not an empty history.
 */
r.get('/:uid/history', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const { ids, empty } = await scopeFor(c, user);
    const existing = await c.env.DB.prepare(
      'SELECT id, uid, project_id, state, revision FROM portfolio_support_entries WHERE uid = ?',
    ).bind(c.req.param('uid')).first<SupportRow & { id: number }>();
    if (!existing) return c.json({ detail: 'Not found' }, 404);
    if (empty || (ids != null && !ids.includes(Number(existing.project_id)))) {
      return c.json({ detail: 'Not found' }, 404);
    }
    const events = await c.env.DB.prepare(
      `SELECT e.uid, e.revision, e.action, e.from_state, e.to_state, e.changed_json,
              e.actor_user_id, u.name AS actor_name, e.created_at
         FROM portfolio_support_entry_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.entry_id = ? ORDER BY e.revision`,
    ).bind(existing.id).all<any>();
    return c.json({
      entry_uid: existing.uid,
      revision: revisionOf(existing),
      items: (events.results || []).map((row) => ({
        uid: row.uid,
        revision: Number(row.revision),
        action: row.action,
        from_state: row.from_state ?? null,
        to_state: row.to_state ?? null,
        changed: ((): string[] => { try { return JSON.parse(row.changed_json) || []; } catch { return []; } })(),
        actor: { id: Number(row.actor_user_id), name: row.actor_name ?? null },
        created_at: row.created_at,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

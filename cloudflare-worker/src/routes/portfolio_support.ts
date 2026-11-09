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
 * THE PAGE NARROWS WHAT IS LISTED, NEVER WHAT IS COUNTED (D4647, #4647).
 * `totals`, the per-company rollup and `untouched` were accumulated from the
 * 400 rows the read listed — there was no COUNT(*) in this file — so a book
 * with more entries than one page silently understated every figure, on the
 * one desk whose stated purpose is to make that work auditable. They are
 * grouped in SQL over the whole authorized population now, and ignore both
 * `?before=` and `?state=`. The order is `created_at DESC, id DESC`, because
 * `created_at` is a second-resolution stamp and a batch written in one request
 * ties; the cursor is an entry's own id, never an offset, which shifts under
 * every write. `?state=` narrows the listing in SQL, so an outstanding promise
 * older than the newest page is still reachable — a promise nobody can page to
 * is the defect below with a different cause.
 *
 * Mounted at /api/portfolio-support.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canViewLpData } from '../auth';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { investorActiveCompany } from './_investorProjectScope';
import { supportBookIds } from '../services/profileWriteGates';

const r = new Hono<{ Bindings: Env }>();

export const SUPPORT_KINDS = new Set(['intro', 'board_prep', 'hiring', 'customer', 'fundraising', 'other']);
export const SUPPORT_STATES = new Set(['promised', 'delivered', 'withdrawn']);

type SupportRow = {
  uid: string; fund_id: number | null; project_id: number;
  kind: string; state: string; hours: number | null;
  promised_at: string | null; delivered_at: string | null; withdrawn_at: string | null;
  summary: string; outcome: string | null;
  recorded_by: number | null; created_at: string; updated_at: string;
  project_uid?: string | null; project_name?: string | null;
};

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

/**
 * D4647 (#4647) — the page's cursor and how wide it may be.
 *
 * `before` is an entry's own `id`, not an offset: an offset page shifts under
 * every write, so a reader paging back could miss a row or see one twice.
 * `state` narrows the ledger in SQL rather than in the page, so an
 * outstanding promise older than the newest page is still reachable — the
 * defect this route's own header says it exists to end was a status that
 * "reads outstanding forever", and a promise nobody can page to is the same
 * defect with a different cause.
 */
const PAGE_DEFAULT = 400;
const PAGE_MAX = 400;
function pageOf(c: { req: { query: (k: string) => string | undefined } }) {
  const raw = c.req.query('limit');
  const asked = raw == null || raw === '' ? PAGE_DEFAULT : Number(raw);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, PAGE_MAX) : PAGE_DEFAULT;
  const beforeRaw = c.req.query('before');
  const before = beforeRaw != null && /^[0-9]{1,18}$/.test(beforeRaw) ? Number(beforeRaw) : null;
  const stateRaw = c.req.query('state');
  const state = stateRaw && SUPPORT_STATES.has(stateRaw) ? stateRaw : null;
  return { limit, before, state, stateAsked: stateRaw ?? null };
}

/** The zeros the empty-scope answer and a book with no entry both report. */
const NO_TOTALS = {
  delivered: 0, promised: 0, withdrawn: 0,
  hours_recorded: 0, entries_without_hours: 0,
  companies_in_book: 0, companies_supported: 0,
  entries_total: 0,
};

// GET /api/portfolio-support — the ledger as one page, the per-company rollup
// and the totals over the WHOLE authorized population, and the companies in
// the book that carry no entry at all.
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const { ids, empty } = await scopeFor(c, user);
    const page = pageOf(c);
    if (page.stateAsked != null && page.state == null) return c.json({ detail: 'state must be promised, delivered or withdrawn' }, 400);
    if (empty) {
      return c.json({
        entries: [], companies: [], untouched: [], totals: { ...NO_TOTALS },
        page: { limit: page.limit, state: page.state, returned: 0, has_more: false, next_before: null },
      });
    }
    const csv = ids == null ? null : ids.join(',');

    const [entries, rollup, book] = await Promise.all([
      // D4647: one page, ordered by id so the order is total — `created_at` is
      // a second-resolution stamp, so a batch written in one request ties — and
      // `limit + 1` read so `has_more` is answered without a second count.
      c.env.DB.prepare(
        `SELECT s.id, s.uid, s.fund_id, s.project_id, s.kind, s.state, s.hours,
                s.promised_at, s.delivered_at, s.withdrawn_at, s.summary, s.outcome,
                s.recorded_by, s.created_at, s.updated_at,
                p.uid AS project_uid, p.name AS project_name
           FROM portfolio_support_entries s
           LEFT JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(s.project_id AS TEXT) || ',') > 0)
            AND (? IS NULL OR s.id < ?)
            AND (? IS NULL OR s.state = ?)
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT ?`,
      ).bind(csv, csv, page.before, page.before, page.state, page.state, page.limit + 1)
        .all<SupportRow & { id: number }>().catch(() => ({ results: [] as Array<SupportRow & { id: number }> })),
      // D4647: every total and every per-company figure is grouped in SQL over
      // the WHOLE authorized population. They were accumulated from the page,
      // so a book with more entries than one page under-reported every one of
      // them — a ledger that silently understates the work it exists to make
      // auditable. The page narrows what is LISTED, never what is COUNTED, so
      // the rollup ignores `before` and `state`.
      c.env.DB.prepare(
        `SELECT s.project_id,
                COUNT(*) AS entries,
                COALESCE(SUM(CASE WHEN s.state = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
                COALESCE(SUM(CASE WHEN s.state = 'withdrawn' THEN 1 ELSE 0 END), 0) AS withdrawn,
                COALESCE(SUM(CASE WHEN s.state NOT IN ('delivered', 'withdrawn') THEN 1 ELSE 0 END), 0) AS promised,
                COALESCE(SUM(CASE WHEN s.hours IS NULL THEN 1 ELSE 0 END), 0) AS entries_without_hours,
                COALESCE(SUM(CASE WHEN s.hours IS NULL THEN 0 ELSE s.hours END), 0) AS hours,
                p.uid AS project_uid, p.name AS project_name
           FROM portfolio_support_entries s
           LEFT JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(s.project_id AS TEXT) || ',') > 0)
          GROUP BY s.project_id`,
      ).bind(csv, csv).all<{
        project_id: number; entries: number; delivered: number; withdrawn: number; promised: number;
        entries_without_hours: number; hours: number; project_uid: string | null; project_name: string | null;
      }>().catch(() => ({ results: [] as never[] })),
      // The book itself, so "no support at all" is an anti-join over two stored
      // sets rather than an inference from the ledger's silence.
      c.env.DB.prepare(
        `SELECT DISTINCT pp.project_id, pr.uid AS project_uid, pr.name AS project_name
           FROM portfolio_positions pp
           LEFT JOIN projects pr ON pr.id = pp.project_id AND pr.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(pp.project_id AS TEXT) || ',') > 0)`,
      ).bind(csv, csv).all<{ project_id: number; project_uid: string | null; project_name: string | null }>(),
    ]);

    const read = entries.results || [];
    const hasMore = read.length > page.limit;
    const rows = hasMore ? read.slice(0, page.limit) : read;
    const bookRows = book.results || [];
    const rollupRows = rollup.results || [];

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
    for (const g of rollupRows) {
      const x = bump(Number(g.project_id), g.project_uid ?? null, g.project_name ?? null);
      x.entries += Number(g.entries);
      x.delivered += Number(g.delivered);
      x.withdrawn += Number(g.withdrawn);
      x.promised += Number(g.promised);
      // An entry with no hours is COUNTED, never summed as zero: the reader is
      // told how much of the total is unmeasured rather than shown a total that
      // silently understates it.
      x.entries_without_hours += Number(g.entries_without_hours);
      x.hours += Number(g.hours);
      counts.delivered += Number(g.delivered);
      counts.withdrawn += Number(g.withdrawn);
      counts.promised += Number(g.promised);
      withoutHours += Number(g.entries_without_hours);
      hoursRecorded += Number(g.hours);
      entriesTotal += Number(g.entries);
    }

    const companies = [...byProject.values()].sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));
    // "No support at all" is only meaningful for companies the book actually
    // holds. An entry against a project that is not a position (a company the
    // investor supported before investing, say) is a real row and appears in
    // the ledger; it just is not a gap in the book.
    const inBook = new Set(bookRows.map((x) => Number(x.project_id)));
    const untouched = companies.filter((x) => x.entries === 0 && inBook.has(x.project_id))
      .map((x) => ({ project_id: x.project_id, project_uid: x.project_uid, name: x.name }));

    return c.json({
      entries: rows,
      companies,
      untouched,
      totals: {
        ...counts,
        hours_recorded: Math.round(hoursRecorded * 100) / 100,
        entries_without_hours: withoutHours,
        companies_in_book: inBook.size,
        companies_supported: companies.filter((x) => x.entries > 0 && inBook.has(x.project_id)).length,
        entries_total: entriesTotal,
      },
      // What this page is, beside what the totals count. `next_before` is the
      // last listed entry's id: pass it back to read the page before it.
      page: {
        limit: page.limit, state: page.state, returned: rows.length, has_more: hasMore,
        next_before: hasMore && rows.length ? Number(rows[rows.length - 1].id) : null,
      },
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
    const asked = body.state === undefined ? null : String(body.state);
    if (asked !== null && !SUPPORT_STATES.has(asked)) {
      return c.json({ detail: 'state must be promised, delivered or withdrawn' }, 400);
    }
    // Delivered and withdrawn are terminal. Re-opening one would let a kept
    // promise be quietly un-kept, which is the audit this ledger exists to
    // survive.
    if (asked !== null && asked !== existing.state && existing.state !== 'promised') {
      return c.json({ detail: `an entry already ${existing.state} cannot change state` }, 409);
    }

    const state = asked ?? existing.state;
    const now = nowIso();
    const day = now.slice(0, 10);
    const deliveredAt = state === 'delivered'
      ? (existing.delivered_at || isoDate(body.delivered_at) || day)
      : existing.delivered_at;
    const withdrawnAt = state === 'withdrawn'
      ? (existing.withdrawn_at || day)
      : existing.withdrawn_at;

    await c.env.DB.prepare(
      `UPDATE portfolio_support_entries
          SET state = ?, hours = ?, outcome = ?, summary = ?,
              delivered_at = ?, withdrawn_at = ?, updated_at = ?
        WHERE uid = ?`,
    ).bind(
      state,
      body.hours === undefined ? existing.hours : hoursOrNull(body.hours),
      body.outcome === undefined ? existing.outcome : (typeof body.outcome === 'string' ? body.outcome.slice(0, 2000) : null),
      typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, 2000) : existing.summary,
      deliveredAt, withdrawnAt, now, existing.uid,
    ).run();

    const row = await c.env.DB.prepare(
      'SELECT * FROM portfolio_support_entries WHERE uid = ?',
    ).bind(existing.uid).first<SupportRow>();
    return c.json({ item: row });
  } catch (e) { return mapError(c, e); }
});

export default r;

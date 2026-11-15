/**
 * D6227 (#6227) — one joined activity read for a portfolio company:
 * `GET /api/positions/:projectUid/activity`.
 *
 * WHAT IT IS. The company workspace's Activity tab (Portfolio v2 PF-06e,
 * D4817 part 6) listed each source's own history side by side, because no read
 * joined them and D4817 said not to fabricate one. This is that read. It merges,
 * newest first, one company's:
 *
 *   investments    its rounds (`portfolio_positions`)
 *   marks          its valuation marks (`portfolio_marks`)
 *   distributions  its realisations (`portfolio_distributions`)
 *   reports        each report revision the caller received as an investor
 *                  (`portfolio_updates` × `update_recipients`): revision 1 is
 *                  "received", a later one "corrected"
 *   requests       the caller's OWN asks and waivers (`reporting_events`,
 *                  `event IN ('asked','waived')`, `actor_user_id = caller`, on
 *                  a period of a duty the caller holds)
 *   support        the support ledger's entries for the company (promised,
 *                  delivered, withdrawn) and each entry's recorded amendments
 *                  (`portfolio_support_entry_events`)
 *
 * Each row: `{ id, kind, at, date, label, source, link, amount? }`. `id` is
 * `<kind>:<uid>` and unique; `link` is the workspace tab that holds the record.
 *
 * WHO. Admission is exactly `GET /api/positions/:projectUid`'s (D1057, D4636
 * parts 2 to 4, through `positionScope`): 403 with neither the licence nor a
 * fund, 404 for no such company, 403 for a company outside the caller's scope.
 * A company reached only as GP of record reads its funds' rounds, marks and
 * distributions (and the firm-level marks), as the detail read does. Reports
 * and requests are the caller's own by construction. Support is read under the
 * ledger's own scope (`supportBookIds`, which needs `canViewLpData`); a caller
 * outside it gets that source as `not_in_scope`, never as an empty list.
 *
 * NEVER ANOTHER INVESTOR. No row carries a user id, a recorder, an actor or a
 * name. Another holder's ask or waiver, and a report sent only to another
 * investor, are not read at all.
 *
 * A SOURCE THAT FAILS IS REPORTED, never dropped and never an empty list
 * (#5847). Each source's query is caught on its own and answered in
 * `sources[]` as `{ source, state: 'failed', reason }`; the rows of the other
 * sources still come back, and `partial` is true. The raw database error is
 * never returned.
 *
 * PAGES. Ordered by `at` DESC, then `id` DESC, a total order over unique ids,
 * so a page boundary is stable. `?limit=` (1–200, default 50) and `?before=`,
 * the `next_cursor` of the previous page (base64url of `at` and `id`). A
 * cursor that does not decode is a 400. Per-company volumes are small, so the
 * merge is done here, after each source's own bound query.
 *
 * Mounted at /api/positions, ahead of `positions.ts`' router (`before`), so it
 * sits inside the same STUDIO_PREFIXES gate and no `/:projectUid` handler there
 * can shadow it. Every statement is bound.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, canViewLpData } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { investorActiveCompany } from './_investorProjectScope';
import { supportBookIds, inSupportBook } from '../services/profileWriteGates';
import { KIND_WORDS, type Kind } from '../services/reportingDuties';
import positions, { positionScope } from './positions';
import type { RouteMount } from '../util/routeRegistry';

const r = new Hono<{ Bindings: Env }>();

export const ACTIVITY_PAGE_MAX = 200;
export const ACTIVITY_PAGE_DEFAULT = 50;

/** The sources, in the order `sources[]` lists them. */
export const ACTIVITY_SOURCES = ['investments', 'marks', 'distributions', 'reports', 'requests', 'support'] as const;
type Source = typeof ACTIVITY_SOURCES[number];

const SOURCE_WORDS: Record<Source, string> = {
  investments: 'Investments',
  marks: 'Valuation marks',
  distributions: 'Distributions',
  reports: 'Reports received',
  requests: 'Your asks and waivers',
  support: 'Support',
};

type Tab = 'financials' | 'reports' | 'support';
type Item = {
  id: string; kind: string; at: string; date: string | null; label: string;
  source: Source; link: { tab: Tab; href: string }; amount?: number | null;
};
type SourceState =
  | { source: Source; state: 'ok'; count: number }
  | { source: Source; state: 'failed'; reason: string }
  | { source: Source; state: 'not_in_scope'; reason: string };

const BASIS_WORDS: Record<string, string> = {
  round_price: 'round price', secondary: 'secondary', gp_estimate: 'GP estimate', write_down: 'write-down', cost: 'cost',
};
const DIST_WORDS: Record<string, string> = { exit: 'exit', secondary: 'secondary', dividend: 'dividend', recapitalization: 'recapitalisation' };

/** A sortable instant: SQLite's `YYYY-MM-DD HH:MM:SS` and ISO strings line up once the space is a `T`. */
const sortKey = (v: unknown): string => (v == null ? '' : String(v).trim().replace(' ', 'T'));
const dayOf = (v: unknown): string | null => {
  const s = sortKey(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const amountOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clip = (s: unknown, n = 120): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The `?before=` cursor: base64url of `at` NUL `id`. */
export function encodeCursor(at: string, id: string): string {
  const bytes = new TextEncoder().encode(`${at}\u0000${id}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(raw: string): { at: string; id: string } | null {
  if (!/^[A-Za-z0-9_-]{4,400}$/.test(raw)) return null;
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4));
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
    const cut = text.indexOf('\u0000');
    if (cut < 0) return null;
    const at = text.slice(0, cut);
    const id = text.slice(cut + 1);
    if (!/^[0-9T:.+Z-]{0,40}$/.test(at) || !/^[a-z_]+:[A-Za-z0-9_.:-]{1,160}$/.test(id)) return null;
    return { at, id };
  } catch { return null; }
}

/** Newest first; one instant is broken by id, so the order is total. */
export const byNewest = (a: Item, b: Item) => (a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1);
/** Whether `x` sorts strictly after the cursor row. */
const afterCursor = (x: Item, c: { at: string; id: string }) => x.at < c.at || (x.at === c.at && x.id < c.id);

r.get('/:projectUid/activity', async (c) => {
  try {
    const user = await requireAuth(c);
    c.header('Cache-Control', 'no-store');
    // Admission: GET /api/positions/:projectUid's, step for step.
    const scope = await positionScope(c, user);
    if (!scope) return c.json({ detail: 'Forbidden' }, 403);
    const proj = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number; uid: string; name: string }>();
    if (!proj) return c.json({ detail: 'Not found' }, 404);
    const pid = Number(proj.id);
    const asHolder = scope.held == null || scope.held.includes(pid);
    if (!asHolder && !scope.gpOnly.includes(pid)) return c.json({ detail: 'Forbidden' }, 403);
    const fundOnly = asHolder ? null : scope.fundCsv;

    const rawLimit = c.req.query('limit');
    const n = rawLimit == null || rawLimit === '' ? ACTIVITY_PAGE_DEFAULT : Number(rawLimit);
    const limit = Number.isInteger(n) ? Math.min(ACTIVITY_PAGE_MAX, Math.max(1, n)) : ACTIVITY_PAGE_DEFAULT;
    const rawBefore = c.req.query('before');
    const cursor = rawBefore ? decodeCursor(rawBefore) : null;
    if (rawBefore && !cursor) return c.json({ detail: 'before is not a cursor this read gave' }, 400);

    const base = `/portfolio/companies/${encodeURIComponent(proj.uid)}`;
    const link = (tab: Tab) => ({ tab, href: `${base}/${tab}` });
    const me = Number(user.id);
    const DB = c.env.DB;

    // Each source is read on its own. A failed one is answered as failed (#5847).
    const read = async (source: Source, run: () => Promise<Item[]>): Promise<{ items: Item[]; state: SourceState }> => {
      try {
        const items = await run();
        return { items, state: { source, state: 'ok', count: items.length } };
      } catch {
        return { items: [], state: { source, state: 'failed', reason: `Unreadable: ${SOURCE_WORDS[source].toLowerCase()} could not be read. Try again.` } };
      }
    };

    const reads = await Promise.all([
      read('investments', async () => ((await DB.prepare(
        `SELECT uid, round_name, invested_amount, position_date, created_at
           FROM portfolio_positions
          WHERE project_id = ?
            AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)`,
      ).bind(pid, fundOnly, fundOnly).all<any>()).results || []).map((x: any) => {
        const at = sortKey(x.position_date || x.created_at);
        return {
          id: `investment:${x.uid}`, kind: 'investment', at, date: dayOf(at), source: 'investments' as Source,
          label: x.round_name ? `Investment · ${clip(x.round_name, 60)}` : 'Investment', amount: amountOf(x.invested_amount), link: link('financials'),
        };
      })),
      read('marks', async () => ((await DB.prepare(
        `SELECT uid, as_of_date, fmv, event, basis
           FROM portfolio_marks
          WHERE project_id = ?
            AND (? IS NULL OR fund_id IS NULL OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)`,
      ).bind(pid, fundOnly, fundOnly).all<any>()).results || []).map((x: any) => {
        const at = sortKey(x.as_of_date);
        const parts = ['Valuation mark', BASIS_WORDS[x.basis] || null, x.event ? clip(x.event, 60) : null].filter(Boolean);
        return { id: `mark:${x.uid}`, kind: 'mark', at, date: dayOf(at), source: 'marks' as Source, label: parts.join(' · '), amount: amountOf(x.fmv), link: link('financials') };
      })),
      read('distributions', async () => ((await DB.prepare(
        `SELECT uid, distribution_date, amount, kind
           FROM portfolio_distributions
          WHERE project_id = ?
            AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(fund_id AS TEXT) || ',') > 0)`,
      ).bind(pid, fundOnly, fundOnly).all<any>()).results || []).map((x: any) => {
        const at = sortKey(x.distribution_date);
        return {
          id: `distribution:${x.uid}`, kind: 'distribution', at, date: dayOf(at), source: 'distributions' as Source,
          label: DIST_WORDS[x.kind] ? `Distribution · ${DIST_WORDS[x.kind]}` : 'Distribution', amount: amountOf(x.amount), link: link('financials'),
        };
      })),
      // Only a report this caller received as an investor; a report sent to another investor alone is not read.
      read('reports', async () => ((await DB.prepare(
        `SELECT u.uid, u.period, u.revision, u.sent_at
           FROM portfolio_updates u
          WHERE u.project_id = ? AND u.kind = 'report' AND u.sent_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM update_recipients rr WHERE rr.update_id = u.id AND rr.user_id = ? AND rr.audience = 'investor')`,
      ).bind(pid, me).all<any>()).results || []).map((x: any) => {
        const at = sortKey(x.sent_at);
        const corrected = Number(x.revision) > 1;
        const what = x.period ? `${clip(x.period, 24)} report` : 'Report';
        return {
          id: `${corrected ? 'report_corrected' : 'report_received'}:${x.uid}`, kind: corrected ? 'report_corrected' : 'report_received',
          at, date: dayOf(at), source: 'reports' as Source, label: corrected ? `${what} corrected` : `${what} received`, link: link('reports'),
        };
      })),
      // The caller's own asks and waivers, on periods of duties the caller holds. Never another holder's.
      read('requests', async () => ((await DB.prepare(
        `SELECT e.id, e.event, e.created_at, p.period_label, d.kind
           FROM reporting_events e
           JOIN reporting_periods p ON p.id = e.period_id
           JOIN reporting_duties d ON d.id = p.duty_id
          WHERE e.project_id = ? AND e.actor_user_id = ? AND d.holder_user_id = ?
            AND e.event IN ('asked', 'waived')`,
      ).bind(pid, me, me).all<any>()).results || []).map((x: any) => {
        const at = sortKey(x.created_at);
        const what = `${clip(x.period_label, 16)} ${KIND_WORDS[x.kind as Kind] || 'report'}`;
        const asked = x.event === 'asked';
        return {
          id: `${asked ? 'asked' : 'waived'}:${x.id}`, kind: asked ? 'asked' : 'waived', at, date: dayOf(at), source: 'requests' as Source,
          label: asked ? `You asked for the ${what}` : `You waived the ${what}`, link: link('reports'),
        };
      })),
    ]);

    // Support, under the ledger's own scope. Outside it, the source says so; it is not an empty ledger.
    let support: { items: Item[]; state: SourceState };
    const book = canViewLpData(user) ? await supportBookIds(c.env, user, await investorActiveCompany(c, user)).catch(() => undefined) : null;
    if (book === undefined) {
      support = { items: [], state: { source: 'support', state: 'failed', reason: 'Unreadable: support could not be read. Try again.' } };
    } else if (book === null || !inSupportBook(book, pid)) {
      support = { items: [], state: { source: 'support', state: 'not_in_scope', reason: 'Support is read for companies in your investor book.' } };
    } else {
      support = await read('support', async () => {
        const [entries, events] = await Promise.all([
          DB.prepare(
            `SELECT uid, summary, promised_at, delivered_at, withdrawn_at, created_at
               FROM portfolio_support_entries WHERE project_id = ?`,
          ).bind(pid).all<any>(),
          DB.prepare(
            `SELECT e.uid, e.changed_json, e.created_at, s.summary
               FROM portfolio_support_entry_events e
               JOIN portfolio_support_entries s ON s.id = e.entry_id
              WHERE s.project_id = ? AND e.action = 'amended'`,
          ).bind(pid).all<any>(),
        ]);
        const out: Item[] = [];
        const push = (kind: string, uid: string, when: unknown, label: string) => {
          const at = sortKey(when);
          out.push({ id: `${kind}:${uid}`, kind, at, date: dayOf(at), source: 'support', label, link: link('support') });
        };
        for (const s of entries.results || []) {
          const what = clip(s.summary, 80) || 'Support';
          const promised = s.promised_at || s.created_at;
          if (promised) push('support_promised', s.uid, promised, `Support promised: ${what}`);
          if (s.delivered_at) push('support_delivered', s.uid, s.delivered_at, `Support delivered: ${what}`);
          if (s.withdrawn_at) push('support_withdrawn', s.uid, s.withdrawn_at, `Support withdrawn: ${what}`);
        }
        for (const e of events.results || []) {
          let fields: string[] = [];
          try { const v = JSON.parse(e.changed_json); if (Array.isArray(v)) fields = v.map(String).filter((f) => /^[a-z_]{1,32}$/.test(f)); } catch { /* no fields named */ }
          const what = clip(e.summary, 80) || 'Support';
          push('support_amended', e.uid, e.created_at, `Support amended: ${what}${fields.length ? ` (${fields.join(', ').replace(/_/g, ' ')})` : ''}`);
        }
        return out;
      });
    }

    const all = [...reads, support];
    const sources = ACTIVITY_SOURCES.map((s) => all.find((x) => x.state.source === s)!.state);
    const merged = all.flatMap((x) => x.items).sort(byNewest);
    const rest = cursor ? merged.filter((x) => afterCursor(x, cursor)) : merged;
    const items = rest.slice(0, limit);
    const last = items[items.length - 1];
    return c.json({
      project: { uid: proj.uid, name: proj.name },
      items,
      sources,
      partial: sources.some((s) => s.state === 'failed'),
      order: 'newest_first',
      page: {
        limit,
        before: rawBefore || null,
        // Over the sources that answered; a failed source's rows are not counted as none.
        total: merged.length,
        next_cursor: rest.length > items.length && last ? encodeCursor(last.at, last.id) : null,
      },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/positions', router: r, before: [positions] };

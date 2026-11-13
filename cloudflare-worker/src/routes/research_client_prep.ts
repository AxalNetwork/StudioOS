/**
 * Research · Market readings, brief notes and proposal attachments (#4574 part 8, D4574-p8), out of `research.ts`.
 *
 * WHAT THIS IS. The firm's own proposal-prep records at `/api/research/*`:
 * `market-readings` (migration 223), `brief-notes` and `attachments`
 * (migration 222). Each statement is owner-scoped (`WHERE owner_user_id = ?`),
 * a brief note needs a live advisor grant over its project, and an attachment
 * needs the caller's own quote. The zone-draft material that stays in
 * `research.ts` still reads notes and readings for its own prompt.
 *
 * MOVED, NOT REWRITTEN. Every handler below is byte for byte what
 * `research.ts` held, in the same order, which is why this file's router is
 * also called `research`: `git diff --color-moved` shows the block as moved,
 * and the URLs, methods, gates, refusals and response shapes are unchanged.
 *
 * WHERE IT MOUNTS. At `/api/research`, immediately before `research.ts`'s
 * router (`before: [researchRoutes]`), so every middleware that ran ahead of
 * these routes still does. No route in `research.ts`, nor in the routers
 * mounted at `/api/research` ahead of it, matches any of these paths, so
 * mounting them ahead of the rest of `research.ts` changes no precedence
 * (`D4574-p8.md` holds the route inventory before and after).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { catalogPriceCents, proposalName, readingIsStale } from '../services/marketReadingRead';
import type { RouteMount } from '../util/routeRegistry';
import researchRoutes from './research';

const research = new Hono<{ Bindings: Env }>();

const newUid = () => crypto.randomUUID().replace(/-/g, '');

// ---------------------------------------------------------------------------
// Market readings — comparable ranges for the firm's own service lines (223)
// ---------------------------------------------------------------------------
//
// THE ROWS ARE THE CATALOG, joined to the newest reading for each. An offering
// with no reading is the artboard's "never run" row and its `Retainer rate ·
// Not recorded` tile — a fact about the firm's own record, which is why it is
// returned rather than filtered out.

interface ReadingRow {
  id: number; uid: string; owner_user_id: number; offering_id: number | null;
  metric: string; range_low_cents: number; range_high_cents: number;
  comparable_count: number; ran_at: string; scope: string | null;
  created_at: string; updated_at: string;
}

const readingDto = (r: ReadingRow) => ({
  uid: r.uid,
  offering_uid: null as string | null,
  metric: r.metric,
  range_low_cents: r.range_low_cents,
  range_high_cents: r.range_high_cents,
  comparable_count: r.comparable_count,
  ran_at: r.ran_at,
  scope: r.scope,
});

/**
 * Every service line, with the newest reading for it — and every reading that
 * is not for a service line.
 *
 * TWO READS RATHER THAN ONE OUTER JOIN, because the interesting row is the one
 * with nothing on the other side and an outer join makes that row's absence
 * indistinguishable from a row that was never selected. The page needs both
 * halves named.
 */
research.get('/market-readings', async (c) => {
  const user = await requireAuth(c);
  const offerings = await c.env.DB.prepare(
    `SELECT id, uid, title, price_usd, price_cents FROM service_offerings
      WHERE owner_user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 200`
  ).bind(user.id).all<{ id: number; uid: string; title: string; price_usd: number | null; price_cents: number | null }>();
  const readings = await c.env.DB.prepare(
    `SELECT * FROM research_market_readings WHERE owner_user_id = ? ORDER BY ran_at DESC LIMIT 500`
  ).bind(user.id).all<ReadingRow>();

  // Newest first out of the query, so the first one seen per offering is the
  // newest — no comparison, no tie-break, no chance of picking the wrong run.
  const newest = new Map<number, ReadingRow>();
  const loose: ReadingRow[] = [];
  for (const r of readings.results || []) {
    if (r.offering_id == null) { loose.push(r); continue; }
    if (!newest.has(r.offering_id)) newest.set(r.offering_id, r);
  }

  const items = [
    ...(offerings.results || []).map((o) => {
      const r = newest.get(o.id);
      return {
        offering_uid: o.uid,
        metric: o.title,
        // NULL, NOT ZERO, AND THIS IS THE ROW THE ARTBOARD IS ABOUT. A service
        // line nobody has priced the market for reads "Not recorded"; a zero
        // would say the firm looked and found the work is worth nothing.
        ...(r ? { ...readingDto(r), offering_uid: o.uid, metric: o.title } : {
          uid: null, range_low_cents: null, range_high_cents: null,
          comparable_count: null, ran_at: null, scope: null,
        }),
        // The catalog's own price, so the page can say when a service line is
        // unpriced AND unread — the two halves of the same gap. Cents are
        // canonical; a pre-227 row still has only dollars. Neither is folded
        // into the comparable range.
        catalogued: catalogPriceCents(o.price_cents, o.price_usd) != null,
      };
    }),
    ...loose.map((r) => ({ ...readingDto(r), catalogued: false })),
  ];
  return c.json({ items });
});

research.post('/market-readings', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const low = Number(body?.range_low_cents);
  const high = Number(body?.range_high_cents);
  const n = Number(body?.comparable_count);
  const ranAt = String(body?.ran_at || '').trim().slice(0, 32);
  let metric = String(body?.metric || '').trim().slice(0, 200);

  let offeringId: number | null = null;
  if (body?.offering_uid) {
    const o = await c.env.DB.prepare(
      `SELECT id, title FROM service_offerings WHERE uid = ? AND owner_user_id = ?`
    ).bind(String(body.offering_uid), user.id).first<{ id: number; title: string }>();
    if (!o) return c.json({ detail: 'not_found' }, 404);
    offeringId = o.id;
    // The offering's own title, so a reading cannot be filed under a name the
    // catalog does not use — the page joins the two and a second label would be
    // the place they disagree.
    metric = o.title;
  }
  if (!metric) return c.json({ detail: 'metric_required' }, 400);
  // EVERY ONE OF THESE IS REFUSED RATHER THAN DEFAULTED. A range with no
  // comparable count is a number a client will ask about and the firm cannot
  // answer; a range with no run date cannot age, and age is what this zone
  // gates attachment on. `research_benchmarks` refuses a peer figure on exactly
  // these grounds and its schema carries the same CHECK.
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high < low) {
    return c.json({ detail: 'range_required' }, 400);
  }
  if (!Number.isInteger(n) || n < 1) return c.json({ detail: 'comparable_count_required' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ranAt)) return c.json({ detail: 'ran_at_required' }, 400);

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_market_readings
       (uid, owner_user_id, offering_id, metric, range_low_cents, range_high_cents, comparable_count, ran_at, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uid, user.id, offeringId, metric, low, high, n, ranAt,
    body?.scope ? String(body.scope).slice(0, 200) : null).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_market_readings WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<ReadingRow>();
  return c.json({ item: row ? readingDto(row) : null }, 201);
});

/**
 * One reading, for `/research/markets/:uid`.
 *
 * THE LIST KEEPS THE NEWEST PER OFFERING. This read is the row itself, including
 * an older run the list no longer shows. Catalog price comes back beside the
 * range and is not added into it. Attachments carry the need's title when the
 * quote has one, and null when it does not — a quote stores no title of its own.
 */
research.get('/market-readings/:uid', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const row = await c.env.DB.prepare(
    `SELECT r.*, o.uid AS offering_uid, o.price_usd AS price_usd, o.price_cents AS price_cents
       FROM research_market_readings r
       LEFT JOIN service_offerings o ON o.id = r.offering_id AND o.owner_user_id = r.owner_user_id
      WHERE r.uid = ? AND r.owner_user_id = ?`
  ).bind(uid, user.id).first<ReadingRow & {
    offering_uid: string | null; price_usd: number | null; price_cents: number | null;
  }>();
  if (!row) return c.json({ detail: 'not_found' }, 404);

  const attached = await c.env.DB.prepare(
    `SELECT a.uid AS uid, a.quote_id AS quote_id, a.created_at AS created_at, n.title AS need_title
       FROM research_attachments a
       JOIN quotes q ON q.id = a.quote_id
       LEFT JOIN founder_needs n ON n.id = q.need_id
      WHERE a.owner_user_id = ? AND a.kind = 'reading' AND a.ref_key = ?
      ORDER BY a.id DESC LIMIT 50`
  ).bind(user.id, uid).all<{ uid: string; quote_id: number; created_at: string; need_title: string | null }>();

  // Proposals the caller can attach to: quotes their partner record owns.
  // A licence with no partner profile has none, and an admin does not see
  // every firm's quotes from this page.
  const proposals = user.partner_id
    ? await c.env.DB.prepare(
      `SELECT q.id AS id, q.status AS status, n.title AS need_title
         FROM quotes q
         LEFT JOIN founder_needs n ON n.id = q.need_id
        WHERE q.partner_id = ?
        ORDER BY q.created_at DESC LIMIT 100`
    ).bind(user.partner_id).all<{ id: number; status: string; need_title: string | null }>()
    : { results: [] as { id: number; status: string; need_title: string | null }[] };

  return c.json({
    item: {
      ...readingDto(row),
      offering_uid: row.offering_uid ?? null,
      catalog_price_cents: catalogPriceCents(row.price_cents, row.price_usd),
    },
    attachments: (attached.results || []).map((a) => ({
      uid: a.uid,
      quote_id: a.quote_id,
      created_at: a.created_at,
      proposal_name: proposalName(a.need_title),
    })),
    proposals: (proposals.results || []).map((q) => ({
      id: q.id,
      status: q.status,
      proposal_name: proposalName(q.need_title),
    })),
  });
});

research.delete('/market-readings/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_market_readings WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Brief notes — the firm's own half of a client brief (migration 222)
// ---------------------------------------------------------------------------
//
// THE SECOND SOURCE. `ClientPrepZone`'s rows are all `source: 'client'` — the
// founder's record, quoted — so the `pr2` artboard's `Ours only` chip matched
// nothing and `Founder-sourced` matched everything. These are the rows that
// make the axis real, and `open` is the fourth chip: only a note the firm wrote
// can be marked settled, because ticking off a fact the CLIENT recorded would
// be editing someone else's record.

interface BriefNoteRow {
  id: number; uid: string; owner_user_id: number; project_id: number;
  section: string; body: string; open: number; created_at: string; updated_at: string;
}

const noteDto = (r: BriefNoteRow) => ({
  uid: r.uid,
  section: r.section,
  body: r.body,
  open: r.open === 1,
  // The axis the chips filter on. Stated by the route so the page never has to
  // decide what its own rows are — the brief's other rows say `'client'` and
  // these say `'ours'`, and one place decides both.
  source: 'ours' as const,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/**
 * The project a note may be written against: one the caller holds a LIVE grant
 * over.
 *
 * A firm that never held a grant has no business keeping a file on that founder
 * inside this product, and a revoked grant is the founder taking that back —
 * which is why the check is on `status = 'active'` and not merely on the grant
 * having once existed. Returns the project's id, or null.
 */
async function grantedProjectId(c: { env: Env }, userId: number, projectUid: string) {
  const row = await c.env.DB.prepare(
    `SELECT p.id AS id
       FROM advisor_client_grants g
       JOIN projects p ON p.id = g.project_id
      WHERE g.advisor_user_id = ? AND g.status = 'active' AND p.uid = ?
      ORDER BY g.id DESC LIMIT 1`
  ).bind(userId, projectUid).first<{ id: number }>();
  return row?.id ?? null;
}

research.get('/brief-notes', async (c) => {
  const user = await requireAuth(c);
  const projectUid = String(c.req.query('project') || '');
  if (!projectUid) return c.json({ detail: 'project_required' }, 400);
  const projectId = await grantedProjectId(c, user.id, projectUid);
  // NOT FOUND RATHER THAN FORBIDDEN, and deliberately: whether a given founder
  // exists is not something a firm without a grant may learn by probing.
  if (!projectId) return c.json({ detail: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_brief_notes WHERE owner_user_id = ? AND project_id = ? ORDER BY id ASC LIMIT 200`
  ).bind(user.id, projectId).all<BriefNoteRow>();
  return c.json({ items: (rows.results || []).map(noteDto) });
});

research.post('/brief-notes', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const projectUid = String(body?.project || '');
  const section = String(body?.section || '').trim().slice(0, 120);
  const text = String(body?.body || '').trim().slice(0, 4000);
  if (!projectUid || !section || !text) return c.json({ detail: 'section_and_body_required' }, 400);
  const projectId = await grantedProjectId(c, user.id, projectUid);
  if (!projectId) return c.json({ detail: 'not_found' }, 404);

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_brief_notes (uid, owner_user_id, project_id, section, body, open)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(uid, user.id, projectId, section, text, body?.open === false ? 0 : 1).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<BriefNoteRow>();
  return c.json({ item: row ? noteDto(row) : null }, 201);
});

/** Settle a note, or reopen it. The only field the artboard's chips act on. */
research.patch('/brief-notes/:uid', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body?.open !== 'boolean') return c.json({ detail: 'open_required' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE research_brief_notes SET open = ?, updated_at = datetime('now')
      WHERE uid = ? AND owner_user_id = ?`
  ).bind(body.open ? 1 : 0, c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).first<BriefNoteRow>();
  return c.json({ item: row ? noteDto(row) : null });
});

research.delete('/brief-notes/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Attachments — `Attach to proposal`, on two artboards (migration 222)
// ---------------------------------------------------------------------------
//
// The op was `unbuilt:` on both Client prep and Market for the want of an EDGE,
// never for the want of a proposal: `quotes` is live and `api.myQuotes()` reads
// it. One table serves both, keyed by `kind`.

const ATTACH_KINDS = new Set(['brief', 'reading']);

interface AttachmentRow {
  id: number; uid: string; owner_user_id: number; kind: string;
  ref_key: string; quote_id: number; created_at: string;
}

research.get('/attachments', async (c) => {
  const user = await requireAuth(c);
  const kind = String(c.req.query('kind') || '');
  if (!ATTACH_KINDS.has(kind)) return c.json({ detail: 'unknown_kind' }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_attachments WHERE owner_user_id = ? AND kind = ? ORDER BY id DESC LIMIT 500`
  ).bind(user.id, kind).all<AttachmentRow>();
  return c.json({
    items: (rows.results || []).map((r) => ({
      uid: r.uid, kind: r.kind, ref_key: r.ref_key, quote_id: r.quote_id, created_at: r.created_at,
    })),
  });
});

research.post('/attachments', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const kind = String(body?.kind || '');
  const refKey = String(body?.ref_key || '').trim().slice(0, 200);
  const quoteId = Number(body?.quote_id);
  if (!ATTACH_KINDS.has(kind) || !refKey || !Number.isInteger(quoteId)) {
    return c.json({ detail: 'kind_ref_and_quote_required' }, 400);
  }
  // THE QUOTE MUST BE THE CALLER'S OWN. Attaching a market reading to somebody
  // else's proposal would put the firm's reasoning behind a number they did not
  // quote — and would tell them a figure exists that they cannot see.
  //
  // Ownership is `partner_id`. That is the column `POST /needs/:id/quotes`
  // writes. `provider_user_id` is not a column on the live `quotes` table
  // (schema_baseline plus the later ALTERs), so a predicate on it matches
  // nothing and the insert never runs.
  if (!user.partner_id) return c.json({ detail: 'not_found' }, 404);
  const quote = await c.env.DB.prepare(
    `SELECT id FROM quotes WHERE id = ? AND partner_id = ?`
  ).bind(quoteId, user.partner_id).first<{ id: number }>();
  if (!quote) return c.json({ detail: 'not_found' }, 404);

  if (kind === 'reading') {
    const reading = await c.env.DB.prepare(
      `SELECT ran_at FROM research_market_readings WHERE uid = ? AND owner_user_id = ?`
    ).bind(refKey, user.id).first<{ ran_at: string }>();
    if (!reading) return c.json({ detail: 'not_found' }, 404);
    // AGE IS A GATE. A stale reading is blocked from a proposal, not merely
    // labelled. The page hides Attach; this is the same refusal if it is called.
    if (readingIsStale(reading.ran_at)) return c.json({ detail: 'reading_stale' }, 409);
  }

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO research_attachments (uid, owner_user_id, kind, ref_key, quote_id)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(uid, user.id, kind, refKey, quoteId).run();
  // `OR IGNORE` because attaching the same thing to the same proposal twice is
  // not a second fact — the row's own UNIQUE says so — and a 409 here would
  // make a reader think the first attachment had failed.
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_attachments
      WHERE owner_user_id = ? AND kind = ? AND ref_key = ? AND quote_id = ?`
  ).bind(user.id, kind, refKey, quoteId).first<AttachmentRow>();
  return c.json({ item: row ? { uid: row.uid, kind: row.kind, ref_key: row.ref_key, quote_id: row.quote_id, created_at: row.created_at } : null }, 201);
});

research.delete('/attachments/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_attachments WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
});

// Immediately ahead of `research.ts`'s router: after every middleware and every
// router mounted at `/api/research` before it, as these routes were.
export const mount: RouteMount = { path: '/api/research', router: research, before: [researchRoutes] };
export default research;

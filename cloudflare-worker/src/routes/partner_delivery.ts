/**
 * /api/partner/delivery — Health, Deliverables, Capacity and Status reports.
 *
 * The last four of the nine zones, and the ones with the hardest editorial
 * calls in them. Three things this file refuses to do, each for a different
 * reason, and each stated in the response rather than left to the page:
 *
 *   1. HEALTH IS NULL WHEN NOTHING IS RECORDED — never `'on_track'`.
 *      Green-because-empty is the exact failure the zone's old no-store card
 *      warned about: "a pill computed from status alone would rate every live
 *      engagement identically and call it a judgement". Silence is not good
 *      news. `healthFor` in `_partner_workspace_helpers.ts` enforces it and
 *      returns the reasons it did use, so the pill can be explained.
 *
 *   2. THERE IS NO CAPACITY CAP ANYWHERE, so nothing here is "over" anything.
 *      `engagement_hours` records hours; NOTHING records the firm's cap. The
 *      capacity canvas uses a hardcoded `CAP_H = 40`, and adopting that number
 *      would be inventing the firm's cap and then presenting it as a finding.
 *      `cap_hours` comes back null with a reason, and the zone must not colour
 *      a row red against a threshold nobody set. Adding a cap column is a
 *      migration 210 and a separate decision.
 *
 *   3. `opened_at` AND `signed_off_at` ARE THE CLIENT'S TO SET — migration
 *      208:160 is explicit that a partner-side write to either would be the
 *      firm reporting a metric about itself. No route here accepts them, on
 *      create or on patch, and a test sends both and asserts the row is
 *      unchanged. The consequence is real and goes on the page rather than
 *      being hidden: on this build every deliverable reads *Unopened* forever,
 *      and the read says why.
 *
 * UTILISATION IS READ, NOT RECOMPUTED. `/health` imports the same
 * `utilisationFor` that `/api/partner/pipeline/retainers` uses. The Health
 * canvas seam-marks the figure as a read for this reason: two pages disagreeing
 * about one client's utilisation is worse than either number.
 *
 * ONE AUTHZ HOLE IN 208 CLOSED HERE. `engagement_seats.holder_user_id`
 * references `users(id)` with no partner constraint, so the schema alone would
 * let a firm name ANY user in its seat register — including a founder or
 * another firm's staff. `requireOwnHolder` below requires the holder to belong
 * to this firm.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  mapError, newUid, nowIso, requirePartnerProfile, trimOrNull,
} from './_t13t14t15_helpers';
import {
  daysBetween, healthFor, mergePatch, parseHours, parsePeriod,
  requireOwnEngagement, requirePartnerRole, utilisationFor,
} from './_partner_workspace_helpers';

const partnerDelivery = new Hono<{ Bindings: Env }>();

async function actingPartner(c: any): Promise<{ user: User; partnerId: number }> {
  const user = (await requireAuth(c)) as User;
  requirePartnerRole(user);
  const partner = await requirePartnerProfile(c.env, user);
  return { user, partnerId: Number(partner.id) };
}

async function body<T>(c: any): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T;
}

function notFound(what: string): Response {
  return new Response(JSON.stringify({ detail: `${what} not found` }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
}

/** A child row, if its engagement belongs to this partner. 404 otherwise. */
async function ownChild(
  env: Env, partnerId: number, table: 'engagement_milestones' | 'engagement_deliverables'
    | 'engagement_seats' | 'engagement_blockers' | 'engagement_status_reports',
  id: number, what: string,
) {
  // One literal query per table rather than an interpolated name: a `${}` in
  // `DB.prepare` is what `check-sql-prepare.mjs` fails, and the alternative
  // would be a table name assembled at runtime for no gain.
  const sql = {
    engagement_milestones:
      `SELECT m.*, e.partner_id FROM engagement_milestones m
         JOIN engagements e ON e.id = m.engagement_id WHERE m.id = ?`,
    engagement_deliverables:
      `SELECT d.*, e.partner_id FROM engagement_deliverables d
         JOIN engagements e ON e.id = d.engagement_id WHERE d.id = ?`,
    engagement_seats:
      `SELECT s.*, e.partner_id FROM engagement_seats s
         JOIN engagements e ON e.id = s.engagement_id WHERE s.id = ?`,
    engagement_blockers:
      `SELECT b.*, e.partner_id FROM engagement_blockers b
         JOIN engagements e ON e.id = b.engagement_id WHERE b.id = ?`,
    engagement_status_reports:
      `SELECT r.*, e.partner_id FROM engagement_status_reports r
         JOIN engagements e ON e.id = r.engagement_id WHERE r.id = ?`,
  }[table];
  const row = await env.DB.prepare(sql).bind(id).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) throw notFound(what);
  return row;
}

/** The current period label, from the server clock. */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Every engagement with its health, its reasons, and the seam-marked read.
 *
 * Five tables feed one judgement, which is why it is computed here rather than
 * in the page — and why nothing stores it. A stored score would be a second
 * source of truth for something five tables already say, and the first time one
 * of them moved the two would disagree.
 */
partnerDelivery.get('/health', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const period = currentPeriod();

    const engagements = await c.env.DB.prepare(
      `SELECT e.id, e.uid, e.status, e.price, e.founder_id, e.delivered_at, e.cancelled_at,
              n.title AS need_title, f.name AS founder_name,
              r.id AS retainer_id, r.retained_hours, r.shape
         FROM engagements e
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN users f ON f.id = e.founder_id
         LEFT JOIN partner_retainers r ON r.engagement_id = e.id
        WHERE e.partner_id = ?
        ORDER BY e.created_at DESC
        LIMIT 200`,
    ).bind(partnerId).all<any>();

    // Four scoped reads rather than one per engagement — the same join-back-to
    // -owner shape the pipeline reads use, so nothing is interpolated and no
    // row can come back for another firm's engagement.
    const [milestones, blockers, deliverables, usage] = await Promise.all([
      c.env.DB.prepare(
        `SELECT m.engagement_id, m.due_at, m.completed_at
           FROM engagement_milestones m
           JOIN engagements e ON e.id = m.engagement_id
          WHERE e.partner_id = ?`,
      ).bind(partnerId).all<any>(),
      // ALL blockers, cleared included. The rating uses only the open ones;
      // the cleared ones count toward "something has been recorded here",
      // which is a different question — see `HealthInputs.clearedBlockers`.
      c.env.DB.prepare(
        `SELECT b.engagement_id, b.side, b.summary, b.raised_at, b.cleared_at
           FROM engagement_blockers b
           JOIN engagements e ON e.id = b.engagement_id
          WHERE e.partner_id = ?`,
      ).bind(partnerId).all<any>(),
      c.env.DB.prepare(
        `SELECT d.engagement_id, d.sent_at, d.opened_at
           FROM engagement_deliverables d
           JOIN engagements e ON e.id = d.engagement_id
          WHERE e.partner_id = ?`,
      ).bind(partnerId).all<any>(),
      c.env.DB.prepare(
        `SELECT u.retainer_id, u.period, u.hours_used
           FROM retainer_usage u
           JOIN partner_retainers r ON r.id = u.retainer_id
           JOIN engagements e ON e.id = r.engagement_id
          WHERE e.partner_id = ?`,
      ).bind(partnerId).all<any>(),
    ]);

    const by = <T extends { engagement_id: number }>(rows: T[]) => {
      const m = new Map<number, T[]>();
      for (const r of rows) {
        const k = Number(r.engagement_id);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
      }
      return m;
    };
    const msByEng = by(milestones.results || []);
    const blByEng = by(blockers.results || []);
    const dlByEng = by(deliverables.results || []);
    const usageByRetainer = new Map<number, any>();
    for (const u of usage.results || []) {
      if (u.period === period) usageByRetainer.set(Number(u.retainer_id), u);
    }

    let rated = 0;
    const items = (engagements.results || []).map((e: any) => {
      const ms = msByEng.get(Number(e.id)) || [];
      const allBl = blByEng.get(Number(e.id)) || [];
      const bl = allBl.filter((b: any) => !b.cleared_at);
      const dl = dlByEng.get(Number(e.id)) || [];
      // Sent and not opened — the firm's most expensive state.
      const unopened = dl.filter((d: any) => d.sent_at && !d.opened_at).length;

      const u = utilisationFor(
        e.retainer_id
          ? { retained_hours: e.retained_hours === null ? null : Number(e.retained_hours) }
          : null,
        usageByRetainer.get(Number(e.retainer_id)) || null,
      );
      const h = healthFor({
        milestones: ms.map((m: any) => ({ due_at: m.due_at, completed_at: m.completed_at })),
        openBlockers: bl.map((b: any) => ({ side: b.side })),
        clearedBlockers: allBl.length - bl.length,
        unopenedDeliverables: unopened,
        utilisation: u,
      });
      if (h.health) rated += 1;

      return {
        engagement_id: Number(e.id),
        engagement_uid: e.uid,
        status: e.status,
        founder_id: e.founder_id ? Number(e.founder_id) : null,
        founder_name: e.founder_name ?? null,
        need_title: e.need_title ?? null,
        shape: e.shape ?? null,
        milestone_count: ms.length,
        overdue_count: ms.filter(
          (m: any) => !m.completed_at && m.due_at && (daysBetween(m.due_at) ?? -1) > 0,
        ).length,
        open_blockers: bl.map((b: any) => ({
          side: b.side, summary: b.summary, days_open: daysBetween(b.raised_at),
        })),
        deliverables_sent: dl.filter((d: any) => d.sent_at).length,
        deliverables_unopened: unopened,
        // Marked as a READ on the page, and it is one: the same helper the
        // Retainers zone calls, not a second computation of the same ratio.
        utilisation_source: 'pipeline_retainers',
        ...u,
        ...h,
      };
    });

    return c.json({
      items,
      period,
      rated_count: rated,
      // Says how much of the book could be rated at all, so a mostly-green
      // strip cannot be read as a mostly-healthy book when it is really a
      // mostly-empty one.
      unrated_count: items.length - rated,
      unrated_note: items.length - rated
        ? `${items.length - rated} engagement${items.length - rated === 1 ? ' has' : 's have'} nothing recorded — no milestone, blocker, deliverable or retainer — so ${items.length - rated === 1 ? 'it is' : 'they are'} not rated. Silence is not good news.`
        : null,
    });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Milestones and blockers — health's inputs, editable
// ---------------------------------------------------------------------------

partnerDelivery.get('/engagements/:engagementId/milestones', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM engagement_milestones WHERE engagement_id = ? ORDER BY due_at IS NULL, due_at',
    ).bind(engagementId).all<any>();
    return c.json({
      items: (rows.results || []).map((r: any) => ({
        id: Number(r.id), uid: r.uid, title: r.title,
        due_at: r.due_at ?? null, completed_at: r.completed_at ?? null,
        days_overdue: !r.completed_at && r.due_at ? daysBetween(r.due_at) : null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.post('/engagements/:engagementId/milestones', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const b = await body<any>(c);
    const title = trimOrNull(b.title, 200);
    if (!title) return c.json({ detail: 'A milestone needs a title' }, 400);
    const ins = await c.env.DB.prepare(
      `INSERT INTO engagement_milestones (uid, engagement_id, title, due_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), engagementId, title, trimOrNull(b.due_at, 40),
      trimOrNull(b.completed_at, 40), nowIso(), nowIso(),
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM engagement_milestones WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json({
      id: Number(row.id), uid: row.uid, title: row.title,
      due_at: row.due_at ?? null, completed_at: row.completed_at ?? null,
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.patch('/milestones/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_milestones', id, 'Milestone');
    const b = await body<any>(c);
    const merged = mergePatch(row, b, ['title', 'due_at', 'completed_at']);
    const title = trimOrNull(merged.title, 200);
    if (!title) return c.json({ detail: 'A milestone needs a title' }, 400);
    await c.env.DB.prepare(
      `UPDATE engagement_milestones SET title = ?, due_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      title, trimOrNull(merged.due_at, 40), trimOrNull(merged.completed_at, 40), nowIso(), id,
    ).run();
    const out = await c.env.DB.prepare('SELECT * FROM engagement_milestones WHERE id = ?')
      .bind(id).first<any>();
    return c.json({
      id: Number(out.id), uid: out.uid, title: out.title,
      due_at: out.due_at ?? null, completed_at: out.completed_at ?? null,
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.delete('/milestones/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownChild(c.env, partnerId, 'engagement_milestones', id, 'Milestone');
    await c.env.DB.prepare('DELETE FROM engagement_milestones WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

const SIDES = ['ours', 'client'];

partnerDelivery.get('/engagements/:engagementId/blockers', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM engagement_blockers WHERE engagement_id = ?
        ORDER BY cleared_at IS NOT NULL, raised_at DESC`,
    ).bind(engagementId).all<any>();
    return c.json({
      items: (rows.results || []).map((r: any) => ({
        id: Number(r.id), uid: r.uid, side: r.side, summary: r.summary,
        raised_at: r.raised_at, cleared_at: r.cleared_at ?? null,
        days_open: r.cleared_at ? null : daysBetween(r.raised_at),
      })),
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.post('/engagements/:engagementId/blockers', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const b = await body<any>(c);
    const summary = trimOrNull(b.summary, 600);
    if (!summary) return c.json({ detail: 'Say what the blocker is' }, 400);
    // `side` is the column the zone's editorial point rests on. A blockers
    // table with no side would make every delay the firm's.
    const side = b.side === undefined ? 'ours' : String(b.side);
    if (!SIDES.includes(side)) return c.json({ detail: "Side must be 'ours' or 'client'" }, 400);
    const ins = await c.env.DB.prepare(
      `INSERT INTO engagement_blockers (uid, engagement_id, side, summary, raised_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newUid(), engagementId, side, summary, nowIso(), nowIso(), nowIso()).run();
    const row = await c.env.DB.prepare('SELECT * FROM engagement_blockers WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json({
      id: Number(row.id), uid: row.uid, side: row.side, summary: row.summary,
      raised_at: row.raised_at, cleared_at: null,
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.patch('/blockers/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_blockers', id, 'Blocker');
    const b = await body<any>(c);
    const merged = mergePatch(row, b, ['side', 'summary', 'cleared_at']);
    const summary = trimOrNull(merged.summary, 600);
    if (!summary) return c.json({ detail: 'Say what the blocker is' }, 400);
    if (!SIDES.includes(String(merged.side))) {
      return c.json({ detail: "Side must be 'ours' or 'client'" }, 400);
    }
    await c.env.DB.prepare(
      'UPDATE engagement_blockers SET side = ?, summary = ?, cleared_at = ?, updated_at = ? WHERE id = ?',
    ).bind(String(merged.side), summary, trimOrNull(merged.cleared_at, 40), nowIso(), id).run();
    const out = await c.env.DB.prepare('SELECT * FROM engagement_blockers WHERE id = ?')
      .bind(id).first<any>();
    return c.json({
      id: Number(out.id), uid: out.uid, side: out.side, summary: out.summary,
      raised_at: out.raised_at, cleared_at: out.cleared_at ?? null,
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.delete('/blockers/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownChild(c.env, partnerId, 'engagement_blockers', id, 'Blocker');
    await c.env.DB.prepare('DELETE FROM engagement_blockers WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

function deliverableDto(r: any) {
  return {
    id: Number(r.id),
    uid: r.uid,
    engagement_id: Number(r.engagement_id),
    engagement_uid: r.engagement_uid ?? null,
    need_title: r.need_title ?? null,
    founder_name: r.founder_name ?? null,
    title: r.title,
    version: r.version ?? null,
    link_url: r.link_url ?? null,
    sent_at: r.sent_at ?? null,
    opened_at: r.opened_at ?? null,
    signed_off_at: r.signed_off_at ?? null,
    days_since_sent: r.sent_at ? daysBetween(r.sent_at) : null,
    // Derived, not stored: sent and not opened. The state the zone exists for.
    is_unopened: Boolean(r.sent_at) && !r.opened_at,
  };
}

partnerDelivery.get('/deliverables', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const rows = await c.env.DB.prepare(
      `SELECT d.*, e.uid AS engagement_uid, n.title AS need_title, f.name AS founder_name
         FROM engagement_deliverables d
         JOIN engagements e ON e.id = d.engagement_id
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN users f ON f.id = e.founder_id
        WHERE e.partner_id = ?
        ORDER BY d.sent_at IS NULL, d.sent_at DESC
        LIMIT 300`,
    ).bind(partnerId).all<any>();
    const items = (rows.results || []).map(deliverableDto);
    const sent = items.filter((d: any) => d.sent_at);
    const unopened = items.filter((d: any) => d.is_unopened);
    return c.json({
      items,
      sent_count: sent.length,
      unopened_count: unopened.length,
      // NULL, not a number, and this is the whole reason the column exists in
      // the response at all. `opened_at` is the client's to set and nothing in
      // this product sets it, so on this build every sent deliverable is
      // unopened — which makes the count TRUE and the median MEANINGLESS.
      median_days_to_open: null,
      median_days_to_open_note:
        'No median: `opened_at` is the client\'s to set and no surface in this product sets it yet, so every sent deliverable reads unopened. A median over a column nobody writes would be a number about our own silence.',
      unopened_note: unopened.length
        ? `${unopened.length} sent and not marked opened. On this build that is every sent deliverable, because nothing records an open — so read it as "we do not know", not as "the client ignored it".`
        : null,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * `opened_at` and `signed_off_at` ARE NOT IN THIS LIST, on create or on patch.
 *
 * Migration 208:160 is explicit: only the founder side can truthfully say a
 * thing was read, so a partner-side write to either would be the firm reporting
 * a metric about itself. A body carrying them is not rejected — that would be
 * a confusing 400 for a caller sending a whole DTO back — it is IGNORED, and a
 * test sends both and asserts the row is unchanged.
 */
const DELIVERABLE_FIELDS = ['title', 'version', 'link_url', 'sent_at'];

partnerDelivery.post('/engagements/:engagementId/deliverables', async (c) => {
  try {
    const { user, partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const b = await body<any>(c);
    const title = trimOrNull(b.title, 200);
    if (!title) return c.json({ detail: 'A deliverable needs a title' }, 400);
    const sentAt = trimOrNull(b.sent_at, 40);
    const ins = await c.env.DB.prepare(
      `INSERT INTO engagement_deliverables
         (uid, engagement_id, title, version, link_url, sent_at, sent_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), engagementId, title, trimOrNull(b.version, 60),
      trimOrNull(b.link_url, 600), sentAt, sentAt ? user.id : null, nowIso(), nowIso(),
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM engagement_deliverables WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json(deliverableDto(row));
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.patch('/deliverables/:id', async (c) => {
  try {
    const { user, partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_deliverables', id, 'Deliverable');
    const b = await body<any>(c);
    const merged = mergePatch(row, b, DELIVERABLE_FIELDS);
    const title = trimOrNull(merged.title, 200);
    if (!title) return c.json({ detail: 'A deliverable needs a title' }, 400);
    const sentAt = trimOrNull(merged.sent_at, 40);
    await c.env.DB.prepare(
      `UPDATE engagement_deliverables
          SET title = ?, version = ?, link_url = ?, sent_at = ?, sent_by = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      title, trimOrNull(merged.version, 60), trimOrNull(merged.link_url, 600),
      sentAt, sentAt ? (row.sent_by ?? user.id) : null, nowIso(), id,
    ).run();
    const out = await c.env.DB.prepare('SELECT * FROM engagement_deliverables WHERE id = ?')
      .bind(id).first<any>();
    return c.json(deliverableDto(out));
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.delete('/deliverables/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownChild(c.env, partnerId, 'engagement_deliverables', id, 'Deliverable');
    await c.env.DB.prepare('DELETE FROM engagement_deliverables WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * The holder must belong to THIS FIRM.
 *
 * 208's `engagement_seats.holder_user_id` references `users(id)` with no
 * partner constraint — the schema alone would let a firm enter any user in the
 * product into its seat register, including a founder or another firm's staff.
 * That is a register of who has access inside a client's systems, so a wrong
 * name in it is not a cosmetic error.
 */
async function requireOwnHolder(env: Env, partnerId: number, userId: number) {
  const row = await env.DB.prepare(
    'SELECT id, name, email, partner_id, role FROM users WHERE id = ?',
  ).bind(userId).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) {
    throw new Response(JSON.stringify({
      detail: 'A seat can only be held by someone attached to this firm',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  return row;
}

/**
 * People rather than projects: who holds what, and how many hours were logged.
 *
 * `cap_hours` IS NULL AND SAYS WHY. Nothing anywhere records the firm's cap —
 * `engagement_hours` records hours and stops there. The canvas uses a hardcoded
 * 40; adopting it would invent the firm's cap and then present the result as a
 * finding. What survives is the zone's actual editorial point, and it is real:
 * this person holds N live seats inside client systems and logged H hours this
 * period.
 */
partnerDelivery.get('/capacity', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const period = String(c.req.query('period') || currentPeriod());

    const seats = await c.env.DB.prepare(
      `SELECT s.id, s.uid, s.engagement_id, s.holder_user_id, s.scope,
              s.granted_at, s.revoked_at,
              u.name AS holder_name, u.email AS holder_email,
              e.uid AS engagement_uid, n.title AS need_title, f.name AS founder_name
         FROM engagement_seats s
         JOIN engagements e ON e.id = s.engagement_id
         LEFT JOIN users u ON u.id = s.holder_user_id
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN users f ON f.id = e.founder_id
        WHERE e.partner_id = ?
        ORDER BY s.revoked_at IS NOT NULL, s.granted_at DESC`,
    ).bind(partnerId).all<any>();

    const hours = await c.env.DB.prepare(
      `SELECT h.person_user_id, h.engagement_id, h.period, h.hours,
              u.name AS person_name,
              e.uid AS engagement_uid, n.title AS need_title
         FROM engagement_hours h
         JOIN engagements e ON e.id = h.engagement_id
         LEFT JOIN users u ON u.id = h.person_user_id
         LEFT JOIN founder_needs n ON n.id = e.need_id
        WHERE e.partner_id = ? AND h.period = ?`,
    ).bind(partnerId, period).all<any>();

    // One row per person, assembled from both tables. A person appears if they
    // hold a seat OR logged hours — neither table alone is the roster.
    const people = new Map<number, any>();
    const ensure = (id: number, name: string | null) => {
      if (!people.has(id)) {
        people.set(id, {
          user_id: id,
          name: name ?? null,
          hours: 0,
          hours_recorded: false,
          live_seats: 0,
          revoked_seats: 0,
          engagements: new Set<number>(),
        });
      }
      const p = people.get(id);
      if (!p.name && name) p.name = name;
      return p;
    };

    for (const s of seats.results || []) {
      const p = ensure(Number(s.holder_user_id), s.holder_name);
      if (s.revoked_at) p.revoked_seats += 1; else p.live_seats += 1;
      p.engagements.add(Number(s.engagement_id));
    }
    for (const h of hours.results || []) {
      const p = ensure(Number(h.person_user_id), h.person_name);
      p.hours += Number(h.hours || 0);
      p.hours_recorded = true;
      p.engagements.add(Number(h.engagement_id));
    }

    return c.json({
      period,
      people: [...people.values()]
        .map((p) => ({
          user_id: p.user_id,
          name: p.name,
          // NULL when nobody logged anything for this person this period. Zero
          // would say they did no work, which is a different claim.
          hours: p.hours_recorded ? p.hours : null,
          hours_note: p.hours_recorded ? null : 'No hours logged for this period.',
          live_seats: p.live_seats,
          revoked_seats: p.revoked_seats,
          engagement_count: p.engagements.size,
        }))
        .sort((a, b) => b.live_seats - a.live_seats || (b.hours ?? -1) - (a.hours ?? -1)),
      seats: (seats.results || []).map((s: any) => ({
        id: Number(s.id),
        uid: s.uid,
        engagement_id: Number(s.engagement_id),
        engagement_uid: s.engagement_uid,
        need_title: s.need_title ?? null,
        founder_name: s.founder_name ?? null,
        holder_user_id: Number(s.holder_user_id),
        holder_name: s.holder_name ?? null,
        scope: s.scope ?? null,
        granted_at: s.granted_at,
        // A revoked seat is STILL RETURNED. The record that access once existed
        // is the point of `revoked_at` being a column rather than a delete.
        revoked_at: s.revoked_at ?? null,
        days_held: daysBetween(s.granted_at, s.revoked_at || undefined),
      })),
      // The refusal, in the response so the page cannot quietly supply one.
      cap_hours: null,
      cap_note: 'No capacity cap is recorded anywhere in this product. Hours are real; a threshold to be over is not, so nothing here is marked over-committed.',
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.post('/engagements/:engagementId/seats', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const b = await body<any>(c);
    const holder = await requireOwnHolder(c.env, partnerId, Number(b.holder_user_id));
    const ins = await c.env.DB.prepare(
      `INSERT INTO engagement_seats (uid, engagement_id, holder_user_id, scope, granted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), engagementId, holder.id,
      // Free text on purpose: what a client granted is their vocabulary.
      trimOrNull(b.scope, 400),
      trimOrNull(b.granted_at, 40) || nowIso(), nowIso(), nowIso(),
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM engagement_seats WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json({
      id: Number(row.id), uid: row.uid, engagement_id: engagementId,
      holder_user_id: Number(row.holder_user_id), holder_name: holder.name ?? null,
      scope: row.scope ?? null, granted_at: row.granted_at, revoked_at: null,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Revoking is a state, not a delete — 208:187. A struck-through seat stays on
 * the page rather than the fact that access once existed silently disappearing.
 */
partnerDelivery.post('/seats/:id/revoke', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_seats', id, 'Seat');
    if (row.revoked_at) return c.json({ detail: 'That seat is already revoked' }, 400);
    const now = nowIso();
    await c.env.DB.prepare(
      'UPDATE engagement_seats SET revoked_at = ?, updated_at = ? WHERE id = ?',
    ).bind(now, now, id).run();
    return c.json({ ok: true, id, revoked_at: now });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.patch('/seats/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_seats', id, 'Seat');
    const b = await body<any>(c);
    const merged = mergePatch(row, b, ['scope']);
    await c.env.DB.prepare(
      'UPDATE engagement_seats SET scope = ?, updated_at = ? WHERE id = ?',
    ).bind(trimOrNull(merged.scope, 400), nowIso(), id).run();
    const out = await c.env.DB.prepare('SELECT * FROM engagement_seats WHERE id = ?')
      .bind(id).first<any>();
    return c.json({
      id: Number(out.id), uid: out.uid, engagement_id: Number(out.engagement_id),
      holder_user_id: Number(out.holder_user_id), scope: out.scope ?? null,
      granted_at: out.granted_at, revoked_at: out.revoked_at ?? null,
    });
  } catch (e) { return mapError(c, e); }
});

/** Hours for one person on one engagement in one period. Upserted, not appended. */
partnerDelivery.put('/engagements/:engagementId/hours/:personId/:period', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const holder = await requireOwnHolder(c.env, partnerId, Number(c.req.param('personId')));
    const p = parsePeriod(c.req.param('period'), 'monthly');
    if ('error' in p) return c.json({ detail: p.error }, 400);
    const b = await body<any>(c);
    const h = parseHours(b.hours, 'Hours');
    if ('error' in h) return c.json({ detail: h.error }, 400);
    if (h.hours === null) return c.json({ detail: 'Hours is required' }, 400);

    const existing = await c.env.DB.prepare(
      'SELECT id FROM engagement_hours WHERE engagement_id = ? AND person_user_id = ? AND period = ?',
    ).bind(engagementId, holder.id, p.period).first<any>();
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE engagement_hours SET hours = ?, updated_at = ? WHERE id = ?',
      ).bind(h.hours, nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO engagement_hours (engagement_id, person_user_id, period, hours, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(engagementId, holder.id, p.period, h.hours, nowIso(), nowIso()).run();
    }
    return c.json({
      ok: true, engagement_id: engagementId, person_user_id: Number(holder.id),
      period: p.period, hours: h.hours,
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.delete('/engagements/:engagementId/hours/:personId/:period', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    // A real delete rather than writing zero: zero hours is the claim that they
    // did none, which is not the same as nobody having logged any.
    await c.env.DB.prepare(
      'DELETE FROM engagement_hours WHERE engagement_id = ? AND person_user_id = ? AND period = ?',
    ).bind(engagementId, Number(c.req.param('personId')), String(c.req.param('period'))).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/** Who this firm can put in a seat — its own people, and nobody else. */
partnerDelivery.get('/people', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const rows = await c.env.DB.prepare(
      'SELECT id, name, email FROM users WHERE partner_id = ? AND is_active = 1 ORDER BY name',
    ).bind(partnerId).all<any>();
    return c.json({
      items: (rows.results || []).map((r: any) => ({
        user_id: Number(r.id), name: r.name ?? null, email: r.email ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Status reports
// ---------------------------------------------------------------------------

function reportDto(r: any) {
  return {
    id: Number(r.id),
    uid: r.uid,
    engagement_id: Number(r.engagement_id),
    engagement_uid: r.engagement_uid ?? null,
    need_title: r.need_title ?? null,
    founder_name: r.founder_name ?? null,
    period: r.period,
    state: r.state,
    shipped: r.shipped ?? null,
    next_up: r.next_up ?? null,
    sent_at: r.sent_at ?? null,
  };
}

partnerDelivery.get('/status-reports', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const rows = await c.env.DB.prepare(
      `SELECT r.*, e.uid AS engagement_uid, n.title AS need_title, f.name AS founder_name
         FROM engagement_status_reports r
         JOIN engagements e ON e.id = r.engagement_id
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN users f ON f.id = e.founder_id
        WHERE e.partner_id = ?
        ORDER BY r.period DESC, r.id DESC
        LIMIT 200`,
    ).bind(partnerId).all<any>();
    const items = (rows.results || []).map(reportDto);
    return c.json({
      items,
      draft_count: items.filter((r: any) => r.state === 'draft').length,
      sent_count: items.filter((r: any) => r.state === 'sent').length,
      // The report is composed here and delivered by a person. Nothing in this
      // product emails a client on a firm's behalf, and "sent" records that a
      // person sent it rather than that this product did.
      delivery: 'manual',
      delivery_note: 'Marking a report sent records that you sent it. Nothing here delivers it — no email, no notification, no client-side surface.',
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * A report is composed from the engagement's own rows, and the two halves it
 * cannot compose are the two the firm must write.
 *
 * `blocked` is NOT a stored column: it is the open blockers, read at compose
 * time and returned with their side. Storing a prose copy of them would go
 * stale the moment one cleared, and the side is what lets the report say a
 * client-side blocker plainly without treating it as an excuse.
 */
partnerDelivery.get('/engagements/:engagementId/report-draft/:period', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const p = parsePeriod(c.req.param('period'), 'monthly');
    if ('error' in p) return c.json({ detail: p.error }, 400);

    const [deliverables, blockers, milestones, existing] = await Promise.all([
      c.env.DB.prepare(
        `SELECT title, version, sent_at, opened_at FROM engagement_deliverables
          WHERE engagement_id = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 50`,
      ).bind(engagementId).all<any>(),
      c.env.DB.prepare(
        `SELECT side, summary, raised_at FROM engagement_blockers
          WHERE engagement_id = ? AND cleared_at IS NULL ORDER BY raised_at`,
      ).bind(engagementId).all<any>(),
      c.env.DB.prepare(
        `SELECT title, due_at, completed_at FROM engagement_milestones
          WHERE engagement_id = ? AND completed_at IS NULL ORDER BY due_at IS NULL, due_at LIMIT 20`,
      ).bind(engagementId).all<any>(),
      c.env.DB.prepare(
        'SELECT * FROM engagement_status_reports WHERE engagement_id = ? AND period = ?',
      ).bind(engagementId, p.period).first<any>(),
    ]);

    return c.json({
      period: p.period,
      existing: existing ? reportDto(existing) : null,
      shipped_from_log: (deliverables.results || [])
        .filter((d: any) => String(d.sent_at).startsWith(p.period))
        .map((d: any) => ({
          title: d.title, version: d.version ?? null, sent_at: d.sent_at,
          opened: Boolean(d.opened_at),
        })),
      next_from_milestones: (milestones.results || []).map((m: any) => ({
        title: m.title, due_at: m.due_at ?? null,
      })),
      // Read at compose time, never copied into the report row.
      blocked: (blockers.results || []).map((b: any) => ({
        side: b.side, summary: b.summary, days_open: daysBetween(b.raised_at),
      })),
      blocked_note: (blockers.results || []).some((b: any) => b.side === 'client')
        ? 'One or more of these is on the client\'s side. Say so plainly — a report that hides it makes the delay look like yours, and a report that leans on it reads as an excuse.'
        : null,
    });
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.put('/engagements/:engagementId/status-reports/:period', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const p = parsePeriod(c.req.param('period'), 'monthly');
    if ('error' in p) return c.json({ detail: p.error }, 400);
    const b = await body<any>(c);

    const existing = await c.env.DB.prepare(
      'SELECT * FROM engagement_status_reports WHERE engagement_id = ? AND period = ?',
    ).bind(engagementId, p.period).first<any>();

    // A SENT REPORT IS FROZEN. It is a thing a client has already read; editing
    // it in place would make the record disagree with what they received, and
    // there would be no trace of the difference.
    if (existing && existing.state === 'sent') {
      return c.json({
        detail: 'That report was sent. A sent report is a record of what the client received and is not editable.',
      }, 409);
    }

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE engagement_status_reports SET shipped = ?, next_up = ?, updated_at = ? WHERE id = ?',
      ).bind(trimOrNull(b.shipped, 4000), trimOrNull(b.next_up, 4000), nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO engagement_status_reports
           (uid, engagement_id, period, state, shipped, next_up, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
      ).bind(
        newUid(), engagementId, p.period,
        trimOrNull(b.shipped, 4000), trimOrNull(b.next_up, 4000), nowIso(), nowIso(),
      ).run();
    }
    const row = await c.env.DB.prepare(
      'SELECT * FROM engagement_status_reports WHERE engagement_id = ? AND period = ?',
    ).bind(engagementId, p.period).first<any>();
    return c.json(reportDto(row));
  } catch (e) { return mapError(c, e); }
});

/**
 * Marking a report sent. Once, and by a person.
 *
 * This does NOT deliver anything — no email, no notification, no client-side
 * surface exists. It records that a person sent it, which is the only thing
 * this product can truthfully say. Re-sending is refused rather than being a
 * silent no-op, because a second "sent" would overwrite the timestamp of the
 * one the client actually received.
 */
partnerDelivery.post('/status-reports/:id/send', async (c) => {
  try {
    const { user, partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_status_reports', id, 'Status report');
    if (row.state === 'sent') {
      return c.json({ detail: 'That report is already marked sent' }, 409);
    }
    if (!trimOrNull(row.shipped, 4000) && !trimOrNull(row.next_up, 4000)) {
      return c.json({ detail: 'An empty report has nothing to send' }, 400);
    }
    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE engagement_status_reports SET state = 'sent', sent_at = ?, sent_by = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(now, user.id, now, id).run();
    const out = await c.env.DB.prepare('SELECT * FROM engagement_status_reports WHERE id = ?')
      .bind(id).first<any>();
    return c.json(reportDto(out));
  } catch (e) { return mapError(c, e); }
});

partnerDelivery.delete('/status-reports/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownChild(c.env, partnerId, 'engagement_status_reports', id, 'Status report');
    if (row.state === 'sent') {
      return c.json({
        detail: 'That report was sent. Deleting it would erase a record of what the client received.',
      }, 409);
    }
    await c.env.DB.prepare('DELETE FROM engagement_status_reports WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export { partnerDelivery };
export default partnerDelivery;

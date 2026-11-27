/**
 * #5314 part 1 (D4822): the client's side of a shared deliverable — its list, and its first open.
 *
 * `engagement_deliverables.opened_at` is the CLIENT'S to set (migration
 * 208:160): a partner-side write would be the firm reporting a metric about
 * itself, and `partner_delivery.ts` accepts none. This router is the client
 * side that was missing, so "Never opened" can be a finding rather than a guess.
 *
 *   GET  /api/client/deliverables/engagements/:engagementId
 *        the deliverables the firm has SENT on an engagement the caller is the
 *        client on. A draft (no `sent_at`) is the firm's work in progress and is
 *        never listed, as an unsent status report is never readable
 *        (`services/statusReportAccess.ts`).
 *   POST /api/client/deliverables/:uid/open
 *        the client opens the shared version: answers its link and records the
 *        FIRST open — `opened_at`, `opened_by`, and the `revision` and `version`
 *        the client was shown. A later open changes nothing, and a database
 *        trigger (migration `202611110731_5314`) refuses any rewrite.
 *
 * WHO IS THE CLIENT. The engagement's `founder_id` is a founder profile
 * (`founders.id`) and an account belongs to it through `users.founder_id`, the
 * rule `statusReportAccess` states. Anyone else — the firm, another founder, an
 * admin — gets 404, so the route never confirms that a deliverable exists, and
 * nobody can record an open on the client's behalf.
 *
 * THE SHARED VERSION. The open is recorded against the row's `revision`
 * (D4682), the same revision #4710's acknowledgement will name, so the firm
 * can tell when an edit came after the client's open. Nothing here notifies
 * anyone: recording an open sends no message.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { logActorAct } from '../services/actorLog';

const clientDeliverables = new Hono<{ Bindings: Env }>();

const UID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function notFound(c: any): Response {
  return c.json({ detail: 'Deliverable not found' }, 404);
}

/** The caller's founder profile id, or null. */
function founderOf(user: User): number | null {
  const id = (user as any)?.founder_id;
  return id == null || !Number.isInteger(Number(id)) ? null : Number(id);
}

/** Only an http(s) link is handed back to be opened. */
function safeLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}

function clientDto(r: any) {
  return {
    uid: r.uid,
    engagement_id: Number(r.engagement_id),
    title: r.title,
    version: r.version ?? null,
    sent_at: r.sent_at,
    has_link: safeLink(r.link_url) != null,
    opened_at: r.opened_at ?? null,
    opened_version: r.opened_at ? (r.opened_version ?? null) : null,
    // The firm changed it after this client opened it.
    changed_since_open: r.opened_at && r.opened_revision != null
      ? Number(r.opened_revision) !== Number(r.revision ?? 0)
      : false,
    signed_off_at: r.signed_off_at ?? null,
  };
}

clientDeliverables.get('/engagements/:engagementId', async (c) => {
  try {
    const user = await requireAuth(c);
    const founderId = founderOf(user);
    const raw = c.req.param('engagementId');
    if (founderId == null || !/^[1-9][0-9]{0,15}$/.test(raw)) return c.json({ detail: 'Engagement not found' }, 404);
    const engagement = await c.env.DB.prepare('SELECT id FROM engagements WHERE id = ? AND founder_id = ?')
      .bind(Number(raw), founderId).first<{ id: number }>();
    if (!engagement) return c.json({ detail: 'Engagement not found' }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT uid, engagement_id, title, version, link_url, sent_at, opened_at, opened_version,
              opened_revision, revision, signed_off_at
         FROM engagement_deliverables
        WHERE engagement_id = ? AND sent_at IS NOT NULL
        ORDER BY sent_at DESC, id DESC
        LIMIT 200`,
    ).bind(Number(engagement.id)).all<any>();
    return c.json({ items: (rows.results || []).map(clientDto) });
  } catch (e) { return mapError(c, e); }
});

clientDeliverables.post('/:uid/open', async (c) => {
  try {
    const user = await requireAuth(c);
    const founderId = founderOf(user);
    const uid = c.req.param('uid');
    if (founderId == null || !UID_RE.test(uid)) return notFound(c);
    const row = await c.env.DB.prepare(
      `SELECT d.*
         FROM engagement_deliverables d
         JOIN engagements e ON e.id = d.engagement_id
        WHERE d.uid = ? AND e.founder_id = ? AND d.sent_at IS NOT NULL`,
    ).bind(uid, founderId).first<any>();
    if (!row) return notFound(c);
    const link = safeLink(row.link_url);
    // The open is the client following the shared link. With no link there is
    // nothing to open here, and recording one would claim a read that did not
    // happen through this product.
    if (!link) return c.json({ detail: 'This deliverable was shared without a link to open here.', code: 'no_link' }, 409);

    let first = false;
    if (!row.opened_at) {
      // Set once: the WHERE keeps the first open, and the trigger refuses a rewrite.
      const res = await c.env.DB.prepare(
        `UPDATE engagement_deliverables
            SET opened_at = ?, opened_by = ?, opened_revision = revision, opened_version = version
          WHERE id = ? AND opened_at IS NULL AND sent_at IS NOT NULL`,
      ).bind(nowIso(), user.id, Number(row.id)).run();
      first = Number((res as any)?.meta?.changes ?? 0) === 1;
      if (first) {
        await logActorAct(c.env, user, 'delivery_deliverable_opened', {
          deliverable_id: Number(row.id), engagement_id: Number(row.engagement_id), revision: Number(row.revision ?? 0),
        });
      }
    }
    const out = await c.env.DB.prepare('SELECT * FROM engagement_deliverables WHERE id = ?')
      .bind(Number(row.id)).first<any>();
    return c.json({ ...clientDto(out), link_url: link, first_open: first });
  } catch (e) { return mapError(c, e); }
});

export const mount = { path: '/api/client/deliverables', router: clientDeliverables };
export default clientDeliverables;

/**
 * #4707 — HQ licence routes: compliance notices: list, issue, review. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { DEFAULT_RESPOND_DAYS, MAX_RESPOND_DAYS, MIN_RESPOND_DAYS, NOTICE_KINDS, freezeHoldersForLicence, notifyLicenceAdmins } from '../services/complianceLadder';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { pushLicenceToBranch } from '../services/licencePush';
import { KIND_LABELS, str, byUid, logEvent } from '../services/licenceLedgerCore';
import type { Env } from '../types';

const r = new Hono<{ Bindings: Env }>();

/* ------------------------------------------------------------------ *
 * The compliance ladder — HQ's half (D135)                             *
 * ------------------------------------------------------------------ */

// "First admins get notified; if admins do not act on notifications, admin
// accounts are frozen until they act; and lastly if they don't comply admin
// accounts are terminated." These three routes are the first and third of
// those: HQ issues a notice with a deadline, and HQ reads the response and
// accepts or rejects it. The middle rung — the freeze — belongs to a clock, in
// `services/complianceLadder.ts`, because a rung a person has to remember to
// climb is not a ladder.
//
// THE NOTICE IS NOT A LICENCE EVENT, and that is deliberate rather than an
// omission. `licence_events`' CHECK admits nine values (migration 187) and
// "notice issued" is not one of them; writing `terms_changed` instead would put
// a false sentence in the one table a contract dispute reads. The notice row IS
// the record. What DOES reach `licence_events` is the `suspended` the sweep
// performs, which is a real transition and is in the CHECK.
//
// AND THE ADDRESSEE MUST ADMINISTER THIS LICENCE. A notice about a territory
// sent to someone who does not hold it is a notice with no remedy behind it:
// the freeze would land on an account whose licence is somebody else's.

r.get('/:uid/notices', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    let items: any[] = [];
    let readable = true;
    try {
      const res = await c.env.DB.prepare(
        `SELECT n.uid, n.kind, n.subject, n.body, n.respond_by, n.status,
                n.response, n.responded_at, n.review_note, n.reviewed_at,
                n.froze_at, n.created_at,
                u.id AS user_id, u.name, u.email
           FROM admin_notices n JOIN users u ON u.id = n.user_id
          WHERE n.licence_id = ?
          ORDER BY n.id DESC`,
      ).bind(licence.id).all<any>();
      items = res.results || [];
    } catch { readable = false; }
    return c.json({
      items: readable ? items : [],
      // An unreadable table is NOT "no notices". A database that has not applied
      // migration 264 must say so rather than render an empty list, which is a
      // claim about the licence that nothing measured.
      notices_available: readable,
      ...(readable ? {} : {
        notices_reason: 'The admin_notices table could not be read on this database (migration 264).',
      }),
      freeze_holders: readable ? await freezeHoldersForLicence(c.env, licence.id) : null,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/notices', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const kind = str(b?.kind, 32);
    const subject = str(b?.subject, 200);
    const body = str(b?.body, 5000);
    const email = str(b?.email, 320).toLowerCase();
    if (!(NOTICE_KINDS as readonly string[]).includes(kind)) {
      return c.json({ error: `kind must be one of ${NOTICE_KINDS.join(', ')}`, code: 'bad_kind' }, 400);
    }
    if (subject.length < 3) return c.json({ error: 'a notice needs a subject' }, 400);
    // The body IS the notice. A ten-character floor for the same reason every
    // other reason field on this tier has one: it is what the addressee reads
    // when deciding what to do, and what a tribunal reads afterwards.
    if (body.length < 10) {
      return c.json({
        error: 'A notice body of at least 10 characters is required — it is what the addressee has to act on.',
        code: 'body_too_short',
      }, 400);
    }
    const days = Math.min(MAX_RESPOND_DAYS, Math.max(MIN_RESPOND_DAYS,
      Number.isFinite(Number(b?.respond_days)) ? Math.trunc(Number(b.respond_days)) : DEFAULT_RESPOND_DAYS));

    const target = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name FROM licence_admins la JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? AND LOWER(u.email) = ?`,
    ).bind(licence.id, email).first<{ id: number; email: string; name: string }>();
    if (!target) {
      return c.json({
        error: `no administrator of ${licence.licence_ref} with that address — a notice has to reach someone who can act on it`,
        code: 'not_an_administrator',
      }, 404);
    }

    const uid = newUid();
    try {
      // `respond_by` is computed in SQL, never bound as an ISO string. The
      // column is swept against `datetime('now')`, and an ISO value compared
      // there is ALWAYS the greater one — a deadline that does not bite until
      // the UTC date rolls over. One writer, one format.
      await c.env.DB.prepare(
        `INSERT INTO admin_notices
           (uid, user_id, licence_id, kind, subject, body, issued_by_user_id, respond_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), 'issued')`,
      ).bind(uid, target.id, licence.id, kind, subject, body, admin.id, `+${days} days`).run();
    } catch (e) {
      const msg = String((e as Error).message || '');
      if (/no such table/i.test(msg)) {
        return c.json({
          error: 'The admin_notices table does not exist on this database (migration 264 has not been applied).',
          code: 'store_missing',
        }, 503);
      }
      throw e;
    }

    const row = await c.env.DB.prepare(
      'SELECT uid, respond_by, status FROM admin_notices WHERE uid = ?',
    ).bind(uid).first<{ uid: string; respond_by: string; status: string }>();

    // `send()` and NOT `notify()` here, and the difference is worth stating
    // because the two look interchangeable and are not. `send()` renders a
    // DESIGNED template, queues through JOB_QUEUE so a failure retries into the
    // DLQ, writes `email_send_log`, and mirrors the message into the inbox with
    // its category and CTA — six modules already use it. `notify()` has no
    // template: it sends `[Axal] <title>` with the body as plain text. A notice
    // is the one piece of mail on this ladder that is worth designing, so it
    // goes through the path that can render one. The freeze that follows uses
    // `notify()`, because by then the person is looking at a 423 and what they
    // need is one sentence and the route back.
    let delivered = false;
    try {
      const { send } = await import('../services/email/send');
      const res = await send(c.env, 'compliance_notice_issued', target.email, {
        name: target.name || target.email,
        subject,
        kind_label: KIND_LABELS[kind] ?? kind,
        respond_by: String(row?.respond_by || ''),
        body,
        licence_url: `${String((c.env as any).APP_URL || 'https://axal.vc')}/admin/my-licence`,
      }, { userId: target.id });
      delivered = Boolean(res?.ok);
    } catch (e) { console.warn('[compliance] notice mail failed', (e as Error).message); }

    return c.json({
      ok: true,
      notice: { uid, status: row?.status ?? 'issued', respond_by: row?.respond_by ?? null },
      // Whether the message actually left, reported rather than assumed — the
      // `email_sent` argument migration 236 already made: a notice nobody was
      // told about is a different thing from one that is merely unanswered, and
      // the ladder's next rung freezes an account over the difference.
      email_sent: delivered,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/notices/:noticeUid/review', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const decision = str(b?.decision, 16);
    const note = str(b?.note, 1000);
    if (decision !== 'accept' && decision !== 'reject') {
      return c.json({ error: "decision must be 'accept' or 'reject'", code: 'bad_decision' }, 400);
    }
    const notice = await c.env.DB.prepare(
      'SELECT id, uid, user_id, status FROM admin_notices WHERE uid = ? AND licence_id = ?',
    ).bind(c.req.param('noticeUid'), licence.id).first<{ id: number; uid: string; user_id: number; status: string }>();
    if (!notice) return c.json({ error: 'not_found' }, 404);
    // A CLICK BY THE PERSON WHO OWES A FEE IS NOT EVIDENCE THE FEE WAS PAID —
    // which is why HQ reviews and lifts, and why there is nothing to review
    // until the addressee has actually said something.
    if (notice.status !== 'responded') {
      return c.json({
        error: `this notice is ${notice.status}; there is nothing to review until the addressee has responded`,
        code: 'not_responded',
      }, 409);
    }
    const next = decision === 'accept' ? 'accepted' : 'rejected';
    await c.env.DB.prepare(
      `UPDATE admin_notices
          SET status = ?, reviewed_by_user_id = ?, reviewed_at = datetime('now'),
              review_note = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(next, admin.id, note || null, notice.id).run();

    // ACCEPTING LIFTS THE FREEZE ONLY WHEN IT WAS THE LAST THING HOLDING IT.
    // Two outstanding notices and one accepted is still a frozen account; the
    // count is what says which. Reinstatement reuses the licence's own state —
    // there is no second flag to keep in step.
    let reinstated = false;
    const holders = await freezeHoldersForLicence(c.env, licence.id);
    if (next === 'accepted' && holders === 0 && licence.status === 'suspended') {
      await c.env.DB.prepare(
        "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ? AND status = 'suspended'",
      ).bind(nowIso(), licence.id).run();
      await logEvent(c.env, licence.id, 'reinstated', admin.id, { notice_uid: notice.uid }, note || null);
      reinstated = true;
    }
    // D272 — a reinstatement changes the copy's status, like the /reinstate
    // route, which already pushes. A review that does not reinstate changes
    // nothing the branch holds, so it pushes nothing.
    const pushed = reinstated ? await pushLicenceToBranch(c.env, licence.id) : null;
    await notifyLicenceAdmins(c.env, licence.id, {
      type: next === 'accepted' ? 'compliance_accepted' : 'compliance_rejected',
      title: next === 'accepted'
        ? 'HQ accepted your response'
        : 'HQ did not accept your response',
      body: next === 'accepted'
        ? (reinstated
          ? 'Your licence is active again and your account can write.'
          : `Accepted. ${holders} other notice${holders === 1 ? '' : 's'} still outstanding, so the freeze stays until those are answered.`)
        : `Your account stays frozen.${note ? ` HQ's note: ${note}` : ''}`,
      payload: { notice_uid: notice.uid, decision: next },
    });
    return c.json({ ok: true, status: next, freeze_holders: holders, reinstated, pushed });
  } catch (e) { return mapError(c, e); }
});

export default r;

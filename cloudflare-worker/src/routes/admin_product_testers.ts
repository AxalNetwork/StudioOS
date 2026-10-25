/**
 * D1042 (#2890, Approvals part 4 of #2390) — HQ's product tester decisions,
 * mounted at /api/admin/product-testers.
 *
 *   GET /               the testers, one status or all, oldest application
 *                       first, 25 a page (100 at most), with the member's name,
 *                       email, role, `email_verified` and `kyc_status`, and the
 *                       count of every status.
 *   GET /:id            one tester, the testing programs they applied to, and
 *                       their history.
 *   POST /:id/approve   applied → active. `{ note? }`
 *   POST /:id/decline   applied → declined, `{ reason, note? }`, the reason of
 *                       10 characters or more; they may apply again 90 days on.
 *   POST /:id/pause     active → paused, `{ reason, note? }`.
 *   POST /:id/resume    paused → active, `{ note? }`.
 *   POST /:id/remove    active or paused → removed, `{ reason, note? }`.
 *
 * All `requireAdmin` (Admin and Super Admin alike; the HQ freeze refuses the
 * writes). Each write tells the member by email and in their inbox, so a member
 * whose email is not verified is refused with `email_unverified`, and an admin
 * account is refused with `admins_cannot_test`. `note` is HQ's and the member
 * never sees it; `reason` is what they are told. A D1 error is a 503, never an
 * empty list. The rules live in services/productTesters.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { notify } from '../services/notify';
import {
  DECLINE_REASON_MIN, NOTE_MAX, REASON_MAX, TESTER_STATUSES, TRANSITIONS, applyTransition, isAdminAccount, isTesterStatus, listTesters,
  messageFor, readTester, reapplyAfter, testerDetail, type TesterAction,
} from '../services/productTesters';

const r = new Hono<{ Bindings: Env }>();

const NOT_FOUND = { code: 'tester_not_found', message: 'No product tester has that number.' };

function testerId(raw: string): number | null {
  return /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}

r.get('/', async (c) => {
  await requireAdmin(c);
  const status = c.req.query('status');
  if (status && !isTesterStatus(status)) {
    return refuse(c, 400, { code: 'unknown_status', message: `Status is one of ${TESTER_STATUSES.join(', ')}.` });
  }
  try {
    return c.json(await listTesters(c.env, { status, page: c.req.query('page'), page_size: c.req.query('page_size') }));
  } catch (e) {
    return refuse(c, 503, { code: 'product_testers_unreadable', message: 'The product testers could not be read. Try again in a moment.', raw: e });
  }
});

r.get('/:id', async (c) => {
  await requireAdmin(c);
  const id = testerId(c.req.param('id'));
  if (id == null) return refuse(c, 404, NOT_FOUND);
  try {
    const detail = await testerDetail(c.env, id);
    if (!detail) return refuse(c, 404, NOT_FOUND);
    return c.json(detail);
  } catch (e) {
    return refuse(c, 503, { code: 'product_testers_unreadable', message: 'The product tester could not be read. Try again in a moment.', raw: e });
  }
});

const STATUS_WORD: Record<string, string> = {
  applied: 'waiting for a decision', active: 'active', paused: 'paused', declined: 'declined', removed: 'removed',
};

for (const action of Object.keys(TRANSITIONS) as TesterAction[]) {
  r.post(`/:id/${action}`, async (c) => {
    const admin = await requireAdmin(c);
    const id = testerId(c.req.param('id'));
    if (id == null) return refuse(c, 404, NOT_FOUND);
    const t = TRANSITIONS[action];
    const body = await c.req.json().catch(() => ({})) as { note?: unknown; reason?: unknown };
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    if (note && note.length > NOTE_MAX) {
      return refuse(c, 400, { code: 'note_too_long', message: `Keep the note to ${NOTE_MAX} characters.` });
    }
    if (t.reason !== 'none') {
      const min = t.reason === 'min' ? DECLINE_REASON_MIN : 1;
      if (!reason || reason.length < min || reason.length > REASON_MAX) {
        return refuse(c, 400, {
          code: 'reason_required',
          message: t.reason === 'min'
            ? `Say why, in ${DECLINE_REASON_MIN} to ${REASON_MAX} characters. The member is told the reason.`
            : `Say why, in up to ${REASON_MAX} characters. The member is told the reason.`,
        });
      }
    }
    let tester: Awaited<ReturnType<typeof readTester>>;
    let decidedAt: string | null;
    try {
      tester = await readTester(c.env, id);
      if (!tester) return refuse(c, 404, NOT_FOUND);
      if (!t.from.includes(tester.status)) {
        return refuse(c, 409, {
          code: 'wrong_status',
          message: `This tester is ${STATUS_WORD[tester.status]}, so they cannot be ${t.event} from here.`,
        });
      }
      if (await isAdminAccount(c.env, tester.user_id)) {
        return refuse(c, 409, { code: 'admins_cannot_test', message: 'Admins cannot be product testers.' });
      }
      if (!tester.member.email_verified) {
        const who = tester.member.name || 'This member';
        return refuse(c, 409, {
          code: 'email_unverified',
          message: `${who}’s email is not verified, so they cannot be told. Ask them to verify it first.`,
        });
      }
      const done = await applyTransition(c.env, tester, action, admin.id, { note, reason: t.reason === 'none' ? null : reason });
      if (!done.changed) {
        return refuse(c, 409, { code: 'tester_changed', message: 'This tester changed while you were looking at it. Reload and try again.' });
      }
      decidedAt = done.decidedAt;
    } catch (e) {
      return refuse(c, 503, { code: 'product_testers_unreadable', message: 'The product tester could not be read, so nothing was changed. Try again in a moment.', raw: e });
    }
    const reapply = action === 'decline' && decidedAt ? reapplyAfter(decidedAt) : null;
    const message = messageFor(action, reason, reapply);
    try {
      // No category: critical, so it skips the digest and quiet hours.
      await notify(c.env, {
        userId: tester.user_id, type: `product_tester_${t.event}`, title: message.title, body: message.body,
        link: '/studio', channels: ['in_app', 'email'],
      });
    } catch (e) { console.warn('[admin/product-testers] notify failed', e); }
    return c.json({ tester: await readTester(c.env, id).catch(() => null), action: t.event, reapply_after: reapply });
  });
}

export default r;

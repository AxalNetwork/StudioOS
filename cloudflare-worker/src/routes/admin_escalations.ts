/**
 * HQ answers a branch (H1's escalation queue, H6's localisation lane — D112).
 *
 *   GET   /api/admin/escalations          the board, filterable by status/kind
 *   PATCH /api/admin/escalations/:uid     the decision, and the push that carries it
 *
 * WHY THE ANSWER AND THE PUSH ARE TWO FACTS. HQ deciding and the branch
 * receiving are different events, and a route that reported them as one would
 * make an unreachable branch look like a decision that never happened — so an
 * operator would enter it again. The decision is stored unconditionally; the
 * push result rides beside it in `pushed`, exactly as D111's promo ceiling
 * does. This is also why `answerEscalation` in `hqOps.ts` does not push: the
 * op owns the ledger, the route owns the delivery.
 *
 * WHY THIS IS NOT IN `admin_hq.ts`. That endpoint builds H1's payload — one
 * read, computed per request, storing nothing. These are writes across a tier
 * boundary. The same separation D111 made for statements, for the same reason.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import {
  answerEscalation, listEscalations, ESCALATION_KINDS, ESCALATION_STATUSES,
} from '../rpc/hqOps';
import { branchByCode } from '../services/branches';
import { mirrorBranchAction } from '../services/auditMirror';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

// GET /api/admin/escalations?status=&kind=
r.get('/escalations', async (c) => {
  try {
    await requireSuperAdmin(c);
    const status = str(c.req.query('status'), 20).toLowerCase();
    const kind = str(c.req.query('kind'), 20).toLowerCase();

    if (status && !(ESCALATION_STATUSES as readonly string[]).includes(status)) {
      return c.json({ error: 'bad_status', message: `status must be one of ${ESCALATION_STATUSES.join(', ')}` }, 400);
    }
    if (kind && !(ESCALATION_KINDS as readonly string[]).includes(kind)) {
      return c.json({ error: 'bad_kind', message: `kind must be one of ${ESCALATION_KINDS.join(', ')}` }, 400);
    }

    let items: unknown[] = [];
    let complete = true;
    let available = true;
    try {
      const listed = await listEscalations(c.env, { status, kind, limit: 100 });
      items = listed.items;
      complete = listed.complete;
    } catch { available = false; }

    return c.json({
      available,
      ...(available ? {} : {
        reason: 'The hq_escalations table could not be read on this database (migration 259).',
      }),
      items,
      ...(available ? { complete } : {}),
      kinds: ESCALATION_KINDS,
      statuses: ESCALATION_STATUSES,
    });
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/admin/escalations/:uid  { answer, status? }
r.patch('/escalations/:uid', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const uid = str(c.req.param('uid'), 80);
    const b = await c.req.json().catch(() => ({} as any));

    let decided;
    try {
      decided = await answerEscalation(c.env, uid, {
        answer: str(b?.answer, 4000),
        status: str(b?.status, 20) || 'answered',
        answered_by_user_id: admin.id,
        // The NAME, because the branch cannot resolve an HQ user id — the two
        // id spaces collide (D104), so an id sent across would name whoever
        // happens to hold it there.
        answered_by_name: str((admin as { name?: string }).name, 200) || 'Axal VC HQ',
      });
    } catch (e) {
      const msg = String((e as Error).message || '');
      if (/is not an escalation/.test(msg)) return c.json({ error: 'not_found' }, 404);
      if (/a decision needs its reason/.test(msg)) {
        return c.json({ error: 'answer_required', message: msg }, 400);
      }
      if (/status must be one of|cannot stay open/.test(msg)) {
        return c.json({ error: 'bad_status', message: msg }, 400);
      }
      throw e;
    }

    // THE PUSH IS REPORTED, NEVER THROWN. See the header.
    //
    // D205 — THE REASON SAYS WHAT HAPPENED, NOT WHAT MIGHT. It used to end "and
    // will reach the branch when a binding exists", which nothing makes true:
    // no route or sweep re-sends a stored decision once a binding appears
    // (#341). It was harmless while no screen showed it; HQ Support now does,
    // and it adds "nothing sends it again" itself, once, for every reason a
    // push can fail — so it is not said here as well.
    let pushed: { ok: boolean; reason?: string } = {
      ok: false,
      reason: `No branch Worker is bound for ${decided.row.branch_code}, so the decision is recorded `
        + 'at HQ and was not sent.',
    };
    const binding = branchByCode(c.env, decided.row.branch_code);
    if (binding) {
      try {
        const res = await (binding.stub as any).applyEscalationAnswer({
          ...decided.answer,
          pushed_at: new Date().toISOString(),
        });
        // The branch answers `{ok:false, reason}` when it holds no row for this
        // uid — a real state, not an exception, and one an operator should see
        // rather than a generic success.
        pushed = res && typeof res === 'object' && 'ok' in res
          ? res as { ok: boolean; reason?: string }
          : { ok: true };
      } catch (e) {
        pushed = { ok: false, reason: `The branch did not accept the decision: ${(e as Error).message}` };
      }
    }
    // D163 — one call for both arms. No binding is `not_deployed`; a binding
    // that answered is its own verdict. HQ's ledger already holds the decision
    // either way, which is why this records only whether it TRAVELLED.
    mirrorBranchAction(
      c.env,
      'escalation_answered',
      !binding ? 'not_deployed' : (pushed.ok ? 'ok' : 'failed'),
      decided.row.branch_code,
    );

    return c.json({ ...decided.row, pushed });
  } catch (e) { return mapError(c, e); }
});

export default r;

/**
 * HQ opens a support session on a branch (H4's "Start a support session", D120).
 *
 *   POST /api/admin/branches/:code/support-session   { target_user_id, reason }
 *
 * THIS ROUTE IS WHERE THE THREE UNCROSSABLE CHECKS HAPPEN, and that is the
 * whole architecture of the feature in one sentence. `requireFactor(c,'totp')`,
 * `requireStepUp(c)` and the admin gate are facts about an HQ operator's
 * browser session. A branch Worker cannot see a session on another host — HQ's
 * JWT is signed with a different secret and does not decode there (D.4) — so
 * the branch cannot re-check any of them, and nothing in `branchOps.ts`
 * pretends to. They are enforced HERE, before the binding is touched, and the
 * branch's trust in that is bought by `HQ_RPC_SECRET` and nothing else.
 *
 * Saying that plainly matters more than it looks: a reader who assumed the
 * branch re-verified the operator's TOTP would think this route's gates were
 * belt-and-braces and could be relaxed. They are the only copy.
 *
 * THE ORDER IS `admin.ts:1440`'s ORDER, DELIBERATELY. TOTP specifically (not
 * SMS, not a recovery code), then a RECENT TOTP, then the role — the same
 * sequence the local support session has used since Task #6 and BLOCK-AUTH-03.
 * Two implementations of "may this person open a support session" that check
 * different things is how one of them quietly becomes the weaker door.
 *
 * WHY `requireSuperAdmin` WHERE `admin.ts` USES `requireAdmin`. The local flow
 * reaches accounts in HQ's own database, which every admin already administers.
 * This one reaches into a subsidiary's database across a tenancy boundary —
 * that is the franchisor acting as the franchisor, and it is the gate every
 * other HQ→branch write in this programme uses (`admin_escalations.ts`,
 * `admin_statements.ts`, `admin_deployments.ts`). A wider door here would be a
 * wider door into someone else's tenant.
 *
 * THE REASON IS CHECKED TWICE, ON PURPOSE. Here, so the operator gets a usable
 * 400 instead of an RPC exception; and again on the branch, because the branch
 * is where the row is written and a caller-side-only rule is a convention
 * rather than a control. `admin.ts` makes the same argument for enforcing it
 * server-side rather than in the dialog.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireFactor, requireStepUp, requireSuperAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { mapError } from './_t13t14t15_helpers';
import { branchBindings } from '../services/branches';
import { BRANCH_CODE_RE } from '../util/branch';
import { SUPPORT_REASON_MIN } from '../rpc/branchOps';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

r.post('/branches/:code/support-session', async (c) => {
  try {
    // The three the branch cannot make. See the header.
    await requireFactor(c, 'totp');
    await requireStepUp(c);
    const admin = await requireSuperAdmin(c);

    const code = str(c.req.param('code'), 32).toLowerCase();
    if (!BRANCH_CODE_RE.test(code)) {
      return c.json({ error: 'bad_code', message: 'That is not a valid branch code.' }, 400);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const reason = str(body?.reason, 200);
    if (reason.length < SUPPORT_REASON_MIN) {
      return c.json({
        error: 'support_reason_required',
        message: `A reason of at least ${SUPPORT_REASON_MIN} characters is required to open a support session.`,
      }, 400);
    }
    const targetUserId = Number(body?.target_user_id);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return c.json({ error: 'bad_target', message: 'Name the account on that branch to support.' }, 400);
    }

    // THE SECRET IS REQUIRED BEFORE THE BINDING IS TOUCHED, and its absence is
    // its own answer rather than a generic failure. An HQ that has never been
    // given `HQ_RPC_SECRET` cannot open a session anywhere, and an operator
    // should read that as a credential to set (D.11) rather than as a branch
    // that is down.
    if (!c.env.HQ_RPC_SECRET) {
      return c.json({
        error: 'hq_rpc_secret_unset',
        message: 'HQ_RPC_SECRET is not set on this Worker, so a branch has no way to tell this call '
          + 'from any other Worker in the account. Set it from the value branch-provision.yml '
          + 'generated, then try again.',
      }, 409);
    }

    const binding = branchBindings(c.env).find((x) => x.code === code);
    if (!binding) {
      return c.json({
        error: 'branch_not_bound',
        message: `No branch Worker is bound for ${code}, so there is nothing to open a session on. `
          + 'A branch gets its binding when HQ redeploys after provisioning.',
      }, 409);
    }

    let offer;
    try {
      offer = await (binding.stub as any).openSupportSession(c.env.HQ_RPC_SECRET, {
        hq_actor_name: str((admin as { name?: string }).name, 200) || 'Axal VC HQ',
        // OPAQUE TEXT, and never joined on the branch. It exists so HQ's own
        // audit row and the branch's can be lined up afterwards; the branch
        // stores it and reads it back to nobody. `admin_escalations.ts:77-80`
        // states the rule this follows.
        hq_actor_ref: String(admin.id),
        target_user_id: targetUserId,
        reason,
      });
    } catch (e) {
      // The branch's refusals are the operator's business — a reason under ten
      // characters, an account that is not there, a `super_admins` row that
      // should not exist. Passing the message through beats a 500 that says
      // nothing, and these are all HQ-authored inputs rather than user content.
      return c.json({
        error: 'branch_refused',
        message: String((e as Error).message || e).replace(/^rpc: /, '').slice(0, 400),
      }, 409);
    }

    // HQ'S OWN ROW, WRITTEN HERE. The branch writes its own at authorisation
    // and again at redeem; neither database can read the other, so "audited on
    // both sides" means exactly this — two rows, each true where it lives.
    try {
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
      ).bind(
        'hq_branch_support_session',
        JSON.stringify({
          branch: code,
          target_user_id: targetUserId,
          target_email_present: Boolean(offer?.target?.email),
          reason,
          expires_at: offer?.expires_at ?? null,
        }),
        await hashEmail(admin.email),
        admin.id,
      ).run();
    } catch (e) {
      console.warn('[admin:support-session] audit row failed', (e as Error).message);
    }

    return c.json({
      branch: code,
      target: offer?.target ?? null,
      expires_at: offer?.expires_at ?? null,
      // THE LINK IS BUILT HERE because HQ is the side that has to open it and
      // the side that knows the hostname convention. The code rides in the URL
      // and the TOKEN NEVER DOES: the branch's /api/auth/support/redeem swaps
      // one for the other, and the code is single-use and five minutes old at
      // most, so a URL that leaks into history or a Referer is worth nothing
      // by the time anyone reads it.
      open_url: `https://${code}.axal.vc${offer?.redeem_path ?? ''}`,
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

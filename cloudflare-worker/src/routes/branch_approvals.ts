/**
 * The branch's approvals board (S3, D130).
 *
 *   GET /api/branch/approvals   every local queue as one list, oldest first
 *
 * D215 (S16) widened it from four lanes to eleven — the queues the live
 * console kept on their own pages — and the payload now names the canvas lanes
 * it leaves out (`not_laned`) with the reason each has no open state.
 *
 * WHY A BOARD RATHER THAN FOUR PAGES, in the canvas's own words: *"Five queues
 * that were five pages become five lanes, because an admin's actual question is
 * never 'what is in the LP queue' — it is 'what is oldest and who is waiting.'
 * Sorting by SLA age across all of them is only possible once they share a
 * surface."* That sentence is the whole specification: the value is the sort,
 * and the sort is impossible until the four share a shape.
 *
 * WHAT THIS DOES NOT DO, AND THE DISTINCTION MATTERS. It reads. Every decision
 * still goes to the queue's own console, which owns that store's status
 * vocabulary, its side effects and its emails — `admin_lp_applications.ts`,
 * `refer_earn.ts`, `admin_cohort.ts`, `spinout_moderation.ts`. A board that
 * also decided would be a fifth writer to four stores, each with rules it
 * would have to restate, and restating a rule is how the copies drift. So the
 * board is the sort and the drawer is the link.
 *
 * THE FIFTH LANE IS NOT HERE. `branch_escalations` (D112) is what this branch
 * ASKED HQ — outbound, not a queue it decides — and it has its own route and
 * its own half of the page. S3 draws it beside these four; the page composes
 * the two rather than the read model pretending they are one kind of thing.
 *
 * SUSPENSION DOES NOT GATE IT, and that is deliberate rather than an omission.
 * `requireBranchNotSuspended` (D107) guards the approval WRITES in the four
 * consoles; a frozen branch can still see what is waiting, which is what the
 * frozen banner tells it to do. Reading the board changes nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import {
  approvalBoard,
  NOT_LANED,
  SLA_DUE_SOON_HOURS,
  SLA_PAST_HOURS,
} from '../services/approvalSources';

const r = new Hono<{ Bindings: Env }>();

// GET /api/branch/approvals
r.get('/approvals', async (c) => {
  try {
    await requireAdmin(c);
    const branch = requireBranchTier(c.env);

    const raw = Number(c.req.query('limit'));
    // Per lane, so one flooded queue cannot crowd the others off a screen
    // whose entire purpose is "what is oldest anywhere".
    const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.trunc(raw))) : 100;

    const board = await approvalBoard(c.env, limit);

    return c.json({
      ...board,
      branch,
      per_lane_limit: limit,
      // THE BANDS TRAVEL WITH THE ROWS so the page renders the server's
      // definition rather than its own. `slaBand` in `rpc/hqOps.ts` made the
      // same call for escalations (D108): a band recomputed in the browser is
      // a second definition that drifts the first time one of them changes.
      sla_bands: { due_soon_hours: SLA_DUE_SOON_HOURS, past_hours: SLA_PAST_HOURS },
      // SAID ON THE PAYLOAD rather than left for the page to remember, the way
      // `answer_shape` is on the escalations route. A surface that drew an
      // Approve button here would be writing to a store this route does not
      // touch.
      not_laned: NOT_LANED,
      decides: false,
      decide_note:
        'This board reads. Each decision is made in the queue\'s own console, which owns that '
        + 'store\'s statuses and its side effects.',
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

/**
 * The branch's operating digest (S1, D131).
 *
 *   GET /api/branch/home
 *
 * THE PAGE IT REPLACES PROMISED SIX BLOCKS. `/branch` rendered a stated notice
 * naming all six of S1's — the local clock, the AI digest with its cost, queue
 * pressure, today's deadlines, revenue share and what the rail flagged — as
 * work "PR 12" would do. Three of them have no source and one of those three
 * cannot have one without inventing data, so shipping the notice unchanged
 * would have kept promising four things indefinitely. This ships the three
 * that are real and states the three that are not, each with its own reason.
 *
 * WHY THE DIGEST IS ONE CALL AND NOT THREE. Queue pressure, the programme
 * clock and the revenue rate are three questions about one territory, and a
 * page that asked them separately would render three independent loading and
 * failure states for a screen whose whole job is a single glance. The service
 * isolates them internally instead: a lane that cannot be read, a cohort table
 * that cannot be read and a licence that cannot be read are three different
 * gaps, each named where it happened, and none of them blanks the others.
 *
 * SUSPENSION DOES NOT GATE IT, for the reason D130's board is not gated
 * either: `requireBranchNotSuspended` guards approval WRITES, and a frozen
 * branch still needs to see what is waiting and when the week closes. Reading
 * the digest changes nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import { branchHome } from '../services/branchHome';

const r = new Hono<{ Bindings: Env }>();

// GET /api/branch/home
r.get('/home', async (c) => {
  try {
    await requireAdmin(c);
    const branch = requireBranchTier(c.env);
    const home = await branchHome(c.env);
    return c.json({
      ...home,
      branch,
      // NAMED ON THE PAYLOAD rather than written into the page, so the reason a
      // block is missing travels with the data that is missing. A page holding
      // its own copy is a second place to update when one of these gains a
      // source, and the one that does not get updated is the one that lies.
      unavailable: [
        {
          block: 'AI digest',
          reason:
            'The digest is a proposal with a cost beside it, and neither exists yet: there is no '
            + 'store for an accepted brief, and per-branch AI cost needs gateway metadata that is '
            + 'not being written. A digest with no cost shown would be the one thing the canvas '
            + 'says it must never be.',
        },
        {
          block: 'Flagged by the rail',
          reason:
            'Nothing computes anomalies for a territory. The canvas\'s own example — token use '
            + 'four times normal in four founder accounts — needs a baseline per branch, and no '
            + 'job writes one.',
        },
        {
          block: 'Local territory clock',
          reason:
            'The territory is held as ISO country codes and the platform\'s only country list is '
            + 'display names, not codes, so nothing maps FR to a time zone. The clock that does '
            + 'govern — the programme\'s — is shown with the deadline it governs.',
        },
      ],
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

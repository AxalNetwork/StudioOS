/**
 * D927 / #2723 — Partner invitations part 4: the admin reads.
 *
 * Mounted at `/api/admin/partners`, before `admin_partners.ts`, beside it.
 * Every route is requireAdmin and READ ONLY: nothing here writes a row, logs a
 * view, or calls the invitee's token routes (which flip Sent to Opened).
 *
 *   GET /overview                — PI1's tiles, Needs you and C1–C4, each block alone
 *   GET /invitations/:id         — one invitation: the row and its message, the step
 *                                  dates, the offers seen, the chosen deal, the
 *                                  agreement refusals and the admin history
 *   GET /offers/preview?types=   — `buildProposals`' text over a neutral profile,
 *                                  with each profile-dependent phrase marked
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { ALL_PARTNER_DEAL_TYPES } from '../services/partnerDeals';
import { offerPreview, readInvitation, readOverview } from '../services/partnerInvitationReads';

const adminPartnersReads = new Hono<{ Bindings: Env }>();

adminPartnersReads.get('/overview', async (c) => {
  await requireAdmin(c);
  return c.json(await readOverview(c.env));
});

adminPartnersReads.get('/invitations/:id{[0-9]+}', async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: 'Invitation not found' }, 404);
  const out = await readInvitation(c.env, id);
  if (!out) return c.json({ error: 'Invitation not found' }, 404);
  return c.json(out);
});

adminPartnersReads.get('/offers/preview', async (c) => {
  await requireAdmin(c);
  const preview = offerPreview(c.req.query('types'));
  if (preview.unknown.length) return c.json({ error: 'unknown_deal_type', unknown: preview.unknown, valid: ALL_PARTNER_DEAL_TYPES }, 400);
  if (!preview.types.length) return c.json({ error: 'types_required', valid: ALL_PARTNER_DEAL_TYPES }, 400);
  return c.json(preview);
});

export default adminPartnersReads;

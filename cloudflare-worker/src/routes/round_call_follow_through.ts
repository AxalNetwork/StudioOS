/**
 * D6863 (#6863, canvas D6053): following through on a Call for Capital, under
 * `/api/round-calls/:uid/…` beside `round_calls.ts`: the follow-through read,
 * Remind, the CSV and PDF exports with their log, a new call started from a
 * closed one, and a response recorded as a Signed or Wired commitment.
 *
 * Every path is behind ROUND_CALLS_ENABLED, as the rest of the area is. Remind
 * and export are the venture owner's (Q1); the read, Start and Record admit an
 * accepted co-founder too. The service re-reads the viewer live.
 *
 * D7513 (#7513, RAC20C, RAC20D): `GET /:uid/source-audience` is step 3 of a
 * draft started from a closed call: that call's chosen recipients, ticked when
 * still verified and in the pipeline. Owner or co-founder reads it; the owner
 * alone sets the audience, through `round_calls.ts`' `PUT /:uid/audience`.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { mapError } from './_t13t14t15_helpers';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { roundCallsEnabled } from '../services/roundCallPolicy';
import { RoundCallError, loadCall, projectFacts, type CallRow } from '../services/roundCalls';
import { callRelation, exportCsv, exportPdf, followThrough, prepareExport, recordCommitment, remind, sourceAudience, startFromClosed } from '../services/roundCallFollowThrough';

type Ctx = Context<{ Bindings: Env }>;
const followThroughRoutes = new Hono<{ Bindings: Env }>();

/** The call, and a viewer who is its venture's owner or accepted co-founder in the active company. */
async function requireCallMember(c: Ctx): Promise<{ call: CallRow; user: User }> {
  // The flag is checked per handler, never as router middleware: this router
  // shares `/api/round-calls` with routes that answer while calls are off.
  if (!roundCallsEnabled(c.env)) throw new RoundCallError('round_calls_disabled', 503, 'Coming soon. Round calls are not enabled.');
  const user = await requireAuth(c);
  const call = await loadCall(c.env, c.req.param('uid') || '');
  await callRelation(c.env, user, call);
  const project = await projectFacts(c.env, call.project_id);
  const companyId = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  if (!projectInActiveCompany(companyId, project)) throw new RoundCallError('project_not_found', 404);
  return { call, user };
}
async function body(c: Ctx): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await c.req.json(); } catch { throw new RoundCallError('invalid_request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RoundCallError('invalid_request');
  return value as Record<string, unknown>;
}
function failure(c: Ctx, error: unknown) {
  if (error instanceof RoundCallError) {
    if (error.sentence) return refuse(c, error.status, { code: error.code, message: error.sentence, extra: { code: error.code } });
    return c.json({ error: error.code, code: error.code }, error.status);
  }
  const message = error instanceof Error ? error.message : '';
  if (AUTH_ERROR_STATUSES[message] || message === 'step_up_required' || message === 'admin_frozen' || message === 'branch_suspended') return mapError(c, error);
  return c.json({ error: 'The call could not be read. Try again.', code: 'round_calls_unreadable' }, 503);
}

followThroughRoutes.get('/:uid/follow-through', async (c) => {
  try { const { call, user } = await requireCallMember(c); return c.json(await followThrough(c.env, call, user)); }
  catch (e) { return failure(c, e); }
});
followThroughRoutes.post('/:uid/remind', async (c) => {
  try { const { call, user } = await requireCallMember(c); return c.json(await remind(c.env, call, user, await body(c))); }
  catch (e) { return failure(c, e); }
});
followThroughRoutes.get('/:uid/export.csv', async (c) => {
  try {
    const { call, user } = await requireCallMember(c);
    const { model, filename } = await prepareExport(c.env, call, user, 'csv', c.req.query('scope'));
    return new Response(exportCsv(model), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(c, e); }
});
followThroughRoutes.get('/:uid/export.pdf', async (c) => {
  try {
    const { call, user } = await requireCallMember(c);
    const { model, filename } = await prepareExport(c.env, call, user, 'pdf', c.req.query('scope'));
    return new Response(await exportPdf(model), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(c, e); }
});
followThroughRoutes.get('/:uid/source-audience', async (c) => {
  try { const { call, user } = await requireCallMember(c); return c.json(await sourceAudience(c.env, call, user)); }
  catch (e) { return failure(c, e); }
});
followThroughRoutes.post('/:uid/successor', async (c) => {
  try { const { call, user } = await requireCallMember(c); return c.json(await startFromClosed(c.env, call, user, await body(c)), 201); }
  catch (e) { return failure(c, e); }
});
followThroughRoutes.post('/:uid/commitments', async (c) => {
  try { const { call, user } = await requireCallMember(c); return c.json(await recordCommitment(c.env, call, user, await body(c))); }
  catch (e) { return failure(c, e); }
});

export default followThroughRoutes;
export const mount: RouteMount = { path: '/api/round-calls', router: followThroughRoutes };

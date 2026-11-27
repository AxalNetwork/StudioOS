// D5059: a member can read their own program access.
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { entitlementsOfAccount } from '../services/programEntitlements';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();
r.onError((error, c) => mapError(c, error));

r.get('/', async (c) => {
  const user = await requireAuth(c);
  const read = await entitlementsOfAccount(c.env, user.id);
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    on: read.on,
    licences: read.licences.map(({ uid, licence_ref, licence_type, licence_type_label, status, valid_source }) =>
      ({ uid, licence_ref, licence_type, licence_type_label, status, valid_source })),
    programs: read.programs.map((p) => ({
      program_key: p.program_key,
      program_name: p.program_name,
      eligible: p.eligible,
      granted: p.granted,
      legally_ready: p.legally_ready,
      in_force: p.in_force,
      in_force_via: p.in_force_via,
      status: p.status,
      blockers: p.blockers,
      sources: p.sources.map(({ licence_uid, licence_ref, licence_type, licence_type_label, status, agreement, legally_ready }) =>
        ({ licence_uid, licence_ref, licence_type, licence_type_label, status, agreement: agreement.state, legally_ready })),
    })),
  });
});

export const mount: RouteMount = { path: '/api/member/program-entitlements', router: r };
export default r;

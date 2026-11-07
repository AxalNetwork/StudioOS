/**
 * #4707 — HQ licence routes: the custom host register: HQ's detach. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdminWriteBar } from '../auth';
import { notifyLicenceAdmins } from '../services/complianceLadder';
import { mapError } from './_t13t14t15_helpers';
import { domainPayload, type LicenceDomainRow } from '../services/licenceDomain';
import { logAdminAction } from '../services/adminAudit';
import { str, byUid } from '../services/licenceLedgerCore';
import type { Env } from '../types';

const r = new Hono<{ Bindings: Env }>();

/* ------------------------------------------------------------------ *
 * H31 — the one thing HQ may do to a tenant's host (D197)              *
 * ------------------------------------------------------------------ */

// H31 IS EXPLICIT ABOUT WHAT IS *NOT* HERE: "There is no Approve, no Add
// domain, and no DNS editor for HQ to complete on a tenant's behalf." The
// records live in the tenant's own zone and only the tenant can publish them,
// so a control HQ could not complete is a control HQ does not get. H26's own
// changelog settles the tier question one level up — "An earlier draft made
// Domain an HQ console. It is not: Super Admin stays on axal.vc and
// app.axal.vc and binds nothing else."
//
// Detach is the exception, and it is an admin act rather than a setting: it
// takes a host away from an operator, so it takes the super-admin write bar,
// a typed reason, and an audit row through `logAdminAction` (D159). The
// detached row KEEPS the hostname — see migration 280's header — so the
// collision this resolved cannot be re-created by the next licence claiming it
// a second later.
export const MIN_DETACH_REASON = 10;

r.post('/:uid/domain/detach', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const reason = str(body?.reason, 1000);
    // ENFORCED SERVER-SIDE, not in the form. A UI-only rule is a convention;
    // this is the sentence an operator reads months later asking why their
    // host stopped being theirs, and it has to exist.
    if (reason.length < MIN_DETACH_REASON) {
      return c.json({
        error: `A reason of at least ${MIN_DETACH_REASON} characters is required — it is what the `
          + 'operator is told, and what the audit row carries.',
        code: 'reason_too_short',
      }, 400);
    }

    let row: LicenceDomainRow | null = null;
    try {
      row = await c.env.DB.prepare(
        `SELECT id, licence_id, hostname, challenge_token, state,
                txt_verified_at, cname_verified_at, last_checked_at, last_check_json,
                is_primary, detached_at, detached_by_user_id, detach_reason,
                created_by_user_id, created_at, updated_at
           FROM licence_domains WHERE licence_id = ?`,
      ).bind(licence.id).first<LicenceDomainRow>();
    } catch (e) {
      console.warn('[licences] licence_domains unreadable', (e as Error).message);
      return c.json({
        error: 'The host register could not be read on this database (migration 280).',
        code: 'domain_store_unreadable',
      }, 503);
    }
    if (!row) {
      return c.json({
        error: 'This licence has no custom host bound. HQ does not add one — the Admin binds it '
          + 'in their own Settings.',
        code: 'no_domain',
      }, 404);
    }
    if (row.state === 'detached') {
      return c.json({
        error: `${row.hostname} is already detached.`,
        code: 'already_detached',
      }, 409);
    }

    await c.env.DB.prepare(
      `UPDATE licence_domains
          SET state = 'detached', detached_at = datetime('now'), detached_by_user_id = ?,
              detach_reason = ?, is_primary = 0, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(admin.id, reason, row.id).run();

    // THROUGH `logAdminAction`, WHICH IS D159'S WHOLE POINT, and NOT through
    // `licence_events`: that table's CHECK admits ten values and widening it
    // means the full rebuild migration 266 had to pay to add ONE. An HQ act
    // against a tenant belongs in `admin_audit_log`, which has no CHECK.
    //
    // NO `target_user_id`, deliberately. The subject is a licence, not a
    // person, and a licence may have several administrators — naming one of
    // them would put the wrong face on the row. `targetUserIdOf` reads an
    // absent key as no target, which is the honest render.
    await logAdminAction(c.env, admin.id, admin.email, 'licence_domain_detached', {
      licence_uid: licence.uid,
      licence_ref: licence.licence_ref,
      hostname: row.hostname,
      previous_state: row.state,
      reason,
    });

    // The operator learns it here rather than by noticing. Best-effort: a
    // recorded detach must not be undone by a mail failure.
    try {
      await notifyLicenceAdmins(c.env, licence.id, {
        type: 'licence_domain_detached',
        title: `Super Admin detached ${row.hostname}`,
        body: `${row.hostname} is no longer bound to your licence. ${reason}`,
        payload: { hostname: row.hostname },
      });
    } catch (e) { console.warn('[licences] detach notice failed', (e as Error).message); }

    const fresh = await c.env.DB.prepare(
      `SELECT id, licence_id, hostname, challenge_token, state,
              txt_verified_at, cname_verified_at, last_checked_at, last_check_json,
              is_primary, detached_at, detached_by_user_id, detach_reason,
              created_by_user_id, created_at, updated_at
         FROM licence_domains WHERE id = ?`,
    ).bind(row.id).first<LicenceDomainRow>();
    return c.json({ ok: true, domain: fresh ? domainPayload(fresh) : null });
  } catch (e) { return mapError(c, e); }
});

export default r;

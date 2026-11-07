/**
 * #4707 — HQ licence routes: a licence's administrators: list, appoint, detach. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { grantLicence, isLicence, LicenceRefusal } from '../services/accountLicences';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { hashEmail } from '../util/hashEmail';
import { refuse } from '../util/refusal';
import { str, byUid, logEvent } from '../services/licenceLedgerCore';
import type { Env } from '../types';

const r = new Hono<{ Bindings: Env }>();

// Who administers this licence. Migration 190 — a subsidiary admin was not
// representable before it, because territory_licences names an entity, a brand
// and a signatory, and never a user.
//
// HQ writes this; the holder reads it through GET /api/licence/mine. Assigning
// an administrator is a contractual act, so it lands in licence_events like
// every other one.
//
// D134 — THIS IS THE DOOR ADMIN ACCOUNTS ARE OPENED THROUGH, and until D134 it
// was half a door. `POST` wrote the binding and left `users.role` alone, so the
// only way to actually mint an admin was SQL against production —
// `PATCH /api/admin/users/:userId/role` refuses `role === 'admin'` outright and
// still does. The user's model is that one super admin opens, supervises, bans
// and closes many subsidiary admins; "open" had no route at all.
//
// So the promotion happens HERE, bound to a licence in the same batch, and that
// ordering is the point: an admin minted through this door is licence-bound by
// construction and there is no path that produces an unscoped one. The reverse
// is deliberately NOT symmetric — `DELETE` refuses while the account still
// holds the role, because detaching first would leave exactly the unscoped
// admin this door exists to make impossible. Demote, then detach; the demote is
// `POST /api/admin/users/:userId/demote-admin`, and `GET` returns `u.role` so
// the state between the two steps is on the screen rather than inferred.
r.get('/:uid/admins', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    // `u.role` and `u.is_active` are the two facts that make the row honest
    // rather than a name: a binding survives a demotion and survives a
    // deactivation, so a list that showed neither would render a closed
    // account and a live one identically. The transient state between demote
    // and detach is visible for the same reason.
    const rows = await c.env.DB.prepare(
      `SELECT la.admin_role, la.created_at, u.id AS user_id, u.name, u.email,
              u.role, u.is_active
         FROM licence_admins la JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? ORDER BY la.admin_role, u.email`,
    ).bind(licence.id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/admins', async (c) => {
  try {
    // D134 — THE WRITE BAR, not the plain elevation. Every other route in this
    // file re-terms or suspends a licence; this one mints an administrator, and
    // the thing it is closest to is impersonation, which has always wanted a
    // TOTP-minted session and a recent step-up. A super-admin session left open
    // on a desk should not be able to create a peer.
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const email = str(b?.email, 320).toLowerCase();
    const role = str(b?.admin_role, 20) || 'principal';
    const reason = str(b?.reason, 500);
    if (!email) return c.json({ error: 'an email address is required' }, 400);
    if (role !== 'principal' && role !== 'delegate') {
      return c.json({ error: "admin_role must be 'principal' or 'delegate'" }, 400);
    }
    // The same rule the impersonation reason carries, for the same reason:
    // enforced server-side because a UI-only rule would be a convention rather
    // than a control, and ten characters because this is the line somebody
    // reads in the audit when they ask why an account has admin.
    if (reason.length < 10) {
      return c.json({
        error: 'A reason of at least 10 characters is required — minting an administrator is the line someone reads in the audit later.',
        code: 'reason_too_short',
      }, 400);
    }
    // Resolve to an existing account, like the data room does. Assigning a
    // licence to an address nobody holds would create an administrator who
    // cannot sign in.
    const u = await c.env.DB.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number; email: string; role: string }>();
    if (!u) return c.json({ error: 'no account with that address' }, 404);

    // licence_admins is UNIQUE on user_id alone — see migration 190. Report
    // the conflict rather than letting the insert fail opaquely.
    const held = await c.env.DB.prepare(
      `SELECT l.licence_ref FROM licence_admins la
         JOIN territory_licences l ON l.id = la.licence_id
        WHERE la.user_id = ? AND la.licence_id != ?`,
    ).bind(u.id, licence.id).first<{ licence_ref: string }>();
    if (held) {
      return c.json({ error: `that account already administers ${held.licence_ref}` }, 409);
    }

    // D4472: appointment, retained licence, territory binding and both audits
    // are one transaction. Any failed statement leaves every store unchanged.
    const previousRole = String(u.role || '');
    const actorHash = await hashEmail(admin.email);
    const targetHash = await hashEmail(u.email);
    const appointmentStatements = [
      c.env.DB.prepare(`INSERT INTO licence_admins (licence_id, user_id, admin_role, granted_by_user_id)
        VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET admin_role = excluded.admin_role`)
        .bind(licence.id, u.id, role, admin.id),
      c.env.DB.prepare(`INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
        VALUES (?, 'terms_changed', ?, ?, ?, ?)`)
        .bind(licence.id, JSON.stringify({ administrator_added: u.email, admin_role: role, promoted_from: previousRole }), reason, admin.id, nowIso()),
      c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?,?,?,?)')
        .bind('role_changed', `Super admin ${admin.name} made ${u.email} an administrator of ${licence.licence_ref} (was ${previousRole || 'unrecorded'}). Reason: ${reason}`, actorHash, admin.id),
      c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?,?,?,?)')
        .bind('your_role_changed', `You were made an administrator of ${licence.licence_ref} by ${admin.name}`, targetHash, u.id),
    ];
    const retainedLicence = previousRole.toLowerCase();
    if (isLicence(retainedLicence)) {
      await grantLicence(c.env.DB, { userId: u.id, licence: retainedLicence, actorId: admin.id,
        source: 'admin_appointment', retainPrimary: true, appointmentStatements });
    } else {
      // Existing admins and non-licence holding states have no primary
      // licence to retain. Their existing atomic appointment is unchanged.
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(u.id),
        ...appointmentStatements,
      ]);
    }
    return c.json({ ok: true, user_id: u.id, admin_role: role, role: 'admin', promoted_from: previousRole });
  } catch (e) {
    if (e instanceof LicenceRefusal) return refuse(c, e.status, { code: e.code, message: 'The appointment could not retain this licence.' });
    if (e instanceof Response) return e;
    // Preserve named auth refusals; provider/storage exception text stays in logs.
    const message = e instanceof Error ? e.message : '';
    if (AUTH_ERROR_STATUSES[message]) return mapError(c, e);
    return refuse(c, 503, { code: 'admin_appointment_failed', message: 'The appointment could not be recorded. Please retry.', raw: e });
  }
});

r.delete('/:uid/admins/:userId{[0-9]+}', async (c) => {
  try {
    // Same bar as the add, because the two are one power read from either end.
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const userId = Number(c.req.param('userId'));
    const gone = await c.env.DB.prepare(
      'SELECT u.email, u.role FROM licence_admins la JOIN users u ON u.id = la.user_id WHERE la.licence_id = ? AND la.user_id = ?',
    ).bind(licence.id, userId).first<{ email: string; role: string }>();
    if (!gone) return c.json({ error: 'not_found' }, 404);
    // D134 — DETACH REFUSES WHILE THEY ARE STILL AN ADMIN, and this is the
    // asymmetry that makes the add safe. `POST` above binds and promotes in one
    // batch precisely so no admin exists without a licence behind them;
    // unbinding first would produce exactly that account — role intact, nothing
    // naming which territory it belongs to, and no screen that lists it.
    //
    // The refusal names the step rather than stating a policy, because the
    // caller's next action is a single route away and a 409 that does not say
    // which one is a dead end.
    if (String(gone.role).toLowerCase() === 'admin') {
      return c.json({
        error: `${gone.email} still holds the admin role. Demote the account first `
          + '(POST /api/admin/users/:userId/demote-admin) — detaching alone would leave an '
          + 'administrator with no licence behind them.',
        code: 'still_an_admin',
      }, 409);
    }
    await c.env.DB.prepare('DELETE FROM licence_admins WHERE licence_id = ? AND user_id = ?')
      .bind(licence.id, userId).run();
    await logEvent(c.env, licence.id, 'terms_changed', admin.id,
      { administrator_removed: gone.email });
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export default r;

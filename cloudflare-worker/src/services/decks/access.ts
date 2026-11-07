/**
 * D4595 (#4595) — the authoritative management permission contract for every
 * Pitch deck endpoint. Public share-token reads and investor deal grants use
 * their own narrower, recipient-scoped gates.
 *
 * Read: the venture owner, an accepted cofounder, or HQ. Advisors (including
 * accepted advisor members) and investor-only accounts cannot read a managed
 * deck.
 *
 * Write: the owner, an accepted cofounder, or the Super Admin. Every
 * non-owner write is actor-audited by the shared project-content gate; a
 * Super Admin write gets the additional deck authorization audit. No support
 * session may write, including one impersonating a founder.
 */
import { hydrateSuperAdmin, isSuperAdmin } from '../../auth';
import { isSupportSession } from '../../integrations/providers/mercury';
import { projectOwned as sharedProjectOwned } from '../../middleware/projectContentAccess';
import { holdsLicence, holdsOnlyLicence } from '../accountLicences';
import { getProjectMembershipRole } from '../projectAccess';

export type DeckAccessOptions = { write?: boolean; audit?: boolean; contactData?: boolean };

export async function projectOwned(c: any, user: any, projectId: number, opts: DeckAccessOptions = {}) {
  user = { ...user, role: String(user.role || '').toLowerCase() };
  if (holdsOnlyLicence(user, 'advisor')) throw new Error('Forbidden');
  if (opts.write && await isSupportSession(c)) throw new Error('SupportSessionRefused');

  const adminWrite = Boolean(opts.write && user.role === 'admin');
  if (adminWrite && !isSuperAdmin(await hydrateSuperAdmin(c.env, user))) throw new Error('Forbidden');

  const project = await sharedProjectOwned(c, user, projectId, opts);
  const owner = holdsLicence(user, 'founder') && user.founder_id != null && user.founder_id === project.founder_id;
  if (!owner && user.role !== 'admin' && await getProjectMembershipRole(c.env, projectId, user.id) === 'advisor') {
    throw new Error('Forbidden');
  }
  if (adminWrite && opts.audit !== false) {
    await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)')
      .bind('deck_write_authorized', JSON.stringify({ method: c.req.method, route: c.req.routePath }), `user:${user.id}`, user.id, project.id).run();
  }
  return project;
}

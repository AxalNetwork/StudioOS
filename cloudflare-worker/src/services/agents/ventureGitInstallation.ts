import type { Env } from '../../types';
import type { WorkspaceSponsor } from './workspaceSecurity';

export type VentureGitScope = Pick<WorkspaceSponsor, 'tenant_id' | 'company_id'> & {
  project_id: number;
};

type VentureGitInstallation = VentureGitScope & {
  uid: string;
  app_id: number;
  installation_id: number;
  repository_id: number;
  repository_full_name: string;
  base_ref: string;
  approved_at: string;
  approved_by_user_id: number | null;
  revoked_at: string | null;
};

type VentureGitPublisherInspection =
  | { ok: false; code: 'venture_git_installation_not_found' }
  | {
    ok: false;
    code: 'venture_git_installation_revoked' | 'venture_git_approval_missing' | 'venture_git_publisher_disabled';
    installation: VentureGitInstallation;
  };

const positiveId = (id: number) => Number.isSafeInteger(id) && id > 0;

/**
 * Broker-side lookup for an already-authorized workspace scope. A reference
 * is an identifier, never proof of authorization or current GitHub access.
 */
export async function inspectVentureGitPublisher(
  db: Env['DB'],
  scope: VentureGitScope,
  installationRef: string,
): Promise<VentureGitPublisherInspection> {
  const notFound = { ok: false, code: 'venture_git_installation_not_found' } as const;
  if (typeof installationRef !== 'string' || !/^[a-f0-9]{32}$/.test(installationRef) ||
      !positiveId(scope.tenant_id) || !positiveId(scope.company_id) || !positiveId(scope.project_id)) {
    return notFound;
  }

  const installation = await db.prepare(`
    SELECT i.uid, i.tenant_id, i.company_id, i.project_id, i.app_id, i.installation_id,
           i.repository_id, i.repository_full_name, i.base_ref, i.approved_at,
           i.approved_by_user_id, i.revoked_at
      FROM venture_git_installations i
      JOIN projects p ON p.id = i.project_id AND p.company_id = i.company_id
      JOIN company_profiles c ON c.id = i.company_id
     WHERE i.uid = ? AND i.tenant_id = ? AND i.company_id = ? AND i.project_id = ?
       AND p.deleted_at IS NULL AND COALESCE(c.archived_at, '') = ''
  `).bind(installationRef, scope.tenant_id, scope.company_id, scope.project_id)
    .first<VentureGitInstallation>();

  if (!installation) return notFound;
  if (installation.revoked_at !== null) return { ok: false, code: 'venture_git_installation_revoked', installation };
  if (installation.approved_by_user_id === null) return { ok: false, code: 'venture_git_approval_missing', installation };
  return { ok: false, code: 'venture_git_publisher_disabled', installation };
}

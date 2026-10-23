/** #2435: management access to a venture's decks and brand content.
 * Public shares and NDA-gated investor reads have separate routes. A role
 * alone never grants an investor or Operating Partner management access.
 * Company selection narrows an owner's existing access; it never grants it.
 */
import type { Env, User } from '../types';
import { activeCompanyFor } from './activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { canAccessProject, getProjectMembershipRole } from '../services/projectAccess';
import { findableBy } from '../services/investorFindable';

type Project = { id: number; founder_id: number | null; company_id: number | null };
type Context = { env: Env; req: { header: (name: string) => string | undefined } };

export async function projectOwned(c: Context, user: User, projectId: number, opts: { write?: boolean; audit?: boolean; contactData?: boolean } = {}): Promise<Project> {
  user = { ...user, role: String(user.role || '').toLowerCase() } as User;
  const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ?')
    .bind(projectId).first<Project>();
  if (!project) throw new Error('NotFound');
  if (user.role === 'admin') return project;
  // Preserve D702's hidden-venture response, without treating findability as
  // authorization to manage a deck or the people on a venture's waitlist.
  if (user.role === 'investor') {
    if (!await findableBy(c.env, user, project.id)) throw new Error('NotFound');
    throw new Error('Forbidden');
  }
  // projectAccess's broad partner rule is tracked by #2438. These two
  // management surfaces require an explicit accepted project membership for
  // every non-owner; an advisor remains read-only, including a partner account.
  const owner = user.role === 'founder' && !!user.founder_id && user.founder_id === project.founder_id;
  if (!owner) {
    const role = await getProjectMembershipRole(c.env, project.id, user.id);
    if (!role || !['owner', 'cofounder', 'advisor'].includes(role) || ((opts.write || opts.contactData) && role === 'advisor')) throw new Error('Forbidden');
  }
  if (!await canAccessProject(c.env, user, project, opts)) throw new Error('Forbidden');
  if (owner
    && !projectInActiveCompany(await activeCompanyFor(c, user), project)) throw new Error('NotFound');
  if (opts.write && !owner && opts.audit !== false) {
    // Read-mostly GETs defer this audit until they need to allocate a value.
    // Newly admitted project members act on another founder's venture. Record
    // who was authorized before a write; an unavailable audit store refuses
    // the operation rather than admitting an unattributed editor.
    await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)')
      .bind('project_content_write_authorized', JSON.stringify({ permission: 'write' }), `user:${user.id}`, user.id, project.id).run();
  }
  return project;
}

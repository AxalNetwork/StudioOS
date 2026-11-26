/**
 * D8546 (#8546, part of #6006) — the read and decision contract of Problem discovery's grouping proposals:
 * a pending set of phrases, possibly from several interviews of one venture, offered for one theme. Mounted
 * at /api/progress/pain-grouping-proposals, beside `progress.ts` and apart from its `/pain-groups/:id` paths.
 *
 *   GET   /:projectId                 the venture's proposals (`?status=pending` by default, or `all`), each with
 *                                     every member's sources and whether that interview agreed to be quoted
 *   PATCH /:projectId/:id             edit a pending proposal: { members?, title? }; the original stays as proposed
 *   POST  /:projectId/:id/discard     discard it; only its status changes
 *   POST  /:projectId/:id/accept      accept the whole set: one decision, one write, every member or none
 *
 * There is no route that stores a proposal: `proposeGrouping` (services/painGroupingProposals.ts) is the typed
 * ingress a later producer calls, and nothing here calls a model or bills.
 *
 * WHO. Venture writers only (`canWrite`: an admin, the venture's founder, an admitted Lab member on their own
 * venture). A reader or partner is refused with no payload, so a suggestion's wording never reaches them.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { canWrite } from './_founder_validate_helpers';
import {
  acceptGroupingProposal, discardGroupingProposal, editGroupingProposal, listGroupingProposals, type GroupingStatus,
} from '../services/painGroupingProposals';

const grouping = new Hono<{ Bindings: Env }>();

/** The caller and the venture, or the refusal. Only a venture writer passes. */
async function scope(c: any): Promise<{ user: User; projectId: number } | Response> {
  const user = (await requireAuth(c)) as User;
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isSafeInteger(projectId) || projectId < 1) return refuse(c, 400, { code: 'invalid_project_id', message: 'That venture id is not valid.' });
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first() as { id: number; founder_id: number | null } | null;
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'Venture not found.' });
  if (!canWrite(project, user)) return refuse(c, 403, { code: 'forbidden', message: 'Only the venture\'s own team reads or decides grouping proposals.' });
  return { user, projectId };
}

const proposalId = (c: any) => Number(c.req.param('id'));
const answer = (c: any, r: { ok: false; status: number; code: string; message: string }) =>
  refuse(c, r.status, { code: r.code, message: r.message });

grouping.get('/:projectId', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const status = String(c.req.query('status') ?? 'pending');
  if (!['pending', 'accepted', 'discarded', 'all'].includes(status)) {
    return refuse(c, 400, { code: 'invalid_status', message: 'Ask for pending, accepted, discarded or all.' });
  }
  const proposals = await listGroupingProposals(c.env, s.projectId, { writer: true, status: status as GroupingStatus | 'all' });
  return c.json({ proposals });
});

grouping.patch('/:projectId/:id', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return refuse(c, 400, { code: 'invalid_body', message: 'Send the quotes or the title to change.' });
  const r = await editGroupingProposal(c.env, {
    projectId: s.projectId, id: proposalId(c), userId: s.user.id,
    members: 'members' in body ? body.members : undefined, title: 'title' in body ? body.title : undefined,
  });
  return r.ok ? c.json({ proposal: r.proposal }) : answer(c, r);
});

grouping.post('/:projectId/:id/discard', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const r = await discardGroupingProposal(c.env, { projectId: s.projectId, id: proposalId(c), userId: s.user.id });
  return r.ok ? c.json({ proposal: r.proposal }) : answer(c, r);
});

grouping.post('/:projectId/:id/accept', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const r = await acceptGroupingProposal(c.env, { projectId: s.projectId, id: proposalId(c), userId: s.user.id });
  return r.ok ? c.json({ proposal: r.proposal, group_id: r.group_id, assigned: r.assigned }) : answer(c, r);
});

export default grouping;
export const mount: RouteMount = { path: '/api/progress/pain-grouping-proposals', router: grouping };

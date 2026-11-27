/**
 * D1093 (#2958, part 4 of #2402) — Google Workspace on Build, mounted at
 * `/api/cycles/build/google` (before the Build cycle's own routes):
 *
 *   GET  /?project=                    → "From Google" on Solution design and Product roadmap (GW3)
 *   POST /sync            { project }  → read the chosen Docs and mapped Sheets now
 *   POST /proposals/:id/accept  { project } → a spec Doc's proposal becomes a design note
 *   POST /proposals/:id/dismiss { project } → it stays dismissed until the Doc changes
 *
 * The scope check is part 2's (`google_workspace.ts`): a member with write
 * access to the venture, the company enabled for this connection, never a
 * support session. The feeds are `services/google/buildFeeds.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { WorkspaceError } from '../services/google/workspace';
import { acceptDocProposal, dismissDocProposal, fromGoogle, syncBuildFiles } from '../services/google/buildFeeds';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { context, safe } from './google_workspace';

const build = new Hono<{ Bindings: Env }>();

const proposalId = (raw: string) => (/^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : null);
const DECIDED = { not_found: ['proposal_not_found', 404], decided: ['proposal_already_decided', 409] } as const;

build.get('/', safe(async (c, user) => {
  const { project, integration } = await context(c, user, c.req.query('project'));
  return c.json(await fromGoogle(c.env, { integrationId: integration.id, projectId: project.id, userId: user.id }));
}));

build.post('/sync', safe(async (c, user) => {
  const body = await c.req.json().catch(() => ({}));
  const { project, integration } = await context(c, user, body.project);
  return c.json(await syncBuildFiles(c.env, { integrationId: integration.id, projectId: project.id, userId: user.id }));
}));

for (const verb of ['accept', 'dismiss'] as const) {
  build.post(`/proposals/:id/${verb}`, safe(async (c, user) => {
    const body = await c.req.json().catch(() => ({}));
    const { project, integration } = await context(c, user, body.project);
    const id = proposalId(c.req.param('id'));
    if (id == null) throw new WorkspaceError('proposal_not_found', 404);
    const out = verb === 'accept'
      ? await acceptDocProposal(c.env, project.id, integration.id, id, user.id)
      : await dismissDocProposal(c.env, project.id, integration.id, id, user.id);
    if (out !== 'ok') throw new WorkspaceError(DECIDED[out][0], DECIDED[out][1]);
    await logCycleWriteStatement(c.env, {
      projectId: project.id, userId: user.id, cycle: 'build', module: 'solution-design', entityId: null,
      action: verb === 'accept' ? 'build_design_note_accepted' : 'build_design_proposal_dismissed',
      summary: verb === 'accept' ? 'Design note accepted from Google Docs' : 'Design proposal from Google Docs dismissed',
    }).run().catch(() => {});
    return c.json({ ok: true });
  }));
}

export default build;

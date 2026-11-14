/** D4424: safety-checked text proposals from a verified outside assistant; never executes a tool or applies a record change. */
import type { Env } from '../../types';
import { ToolRefused, grantCompany, grantUser } from '../../mcp/grants';
import { guardFinalText } from '../aiRouter';
import { proposeRefusal, railByRunKey, type RailProposal } from '../railProposals';
import { agentDisclaimerText } from './disclaimers';
import { moduleOf, optionsIn } from './catalogue';
import { outsidePrincipal, outsideToolAllowed, OUTSIDE_PROPOSE, type OutsidePrincipal } from './outsidePolicy';

const answer = (proposal: RailProposal, replayed: boolean) => {
  const notice = agentDisclaimerText(proposal.disclaimer_key);
  return { proposal, replayed, ...(notice ? { notice } : {}) };
};

export async function proposeOutsideText(env: Env, principal: OutsidePrincipal, grantId: string | null, args: Record<string, unknown>) {
  const module = typeof args.module === 'string' ? moduleOf(args.module) : null;
  const option = typeof args.option === 'string' ? args.option : '';
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  const requestId = typeof args.request_id === 'string' ? args.request_id.replaceAll('-', '') : '';
  if (!module || !text || text.length > 4000 || !/^[a-f0-9]{32}$/.test(requestId)) throw new ToolRefused('Send a module, an offered option, up to 4,000 characters and a unique request id.', 'invalid_input');
  const project = args.project == null ? null : Number(args.project);
  const checkProject = async (p: OutsidePrincipal) => {
    if (project === null) return;
    if (!Number.isSafeInteger(project) || project <= 0 || !p.props.companies.includes(project)) {
      throw new ToolRefused('This project is not part of this connected company.', 'refused', 'not_granted');
    }
    await grantCompany(env, p.props, await grantUser(env, p.props), project, true);
  };
  await checkProject(principal);
  const checkRole = async (p: OutsidePrincipal) => {
    const rules = p.rules;
    if (!rules.works_in.includes(module.key) || !rules.may_propose.includes(option) || !optionsIn(module.key).includes(option)) {
      throw new ToolRefused('This role may not propose that in this module. Its rule book lists what it may propose.', 'option_not_allowed');
    }
    if (!(await outsideToolAllowed(env, p, OUTSIDE_PROPOSE, 'team:propose', false))) throw new ToolRefused('This team does not allow that proposal tool.', 'tool_not_allowed');
  };
  await checkRole(principal);
  const runKey = `agent:${principal.agent.uid}${requestId}`;
  const existing = await railByRunKey(env, principal.user.id, runKey);
  if (existing) return answer(existing, true);
  const input = { userId: principal.user.id, page: module.page, option,
    record: project === null ? `company:${principal.scope.uid}` : `project:${project}`, kind: 'draft' as const,
    payload: { text, module: module.key, project_id: project, source: 'outside_assistant' }, model: 'external', agentId: principal.agent.id, runKey };
  const why = proposeRefusal(input);
  if (why) throw new ToolRefused('This proposal could not be kept for review.', 'invalid_input');
  // The existing platform output guard, at zero member charge. No generation model or team-cap hold.
  const guard = await guardFinalText(env, { userId: principal.user.id, surface: '/mcp' }, text, 0);
  await guard.record(null, null);
  if (guard.decision.action === 'block' || guard.decision.action === 'fail') throw new ToolRefused('This proposal could not pass the safety check, so it was not stored.', 'safety_refused');
  // A connection revoked while the guard ran cannot leave a proposal afterwards.
  const fresh = await outsidePrincipal(env, principal.props, grantId);
  if (!fresh) throw new ToolRefused('This connected app no longer has access to this company.', 'connection_revoked');
  await checkProject(fresh);
  await checkRole(fresh);
  const uid = crypto.randomUUID().replaceAll('-', '');
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,model,agent_id,run_key)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM team_agent_mcp_bindings b JOIN team_agents a ON a.id=b.agent_id
          WHERE b.uid=? AND b.state='active' AND b.grant_id=? AND b.client_id=? AND b.sponsor_user_id=?
            AND a.id=? AND a.status='active' AND a.source='mcp_client' AND a.sponsor_user_id=b.sponsor_user_id
            AND (? IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id=? AND p.company_id=a.company_id AND p.deleted_at IS NULL)))`)
        .bind(uid, input.userId, input.page, option, input.record, input.kind, JSON.stringify(input.payload), 'external', fresh.agent.id, runKey,
          fresh.props.outsideBindingUid!, grantId, fresh.props.clientId, input.userId, fresh.agent.id, project, project),
      env.DB.prepare(`INSERT INTO team_agent_events(agent_id,actor_user_id,kind,proposal_uid,detail_json)
        SELECT ?,?,'run',uid,? FROM ai_rail_proposals WHERE uid=? AND agent_id=?`)
        .bind(fresh.agent.id, fresh.user.id, JSON.stringify({ module: module.key, tool: OUTSIDE_PROPOSE, source: 'mcp_client' }), uid, fresh.agent.id),
    ]);
  } catch (e) {
    if (!/UNIQUE/i.test(String((e as Error).message))) throw e;
    const replay = await railByRunKey(env, principal.user.id, runKey);
    if (replay) return answer(replay, true);
    throw e;
  }
  const proposal = await railByRunKey(env, principal.user.id, runKey);
  if (!proposal) throw new ToolRefused('This connection ended before its proposal could be stored.', 'connection_revoked');
  return answer(proposal, false);
}

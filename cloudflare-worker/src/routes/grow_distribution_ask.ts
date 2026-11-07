/** D4488 (#4488): quoted Distribution drafts and venture-scoped proposal decisions; never sends. D4493: a `sequence` run takes the moved 'draft:grow/customers' rail row's models. */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { aiPaused, AI_PAUSED_MESSAGE } from '../services/aiBudget';
import { AI_SURFACE } from '../services/aiSurfaces';
import { isSupportSession } from '../integrations/providers/mercury';
import { DistributionRefused, distributionRequest, distributionAccess, distributionContext, distributionOutput, storeDistributionDrafts, distributionProposals, decideDistribution, DISTRIBUTION_PAGE, DISTRIBUTION_OPTION, DISTRIBUTION_SYSTEM, DISTRIBUTION_MAX_TOKENS, SEQUENCE_OPTION } from '../services/distributionDrafts';

const router = new Hono<{ Bindings: Env }>();
const body = async (c: any): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; };
const project = (v: unknown) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new DistributionRefused(400, 'project_required', 'Choose a venture.'); return n; };
const handle = (fn: (c: any, user: User) => Promise<Response>) => async (c: any) => {
  let user: User;
  try { user = await requireAuth(c) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  try {
    if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session', message: 'A support session cannot draft or accept Distribution changes.', audience: 'member' });
    return await fn(c, user);
  } catch (e) {
    if (e instanceof DistributionRefused) return refuse(c, e.status, { code: e.code, message: e.sentence, audience: 'member' });
    return refuse(c, 503, { code: 'distribution_unreadable', message: 'Distribution could not finish that request. Reload to check the proposals before trying again.', audience: 'member', raw: e });
  }
};
function aiRefusal(c: any, r: { refusal?: string | null }) {
  const code = r.refusal || 'draft_unavailable';
  if (['budget_user_day','budget_user_month','budget_org_month','budget_review','kill_switch','spend_limit'].includes(code)) return refuse(c,402,{ code, message:'The included AI allowance and top-up balance cannot cover this run.',audience:'member' });
  if (code === 'ai_paused') return refuse(c,403,{ code,message:'AI is paused on this account. Contact support.',audience:'member' });
  if (code === 'assist_off') return refuse(c,403,{ code,message:'AI assistance is off for this page. You can still write it yourself.',audience:'member' });
  return refuse(c,503,{ code:'draft_unavailable',message:'Eadwyn could not draft that text. You can still write it yourself.',audience:'member' });
}
async function prepared(c: any, user: User, b: Record<string, unknown>) {
  const input = distributionRequest(b);
  await distributionAccess(c.env,user,input.project,input.campaign_uid);
  if (await aiPaused(c.env,user.id)) throw new DistributionRefused(403,'ai_paused',AI_PAUSED_MESSAGE);
  const context = await distributionContext(c.env,input,user);
  const options: RunOptions = { userId:user.id,task:'distribution_draft',systemPrompt:DISTRIBUTION_SYSTEM,messages:[{role:'user',content:JSON.stringify({ records:context.material,targets:context.targets })}],maxTokens:DISTRIBUTION_MAX_TOKENS,surface:AI_SURFACE.growDistribution,rail:{page:DISTRIBUTION_PAGE,option:input.kinds.some(k=>k.kind==='sequence')?SEQUENCE_OPTION:DISTRIBUTION_OPTION,record:`distribution:${input.project}`} };
  return { input,context,options };
}
router.post('/quote',handle(async(c,user)=>{
  const {context,options} = await prepared(c,user,await body(c));
  const estimate = await quoteRun(c.env,options);
  if (!estimate.ok) return aiRefusal(c,estimate);
  return c.json({ estimate:{hold_microusd:estimate.hold_microusd,model:estimate.model},sources:context.sources });
}));
router.post('/run',handle(async(c,user)=>{
  const b = await body(c);
  const {input,context,options} = await prepared(c,user,b);
  const estimate = await quoteRun(c.env,options);
  if (!estimate.ok) return aiRefusal(c,estimate);
  if (!b.quote || b.quote.hold_microusd !== estimate.hold_microusd || b.quote.model !== estimate.model) return refuse(c,409,{code:'quote_changed',message:'Read the current hold before drafting. Refresh the quote and try again.',audience:'member'});
  // Only the freshly server-derived hold can cap the router; a request cannot set a charge cap.
  const result = await run(c.env,{...options,task:'distribution_draft',rail:options.rail,surface:AI_SURFACE.growDistribution,pinMicrousd:estimate.hold_microusd});
  if (!result.ok) return aiRefusal(c,result);
  const drafts = distributionOutput(String(result.output ?? ''),input,context.segmentIds);
  const proposals = await storeDistributionDrafts(c.env,user,input,drafts,result.usage.model,result.usageLogId ?? null,context.sources);
  let charged: number | null = null;
  if (result.usageLogId != null) {
    const rows = await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE user_id = ? AND (id = ? OR guard_for = ?)').bind(user.id,result.usageLogId,result.usageLogId).all();
    if (rows.results?.length && rows.results.every((r: any)=>Number.isSafeInteger(r.charged_microusd))) charged = rows.results.reduce((n: number,r: any)=>n+r.charged_microusd,0);
  }
  return c.json({proposals,sources:context.sources,receipt:{held_microusd:estimate.hold_microusd,charged_microusd:charged}});
}));
router.get('/proposals',handle(async(c,user)=>c.json({proposals:await distributionProposals(c.env,user,project(c.req.query('project')),c.req.query('campaign_uid'))})));
router.post('/accept-safe',handle(async(c,user)=>{
  const b = await body(c), pid = project(b.project);
  await distributionAccess(c.env,user,pid);
  if (!Array.isArray(b.uids) || !b.uids.length || b.uids.length > 50 || b.uids.some((u: unknown)=>typeof u !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(u))) throw new DistributionRefused(400,'invalid_proposals','Choose between one and fifty proposals.');
  const results = [];
  for (const uid of [...new Set<string>(b.uids)]) {
    try { results.push({uid,status:200,proposal:await decideDistribution(c.env,user,pid,uid,'accept',undefined,true)}); }
    catch (e) { if (!(e instanceof DistributionRefused)) throw e; results.push({uid,status:e.status,code:e.code,message:e.sentence}); }
  }
  return c.json({results});
}));
router.post('/:uid/decide',handle(async(c,user)=>{
  const b = await body(c);
  if (!['accept','edit','discard'].includes(b.decision)) throw new DistributionRefused(400,'invalid_decision','Choose Accept, Edit or Discard.');
  return c.json({proposal:await decideDistribution(c.env,user,project(b.project),c.req.param('uid'),b.decision,b.edited)});
}));
export const mount = { path:'/api/grow/distribution/ask',router: router };
export default router;

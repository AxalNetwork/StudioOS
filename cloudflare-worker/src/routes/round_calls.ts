import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireHqAuthoring, requireSuperAdmin, requireStepUp } from '../auth';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { mapError } from './_t13t14t15_helpers';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { roundCallsEnabled, verifiedInvestor } from '../services/roundCallPolicy';
import { RoundCallError, loadCall, projectFacts, projectRecord, roundContext, saveDraft, audience, saveAudience, notOnAxal, ventureMember, ventureReadinessRead,
  founderPage, sendCall, investorPage, respond, recordCounsel, manageCall, answerQuestion, requestCounsel, counselQueue, audiencePreview } from '../services/roundCalls';

type Ctx = Context<{ Bindings: Env }>;
const routes = new Hono<{ Bindings: Env }>();
/**
 * The venture's owner, or with `members` (D1222) an accepted co-founder too:
 * drafting, answering and the readiness read are theirs; the audience, send,
 * extend and close stay the owner's. `flagFree` reads the project without the
 * calls flag, for the readiness read alone.
 */
async function owner(c: Ctx, projectId: number, opts: { members?: boolean; flagFree?: boolean } = {}) {
  const user = await requireAuth(c);
  const founder = user.role === 'founder' || (user.role === 'exploring' && Number(user.spinout_lab_active) === 1);
  if (!founder && !opts.members) throw new RoundCallError('founder_required',403);
  const project = opts.flagFree ? await projectRecord(c.env,projectId) : await projectFacts(c.env,projectId);
  const owns = founder && user.founder_id != null && project.founder_id === user.founder_id;
  const member = !owns && !!opts.members && await ventureMember(c.env,project.id,user);
  // Someone who is neither a founder nor this venture's member is refused as before.
  if (!owns && !member && !founder) throw new RoundCallError('founder_required',403);
  const companyId = await resolveActiveCompany(c.env,user,c.req.header(ACTIVE_COMPANY_HEADER));
  if (!(owns || member) || !projectInActiveCompany(companyId,project)) throw new RoundCallError('project_not_found',404);
  return { user, project };
}
async function callOwner(c: Ctx, opts: { members?: boolean } = {}) {
  await requireAuth(c);
  const call = await loadCall(c.env,(c.req.param('uid') || ''));
  const access = await owner(c,call.project_id,opts);
  return { call, ...access };
}
async function investor(c: Ctx): Promise<User> {
  const user=await requireAuth(c);
  if(!verifiedInvestor(user)) throw new RoundCallError('verified_investor_required',403);
  return user;
}
async function input(c: Ctx): Promise<Record<string,unknown>> {
  let value;
  try { value=await c.req.json(); } catch { throw new RoundCallError('invalid_request'); }
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new RoundCallError('invalid_request');
  return value;
}
function id(value: unknown): number {
  const parsed=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  if(!Number.isSafeInteger(parsed)||Number(parsed)<=0) throw new RoundCallError('invalid_project');
  return Number(parsed);
}
function failure(c:Ctx,error:unknown) {
  if(error instanceof RoundCallError) {
    if(error.sentence) return refuse(c,error.status,{code:error.code,message:error.sentence,extra:{code:error.code}});
    return c.json({error:error.code,code:error.code},error.status);
  }
  const message=error instanceof Error?error.message:'';
  if(AUTH_ERROR_STATUSES[message] || message==='step_up_required' || message==='admin_frozen' || message==='branch_suspended') return mapError(c,error);
  return c.json({error:'Round calls are unreadable. Try again.',code:'round_calls_unreadable'},503);
}
// Availability reveals no venture/investor data and lets the lightbox show
// Coming soon before requesting any operational data. Every operational request independently enforces the flag.
routes.get('/availability',async c=>{
  try { await requireAuth(c); return c.json({enabled:roundCallsEnabled(c.env)}); }
  catch(e){return failure(c,e);}
});
// D1222 (#3221, CLS1): readiness from the venture's own Raise records, read
// whether calls are on or off. It returns no investor data, so the flag that
// guards everything below does not apply to it.
routes.get('/readiness',async c=>{
  try { const access=await owner(c,id(c.req.query('project_id')),{members:true,flagFree:true}); return c.json(await ventureReadinessRead(c.env,access.project)); }
  catch(e){return failure(c,e);}
});
routes.use('*',async(c,next)=>{
  if(!roundCallsEnabled(c.env)) return c.json({error:'Coming soon',code:'round_calls_disabled'},503);
  await next();
});
routes.get('/context',async c=>{
  try { const access=await owner(c,id(c.req.query('project_id')),{members:true}); return c.json(await roundContext(c.env,access.project,access.user.id)); }
  catch(e){return failure(c,e);}
});
routes.get('/',async c=>{
  try {
    const user=await requireAuth(c);
    if(user.role==='investor') {
      if(!verifiedInvestor(user)) throw new RoundCallError('verified_investor_required',403);
      const rows=await c.env.DB.prepare("SELECT rc.uid,rc.name,rc.instrument,rc.target_close,rc.state,rc.sent_at FROM round_calls rc JOIN round_call_recipients rr ON rr.call_id=rc.id WHERE rr.investor_user_id=? AND rc.state<>'draft' ORDER BY rc.sent_at DESC,rc.id DESC").bind(user.id).all();
      return c.json({items:rows.results||[]});
    }
    const {project}=await owner(c,id(c.req.query('project_id')),{members:true});
    const rows=await c.env.DB.prepare('SELECT uid,name,instrument,target_close,state,sent_at,created_at FROM round_calls WHERE project_id=? ORDER BY created_at DESC,id DESC').bind(project.id).all();
    return c.json({items:rows.results||[]});
  } catch(e){return failure(c,e);}
});
routes.post('/',async c=>{
  try { const body=await input(c),access=await owner(c,id(body.project_id),{members:true}); return c.json(await saveDraft(c.env,access.project,access.user,body),201); }
  catch(e){return failure(c,e);}
});
// Static queue path must precede /:uid, which accepts 'counsel-queue' as a UID.
routes.get('/counsel-queue',async c=>{
  try { await requireHqAuthoring(c); const user=await requireSuperAdmin(c); return c.json(await counselQueue(c.env,user)); }
  catch(e){return failure(c,e);}
});
routes.get('/:uid',async c=>{
  try {
    const user=await requireAuth(c),call=await loadCall(c.env,(c.req.param('uid') || ''));
    if(user.role==='investor') return c.json(await investorPage(c.env,call,await investor(c)));
    if(user.role==='admin') { await requireHqAuthoring(c); await requireSuperAdmin(c); const page=await founderPage(c.env,call,user); return c.json({...page,viewer:'counsel'}); }
    await owner(c,call.project_id,{members:true}); return c.json(await founderPage(c.env,call,user));
  } catch(e){return failure(c,e);}
});
routes.put('/:uid',async c=>{
  try { const {call,project,user}=await callOwner(c,{members:true}); return c.json(await saveDraft(c.env,project,user,{...call,...await input(c)},call)); }
  catch(e){return failure(c,e);}
});
routes.post('/:uid/audience-preview',async c=>{
  try { const {call}=await callOwner(c),body=await input(c);
    const rows=await audience(c.env,call,body.chosen_prospect_ids,body.include_matches);
    return c.json({...audiencePreview(call,rows),not_on_axal:await notOnAxal(c.env,call,body.chosen_prospect_ids)});
  } catch(e){return failure(c,e);}
});
routes.put('/:uid/audience',async c=>{
  try { const {call,user}=await callOwner(c); return c.json(await saveAudience(c.env,call,user,await input(c))); }
  catch(e){return failure(c,e);}
});
routes.post('/:uid/counsel-request',async c=>{
  try { const {call,user}=await callOwner(c),body=await input(c); return c.json(await requestCounsel(c.env,call,user,body.revision)); }
  catch(e){return failure(c,e);}
});
routes.post('/:uid/send',async c=>{
  try { const {call,user}=await callOwner(c),body=await input(c); return c.json(await sendCall(c.env,call,user,body.acknowledge_missing)); }
  catch(e){return failure(c,e);}
});
routes.post('/:uid/responses',async c=>{
  try { const user=await investor(c),call=await loadCall(c.env,(c.req.param('uid') || '')); return c.json(await respond(c.env,call,user,await input(c))); }
  catch(e){return failure(c,e);}
});
routes.post('/:uid/manage',async c=>{
  try { const {call,user}=await callOwner(c); return c.json(await manageCall(c.env,call,user,await input(c))); }
  catch(e){return failure(c,e);}
});
routes.put('/:uid/questions/:questionUid',async c=>{
  try { const {call,user}=await callOwner(c,{members:true}),body=await input(c); return c.json(await answerQuestion(c.env,call,user,c.req.param('questionUid'),body.answer)); }
  catch(e){return failure(c,e);}
});
// Only HQ can record an actual counsel approval reference. A founder cannot
// set these fields through the draft API. The current hash prevents stale approval.
routes.post('/:uid/counsel-approval',async c=>{
  try { await requireHqAuthoring(c); const user=await requireSuperAdmin(c); await requireStepUp(c);
    const call=await loadCall(c.env,(c.req.param('uid') || '')),body=await input(c);
    return c.json(await recordCounsel(c.env,call,user,body.reference,body.terms_hash,body.revision));
  } catch(e){return failure(c,e);}
});
export default routes;

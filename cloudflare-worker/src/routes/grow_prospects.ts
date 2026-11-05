/** D4492: authenticated Grow customer prospects, marketing consent and per-venture suppression/settings. Nothing sends. */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { addProspect, addSuppression, importProspects, marketingSummary, outreachSettings, prospectDetail, prospectPipeline,
  ProspectsRefused, removeSuppression, saveOutreachSettings, saveProspectConsent, setProspectStatus, suppressionList } from '../services/growProspects';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{Bindings:Env}>;
async function access(c:C,user:User,raw:unknown,write:boolean) {
  if (!/^[1-9]\d*$/.test(String(raw??'')) || !Number.isSafeInteger(Number(raw))) throw new ProspectsRefused(400,'Choose a venture.','project');
  const project=await c.env.DB.prepare('SELECT id,founder_id FROM projects WHERE id=? AND deleted_at IS NULL').bind(Number(raw)).first<{id:number;founder_id:number|null}>();
  if(!project)throw new ProspectsRefused(404,'No such venture.');
  if(!(await canAccessProject(c.env,user,project,{write})))throw new ProspectsRefused(403,write?'You can read this venture but not change it.':'You cannot read this venture.');
  return project.id;
}
type Handler=(c:C,user:User,pid:number,b:Record<string,unknown>)=>Promise<unknown>;
const handle=(write:boolean,fn:Handler,created=false)=>async(c:C)=>{
  try{
    const user=await requireAuth(c);
    const b=write?await c.req.json().catch(()=>c.req.method==='DELETE'?{}:null):{};
    if(!b||typeof b!=='object'||Array.isArray(b))throw new ProspectsRefused(400,'Send the form fields.');
    const pid=await access(c,user,write?b.project??c.req.query('project'):c.req.query('project'),write);
    return c.json(await fn(c,user,pid,b) as any,created?201:200);
  }catch(error){
    if(error instanceof Response)return error;
    if(error instanceof ProspectsRefused)return c.json({detail:error.sentence,...(error.field?{field:error.field}:{})},error.status as any);
    if(error instanceof Error&&error.message==='Unauthorized')return c.json({detail:'Sign in to continue.'},401);
    return c.json({detail:write?'Prospects could not be saved. Reload before trying again.':'Prospects could not be read. Try again.'},503);
  }
};
router.get('/',handle(false,(c,_u,p)=>prospectPipeline(c.env,p,{source:c.req.query('source'),campaign:c.req.query('campaign'),per_status:c.req.query('per_status')})));
router.get('/settings',handle(false,(c,_u,p)=>outreachSettings(c.env,p)));
router.put('/settings',handle(true,(c,u,p,b)=>saveOutreachSettings(c.env,p,u,b)));
router.get('/suppressions/count',handle(false,(c,_u,p)=>suppressionList(c.env,p)));
router.post('/suppressions',handle(true,(c,u,p,b)=>addSuppression(c.env,p,u,b),true));
router.delete('/suppressions/:id',handle(true,(c,u,p)=>removeSuppression(c.env,p,u,(c.req.param('id') || ''))));
router.get('/consent-summary',handle(false,(c,_u,p)=>marketingSummary(c.env,p,c.req.query('segment'))));
router.post('/import',handle(true,(c,u,p,b)=>importProspects(c.env,p,u,b)));
router.post('/',handle(true,(c,u,p,b)=>addProspect(c.env,p,u,b),true));
router.put('/:contactUid/consent/:channel',handle(true,(c,u,p,b)=>saveProspectConsent(c.env,p,u,(c.req.param('contactUid') || ''),(c.req.param('channel') || ''),b)));
router.patch('/:contactUid/status',handle(true,(c,u,p,b)=>setProspectStatus(c.env,p,u,(c.req.param('contactUid') || ''),b)));
router.get('/:contactUid',handle(false,(c,_u,p)=>prospectDetail(c.env,p,(c.req.param('contactUid') || ''))));
export const mount = { path: '/api/grow/prospects', router: router };
export default router;

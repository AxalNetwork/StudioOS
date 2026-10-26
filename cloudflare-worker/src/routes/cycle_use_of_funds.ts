/** D1176 / #3103. Human writes only; Mercury's cached facts stay founder-only. */
import { Hono } from 'hono';
import type { Env,User } from '../types';
import { requireAuth } from '../auth';
import { canWrite } from './_founder_validate_helpers';
import { activeCompanyFor } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { isSupportSession } from '../integrations/providers/mercury';
import { base,fields,hires,idOf,makeBase,milestone,obj,PlanError,saveHire,saveMilestone,saveScenario,saveSplit,scenario,deleteScenario,view,type Scope } from '../services/useOfFunds/store';
import { planRead,runwayToday } from '../services/useOfFunds/read';

const r=new Hono<{Bindings:Env;Variables:{uof:Scope;mercury:boolean}}>();
r.use('*',async(c,next)=>{
  let user:User;
  try { user=await requireAuth(c as any) as User; } catch { return c.json({code:'unauthorized',detail:'Sign in first.'},401); }
  const pid=idOf(c.req.query('project'));
  const project=await c.env.DB.prepare('SELECT id,founder_id,company_id FROM projects WHERE id=? AND deleted_at IS NULL').bind(pid).first<any>();
  if (!project) return c.json({code:'not_found',detail:'Project not found.'},404);
  if (!canWrite(project,user)) return c.json({code:'forbidden',detail:'Use of funds is available to the venture founder or an admin.'},403);
  const support=await isSupportSession(c as any);
  if (support&&c.req.method!=='GET') return c.json({code:'support_read_only',detail:'A support session cannot change the plan.'},403);
  const company=await activeCompanyFor(c,user);
  if (!projectInActiveCompany(company,project)) return c.json({code:'not_found',detail:'Project not found.'},404);
  const owner=await c.env.DB.prepare("SELECT id FROM users WHERE founder_id=? AND role='founder' AND is_active=1 ORDER BY id LIMIT 1").bind(project.founder_id).first<{id:number}>();
  if (!owner) return c.json({code:'owner_unavailable',detail:'The active founder for this plan is Not recorded.'},409);
  c.set('uof',{projectId:pid,user,founderUserId:owner.id,readOnly:support});
  c.set('mercury',user.role==='founder'&&Number(user.founder_id)===Number(project.founder_id)&&!support);
  await next();
});
r.onError((e,c)=> e instanceof PlanError ? c.json({code:e.code,detail:e.sentence,...(e.recovery?{recovery:e.recovery}:{})},e.status as any)
  : c.json({code:'unreadable',detail:'Use of funds is Unreadable. Read the plan before retrying this change.'},503));
const body=async(c:any)=>{
  const b=await c.req.json().catch(()=>null);
  if (!obj(b)) throw new PlanError(400,'invalid_plan','Send a plan object. Nothing was saved.');
  return b;
};
r.get('/plan',async c=>c.json(await planRead(c.env,c.get('uof'),c.get('mercury'))));
r.get('/scenarios',async c=>{
  const s=c.get('uof'); await base(c.env,s);
  const rows=await c.env.DB.prepare('SELECT * FROM uof_scenarios WHERE project_id=? ORDER BY is_base DESC,id').bind(s.projectId).all<any>();
  return c.json({items:await Promise.all((rows.results??[]).map(row=>view(c.env,s,row)))});
});
r.get('/scenarios/:id',async c=>c.json(await view(c.env,c.get('uof'),await scenario(c.env,c.get('uof'),idOf(c.req.param('id'))))));
r.post('/scenarios',async c=>c.json(await saveScenario(c.env,c.get('uof'),null,await body(c)),201));
r.patch('/scenarios/:id',async c=>c.json(await saveScenario(c.env,c.get('uof'),idOf(c.req.param('id')),await body(c))));
r.delete('/scenarios/:id',async c=>c.json(await deleteScenario(c.env,c.get('uof'),idOf(c.req.param('id')))));
r.post('/scenarios/:id/make-base',async c=>{
  // Confirmation supplies no replacement financial data; the saved scenario is promoted.
  if (c.req.header('content-length')!=='0'&&c.req.header('content-type')?.includes('json')) fields(await body(c),[]);
  return c.json(await makeBase(c.env,c.get('uof'),idOf(c.req.param('id'))));
});
r.get('/compare',async c=>{
  const raw=c.req.query('ids')??'';
  if (!/^[1-9][0-9]{0,9}(,[1-9][0-9]{0,9}){0,3}$/.test(raw)) throw new PlanError(400,'invalid_ids','Choose one to four scenario ids.');
  const ids=raw.split(',').map(idOf);
  if (new Set(ids).size!==ids.length) throw new PlanError(400,'invalid_ids','Choose each scenario once.');
  const s=c.get('uof');
  const items=await Promise.all(ids.map(async id=>view(c.env,s,await scenario(c.env,s,id))));
  return c.json({today:await runwayToday(c.env,s,c.get('mercury')),scenarios:items,source:'Modelled',reason:'Today is the measured record. Scenarios are models, not runway today.'});
});
r.get('/milestones',async c=>{
  const s=c.get('uof');const sc=await scenario(c.env,s,c.req.query('scenario_id')==null?await base(c.env,s):idOf(c.req.query('scenario_id')));
  const v=await view(c.env,s,sc); return c.json({scenario_id:sc.id,items:v.milestones});
});
r.get('/milestones/:id',async c=>{
  const m=await milestone(c.env,c.get('uof'),idOf(c.req.param('id')));
  return c.json({...m,source:({typed:'Typed',connector:'Connector',document:'Document',signed:'Signed'} as Record<string,string>)[m.source_label]??'Recorded',cost_state:m.cost_cents===null?'not_costed':'recorded'});
});
r.post('/milestones',async c=>c.json(await saveMilestone(c.env,c.get('uof'),null,await body(c)),201));
r.patch('/milestones/:id',async c=>c.json(await saveMilestone(c.env,c.get('uof'),idOf(c.req.param('id')),await body(c))));
r.delete('/milestones/:id',async c=>c.json(await saveMilestone(c.env,c.get('uof'),idOf(c.req.param('id')),{},true)));
r.get('/hires',async c=>c.json({items:(await hires(c.env,c.get('uof'))).map(h=>({...h,source:'Typed'}))}));
r.patch('/hires/:id',async c=>c.json(await saveHire(c.env,c.get('uof'),idOf(c.req.param('id')),await body(c))));
r.delete('/hires/:id',async c=>c.json(await saveHire(c.env,c.get('uof'),idOf(c.req.param('id')),{},true)));
r.put('/',async c=>c.json(await saveSplit(c.env,c.get('uof'),await body(c))));
/** D1177 (#3104): the plan's history (UF15), newest first, 20 a page. Mercury rows are the founder's alone. */
r.get('/history',async c=>{
  const s=c.get('uof'); const mercury=c.get('mercury');
  const page=Math.max(1,Math.min(1000,Number.parseInt(String(c.req.query('page')??'1'),10)||1));
  const [count,rows]=await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM activity_logs a
      WHERE a.project_id=? AND a.entity_type='raise.use-of-funds' AND (?=1 OR a.action NOT LIKE 'mercury%')`).bind(s.projectId,mercury?1:0).first<{n:number}>(),
    c.env.DB.prepare(`SELECT a.id,a.action,a.details,a.created_at,u.name AS who,u.role AS who_role FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.project_id=? AND a.entity_type='raise.use-of-funds' AND (?=1 OR a.action NOT LIKE 'mercury%')
      ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?`).bind(s.projectId,mercury?1:0,(page-1)*20).all<any>(),
  ]);
  return c.json({page,page_size:20,total:Number(count?.n??0),items:(rows.results??[]).map(x=>({
    id:x.id,action:x.action,summary:x.details??null,at:x.created_at,who:x.who??null,admin:x.who_role==='admin',
  }))});
});
export default r;

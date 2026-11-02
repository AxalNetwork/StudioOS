/** D1614 W1 (#3969). Mounted under agent_engine's /api/teams only after the
 * issue's shared-file coordination clears. E1 company handlers keep their paths.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { canRead, loadScope, scopeOfAgent } from '../services/agents/teams';
import { taskByUid } from '../services/agents/tasks';
import { createWorkTask, projectBoard, setWorkDeps, updateWorkTask, workCards, WorkRefusal, NO_WORK_RUNS_RECORDED, type WorkRunReader, type WorkTask } from '../services/agents/workBoard';

type C = Context<{ Bindings: Env }>;
async function body(c: C) {
  let b: unknown; try { b = await c.req.json(); } catch { /* malformed body */ }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new WorkRefusal(400,'invalid_task','Send a task object.');
  return b as Record<string,any>;
}
function failure(c: C, e: unknown) {
  if (e instanceof WorkRefusal) return refuse(c,e.status,{code:e.code,message:e.sentence,extra:e.blockers?{blockers:e.blockers}:undefined});
  return mapError(c,e);
}
const absent = () => new WorkRefusal(404,'not_found','There is no project board or task here.');
async function visible(c: C, user: User) {
  const t = await taskByUid(c.env,c.req.param('uid')??'') as WorkTask | null;
  if (!t) throw absent();
  const s = await scopeOfAgent(c.env,t);
  if (!s || !(await canRead(c.env,s,user))) throw absent();
  return {t,s};
}

export function workBoardRoutes(enabled: (env: Env) => boolean, readRuns: WorkRunReader = NO_WORK_RUNS_RECORDED) {
  const router = new Hono<{Bindings:Env}>();
  const off = (c: C) => c.json({error:'agent_engine_off'},404);
  router.get('/:scope/:id/work/board',async(c)=>{
    try {
      if(!enabled(c.env)) return off(c);
      const user=await requireAuth(c);
      if(c.req.param('scope')!=='project') throw absent();
      const s=await loadScope(c.env,'project',c.req.param('id'));
      if(!s||s.kind!=='project') throw absent();
      if(!(await canRead(c.env,s,user))) return refuse(c,403,{code:'not_member',message:'Only the project team can read its Work.'});
      return c.json(await projectBoard(c.env,s,c.req.query('filter')??'',readRuns,c.req.query('sort')??''));
    }catch(e){return failure(c,e);}
  });
  // Only project tasks are intercepted. Company E1 handlers are unchanged.
  router.post('/:scope/:id/tasks',async(c,next)=>{
    if(c.req.param('scope')!=='project') return next();
    try {
      if(!enabled(c.env)) return off(c);
      const user=await requireAuth(c),s=await loadScope(c.env,'project',c.req.param('id'));
      if(!s||s.kind!=='project') throw absent();
      const t=await createWorkTask(c.env,s,await body(c),user);
      return c.json({task:(await workCards(c.env,[t],readRuns))[0]},201);
    }catch(e){return failure(c,e);}
  });
  router.get('/tasks/:uid',async(c)=>{
    try {
      if(!enabled(c.env)) return off(c);
      const user=await requireAuth(c),{t,s}=await visible(c,user);
      if(s.kind!=='project') throw absent();
      return c.json({task:(await workCards(c.env,[t],readRuns))[0]});
    }catch(e){return failure(c,e);}
  });
  router.patch('/tasks/:uid/move',async(c)=>{
    try {
      if(!enabled(c.env)) return off(c);
      const user=await requireAuth(c),{t,s}=await visible(c,user);
      if(s.kind!=='project') throw absent();
      const b=await body(c);
      if(Object.keys(b).some(k=>!['column','board_column','position','close_reason','duplicate_of'].includes(k))||(!('column'in b)&&!('board_column'in b))) throw new WorkRefusal(400,'invalid_task','Send a column and optional position or close reason.');
      const fresh=await updateWorkTask(c.env,t,b,{user});
      return c.json({task:(await workCards(c.env,[fresh],readRuns))[0]});
    }catch(e){return failure(c,e);}
  });
  router.patch('/tasks/:uid',async(c,next)=>{
    try {
      if(!enabled(c.env)) return off(c);
      const user=await requireAuth(c),{t,s}=await visible(c,user);
      if(s.kind==='company') return next();
      const fresh=await updateWorkTask(c.env,t,await body(c),{user});
      return c.json({task:(await workCards(c.env,[fresh],readRuns))[0]});
    }catch(e){return failure(c,e);}
  });
  router.put('/tasks/:uid/deps',async(c,next)=>{
    try {
      if(!enabled(c.env)) return off(c);
      const user=await requireAuth(c),{t,s}=await visible(c,user);
      if(s.kind==='company') return next();
      const fresh=await setWorkDeps(c.env,t,(await body(c)).depends_on,user);
      return c.json({task:(await workCards(c.env,[fresh],readRuns))[0]});
    }catch(e){return failure(c,e);}
  });
  return router;
}

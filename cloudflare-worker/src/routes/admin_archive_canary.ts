/** D5676: HQ write-bar owned synthetic archive input, with expectation persisted in an independent observer before the marker is logged. */
import { Hono } from 'hono';import adminPlatform from './admin_platform';import admin from './admin';import type { Env } from '../types';import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdminWriteBar } from '../auth';import { logAdminAction } from '../services/adminAudit';
import { archiveMac,boundedArchiveText } from '../../../cloudflare-worker-tail/src/protocol';
type CanaryEnv=Env&{ARCHIVE_CANARY_ENABLED?:string;ARCHIVE_OBSERVER?:Fetcher;ARCHIVE_PRODUCER_SECRET?:string};
const r=new Hono<{Bindings:CanaryEnv}>();
r.post('/',async c=>{
 const actor=await requireSuperAdminWriteBar(c);
 if(c.env.ARCHIVE_CANARY_ENABLED!=='on'||!c.env.ARCHIVE_OBSERVER||(c.env.ARCHIVE_PRODUCER_SECRET?.length??0)<32)return c.json({error:'archive_canary_disabled'},409);
 const marker=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''),now=Date.now(),path='/expect';
 const raw=JSON.stringify({marker,expected_ms:now,due_ms:now+120000});
 try{
  const response=await c.env.ARCHIVE_OBSERVER.fetch('https://archive-observer.internal'+path,{method:'POST',body:raw,redirect:'error',headers:{'x-archive-timestamp':String(now),'x-archive-signature':await archiveMac(c.env.ARCHIVE_PRODUCER_SECRET!,path,raw,now)},signal:AbortSignal.timeout(3000)});
  if(!response.ok||JSON.parse(await boundedArchiveText(response,1024)).accepted!==true)return c.json({error:'archive_expectation_unavailable'},503);
  await logAdminAction(c.env,actor.id,actor.email,'archive_canary_expected',{synthetic:true});
  console.info(JSON.stringify({archive_canary:marker}));
  return c.json({accepted:true,deadline_ms:now+120000});
 }catch{return c.json({error:'archive_expectation_unavailable'},503);}
});
export const mount:RouteMount={path:'/api/admin/platform/archive-canary',router:r,before:[adminPlatform,admin]};export default r;

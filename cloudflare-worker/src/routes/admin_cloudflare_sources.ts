/** D5673: Super Admin Cloudflare source inspection and opt-in metadata reconciliation; never sends Slack or changes a provider deployment. */
import { Hono } from 'hono';
import adminPlatform from './admin_platform';
import admin from './admin';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { branchOf } from '../util/branch';
import { CF_SCRIPTS } from '../services/cloudflareSourceReceipt';
import { cfReadApi, reconcileCfScript } from '../services/cloudflareDeployments';
import { d1CfSourceStore, pendingCfSourceReceipts } from '../services/cloudflareSourceStore';
import { logAdminAction } from '../services/adminAudit';
type SourceEnv=Env & { CF_SOURCE_POLL?:string; CF_OBSERVER_READ_TOKEN?:string };
const r=new Hono<{Bindings:SourceEnv}>();
r.get('/',async c=>{
  await requireSuperAdmin(c);c.header('Cache-Control','private, no-store');if(branchOf(c.env))return c.json({error:'hq_only'},403);
  try{return c.json({state:'observed',receipts:await pendingCfSourceReceipts(c.env.DB),delivery:'not_configured',poll_enabled:c.env.CF_SOURCE_POLL==='on'});}
  catch{return c.json({error:'cf_source_unreadable'},503);}
});
r.post('/reconcile',async c=>{
  const actor=await requireSuperAdminWriteBar(c);if(branchOf(c.env))return c.json({error:'hq_only'},403);
  if(c.env.CF_SOURCE_POLL!=='on')return c.json({error:'cf_source_disabled'},409);
  if(!c.env.CF_OBSERVER_READ_TOKEN||!c.env.CLOUDFLARE_ACCOUNT_ID)return c.json({error:'cf_source_prerequisite_missing'},503);
  // Deliberately separate read-only token; never reuse the Worker's script-edit credential.
  const readApi=cfReadApi(c.env.CLOUDFLARE_ACCOUNT_ID,c.env.CF_OBSERVER_READ_TOKEN),store=d1CfSourceStore(c.env.DB),now=Date.now();
  try{
    if((await store.read('deployments:studioos')).through_ms>now-60000){c.header('Retry-After','60');return c.json({error:'cf_source_rate_limited'},429);}
    const result=[];for(const script of CF_SCRIPTS)result.push({script,...await reconcileCfScript({script,now,readApi,store})});
    await logAdminAction(c.env,actor.id,actor.email,'cloudflare_sources_reconciled',{scripts:result.length});
    return c.json({state:result.some(r=>r.state!=='observed')?'unknown':'observed',sources:result,delivery:'not_configured'});
  }catch{return c.json({error:'cf_source_unavailable'},503);}
});
export const mount:RouteMount={path:'/api/admin/platform/cloudflare-sources',router:r,before:[adminPlatform,admin]};
export default r;

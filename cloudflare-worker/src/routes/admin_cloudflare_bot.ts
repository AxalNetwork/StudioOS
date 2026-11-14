/** D5674: HQ-only content-free meeting source/preflight evidence; no customer recording or Slack message is triggered by a read. */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import adminPlatform from './admin_platform';
import admin from './admin';
import { readBotSourceEvidence } from '../services/cloudflareBotHealth';
const r=new Hono<{Bindings:Env}>();
r.get('/',async c=>{await requireSuperAdmin(c);c.header('Cache-Control','private, no-store');try{return c.json(await readBotSourceEvidence(c.env));}catch{return c.json({error:'bot_source_unreadable'},503);}});
export const mount:RouteMount={path:'/api/admin/platform/cloudflare-bot',router:r,before:[adminPlatform,admin]};
export default r;

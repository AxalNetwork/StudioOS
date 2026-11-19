/**
 * Research › Markets global sourced observations (D7318, #7318): the market-data sources, one country's observations,
 * the CSV export and the World Bank refresh, under /api/research/market-data. Mounts itself (#4105) just ahead of
 * research_sectors, where its hand-written line sat.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ingestWorldBank } from '../services/researchMarketData';
import researchSectors from './research_sectors';
import type { RouteMount } from '../util/routeRegistry';

const app=new Hono<{Bindings:Env}>();
const safeCode=(v:string)=>/^[A-Z]{3}$/.test(v.toUpperCase())?v.toUpperCase():null;

app.get('/market-data/sources',async c=>{
  await requireAuth(c);
  const r=await c.env.DB.prepare('SELECT id,name,source_url,dataset_or_edition,methodology_url,license_or_usage_note,refresh_policy,enabled,last_success_at,last_attempt_at,last_error FROM research_market_sources ORDER BY name').all();
  return c.json({items:r.results ?? []});
});
app.get('/market-data/countries/:code',async c=>{
  await requireAuth(c);
  const code=safeCode(c.req.param('code')); if(!code) return c.json({detail:'ISO-3 country code required'},400);
  const r=await c.env.DB.prepare(
    `SELECT o.id,o.metric_key,o.metric_label,o.period,o.value,o.unit,o.observation_status,o.published_at,o.retrieved_at,o.confidence,o.vintage,
            o.supersedes_observation_id,s.id source_id,s.name source_name,s.source_url,s.dataset_or_edition,s.methodology_url,s.license_or_usage_note
       FROM research_market_observations o JOIN research_market_sources s ON s.id=o.source_id
      WHERE o.geography_type='country' AND o.geography_code=?
      ORDER BY o.metric_key,o.period DESC,o.retrieved_at DESC`
  ).bind(code).all();
  return c.json({geography_type:'country',geography_code:code,items:r.results ?? []});
});
app.get('/market-data/export.csv',async c=>{
  await requireAuth(c);
  const code=c.req.query('country')?safeCode(c.req.query('country')!):null;
  if(c.req.query('country') && !code) return c.json({detail:'ISO-3 country code required'},400);
  const sql=`SELECT o.source_id,s.name source_name,s.source_url,s.dataset_or_edition source_dataset_or_edition,
    o.metric_key,o.metric_label,o.geography_type,o.geography_code,o.period,o.value,o.unit,o.observation_status,
    o.published_at,o.retrieved_at,s.methodology_url,s.license_or_usage_note,o.confidence,o.vintage,o.supersedes_observation_id
    FROM research_market_observations o JOIN research_market_sources s ON s.id=o.source_id
    ${code?"WHERE o.geography_code=?":''} ORDER BY o.geography_code,o.metric_key,o.period`;
  const r=code?await c.env.DB.prepare(sql).bind(code).all():await c.env.DB.prepare(sql).all();
  const rows=r.results ?? []; const cols=['source_id','source_name','source_url','source_dataset_or_edition','metric_key','metric_label','geography_type','geography_code','period','value','unit','observation_status','published_at','retrieved_at','methodology_url','license_or_usage_note','confidence','vintage','supersedes_observation_id'];
  const esc=(v:any)=>'"'+String(v??'').replace(/"/g,'""')+'"';
  return new Response([cols.join(','),...rows.map((x:any)=>cols.map(k=>esc(x[k])).join(','))].join('\n'),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="research-market-data.csv"'}});
});
app.post('/market-data/refresh/world-bank',async c=>{
  await requireAuth(c);
  const body=await c.req.json().catch(()=>({})) as any;
  return c.json(await ingestWorldBank(c.env,{from:Number.isInteger(body.from)?body.from:undefined,to:Number.isInteger(body.to)?body.to:undefined}),202);
});
export default app;
export const mount: RouteMount = { path: '/api/research', router: app, before: [researchSectors] };

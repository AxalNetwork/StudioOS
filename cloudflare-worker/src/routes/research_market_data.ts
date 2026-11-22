/**
 * Research › Markets global sourced observations (D7318, #7318): the market-data sources, one country's observations,
 * and the CSV export (operator imports are in admin_market_observation_imports.ts), under /api/research/market-data. Mounts itself (#4105) just ahead of
 * research_sectors, where its hand-written line sat.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import researchSectors from './research_sectors';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { csvResponse } from '../services/csv';
import { ObservationQueryError, exportObservations, marketDataExportFilters, observationsCsv } from '../services/researchObservations';

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
  // D7716: one format and one export rule with /api/research/observations/export.csv; every vintage, as before.
  try {
    const { rows, omitted } = await exportObservations(c.env, marketDataExportFilters(code));
    return csvResponse(observationsCsv(rows), 'research-market-data.csv', { 'X-Export-Rows': String(rows.length), 'X-Export-Omitted': JSON.stringify(omitted) });
  } catch (error) {
    if (error instanceof ObservationQueryError) return refuse(c, error.status, { code: error.code, message: error.message });
    throw error;
  }
});
export default app;
export const mount: RouteMount = { path: '/api/research', router: app, before: [researchSectors] };

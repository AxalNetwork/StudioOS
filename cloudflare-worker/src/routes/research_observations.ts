/**
 * Research market observations (D7716, #7716): the general query over the observation store, under
 * `/api/research/observations` — the paged list, the metric catalogue, the CSV export, and one observation with its
 * source, labelled dates and revision chain. Every handler requires a signed-in user; the rows are sourced public
 * statistics, not anyone's record. Mounts itself (#4105) beside research_market_data.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { csvResponse, stamp } from '../services/csv';
import researchSectors from './research_sectors';
import type { RouteMount } from '../util/routeRegistry';
import {
  ObservationQueryError, exportObservations, listMetrics, listObservations, observationsCsv, parseFilters, readObservation,
} from '../services/researchObservations';

const app = new Hono<{ Bindings: Env }>();

const refusal = (c: any, error: unknown) => {
  if (error instanceof ObservationQueryError) return refuse(c, error.status, { code: error.code, message: error.message });
  throw error;
};

app.get('/observations', async c => {
  await requireAuth(c);
  try { return c.json(await listObservations(c.env, parseFilters(c.req.query()))); }
  catch (error) { return refusal(c, error); }
});

app.get('/observations/metrics', async c => {
  await requireAuth(c);
  return c.json({ items: await listMetrics(c.env) });
});

app.get('/observations/export.csv', async c => {
  await requireAuth(c);
  try {
    const { rows, omitted } = await exportObservations(c.env, parseFilters(c.req.query()));
    return csvResponse(observationsCsv(rows), `research-observations-${stamp()}.csv`, {
      'X-Export-Rows': String(rows.length), 'X-Export-Omitted': JSON.stringify(omitted),
    });
  } catch (error) { return refusal(c, error); }
});

app.get('/observations/:id', async c => {
  await requireAuth(c);
  const raw = c.req.param('id');
  const id = /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id)) return refuse(c, 400, { code: 'invalid_observation_id', message: 'An observation is named by its number.' });
  const found = await readObservation(c.env, id);
  if (!found) return refuse(c, 404, { code: 'observation_not_found', message: 'There is no such observation.' });
  return c.json(found);
});

export default app;
export const mount: RouteMount = { path: '/api/research', router: app, before: [researchSectors] };

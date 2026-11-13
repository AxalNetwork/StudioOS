/**
 * D1067 (#2937): the plan's pause and resume, and "new evidence since the
 * plan" (VB13). Mounted before D1065's router at `/api/cycles/build/plan`.
 *
 *   POST /pause?project=N&scope=venture|h-N   → { status: 'paused' }
 *   POST /resume?project=N&scope=…            → { status: 'open' | 'draft' }
 *                                               409 plan_stopped while a given Stop stands
 *   GET  /since?project=N&scope=…             → { plan, status, changed, new, contradicting }
 *
 * Pause and resume are the venture's founder's (D1065's write gate); an admin
 * reads `since`, a partner never does: it describes the private plan.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { BuildPlanError } from '../services/buildPlanner';
import { evidenceSince, pausePlan, resumePlan } from '../services/buildPlanState';
import { context, refusal } from './build_plan';

const app = new Hono<{ Bindings: Env }>();

async function run(c: any, write: boolean, work: (projectId: number, scope: string) => Promise<unknown>) {
  try {
    const ctx = await context(c, write);
    if (ctx instanceof Response) return ctx;
    if (ctx.partner) return c.json({ code: 'not_this_project', detail: 'This plan belongs to the venture’s founders.' }, 404);
    return c.json(await work(ctx.projectId, ctx.scope));
  } catch (e) {
    if (e instanceof BuildPlanError) return refusal(c, e);
    console.warn('[build-plan] state unavailable');
    return c.json({ code: 'unreadable', detail: 'The build plan could not be read or changed. Try again.' }, 503);
  }
}

app.post('/pause', (c) => run(c, true, (p, s) => pausePlan(c.env, p, s)));
app.post('/resume', (c) => run(c, true, (p, s) => resumePlan(c.env, p, s)));
app.get('/since', (c) => run(c, false, (p, s) => evidenceSince(c.env, p, s)));

export default app;

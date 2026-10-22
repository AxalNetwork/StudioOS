/**
 * D845 (#2471) — a member's own usage reports (plan §3):
 *
 *   GET /api/developer/usage          ?from&to&group=day|key|provider|connector|tool|model&by=&key=&cursor=
 *                                      → { recorded, recorded_since, range, group, by, key, totals, groups[], next_cursor }
 *   GET /api/developer/usage/events   ?from&to&key&outcome&surface&operation&provider&connector&company&cursor=
 *                                      → { range, events[], next_cursor }: newest first, 100 a page
 *
 * Signed in with a session (`requireAuth`). Every read is the caller's own
 * rows (`services/apiUsageReport.ts`); a `key=` that is not theirs answers 404
 * `unknown_key`, the same as a key that does not exist. Reads only, so a
 * support session may read them. No argument, result or provider cost is in
 * any response.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ReportInputError, usageEvents, usageReport } from '../services/apiUsageReport';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';

export const developerUsage = new Hono<{ Bindings: Env }>();

developerUsage.onError((error, c) => {
  if (error instanceof ReportInputError) {
    return c.json({ error: error.code, message: error.sentence }, error.code === 'unknown_key' ? 404 : 400);
  }
  const status = AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c, status, { code: 'usage_access_refused', message: 'This account cannot read that usage report.' });
  return refuse(c, 503, { code: 'usage_unreadable', message: 'Unreadable: your usage could not be read.', raw: error, audience: 'member' });
});

developerUsage.get('/', async (c) => {
  const user = await requireAuth(c);
  const q = c.req.query();
  return c.json(await usageReport(c.env, user.id, {
    from: q.from, to: q.to, group: q.group, by: q.by, key: q.key, cursor: q.cursor,
  }));
});

developerUsage.get('/events', async (c) => {
  const user = await requireAuth(c);
  const q = c.req.query();
  return c.json(await usageEvents(c.env, user.id, {
    from: q.from, to: q.to, key: q.key, outcome: q.outcome, surface: q.surface, operation: q.operation,
    provider: q.provider, connector: q.connector, company: q.company, cursor: q.cursor,
  }));
});

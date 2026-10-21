/** D811. Only the Mail service HMAC authenticates this surface. No session authority. */
import { Hono } from 'hono';
import { mailLinkAuth } from '../middleware/mailLink';
import type { MailLinkEnv } from '../middleware/mailLink';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { audienceList, audienceRecipients, parseAudience, readCursor } from '../services/mailLinkAudiences';
import { applyMailEvents, parseMailEvents } from '../services/mailLinkEvents';

const app = new Hono<MailLinkEnv>();
// This router mounts before browser/session middleware. Even a failing rate
// store or an ambient browser cookie must not change the unconfigured 404.
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!c.env.MAIL_LINK_SECRET) return c.notFound();
  c.set('currentUser', null);
  await next();
});
app.use('*', rateLimitMiddleware());
app.use('*', mailLinkAuth());
app.onError((_error, c) => c.json({ error: 'mail_link_unreadable', detail: 'The Mail link store is unreadable. Retry with a new signature.' }, 503));
app.get('/health', c => c.json({ ok: true, version: '1' }));
app.get('/audiences', async c => {
  const items = await audienceList(c.env);
  if (items.length) await c.env.DB.prepare(`INSERT INTO mail_link_reads (audience, count)
    SELECT json_extract(value, '$.key'), json_extract(value, '$.count') FROM json_each(?)`
  ).bind(JSON.stringify(items.map(({ key, count }) => ({ key, count })))).run();
  return c.json({ items });
});
app.get('/audiences/:key/recipients', async c => {
  const key = c.req.param('key');
  const audience = parseAudience(key);
  if (!audience) return c.json({ error: 'invalid_audience', detail: 'Choose an audience returned by /audiences.' }, 400);
  const after = readCursor(key, c.req.query('cursor'));
  if (after === null) return c.json({ error: 'invalid_cursor', detail: 'Use the next_cursor from this audience.' }, 400);
  const result = await audienceRecipients(c.env, audience, after);
  await c.env.DB.prepare('INSERT INTO mail_link_reads (audience, count) VALUES (?, ?)').bind(key, result.recipients.length).run();
  return c.json(result);
});
app.post('/events', async c => {
  const events = await parseMailEvents(c.get('mailLinkBody'));
  if (!events) return c.json({ error: 'invalid_events', detail: 'Provide 1–500 valid events with type, email, at and optional audience and message_id.' }, 400);
  return c.json({ ok: true, accepted: await applyMailEvents(c.env, events) });
});
export default app;

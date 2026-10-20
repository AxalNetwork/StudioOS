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
  if (items.length) await c.env.DB.batch(items.map(a => c.env.DB.prepare(
    'INSERT INTO mail_link_reads (audience, count) VALUES (?, ?)',
  ).bind(a.key, a.count)));
  return c.json({ items, unavailable: [{ key: 'testers', reason: 'Programme-scoped unsubscribe links await the D811 consent decision.' }] });
});
app.get('/audiences/:key/recipients', async c => {
  const key = c.req.param('key');
  if (key.startsWith('testers:')) return c.json({ error: 'tester_links_pending', detail: 'Programme-scoped unsubscribe links await the D811 consent decision.' }, 503);
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

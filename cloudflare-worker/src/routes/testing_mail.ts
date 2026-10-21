/** D811: the existing D810 lightweight signed-link form pattern, scoped to one programme. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { tokenKey } from '../services/newsletter';
import { testerFromToken, testerLinks, testerDeliveryBlocked, saveTesterPreference } from '../services/mailLinkTesters';
import { escapeHtml } from '../services/email';
import { CONSENT_TEXT } from '../services/testing';

const app = new Hono<{ Bindings: Env }>();
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  if (!tokenKey(c.env)) return c.json({ error: 'newsletter_unconfigured', detail: 'Signed email links are not configured.' }, 503);
  c.set('currentUser' as never, null as never);
  await next();
});
app.use('*', rateLimitMiddleware());
app.onError((_e, c) => c.json({ error: 'testing_mail_unreadable', detail: 'Programme email preferences are unreadable. Try again.' }, 503));
const badLink = (c: any) => c.json({ error: 'invalid_token', detail: 'Use the link in your latest programme email.' }, 403);

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Axal VC</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
for (const path of ['/preferences', '/unsubscribe']) {
  app.get(path, async c => {
    const row = await testerFromToken(c.env, c.req.query('token'));
    if (!row) return badLink(c);
    const blocked = await testerDeliveryBlocked(c.env, row.email);
    const enabled = row.mail_enabled === 1;
    if (!(c.req.header('Accept') || '').includes('text/html')) return c.json({ programme: { uid: row.programme_uid, name: row.product_name }, email_enabled: enabled, delivery_blocked: blocked, ...await testerLinks(c.env, row) });
    const action = `${c.req.path}?token=${encodeURIComponent(c.req.query('token') || '')}`;
    const form = path === '/unsubscribe'
      ? `<p>Stop emails about ${escapeHtml(row.product_name)}?</p><form method="post" action="${escapeHtml(action)}"><button type="submit">Unsubscribe</button></form>`
      : `<p>${escapeHtml(row.product_name)}</p><p>Programme emails: ${enabled ? 'on' : 'off'}.</p>${blocked ? '<p>Email is currently suppressed for this address.</p>' : ''}<p>${escapeHtml(CONSENT_TEXT)}</p><form method="post" action="${escapeHtml(action)}"><button name="enabled" value="${enabled ? 'false' : 'true'}">${enabled ? 'Turn off programme emails' : 'Turn on programme emails'}</button></form>`;
    return c.html(page(path === '/unsubscribe' ? 'Unsubscribe' : 'Programme email preferences', form));
  });
}
for (const method of ['POST', 'PUT']) {
  app.on(method, ['/preferences', '/unsubscribe'], async c => {
    const token = c.req.query('token');
    const row = await testerFromToken(c.env, token);
    if (!row) return badLink(c);
    let enabled = false;
    if (c.req.path.endsWith('/preferences')) {
      const body = (c.req.header('Content-Type') || '').includes('application/json') ? await c.req.json().catch(() => null) : await c.req.parseBody();
      if (!body || ![true, false, 'true', 'false'].includes(body.enabled)) return c.json({ error: 'invalid_preferences', detail: 'Provide enabled as a boolean.' }, 400);
      enabled = body.enabled === true || body.enabled === 'true';
      if (enabled && (row.status !== 'picked' || !row.consent_email_at)) return c.json({ error: 'programme_not_eligible', detail: 'Only picked, consented testers can turn these emails on.' }, 403);
    }
    const changed = await saveTesterPreference(c.env, row, enabled);
    // Re-enabling retires old tokens; build the answer from the fresh row.
    const fresh = await c.env.DB.prepare('SELECT mail_enabled, mail_token_version FROM testing_applications WHERE id = ?').bind(row.id).first<{ mail_enabled: number; mail_token_version: number }>();
    if (!fresh || fresh.mail_token_version !== row.mail_token_version + (changed && enabled ? 1 : 0) || (fresh.mail_enabled === 1) !== enabled) {
      return c.json({ error: 'preferences_changed', detail: 'Preferences changed during this request. Use your latest link.' }, 409);
    }
    const links = await testerLinks(c.env, { ...row, ...fresh });
    const blocked = await testerDeliveryBlocked(c.env, row.email);
    if ((c.req.header('Accept') || '').includes('text/html')) return c.html(page(enabled ? 'Programme emails on' : 'Unsubscribed', `<p>${escapeHtml(row.product_name)}</p>${blocked ? '<p>Email is currently suppressed for this address.</p>' : ''}<p><a href="${escapeHtml(links.preferences_url)}">Manage programme emails</a></p>`));
    return c.json({ ok: true, email_enabled: fresh.mail_enabled === 1, delivery_blocked: blocked, ...links });
  });
}
export default app;

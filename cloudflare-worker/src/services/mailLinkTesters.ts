/** D811, owner's option A: picked testers need programme consent, never a newsletter subscription. */
import type { Env } from '../types';
import { mailLinkSignature } from '../middleware/mailLink';
import { preferencesToken, readPreferencesToken, tokenKey } from './newsletter';
import { CONSENT_VERSION } from './testing';

type Tester = { id: number; uid: string; programme_id: number; programme_uid: string; product_name: string;
  user_id: number; email: string; name: string; company: string | null; status: string;
  consent_email_at: string | null; mail_enabled: number; mail_token_version: number };

async function signingKey(env: Env, row: Pick<Tester, 'programme_uid' | 'email'>): Promise<string> {
  const key = tokenKey(env);
  if (!key) throw new Error('newsletter key unavailable');
  // D810's token format with a separate HMAC domain, bound to programme and
  // current account email: no newsletter token or former-address link works here.
  return mailLinkSignature(key, 'TESTER', `programme:${row.programme_uid}`, '1', row.email);
}
export async function testerLinks(env: Env, row: Tester) {
  const token = encodeURIComponent(await preferencesToken(await signingKey(env, row), row.uid, row.mail_token_version));
  const base = String(env.APP_URL || 'https://axal.vc').replace(/\/$/, '');
  const unsubscribe = `${base}/api/testing/mail/unsubscribe?token=${token}`;
  return { unsubscribe_url: unsubscribe, one_click_url: unsubscribe,
    preferences_url: `${base}/api/testing/mail/preferences?token=${token}` };
}
export async function testerFromToken(env: Env, token: unknown): Promise<Tester | null> {
  if (typeof token !== 'string' || token.length > 300) return null;
  const uid = token.split('.')[0];
  if (!/^[0-9a-f-]{8,64}$/i.test(uid)) return null;
  const row = await env.DB.prepare(`SELECT a.id, a.uid, a.programme_id, p.uid AS programme_uid, p.product_name,
    a.user_id, lower(trim(u.email)) AS email, u.name, x.organization AS company, a.status,
    a.consent_email_at, a.mail_enabled, a.mail_token_version
    FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id
    JOIN users u ON u.id = a.user_id LEFT JOIN user_profile_ext x ON x.user_id = u.id
    WHERE a.uid = ? AND u.is_active = 1`).bind(uid).first<Tester>();
  if (!row) return null;
  const signed = await readPreferencesToken(await signingKey(env, row), token);
  return signed && signed.uid === row.uid && signed.version === row.mail_token_version ? row : null;
}
export async function testerDeliveryBlocked(env: Env, email: string): Promise<boolean> {
  if (await env.DB.prepare('SELECT id FROM email_suppressions WHERE email = ? LIMIT 1').bind(email).first()) return true;
  return !!await env.DB.prepare("SELECT id FROM newsletter_subscribers WHERE email = ? AND status = 'unsubscribed'").bind(email).first();
}

export async function testerRecipients(env: Env, programme: string, after: number) {
  const { results } = await env.DB.prepare(`SELECT a.id, a.uid, a.programme_id, p.uid AS programme_uid, p.product_name,
      a.user_id, lower(trim(u.email)) AS email, u.name, x.organization AS company, a.status,
      a.consent_email_at, a.mail_enabled, a.mail_token_version
    FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profile_ext x ON x.user_id = u.id
    WHERE p.uid = ? AND p.status IN ('open', 'testing', 'closed')
      AND a.status = 'picked' AND a.consent_email_at IS NOT NULL AND a.mail_enabled = 1 AND u.is_active = 1
      AND u.email IS NOT NULL AND trim(u.email) <> ''
      AND NOT EXISTS (SELECT 1 FROM email_suppressions z WHERE z.email = lower(trim(u.email)))
      AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers s WHERE s.email = lower(trim(u.email)) AND s.status = 'unsubscribed')
      AND a.id > ? ORDER BY a.id LIMIT 501`).bind(programme, after).all<Tester>();
  const rows = results || [];
  const page = rows.slice(0, 500);
  const recipients = await Promise.all(page.map(async row => {
    const names = (row.name || '').trim().split(/\s+/).filter(Boolean);
    return { email: row.email, first_name: names[0] || null, last_name: names.slice(1).join(' ') || null,
      company: row.company || null, ...await testerLinks(env, row) };
  }));
  return { recipients, next_after: rows.length > 500 ? page[page.length - 1].id : null };
}

/** Changes and both audits commit together; no actor is falsely attributed to the member. */
export async function saveTesterPreference(env: Env, row: Tester, enabled: boolean): Promise<boolean> {
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE testing_applications SET mail_enabled = ?,
      mail_token_version = mail_token_version + CASE WHEN ? = 1 AND mail_enabled = 0 THEN 1 ELSE 0 END,
      consent_email_at = CASE WHEN ? = 1 THEN datetime('now') ELSE consent_email_at END,
      consent_version = CASE WHEN ? = 1 THEN ? ELSE consent_version END, updated_at = datetime('now')
      WHERE uid = ? AND mail_token_version = ? AND mail_enabled <> ?
        AND (? = 0 OR (status = 'picked' AND consent_email_at IS NOT NULL))
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = testing_applications.user_id AND u.is_active = 1 AND lower(trim(u.email)) = ?)`)
      .bind(enabled ? 1 : 0, enabled ? 1 : 0, enabled ? 1 : 0, enabled ? 1 : 0, CONSENT_VERSION,
        row.uid, row.mail_token_version, enabled ? 1 : 0, enabled ? 1 : 0, row.email),
    env.DB.prepare(`INSERT INTO testing_events (programme_id, application_id, action, detail)
      SELECT programme_id, id, 'mail_preferences_saved', json_object('enabled', mail_enabled, 'source', 'signed_mail_link')
      FROM testing_applications WHERE uid = ? AND changes() = 1`).bind(row.uid),
    env.DB.prepare(`INSERT INTO activity_logs (action, actor, user_id, details)
      SELECT 'testing_mail_preferences_saved', 'signed:testing-mail', user_id, json_object('programme_uid', ?, 'enabled', mail_enabled)
      FROM testing_applications WHERE uid = ? AND changes() = 1`).bind(row.programme_uid, row.uid),
  ]);
  return results[0].meta.changes === 1;
}

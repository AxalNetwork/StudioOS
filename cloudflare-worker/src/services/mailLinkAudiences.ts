/** D811. Registration is not newsletter consent: every export starts with D810 opt-in. */
import type { Env } from '../types';
import { testerRecipients } from './mailLinkTesters';
import { NEWSLETTER_TOPICS, preferencesToken, tokenKey } from './newsletter';

export type Audience = { key: string; label: string; topic: string | null; programme?: string; role: string | null; event: number | null };
export const MEMBER_ROLES = ['admin', 'founder', 'partner', 'exploring', 'advisor', 'investor', 'lp'];

export function parseAudience(key: string): Audience | null {
  if (key === 'investors_lps') return { key, label: 'Investors and LPs · Partner Letter', topic: 'partner_letter', role: 'investors_lps', event: null };
  const parts = key.split(':');
  if (parts[0] === 'testers' && parts.length === 2 && /^[0-9a-f-]{8,64}$/i.test(parts[1])) {
    return { key, label: 'Programme testers', topic: null, role: null, event: null, programme: parts[1] };
  }
  if (parts[0] === 'topic' && parts.length === 2 && (NEWSLETTER_TOPICS as readonly string[]).includes(parts[1])) {
    return { key, label: parts[1], topic: parts[1], role: parts[1] === 'partner_letter' ? 'investors_lps' : null, event: null };
  }
  if (parts[0] === 'members' && parts.length === 3 && MEMBER_ROLES.includes(parts[1]) && (NEWSLETTER_TOPICS as readonly string[]).includes(parts[2])) {
    if (parts[2] === 'partner_letter' && !['investor', 'lp'].includes(parts[1])) return null;
    return { key, label: `${parts[1]} · ${parts[2]}`, topic: parts[2], role: parts[1], event: null };
  }
  if (parts[0] === 'event' && parts.length === 2 && /^[1-9]\d{0,9}$/.test(parts[1])) {
    return { key, label: 'Event guests', topic: 'events', role: null, event: Number(parts[1]) };
  }
  return null;
}

type RecipientRow = { id: number; uid: string; token_version: number; email: string; name: string | null; company: string | null };

export async function audienceList(env: Env) {
  const topics = await env.DB.prepare('SELECT key, label FROM newsletter_topics ORDER BY sort_order, key').all<{ key: string; label: string }>();
  const events = await env.DB.prepare('SELECT id, title FROM events ORDER BY id').all<{ id: number; title: string }>();
  const audiences: Audience[] = [];
  for (const topic of topics.results || []) {
    const a = parseAudience(`topic:${topic.key}`);
    if (!a) continue;
    audiences.push({ ...a, label: topic.label });
    for (const role of MEMBER_ROLES) {
      const member = parseAudience(`members:${role}:${topic.key}`);
      if (member) audiences.push({ ...member, label: `${role} · ${topic.label}` });
    }
  }
  audiences.push(parseAudience('investors_lps')!);
  for (const event of events.results || []) audiences.push({ ...parseAudience(`event:${event.id}`)!, label: event.title });
  const programmes = await env.DB.prepare('SELECT uid, product_name FROM testing_programmes ORDER BY id').all<{ uid: string; product_name: string }>();
  for (const programme of programmes.results || []) {
    const audience = parseAudience(`testers:${programme.uid}`);
    if (audience) audiences.push({ ...audience, label: programme.product_name });
  }
  // Four grouped counts regardless of catalogue size. Keep these eligibility
  // predicates aligned with recipient pages; failed reads propagate as unreadable.
  const [topicCounts, memberCounts, eventCounts, testerCounts] = await Promise.all([
    env.DB.prepare(`SELECT t.topic, COUNT(*) AS n FROM newsletter_subscribers s
    JOIN newsletter_subscriber_topics t ON t.subscriber_id = s.id AND t.enabled = 1
    LEFT JOIN users u ON u.id = s.user_id AND lower(trim(u.email)) = s.email AND u.is_active = 1
    WHERE s.status = 'confirmed' AND s.consented_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = s.email)
      AND (s.user_id IS NULL OR u.id IS NOT NULL)
      AND (t.topic <> 'partner_letter' OR u.role IN ('investor', 'lp')) GROUP BY t.topic`).all<{ topic: string; n: number }>(),
    env.DB.prepare(`SELECT t.topic, u.role, COUNT(*) AS n FROM newsletter_subscribers s
    JOIN newsletter_subscriber_topics t ON t.subscriber_id = s.id AND t.enabled = 1
    LEFT JOIN users u ON u.id = s.user_id AND lower(trim(u.email)) = s.email AND u.is_active = 1
    WHERE s.status = 'confirmed' AND s.consented_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = s.email)
      AND (s.user_id IS NULL OR u.id IS NOT NULL)
      AND (t.topic <> 'partner_letter' OR u.role IN ('investor', 'lp'))
      AND u.id IS NOT NULL GROUP BY t.topic, u.role`).all<{ topic: string; role: string; n: number }>(),
    env.DB.prepare(`SELECT r.event_id, COUNT(DISTINCT s.id) AS n
      FROM event_registrations r LEFT JOIN users guest ON guest.id = r.user_id
      JOIN newsletter_subscribers s ON lower(trim(COALESCE(r.email, guest.email))) = s.email
      JOIN newsletter_subscriber_topics t ON t.subscriber_id = s.id AND t.topic = 'events' AND t.enabled = 1
      LEFT JOIN users u ON u.id = s.user_id AND lower(trim(u.email)) = s.email AND u.is_active = 1
      WHERE r.status IN ('registered', 'confirmed', 'attended') AND s.status = 'confirmed'
        AND s.consented_at IS NOT NULL AND (s.user_id IS NULL OR u.id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = s.email)
      GROUP BY r.event_id`).all<{ event_id: number; n: number }>(),
    env.DB.prepare(`SELECT p.uid, COUNT(*) AS n FROM testing_applications a
      JOIN testing_programmes p ON p.id = a.programme_id JOIN users u ON u.id = a.user_id
      WHERE p.status IN ('open', 'testing', 'closed')
        AND a.status = 'picked' AND a.consent_email_at IS NOT NULL AND a.mail_enabled = 1 AND u.is_active = 1
        AND u.email IS NOT NULL AND trim(u.email) <> ''
        AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = lower(trim(u.email)))
        AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers s WHERE s.email = lower(trim(u.email)) AND s.status = 'unsubscribed')
      GROUP BY p.uid`).all<{ uid: string; n: number }>(),
  ]);
  const counts = new Map<string, number>();
  for (const row of topicCounts.results || []) counts.set(`topic:${row.topic}`, row.n);
  for (const row of memberCounts.results || []) counts.set(`members:${row.role}:${row.topic}`, row.n);
  for (const row of eventCounts.results || []) counts.set(`event:${row.event_id}`, row.n);
  for (const row of testerCounts.results || []) counts.set(`testers:${row.uid}`, row.n);
  counts.set('investors_lps', counts.get('topic:partner_letter') ?? 0);
  return audiences.map(a => ({ key: a.key, label: a.label, count: counts.get(a.key) ?? 0 }));
}

/** An opaque, audience-bound keyset cursor. A signature on the request binds its use. */
export function pageCursor(key: string, after: number): string {
  return btoa(JSON.stringify([key, after]));
}
export function readCursor(key: string, cursor: string | undefined): number | null {
  if (cursor === undefined) return 0;
  if (cursor.length > 400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor)) return null;
  try {
    const [audience, id] = JSON.parse(atob(cursor));
    return audience === key && Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

export async function audienceRecipients(env: Env, a: Audience, after: number) {
  if (a.programme) {
    const page = await testerRecipients(env, a.programme, after);
    return { recipients: page.recipients, next_cursor: page.next_after ? pageCursor(a.key, page.next_after) : null };
  }
  const key = tokenKey(env);
  if (!key) throw new Error('newsletter links unavailable');
  const result = await env.DB.prepare(`SELECT s.id, s.uid, s.token_version, s.email, u.name, p.organization AS company
    FROM newsletter_subscribers s
    JOIN newsletter_subscriber_topics t ON t.subscriber_id = s.id AND t.topic = ? AND t.enabled = 1
    LEFT JOIN users u ON u.id = s.user_id AND lower(trim(u.email)) = s.email AND u.is_active = 1
    LEFT JOIN user_profile_ext p ON p.user_id = u.id
    WHERE s.status = 'confirmed' AND s.consented_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = s.email)
      AND (s.user_id IS NULL OR u.id IS NOT NULL)
      AND (? IS NULL OR u.role = ? OR (? = 'investors_lps' AND u.role IN ('investor', 'lp')))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM event_registrations r LEFT JOIN users guest ON guest.id = r.user_id WHERE r.event_id = ?
        AND r.status IN ('registered', 'confirmed', 'attended') AND lower(trim(COALESCE(r.email, guest.email))) = s.email))
      AND s.id > ? ORDER BY s.id LIMIT 501
  `).bind(a.topic, a.role, a.role, a.role, a.event, a.event, after).all<RecipientRow>();
  const rows = result.results || [];
  const page = rows.slice(0, 500);
  // The host is configured by the operator; no request data becomes a URL host.
  const base = String(env.APP_URL || 'https://axal.vc').replace(/\/$/, '');
  const recipients = await Promise.all(page.map(async row => {
    const token = encodeURIComponent(await preferencesToken(key, row.uid, row.token_version));
    const names = (row.name || '').trim().split(/\s+/).filter(Boolean);
    const unsubscribe = `${base}/api/newsletter/unsubscribe?token=${token}&topic=${encodeURIComponent(a.topic!)}`;
    return { email: row.email, first_name: names[0] || null, last_name: names.slice(1).join(' ') || null,
      company: row.company || null, unsubscribe_url: unsubscribe,
      preferences_url: `${base}/newsletter/preferences?token=${token}`, one_click_url: unsubscribe };
  }));
  return { recipients, next_cursor: rows.length > 500 ? pageCursor(a.key, page[page.length - 1].id) : null };
}

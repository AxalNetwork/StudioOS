/**
 * #5131 (D1486 §e, source 5e of #3723) — Grow's campaigns, ad flights,
 * newsletter sends and sequence steps on the calendar, family `grow`, page
 * only (never an .ics file, a feed or a provider copy).
 *
 *   grow_campaign    `grow_campaigns.starts_on` / `ends_on` (D4447, D4483), a
 *                    plan that is not archived. Both days: one all-day span,
 *                    the end exclusive. One day alone: an all-day item on it,
 *                    "Campaign starts" or "Campaign ends". Neither: not shown.
 *   ad_flight        a paid channel's own `grow_campaign_channels.starts_on` /
 *                    `ends_on` (D4483) on a campaign that is not archived, one
 *                    item per campaign and channel, all day as a campaign is.
 *                    Paid is D4490's rule, the one the Ads tab reads: an
 *                    explicit daily or lifetime budget type, or a known paid
 *                    platform's UTM source. A link with no day of its own is
 *                    not shown: its campaign's item already is.
 *   newsletter_send  `beehiiv_post_stats.sent_at` (D2407), timed. A post whose
 *                    linked Publish send (`publish_send_id`) is already on this
 *                    member's calendar as §b's `publish_send` is left out, so
 *                    one send is never shown twice.
 *   sequence_step    `outreach_enrolments.next_due_at` (D4493), timed: the step
 *                    an active enrolment stands on, in an active sequence, when
 *                    that step is email or a voice note. Later steps have no
 *                    stored day (they are worked out from `wait_days` when
 *                    read), so they are not invented here. No prospect's name
 *                    or address reaches the item.
 *
 * WHO. Every one of these stores is read through `canAccessProject`'s read
 * gate (`routes/cycle_grow.ts` `project()` for campaigns and Beehiiv's posts,
 * `routes/grow_ads.ts` `readAds`, `routes/grow_sequences.ts` `access`): the
 * venture's founder holding a founder licence, or an accepted member of the
 * venture, never an investor-only account. That is the rule here, written out
 * in each query. Admin access never widens it: a calendar is the member's own.
 *
 * Voice notes have no reader of their own: a recording (`outreach_steps
 * .recording_*`) carries no date, so it is on the calendar only as its
 * sequence step's due time.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

type Row = Record<string, any>;
export type GrowDateKind = 'grow_campaign' | 'ad_flight' | 'newsletter_send' | 'sequence_step';

function results(value: { results?: Row[] }): Row[] {
  if (!Array.isArray(value.results)) throw new Error('calendar_source_unreadable');
  return value.results;
}

const DAY_MS = 86_400_000;
function dayMs(day: unknown): number {
  const d = String(day ?? '');
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== d) {
    throw new Error('calendar_source_unreadable');
  }
  return ms;
}

/** An all-day item from its first day through its last, the end exclusive (D1208's `isAllDay`). */
export function spanItem(kind: GrowDateKind, id: number, uid: string, title: string, first: unknown, last: unknown): CalendarEvent & { all_day: true } {
  const start = dayMs(first), end = dayMs(last);
  if (end < start) throw new Error('calendar_source_unreadable');
  return {
    id: `${kind}:${uid}`, kind, source_id: id, source_uid: uid, title,
    start_at: new Date(start).toISOString().slice(0, 10), end_at: new Date(end + DAY_MS).toISOString().slice(0, 10),
    status: 'scheduled', all_day: true,
    location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null,
  } as CalendarEvent & { all_day: true };
}

/** "Campaign · x", or "Campaign starts · x" / "Campaign ends · x" when only one day is recorded. */
function edgeTitle(what: string, starts: unknown, ends: unknown, name: string): string {
  if (starts && ends) return `${what} · ${name}`;
  return `${what} ${starts ? 'starts' : 'ends'} · ${name}`;
}

function timed(kind: GrowDateKind, id: number, uid: string, title: string, at: unknown): CalendarEvent {
  const s = String(at ?? '');
  if (!s || !Number.isFinite(Date.parse(s))) throw new Error('calendar_source_unreadable');
  return {
    id: `${kind}:${uid}`, kind, source_id: id, source_uid: uid, title,
    start_at: s, end_at: s, status: 'scheduled',
    location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null,
  } as CalendarEvent;
}

const named = (v: unknown, fallback: string) => String(v ?? '').trim() || fallback;

// Every reader joins the member (active, not leaving) and applies the venture
// read rule above in full. The SQL is literal: the schema guards read every
// statement as one string, and an interpolated fragment would be skipped.

/** A campaign plan's days, for the venture's readers. */
export async function growCampaignEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT c.id, c.uid, c.name, c.status, c.project_id, date(c.starts_on) AS starts, date(c.ends_on) AS ends
       FROM grow_campaigns c
       JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE c.archived_at IS NULL
        AND NOT (lower(u.role) = 'investor' AND NOT EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence <> 'investor'))
        AND (((lower(u.role) = 'founder' OR EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence = 'founder'))
               AND u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id AND m.status = 'accepted'))
        AND COALESCE(date(c.starts_on), date(c.ends_on)) IS NOT NULL
        AND (date(c.starts_on) IS NULL OR date(c.ends_on) IS NULL OR date(c.ends_on) >= date(c.starts_on))
        AND julianday(COALESCE(date(c.ends_on), date(c.starts_on)), '+1 day') > julianday(?)
        AND julianday(COALESCE(date(c.starts_on), date(c.ends_on))) < julianday(?)
      ORDER BY COALESCE(date(c.starts_on), date(c.ends_on)), c.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    const uid = String(r.uid);
    return {
      ...spanItem('grow_campaign', Number(r.id), uid, edgeTitle('Campaign', r.starts, r.ends, named(r.name, 'Campaign')), r.starts ?? r.ends, r.ends ?? r.starts),
      status: String(r.status), project_id: Number(r.project_id), url: `/grow/distribution/campaigns/${encodeURIComponent(uid)}`,
    };
  });
}

/** A paid channel's own days on a campaign (D4490's paid rule), for the venture's readers. */
export async function adFlightEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT l.rowid AS id, c.uid AS campaign_uid, c.name AS campaign_name, c.status, c.project_id, g.uid AS channel_uid, g.name AS channel_name,
            date(l.starts_on) AS starts, date(l.ends_on) AS ends
       FROM grow_campaign_channels l
       JOIN grow_campaigns c ON c.id = l.campaign_id AND c.archived_at IS NULL
       JOIN growth_channels g ON g.id = l.channel_id AND g.project_id = c.project_id
       JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE (l.budget_type IS NOT NULL
          OR g.utm_source IN ('google', 'google_ads', 'google_search', 'youtube', 'meta', 'facebook', 'instagram', 'x', 'twitter', 'linkedin_ads'))
        AND NOT (lower(u.role) = 'investor' AND NOT EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence <> 'investor'))
        AND (((lower(u.role) = 'founder' OR EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence = 'founder'))
               AND u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id AND m.status = 'accepted'))
        AND COALESCE(date(l.starts_on), date(l.ends_on)) IS NOT NULL
        AND (date(l.starts_on) IS NULL OR date(l.ends_on) IS NULL OR date(l.ends_on) >= date(l.starts_on))
        AND julianday(COALESCE(date(l.ends_on), date(l.starts_on)), '+1 day') > julianday(?)
        AND julianday(COALESCE(date(l.starts_on), date(l.ends_on))) < julianday(?)
      ORDER BY COALESCE(date(l.starts_on), date(l.ends_on)), c.id, g.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    const name = `${named(r.channel_name, 'Paid channel')} · ${named(r.campaign_name, 'Campaign')}`;
    return {
      ...spanItem('ad_flight', Number(r.id), `${r.campaign_uid}:${r.channel_uid}`, edgeTitle('Ad flight', r.starts, r.ends, name), r.starts ?? r.ends, r.ends ?? r.starts),
      status: String(r.status), project_id: Number(r.project_id), url: '/grow/distribution/ads',
    };
  });
}

/** A Beehiiv post the venture sent, unless §b already shows its Publish send to this member. */
export async function newsletterSendEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT b.id, b.post_external_id, b.title, b.project_id, strftime('%Y-%m-%dT%H:%M:%fZ', b.sent_at) AS at
       FROM beehiiv_post_stats b
       JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE NOT (lower(u.role) = 'investor' AND NOT EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence <> 'investor'))
        AND (((lower(u.role) = 'founder' OR EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence = 'founder'))
               AND u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id AND m.status = 'accepted'))
        AND strftime('%Y-%m-%dT%H:%M:%fZ', b.sent_at) IS NOT NULL
        AND julianday(b.sent_at) >= julianday(?) AND julianday(b.sent_at) < julianday(?)
        AND NOT EXISTS (
          SELECT 1 FROM publish_sends s
           WHERE s.id = b.publish_send_id AND s.project_id = p.id AND s.confirmed_by = u.id
             AND s.status IN ('ready', 'sending', 'sent', 'failed', 'unknown')
             AND ((u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
               OR (p.company_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_company_links lk WHERE lk.company_id = p.company_id AND lk.user_id = u.id))))
      ORDER BY at, b.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...timed('newsletter_send', Number(r.id), `beehiiv-post-${r.id}`, `Newsletter sent · ${named(r.title, 'Beehiiv post')}`, r.at),
    status: 'sent', project_id: Number(r.project_id), url: '/grow/distribution/newsletter',
  }));
}

const STEP_WORDS: Readonly<Record<string, string>> = { email: 'Email', voice: 'Voice note' };

/** The step an active enrolment stands on, at its recorded due time, for the venture's readers. */
export async function sequenceStepEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT e.id, e.uid, e.current_step, t.channel, s.name AS sequence_name, s.project_id, strftime('%Y-%m-%dT%H:%M:%fZ', e.next_due_at) AS at
       FROM outreach_enrolments e
       JOIN outreach_sequences s ON s.id = e.sequence_id AND s.state = 'active'
       JOIN outreach_steps t ON t.sequence_id = s.id AND t.position = e.current_step AND t.channel IN ('email', 'voice')
       JOIN contacts c ON c.id = e.contact_id AND c.project_id = s.project_id AND c.audience = 'customer'
       JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE e.state = 'active'
        AND NOT (lower(u.role) = 'investor' AND NOT EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence <> 'investor'))
        AND (((lower(u.role) = 'founder' OR EXISTS (SELECT 1 FROM account_licences al WHERE al.user_id = u.id AND al.revoked_at IS NULL AND al.licence = 'founder'))
               AND u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id AND m.status = 'accepted'))
        AND strftime('%Y-%m-%dT%H:%M:%fZ', e.next_due_at) IS NOT NULL
        AND julianday(e.next_due_at) >= julianday(?) AND julianday(e.next_due_at) < julianday(?)
      ORDER BY at, e.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...timed('sequence_step', Number(r.id), String(r.uid),
      `${STEP_WORDS[String(r.channel)] ?? 'Step'} · step ${Number(r.current_step)} · ${named(r.sequence_name, 'Sequence')}`, r.at),
    project_id: Number(r.project_id), url: '/grow/distribution/prospects',
  }));
}

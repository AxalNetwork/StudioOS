/**
 * D1490 (#3904) — which event may be listed on which account. One pure
 * function; every route and the job ask it, and the job asks again at run
 * time, so an event cancelled while its post waited in the queue never posts.
 *
 * An event may be syndicated to an account only when all of these hold:
 *   1. the public feed's predicate (`routes/events_public.ts`): public,
 *      published and approved by an admin (`admin_published = 1`);
 *   2. it has not started;
 *   3. its host passes HQ's `hosts` setting (owner question A);
 *   4. the account is active;
 *   5. the account is HQ's, or the host's own while HQ allows host accounts.
 *
 * Otherwise the row is skipped with one of five fixed sentences.
 */
import type { Env } from '../../types';
import { isChannelKey, type ChannelKey } from './channels';
import { EVENT_TYPE_IDS } from '../eventTypes';

export const SKIP = Object.freeze({
  private: 'Private event',
  not_approved: 'Not approved for the public calendar',
  started: 'Event has started',
  account: 'Account expired',
  host: 'Host not allowed by HQ settings',
} as const);
export type SkipReason = (typeof SKIP)[keyof typeof SKIP];

export type SyndicationSettings = {
  /** 'approved_events': any event an admin approves (S1's recommendation (a)); 'admins': admins' events only. */
  hosts: 'admins' | 'approved_events';
  default_channels_by_type: Partial<Record<string, ChannelKey[]>>;
  /** Hosts may connect their own accounts (owner question C); off until the owner says so. */
  host_accounts: boolean;
};

export const DEFAULT_SETTINGS: SyndicationSettings = Object.freeze({ hosts: 'approved_events', default_channels_by_type: {}, host_accounts: false }) as SyndicationSettings;
export const SETTINGS_KEY = 'event_syndication';

type EventFacts = { visibility: string; status: string; admin_published: number | boolean; starts_at: string; host_user_id: number | null };
type AccountFacts = { status: string; owner_kind: string; owner_user_id: number | null };

/** The event's own conditions (1 to 3), whatever the account. */
export function eventEligibility(event: EventFacts, hostRole: string | null, settings: SyndicationSettings, now: Date = new Date()):
  { ok: true } | { ok: false; reason: SkipReason } {
  if (event.visibility !== 'public') return { ok: false, reason: SKIP.private };
  if (event.status !== 'published' || Number(event.admin_published) !== 1) return { ok: false, reason: SKIP.not_approved };
  const starts = Date.parse(String(event.starts_at));
  if (!Number.isFinite(starts) || starts <= now.getTime()) return { ok: false, reason: SKIP.started };
  if (settings.hosts === 'admins' && hostRole !== 'admin') return { ok: false, reason: SKIP.host };
  return { ok: true };
}

/** Every condition, for one account. */
export function eligibility(event: EventFacts, account: AccountFacts, hostRole: string | null, settings: SyndicationSettings, now: Date = new Date()):
  { ok: true } | { ok: false; reason: SkipReason } {
  const own = eventEligibility(event, hostRole, settings, now);
  if (!own.ok) return own;
  if (account.status !== 'active') return { ok: false, reason: SKIP.account };
  if (account.owner_kind === 'hq') return { ok: true };
  if (account.owner_kind === 'host' && settings.host_accounts && account.owner_user_id != null
      && Number(account.owner_user_id) === Number(event.host_user_id)) return { ok: true };
  return { ok: false, reason: SKIP.host };
}

/** A settings object as stored, or null when any part is not one we accept. */
export function parseSettings(raw: unknown): SyndicationSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const hosts = r.hosts ?? DEFAULT_SETTINGS.hosts;
  if (hosts !== 'admins' && hosts !== 'approved_events') return null;
  const hostAccounts = r.host_accounts ?? false;
  if (typeof hostAccounts !== 'boolean') return null;
  const byType = r.default_channels_by_type ?? {};
  if (!byType || typeof byType !== 'object' || Array.isArray(byType)) return null;
  const out: Record<string, ChannelKey[]> = {};
  for (const [type, list] of Object.entries(byType as Record<string, unknown>)) {
    if (!(EVENT_TYPE_IDS as readonly string[]).includes(type)) return null;
    if (!Array.isArray(list) || !list.every(isChannelKey)) return null;
    out[type] = [...new Set(list as ChannelKey[])];
  }
  return { hosts, default_channels_by_type: out, host_accounts: hostAccounts };
}

/** HQ's settings, or the defaults when none are saved or the saved ones cannot be read. */
export async function readSettings(env: Env): Promise<SyndicationSettings> {
  try {
    const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?').bind(SETTINGS_KEY).first<{ value: string }>();
    if (!row?.value) return DEFAULT_SETTINGS;
    return parseSettings(JSON.parse(row.value)) ?? DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

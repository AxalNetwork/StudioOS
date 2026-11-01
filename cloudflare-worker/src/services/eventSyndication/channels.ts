/**
 * D1490 (#3904) — the event syndication channel registry.
 *
 * One row per adapter: a channel an approved public event can be listed on.
 * Part A ships **no adapter**: `SYNDICATION_CHANNELS` is empty, so every
 * account read says "Not available yet" and every connect is refused 409
 * `adapter_not_ready`. Each adapter arrives in its own task (D1492 Luma, then
 * Eventbrite, Google Business Profile, LinkedIn and Facebook), with a row here
 * and its `verified_on` date.
 *
 * WHY NO METHOD IS CALLED `publish`. Syndication is HQ's own capability, not
 * founder publishing (D1319): `publish_core_d1319.test.ts` walks `src/` and
 * fails if anything but `services/publishCore.ts` calls a publish method. The
 * adapter's verbs are `create`, `update`, `cancel`, `listGuests` and `preview`.
 */
import type { Env } from '../../types';

/** The five channels the schema's CHECK allows, in the HQ screen's order. */
export const CHANNEL_KEYS = Object.freeze(['luma', 'eventbrite', 'google_business', 'linkedin', 'facebook'] as const);
export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export const isChannelKey = (k: unknown): k is ChannelKey => typeof k === 'string' && (CHANNEL_KEYS as readonly string[]).includes(k);

/** The channel's name in a sentence ("Rate limited by Luma; …"). */
export const CHANNEL_NAMES: Readonly<Record<ChannelKey, string>> = Object.freeze({
  luma: 'Luma', eventbrite: 'Eventbrite', google_business: 'Google Business Profile', linkedin: 'LinkedIn', facebook: 'Facebook',
});

/** What one listing is sent: the event as readers see it, with the channel's overrides applied. */
export type ListingInput = {
  event: { id: number; slug: string; title: string; summary: string | null; description: string | null; cover_url: string | null;
    starts_at: string; ends_at: string | null; timezone: string | null; location_kind: string | null; location_text: string | null;
    location_url: string | null; price_cents: number | null; currency: string | null; type: string | null };
  /** `https://axal.vc/events/<slug>?utm_source=<channel>&utm_medium=event_syndication` */
  link: string;
  overrides: { title?: string; description?: string; ticket_url?: string };
  credentials: Record<string, unknown> | null;
  account: { external_account_id: string; display_name: string };
};

export type ListingResult = { external_id: string; external_url: string | null };

/**
 * A platform's refusal. `status` is its HTTP status; `retryAfter` is the time
 * a 429 names, when it names one. The message is the platform's sentence and
 * is trimmed and cleaned of credentials before anything stores it.
 */
export class ChannelError extends Error {
  status: number | null;
  retryAfter: string | null;
  constructor(message: string, status: number | null = null, retryAfter: string | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export type SyndicationAdapter = {
  key: ChannelKey;
  /** Luma, Eventbrite and Google create a listing; LinkedIn and Facebook post a link to the event. */
  capability: 'creates_events' | 'posts_link';
  /** The channel can edit what it posted. Without it an edit reads `sync_state = 'unsupported'`. */
  updates: boolean;
  /** The channel can cancel or remove what it posted. */
  cancels: boolean;
  imports_registrations: boolean;
  title_limit: number;
  text_limit: number;
  /** The date S-n confirmed the platform's API live; null until then. */
  verified_on: string | null;
  /** How HQ connects it: a key pasted on SY1, or an OAuth round trip. */
  auth: 'api_key' | 'oauth';
  /** api_key: check the key with the platform; the account it names. */
  verifyKey?: (env: Env, apiKey: string) => Promise<{ external_account_id: string; display_name: string; expires_at?: string | null }>;
  /** oauth: where to send HQ, carrying the signed `state`. */
  authorizeUrl?: (env: Env, state: string, redirectUri: string) => string;
  /** oauth: the code exchanged for the account and its credentials. */
  exchangeCode?: (env: Env, code: string, redirectUri: string) => Promise<{
    external_account_id: string; display_name: string; credentials: Record<string, unknown>; scopes?: string[]; expires_at?: string | null;
  }>;
  create: (env: Env, input: ListingInput) => Promise<ListingResult>;
  update: (env: Env, input: ListingInput & { external_id: string }) => Promise<ListingResult>;
  cancel: (env: Env, input: ListingInput & { external_id: string }) => Promise<void>;
  listGuests?: (env: Env, input: ListingInput & { external_id: string }) => Promise<Array<{ name: string | null; email: string }>>;
  /** What the listing will look like, sending nothing. */
  preview: (input: ListingInput) => { title: string; text: string; link: string; cover_url: string | null; warnings: string[] };
};

/** The real adapters. Empty in Part A: no channel posts until its own task lands. */
export const SYNDICATION_CHANNELS: readonly SyndicationAdapter[] = Object.freeze([]);

const EXTRA = new Map<string, SyndicationAdapter>();

/**
 * A row for a test's fake adapter only. A real adapter is a row in
 * `SYNDICATION_CHANNELS`; `event_syndication_d1490.test.ts` fails if any
 * source file calls this.
 */
export function registerSyndicationChannel(row: SyndicationAdapter): void {
  EXTRA.set(row.key, Object.freeze({ ...row }));
}

/** For a test's teardown only. */
export function clearSyndicationChannelsForTest(): void {
  EXTRA.clear();
}

/** The channel's adapter, or null while it has none. */
export function syndicationChannel(key: string | null | undefined): SyndicationAdapter | null {
  if (!key) return null;
  return SYNDICATION_CHANNELS.find((a) => a.key === key) ?? EXTRA.get(key) ?? null;
}

/** The limits overrides are held to when the channel has no adapter yet. */
export const DEFAULT_TITLE_LIMIT = 200;
export const DEFAULT_TEXT_LIMIT = 5000;

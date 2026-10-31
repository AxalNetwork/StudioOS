/**
 * D1490 (#3904) — what a listing is sent, and the hash that says it changed.
 *
 * D917's `changed_after_approval_at` watches host edits to the title, times,
 * place and price only. A listing also carries the summary, the description,
 * the cover, the type and the address, so syndication hashes **every field it
 * sends** (`SENT_FIELDS`) and pushes an update whenever that hash moves, by
 * whoever made the edit.
 */
import type { ListingInput } from './channels';

/** Every event field a listing carries. The content hash covers each of them. */
export const SENT_FIELDS = Object.freeze([
  'slug', 'type', 'title', 'summary', 'description', 'cover_url', 'starts_at', 'ends_at', 'timezone',
  'location_kind', 'location_text', 'location_url', 'price_cents', 'currency',
] as const);

/** The event as a listing sends it: the sent fields only, normalised so equal values hash equal. */
export function listingEvent(event: Record<string, any>): ListingInput['event'] {
  const text = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    id: Number(event.id),
    slug: String(event.slug ?? ''),
    type: text(event.type),
    title: String(event.title ?? ''),
    summary: text(event.summary),
    description: text(event.description),
    cover_url: text(event.cover_url),
    starts_at: String(event.starts_at ?? ''),
    ends_at: text(event.ends_at),
    timezone: text(event.timezone),
    location_kind: text(event.location_kind),
    location_text: text(event.location_text),
    location_url: text(event.location_url),
    price_cents: event.price_cents == null ? null : Number(event.price_cents),
    currency: text(event.currency),
  };
}

/** SHA-256, hex, over the sent fields in a fixed order. */
export async function contentHash(event: Record<string, any>): Promise<string> {
  const e = listingEvent(event) as Record<string, unknown>;
  const canonical = JSON.stringify(SENT_FIELDS.map((k) => [k, e[k] ?? null]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every listing links back to the event's page, tagged with its channel. */
export function listingLink(base: string | undefined, slug: string, channel: string): string {
  const origin = (base && /^https:\/\//.test(base) ? base : 'https://axal.vc').replace(/\/+$/, '');
  return `${origin}/events/${encodeURIComponent(slug)}?utm_source=${encodeURIComponent(channel)}&utm_medium=event_syndication`;
}

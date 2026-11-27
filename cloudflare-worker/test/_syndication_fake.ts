/**
 * D1490 (#3904) — a fake event syndication adapter for tests. Part A ships no
 * real adapter (`SYNDICATION_CHANNELS` is empty), so the tests register this
 * one with `registerSyndicationChannel` and read back every call it took.
 * Nothing here reaches a network.
 */
import { ChannelError, registerSyndicationChannel, type ChannelKey, type SyndicationAdapter } from '../src/services/eventSyndication/channels.ts';

export type FakeCall = { op: 'create' | 'update' | 'cancel' | 'verify'; slug?: string; title?: string; link?: string; credentials?: unknown; external_id?: string };

export function fakeAdapter(key: ChannelKey, opts: Partial<SyndicationAdapter> & { failWith?: () => Error | null } = {}) {
  const calls: FakeCall[] = [];
  let n = 0;
  const failing = () => { const e = opts.failWith?.(); if (e) throw e; };
  const adapter: SyndicationAdapter = {
    key,
    capability: 'creates_events',
    updates: true,
    cancels: true,
    imports_registrations: false,
    title_limit: 60,
    text_limit: 300,
    verified_on: null,
    auth: 'api_key',
    verifyKey: async (_env, apiKey) => {
      calls.push({ op: 'verify', credentials: apiKey });
      if (apiKey === 'bad-key-0000') throw new ChannelError('Luma refused the key bad-key-0000 for this calendar.', 401);
      return { external_account_id: 'cal-made-up', display_name: 'Axal events (made up)' };
    },
    create: async (_env, input) => {
      failing();
      n += 1;
      calls.push({ op: 'create', slug: input.event.slug, title: input.overrides.title ?? input.event.title, link: input.link, credentials: input.credentials });
      return { external_id: `ext-${key}-${n}`, external_url: `https://listing.example.test/${key}/${n}` };
    },
    update: async (_env, input) => {
      failing();
      calls.push({ op: 'update', slug: input.event.slug, title: input.event.title, external_id: input.external_id });
      return { external_id: input.external_id, external_url: null };
    },
    cancel: async (_env, input) => {
      failing();
      calls.push({ op: 'cancel', slug: input.event.slug, external_id: input.external_id });
    },
    preview: (input) => ({
      title: input.overrides.title ?? input.event.title,
      text: input.overrides.description ?? input.event.summary ?? '',
      link: input.link,
      cover_url: input.event.cover_url,
      warnings: input.event.cover_url ? [] : ['No cover image: the listing shows the channel’s default.'],
    }),
    ...opts,
  };
  registerSyndicationChannel(adapter);
  return { adapter, calls };
}

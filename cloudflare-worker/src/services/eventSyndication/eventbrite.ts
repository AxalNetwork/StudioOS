/**
 * #3725 (owner answer B, 2026-11-16) — the Eventbrite syndication adapter, built against a mocked Eventbrite API
 * and **switched off** until the owner adds Axal's Eventbrite organisation and app: `enabled(env)` is false
 * without EVENTBRITE_CLIENT_ID and EVENTBRITE_CLIENT_SECRET, and `syndicationChannel(key, env)` then answers
 * null, so every screen reads "Not available yet" and connect is refused 409 `adapter_not_ready`, as before.
 *
 * Axal stays the only ticket ledger (owner decision E): the listing is externally ticketed and every
 * registration goes to the event's Axal page. No attendee is ever read (`imports_registrations: false`).
 *
 * `verified_on` stays null: the request shapes follow Eventbrite's v3 documentation and are tested against a
 * mock. The first session with the owner's app checks them live (D3725) and sets the date.
 */
import type { Env } from '../../types';
import { ChannelError } from './channelError';
import type { ListingInput, ListingResult, SyndicationAdapter } from './channels';

export const EVENTBRITE_API = 'https://www.eventbriteapi.com/v3';
export const EVENTBRITE_OAUTH = 'https://www.eventbrite.com/oauth';
export const TITLE_LIMIT = 75;
export const TEXT_LIMIT = 15_000;
const TIMEOUT_MS = 20_000;

/** The switch: both app secrets present. Nothing else turns the channel on. */
export function eventbriteEnabled(env: Partial<Env> | undefined): boolean {
  const e = env as Record<string, unknown> | undefined;
  return typeof e?.EVENTBRITE_CLIENT_ID === 'string' && !!e.EVENTBRITE_CLIENT_ID
    && typeof e?.EVENTBRITE_CLIENT_SECRET === 'string' && !!e.EVENTBRITE_CLIENT_SECRET;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Eventbrite wants UTC as `YYYY-MM-DDTHH:MM:SSZ`, no milliseconds. */
export function eventbriteUtc(iso: string): string {
  const t = Date.parse(iso.includes('T') || iso.endsWith('Z') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) throw new ChannelError('The event has no readable start time.', 400);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** What the listing says, built once for create, update and preview. */
export function eventbriteBody(input: ListingInput): { event: Record<string, unknown>; warnings: string[] } {
  const e = input.event;
  const warnings: string[] = [];
  const title = cut((input.overrides.title || e.title).trim(), TITLE_LIMIT);
  const intro = (input.overrides.description || e.description || e.summary || '').trim();
  const place = e.location_kind === 'online' ? 'Online' : e.location_text || null;
  const paragraphs = [intro, place ? `Where: ${place}` : null, `Register on Axal: ${input.link}`].filter(Boolean) as string[];
  const html = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const start = eventbriteUtc(e.starts_at);
  let end: string;
  if (e.ends_at) end = eventbriteUtc(e.ends_at);
  else {
    end = new Date(Date.parse(start) + 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    warnings.push('The event has no end time; the listing ends one hour after it starts.');
  }
  if (e.location_kind !== 'online' && e.location_text) warnings.push('The address is in the description; no Eventbrite venue is created.');
  const tz = e.timezone || 'UTC';
  const free = e.price_cents == null || e.price_cents === 0;
  return {
    warnings,
    event: {
      name: { html: escapeHtml(title) },
      description: { html: cut(html, TEXT_LIMIT) },
      start: { timezone: tz, utc: start },
      end: { timezone: tz, utc: end },
      currency: (e.currency || 'USD').toUpperCase(),
      online_event: e.location_kind === 'online',
      listed: true,
      shareable: true,
      // Axal is the only ticket ledger: registration happens on the event's Axal page.
      is_externally_ticketed: true,
      external_ticketing: {
        external_url: input.link,
        ticketing_provider_name: 'Axal',
        is_free: free,
        minimum_ticket_price: { currency: (e.currency || 'USD').toUpperCase(), value: free ? 0 : e.price_cents },
        maximum_ticket_price: { currency: (e.currency || 'USD').toUpperCase(), value: free ? 0 : e.price_cents },
        sales_start: eventbriteUtc(new Date().toISOString()),
        sales_end: start,
      },
    },
  };
}

async function call(path: string, init: { method: string; token: string; body?: unknown; form?: Record<string, string> }): Promise<any> {
  const url = path.startsWith('https://') ? path : `${EVENTBRITE_API}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(init.form).toString(); }
  else if (init.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.body); }
  let res: Response;
  try {
    res = await fetch(url, { method: init.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ChannelError('Eventbrite could not be reached.', null);
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const said = typeof data?.error_description === 'string' ? data.error_description : typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new ChannelError(`Eventbrite refused: ${said}`.slice(0, 500), res.status, res.headers.get('retry-after'));
  }
  return data;
}

const tokenOf = (input: ListingInput) => {
  const t = input.credentials?.access_token;
  if (typeof t !== 'string' || !t) throw new ChannelError('The Eventbrite account has no token; connect it again.', 401);
  return t;
};
const orgOf = (input: ListingInput) => {
  const o = String(input.credentials?.organization_id ?? input.account.external_account_id ?? '');
  if (!/^\d{1,30}$/.test(o)) throw new ChannelError('The Eventbrite account has no organisation; connect it again.', 400);
  return o;
};
const idOf = (id: string) => {
  if (!/^\d{1,30}$/.test(id)) throw new ChannelError('The Eventbrite event id is not readable.', 400);
  return id;
};
const resultOf = (d: any): ListingResult => ({
  external_id: String(d?.id ?? ''),
  external_url: typeof d?.url === 'string' && d.url.startsWith('https://') ? d.url : null,
});

export const eventbriteAdapter: SyndicationAdapter = Object.freeze({
  key: 'eventbrite',
  capability: 'creates_events',
  updates: true,
  cancels: true,
  imports_registrations: false,
  title_limit: TITLE_LIMIT,
  text_limit: TEXT_LIMIT,
  verified_on: null,
  auth: 'oauth',
  enabled: (env: Env) => eventbriteEnabled(env),

  authorizeUrl(env: Env, state: string, redirectUri: string): string {
    const u = new URL(`${EVENTBRITE_OAUTH}/authorize`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', String(env.EVENTBRITE_CLIENT_ID));
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  },

  async exchangeCode(env: Env, code: string, redirectUri: string) {
    const tok = await call(`${EVENTBRITE_OAUTH}/token`, {
      method: 'POST', token: '',
      form: { grant_type: 'authorization_code', client_id: String(env.EVENTBRITE_CLIENT_ID), client_secret: String(env.EVENTBRITE_CLIENT_SECRET), code, redirect_uri: redirectUri },
    });
    const accessToken = tok?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) throw new ChannelError('Eventbrite returned no token.', 502);
    const orgs = await call('/users/me/organizations/', { method: 'GET', token: accessToken });
    const list = Array.isArray(orgs?.organizations) ? orgs.organizations : [];
    // One organisation is Axal's; more than one is ambiguous, so the connect stops rather than guessing.
    if (list.length !== 1) throw new ChannelError(`Eventbrite returned ${list.length} organisations for this sign-in; connect with the account that owns only Axal's.`, 409);
    const org = list[0];
    if (!/^\d{1,30}$/.test(String(org?.id ?? ''))) throw new ChannelError('Eventbrite returned an unreadable organisation.', 502);
    return {
      external_account_id: String(org.id),
      display_name: String(org.name || 'Eventbrite organisation').slice(0, 200),
      credentials: { access_token: accessToken, organization_id: String(org.id) },
      scopes: [],
      expires_at: null,
    };
  },

  async create(_env: Env, input: ListingInput): Promise<ListingResult> {
    const token = tokenOf(input);
    const { event } = eventbriteBody(input);
    const made = await call(`/organizations/${orgOf(input)}/events/`, { method: 'POST', token, body: { event } });
    const id = idOf(String(made?.id ?? ''));
    // A draft is invisible on Eventbrite; going live is Eventbrite's own endpoint, not Axal's publishing (D1319).
    await call(`/events/${id}/publish/`, { method: 'POST', token });
    return resultOf(made);
  },

  async update(_env: Env, input: ListingInput & { external_id: string }): Promise<ListingResult> {
    const { event } = eventbriteBody(input);
    return resultOf(await call(`/events/${idOf(input.external_id)}/`, { method: 'POST', token: tokenOf(input), body: { event } }));
  },

  async cancel(_env: Env, input: ListingInput & { external_id: string }): Promise<void> {
    await call(`/events/${idOf(input.external_id)}/cancel/`, { method: 'POST', token: tokenOf(input) });
  },

  preview(input: ListingInput) {
    const { event, warnings } = eventbriteBody(input);
    const text = String((event.description as { html: string }).html).replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim()
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const title = cut((input.overrides.title || input.event.title).trim(), TITLE_LIMIT);
    if ((input.overrides.title || input.event.title).trim().length > TITLE_LIMIT) warnings.push(`Eventbrite titles stop at ${TITLE_LIMIT} characters; the title is shortened.`);
    return { title, text, link: input.link, cover_url: input.event.cover_url, warnings };
  },
} as SyndicationAdapter);

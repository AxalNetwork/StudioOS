/**
 * Task #2 — First-party signup-funnel event sink. POST /api/track receives
 * small batches of events from frontend/src/lib/funnel.js and appends them
 * to the `funnel_events` D1 table.
 *
 * Philosophy mirrors the /api/client-error sink in index.ts:
 *   - unauthenticated, called with `credentials:'omit'` (no cookie → no CSRF
 *     surface, no session token in the telemetry path);
 *   - best-effort: hard body-size cap before parsing, invalid entries are
 *     silently dropped, ALWAYS returns 204, never throws;
 *   - abuse bounded by the per-IP `track` rate-limit bucket (60/min/IP,
 *     fail-open) plus the batch cap below.
 *
 * Privacy contract (ANALYTICS_FUNNEL.md):
 *   - NO IP is stored (Cloudflare edge logs retain it for abuse forensics);
 *   - NO full user-agent — only a coarse browser family;
 *   - the client only ever sends events after the visitor granted the
 *     "analytics" cookie-consent category, and its URL-param capture is
 *     allowlisted (utm_*, ref, lane, invite) so magic-link / verification
 *     tokens can never ride along. The server still validates + clips every
 *     field and enforces the event-name allowlist as defense in depth.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureFunnelEventsSchema } from '../services/funnelEventsSchema';

// The audit-specified funnel event list. Anything not named here is dropped.
// Keep in sync with EVENTS in frontend/src/lib/funnel.js + ANALYTICS_FUNNEL.md.
export const FUNNEL_EVENT_ALLOWLIST = new Set([
  'landing_view',
  'register_view',
  'register_form_start',
  'register_field_error',
  'register_turnstile_failed',
  'register_submit',
  'register_success',
  'register_resend_click',
  'verify_email_view',
  'verify_email_result',
  'totp_setup_start',
  'totp_setup_complete',
  'totp_setup_abandon',
  'login_view',
  'login_submit',
  'login_error',
  'login_success',
  'onboarding_chat_view',
  'onboarding_chat_complete',
  'onboarding_chat_skip',
  'dashboard_first_view',
]);

const MAX_BODY_BYTES = 16384; // hard cap before parsing
const MAX_BATCH = 20;         // events per request
const MAX_PROPS_JSON = 500;   // serialized props blob cap

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function clipStr(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// Coarse browser family from the request user-agent. Deliberately lossy —
// "does this only break on Safari?" is answerable; fingerprinting is not.
export function browserFamily(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (s.includes('edg/') || s.includes('edgios/') || s.includes('edga/')) return 'edge';
  if (s.includes('opr/') || s.includes('opera')) return 'opera';
  if (s.includes('samsungbrowser/')) return 'samsung';
  if (s.includes('firefox/') || s.includes('fxios/')) return 'firefox';
  if (s.includes('chrome/') || s.includes('crios/')) return 'chrome';
  if (s.includes('safari/')) return 'safari';
  return 'other';
}

type SanitizedEvent = {
  event: string;
  anon_id: string | null;
  session_id: string | null;
  client_ts: number | null;
  path: string | null;
  referrer: string | null;
  device: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  ref_code: string | null;
  lane: string | null;
  invite_type: string | null;
  props: string | null;
};

// Validate + clip one raw client event. Returns null when the entry is not
// usable (unknown event name, wrong shape) — callers drop it silently.
export function sanitizeEvent(raw: unknown): SanitizedEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const event = typeof e.event === 'string' ? e.event : '';
  if (!FUNNEL_EVENT_ALLOWLIST.has(event)) return null;

  const id = (v: unknown) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

  // Strip any query/fragment from path + referrer as defense in depth —
  // verification / magic-link URLs carry tokens in the query string.
  const bare = (v: unknown, max: number) => {
    const s = clipStr(v, max);
    if (!s) return null;
    return s.split('?')[0].split('#')[0].slice(0, max) || null;
  };

  let props: string | null = null;
  if (e.props && typeof e.props === 'object' && !Array.isArray(e.props)) {
    try {
      const json = JSON.stringify(e.props);
      if (json && json !== '{}' && json.length <= MAX_PROPS_JSON) props = json;
    } catch { props = null; }
  }

  const device = e.device === 'mobile' || e.device === 'desktop' ? (e.device as string) : null;

  return {
    event,
    anon_id: id(e.anon_id),
    session_id: id(e.session_id),
    client_ts: typeof e.client_ts === 'number' && Number.isFinite(e.client_ts) ? Math.floor(e.client_ts) : null,
    path: bare(e.path, 200),
    referrer: bare(e.referrer, 200),
    device,
    utm_source: clipStr(e.utm_source, 80),
    utm_medium: clipStr(e.utm_medium, 80),
    utm_campaign: clipStr(e.utm_campaign, 80),
    ref_code: clipStr(e.ref_code, 80),
    lane: clipStr(e.lane, 80),
    invite_type: clipStr(e.invite_type, 80),
    props,
  };
}

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  try {
    const raw = await c.req.text();
    if (!raw || raw.length > MAX_BODY_BYTES) return c.body(null, 204);

    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(raw);
      body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch { body = null; }
    if (!body || !Array.isArray(body.events)) return c.body(null, 204);

    const sanitized = (body.events as unknown[])
      .slice(0, MAX_BATCH)
      .map(sanitizeEvent)
      .filter((e): e is SanitizedEvent => e !== null);
    if (sanitized.length === 0) return c.body(null, 204);

    await ensureFunnelEventsSchema(c.env);

    const browser = browserFamily(c.req.header('user-agent'));
    const stmt = c.env.DB.prepare(
      `INSERT INTO funnel_events
         (event, anon_id, session_id, client_ts, path, referrer, device, browser,
          utm_source, utm_medium, utm_campaign, ref_code, lane, invite_type, props)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await c.env.DB.batch(
      sanitized.map((e) =>
        stmt.bind(
          e.event, e.anon_id, e.session_id, e.client_ts, e.path, e.referrer,
          e.device, browser, e.utm_source, e.utm_medium, e.utm_campaign,
          e.ref_code, e.lane, e.invite_type, e.props,
        ),
      ),
    );
  } catch (err) {
    // The telemetry sink must never throw or block a user flow.
    console.error('[track] funnel event insert failed', err);
  }
  return c.body(null, 204);
});

export default app;

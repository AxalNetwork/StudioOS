/** Accept anonymous browser error beacons and record bounded section diagnostics. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { clientSectionHint } from '../util/clientSection';
import type { RouteMount } from '../util/routeRegistry';
import track from './track';

const clientError = new Hono<{ Bindings: Env }>();

// Task #10 — Client error sink. Captures sanitized browser-side errors (render
// throws, failed loads, 401-redirects) into the Worker logs so a production-only
// failure like the passkey → /studio blank leaves a trace that's retrievable
// via `wrangler tail` / deployment logs (grep for `[client-error]`). The
// frontend's reportError() beacons here WITHOUT credentials, so the request
// carries no auth cookie (hence no CSRF requirement), no token, and no PII.
// Best-effort: it never blocks, always returns 204, and the body is size-capped
// before parsing. Abuse is bounded by the per-IP rate-limit buckets.
clientError.post('/', async (c) => {
  try {
    const raw = await c.req.text();
    // Hard size cap — drop anything implausibly large before parsing.
    if (raw && raw.length <= 8192) {
      let body: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(raw);
        body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      if (body) {
        const clip = (v: unknown, n: number) => (v == null ? undefined : String(v).slice(0, n));
        const entry = {
          scope: clip(body.scope, 200) || 'unknown',
          level: body.level === 'warn' ? 'warn' : 'error',
          name: clip(body.name, 100),
          message: clip(body.message, 500),
          path: clip(body.path, 200),
          client_section_hint: clientSectionHint(body.path, body.sectionContext, body.scope),
          ts: typeof body.ts === 'number' ? body.ts : Date.now(),
          stack: clip(body.stack, 2000),
          // Deliberately NO IP. The client already redacts secrets/PII from the
          // free-form fields above; we keep only the user-agent as operational
          // telemetry (it's what lets us tell "this blank only happens on Safari
          // 17" from "this is universal"). Cloudflare's edge logs still retain
          // the source IP if it's ever needed for an abuse investigation.
          ua: clip(c.req.header('user-agent'), 200),
        };
        // One structured line so it's greppable in deployment logs.
        console.error('[client-error]', JSON.stringify(entry));
      }
    }
  } catch {
    /* the telemetry sink must never throw */
  }
  return c.body(null, 204);
});

// Preserve the existing order of the anonymous telemetry endpoints.
export const mount: RouteMount = { path: '/api/client-error', router: clientError, before: [track] };

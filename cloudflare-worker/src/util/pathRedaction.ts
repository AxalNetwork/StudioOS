/**
 * D4672 (#4672) — a request path as telemetry may keep it: with every
 * credential the path carries replaced by its parameter name.
 *
 * Several public routes take their credential in the path (a consent link, a
 * share or signing link, a download or invitation token). The observability
 * middleware wrote the raw path into `system_metrics`, Analytics Engine,
 * `activity_logs` and `error_logs`, and the rate limiter into
 * `rate_limit_logs`, so each of those stores held working links.
 *
 * TWO RULES, the first preferred:
 *   1. When the router matched a route, its pattern says which segments are
 *      parameters. Every parameter whose NAME says it is a credential (token,
 *      secret, signature, code) is replaced by `:<name>`; every other segment
 *      is kept, so route metrics stay as useful as before.
 *   2. When no route matched (a 404, or before routing, as in the rate
 *      limiter), nothing says which segment is what, so every segment that
 *      LOOKS opaque — 20 or more URL-safe characters — is replaced by
 *      `:redacted`. A mistyped link is still a link.
 *
 * Driven by the route table rather than a list of prefixes, so a new
 * `/:token` route is covered the day it is mounted.
 */

const CREDENTIAL_PARAM = /^:(?:[A-Za-z_]*(?:token|Token|secret|Secret|signature|Signature)[A-Za-z_]*|sig|code)(?:\{.*\})?$/;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_\-.~%]{20,}$/;

function byPattern(path: string, pattern: string): string | null {
  if (!pattern || pattern.includes('*')) return null;
  const parts = path.split('/');
  const pat = pattern.split('/');
  if (parts.length !== pat.length) return null;
  return parts.map((seg, i) => {
    const p = pat[i];
    if (!p.startsWith(':') || !CREDENTIAL_PARAM.test(p)) return seg;
    return p.replace(/\{.*\}$/, '');
  }).join('/');
}

function byShape(path: string): string {
  return path.split('/').map((seg) => (OPAQUE_SEGMENT.test(seg) ? ':redacted' : seg)).join('/');
}

/** The path to record. `routePattern` is Hono's `c.req.routePath` after the handler ran, when there is one. */
export function redactPath(path: string, routePattern?: string | null): string {
  return byPattern(path, routePattern || '') ?? byShape(path);
}

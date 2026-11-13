/**
 * D1315 (#2418) — Account › Developer is Account › Builder. A page load of
 * `/account/developer` or any address under it answers a permanent 308 to the
 * same address under `/account/builder`, the sub-path and the query kept.
 * `wrangler.toml` runs the Worker first for these two paths only, so every
 * other page still comes from the assets binding. The SPA's `BuilderRedirect`
 * is the same rule for a link followed inside the app.
 */
export const LEGACY_BUILDER_PATHS = ['/account/developer', '/account/developer/*'] as const;

/** The new address for an old one, or null when the path is not under /account/developer. */
export function builderRedirectTarget(pathname: string, search = ''): string | null {
  const m = /^\/account\/developer(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const rest = m[1] && m[1] !== '/' ? m[1] : '';
  return `/account/builder${rest}${search}`;
}

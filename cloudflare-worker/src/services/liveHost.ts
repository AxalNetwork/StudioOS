/**
 * D1083 (#2948) — one Live line per host.
 *
 * An app the founder built in Lovable can be served by Lovable or deployed to
 * Vercel. When both connectors know the same address, the page draws one Live
 * line, not two: the line is Vercel's (it knows the deploy, the commit and the
 * build), and From Lovable reads "Hosted on Vercel".
 *
 * The rule is an exact host match: lower-cased, without a port or a trailing
 * dot. `app.example` and `www.app.example` are different hosts, and a project
 * or company name is never matched. Vercel part 3 (D1098, #2963) passes its
 * production domains; until it lands the list is empty and every line is
 * Lovable's.
 */

export type LiveLineOwner = 'vercel' | 'lovable';

/** A URL's or bare host's host, normalised for comparison; null when it has none. */
export function hostOf(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let host: string;
  try {
    host = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? new URL(raw).hostname : new URL(`https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  return host.includes('.') ? host : null;
}

/** Whose Live line an app host is: Vercel's on an exact production-domain match, else Lovable's. */
export function liveLineOwner(appHost: string | null | undefined, vercelProductionDomains: ReadonlyArray<string>): LiveLineOwner {
  const host = hostOf(appHost);
  if (!host) return 'lovable';
  for (const domain of vercelProductionDomains) {
    if (hostOf(domain) === host) return 'vercel';
  }
  return 'lovable';
}

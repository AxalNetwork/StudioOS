/**
 * D593 — a saved competitor links to its company directory profile when one
 * exists (the C0 board of "Pages · Founder Research Analysis").
 *
 * A competitor row holds what the run or the founder typed: a name, and a
 * domain or URL when one is known. The directory (`research_company_directory`,
 * migration 228) holds a name and a website per company. Nothing joins the two,
 * so the link is worked out on each read, and it is made only when it is
 * unambiguous:
 *
 *   1. by site: the competitor's host equals exactly one directory row's host
 *      (`www.` ignored). Two rows on one host link neither;
 *   2. by name, only when no row matched by site: the competitor's name equals
 *      exactly one directory row's name, ignoring case and spacing.
 *
 * Anything else stays unlinked — a hand-typed name with no profile reads as
 * plain text, which is what the canvas draws. Nothing is written: the link is
 * not stored, so a directory row that changes moves the link with it.
 */

type CandidateLike = { id?: unknown; name?: unknown; domain?: unknown; url?: unknown };
type DirectoryRow = { uid?: unknown; name?: unknown; website?: unknown };

/** The host of a URL or a bare domain, lower-case and without `www.`; null when there is none. */
export function hostOf(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** A name compared without case or repeated spacing; null when blank. */
export function nameKey(value: unknown): string | null {
  const key = typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return key || null;
}

/**
 * Candidate id → directory uid, for every candidate. A candidate the rows do
 * not settle maps to null.
 */
export function matchDirectory(candidates: CandidateLike[], rows: DirectoryRow[]): Map<string, string | null> {
  const byHost = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    const uid = typeof row.uid === 'string' ? row.uid : null;
    if (!uid) continue;
    const host = hostOf(row.website);
    if (host) byHost.set(host, [...(byHost.get(host) || []), uid]);
    const key = nameKey(row.name);
    if (key) byName.set(key, [...(byName.get(key) || []), uid]);
  }
  const out = new Map<string, string | null>();
  for (const c of candidates) {
    const id = String(c.id ?? '');
    const host = hostOf(c.domain) || hostOf(c.url);
    const onHost = host ? byHost.get(host) || [] : [];
    if (onHost.length) {
      out.set(id, onHost.length === 1 ? onHost[0] : null);
      continue;
    }
    const key = nameKey(c.name);
    const named = key ? byName.get(key) || [] : [];
    out.set(id, named.length === 1 ? named[0] : null);
  }
  return out;
}

/**
 * The directory rows that could match these candidates: an exact name, or a
 * website containing one of their hosts (the host test proper is
 * `matchDirectory`'s). Both lists are bound as JSON arrays, never interpolated.
 */
export const DIRECTORY_CANDIDATE_ROWS_SQL = `SELECT uid, name, website FROM research_company_directory
  WHERE lower(trim(name)) IN (SELECT value FROM json_each(?))
     OR EXISTS (SELECT 1 FROM json_each(?) AS h WHERE instr(lower(website), h.value) > 0)`;

export type DirectoryLinkRead = { status: 'read' | 'unreadable'; byId: Map<string, string | null> };

/** Reads the directory for these candidates. A failed read links nothing and says so. */
export async function linkCandidatesToDirectory(db: D1Database, candidates: CandidateLike[]): Promise<DirectoryLinkRead> {
  const names = [...new Set(candidates.map((c) => nameKey(c.name)).filter((v): v is string => !!v))];
  const hosts = [...new Set(candidates.map((c) => hostOf(c.domain) || hostOf(c.url)).filter((v): v is string => !!v))];
  if (!names.length && !hosts.length) return { status: 'read', byId: matchDirectory(candidates, []) };
  try {
    const res = await db.prepare(DIRECTORY_CANDIDATE_ROWS_SQL).bind(JSON.stringify(names), JSON.stringify(hosts)).all();
    return { status: 'read', byId: matchDirectory(candidates, (res.results || []) as DirectoryRow[]) };
  } catch {
    return { status: 'unreadable', byId: new Map(candidates.map((c) => [String(c.id ?? ''), null])) };
  }
}

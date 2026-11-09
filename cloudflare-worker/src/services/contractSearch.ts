/**
 * D4811 (#4811) part 4 — cross-object legal search (board CT-13): templates,
 * agreements and governance records in one ranked list, each result naming
 * its object type, entity (or company / category), status and version. Read
 * by `GET /api/admin/contracts/search` (`routes/admin_contracts.ts`).
 *
 * CURRENT FIRST. By default each object is its current version: a template's
 * library row, a governance record's latest file. Earlier versions (template
 * history rows, earlier governance files) are counted as `hidden_historical`
 * and returned, tagged `historical`, only with `historical=true`. Agreements
 * have no versions here.
 *
 * WHO. Governance is HQ's (D4563): a branch Worker searches none of it. A
 * confidential record is the Super Admin's alone: for anyone else it is not
 * matched, listed or counted, not even as hidden. Bound SQL throughout; the
 * query reaches SQL only as a LIKE pattern with `\` escapes.
 */
import type { Env } from '../types';
import { GOVERNANCE_ENTITIES, entityName, type GovernanceEntity } from './governance';
import { templateSafety } from './templateSafety';

export const SEARCH_TYPES = ['template', 'agreement', 'governance'] as const;
export type SearchType = typeof SEARCH_TYPES[number];
export const SEARCH_LIMIT = 50;

export type SearchResult = {
  type: SearchType;
  key: string;
  title: string;
  context: string | null;
  status: string | null;
  version: number | null;
  historical: boolean;
  score: number;
  updated_at: string | null;
  template?: { slug: string; is_active: number; published_version: number | null; safety: ReturnType<typeof templateSafety> };
  agreement?: { uid: string; source: string; raw_status: string | null };
  governance?: { uid: string; entity_key: GovernanceEntity };
};

/** The query as it is searched: trimmed, spaces collapsed, 2 to 200 characters; null when unusable. */
export function searchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim().replace(/\s+/g, ' ');
  return q.length >= 2 && q.length <= 200 ? q : null;
}

/** A LIKE pattern for the query, with %, _ and \ escaped (used with ESCAPE '\'). */
export const likeOf = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * How well a result's fields match: an exact title 4, a title that starts
 * with the query 3, a word in the title that starts with it 2, anywhere in
 * the title 1.5, only in another field 1, none 0. Case-insensitive.
 */
export function scoreOf(q: string, title: string | null | undefined, others: ReadonlyArray<string | null | undefined> = []): number {
  const n = q.toLowerCase();
  const t = String(title ?? '').toLowerCase();
  if (t === n) return 4;
  if (t.startsWith(n)) return 3;
  if (t.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(n)) || t.includes(` ${n}`)) return 2;
  if (t.includes(n)) return 1.5;
  return others.some((o) => String(o ?? '').toLowerCase().includes(n)) ? 1 : 0;
}

/** Ranked: score, then current before historical, then most recently updated, then title, then the newer version. */
export function rank(results: SearchResult[]): SearchResult[] {
  return results.sort((a, b) => b.score - a.score
    || Number(a.historical) - Number(b.historical)
    || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))
    || a.title.localeCompare(b.title)
    || Number(b.version ?? 0) - Number(a.version ?? 0));
}

/** Templates: the library rows (current) and their history rows (historical). */
export async function searchTemplates(env: Env, q: string): Promise<{ current: SearchResult[]; historical: SearchResult[] }> {
  const like = likeOf(q);
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.category, t.version, t.is_active, t.is_stub, t.body_md, t.updated_at, p.version AS published_version
       FROM legal_templates t LEFT JOIN legal_template_publications p ON p.template_id = t.id
      WHERE lower(t.title) LIKE ? ESCAPE '\\' OR lower(t.slug) LIKE ? ESCAPE '\\' OR lower(t.category) LIKE ? ESCAPE '\\'
      LIMIT 200`,
  ).bind(like, like, like).all<any>()).results || [];
  const current = rows.map((r: any): SearchResult => ({
    type: 'template', key: `template:${r.slug}`, title: r.title, context: r.category ?? null,
    status: Number(r.is_active) === 0 ? 'archived' : null, version: r.version == null ? null : Number(r.version), historical: false,
    score: scoreOf(q, r.title, [r.slug, r.category]), updated_at: r.updated_at ?? null,
    template: { slug: r.slug, is_active: Number(r.is_active), published_version: r.published_version == null ? null : Number(r.published_version),
      safety: templateSafety({ slug: r.slug, is_stub: r.is_stub, body_md: r.body_md }) },
  }));
  const hist = (await env.DB.prepare(
    `SELECT v.slug, v.version, v.title, v.category, v.created_at, t.version AS current_version, t.is_active, t.is_stub, t.body_md, p.version AS published_version
       FROM legal_template_versions v JOIN legal_templates t ON t.id = v.template_id
       LEFT JOIN legal_template_publications p ON p.template_id = t.id
      WHERE v.version < t.version AND (lower(v.title) LIKE ? ESCAPE '\\' OR lower(v.slug) LIKE ? ESCAPE '\\' OR lower(v.category) LIKE ? ESCAPE '\\')
      LIMIT 200`,
  ).bind(like, like, like).all<any>().catch(() => ({ results: [] }))).results || [];
  const historical = hist.map((r: any): SearchResult => ({
    type: 'template', key: `template:${r.slug}:v${r.version}`, title: r.title, context: r.category ?? null,
    status: 'superseded', version: Number(r.version), historical: true,
    score: scoreOf(q, r.title, [r.slug, r.category]), updated_at: r.created_at ?? null,
    template: { slug: r.slug, is_active: Number(r.is_active), published_version: r.published_version == null ? null : Number(r.published_version),
      safety: templateSafety({ slug: r.slug, is_stub: r.is_stub, body_md: r.body_md }) },
  }));
  return { current, historical };
}

/** Governance records: the record at its latest file (current) and its earlier files (historical). */
export async function searchGovernance(env: Env, q: string, superAdmin: boolean): Promise<{ current: SearchResult[]; historical: SearchResult[] }> {
  const like = likeOf(q);
  // A confidential record is filtered in SQL for anyone but the Super Admin: it is never read, so it can never be counted.
  const rows = (await env.DB.prepare(
    `SELECT d.uid, d.entity_key, d.category, d.title, d.status, d.updated_at,
            (SELECT MAX(version) FROM governance_document_versions v WHERE v.document_uid = d.uid) AS latest
       FROM governance_documents d
      WHERE (? = 1 OR d.confidential = 0) AND (lower(d.title) LIKE ? ESCAPE '\\' OR lower(d.category) LIKE ? ESCAPE '\\')
      LIMIT 200`,
  ).bind(superAdmin ? 1 : 0, like, like).all<any>()).results || [];
  const current: SearchResult[] = [];
  const historical: SearchResult[] = [];
  for (const r of rows as any[]) {
    if (!(GOVERNANCE_ENTITIES as readonly string[]).includes(r.entity_key)) continue;
    const entity = entityName(r.entity_key);
    const latest = r.latest == null ? null : Number(r.latest);
    const score = scoreOf(q, r.title, [r.category, entity]);
    current.push({ type: 'governance', key: `governance:${r.uid}`, title: r.title, context: entity, status: r.status, version: latest,
      historical: false, score, updated_at: r.updated_at ?? null, governance: { uid: r.uid, entity_key: r.entity_key } });
    for (let v = (latest ?? 1) - 1; v >= 1; v--) {
      historical.push({ type: 'governance', key: `governance:${r.uid}:v${v}`, title: r.title, context: entity, status: r.status, version: v,
        historical: true, score, updated_at: r.updated_at ?? null, governance: { uid: r.uid, entity_key: r.entity_key } });
    }
  }
  return { current, historical };
}

/** Agreements from the Contracts union (already loaded by the route): title, recipient, company, template and type. */
export function searchAgreements(rows: ReadonlyArray<any>, q: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of rows) {
    const others = [r.recipient_name, r.recipient_email, r.project_name, r.template_name, r.doc_type,
      r.agreement?.licence_ref, r.agreement?.counterparty, r.agreement?.program_name, r.agreement?.package_name];
    const score = scoreOf(q, r.title, others);
    if (score === 0) continue;
    out.push({ type: 'agreement', key: `agreement:${r.source}:${r.uid ?? r.id}`, title: r.title || 'Untitled agreement',
      context: r.project_name || null, status: r.status ?? null, version: null, historical: false, score,
      updated_at: r.signed_at || r.created_at || null, agreement: { uid: String(r.uid ?? ''), source: String(r.source ?? ''), raw_status: r.raw_status ?? null } });
  }
  return out;
}

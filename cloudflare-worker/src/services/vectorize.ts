/**
 * Vectorize semantic search service.
 *
 * Index: `axal-search` — 768-dim, cosine. Embeddings via Workers AI
 * `@cf/baai/bge-base-en-v1.5`.
 *
 * Vector IDs follow the pattern `{type}:{id}` (e.g. `project:42`,
 * `partner:7`, `document:103`) so we can target deletes precisely and
 * avoid namespace collisions across entity types.
 *
 * Metadata stored alongside each vector lets the search route render
 * results without a second D1 round-trip per hit:
 *   { type, entity_id, title, url, snippet }
 */
import type { Env } from '../types';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const MAX_INPUT_CHARS = 4000; // bge models cap around 512 tokens; ~4k chars is safe.

export type EntityType = 'project' | 'deal' | 'founder' | 'partner' | 'document' | 'academy_lesson' | 'advisor' | 'investor';

export const ALL_ENTITY_TYPES: EntityType[] = ['project', 'deal', 'founder', 'partner', 'document', 'academy_lesson', 'advisor', 'investor'];

export interface SearchHit {
  id: string;
  type: EntityType;
  entity_id: number;
  title: string;
  url: string;
  snippet: string;
  score: number;
}

function vectorId(type: EntityType, id: number) {
  return `${type}:${id}`;
}

function clampText(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_INPUT_CHARS ? t.slice(0, MAX_INPUT_CHARS) : t;
}

export async function embedText(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI) return null;
  const input = clampText(text);
  if (!input) return null;
  try {
    const out: any = await env.AI.run(EMBED_MODEL, { text: [input] });
    const v = out?.data?.[0];
    if (!Array.isArray(v) || v.length !== 768) {
      console.error('embedText: unexpected vector shape', { len: v?.length });
      return null;
    }
    return v;
  } catch (e: any) {
    console.error('embedText failed:', e?.message);
    return null;
  }
}

interface UpsertArgs {
  type: EntityType;
  id: number;
  text: string;
  title: string;
  url: string;
  snippet?: string;
}

export async function upsertEntity(env: Env, args: UpsertArgs): Promise<boolean> {
  if (!env.VECTORIZE) {
    console.warn('VECTORIZE binding missing — upsert skipped');
    return false;
  }
  const vector = await embedText(env, args.text);
  if (!vector) return false;
  try {
    await env.VECTORIZE.upsert([{
      id: vectorId(args.type, args.id),
      values: vector,
      metadata: {
        type: args.type,
        entity_id: args.id,
        title: args.title.slice(0, 200),
        url: args.url,
        snippet: (args.snippet || args.text).slice(0, 280),
      },
    }]);
    return true;
  } catch (e: any) {
    console.error('vectorize.upsert failed:', e?.message);
    return false;
  }
}

export async function deleteEntity(env: Env, type: EntityType, id: number): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    await env.VECTORIZE.deleteByIds([vectorId(type, id)]);
  } catch (e: any) {
    console.error('vectorize.deleteByIds failed:', e?.message);
  }
}

export interface SearchOpts {
  topK?: number;
  type?: EntityType;
}

export async function searchSemantic(env: Env, query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
  if (!env.VECTORIZE) return [];
  const vector = await embedText(env, query);
  if (!vector) return [];
  try {
    const queryArgs: any = {
      topK: Math.max(1, Math.min(50, opts.topK ?? 10)),
      returnMetadata: 'all',
    };
    if (opts.type) queryArgs.filter = { type: opts.type };
    const res: any = await env.VECTORIZE.query(vector, queryArgs);
    const matches = res?.matches || [];
    return matches.map((m: any) => ({
      id: m.id,
      type: (m.metadata?.type || m.id.split(':')[0]) as EntityType,
      entity_id: Number(m.metadata?.entity_id ?? m.id.split(':')[1] ?? 0),
      title: String(m.metadata?.title || ''),
      url: String(m.metadata?.url || ''),
      snippet: String(m.metadata?.snippet || ''),
      score: Number(m.score ?? 0),
    }));
  } catch (e: any) {
    console.error('vectorize.query failed:', e?.message);
    return [];
  }
}

/**
 * Build composite text + metadata for a given entity and upsert it.
 * Called from the queue worker (`embed_entity` job type).
 */
export async function embedAndUpsertById(env: Env, type: EntityType, id: number): Promise<boolean> {
  if (type === 'project') {
    const row = await env.DB.prepare(
      `SELECT id, name, sector, description, problem_statement, solution, why_now, status, stage FROM projects WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) {
      // Entity was deleted between enqueue and processing — purge any stale vector
      // so the index doesn't keep returning hits for ghost rows.
      await deleteEntity(env, type, id);
      return false;
    }
    const text = [row.name, row.sector, row.problem_statement, row.solution, row.description, row.why_now].filter(Boolean).join('\n');
    return upsertEntity(env, {
      type, id,
      text,
      title: row.name,
      url: `/projects/${id}`,
      snippet: row.problem_statement || row.description || '',
    });
  }
  if (type === 'partner') {
    const row = await env.DB.prepare(
      `SELECT id, name, email, role FROM users WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    // Schema reality: users table has no bio column. We index name+role+email-domain so
    // searches like "founder at acme" still hit. Extend later if a profile.bio is added.
    const domain = (row.email || '').split('@')[1] || '';
    const text = [row.name, row.role, domain].filter(Boolean).join('\n');
    return upsertEntity(env, {
      type, id,
      text,
      title: `${row.name} (${row.role})`,
      // Task #5 (AV) — partner CTAs are surfaced to founders/investors,
      // so the route must point at the user-facing partner directory
      // instead of the admin user editor (which non-admins cannot open).
      url: `/partners?user=${id}`,
      snippet: `${row.role} • ${domain}`,
    });
  }
  if (type === 'deal') {
    const row = await env.DB.prepare(
      `SELECT d.id, d.status, d.notes, d.amount, p.name AS project_name, p.sector
         FROM deals d LEFT JOIN projects p ON p.id = d.project_id
        WHERE d.id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    const text = [row.project_name, row.sector, row.status, row.notes].filter(Boolean).join('\n');
    return upsertEntity(env, {
      type, id,
      text,
      title: `Deal — ${row.project_name || `#${id}`}`,
      url: `/deals?id=${id}`,
      // Snippet is wire-visible; keep it neutral (status + sector), no notes body.
      snippet: `${row.status || 'applied'} • ${row.sector || 'sector unknown'}`,
    });
  }
  if (type === 'founder') {
    const row = await env.DB.prepare(
      `SELECT id, name, email, domain_expertise, experience_years, bio FROM founders WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    const text = [row.name, row.domain_expertise, row.bio].filter(Boolean).join('\n');
    return upsertEntity(env, {
      type, id,
      text,
      title: row.name,
      url: `/founder?id=${id}`,
      snippet: `${row.domain_expertise || 'founder'} • ${row.experience_years || 0}y exp`,
    });
  }
  if (type === 'academy_lesson') {
    const row = await env.DB.prepare(
      `SELECT id, slug, title, summary, body FROM academy_lessons WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    const text = [row.title, row.summary, row.body].filter(Boolean).join('\n');
    return upsertEntity(env, {
      type, id,
      text,
      title: row.title,
      url: `/academy/${row.slug || id}`,
      snippet: (row.summary || '').slice(0, 200),
    });
  }
  if (type === 'advisor') {
    // Task #5 (AV) — advisor index for findAdvisor.
    const row = await env.DB.prepare(
      `SELECT id, display_name, bio, expertise_json, sectors_json, hourly_rate_usd, is_active
         FROM advisors WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    let expertise: string[] = []; let sectors: string[] = [];
    try { expertise = JSON.parse(row.expertise_json || '[]'); } catch { /* noop */ }
    try { sectors = JSON.parse(row.sectors_json || '[]'); } catch { /* noop */ }
    const text = [row.display_name, row.bio, expertise.join(' '), sectors.join(' ')].filter(Boolean).join('\n');
    const sectorTag = sectors[0] || '';
    if (!env.VECTORIZE) return false;
    const vector = await embedText(env, text);
    if (!vector) return false;
    try {
      await env.VECTORIZE.upsert([{
        id: vectorId(type, id),
        values: vector,
        metadata: {
          type, entity_id: id,
          title: String(row.display_name || `Advisor #${id}`).slice(0, 200),
          url: `/advisorship?advisor=${id}`,
          snippet: `${expertise.slice(0, 3).join(', ') || 'Advisor'} • ${sectorTag || 'multi-sector'}`,
          sector: sectorTag,
          expertise: expertise.slice(0, 5).join(','),
          active: row.is_active ? 1 : 0,
          hourly_rate_usd: Number(row.hourly_rate_usd || 0),
        },
      }]);
      return true;
    } catch (e: any) {
      console.error('vectorize.upsert advisor failed:', e?.message);
      return false;
    }
  }
  if (type === 'investor') {
    // Task #5 (AV) — investor index for findInvestor (keyed by users.id).
    const row = await env.DB.prepare(
      `SELECT u.id, u.name, u.email, ip.investor_type, ip.sectors_json, ip.stages_json,
              ip.geos_json, ip.ticket_min_usd, ip.ticket_max_usd, ip.thesis_text
         FROM users u
         LEFT JOIN investor_profiles ip ON ip.user_id = u.id
        WHERE u.id = ? AND u.role = 'investor'`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    let sectors: string[] = []; let stages: string[] = []; let geos: string[] = [];
    try { sectors = JSON.parse(row.sectors_json || '[]'); } catch { /* noop */ }
    try { stages = JSON.parse(row.stages_json || '[]'); } catch { /* noop */ }
    try { geos = JSON.parse(row.geos_json || '[]'); } catch { /* noop */ }
    const text = [
      row.name, row.investor_type, row.thesis_text,
      sectors.join(' '), stages.join(' '), geos.join(' '),
    ].filter(Boolean).join('\n');
    if (!env.VECTORIZE) return false;
    const vector = await embedText(env, text);
    if (!vector) return false;
    try {
      await env.VECTORIZE.upsert([{
        id: vectorId(type, id),
        values: vector,
        metadata: {
          type, entity_id: id,
          title: String(row.name || `Investor #${id}`).slice(0, 200),
          url: `/network?investor=${id}`,
          snippet: `${row.investor_type || 'Investor'} • ${sectors.slice(0, 2).join(', ') || 'multi-sector'} • ${stages.slice(0, 2).join('/') || 'any stage'}`,
          sector: sectors[0] || '',
          stage: stages[0] || '',
          geo: geos[0] || '',
          ticket_min_usd: Number(row.ticket_min_usd || 0),
          ticket_max_usd: Number(row.ticket_max_usd || 0),
        },
      }]);
      return true;
    } catch (e: any) {
      console.error('vectorize.upsert investor failed:', e?.message);
      return false;
    }
  }
  if (type === 'document') {
    const row = await env.DB.prepare(
      `SELECT id, deal_id, type AS doc_type, status, content FROM legal_documents WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    const text = [row.doc_type, row.status, row.content].filter(Boolean).join('\n');
    // Security #8 — storage cleanup:
    // The `text` field is fed into the embedding model and stored in
    // Vectorize as a vector (not human-readable). The `snippet` field,
    // however, is round-tripped via metadata and surfaced verbatim in
    // /api/search responses — so it must NEVER carry contract body text
    // or rendered template vars (which contain PII like investor name,
    // amount, valuation cap). Use neutral type/status metadata only.
    return upsertEntity(env, {
      type, id,
      text,
      title: `${row.doc_type} (deal #${row.deal_id})`,
      // /legal-capital is reachable by admin/founder/partner/investor;
      // /legal is admin/founder only and would 403 the others.
      url: `/legal-capital?document=${id}`,
      snippet: `${row.doc_type} • ${row.status || 'draft'} • deal #${row.deal_id}`,
    });
  }
  return false;
}

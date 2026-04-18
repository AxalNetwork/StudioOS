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

export type EntityType = 'project' | 'partner' | 'document';

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
      url: `/admin?user=${id}`,
      snippet: `${row.role} • ${row.email}`,
    });
  }
  if (type === 'document') {
    const row = await env.DB.prepare(
      `SELECT id, deal_id, type AS doc_type, status, content FROM legal_documents WHERE id = ?`
    ).bind(id).first<any>();
    if (!row) { await deleteEntity(env, type, id); return false; }
    const text = [row.doc_type, row.status, row.content].filter(Boolean).join('\n');
    return upsertEntity(env, {
      type, id,
      text,
      title: `${row.doc_type} (deal #${row.deal_id})`,
      url: `/legal?deal=${row.deal_id}`,
      snippet: String(row.content || '').slice(0, 280),
    });
  }
  return false;
}

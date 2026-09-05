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

export type EntityType = 'project' | 'deal' | 'founder' | 'partner' | 'document' | 'academy_lesson' | 'advisor' | 'investor' | 'research_doc';

/**
 * EVERY TYPE THE HOURLY SWEEP RE-INDEXES. This is NOT the list of types a
 * search may return — `routes/search.ts` keeps its own, deliberately shorter
 * one, and the two must be allowed to differ.
 *
 * They used to be the same array (`const VALID_TYPES = ALL_ENTITY_TYPES`),
 * which meant adding a type here so it could be indexed also published it to
 * global search in the same edit. For `research_doc` — private documents whose
 * vector snippet is the document's own text — that would have been a
 * cross-account disclosure introduced by following the existing pattern
 * exactly. `search.ts` now names its types explicitly and a test asserts
 * `research_doc` is in this list and not in that one.
 */
export const ALL_ENTITY_TYPES: EntityType[] = ['project', 'deal', 'founder', 'partner', 'document', 'academy_lesson', 'advisor', 'investor', 'research_doc'];

export interface SearchHit {
  id: string;
  type: EntityType;
  entity_id: number;
  title: string;
  url: string;
  snippet: string;
  score: number;
  /**
   * NULL for every directory type — they have no owner and never did. Set only
   * for the owner-private types, where `searchSemantic` re-checks it against
   * the caller. See the three layers documented there.
   */
  owner_user_id?: number | null;
  /** Which chunk of a multi-chunk document this hit is, for a citation. */
  chunk?: number;
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
  /** Chunk index, for documents stored as several vectors. */
  chunk?: number;
  /** Vectorize namespace to write into. Omitted by every directory type. */
  namespace?: string;
  /** Set for owner-private types; `searchSemantic` re-checks it. */
  ownerUserId?: number;
}

export async function upsertEntity(env: Env, args: UpsertArgs): Promise<boolean> {
  if (!env.VECTORIZE) {
    console.warn('VECTORIZE binding missing — upsert skipped');
    return false;
  }
  const vector = await embedText(env, args.text);
  if (!vector) return false;
  try {
    const metadata: Record<string, unknown> = {
      type: args.type,
      entity_id: args.id,
      title: args.title.slice(0, 200),
      url: args.url,
      snippet: (args.snippet || args.text).slice(0, 280),
    };
    if (args.ownerUserId != null) metadata.owner_user_id = args.ownerUserId;
    if (args.chunk != null) metadata.chunk = args.chunk;
    const vec: Record<string, unknown> = {
      id: args.chunk == null ? vectorId(args.type, args.id) : chunkVectorId(args.type, args.id, args.chunk),
      values: vector,
      metadata,
    };
    if (args.namespace) vec.namespace = args.namespace;
    await env.VECTORIZE.upsert([vec as any]);
    return true;
  } catch (e: any) {
    console.error('vectorize.upsert failed:', e?.message);
    return false;
  }
}

/**
 * `{type}:{id}:{chunk}` — note `searchSemantic`'s fallback still parses the
 * entity id out of `split(':')[1]`, so a chunk id degrades correctly to its
 * document when metadata is somehow absent. Max vector id is 64 bytes; this
 * shape is far inside it.
 */
function chunkVectorId(type: EntityType, id: number, chunk: number) {
  return `${type}:${id}:${chunk}`;
}

/**
 * Delete every vector of a chunked document.
 *
 * Vectorize has `deleteByIds` and no delete-by-prefix, which is the whole
 * reason `research_documents.chunk_count` is stored: without it the ids cannot
 * be reconstructed and the chunks outlive the row, still answerable by a
 * semantic query after the document is gone.
 */
export async function deleteChunkedEntity(
  env: Env, type: EntityType, id: number, chunkCount: number | null | undefined,
): Promise<void> {
  if (!env.VECTORIZE) return;
  // NULL means never indexed — there is nothing to remove, and Math.max below
  // would otherwise turn it into a single bogus delete.
  if (chunkCount == null || chunkCount <= 0) return;
  try {
    const ids: string[] = [];
    for (let i = 0; i < chunkCount; i += 1) ids.push(chunkVectorId(type, id, i));
    await env.VECTORIZE.deleteByIds(ids);
  } catch (e: any) {
    console.error('vectorize.deleteByIds (chunked) failed:', e?.message);
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

/**
 * TYPES WHOSE VECTORS ARE PRIVATE TO ONE ACCOUNT, and which therefore may
 * never come back from a search that did not explicitly ask for them.
 *
 * Every other `EntityType` is a directory entity — a project, a partner, a
 * lesson — whose snippet is safe to show anyone and whose click-through
 * re-checks access on the way in. `research_doc` is the opposite: its snippet
 * IS the document's own text (see the standing rule below), so a hit is itself
 * a disclosure, before any link is followed.
 */
const OWNER_PRIVATE_TYPES = new Set<string>(['research_doc']);

export interface SearchOpts {
  topK?: number;
  type?: EntityType;
  /**
   * Vectorize namespace to confine the query to. Omitted by every caller that
   * existed before the research library, whose behaviour is unchanged.
   */
  namespace?: string;
  /**
   * Re-checked against each hit's `owner_user_id` metadata. The third of the
   * three layers described in `searchSemantic`.
   */
  ownerUserId?: number;
}

/**
 * THREE LAYERS KEEP ONE ACCOUNT'S DOCUMENTS OUT OF ANOTHER'S RESULTS, and the
 * reason there are three is that only two of them are ours to guarantee.
 *
 * The trap this closes is that `routes/search.ts` has an
 * everything-is-allowed shortcut: when a caller may see every type it queries
 * with NO type filter and NO namespace. Whether a namespace-less Vectorize
 * query returns namespaced vectors decides whether that path would return
 * every user's documents — and vector stores generally search the whole index
 * when no namespace is given. So the isolation deliberately does not rest on
 * it:
 *
 *   1. `OWNER_PRIVATE_TYPES` is dropped unless `opts.type` names it. Default
 *      is exclusion, so a caller that forgets is safe rather than exposed —
 *      and this alone closes the shortcut above.
 *   2. `namespace` partitions at the store.
 *   3. `ownerUserId` is re-checked against each hit's metadata, so a hit that
 *      crossed a namespace is still dropped.
 *
 * Layer 1 is enforced here, at the single function every search goes through.
 * Adding the check at each call site instead would mean the next call site is
 * one forgotten line away from a cross-account leak.
 */
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
    if (opts.namespace) queryArgs.namespace = opts.namespace;
    const res: any = await env.VECTORIZE.query(vector, queryArgs);
    const matches = res?.matches || [];
    return matches
      .map((m: any) => ({
        id: m.id,
        type: (m.metadata?.type || m.id.split(':')[0]) as EntityType,
        entity_id: Number(m.metadata?.entity_id ?? m.id.split(':')[1] ?? 0),
        title: String(m.metadata?.title || ''),
        url: String(m.metadata?.url || ''),
        snippet: String(m.metadata?.snippet || ''),
        score: Number(m.score ?? 0),
        owner_user_id: m.metadata?.owner_user_id == null ? null : Number(m.metadata.owner_user_id),
      }))
      .filter((h: SearchHit) => {
        // Layer 1 — the default is exclusion.
        if (OWNER_PRIVATE_TYPES.has(h.type) && opts.type !== h.type) return false;
        // Layer 3 — an owned hit must name an owner, and it must be the caller.
        // A NULL owner on a private type is a malformed vector, not a public
        // one, so it is dropped rather than allowed through.
        if (OWNER_PRIVATE_TYPES.has(h.type)) {
          if (opts.ownerUserId == null) return false;
          if (h.owner_user_id !== opts.ownerUserId) return false;
        }
        return true;
      });
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
  if (type === 'research_doc') return indexResearchDocument(env, id);
  return false;
}

/**
 * A research document becomes MANY vectors, which is what makes it different
 * from every branch above.
 *
 * Each of those is one row embedded as one vector, and `MAX_INPUT_CHARS`
 * (4000) never binds because a problem statement fits. A document does not: at
 * one vector per file, Ask would see roughly the first page and answer "no
 * source" about page twelve of a file sitting in the library — an absence it
 * fabricated. So the file is converted to markdown, split, and stored as one
 * vector per chunk.
 *
 * NEITHER THE CONVERTER NOR THE SPLITTER IS NEW. `extractDeck` handles
 * PDF/DOC/DOCX/PPTX through `env.AI.toMarkdown` (it OCRs image-only PDFs),
 * falls back to decoding text/markdown directly when the AI binding is absent,
 * and never throws. `chunkMarkdown` splits on headings and blank-line runs and
 * caps at 200 × 4000 chars, which doubles as the ceiling on what one upload
 * can put in the index.
 *
 * THE SNIPPET RULE IS INVERTED HERE, AND DELIBERATELY. Every branch above
 * keeps body text OUT of `snippet`, because a snippet is surfaced verbatim in
 * `/api/search`. This one puts the chunk's own text in, because a citation
 * that cannot quote its source is not a citation. That is only safe because
 * these vectors never reach `/api/search`: `research_doc` is absent from that
 * route's `VALID_TYPES`, `searchSemantic` drops the type unless it is asked
 * for by name, and each vector carries `owner_user_id` which is re-checked
 * against the caller. Remove any one of those and this snippet becomes the
 * leak the rule above exists to prevent.
 */
async function indexResearchDocument(env: Env, id: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, uid, owner_user_id, title, r2_key, content_type, chunk_count
       FROM research_documents WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) {
    // Deleted between enqueue and processing. `chunk_count` is gone with the
    // row, so the exact vector ids are unknowable — clear what can be named.
    await deleteEntity(env, 'research_doc', id);
    return false;
  }

  const fail = async (state: string, note: string) => {
    await env.DB.prepare(
      `UPDATE research_documents SET index_state = ?, index_note = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(state, note, id).run();
    return false;
  };

  if (!env.FILES) return fail('failed', 'File storage is not configured, so this document could not be read.');
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return fail('failed', 'The stored file could not be found. Re-upload it to make it answerable.');

  const bytes = new Uint8Array(await obj.arrayBuffer());
  const { extractDeck, chunkMarkdown } = await import('./deckExtract');
  const extracted = await extractDeck(env, bytes, row.content_type || '', row.title || 'document');

  if (extracted.status === 'empty') {
    return fail('unsupported', 'No text could be read from this file, so Ask cannot answer from it.');
  }
  if (extracted.status !== 'ok') {
    return fail('failed', extracted.error === 'document_conversion_unavailable'
      ? 'Document conversion is unavailable right now. This will be retried.'
      : 'This file could not be converted to text, so Ask cannot read it.');
  }

  const chunks = extracted.chunks?.length ? extracted.chunks : chunkMarkdown(extracted.markdown);
  if (!chunks.length) {
    return fail('unsupported', 'No text could be read from this file, so Ask cannot answer from it.');
  }

  // Vectors from a PREVIOUS index run are removed first. Re-indexing a file
  // that got shorter would otherwise leave the tail chunks behind, still
  // answerable and no longer backed by the document.
  await deleteChunkedEntity(env, 'research_doc', id, row.chunk_count);

  const namespace = researchNamespace(row.owner_user_id);
  let written = 0;
  for (const ch of chunks) {
    const ok = await upsertEntity(env, {
      type: 'research_doc',
      id,
      chunk: ch.idx,
      text: ch.text,
      title: row.title,
      url: `/research/library#${row.uid}`,
      snippet: ch.text,
      namespace,
      ownerUserId: row.owner_user_id,
    });
    if (ok) written += 1;
  }

  if (!written) return fail('failed', 'The text was read but could not be indexed. This will be retried.');

  await env.DB.prepare(
    `UPDATE research_documents
        SET index_state = 'indexed', index_note = NULL, chunk_count = ?,
            indexed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`
  ).bind(written, id).run();
  return true;
}

/**
 * One namespace per account. 64-byte cap on the name, and 50,000 namespaces
 * per index on Workers Paid — worth knowing before this is keyed on anything
 * finer-grained than a user.
 */
export function researchNamespace(userId: number): string {
  return `research:u${userId}`;
}

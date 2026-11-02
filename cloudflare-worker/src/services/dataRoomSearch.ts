/**
 * #3938 part 2 (D1478 task 4, owner answer G = b) — search inside a data room.
 *
 * THE INDEX. A Vectorize index of its own, `axal-dataroom` (qwen3-embedding-0.6b,
 * 1024 dimensions, cosine), bound as `env.DATAROOM_INDEX`. Each file is read to
 * text (`env.AI.toMarkdown`, as the cap table's document read does), cut into
 * passages, and each passage is one vector whose metadata is its venture and
 * file. D1 keeps the passages (migration 765), so a hit is re-checked and shown
 * from D1, never from the index.
 *
 * ONE EMBEDDER, NEVER CHOSEN. An index is only as good as the model that built
 * it: a query embedded by any other model reads nonsense without an error. So
 * the model is fixed here (`EMBED_MODEL`), no rail lists a choice for it (D1478
 * `retrieve_index`, selectable: false), and a vector of any length but
 * `DIMENSIONS` is refused (`dimension_mismatch`): nothing is written, nothing
 * is searched.
 *
 * WHO READS WHAT. The founder and co-founders search the whole room. An
 * investor searches only the files their grant admits and, for NDA files, only
 * once the NDA is signed: the route passes `allowed`, the file ids the
 * investor's own listing shows, and every hit outside it is dropped after the
 * index answers. The index filter narrows to the venture; D1 decides.
 *
 * NOT SWITCHED ON. Until the owner creates the index and binds it (#1008),
 * `env.DATAROOM_INDEX` is absent and every call answers
 * `{ available: false, reason: 'Data room search is not switched on yet.' }`.
 *
 * Every model run goes through the router as the member who pressed (D765:
 * rail page and option), charged at its price. Every statement is bound.
 */
import type { Env } from '../types';
import { run as aiRun } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { rank } from './ai/decide';

export const DATAROOM_INDEX = 'axal-dataroom';
export const EMBED_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
export const DIMENSIONS = 1024;
export const PASSAGE_CHARS = 1200;
export const PASSAGE_OVERLAP = 150;
export const MAX_PASSAGES_PER_FILE = 200;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const INDEX_BATCH = 5;
const NEAREST = 50;
const RESULTS = 8;
const QUERY_MAX = 500;
const SNIPPET = 320;

export const SEARCH_OPTION = 'search:data-room';
export const REASONS = {
  not_set_up: 'Data room search is not switched on yet.',
  dimension_mismatch: 'The search index and its model disagree, so nothing was searched or written.',
  unreadable: 'The data room could not be searched right now.',
  no_query: 'Type what to look for.',
} as const;

export type Block<T> = { available: true; value: T } | { available: false; reason: string; code?: string };
export type SearchIndex = {
  upsert(vectors: Array<{ id: string; values: number[]; metadata: Record<string, number> }>): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(vector: number[], opts: { topK: number; filter: Record<string, number>; returnMetadata?: string }): Promise<{ matches: Array<{ id: string; score: number }> }>;
};
export type FileRow = { id: number; uid: string; name: string; r2_key: string; content_type: string | null; size_bytes: number | null };
export type SearchDeps = {
  index: SearchIndex | null;
  /** The file's text, or null when it holds none the reader can read. */
  extract(file: FileRow): Promise<string | null>;
  /** One vector, or null when the run failed. Its length is checked by the caller. */
  embed(text: string): Promise<number[] | null>;
  /** Indices into `contexts`, best first, or null when the run failed. */
  rerank(query: string, contexts: string[]): Promise<number[] | null>;
};

/** Passages of at most PASSAGE_CHARS, cut at a paragraph or sentence where one is near, overlapping by PASSAGE_OVERLAP. */
export function passagesOf(text: string): string[] {
  const t = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return [];
  const out: string[] = [];
  let at = 0;
  while (at < t.length && out.length < MAX_PASSAGES_PER_FILE) {
    let end = Math.min(t.length, at + PASSAGE_CHARS);
    if (end < t.length) {
      const window = t.slice(at + Math.floor(PASSAGE_CHARS * 0.6), end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '));
      if (cut > 0) end = at + Math.floor(PASSAGE_CHARS * 0.6) + cut + 1;
    }
    const piece = t.slice(at, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    at = Math.max(end - PASSAGE_OVERLAP, at + 1);
  }
  return out;
}

export const vectorId = (fileId: number, seq: number) => `drf:${fileId}:${seq}`;
const okVector = (v: number[] | null): v is number[] => Array.isArray(v) && v.length === DIMENSIONS && v.every((x) => Number.isFinite(x));

/** Delete a file's vectors and passages. Best effort on the index; D1 always. */
export async function forgetFile(env: Env, deps: Pick<SearchDeps, 'index'>, fileId: number): Promise<void> {
  const rows = await env.DB.prepare('SELECT vector_id FROM data_room_passages WHERE file_id = ?').bind(fileId).all<{ vector_id: string }>();
  const ids = (rows.results || []).map((r) => r.vector_id);
  if (deps.index && ids.length) {
    for (let i = 0; i < ids.length; i += 100) await deps.index.deleteByIds(ids.slice(i, i + 100));
  }
  await env.DB.prepare('DELETE FROM data_room_passages WHERE file_id = ?').bind(fileId).run();
  await env.DB.prepare('DELETE FROM data_room_search_state WHERE file_id = ?').bind(fileId).run();
}

async function writeState(env: Env, projectId: number, fileId: number, status: 'indexed' | 'no_text' | 'failed', passages: number, error: string | null) {
  await env.DB.prepare(
    `INSERT INTO data_room_search_state (file_id, project_id, status, passages, error, indexed_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(file_id) DO UPDATE SET status = excluded.status, passages = excluded.passages, error = excluded.error, indexed_at = excluded.indexed_at`,
  ).bind(fileId, projectId, status, passages, error).run();
}

/**
 * Index one file: read it, cut it, embed every passage, then replace its
 * vectors and passages. A wrong-length vector stops the file before anything
 * is written (`dimension_mismatch`).
 */
export async function indexFile(env: Env, deps: SearchDeps, projectId: number, file: FileRow): Promise<Block<{ passages: number; status: 'indexed' | 'no_text' }>> {
  if (!deps.index) return { available: false, reason: REASONS.not_set_up };
  if (Number(file.size_bytes ?? 0) > MAX_FILE_BYTES) {
    await writeState(env, projectId, file.id, 'failed', 0, 'too_large');
    return { available: false, reason: 'That file is larger than search reads.', code: 'too_large' };
  }
  const text = await deps.extract(file);
  const passages = passagesOf(text ?? '');
  if (!passages.length) {
    await forgetFile(env, deps, file.id);
    await writeState(env, projectId, file.id, 'no_text', 0, null);
    return { available: true, value: { passages: 0, status: 'no_text' } };
  }
  const vectors: number[][] = [];
  for (const p of passages) {
    const v = await deps.embed(p);
    if (v === null) {
      await writeState(env, projectId, file.id, 'failed', 0, 'embed_failed');
      return { available: false, reason: REASONS.unreadable, code: 'embed_failed' };
    }
    if (!okVector(v)) return { available: false, reason: REASONS.dimension_mismatch, code: 'dimension_mismatch' };
    vectors.push(v);
  }
  await forgetFile(env, deps, file.id);
  const rows = passages.map((p, seq) => ({ id: vectorId(file.id, seq), values: vectors[seq], metadata: { project_id: projectId, file_id: file.id } }));
  for (let i = 0; i < rows.length; i += 100) await deps.index.upsert(rows.slice(i, i + 100));
  for (let seq = 0; seq < passages.length; seq += 1) {
    await env.DB.prepare('INSERT INTO data_room_passages (project_id, file_id, seq, text, vector_id) VALUES (?, ?, ?, ?, ?)')
      .bind(projectId, file.id, seq, passages[seq], vectorId(file.id, seq)).run();
  }
  await writeState(env, projectId, file.id, 'indexed', passages.length, null);
  return { available: true, value: { passages: passages.length, status: 'indexed' } };
}

/** The room's files that have no index row, or were replaced after it. Bounded. */
export async function filesToIndex(env: Env, projectId: number, limit = INDEX_BATCH): Promise<{ files: FileRow[]; remaining: number }> {
  // Both queries carry the same stale-file condition, written out so each query text is static.
  const rows = await env.DB.prepare(
    `SELECT f.id, f.uid, f.name, f.r2_key, f.content_type, f.size_bytes
       FROM data_room_files f LEFT JOIN data_room_search_state s ON s.file_id = f.id
      WHERE f.project_id = ? AND (s.file_id IS NULL OR datetime(f.updated_at) > datetime(s.indexed_at))
      ORDER BY f.id LIMIT ?`,
  ).bind(projectId, limit).all<FileRow>();
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM data_room_files f LEFT JOIN data_room_search_state s ON s.file_id = f.id
      WHERE f.project_id = ? AND (s.file_id IS NULL OR datetime(f.updated_at) > datetime(s.indexed_at))`,
  ).bind(projectId).first<{ n: number }>();
  const files = rows.results || [];
  return { files, remaining: Math.max(0, Number(count?.n ?? 0) - files.length) };
}

export type Hit = { file_uid: string; file_name: string; snippet: string; score: number };

/**
 * Search one venture's room. `allowed` is the file ids the reader may see
 * (null: the whole room, for its founders). Embed, ask the index for the
 * venture's nearest passages, keep those D1 still holds and the reader may
 * see, rerank, and answer the best few with a snippet each.
 */
export async function searchRoom(env: Env, deps: SearchDeps, projectId: number, query: string, allowed: Set<number> | null): Promise<Block<{ hits: Hit[] }>> {
  if (!deps.index) return { available: false, reason: REASONS.not_set_up };
  const q = String(query || '').trim().slice(0, QUERY_MAX);
  if (!q) return { available: false, reason: REASONS.no_query, code: 'no_query' };
  const v = await deps.embed(q);
  if (v === null) return { available: false, reason: REASONS.unreadable, code: 'embed_failed' };
  if (!okVector(v)) return { available: false, reason: REASONS.dimension_mismatch, code: 'dimension_mismatch' };
  const res = await deps.index.query(v, { topK: NEAREST, filter: { project_id: projectId }, returnMetadata: 'none' });
  const ids = [...new Set((res?.matches || []).map((m) => String(m.id)).filter((id) => /^drf:\d+:\d+$/.test(id)))];
  if (!ids.length) return { available: true, value: { hits: [] } };
  const rows = await env.DB.prepare(
    `SELECT p.vector_id, p.text, p.file_id, f.uid AS file_uid, f.name AS file_name
       FROM data_room_passages p JOIN data_room_files f ON f.id = p.file_id AND f.project_id = p.project_id
      WHERE p.project_id = ? AND p.vector_id IN (SELECT value FROM json_each(?))`,
  ).bind(projectId, JSON.stringify(ids)).all<{ vector_id: string; text: string; file_id: number; file_uid: string; file_name: string }>();
  const order = new Map(ids.map((id, i) => [id, i]));
  const kept = (rows.results || [])
    .filter((r) => allowed === null || allowed.has(Number(r.file_id)))
    .sort((a, b) => (order.get(a.vector_id) ?? 0) - (order.get(b.vector_id) ?? 0));
  if (!kept.length) return { available: true, value: { hits: [] } };
  const ranking = await deps.rerank(q, kept.map((r) => r.text));
  const ordered = ranking && ranking.length ? ranking.filter((i) => i >= 0 && i < kept.length).map((i) => kept[i]) : kept;
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const r of ordered) {
    const key = `${r.file_uid}:${r.text.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ file_uid: r.file_uid, file_name: r.file_name, snippet: r.text.slice(0, SNIPPET), score: hits.length });
    if (hits.length >= RESULTS) break;
  }
  return { available: true, value: { hits: hits.map((h, i) => ({ ...h, score: i + 1 })) } };
}

type Converter = { toMarkdown?: (docs: unknown, opts?: unknown) => Promise<unknown> };

/** The router's fixed models and the AI binding's converter, as the member who pressed. */
export function defaultDeps(env: Env, userId: number, projectId: number): SearchDeps {
  // D765: a member's press carries its rail context; the page is the data room's.
  const rail = { page: AI_SURFACE.raiseDataRoom, option: SEARCH_OPTION, record: `project:${projectId}` };
    return {
    index: (env.DATAROOM_INDEX as unknown as SearchIndex | undefined) ?? null,
    async extract(file) {
      const ai = (env as unknown as { AI?: Converter }).AI;
      if (!env.FILES || !ai || typeof ai.toMarkdown !== 'function') return null;
      const obj = await env.FILES.get(file.r2_key);
      if (!obj) return null;
      const bytes = await obj.arrayBuffer();
      if (bytes.byteLength > MAX_FILE_BYTES) return null;
      const out = await ai.toMarkdown([{ name: file.name, blob: new Blob([bytes], { type: file.content_type || 'application/octet-stream' }) }]);
      return Array.isArray(out) ? String((out[0] as { data?: string })?.data ?? '') : String((out as { data?: string })?.data ?? '');
    },
    async embed(text) {
      const out = await aiRun(env, { task: 'module_embed' as any, model: EMBED_MODEL, userId, text, surface: AI_SURFACE.raiseDataRoom, rail });
      return out.ok && Array.isArray(out.embedding) ? out.embedding : null;
    },
    async rerank(query, contexts) {
      const r = await rank(env, { userId, surface: AI_SURFACE.raiseDataRoom, rail }, { query, contexts });
      return r.ok ? r.ranking.map((x) => Number(x.index)).filter((n) => Number.isInteger(n)) : null;
    },
  };
}

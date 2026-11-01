/**
 * D1556 (#3803) — retrieval of consented interview quotes for a deck.
 *
 * A second Vectorize index, `axal-deck-quotes` (bge-m3, 1024 dimensions,
 * cosine), holds one vector per quotable transcript line, with its venture in
 * the metadata. A search embeds the question, asks the index for the nearest
 * lines of THAT venture only, re-checks every hit against D1, and ranks the
 * survivors with the reranker. B5 (#3781) owns the manual pick; this feeds it
 * and the one-click run ranked, consented candidates.
 *
 * WHAT IS QUOTABLE (owner decision H = A, 2026-11-01). A line is quotable only
 * when all of these hold:
 *   - its session recorded consent: `consent_status = 'given'` with a
 *     `consent_at`. A session without recorded consent is excluded, not hidden:
 *     it is never embedded, and indexing deletes any vector it had;
 *   - its interview agreed to be quoted: `quote_consent = 1` ("Agreed ·
 *     deck-eligible", D685 §5.1.4);
 *   - it is the final transcript, not the live draft;
 *   - it is the interviewee's line: its speaker is the interviewee's name or
 *     "Interviewee". "Me" is the founder, and "Speaker ?" is nobody known, so
 *     neither is ever attributed to the customer (D873's rule);
 *   - it belongs to the venture asked about. The index filter narrows to it,
 *     and D1 decides: a hit whose line is not that venture's is dropped.
 *
 * ATTRIBUTED BY ROLE, NEVER BY NAME. A quote carries the interviewee's role
 * (or "Interviewee" when none was recorded) and its session provenance. The
 * name, the company and the speaker label never leave this file.
 *
 * NOTHING INVENTED. No consented line, or no index, answers
 * `{ available: false, reason }`. The run then cuts the area; it never writes
 * a quote.
 *
 * SPEND (owner decision L = A). The index is new Cloudflare spend, approved item by
 * item. It is not in wrangler.toml until the owner approves its monthly cost;
 * until then `env.DECK_QUOTES` is absent and every read answers "not switched
 * on yet". The embedding and the rerank go through the AI router's module
 * tasks with their catalogue ids (D760), never a second model list.
 */
import type { Env } from '../../types';
import { run as aiRun } from '../aiRouter';

export const QUOTE_INDEX = 'axal-deck-quotes';
export const QUOTE_EMBED_MODEL = '@cf/baai/bge-m3';
export const QUOTE_RERANK_MODEL = '@cf/baai/bge-reranker-base';
export const QUOTE_DIMENSIONS = 1024;

export const QUOTE_MIN_CHARS = 20;
export const QUOTE_MAX_CHARS = 300;
/** The most lines one venture indexes at a time, and one search re-checks. */
export const INDEX_LIMIT = 500;
const NEAREST = 50;

export const REASONS = {
  not_set_up: 'Quote retrieval is not switched on yet.',
  no_quote: 'No interview quote with recorded consent matches.',
  unreadable: 'Your interview quotes could not be searched right now.',
} as const;

export type Block<T> = { available: true; value: T } | { available: false; reason: string };

export interface Quote {
  text: string;
  /** The interviewee's role, or "Interviewee". Never a name. */
  attribution: string;
  role_recorded: boolean;
  score: number;
  provenance: {
    segment_id: number;
    session_uid: string;
    interview_id: number;
    held_on: string | null;
    start_ms: number | null;
    end_ms: number | null;
    consent: 'given';
  };
}

/** What retrieval needs from Cloudflare, so a test can stand in for it. */
export interface QuoteIndex {
  upsert(vectors: Array<{ id: string; values: number[]; metadata: Record<string, number> }>): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(vector: number[], opts: { topK: number; filter: Record<string, number>; returnMetadata?: string }): Promise<{ matches: Array<{ id: string; score: number }> }>;
}
export interface QuoteDeps {
  index: QuoteIndex | null;
  embed(text: string): Promise<number[] | null>;
  rerank(query: string, contexts: string[]): Promise<Array<{ index: number; score: number }> | null>;
}

interface LineRow {
  segment_id: number; text: string; start_ms: number | null; end_ms: number | null;
  session_uid: string; interview_id: number; role: string | null; held_on: string | null;
}

export const vectorId = (segmentId: number) => `quote:${segmentId}`;
const segmentOf = (id: string) => (/^quote:(\d+)$/.test(id) ? Number(id.slice('quote:'.length)) : null);
const clip = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > QUOTE_MAX_CHARS ? `${s.slice(0, QUOTE_MAX_CHARS - 1)}…` : s;
};

/**
 * The venture's quotable lines, newest session first. This WHERE clause is
 * the one rule for a quotable line; `unquotableLineIds` negates the same
 * clause, so indexing and searching cannot disagree.
 */
export async function quotableLines(env: Env, projectId: number, limit = INDEX_LIMIT): Promise<LineRow[]> {
  const rows = await env.DB.prepare(
    `SELECT g.id AS segment_id, g.text, g.start_ms, g.end_ms, s.uid AS session_uid, i.id AS interview_id,
            i.interviewee_role AS role, COALESCE(substr(i.done_at, 1, 10), substr(i.interview_date, 1, 10)) AS held_on
       FROM interview_transcript_segments g
       JOIN interview_sessions s ON s.id = g.session_id
       JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE s.project_id = ? AND i.project_id = s.project_id
        AND s.consent_status = 'given' AND s.consent_at IS NOT NULL
        AND i.quote_consent = 1
        AND g.source = 'final'
        AND (g.speaker_label = i.interviewee_name OR g.speaker_label = 'Interviewee')
        AND length(trim(g.text)) >= ?
      ORDER BY s.id DESC, g.start_ms, g.id LIMIT ?`,
  ).bind(projectId, QUOTE_MIN_CHARS, limit).all<LineRow>();
  return (rows.results || []) as LineRow[];
}

/** The venture's lines that are NOT quotable (the same clause, negated): their vectors must not exist. */
async function unquotableLineIds(env: Env, projectId: number): Promise<number[]> {
  const rows = await env.DB.prepare(
    `SELECT g.id
       FROM interview_transcript_segments g
       JOIN interview_sessions s ON s.id = g.session_id
       JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE s.project_id = ?
        AND NOT (i.project_id = s.project_id
          AND s.consent_status = 'given' AND s.consent_at IS NOT NULL
          AND COALESCE(i.quote_consent, 0) = 1
          AND g.source = 'final'
          AND (COALESCE(g.speaker_label, '') = COALESCE(i.interviewee_name, '') OR g.speaker_label = 'Interviewee')
          AND length(trim(g.text)) >= ?)
      LIMIT 1000`,
  ).bind(projectId, QUOTE_MIN_CHARS).all<{ id: number }>();
  return (rows.results || []).map((r) => Number(r.id));
}

/** The router's module tasks with the catalogue's ids; the member's own run, logged at cost. */
export function defaultDeps(env: Env, userId: number): QuoteDeps {
  const surface = '/raise/pitch';
  return {
    index: (env.DECK_QUOTES as unknown as QuoteIndex | undefined) ?? null,
    async embed(text) {
      const out = await aiRun(env, { task: 'module_embed' as any, model: QUOTE_EMBED_MODEL, userId, text, surface });
      const v = out.ok ? out.embedding : null;
      return Array.isArray(v) && v.length === QUOTE_DIMENSIONS ? v : null;
    },
    async rerank(query, contexts) {
      const out = await aiRun(env, { task: 'module_rerank' as any, model: QUOTE_RERANK_MODEL, userId, surface, rerank: { query, contexts } });
      return out.ok && Array.isArray(out.ranking) ? out.ranking : null;
    },
  };
}

/**
 * Index the venture's quotable lines and delete the vectors of every line that
 * is no longer quotable (consent withdrawn, a speaker renamed, a draft).
 */
export async function indexProjectQuotes(env: Env, projectId: number, deps: QuoteDeps): Promise<Block<{ indexed: number; removed: number; skipped: number }>> {
  if (!deps.index) return { available: false, reason: REASONS.not_set_up };
  const removeIds = (await unquotableLineIds(env, projectId)).map(vectorId);
  if (removeIds.length) await deps.index.deleteByIds(removeIds);
  const lines = await quotableLines(env, projectId);
  const vectors: Array<{ id: string; values: number[]; metadata: Record<string, number> }> = [];
  let skipped = 0;
  for (const l of lines) {
    const v = await deps.embed(clip(l.text));
    if (!v || v.length !== QUOTE_DIMENSIONS) { skipped += 1; continue; }
    vectors.push({ id: vectorId(Number(l.segment_id)), values: v, metadata: { project_id: projectId, segment_id: Number(l.segment_id) } });
  }
  for (let i = 0; i < vectors.length; i += 100) await deps.index.upsert(vectors.slice(i, i + 100));
  return { available: true, value: { indexed: vectors.length, removed: removeIds.length, skipped } };
}

/**
 * The venture's consented quotes nearest `query`, ranked by the reranker,
 * best first. Every hit is re-checked in D1, so a vector left from before a
 * consent was withdrawn, or one of another venture, is never returned.
 */
export async function retrieveQuotes(env: Env, projectId: number, query: string, deps: QuoteDeps, limit = 5): Promise<Block<Quote[]>> {
  if (!deps.index) return { available: false, reason: REASONS.not_set_up };
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!q) return { available: false, reason: REASONS.no_quote };
  try {
    const v = await deps.embed(q);
    if (!v) return { available: false, reason: REASONS.unreadable };
    const res = await deps.index.query(v, { topK: NEAREST, filter: { project_id: projectId }, returnMetadata: 'none' });
    const wanted = new Set((res?.matches || []).map((m) => segmentOf(String(m.id))).filter((n): n is number => n != null));
    if (!wanted.size) return { available: false, reason: REASONS.no_quote };
    const lines = (await quotableLines(env, projectId)).filter((l) => wanted.has(Number(l.segment_id)));
    if (!lines.length) return { available: false, reason: REASONS.no_quote };
    const texts = lines.map((l) => clip(l.text));
    const ranking = await deps.rerank(q, texts);
    if (!ranking) return { available: false, reason: REASONS.unreadable };
    const quotes: Quote[] = [];
    for (const r of [...ranking].sort((a, b) => b.score - a.score)) {
      const l = lines[r.index];
      if (!l || quotes.some((x) => x.provenance.segment_id === Number(l.segment_id))) continue;
      const role = typeof l.role === 'string' && l.role.trim() ? l.role.trim().slice(0, 80) : null;
      quotes.push({
        text: texts[r.index],
        attribution: role ?? 'Interviewee',
        role_recorded: role != null,
        score: r.score,
        provenance: {
          segment_id: Number(l.segment_id), session_uid: l.session_uid, interview_id: Number(l.interview_id),
          held_on: l.held_on, start_ms: l.start_ms == null ? null : Number(l.start_ms), end_ms: l.end_ms == null ? null : Number(l.end_ms),
          consent: 'given',
        },
      });
      if (quotes.length >= limit) break;
    }
    return quotes.length ? { available: true, value: quotes } : { available: false, reason: REASONS.no_quote };
  } catch (e) {
    console.error('[deck_quotes] search failed', String((e as Error)?.message || e).slice(0, 200));
    return { available: false, reason: REASONS.unreadable };
  }
}

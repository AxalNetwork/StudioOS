/**
 * Pitch Deck Reviewer API — `/api/deck-reviewer`.
 *
 * Flow: upload (or paste) → extract text (Workers AI document conversion) →
 * map into standard deck sections → generate an honest investor-style review →
 * persist in D1. Raw bytes are archived in R2 (never served publicly) with a
 * retention/lifecycle endpoint so they can be purged after processing.
 *
 * All rows are scoped to the authenticated user. Sections + review are fully
 * editable; the review can be regenerated after edits.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { ensureDeckReviewSchema } from '../services/deckReviewSchema';
import {
  extractDeck,
  mapSections,
  mapSectionsHeuristic,
  chunkMarkdown,
  generateReview,
  DECK_SECTIONS,
  type DeckSection,
  type DeckChunk,
  type DeckReview,
} from '../services/deckExtract';

const deckReviewer = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
]);
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeParse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    project_id: row.project_id,
    source: row.source,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    raw_retained: !!row.raw_retained,
    extraction_status: row.extraction_status,
    status: row.status,
    title: row.title,
    edited: !!row.edited,
    chunks: safeParse<DeckChunk[]>(row.chunks_json, []),
    sections: safeParse<DeckSection[]>(row.sections_json, []),
    review: safeParse<Partial<DeckReview>>(row.review_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadReview(env: Env, userId: number, id: string): Promise<Record<string, unknown> | null> {
  const sql = getSQL(env);
  const rows = await sql`SELECT * FROM deck_reviews WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] ? mapRow(rows[0]) : null;
}

async function projectContext(env: Env, projectId: number | null): Promise<string | undefined> {
  if (!projectId) return undefined;
  try {
    const sql = getSQL(env);
    const rows = await sql`SELECT name, sector, problem_statement FROM projects WHERE id = ${projectId}`;
    const p = rows[0];
    if (!p) return undefined;
    return [p.name, p.sector, p.problem_statement].filter(Boolean).join(' · ') || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// POST /api/deck-reviewer/upload — multipart file upload → full pipeline.
// ---------------------------------------------------------------------------
deckReviewer.post('/upload', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const sql = getSQL(c.env);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'invalid_form' }, 400);
  }
  // Workers-types types FormData entries as string; at runtime an uploaded
  // file is a File. Narrow out the string case, then treat it as a File.
  const fileEntry = form.get('file') as unknown;
  if (!fileEntry || typeof fileEntry === 'string') return c.json({ error: 'file_required' }, 400);
  const file = fileEntry as File;
  const pidRaw = form.get('project_id') as unknown;
  const projectId = pidRaw && typeof pidRaw === 'string' ? Number(pidRaw) : null;

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    return c.json({ error: 'unsupported_type', message: 'Upload a PDF, DOC, DOCX, PPT or PPTX file.' }, 415);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: 'too_large', message: 'File exceeds the 20 MB limit.' }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = crypto.randomUUID();
  const ext = EXT_BY_MIME[mime] || 'bin';
  const r2Key = `deck-reviews/${user.id}/${id}.${ext}`;
  let rawRetained = 0;

  // Archive the raw bytes in R2 (private; never served publicly). Best-effort:
  // extraction/review still proceed if the bucket isn't configured (dev).
  if (c.env.FILES) {
    try {
      await c.env.FILES.put(r2Key, bytes, {
        httpMetadata: { contentType: mime },
        customMetadata: { user_id: String(user.id), review_id: id, filename: file.name || 'deck' },
      });
      rawRetained = 1;
    } catch (e) {
      console.warn('[deck-reviewer] R2 archive failed:', (e as Error).message);
    }
  }

  await sql`INSERT INTO deck_reviews (id, user_id, project_id, source, filename, mime, size, r2_key, raw_retained, extraction_status, status, title, created_at, updated_at)
    VALUES (${id}, ${user.id}, ${projectId}, 'upload', ${file.name || 'deck'}, ${mime}, ${file.size}, ${rawRetained ? r2Key : null}, ${rawRetained}, 'pending', 'processing', ${(file.name || 'Pitch deck').replace(/\.[^.]+$/, '').slice(0, 200)}, ${nowIso()}, ${nowIso()})`;

  const extraction = await extractDeck(c.env, bytes, mime, file.name || 'deck');
  if (extraction.status !== 'ok') {
    await sql`UPDATE deck_reviews SET extraction_status = ${extraction.status === 'empty' ? 'empty' : 'failed'}, status = 'needs_manual', updated_at = ${nowIso()} WHERE id = ${id}`;
    const full = await loadReview(c.env, user.id, id);
    return c.json({ ...full, extraction_error: extraction.error || null, fallback: 'paste' });
  }

  const sections = await mapSections(c.env, user.id, extraction.markdown, extraction.chunks);
  const ctx = await projectContext(c.env, projectId);
  const review = await generateReview(c.env, user.id, sections, { startup: ctx });

  await sql`UPDATE deck_reviews SET extraction_status = 'ok', status = 'complete', chunks_json = ${JSON.stringify(extraction.chunks)}, sections_json = ${JSON.stringify(sections)}, review_json = ${JSON.stringify(review)}, updated_at = ${nowIso()} WHERE id = ${id}`;
  await sql`INSERT INTO deck_review_history (id, review_id, review_json, created_at) VALUES (${crypto.randomUUID()}, ${id}, ${JSON.stringify(review)}, ${nowIso()})`;

  const full = await loadReview(c.env, user.id, id);
  return c.json(full);
});

// ---------------------------------------------------------------------------
// POST /api/deck-reviewer/paste — manual text fallback (no file).
// body: { text, filename?, project_id? }
// ---------------------------------------------------------------------------
deckReviewer.post('/paste', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const sql = getSQL(c.env);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text_required' }, 400);
  const projectId = body.project_id != null && body.project_id !== '' ? Number(body.project_id) : null;

  const id = crypto.randomUUID();
  const chunks = chunkMarkdown(text.slice(0, 40_000));
  await sql`INSERT INTO deck_reviews (id, user_id, project_id, source, filename, mime, size, r2_key, raw_retained, extraction_status, status, title, created_at, updated_at)
    VALUES (${id}, ${user.id}, ${projectId}, 'paste', ${typeof body.filename === 'string' ? body.filename.slice(0, 200) : 'Pasted deck'}, 'text/plain', ${text.length}, NULL, 0, 'ok', 'processing', ${typeof body.filename === 'string' ? body.filename.slice(0, 200) : 'Pasted deck'}, ${nowIso()}, ${nowIso()})`;

  const sections = await mapSections(c.env, user.id, text, chunks);
  const ctx = await projectContext(c.env, projectId);
  const review = await generateReview(c.env, user.id, sections, { startup: ctx });

  await sql`UPDATE deck_reviews SET status = 'complete', chunks_json = ${JSON.stringify(chunks)}, sections_json = ${JSON.stringify(sections)}, review_json = ${JSON.stringify(review)}, updated_at = ${nowIso()} WHERE id = ${id}`;
  await sql`INSERT INTO deck_review_history (id, review_id, review_json, created_at) VALUES (${crypto.randomUUID()}, ${id}, ${JSON.stringify(review)}, ${nowIso()})`;
  const full = await loadReview(c.env, user.id, id);
  return c.json(full);
});

// GET /api/deck-reviewer — list caller's reviews (summary rows).
deckReviewer.get('/', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, project_id, source, filename, mime, size, extraction_status, status, title, edited, raw_retained, created_at, updated_at
    FROM deck_reviews WHERE user_id = ${user.id} ORDER BY updated_at DESC LIMIT 100`;
  return c.json({ reviews: rows });
});

// GET /api/deck-reviewer/:id — full review.
deckReviewer.get('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const full = await loadReview(c.env, user.id, c.req.param('id'));
  if (!full) return c.json({ error: 'not_found' }, 404);
  return c.json(full);
});

// PATCH /api/deck-reviewer/:id — save edited sections / review / title.
deckReviewer.patch('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM deck_reviews WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.title === 'string') {
    await sql`UPDATE deck_reviews SET title = ${body.title.slice(0, 200)}, edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }
  if (Array.isArray(body.sections)) {
    // Normalize: keep known keys, allow custom section labels for rename/merge/split.
    const sections = (body.sections as Array<Record<string, unknown>>).map((s) => ({
      key: String(s.key || 'other'),
      label: String(s.label || DECK_SECTIONS.find((d) => d.key === s.key)?.label || 'Section'),
      content: String(s.content || ''),
    }));
    await sql`UPDATE deck_reviews SET sections_json = ${JSON.stringify(sections)}, edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }
  if (body.review && typeof body.review === 'object') {
    await sql`UPDATE deck_reviews SET review_json = ${JSON.stringify(body.review)}, edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }
  const full = await loadReview(c.env, user.id, id);
  return c.json(full);
});

// POST /api/deck-reviewer/:id/regenerate — regenerate the review from the
// current (possibly edited) sections.
deckReviewer.post('/:id/regenerate', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM deck_reviews WHERE id = ${id} AND user_id = ${user.id}`;
  const row = rows[0];
  if (!row) return c.json({ error: 'not_found' }, 404);
  let sections = safeParse<DeckSection[]>(row.sections_json, []);
  if (!sections.length) sections = mapSectionsHeuristic(safeParse<DeckChunk[]>(row.chunks_json, []));
  const ctx = await projectContext(c.env, row.project_id ? Number(row.project_id) : null);
  const review = await generateReview(c.env, user.id, sections, { startup: ctx });
  await sql`UPDATE deck_reviews SET review_json = ${JSON.stringify(review)}, status = 'complete', updated_at = ${nowIso()} WHERE id = ${id}`;
  await sql`INSERT INTO deck_review_history (id, review_id, review_json, created_at) VALUES (${crypto.randomUUID()}, ${id}, ${JSON.stringify(review)}, ${nowIso()})`;
  const full = await loadReview(c.env, user.id, id);
  return c.json(full);
});

// DELETE /api/deck-reviewer/:id/raw — retention lifecycle: purge the archived
// raw file from R2 (metadata + extracted sections/review are retained).
deckReviewer.delete('/:id/raw', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT r2_key FROM deck_reviews WHERE id = ${id} AND user_id = ${user.id}`;
  const row = rows[0];
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.r2_key && c.env.FILES) {
    try {
      await c.env.FILES.delete(String(row.r2_key));
    } catch (e) {
      console.warn('[deck-reviewer] R2 purge failed:', (e as Error).message);
    }
  }
  await sql`UPDATE deck_reviews SET r2_key = NULL, raw_retained = 0, updated_at = ${nowIso()} WHERE id = ${id}`;
  return c.json({ ok: true, raw_retained: false });
});

// DELETE /api/deck-reviewer/:id — delete review + purge raw.
deckReviewer.delete('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT r2_key FROM deck_reviews WHERE id = ${id} AND user_id = ${user.id}`;
  const row = rows[0];
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.r2_key && c.env.FILES) {
    try {
      await c.env.FILES.delete(String(row.r2_key));
    } catch {
      /* noop */
    }
  }
  await sql`DELETE FROM deck_reviews WHERE id = ${id}`;
  return c.json({ ok: true });
});

// GET /api/deck-reviewer/:id/export?format=json|md
deckReviewer.get('/:id/export', async (c) => {
  const user = await requireAuth(c);
  await ensureDeckReviewSchema(c.env);
  const full = await loadReview(c.env, user.id, c.req.param('id'));
  if (!full) return c.json({ error: 'not_found' }, 404);
  const format = (c.req.query('format') || 'json').toLowerCase();
  if (format === 'md' || format === 'markdown') {
    return new Response(renderMarkdown(full), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
  }
  return c.json(full);
});

function renderMarkdown(r: Record<string, unknown>): string {
  const sections = (r.sections || []) as DeckSection[];
  const review = (r.review || {}) as Partial<DeckReview>;
  const lines: string[] = [];
  lines.push(`# Pitch Deck Review — ${r.title || r.filename || ''}`);
  lines.push('');
  if (typeof review.overall_score === 'number') lines.push(`**Overall score: ${review.overall_score}/100**`);
  if (review.summary) {
    lines.push('');
    lines.push(review.summary);
  }
  lines.push('');
  if (review.fix_first) {
    lines.push('## Fix first');
    lines.push(review.fix_first);
    lines.push('');
  }
  const bullets = (title: string, arr?: string[]) => {
    if (!arr || !arr.length) return;
    lines.push(`## ${title}`);
    for (const x of arr) lines.push(`- ${x}`);
    lines.push('');
  };
  bullets('Strengths', review.strengths);
  bullets('Weaknesses', review.weaknesses);
  bullets('Missing sections', review.missing_sections);
  bullets('Red flags', review.red_flags);
  bullets('Priority fixes', review.priority_fixes);
  if (review.section_suggestions?.length) {
    lines.push('## Section-by-section suggestions');
    for (const s of review.section_suggestions) lines.push(`- **${s.section}**: ${s.suggestion}`);
    lines.push('');
  }
  if (review.improved_wording?.length) {
    lines.push('## Suggested improved wording');
    for (const w of review.improved_wording) {
      lines.push(`- **${w.section}**`);
      if (w.before) lines.push(`  - Before: ${w.before}`);
      lines.push(`  - After: ${w.after}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('## Mapped deck content');
  for (const s of sections) {
    if (!s.content?.trim()) continue;
    lines.push(`### ${s.label}`);
    lines.push(s.content);
    lines.push('');
  }
  return lines.join('\n');
}

export default deckReviewer;

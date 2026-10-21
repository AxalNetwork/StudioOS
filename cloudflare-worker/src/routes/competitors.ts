/**
 * Competitor Analysis API — `/api/competitors`.
 *
 * In-house, Cloudflare-native competitive intelligence: discovery + controlled
 * public-web crawl (services/webFetch.ts) + Workers AI synthesis
 * (services/competitorAnalysis.ts), persisted in D1. No paid third-party APIs.
 *
 * All rows are scoped to the authenticated user. Analyses can be re-run,
 * edited, exported (JSON / markdown), and extended with manual competitors.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { railFor } from '../util/railContext';
import { canAccessProject } from '../services/projectAccess';
import { ensureCompetitorSchema } from '../services/competitorSchema';
import { insertManualCandidate } from './_competitor_writes';
import {
  COMPANIES_OPTIONS,
  COMPANIES_PAGE,
  analysisRecord,
  runCompetitorAnalysis,
  collectCandidateCrawl,
  sourceKind,
  type AnalysisInputs,
  type AnalysisResult,
  type Candidate,
  type AnalysisOutput,
} from '../services/competitorAnalysis';
import { fetchPage } from '../services/webFetch';
import { linkCandidatesToDirectory } from '../services/competitorDirectoryLink';

const competitors = new Hono<{ Bindings: Env }>();

function nowIso(): string {
  return new Date().toISOString();
}

function coerceInputs(body: Record<string, unknown>): AnalysisInputs {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    market: str(body.market),
    target_customer: str(body.target_customer),
    geography: str(body.geography),
    known_competitors: str(body.known_competitors),
    problem: str(body.problem),
    region_focus: str(body.region_focus) || 'Global',
    depth: body.depth === 'deep' ? 'deep' : 'quick',
    nudge: str(body.nudge),
  };
}

/** Map a project row into analysis input defaults (prefill "From my startup"). */
function inputsFromProject(project: Record<string, unknown>): AnalysisInputs {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    market: s(project.sector) || s(project.name),
    target_customer: s(project.target_customer) || '',
    geography: s(project.geography) || '',
    known_competitors: s(project.competitors) || '',
    problem: s(project.problem_statement) || s(project.description) || '',
    region_focus: 'Global',
    depth: 'quick',
    nudge: '',
  };
}

/**
 * Write a run's result over the analysis (D690 decision 8, #1692).
 *
 * WHAT A RE-RUN OR REFRESH KEEPS. It used to delete every candidate and
 * signal and write back only what the pipeline found, so a record link broke
 * on every re-run and a signal recorded by hand or from an interview was lost.
 * Now:
 *   - a candidate whose name is already stored keeps its stored id, so the
 *     record and its signals survive;
 *   - a stored candidate the run did not find again stays when the venture
 *     tracks its name (`competitor_tracking`, not stopped) or a kept signal
 *     points at it, with or without `keep_manual`;
 *   - every signal with a `project_id` (written by hand or from an interview
 *     since migration 440) stays as it was;
 *   - a pipeline signal of a type the venture switched off for that
 *     competitor (`watch_json`) is not written.
 * Sources are the pipeline's own and are replaced. Every value is bound.
 */
export async function persistResult(env: Env, analysisId: string, result: AnalysisResult): Promise<void> {
  const db = env.DB;
  const norm = (n: unknown) => String(n ?? '').trim().toLowerCase().slice(0, 120);
  const analysis = await db.prepare('SELECT project_id FROM competitor_analyses WHERE id = ?')
    .bind(analysisId).first<{ project_id: number | null }>();
  const projectId = analysis?.project_id ?? null;
  const stored = (await db.prepare('SELECT id, name FROM competitor_candidates WHERE analysis_id = ?')
    .bind(analysisId).all<{ id: string; name: string }>()).results || [];
  const storedByName = new Map<string, string>();
  for (const c of stored) if (!storedByName.has(norm(c.name))) storedByName.set(norm(c.name), c.id);

  // The venture's tracking rows and the signals it wrote. A store migration 460
  // (or 440) has not reached has none of either.
  const tracking = new Map<string, { stopped: boolean; watch: Record<string, unknown> }>();
  if (projectId != null) {
    try {
      const rows = (await db.prepare('SELECT name_norm, watch_json, stopped_at FROM competitor_tracking WHERE project_id = ?')
        .bind(projectId).all<{ name_norm: string; watch_json: string | null; stopped_at: string | null }>()).results || [];
      for (const r of rows) {
        let watch: Record<string, unknown> = {};
        try { watch = JSON.parse(String(r.watch_json || '{}')) || {}; } catch { watch = {}; }
        tracking.set(r.name_norm, { stopped: !!r.stopped_at, watch });
      }
    } catch { /* no competitor_tracking table: nothing is tracked */ }
  }
  let keptSignals: Array<{ candidate_id: string | null }> = [];
  let signalsHaveProject = true;
  try {
    keptSignals = (await db.prepare('SELECT candidate_id FROM competitor_signals WHERE analysis_id = ? AND project_id IS NOT NULL')
      .bind(analysisId).all<{ candidate_id: string | null }>()).results || [];
  } catch { signalsHaveProject = false; }

  // The run's candidates, under their stored ids where the name is stored.
  const idOf = new Map<string, string>();
  for (const c of result.candidates) idOf.set(c.id, storedByName.get(norm(c.name)) ?? c.id);
  const found = new Set(result.candidates.map((c) => norm(c.name)));
  const pointed = new Set(keptSignals.map((g) => g.candidate_id).filter(Boolean) as string[]);
  const keep = new Set<string>(result.candidates.map((c) => idOf.get(c.id) as string));
  for (const c of stored) {
    if (found.has(norm(c.name))) continue;
    const t = tracking.get(norm(c.name));
    if ((t && !t.stopped) || pointed.has(c.id)) keep.add(c.id);
  }
  const nameOfId = new Map<string, string>();
  for (const c of stored) nameOfId.set(c.id, norm(c.name));
  for (const c of result.candidates) nameOfId.set(idOf.get(c.id) as string, norm(c.name));
  const switchedOff = (candidateId: string | null, type: string) => {
    if (!candidateId || !['funding', 'launch', 'hiring'].includes(type)) return false;
    const t = tracking.get(nameOfId.get(candidateId) ?? '');
    return !!t && t.watch[type] === false;
  };

  const stmts = [
    db.prepare('DELETE FROM competitor_candidates WHERE analysis_id = ? AND id NOT IN (SELECT value FROM json_each(?))')
      .bind(analysisId, JSON.stringify([...keep])),
    db.prepare('DELETE FROM competitor_sources WHERE analysis_id = ?').bind(analysisId),
    signalsHaveProject
      ? db.prepare('DELETE FROM competitor_signals WHERE analysis_id = ? AND project_id IS NULL').bind(analysisId)
      : db.prepare('DELETE FROM competitor_signals WHERE analysis_id = ?').bind(analysisId),
  ];
  for (const c of result.candidates) {
    stmts.push(db.prepare(
      `INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, relevance_score, scores_json, summary, details_json, origin, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, url = excluded.url, category = excluded.category,
         relevance_score = excluded.relevance_score, scores_json = excluded.scores_json, summary = excluded.summary,
         details_json = excluded.details_json, origin = excluded.origin, position = excluded.position`,
    ).bind(
      idOf.get(c.id), analysisId, c.name, c.domain ?? null, c.url ?? null, c.category, c.relevance_score,
      JSON.stringify(c.scores), c.summary ?? null, JSON.stringify(c.details), c.origin, c.position,
    ));
  }
  for (const src of result.sources) {
    stmts.push(db.prepare(
      'INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(src.id, analysisId, src.candidate_id ? (idOf.get(src.candidate_id) ?? src.candidate_id) : null, src.url, src.kind, src.title ?? null, src.status, src.fetched_at ?? null));
  }
  for (const g of result.signals) {
    const cid = g.candidate_id ? (idOf.get(g.candidate_id) ?? g.candidate_id) : null;
    if (switchedOff(cid, g.signal_type)) continue;
    stmts.push(db.prepare(
      'INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(g.id, analysisId, cid, g.signal_type, g.label ?? null, g.detail ?? null));
  }
  stmts.push(db.prepare(
    `INSERT INTO competitor_analysis_outputs (analysis_id, output_json, edited, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT(analysis_id) DO UPDATE SET output_json = excluded.output_json, edited = 0, updated_at = excluded.updated_at`,
  ).bind(analysisId, JSON.stringify(result.output), nowIso()));
  await db.batch(stmts);
}

async function loadAnalysis(env: Env, userId: number, id: string): Promise<Record<string, unknown> | null> {
  const sql = getSQL(env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${userId}`;
  const a = rows[0];
  if (!a) return null;
  const candidates = await sql`SELECT * FROM competitor_candidates WHERE analysis_id = ${id} ORDER BY position ASC`;
  const sources = await sql`SELECT * FROM competitor_sources WHERE analysis_id = ${id}`;
  const signals = await sql`SELECT * FROM competitor_signals WHERE analysis_id = ${id}`;
  const outRows = await sql`SELECT * FROM competitor_analysis_outputs WHERE analysis_id = ${id}`;
  // D593: each competitor's directory profile, when exactly one matches it
  // (services/competitorDirectoryLink.ts). Read, never stored.
  const directory = await linkCandidatesToDirectory(env.DB, candidates);
  return {
    id: a.id,
    project_id: a.project_id,
    mode: a.mode,
    title: a.title,
    status: a.status,
    edited: !!a.edited,
    inputs: safeParse(a.inputs_json, {}),
    created_at: a.created_at,
    updated_at: a.updated_at,
    candidates: candidates.map((row) => ({ ...mapCandidate(row), directory_uid: directory.byId.get(String(row.id)) ?? null })),
    directory_match: directory.status,
    sources,
    signals,
    output: safeParse((outRows[0] || {}).output_json, {}),
    output_edited: !!(outRows[0] || {}).edited,
  };
}

function mapCandidate(c: Record<string, unknown>): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    url: c.url,
    category: c.category,
    relevance_score: c.relevance_score,
    scores: safeParse(c.scores_json, {}),
    summary: c.summary,
    details: safeParse(c.details_json, {}),
    origin: c.origin,
    position: c.position,
  };
}

function safeParse(v: unknown, fallback: unknown): unknown {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// POST /api/competitors/analyze — create + run a new analysis.
// body: { project_id?, mode?, ...inputs, title? }
// ---------------------------------------------------------------------------
competitors.post('/analyze', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const sql = getSQL(c.env);

  let inputs = coerceInputs(body);
  let mode = body.mode === 'startup' ? 'startup' : 'custom';
  let projectId: number | null = null;

  if (body.project_id != null && body.project_id !== '') {
    const pid = Number(body.project_id);
    const projRows = await sql`SELECT * FROM projects WHERE id = ${pid}`;
    const project = projRows[0];
    if (project) {
      // Access control: only the owner (via founder linkage), accepted
      // co-founders/advisors, or studio staff may prefill from a project.
      // Without this, any authenticated user could pass an arbitrary
      // project_id and read another founder's private project fields back
      // through inputs_json / the subsequent GET.
      const allowed = await canAccessProject(
        c.env,
        user,
        project as { id: number; founder_id: number | null },
        { write: false },
      );
      if (!allowed) {
        return c.json(
          { error: 'forbidden', message: 'You do not have access to that project.' },
          403,
        );
      }
      projectId = pid;
      mode = 'startup';
      const seeded = inputsFromProject(project);
      // Explicit body fields override project prefill.
      inputs = {
        market: inputs.market || seeded.market,
        target_customer: inputs.target_customer || seeded.target_customer,
        geography: inputs.geography || seeded.geography,
        known_competitors: inputs.known_competitors || seeded.known_competitors,
        problem: inputs.problem || seeded.problem,
        region_focus: inputs.region_focus || seeded.region_focus,
        depth: inputs.depth,
        nudge: inputs.nudge,
      };
    }
  }

  if (!inputs.market) {
    return c.json({ error: 'market_required', message: 'A market / industry is required to run the analysis.' }, 400);
  }

  const id = crypto.randomUUID();
  const title = (typeof body.title === 'string' && body.title.trim()) || inputs.market.slice(0, 80);
  await sql`INSERT INTO competitor_analyses (id, user_id, project_id, mode, title, inputs_json, status, created_at, updated_at)
    VALUES (${id}, ${user.id}, ${projectId}, ${mode}, ${title}, ${JSON.stringify(inputs)}, 'running', ${nowIso()}, ${nowIso()})`;

  try {
    // D778 part 9: the press's page and option win; the record is the analysis this route made.
    const rail = railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.analyze }, analysisRecord(id));
    const result = await runCompetitorAnalysis(c.env, user.id, id, inputs, rail);
    await persistResult(c.env, id, result);
    await sql`UPDATE competitor_analyses SET status = 'complete', updated_at = ${nowIso()} WHERE id = ${id}`;
    const full = await loadAnalysis(c.env, user.id, id);
    return c.json(full);
  } catch (e) {
    await sql`UPDATE competitor_analyses SET status = 'error', updated_at = ${nowIso()} WHERE id = ${id}`;
    console.error('[competitors] analyze failed:', (e as Error).message);
    return c.json({ error: 'analysis_failed', message: 'The analysis pipeline failed. Try again or reduce depth.' }, 500);
  }
});

// GET /api/competitors — list the caller's analyses (summary rows).
competitors.get('/', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, project_id, mode, title, status, edited, created_at, updated_at
    FROM competitor_analyses WHERE user_id = ${user.id} ORDER BY updated_at DESC LIMIT 100`;
  return c.json({ analyses: rows });
});

// GET /api/competitors/:id — full analysis.
competitors.get('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const full = await loadAnalysis(c.env, user.id, c.req.param('id'));
  if (!full) return c.json({ error: 'not_found' }, 404);
  return c.json(full);
});

// PATCH /api/competitors/:id — save edits (title, output, candidate set).
competitors.patch('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.title === 'string') {
    await sql`UPDATE competitor_analyses SET title = ${body.title.slice(0, 200)}, edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }

  if (body.output && typeof body.output === 'object') {
    await sql`INSERT INTO competitor_analysis_outputs (analysis_id, output_json, edited, updated_at)
      VALUES (${id}, ${JSON.stringify(body.output)}, 1, ${nowIso()})
      ON CONFLICT(analysis_id) DO UPDATE SET output_json = excluded.output_json, edited = 1, updated_at = excluded.updated_at`;
    await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }

  if (Array.isArray(body.candidates)) {
    await sql`DELETE FROM competitor_candidates WHERE analysis_id = ${id}`;
    let pos = 0;
    for (const raw of body.candidates as Array<Record<string, unknown>>) {
      const cand = raw || {};
      const cid = typeof cand.id === 'string' && cand.id ? cand.id : crypto.randomUUID();
      await sql`INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, relevance_score, scores_json, summary, details_json, origin, position)
        VALUES (${cid}, ${id}, ${String(cand.name || 'Unnamed')}, ${cand.domain ?? null}, ${cand.url ?? null}, ${cand.category === 'adjacent' ? 'adjacent' : 'direct'}, ${Number(cand.relevance_score) || 0}, ${JSON.stringify(cand.scores || {})}, ${String(cand.summary || '')}, ${JSON.stringify(cand.details || {})}, ${String(cand.origin || 'manual')}, ${pos++})`;
    }
    await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }

  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/candidates — add a manual competitor.
competitors.post('/:id/candidates', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = rows[0];
  if (!analysis) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.name || typeof body.name !== 'string') return c.json({ error: 'name_required' }, 400);

  // THE INSERT LIVES IN `_competitor_writes.ts` NOW, and this route is the reason
  // it had to move: `services/fills/registry.ts` requires that an accepted
  // proposal go through the function the manual form calls, and this insert was
  // inline here — so there was nothing for a fill to call. Behaviour is unchanged;
  // see that file's header for what a second copy of it would have got wrong
  // (`position`, and the `edited = 1` that stops a re-run deleting manual rows).
  const inputs = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  await insertManualCandidate(c.env, user.id, id, inputs, {
    name: body.name,
    url: typeof body.url === 'string' ? body.url : undefined,
    category: typeof body.category === 'string' ? body.category : undefined,
    summary: typeof body.summary === 'string' ? body.summary : undefined,
    crawl: !!body.crawl,
  }, railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.candidate }, analysisRecord(id)));
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// DELETE /api/competitors/:id/candidates/:cid — remove a competitor.
competitors.delete('/:id/candidates/:cid', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  await sql`DELETE FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  await sql`DELETE FROM competitor_sources WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  await sql`DELETE FROM competitor_signals WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// PATCH /api/competitors/:id/candidates/:cid — the company page's own edits.
// Name, category and summary only. Relevance, origin and details are not
// fields this route writes: a blank score is not 0, and a fetched page does
// not become a price.
competitors.patch('/:id/candidates/:cid', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'This analysis is not on your list.' }, 404);
  const rows = await sql`SELECT id FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  if (!rows[0]) return c.json({ error: 'This company is not in that analysis.' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 200);
    if (!name) return c.json({ error: 'A company needs a name.' }, 400);
    await sql`UPDATE competitor_candidates SET name = ${name} WHERE analysis_id = ${id} AND id = ${cid}`;
  }
  if (typeof body.category === 'string') {
    if (body.category !== 'direct' && body.category !== 'adjacent') {
      return c.json({ error: 'Category is direct or adjacent.' }, 400);
    }
    await sql`UPDATE competitor_candidates SET category = ${body.category} WHERE analysis_id = ${id} AND id = ${cid}`;
  }
  if (typeof body.summary === 'string') {
    await sql`UPDATE competitor_candidates SET summary = ${body.summary.slice(0, 4000)} WHERE analysis_id = ${id} AND id = ${cid}`;
  }
  if (typeof body.name !== 'string' && typeof body.category !== 'string' && typeof body.summary !== 'string') {
    return c.json({ error: 'Nothing on this company was sent to save.' }, 400);
  }
  await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/candidates/:cid/sources — one public GET, recorded
// as a source. The URL does not become the company's homepage, and the page
// body is not copied into features, pricing or the summary.
competitors.post('/:id/candidates/:cid/sources', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'This analysis is not on your list.' }, 404);
  const rows = await sql`SELECT id, name FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  const cand = rows[0];
  if (!cand) return c.json({ error: 'This company is not in that analysis.' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.url || typeof body.url !== 'string') return c.json({ error: 'A URL is required.' }, 400);

  const page = await fetchPage(c.env, body.url, { userId: user.id });
  if (!page.ok || !(page.text || page.title)) {
    return c.json({ error: page.error || 'That URL did not return a page.' }, 422);
  }
  const existing = await sql`SELECT id FROM competitor_sources WHERE analysis_id = ${id} AND candidate_id = ${cid} AND url = ${page.url}`;
  if (!existing[0]) {
    await sql`INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at)
      VALUES (${crypto.randomUUID()}, ${id}, ${cid}, ${page.url}, ${sourceKind(page.url)}, ${page.title || String(cand.name || 'Untitled')}, ${page.status}, ${page.fetched_at})`;
    await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/candidates/:cid/crawl — the site already on the
// row. Absent when the row has no URL. Records sources and signals only.
competitors.post('/:id/candidates/:cid/crawl', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const analyses = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = analyses[0];
  if (!analysis) return c.json({ error: 'This analysis is not on your list.' }, 404);
  const rows = await sql`SELECT * FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  const row = rows[0];
  if (!row) return c.json({ error: 'This company is not in that analysis.' }, 404);
  const cand = mapCandidate(row) as unknown as Candidate;
  if (!cand.url) return c.json({ error: 'There is no URL to crawl. Nothing here will invent one.' }, 400);

  const inputs = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  const depth = inputs.depth === 'deep' ? 'deep' : 'quick';
  const { sources, signals } = await collectCandidateCrawl(c.env, user.id, id, cand, depth,
    railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.site }, analysisRecord(id)));
  if (!sources.length) return c.json({ error: 'The site did not return a page to record.' }, 422);

  const haveSources = await sql`SELECT url FROM competitor_sources WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  const seenUrl = new Set(haveSources.map((s) => String(s.url)));
  for (const s of sources) {
    if (seenUrl.has(s.url)) continue;
    seenUrl.add(s.url);
    await sql`INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at)
      VALUES (${s.id}, ${id}, ${cid}, ${s.url}, ${s.kind}, ${s.title}, ${s.status}, ${s.fetched_at})`;
  }
  const haveSignals = await sql`SELECT signal_type, label, detail FROM competitor_signals WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  const seenSignal = new Set(haveSignals.map((g) => `${g.signal_type}|${g.label}|${g.detail}`));
  for (const g of signals) {
    const key = `${g.signal_type}|${g.label}|${g.detail}`;
    if (seenSignal.has(key)) continue;
    seenSignal.add(key);
    await sql`INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, detail)
      VALUES (${g.id}, ${id}, ${cid}, ${g.signal_type}, ${g.label}, ${g.detail})`;
  }
  await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/rerun — re-run discovery/synthesis.
// body: { inputs?, keep_manual?: bool }  — re-runs from stored inputs (optionally overridden).
competitors.post('/:id/rerun', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = rows[0];
  if (!analysis) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const stored = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  const inputs: AnalysisInputs = body.inputs && typeof body.inputs === 'object' ? { ...stored, ...coerceInputs(body.inputs as Record<string, unknown>) } : stored;

  // Preserve manually-added competitors across a rerun when asked.
  const manual = body.keep_manual
    ? (await sql`SELECT * FROM competitor_candidates WHERE analysis_id = ${id} AND origin = 'manual'`).map(mapCandidate)
    : [];

  await sql`UPDATE competitor_analyses SET status = 'running', inputs_json = ${JSON.stringify(inputs)}, updated_at = ${nowIso()} WHERE id = ${id}`;
  try {
    const rail = railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.again }, analysisRecord(id));
    const result = await runCompetitorAnalysis(c.env, user.id, id, inputs, rail);
    // Re-append preserved manual candidates that the rerun didn't rediscover.
    const names = new Set(result.candidates.map((x) => x.name.toLowerCase()));
    for (const m of manual as unknown as Candidate[]) {
      if (!names.has(String(m.name).toLowerCase())) {
        result.candidates.push({ ...m, position: result.candidates.length } as Candidate);
      }
    }
    await persistResult(c.env, id, result);
    await sql`UPDATE competitor_analyses SET status = 'complete', edited = 0, updated_at = ${nowIso()} WHERE id = ${id}`;
    const full = await loadAnalysis(c.env, user.id, id);
    return c.json(full);
  } catch (e) {
    await sql`UPDATE competitor_analyses SET status = 'error', updated_at = ${nowIso()} WHERE id = ${id}`;
    console.error('[competitors] rerun failed:', (e as Error).message);
    return c.json({ error: 'analysis_failed' }, 500);
  }
});

// POST /api/competitors/:id/refresh — re-crawl sources for existing candidates
// without re-discovering (cheaper "Refresh sources" action).
competitors.post('/:id/refresh', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = rows[0];
  if (!analysis) return c.json({ error: 'not_found' }, 404);
  const inputs = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  const candRows = (await sql`SELECT * FROM competitor_candidates WHERE analysis_id = ${id} ORDER BY position ASC`).map(mapCandidate) as unknown as Candidate[];

  // Reuse the pipeline's crawl by faking a result whose candidates are the
  // stored ones, then re-synthesizing. Simplest: rerun with stored inputs but
  // keep the manual set — delegate to the same code path.
  const rail = railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.sources }, analysisRecord(id));
  const result = await runCompetitorAnalysis(c.env, user.id, id, inputs, rail);
  // Merge: keep any stored manual candidates the refresh didn't surface.
  const names = new Set(result.candidates.map((x) => x.name.toLowerCase()));
  for (const m of candRows) {
    if (m.origin === 'manual' && !names.has(String(m.name).toLowerCase())) {
      result.candidates.push({ ...m, position: result.candidates.length });
    }
  }
  await persistResult(c.env, id, result);
  await sql`UPDATE competitor_analyses SET status = 'complete', edited = 0, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// DELETE /api/competitors/:id — delete an analysis.
competitors.delete('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  await sql`DELETE FROM competitor_analyses WHERE id = ${id}`;
  return c.json({ ok: true });
});

// POST /api/competitors/fetch — controlled in-house proxy fetch of ONE public
// URL. Returns normalized text so the UI can preview a source or seed a manual
// competitor. SSRF-guarded + rate-limited inside webFetch.
competitors.post('/fetch', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.url || typeof body.url !== 'string') return c.json({ error: 'url_required' }, 400);
  const page = await fetchPage(c.env, body.url, { userId: user.id, refresh: !!body.refresh });
  return c.json(page);
});

// GET /api/competitors/:id/export?format=json|md
competitors.get('/:id/export', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const full = await loadAnalysis(c.env, user.id, c.req.param('id'));
  if (!full) return c.json({ error: 'not_found' }, 404);
  const format = (c.req.query('format') || 'json').toLowerCase();
  if (format === 'md' || format === 'markdown') {
    const md = renderMarkdown(full);
    return new Response(md, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
  }
  return c.json(full);
});

function renderMarkdown(a: Record<string, unknown>): string {
  const out = (a.output || {}) as Partial<AnalysisOutput>;
  const cands = (a.candidates || []) as Array<Record<string, unknown>>;
  const inputs = (a.inputs || {}) as AnalysisInputs;
  const lines: string[] = [];
  lines.push(`# Competitor Analysis — ${a.title || inputs.market || ''}`);
  lines.push('');
  lines.push(`_Generated ${a.updated_at || ''} · mode: ${a.mode} · depth: ${inputs.depth || 'quick'}_`);
  lines.push('');
  if (out.market_summary) {
    lines.push('## Market summary');
    lines.push(out.market_summary);
    lines.push('');
  }
  lines.push('## Competitors');
  for (const c of cands) {
    const details = (c.details || {}) as Record<string, unknown>;
    lines.push(`### ${c.name} (${c.category}, relevance ${c.relevance_score})`);
    if (c.url) lines.push(`- URL: ${c.url}`);
    if (c.summary) lines.push(`- ${c.summary}`);
    if (Array.isArray(details.features) && details.features.length) lines.push(`- Features: ${(details.features as string[]).join(', ')}`);
    if (Array.isArray(details.pricing) && details.pricing.length) lines.push(`- Pricing: ${(details.pricing as string[]).join(', ')}`);
    if (details.positioning) lines.push(`- Positioning: ${details.positioning}`);
    lines.push('');
  }
  if (out.feature_comparison?.features?.length) {
    lines.push('## Feature comparison');
    lines.push(`| Competitor | ${out.feature_comparison.features.join(' | ')} |`);
    lines.push(`| --- | ${out.feature_comparison.features.map(() => '---').join(' | ')} |`);
    for (const r of out.feature_comparison.rows || []) {
      lines.push(`| ${r.competitor} | ${(r.values || []).join(' | ')} |`);
    }
    lines.push('');
  }
  if (out.gaps?.length) {
    lines.push('## Gaps & opportunities');
    for (const g of out.gaps) lines.push(`- ${g}`);
    lines.push('');
  }
  if (out.wedge) {
    lines.push('## Suggested wedge');
    lines.push(out.wedge);
    lines.push('');
  }
  if (out.next_actions?.length) {
    lines.push('## Recommended next actions');
    for (const n of out.next_actions) lines.push(`- ${n}`);
    lines.push('');
  }
  if (out.notes) {
    lines.push('## Notes');
    lines.push(out.notes);
  }
  return lines.join('\n');
}

export default competitors;

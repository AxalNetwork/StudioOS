/**
 * D1589 (#3836) — a venture's stage norms (migration 746), the benchmarks a
 * deck critic may cite.
 *
 *   GET    /api/decks/stage-norms?project_id=<id>[&stage=<stage>]
 *          → { project_id, stages: { <stage>: { label, norms: Block<StageNorm[]> } } }
 *   POST   /api/decks/stage-norms            { project_id, stage, investor_type?, metric, value, source, sample_size, as_of? }
 *          → 201 { norm }
 *   PUT    /api/decks/stage-norms/:uid       the same fields; read, merged, checked, written
 *          → { norm }
 *   DELETE /api/decks/stage-norms/:uid       → { deleted: true }
 *
 * A stage with no row answers `{ available: false, reason: 'No stage benchmark
 * recorded' }`, never an empty list a reader could take for "none needed".
 * A norm without its source or its sample size is refused with 400 (and the
 * table's CHECK refuses it for any other writer).
 *
 * WHO. `projectOwned` decides, as every deck route does: reads for the
 * venture's founder, its accepted members and admins; writes with `write: true`
 * (an advisor reads but does not write). A row of another venture is the same
 * 404 as no row.
 *
 * Mounted in index.ts BEFORE `decks`, so `GET /api/decks/:id` cannot answer
 * `/stage-norms`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import {
  STAGES, STAGE_LABELS, NO_BENCHMARK, checkNorm, listNorms, normDto,
  type Stage, type StageNormRow,
} from '../services/decks/stageNorms';

const deckStageNorms = new Hono<{ Bindings: Env }>();

/** A row's public id: 32 hex characters. */
const newUid = () => crypto.randomUUID().replace(/-/g, '');

async function owned(c: any, user: User, projectId: number, write = false) {
  try {
    return { project: await projectOwned(c, user, projectId, write ? { write: true } : {}) };
  } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
}

const projectIdOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

deckStageNorms.get('/stage-norms', async (c) => {
  const user = await requireAuth(c);
  const projectId = projectIdOf(c.req.query('project_id'));
  if (!projectId) return refuse(c, 400, { code: 'project_id_required', message: 'Say which venture\'s stage norms to read.' });
  const stageQ = c.req.query('stage');
  if (stageQ && !STAGES.includes(stageQ as Stage)) return refuse(c, 400, { code: 'stage_invalid', message: 'Choose a stage: Pre-seed, Seed, Series A or Series B+.' });
  const got = await owned(c, user, projectId);
  if ('refused' in got) return got.refused;
  const norms = await listNorms(c.env, projectId, stageQ as Stage | undefined);
  const stages: Record<string, unknown> = {};
  for (const s of (stageQ ? [stageQ as Stage] : STAGES)) {
    const mine = norms.filter((n) => n.stage === s);
    stages[s] = {
      label: STAGE_LABELS[s],
      norms: mine.length ? { available: true, value: mine } : { available: false, reason: NO_BENCHMARK },
    };
  }
  return c.json({ project_id: projectId, stages });
});

deckStageNorms.post('/stage-norms', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return refuse(c, 400, { code: 'project_id_required', message: 'Say which venture the stage norm is for.' });
  const checked = checkNorm(body);
  if (!checked.ok) return refuse(c, 400, { code: checked.code, message: checked.message });
  const got = await owned(c, user, projectId, true);
  if ('refused' in got) return got.refused;
  const n = checked.norm;
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO stage_norms (uid, project_id, entered_by, origin, stage, investor_type, metric, value, source, sample_size, as_of)
     VALUES (?, ?, ?, 'founder', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, projectId, user.id, n.stage, n.investor_type, n.metric, n.value, n.source, n.sample_size, n.as_of).run();
  const row = await c.env.DB.prepare('SELECT * FROM stage_norms WHERE uid = ?').bind(uid).first<StageNormRow>();
  return c.json({ norm: normDto(row as StageNormRow) }, 201);
});

/** The row and its venture's gate; another venture's row is the same 404 as none. */
async function normFor(c: any, user: User, uid: string, write: boolean) {
  const row = await c.env.DB.prepare('SELECT * FROM stage_norms WHERE uid = ?').bind(uid).first() as StageNormRow | null;
  if (!row) return { refused: c.json({ error: 'not found' }, 404) };
  // Someone who cannot read the venture learns nothing about its rows.
  const read = await owned(c, user, Number(row.project_id));
  if ('refused' in read) return { refused: c.json({ error: 'not found' }, 404) };
  if (write) {
    const got = await owned(c, user, Number(row.project_id), true);
    if ('refused' in got) return { refused: got.refused };
  }
  return { row };
}

deckStageNorms.put('/stage-norms/:uid', async (c) => {
  const user = await requireAuth(c);
  const found = await normFor(c, user, c.req.param('uid'), true);
  if ('refused' in found) return found.refused;
  const body = await c.req.json<any>().catch(() => ({}));
  const r = found.row;
  const has = (k: string) => body && typeof body === 'object' && k in body;
  const merged = {
    stage: has('stage') ? body.stage : r.stage,
    investor_type: has('investor_type') ? body.investor_type : r.investor_type,
    metric: has('metric') ? body.metric : r.metric,
    value: has('value') ? body.value : r.value,
    source: has('source') ? body.source : r.source,
    sample_size: has('sample_size') ? body.sample_size : r.sample_size,
    as_of: has('as_of') ? body.as_of : r.as_of,
  };
  const checked = checkNorm(merged);
  if (!checked.ok) return refuse(c, 400, { code: checked.code, message: checked.message });
  const n = checked.norm;
  await c.env.DB.prepare(
    `UPDATE stage_norms SET stage = ?, investor_type = ?, metric = ?, value = ?, source = ?, sample_size = ?, as_of = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(n.stage, n.investor_type, n.metric, n.value, n.source, n.sample_size, n.as_of, r.id).run();
  const row = await c.env.DB.prepare('SELECT * FROM stage_norms WHERE id = ?').bind(r.id).first<StageNormRow>();
  return c.json({ norm: normDto(row as StageNormRow) });
});

deckStageNorms.delete('/stage-norms/:uid', async (c) => {
  const user = await requireAuth(c);
  const found = await normFor(c, user, c.req.param('uid'), true);
  if ('refused' in found) return found.refused;
  await c.env.DB.prepare('DELETE FROM stage_norms WHERE id = ?').bind(found.row.id).run();
  return c.json({ deleted: true });
});

export default deckStageNorms;

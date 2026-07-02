/**
 * Task #12 — Personal-Values Assessment.
 *
 * Mounted at /api/values. All endpoints require an authenticated session.
 *
 *   GET  /survey    — the paired-statement questionnaire (~25 questions).
 *   POST /submit    — compute and store the deterministic vector.
 *   GET  /me        — the caller's current vector + plain-English summary.
 *
 * 90-day retake window enforced on POST /submit.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getSQL } from '../db';
import { ensureSkillsTaxonomySchema } from '../services/skillsTaxonomySchema';
import { ensureTaxonomyVersionColumns, getTaxonomyVersion } from '../services/taxonomyVersion';

const values = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Survey data — deterministically generated from the value_dimensions taxonomy.
// 15 dimensions, ~25 questions. Same seed = same survey.
// ---------------------------------------------------------------------------

interface SurveyQuestion {
  id: number;
  dimension_slug: string;
  family: string;
  is_bipolar: boolean;
  label: string;
  pole_low: string | null;
  pole_high: string | null;
  statement_left: string;
  statement_right: string;
}

function buildSurvey(dimensions: any[]): SurveyQuestion[] {
  const out: SurveyQuestion[] = [];
  let id = 0;

  // We want ~25 questions across 15 dimensions. Assign counts per dimension.
  // Bipolar founder spectrums get 2 each (more nuance). Unipolar Schwartz get 1-2.
  const counts: Record<string, number> = {
    schwartz_self_direction: 2,
    schwartz_stimulation: 1,
    schwartz_hedonism: 1,
    schwartz_achievement: 2,
    schwartz_power: 1,
    schwartz_security: 2,
    schwartz_conformity: 1,
    schwartz_tradition: 1,
    schwartz_benevolence: 2,
    schwartz_universalism: 2,
    founder_mission_vs_profit: 2,
    founder_speed_vs_quality: 2,
    founder_risk_appetite: 2,
    founder_growth_vs_sustain: 2,
    founder_autonomy_vs_structure: 2,
  };

  for (const d of dimensions) {
    const n = counts[d.slug] || 1;
    for (let i = 0; i < n; i++) {
      id++;
      if (d.is_bipolar) {
        // Bipolar: spectrum from pole_low to pole_high.
        out.push({
          id,
          dimension_slug: d.slug,
          family: d.family,
          is_bipolar: true,
          label: d.label,
          pole_low: d.pole_low,
          pole_high: d.pole_high,
          statement_left: d.pole_low,
          statement_right: d.pole_high,
        });
      } else {
        // Unipolar Schwartz: framed as "I value this" vs "I don't value this".
        // Alternate framing for second question on the same dimension.
        const left = i === 0
          ? `Not important to me`
          : `I rarely prioritise this`;
        const right = i === 0
          ? `Very important to me`
          : `I consistently prioritise this`;
        out.push({
          id,
          dimension_slug: d.slug,
          family: d.family,
          is_bipolar: false,
          label: d.label,
          pole_low: null,
          pole_high: null,
          statement_left: left,
          statement_right: right,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring — deterministic per-dimension score (-2..+2) + confidence (0..1)
// ---------------------------------------------------------------------------

interface ResponseItem {
  question_id: number;
  choice: number; // -2..+2
}

function computeVector(
  questions: SurveyQuestion[],
  responses: ResponseItem[],
): { dimension_slug: string; score: number; confidence: number }[] {
  const byDim = new Map<string, number[]>();
  const maxByDim = new Map<string, number>();

  for (const q of questions) {
    maxByDim.set(q.dimension_slug, (maxByDim.get(q.dimension_slug) || 0) + 1);
  }

  for (const r of responses) {
    const q = questions.find((x) => x.id === r.question_id);
    if (!q) continue;
    const arr = byDim.get(q.dimension_slug) || [];
    arr.push(Math.max(-2, Math.min(2, Number(r.choice) || 0)));
    byDim.set(q.dimension_slug, arr);
  }

  const out: { dimension_slug: string; score: number; confidence: number }[] = [];
  for (const [slug, vals] of byDim) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const score = Math.max(-2, Math.min(2, Math.round(avg * 100) / 100));
    const confidence = Math.min(1, vals.length / (maxByDim.get(slug) || 1));
    out.push({ dimension_slug: slug, score, confidence });
  }

  // Fill missing dimensions with zero score + 0 confidence
  for (const [slug] of maxByDim) {
    if (!byDim.has(slug)) {
      out.push({ dimension_slug: slug, score: 0, confidence: 0 });
    }
  }

  return out;
}

function summarizeVector(
  vector: { dimension_slug: string; score: number; confidence: number }[],
): { top: string[]; secondary: string | null } {
  // Sort by absolute score * confidence, descending.
  const sorted = [...vector].sort((a, b) => {
    const wA = Math.abs(a.score) * a.confidence;
    const wB = Math.abs(b.score) * b.confidence;
    return wB - wA;
  });
  const top = sorted.slice(0, 3).map((v) => v.dimension_slug);
  const secondary = sorted[3] ? sorted[3].dimension_slug : null;
  return { top, secondary };
}

// ---------------------------------------------------------------------------
// 90-day retake guard
// ---------------------------------------------------------------------------

async function canRetake(env: Env, userId: number): Promise<{ ok: boolean; nextAt: string | null }> {
  const sql = getSQL(env);
  const rows = await sql`
    SELECT MAX(updated_at) AS last_at
    FROM user_values
    WHERE user_id = ${userId}
  `;
  const last = rows[0]?.last_at as string | null;
  if (!last) return { ok: true, nextAt: null };
  const lastMs = Date.parse(last.replace(' ', 'T') + 'Z');
  const nextMs = lastMs + 90 * 24 * 60 * 60 * 1000;
  if (Date.now() < nextMs) {
    const nextAt = new Date(nextMs).toISOString();
    return { ok: false, nextAt };
  }
  return { ok: true, nextAt: null };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

values.get('/survey', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillsTaxonomySchema(c.env);
  const sql = getSQL(c.env);
  const dims = await sql`
    SELECT id, slug, label, family, is_bipolar, pole_low, pole_high
    FROM value_dimensions
    ORDER BY display_order, label
  `;
  const questions = buildSurvey(dims);
  const { ok, nextAt } = await canRetake(c.env, user.id);
  return c.json({
    can_retake: ok,
    next_retake_at: nextAt,
    questions: questions.map((q) => ({
      id: q.id,
      dimension_slug: q.dimension_slug,
      family: q.family,
      is_bipolar: q.is_bipolar,
      label: q.label,
      pole_low: q.pole_low,
      pole_high: q.pole_high,
      statement_left: q.statement_left,
      statement_right: q.statement_right,
    })),
  });
});

values.post('/submit', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillsTaxonomySchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const responses: ResponseItem[] = Array.isArray(body.responses) ? body.responses : [];

  const { ok, nextAt } = await canRetake(c.env, user.id);
  if (!ok) {
    return c.json({ error: 'retake_window', next_retake_at: nextAt }, 429);
  }

  // Task #19 — stamp the active taxonomy version onto each value row so we can
  // tell which taxonomy a user's value vector was captured against.
  await ensureTaxonomyVersionColumns(c.env);
  const taxonomyVersion = await getTaxonomyVersion(c.env);

  const sql = getSQL(c.env);
  const dims = await sql`
    SELECT id, slug, label, family, is_bipolar, pole_low, pole_high
    FROM value_dimensions
    ORDER BY display_order, label
  `;
  const questions = buildSurvey(dims);
  const vector = computeVector(questions, responses);

  // Upsert the vector into user_values.
  for (const v of vector) {
    const dimRow = dims.find((d) => d.slug === v.dimension_slug);
    if (!dimRow) continue;
    await c.env.DB.prepare(
      `INSERT INTO user_values (user_id, dimension_id, score, confidence, taxonomy_version, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, dimension_id) DO UPDATE SET
         score = excluded.score,
         confidence = excluded.confidence,
         taxonomy_version = excluded.taxonomy_version,
         updated_at = excluded.updated_at`
    ).bind(user.id, dimRow.id, v.score, v.confidence, taxonomyVersion).run();
  }

  const summary = summarizeVector(vector);
  return c.json({
    vector: vector.map((v) => ({ ...v, dimension_label: dims.find((d) => d.slug === v.dimension_slug)?.label || v.dimension_slug })),
    summary: {
      top: summary.top.map((slug) => {
        const d = dims.find((x) => x.slug === slug);
        return { slug, label: d?.label || slug };
      }),
      secondary: summary.secondary
        ? { slug: summary.secondary, label: dims.find((x) => x.slug === summary.secondary)?.label || summary.secondary }
        : null,
    },
  });
});

values.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillsTaxonomySchema(c.env);
  const sql = getSQL(c.env);

  const [rows, dims] = await Promise.all([
    sql`
      SELECT v.dimension_id, v.score, v.confidence, v.updated_at,
             d.slug, d.label, d.family, d.is_bipolar, d.pole_low, d.pole_high
      FROM user_values v
      JOIN value_dimensions d ON d.id = v.dimension_id
      WHERE v.user_id = ${user.id}
      ORDER BY ABS(v.score) * v.confidence DESC, d.display_order
    `,
    sql`
      SELECT id, slug, label, family, is_bipolar, pole_low, pole_high
      FROM value_dimensions ORDER BY display_order, label
    `,
  ]);

  const vector = (rows || []).map((r) => ({
    dimension_slug: r.slug,
    dimension_label: r.label,
    family: r.family,
    is_bipolar: !!r.is_bipolar,
    pole_low: r.pole_low || null,
    pole_high: r.pole_high || null,
    score: Number(r.score),
    confidence: Number(r.confidence),
    updated_at: r.updated_at,
  }));

  const summary = summarizeVector(vector);
  const { ok, nextAt } = await canRetake(c.env, user.id);

  return c.json({
    can_retake: ok,
    next_retake_at: nextAt,
    vector,
    summary: {
      top: summary.top.map((slug) => {
        const d = dims.find((x: any) => x.slug === slug);
        return { slug, label: d?.label || slug };
      }),
      secondary: summary.secondary
        ? { slug: summary.secondary, label: dims.find((x: any) => x.slug === summary.secondary)?.label || summary.secondary }
        : null,
    },
  });
});

export default values;

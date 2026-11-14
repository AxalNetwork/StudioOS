/**
 * D1260 (#3283, part 7 of #2428; owner question 8 A) — the ten venture-risk
 * layers as Risk's sub-rows (SC5).
 *
 * Risk's input "Analyst layer reviews" reads the mean analyst score across
 * the layers an analyst scored (D1255). Its sub-rows are those reviews, one
 * per layer, read with the scorecard and never stored with it. Scoring and
 * model v1 are untouched.
 *
 *   · Only an analyst's own review is a sub-row's figure. The old automatic
 *     layer score (`ventureRisk.ts`, from the Lab scorer's sliders and the
 *     projects row) is not read: it is not a scorecard input, and it scored
 *     a layer with no data as 0.
 *   · A layer no analyst scored reads "Not reviewed", never 0.
 *   · The analyst's note is studio staff's only. The founder, a shared
 *     advisor and an investor after the NDA read the figure and the band.
 *     Before the NDA an investor reads no sub-row at all.
 */
import type { Env } from '../../types';
import { LAYERS, scoreToBand, type RiskBand } from '../ventureRisk';

export type RiskLayer = {
  key: string; label: string; state: 'reviewed' | 'not_reviewed';
  score: number | null; band: RiskBand | null; reviewed_on: string | null; note?: string | null;
};

/** The ten layers in their one order, each with its analyst review or "Not reviewed". */
export async function riskLayers(env: Env, projectId: number, { notes }: { notes: boolean }): Promise<RiskLayer[]> {
  const rows = (await env.DB.prepare(
    'SELECT layer_key, analyst_score, analyst_band, analyst_note, updated_at FROM venture_risk_overrides WHERE project_id = ?',
  ).bind(projectId).all<{ layer_key: string; analyst_score: number | null; analyst_band: string | null; analyst_note: string | null; updated_at: string | null }>()).results || [];
  const byKey = new Map(rows.map((r) => [r.layer_key, r]));
  return LAYERS.map((layer) => {
    const row = byKey.get(layer.key);
    const score = row?.analyst_score == null || !Number.isFinite(Number(row.analyst_score)) ? null : Math.round(Number(row.analyst_score) * 10) / 10;
    const out: RiskLayer = {
      key: layer.key, label: layer.label,
      state: score == null ? 'not_reviewed' : 'reviewed',
      score,
      band: score == null ? null : (['low', 'medium', 'high'].includes(String(row?.analyst_band)) ? row!.analyst_band as RiskBand : scoreToBand(score)),
      reviewed_on: score == null ? null : (row?.updated_at ? String(row.updated_at).slice(0, 10) : null),
    };
    if (notes) out.note = row?.analyst_note ?? null;
    return out;
  });
}

/** Puts the sub-rows on the Risk scope and nowhere else. */
export function withRiskLayers<T extends { scope: string }>(scopes: T[], layers: RiskLayer[] | null): Array<T & { layers?: RiskLayer[] }> {
  if (!layers) return scopes;
  return scopes.map((s) => (s.scope === 'risk' ? { ...s, layers } : s));
}

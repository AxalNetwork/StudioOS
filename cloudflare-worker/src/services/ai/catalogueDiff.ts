/**
 * D1536 (#3785, deck v2 B9) — the catalogue against Cloudflare's live model
 * list, as plain values: `liveModelsOf` reads one page of Cloudflare's model
 * search answer, and `diffCatalogue` names each field where the live list and
 * `catalogue.ts` disagree. Pure, like the rest of this folder: the weekly job
 * (`../aiCatalogueDrift.ts`) does the fetching, the writing and the alert.
 *
 * WHAT COUNTS AS DRIFT. One finding per model and field:
 *   - `listed`: a live model the catalogue has no row for (`absent` → `listed`),
 *     or an offered row (`ga` or `partner`) the live list no longer has
 *     (`listed` → `absent`). A row already `deprecated`, `beta` or `not_found`
 *     that is gone live is not drift: the catalogue already says so.
 *   - `kind`: the task name differs.
 *   - `context_window`: both sides state one and they differ.
 *   - `beta`: the live list marks the model beta and the catalogue does not, or
 *     the other way round.
 * Prices are not compared: the search answer carries no neurons, which is what
 * Cloudflare bills and what the catalogue holds (D760).
 */
import { CATALOGUE, type CatalogueModel } from './catalogue';

export type LiveModel = { id: string; kind: string | null; context_window: number | null; beta: boolean | null };
export type Drift = { model_id: string; field: 'listed' | 'kind' | 'context_window' | 'beta'; catalogue_value: string | null; live_value: string | null };

const MODEL_ID = /^@(cf|hf)\/[A-Za-z0-9._\/-]{1,120}$/;

/** One page of `GET /accounts/:id/ai/models/search`'s `result`, as `LiveModel`s; anything unreadable is left out. */
export function liveModelsOf(result: unknown): LiveModel[] {
  if (!Array.isArray(result)) return [];
  const out: LiveModel[] = [];
  for (const r of result as any[]) {
    const id = typeof r?.name === 'string' ? r.name : null;
    if (!id || !MODEL_ID.test(id)) continue;
    const props = new Map<string, unknown>(Array.isArray(r.properties) ? r.properties.filter((p: any) => typeof p?.property_id === 'string').map((p: any) => [p.property_id, p.value]) : []);
    const cw = Number(props.get('context_window'));
    const beta = props.has('beta') ? String(props.get('beta')).toLowerCase() === 'true' : null;
    out.push({ id, kind: typeof r?.task?.name === 'string' ? r.task.name : null, context_window: Number.isFinite(cw) && cw > 0 ? cw : null, beta });
  }
  return out;
}

const OFFERED = new Set(['ga', 'partner']);

export function diffCatalogue(live: readonly LiveModel[], catalogue: readonly CatalogueModel[] = CATALOGUE): Drift[] {
  const byId = new Map(catalogue.map((m) => [m.id, m]));
  const liveIds = new Set(live.map((m) => m.id));
  const out: Drift[] = [];
  for (const m of live) {
    const row = byId.get(m.id);
    if (!row) { out.push({ model_id: m.id, field: 'listed', catalogue_value: 'absent', live_value: 'listed' }); continue; }
    if (m.kind && m.kind !== row.kind) out.push({ model_id: m.id, field: 'kind', catalogue_value: row.kind, live_value: m.kind });
    if (m.context_window !== null && row.context_window !== null && m.context_window !== row.context_window) {
      out.push({ model_id: m.id, field: 'context_window', catalogue_value: String(row.context_window), live_value: String(m.context_window) });
    }
    if (m.beta !== null && m.beta !== (row.status === 'beta')) {
      out.push({ model_id: m.id, field: 'beta', catalogue_value: String(row.status === 'beta'), live_value: String(m.beta) });
    }
  }
  for (const row of catalogue) {
    if (OFFERED.has(row.status) && !liveIds.has(row.id)) out.push({ model_id: row.id, field: 'listed', catalogue_value: 'listed', live_value: 'absent' });
  }
  return out;
}

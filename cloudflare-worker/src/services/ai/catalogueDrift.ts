/**
 * D1536 (#3785, deck v2 B9) — the weekly check that the Workers AI catalogue
 * (`catalogue.ts`) still matches what Cloudflare lists.
 *
 * WHAT IS READ. Cloudflare's model search, `GET /accounts/{id}/ai/models/search`
 * on `https://api.cloudflare.com/client/v4`, page by page, with the read-only
 * token the owner sets as the secret `CF_AI_CATALOGUE_TOKEN` (and the existing
 * `CLOUDFLARE_ACCOUNT_ID`). Each live row keeps two fields only: its `name`
 * (the `@cf/…` id the catalogue uses) and its task's name (the catalogue's
 * `kind`).
 *
 * WHAT COUNTS AS DRIFT, one row per model and field in `ai_catalogue_drift`:
 *   - `listed`: a catalogue model Cloudflare no longer lists (`catalogue_value`
 *     'listed', `live_value` null), or a live model the catalogue lacks
 *     (`catalogue_value` null, `live_value` 'listed'). A row the catalogue
 *     already holds as `not_found` is expected to be missing and is skipped.
 *   - `kind`: both list the model and the task names differ.
 *
 * WHAT HAPPENS. A row stays while the drift holds and its `seen_at` moves; a
 * row no longer seen is removed. HQ is told once, in one alert, when a row
 * first appears or its values change, never again for the same drift.
 *
 * WHAT NEVER HAPPENS. With no token or no account id the job logs why and
 * stops: no request, no write, no alert. A failed or short read (an error
 * answer, a page that is not JSON, fewer rows than Cloudflare's own total)
 * writes nothing and raises no alert, so a bad week never reads as "every
 * model is gone". Nothing here changes the catalogue: a person does that, in
 * both files, from the alert.
 */
import type { Env } from '../../types';
import { CATALOGUE, type CatalogueModel } from './catalogue';
import { tellHq } from '../agents/alerts';

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const PER_PAGE = 100;
/** Cloudflare lists a few hundred models; past this many pages the read is treated as broken. */
export const MAX_PAGES = 20;
export const ALERT_TYPE = 'ai_catalogue_drift';

export type LiveModel = { id: string; kind: string | null };
export type DriftField = 'listed' | 'kind';
export type Drift = { model_id: string; field: DriftField; catalogue_value: string | null; live_value: string | null };

export type DriftDeps = {
  fetch?: typeof fetch;
  tellHq?: typeof tellHq;
  catalogue?: readonly Pick<CatalogueModel, 'id' | 'kind' | 'status'>[];
};

export type DriftResult =
  | { ran: false; reason: 'no_token' | 'no_account' | 'read_failed'; detail?: string }
  | { ran: true; live: number; drift: number; new_or_changed: number; resolved: number; told: number };

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const cut = (s: unknown, n = 200): string | null => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);

/** Every live model, or the reason the read cannot be trusted. */
export async function readLiveModels(env: Pick<Env, 'CF_AI_CATALOGUE_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID'>, doFetch: typeof fetch = fetch): Promise<{ ok: true; models: LiveModel[] } | { ok: false; detail: string }> {
  const account = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  if (!ACCOUNT_ID.test(account)) return { ok: false, detail: 'account id is not 32 hex characters' };
  const models: LiveModel[] = [];
  let total: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await doFetch(`${CF_API}/accounts/${account}/ai/models/search?per_page=${PER_PAGE}&page=${page}`, {
        headers: { authorization: `Bearer ${env.CF_AI_CATALOGUE_TOKEN}`, accept: 'application/json' },
      });
    } catch { return { ok: false, detail: `page ${page}: network` }; }
    if (!res.ok) return { ok: false, detail: `page ${page}: HTTP ${res.status}` };
    let body: any;
    try { body = await res.json(); } catch { return { ok: false, detail: `page ${page}: not JSON` }; }
    if (!body || body.success !== true || !Array.isArray(body.result)) return { ok: false, detail: `page ${page}: unsuccessful` };
    for (const r of body.result) {
      const id = cut(r?.name);
      if (id) models.push({ id, kind: cut(r?.task?.name) });
    }
    const t = Number(body.result_info?.total_count);
    if (Number.isSafeInteger(t) && t >= 0) total = t;
    if (body.result.length < PER_PAGE || (total !== null && models.length >= total)) {
      if (total !== null && models.length < total) return { ok: false, detail: `short read: ${models.length} of ${total}` };
      if (models.length === 0) return { ok: false, detail: 'no models listed' };
      return { ok: true, models };
    }
  }
  return { ok: false, detail: `more than ${MAX_PAGES} pages` };
}

/** The drift between the catalogue and a live list. Pure. */
export function diffCatalogue(catalogue: readonly Pick<CatalogueModel, 'id' | 'kind' | 'status'>[], live: readonly LiveModel[]): Drift[] {
  const liveById = new Map(live.map((m) => [m.id, m]));
  const known = new Set(catalogue.map((m) => m.id));
  const out: Drift[] = [];
  for (const m of catalogue) {
    if (m.status === 'not_found') continue;
    const l = liveById.get(m.id);
    if (!l) { out.push({ model_id: m.id, field: 'listed', catalogue_value: 'listed', live_value: null }); continue; }
    if (l.kind !== null && l.kind !== m.kind) out.push({ model_id: m.id, field: 'kind', catalogue_value: cut(m.kind), live_value: l.kind });
  }
  for (const l of live) {
    if (!known.has(l.id)) out.push({ model_id: l.id, field: 'listed', catalogue_value: null, live_value: 'listed' });
  }
  return out.sort((a, b) => a.model_id.localeCompare(b.model_id) || a.field.localeCompare(b.field));
}

const describe = (d: Drift) =>
  d.field === 'kind' ? `${d.model_id}: kind is "${d.live_value}" on Cloudflare, "${d.catalogue_value}" here`
    : d.live_value === null ? `${d.model_id}: no longer listed by Cloudflare`
      : `${d.model_id}: listed by Cloudflare, missing from the catalogue`;

/** The weekly job: read, compare, record, and tell HQ once about anything new. */
export async function runCatalogueDrift(env: Env, deps: DriftDeps = {}): Promise<DriftResult> {
  if (!String(env.CF_AI_CATALOGUE_TOKEN ?? '').trim()) {
    console.info('[cron] ai catalogue drift skipped: CF_AI_CATALOGUE_TOKEN is not set');
    return { ran: false, reason: 'no_token' };
  }
  if (!String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()) {
    console.info('[cron] ai catalogue drift skipped: CLOUDFLARE_ACCOUNT_ID is not set');
    return { ran: false, reason: 'no_account' };
  }
  const read = await readLiveModels(env, deps.fetch ?? fetch);
  if (!read.ok) {
    console.warn('[cron] ai catalogue drift: live read failed, nothing written', read.detail);
    return { ran: false, reason: 'read_failed', detail: read.detail };
  }
  const drift = diffCatalogue(deps.catalogue ?? CATALOGUE, read.models);

  const { results: before } = await env.DB.prepare(
    `SELECT model_id, field, catalogue_value, live_value FROM ai_catalogue_drift`,
  ).all<Drift>();
  const key = (d: Pick<Drift, 'model_id' | 'field'>) => `${d.model_id}\u0000${d.field}`;
  const had = new Map((before ?? []).map((d) => [key(d), d]));
  const now = new Set(drift.map(key));
  const fresh = drift.filter((d) => {
    const h = had.get(key(d));
    return !h || h.catalogue_value !== d.catalogue_value || h.live_value !== d.live_value;
  });
  const resolved = (before ?? []).filter((d) => !now.has(key(d)));

  const stmts = [
    ...drift.map((d) => env.DB.prepare(
      `INSERT INTO ai_catalogue_drift (model_id, field, catalogue_value, live_value)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (model_id, field) DO UPDATE SET
         catalogue_value = excluded.catalogue_value,
         live_value = excluded.live_value,
         first_seen_at = CASE WHEN ai_catalogue_drift.catalogue_value IS excluded.catalogue_value
                               AND ai_catalogue_drift.live_value IS excluded.live_value
                              THEN ai_catalogue_drift.first_seen_at ELSE datetime('now') END,
         seen_at = datetime('now')`,
    ).bind(d.model_id, d.field, d.catalogue_value, d.live_value)),
    ...resolved.map((d) => env.DB.prepare(`DELETE FROM ai_catalogue_drift WHERE model_id = ?1 AND field = ?2`).bind(d.model_id, d.field)),
  ];
  if (stmts.length) await env.DB.batch(stmts);

  let told = 0;
  if (fresh.length) {
    const lines = fresh.slice(0, 20).map((d) => `· ${describe(d)}`);
    if (fresh.length > 20) lines.push(`· and ${fresh.length - 20} more`);
    told = await (deps.tellHq ?? tellHq)(env, {
      type: ALERT_TYPE,
      title: `Workers AI catalogue drift: ${fresh.length} change${fresh.length === 1 ? '' : 's'}`,
      body: `Cloudflare's model list no longer matches the catalogue (services/ai/catalogue.ts and its fixture):\n${lines.join('\n')}`,
      link: null,
    });
  }
  console.info(`[cron] ai catalogue drift live=${read.models.length} drift=${drift.length} new_or_changed=${fresh.length} resolved=${resolved.length}`);
  return { ran: true, live: read.models.length, drift: drift.length, new_or_changed: fresh.length, resolved: resolved.length, told };
}

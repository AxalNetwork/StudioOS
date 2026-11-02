/**
 * D1536 (#3785, deck v2 B9) — the weekly catalogue drift job: Cloudflare's
 * live Workers AI model list against `services/ai/catalogue.ts`, the findings
 * in `ai_catalogue_drift` (migration 731) and one HQ alert when there are any.
 *
 * IT NEEDS A READ-ONLY TOKEN. `CLOUDFLARE_AI_MODELS_API_TOKEN` (Account ·
 * Workers AI · Read, an owner step under decision L) with the existing
 * `CLOUDFLARE_ACCOUNT_ID`. Until both are set the job SKIPS: it logs the reason,
 * calls nothing, writes nothing and raises no alert. The token is sent only in
 * the request's Authorization header and is never logged or stored.
 *
 * WHEN. Mondays 05:17 UTC, inside the every-minute tick (no cron line of its
 * own; the cron lists are pinned), on HQ only: Cloudflare's list is platform
 * content and N branches must not each read it (D106).
 *
 * THE ALERT reuses D886 B10's HQ inbox: one `notifications` row per active
 * Super Admin, keyed by the run's day, so a retried run alerts no one twice,
 * and its `notifications_inbox` item in `operations`. It carries counts only.
 * The job never edits the catalogue: a person reads the findings and changes
 * `catalogue.ts` and its fixture in one commit (D760).
 *
 * Logs hold the outcome and counts only.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { diffCatalogue, liveModelsOf, type Drift, type LiveModel } from './ai/catalogueDiff';

export const DRIFT_ALERT_TYPE = 'ai_catalogue_drift';
const PER_PAGE = 100;
const MAX_PAGES = 20;
const API = 'https://api.cloudflare.com/client/v4/accounts';
const ACCOUNT = /^[0-9a-f]{32}$/;

export type DriftOutcome =
  | { state: 'skipped'; reason: 'token_unset' | 'account_unset' | 'branch' }
  | { state: 'failed'; reason: 'live_unreadable' | 'live_empty' }
  | { state: 'ok'; models: number; drift: number; alerted: number };

/** Every page of the live list; null when any page is unreadable. */
export async function fetchLiveModels(env: Env, fetchFn: typeof fetch): Promise<LiveModel[] | null> {
  const out: LiveModel[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${API}/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=${PER_PAGE}&page=${page}`;
    let body: any;
    try {
      const r = await fetchFn(url, { headers: { authorization: `Bearer ${env.CLOUDFLARE_AI_MODELS_API_TOKEN}`, accept: 'application/json' } });
      if (!r.ok) return null;
      body = await r.json();
    } catch { return null; }
    if (!body || body.success !== true || !Array.isArray(body.result)) return null;
    out.push(...liveModelsOf(body.result));
    if (body.result.length < PER_PAGE) return out;
  }
  return out;
}

/** One alert per active Super Admin, at most once per day's key. Returns the inbox items written. */
export async function recordDriftAlert(env: Env, findings: readonly Drift[], day: string): Promise<number> {
  const recipients = await env.DB.prepare(`SELECT u.id, u.notification_prefs FROM super_admins s JOIN users u ON u.id = s.user_id
    WHERE u.is_active = 1 AND u.role = 'admin'`).all<{ id: number; notification_prefs: string | null }>();
  if (!Array.isArray(recipients.results)) throw new Error('drift_recipients_unreadable');
  const models = new Set(findings.map((f) => f.model_id)).size;
  const title = 'AI catalogue drift';
  const body = `${findings.length} differences across ${models} models between Cloudflare's model list and the catalogue.`;
  const link = '/admin/platform/ai-usage';
  const payload = JSON.stringify({ kind: DRIFT_ALERT_TYPE, findings: findings.length, models, day });
  const episode = `ai-catalogue-drift:${day}`;
  let recorded = 0;
  for (const user of recipients.results) {
    let prefs: any = {};
    try { prefs = JSON.parse(user.notification_prefs || '{}'); } catch { /* default on, like notify() */ }
    const enabled = prefs?.[DRIFT_ALERT_TYPE]?.in_app;
    if (enabled !== undefined && enabled !== true) continue;
    const token = crypto.randomUUID();
    // One batch is one transaction: the unique (user_id, kind, dedupe_key) row elects one writer per day.
    const r = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, meta, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(user.id, DRIFT_ALERT_TYPE, title, body, link, token, episode),
      env.DB.prepare(`INSERT INTO notifications_inbox (user_id, type, title, body, link, payload, channel, category)
        SELECT ?, ?, ?, ?, ?, ?, 'in_app', 'operations' WHERE EXISTS
        (SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND dedupe_key = ? AND meta = ?)`)
        .bind(user.id, DRIFT_ALERT_TYPE, title, body, link, payload, user.id, DRIFT_ALERT_TYPE, episode, token),
    ]);
    recorded += Number(r[1]?.meta?.changes ?? 0);
  }
  return recorded;
}

export async function runCatalogueDrift(env: Env, opts: { fetch?: typeof fetch; now?: Date } = {}): Promise<DriftOutcome> {
  const now = opts.now ?? new Date();
  if (branchOf(env)) return { state: 'skipped', reason: 'branch' };
  if (!env.CLOUDFLARE_AI_MODELS_API_TOKEN) {
    console.info('[ai-drift] skipped reason=token_unset');
    return { state: 'skipped', reason: 'token_unset' };
  }
  if (!env.CLOUDFLARE_ACCOUNT_ID || !ACCOUNT.test(env.CLOUDFLARE_ACCOUNT_ID)) {
    console.info('[ai-drift] skipped reason=account_unset');
    return { state: 'skipped', reason: 'account_unset' };
  }
  const live = await fetchLiveModels(env, opts.fetch ?? fetch);
  if (!live) { console.warn('[ai-drift] failed reason=live_unreadable'); return { state: 'failed', reason: 'live_unreadable' }; }
  // An empty list would read as every offered model gone: that is a broken answer, not drift.
  if (!live.length) { console.warn('[ai-drift] failed reason=live_empty'); return { state: 'failed', reason: 'live_empty' }; }
  const findings = diffCatalogue(live);
  const seen = now.toISOString().slice(0, 19).replace('T', ' ');
  if (findings.length) {
    await env.DB.batch(findings.map((f) => env.DB.prepare(
      'INSERT INTO ai_catalogue_drift (model_id, field, catalogue_value, live_value, seen_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(f.model_id, f.field, f.catalogue_value, f.live_value, seen)));
  }
  const alerted = findings.length ? await recordDriftAlert(env, findings, now.toISOString().slice(0, 10)) : 0;
  console.info(`[ai-drift] ok models=${live.length} drift=${findings.length} alerted=${alerted}`);
  return { state: 'ok', models: live.length, drift: findings.length, alerted };
}

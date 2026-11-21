/** D5674 (#5988): scheduled meeting-bot stage bridge — stored open-episode inventory, durable receipts, opt-in delivery port. */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { readBotSourceEvidence, type BotEpisodeInventory, type BotHealthWindow, type BotOpenEpisode, type BotProvider } from './cloudflareBotHealth';
import { cfAudience, parseCfReceipt, type CfDeliveryPort, type CfReceipt, type cfRoute } from './cloudflareSourceReceipt';
import { d1CfSourceStore, forwardPendingCfSourceReceipts } from './cloudflareSourceStore';

export type BotScript = BotHealthWindow['script'];
/** Both optional and read only here; unset (or malformed) means no port: receipts stay pending and nothing is sent. */
export type BotBridgeEnv = Env & { CF_BOT_DELIVERY_URL?: string; CF_BOT_DELIVERY_SECRET?: string };
/** A still-firing episode is stored again at most once an hour (a repeat, same episode key); every pass reads 24 hours of runs. */
export const BOT_REPEAT_MS = 3_600_000;
const INVENTORY_CAP = 1000;
export const botSourceKey = (script: BotScript) => `recording:${script}`;
export const botScriptOf = (env: Pick<Env, 'ENVIRONMENT'>): BotScript => env.ENVIRONMENT === 'preview' ? 'studioos-meeting-bot-preview' : 'studioos-meeting-bot';

export type StoredBotInventory = BotEpisodeInventory & { lastFiring: Map<string, number> };
const incomplete = (): StoredBotInventory => ({ complete: false, episodes: [], lastFiring: new Map() });

/**
 * The open episodes are the stored `firing` receipts of this script's partition newer than that
 * episode key's latest stored `recovered` receipt. Nothing else opens or closes one: no deploy,
 * process exit or empty fleet. Unreadable, capped, malformed or foreign rows make the whole
 * inventory incomplete, and an incomplete inventory can never produce a recovery.
 */
export async function storedBotEpisodes(db: D1Database, script: BotScript): Promise<StoredBotInventory> {
  try {
    const result = await db.prepare(`WITH r AS (SELECT receipt_id,observed_ms,receipt_json,json_extract(receipt_json,'$.episode_key') AS k,json_extract(receipt_json,'$.state') AS st
        FROM cf_source_receipts WHERE source_key=?),
      closed AS (SELECT k,MAX(observed_ms) AS m FROM r WHERE st='recovered' GROUP BY k)
      SELECT r.receipt_json FROM r LEFT JOIN closed c ON c.k=r.k WHERE r.st='firing' AND r.observed_ms>COALESCE(c.m,-1)
      ORDER BY r.observed_ms,r.receipt_id LIMIT ?`).bind(botSourceKey(script), INVENTORY_CAP + 1).all<{ receipt_json: string }>();
    if ((result.success as unknown) === false || !Array.isArray(result.results) || result.results.length > INVENTORY_CAP) return incomplete();
    const open = new Map<string, BotOpenEpisode & { last: number }>();
    for (const row of result.results) {
      const r = parseCfReceipt(JSON.parse(row.receipt_json));
      if (r.script !== script || r.family !== 'recording' || r.provider === 'none') return incomplete();
      const e = open.get(r.episode_key);
      // Rows come oldest first: the first firing opens the episode; the latest firing names the affected version.
      if (!e) open.set(r.episode_key, { component: r.component, provider: r.provider as BotProvider, opened_ms: r.observed_ms, version: r.revision, last: r.observed_ms });
      else { e.version = r.revision; e.last = r.observed_ms; }
    }
    return { complete: true, episodes: [...open.values()].map(({ last: _last, ...e }) => e), lastFiring: new Map([...open].map(([k, e]) => [k, e.last])) };
  } catch { return incomplete(); }
}

/** Coverage gaps are stored at most once per repeat interval as well. */
async function recentCoverage(db: D1Database, script: BotScript, now: number): Promise<boolean> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM cf_source_receipts WHERE source_key=? AND observed_ms>?
    AND json_extract(receipt_json,'$.component')='coverage'`).bind(botSourceKey(script), now - BOT_REPEAT_MS).first<{ n: number }>();
  return Number(row?.n ?? 0) > 0;
}

/** What crosses the port: the route and the schema-checked receipt, nothing else. */
export function botDeliveryBody(route: ReturnType<typeof cfRoute>) {
  const receipt = parseCfReceipt(route.receipt);
  if ((receipt.audience === 'preview') !== (route.destination === 'preview')) throw Error('cf_audience_mismatch');
  return { destination: route.destination, labels: route.labels, subject: route.subject, owner: route.owner, drilldown: route.drilldown, receipt };
}

/**
 * The concrete `CfDeliveryPort`: one authenticated POST to the #5671 receiver with the shared secret in
 * `cf-webhook-auth`. Durable only on 202 with `accepted: true`; a probe reply, any other status, a
 * redirect, a timeout or a network error answers not durable, so the receipt stays pending.
 */
export function cfBotDeliveryPort(env: Pick<BotBridgeEnv, 'CF_BOT_DELIVERY_URL' | 'CF_BOT_DELIVERY_SECRET'>, fetcher: typeof fetch = fetch): CfDeliveryPort | null {
  const raw = env.CF_BOT_DELIVERY_URL?.trim(), secret = env.CF_BOT_DELIVERY_SECRET;
  if (!raw || typeof secret !== 'string' || secret.length < 32) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  return {
    async enqueue(route) {
      const body = JSON.stringify(botDeliveryBody(route));
      try {
        const res = await fetcher(url.href, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
          headers: { 'content-type': 'application/json', 'cf-webhook-auth': secret }, body });
        if (res.status !== 202) return { durable: false };
        const ack = await res.json().catch(() => null) as { accepted?: unknown; probe?: unknown } | null;
        return { durable: ack?.accepted === true && ack?.probe !== true };
      } catch { return { durable: false }; }
    },
  };
}

export type BotBridgeResult = { state: 'skipped' | 'superseded' | 'observed'; script?: BotScript; inventory?: 'complete' | 'incomplete'; stored: number; forwarded: number; delivery: 'not_configured' | 'forwarded' | 'pending' };

/**
 * One pass: read the stored inventory, read the recording ledger through D5674's projection, keep
 * firing (new episode, or a repeat after BOT_REPEAT_MS), recovered and coverage receipts, commit them
 * behind the source cursor's compare-and-swap, then forward this partition's pending receipts.
 * Activity, idle and disabled counts stay in the HQ read; they are not stored.
 */
export async function runBotSourceBridge(env: BotBridgeEnv, opts: { now?: number; port?: CfDeliveryPort | null } = {}): Promise<BotBridgeResult> {
  if (branchOf(env)) return { state: 'skipped', stored: 0, forwarded: 0, delivery: 'not_configured' };
  const now = opts.now ?? Date.now(), script = botScriptOf(env), key = botSourceKey(script), store = d1CfSourceStore(env.DB);
  const port = opts.port === undefined ? cfBotDeliveryPort(env) : opts.port;
  const cursor = await store.read(key);
  const inventory = await storedBotEpisodes(env.DB, script);
  const evidence = await readBotSourceEvidence(env, now, { script, inventory });
  const coverageRecent = await recentCoverage(env.DB, script, now);
  const keep: CfReceipt[] = [];
  for (const r of evidence.receipts) {
    if (r.audience !== cfAudience(script)) throw Error('cf_audience_mismatch');
    if (r.state === 'recovered') keep.push(r);
    else if (r.state === 'firing') { const last = inventory.lastFiring.get(r.episode_key); if (last === undefined || now - last >= BOT_REPEAT_MS) keep.push(r); }
    else if (r.component === 'coverage' && !coverageRecent) keep.push(r);
  }
  if (!await store.commit(key, cursor.revision, { through_ms: now, active_id: null, active_versions: [] }, keep))
    return { state: 'superseded', script, stored: 0, forwarded: 0, delivery: port ? 'pending' : 'not_configured' };
  if (!port) return { state: 'observed', script, inventory: inventory.complete ? 'complete' : 'incomplete', stored: keep.length, forwarded: 0, delivery: 'not_configured' };
  let forwarded = 0, delivery: BotBridgeResult['delivery'] = 'forwarded';
  // A non-durable acknowledgement throws before the row is marked; it and everything after it stay pending.
  try { forwarded = await forwardPendingCfSourceReceipts(env.DB, port, now, key); } catch { delivery = 'pending'; }
  return { state: 'observed', script, inventory: inventory.complete ? 'complete' : 'incomplete', stored: keep.length, forwarded, delivery };
}

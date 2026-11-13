/** Deliver verified HQ D1-size alert openings and recoveries to its platform section (#5679). */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { sendCapacityNotice } from './sectionSlackPreview';

type Delivery = {
  alert_id: number; stage: 'firing' | 'recovery'; attempts: number;
  root_channel: string | null; root_ts: string | null;
};

const MAX_ATTEMPTS = 5;
const CADENCE = 15 * 60 * 1000;

export async function deliverCapacityEpisodes(env: Env, now: Date): Promise<void> {
  const start = env.AXAL_SECTION_CAPACITY_SLACK_START_UTC;
  if (!start || branchOf(env)) return;
  // Do not replay historical episodes when the operator enables the first route.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(start) || !Number.isFinite(Date.parse(start))) {
    throw new Error('invalid_section_capacity_slack_start');
  }
  const instant = now.getTime();
  if (instant < Date.parse(start)) return;
  const cutoff = new Date(start).toISOString();
  const observed = now.toISOString();
  // Reconcile from committed episodes, including a transition that landed
  // during an outage. No notification preference or user data enters this table.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO section_capacity_slack_deliveries (alert_id, stage)
      SELECT a.id, 'firing' FROM platform_capacity_alerts a
      WHERE a.scope='hq' AND a.metric_key='d1.size_bytes' AND a.severity IN ('warning','critical')
      AND a.opened_at >= ? AND a.opened_at <= ?
      AND (a.muted_until IS NULL OR a.muted_until <= COALESCE(a.cleared_at, ?))
      AND NOT EXISTS (SELECT 1 FROM section_capacity_slack_deliveries d WHERE d.alert_id=a.id AND d.stage='firing')
      ORDER BY a.id LIMIT 8`).bind(cutoff, observed, observed),
    env.DB.prepare(`INSERT OR IGNORE INTO section_capacity_slack_deliveries (alert_id, stage)
      SELECT a.id, 'recovery' FROM platform_capacity_alerts a
      JOIN section_capacity_slack_deliveries f ON f.alert_id=a.id AND f.stage='firing' AND f.state='delivered'
      WHERE a.state='cleared' AND a.cleared_at IS NOT NULL AND a.opened_at >= ?
      AND (a.muted_until IS NULL OR a.muted_until <= a.cleared_at)
      AND NOT EXISTS (SELECT 1 FROM section_capacity_slack_deliveries d WHERE d.alert_id=a.id AND d.stage='recovery')
      ORDER BY a.id LIMIT 8`).bind(cutoff),
    // A crash after Slack accepted a write can lose the acknowledgement.
    // Preserve the ambiguous outcome and do not create another Slack post.
    env.DB.prepare(`UPDATE section_capacity_slack_deliveries SET state='uncertain', last_reason='lease_expired'
      WHERE state='sending' AND lease_until <= ?`).bind(instant),
  ]);
  const due = await env.DB.prepare(`SELECT d.alert_id,d.stage,d.attempts,f.channel_id AS root_channel,f.message_ts AS root_ts
    FROM section_capacity_slack_deliveries d JOIN platform_capacity_alerts a ON a.id=d.alert_id
    LEFT JOIN section_capacity_slack_deliveries f ON f.alert_id=d.alert_id AND f.stage='firing'
    WHERE d.state='pending' AND d.next_at <= ? AND a.opened_at >= ?
    AND (a.muted_until IS NULL OR a.muted_until <= COALESCE(a.cleared_at, ?))
    AND (d.stage='firing' OR f.state='delivered')
    AND NOT EXISTS (SELECT 1 FROM section_capacity_slack_deliveries b WHERE b.last_reason='rate_limited' AND b.next_at > ?)
    ORDER BY d.alert_id,d.stage LIMIT 2`).bind(instant, cutoff, observed, instant).all<Delivery>();
  for (const item of due.results) {
    if (item.stage === 'recovery' && (!item.root_channel || !item.root_ts)) continue;
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(`UPDATE section_capacity_slack_deliveries
      SET state='sending', attempts=attempts+1, lease_until=?, claim_token=?
      WHERE alert_id=? AND stage=? AND state='pending' AND next_at <= ?`)
      .bind(instant + 10 * 60 * 1000, token, item.alert_id, item.stage, instant).run();
    if (!claimed.meta.changes) continue;
    const outcome = await sendCapacityNotice(env, item.stage === 'firing' ? { stage: 'firing' } :
      { stage: 'recovery', root: { channel: item.root_channel!, ts: item.root_ts! } });
    if (outcome.ok) {
      await env.DB.prepare(`UPDATE section_capacity_slack_deliveries
        SET state='delivered',channel_id=?,message_ts=?,claim_token=NULL,lease_until=NULL,last_reason=NULL,next_at=0
        WHERE alert_id=? AND stage=? AND claim_token=?`)
        .bind(outcome.channel, outcome.ts, item.alert_id, item.stage, token).run();
      continue;
    }
    const ambiguous = outcome.reason === 'receipt_unconfirmed';
    const state = ambiguous ? 'uncertain' : item.attempts + 1 >= MAX_ATTEMPTS ? 'exhausted' : 'pending';
    const next = instant + Math.max(CADENCE * 2 ** item.attempts, (outcome.retry_after_seconds ?? 0) * 1000);
    await env.DB.prepare(`UPDATE section_capacity_slack_deliveries
      SET state=?,last_reason=?,next_at=?,claim_token=NULL,lease_until=NULL
      WHERE alert_id=? AND stage=? AND claim_token=?`).bind(state, outcome.reason, next, item.alert_id, item.stage, token).run();
    if (outcome.reason === 'rate_limited') break;
  }
}

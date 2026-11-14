import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { sendVerifiedSection } from './sectionSlackPreview';

type Observation = {
  episodeId: string;
  eventId: string;
  fingerprint: string;
  section: string;
  impactedSections?: string[];
} & ({ kind: 'occurrence' | 'recovery' } | { kind: 'version'; version: string });

type Episode = {
  episode_id: string;
  section_slug: string;
  impacted_sections: string;
  occurrence_total: number;
  checkpoint: number;
  version: string | null;
  posted_version: string | null;
  recovered: number;
  recovery_posted: number;
  attempts: number;
  channel_id: string | null;
  message_ts: string | null;
};

const sectionPattern = /^axalvc-(superadmin|admin|founder|investor|partner|advisor|explorer|all)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const identifier = /^[a-zA-Z0-9_.:-]{1,160}$/;
const validSection = (section: string) => section.length <= 80 && sectionPattern.test(section);
const maxAttempts = 5;
const retryBase = 15 * 60 * 1000;
const pending = `channel_id IS NULL OR checkpoint < occurrence_total
  OR posted_version IS NOT version OR recovered > recovery_posted`;

/** The request only registers a background write. Storage errors stay in that task. */
export function enqueueSectionIncident(
  env: Env,
  context: Pick<ExecutionContext, 'waitUntil'>,
  event: Observation,
): void {
  try {
    context.waitUntil(storeObservation(env, event).catch(reportEnqueueFailure));
  } catch {
    reportEnqueueFailure();
  }
}

function reportEnqueueFailure() {
  console.warn('[section-incident-outbox] enqueue failed', { count: 1 });
}

async function storeObservation(env: Env, event: Observation) {
  if (![event.episodeId, event.eventId, event.fingerprint].every(value => identifier.test(value))
      || !validSection(event.section)
      || (event.kind === 'version' && !identifier.test(event.version))) return;
  const impacted = [...new Set(event.impactedSections ?? [])]
    .filter(section => section !== event.section && validSection(section)).slice(0, 12);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO section_incident_outbox (episode_id, fingerprint, section_slug, impacted_sections)
      VALUES (?, ?, ?, ?) ON CONFLICT (episode_id) DO NOTHING`)
      .bind(event.episodeId, event.fingerprint, event.section, JSON.stringify(impacted)),
    env.DB.prepare(`UPDATE section_incident_outbox
      SET version = CASE WHEN ? IS NULL THEN version ELSE ? END,
          recovered = MAX(recovered, ?),
          impacted_sections = CASE WHEN ? = '[]' THEN impacted_sections ELSE ? END
      WHERE episode_id = ? AND fingerprint = ? AND section_slug = ?
        AND NOT EXISTS (SELECT 1 FROM section_incident_observations WHERE episode_id = ? AND event_id = ?)`)
      .bind(event.kind === 'version' ? event.version : null, event.kind === 'version' ? event.version : null,
        Number(event.kind === 'recovery'), JSON.stringify(impacted), JSON.stringify(impacted),
        event.episodeId, event.fingerprint, event.section, event.episodeId, event.eventId),
    env.DB.prepare(`INSERT INTO section_incident_observations (episode_id, event_id, kind)
      SELECT episode_id, ?, ? FROM section_incident_outbox WHERE episode_id = ? AND fingerprint = ? AND section_slug = ?
      ON CONFLICT (episode_id, event_id) DO NOTHING`)
      .bind(event.eventId, event.kind, event.episodeId, event.fingerprint, event.section),
    env.DB.prepare(`UPDATE section_incident_outbox SET occurrence_total =
      (SELECT COUNT(*) FROM section_incident_observations WHERE episode_id = ? AND kind = 'occurrence')
      WHERE episode_id = ? AND fingerprint = ? AND section_slug = ?`)
      .bind(event.episodeId, event.episodeId, event.fingerprint, event.section),
    env.DB.prepare(`UPDATE section_incident_outbox SET state = 'pending'
      WHERE episode_id = ? AND state = 'delivered' AND (${pending})`).bind(event.episodeId),
  ]);
}

function nextMessage(episode: Episode) {
  if (!episode.channel_id || !episode.message_ts) {
    const impacted = JSON.parse(episode.impacted_sections) as string[];
    const other = impacted.length ? ` Impacted sections: ${impacted.join(', ')}.` : '';
    return { text: `Incident opened. Recorded occurrences: ${episode.occurrence_total}.${other}`, checkpoint: episode.occurrence_total };
  }
  if (episode.checkpoint < episode.occurrence_total) {
    return { text: `Incident recurred. Recorded occurrences: ${episode.occurrence_total}.`, checkpoint: episode.occurrence_total };
  }
  if (episode.version !== episode.posted_version) return { text: `Version: ${episode.version}.`, version: episode.version };
  return { text: 'Incident recovered.', recovery: 1 };
}

export async function drainSectionIncidents(env: Env, now = new Date()) {
  if (branchOf(env) || !env.SLACK_BOT_TOKEN || !env.AXAL_SECTION_SLACK_TEAM_ID || !env.AXAL_SECTION_SLACK_CHANNELS) {
    return 'unconfigured' as const;
  }
  const instant = now.getTime();
  await env.DB.prepare(`UPDATE section_incident_outbox
    SET state = 'uncertain', last_reason = 'lease_expired', lease_until = NULL, claim_token = NULL
    WHERE state = 'sending' AND lease_until <= ?`).bind(instant).run();
  const due = await env.DB.prepare(`SELECT episode_id FROM section_incident_outbox
    WHERE state = 'pending' AND next_at <= ?
      AND NOT EXISTS (SELECT 1 FROM section_incident_outbox WHERE last_reason = 'rate_limited' AND next_at > ?)
    ORDER BY next_at, episode_id LIMIT 4`).bind(instant, instant).all<{ episode_id: string }>();
  for (const { episode_id } of due.results) {
    const token = crypto.randomUUID();
    const episode = await env.DB.prepare(`UPDATE section_incident_outbox
      SET state = 'sending', attempts = attempts + 1, claim_token = ?, lease_until = ?
      WHERE episode_id = ? AND state = 'pending' AND next_at <= ?
      RETURNING episode_id, section_slug, impacted_sections, occurrence_total, checkpoint, version, posted_version,
        recovered, recovery_posted, attempts, channel_id, message_ts`)
      .bind(token, instant + 10 * 60 * 1000, episode_id, instant).first<Episode>();
    if (!episode) continue;
    const message = nextMessage(episode);
    const thread = episode.channel_id && episode.message_ts ? { channel: episode.channel_id, ts: episode.message_ts } : undefined;
    const outcome = await sendVerifiedSection(env, episode.section_slug, message.text, thread);
    if (outcome.ok) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE section_incident_outbox SET checkpoint = ?, posted_version = ?, recovery_posted = ?,
          channel_id = COALESCE(channel_id, ?), message_ts = COALESCE(message_ts, ?),
          attempts = 0, next_at = 0, last_reason = NULL WHERE episode_id = ? AND claim_token = ?`)
          .bind(message.checkpoint ?? episode.checkpoint, message.version ?? episode.posted_version,
            message.recovery ?? episode.recovery_posted, outcome.channel, outcome.ts, episode_id, token),
        env.DB.prepare(`UPDATE section_incident_outbox SET state = CASE WHEN (${pending}) THEN 'pending' ELSE 'delivered' END,
          claim_token = NULL, lease_until = NULL WHERE episode_id = ? AND claim_token = ?`).bind(episode_id, token),
      ]);
      continue;
    }
    const state = outcome.reason === 'receipt_unconfirmed' ? 'uncertain' : episode.attempts >= maxAttempts ? 'exhausted' : 'pending';
    const next = instant + Math.max(retryBase * 2 ** (episode.attempts - 1), (outcome.retry_after_seconds ?? 0) * 1000);
    await env.DB.prepare(`UPDATE section_incident_outbox SET state = ?, next_at = ?, last_reason = ?,
      claim_token = NULL, lease_until = NULL WHERE episode_id = ? AND claim_token = ?`)
      .bind(state, next, outcome.reason, episode_id, token).run();
    if (outcome.reason === 'rate_limited') break;
  }
  return 'checked' as const;
}

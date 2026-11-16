/** D5984 (#5984): link a persisted section incident episode to one scrubbed GitHub bug; the Slack thread stays on the row. */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { addComment, createIssue, fetchComments, fetchIssue, githubConfigured, sha256Hex, type GhResult } from './githubSync';
import { cases, countMilestone, issueDraft, issueKeyInput, milestoneComment, milestoneReceipt } from '../../../scripts/lib/sectionIncidentIssue.mjs';

export const eligibleClassification = 'ordinary-ui-regression';
/** These stay in the restricted path (D5680): no public issue is ever written for them. */
export const restrictedClassifications = ['security', 'permission', 'credential', 'financial', 'contract', 'migration'] as const;

type Owner = { login: string; slot: string };
/**
 * Section key (a case's `section`) to GitHub login and slot. #5681's map is an
 * owner decision still open, so this ships empty and every bug is filed
 * unassigned for S01 triage.
 */
export const sectionOwners: Readonly<Record<string, Owner>> = Object.freeze({});

export function validOwner(owner: unknown): owner is Owner {
  const o = owner as Partial<Owner> | null;
  return !!o && typeof o.login === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(o.login)
    && typeof o.slot === 'string' && /^S(0[1-9]|[1-9][0-9])$/.test(o.slot);
}

type Row = {
  episode_id: string;
  section_slug: string;
  occurrence_total: number;
  version: string | null;
  incident_case: string | null;
  classification: string | null;
  github_state: 'filing' | 'linked' | null;
  github_issue: number | null;
  github_milestone: number | null;
  github_milestone_pending: number | null;
  github_next_at: number;
};

export type IssueLink = {
  state: 'unconfigured' | 'not_found' | 'restricted' | 'ineligible' | 'classification_conflict' | 'deferred'
    | 'filed' | 'linked' | 'count_posted' | 'filing_uncertain' | 'filing_blocked' | 'count_delivery_uncertain'
    | 'rate_limited' | 'validation_rejected' | 'rejected';
  issue?: number;
};

const rateLimitDelay = 15 * 60 * 1000;
const rejectionDelay = 6 * 60 * 60 * 1000;

/** Off unless the flag is exactly 'enabled', on HQ, with the ticket mirror's token and repository set. */
export function sectionIssuesEnabled(env: Env): boolean {
  return env.AXAL_SECTION_INCIDENT_GITHUB === 'enabled' && !branchOf(env) && githubConfigured(env);
}

/** Only these statuses prove GitHub refused the write; anything else may have created it. */
function rejection(result: GhResult): IssueLink['state'] | null {
  if (result.status === 429) return 'rate_limited';
  if (result.status === 422) return 'validation_rejected';
  if (result.status === 401 || result.status === 403) return 'rejected';
  return null;
}

const readRow = (env: Env, episodeId: string) =>
  env.DB.prepare(`SELECT episode_id, section_slug, occurrence_total, version, incident_case, classification, github_state,
    github_issue, github_milestone, github_milestone_pending, github_next_at
    FROM section_incident_outbox WHERE episode_id = ?`).bind(episodeId).first<Row>();

/**
 * A producer classifies an episode it already stored in the outbox (D5979) and
 * asks for its bug. The first classification is kept; a different one later
 * is refused. Restricted classes are refused before any GitHub call.
 */
export async function linkSectionIncidentIssue(
  env: Env,
  request: { episodeId: string; caseId: string | null; classification: string },
  now = new Date(),
): Promise<IssueLink> {
  if (!sectionIssuesEnabled(env)) return { state: 'unconfigured' };
  const restricted = (restrictedClassifications as readonly string[]).includes(request.classification);
  const spec = request.caseId ? cases.get(request.caseId) : undefined;
  if (!restricted && (request.classification !== eligibleClassification || !spec)) return { state: 'ineligible' };
  await env.DB.prepare(`UPDATE section_incident_outbox SET incident_case = ?, classification = ?,
      github_reason = CASE WHEN ? = 1 THEN 'restricted' ELSE github_reason END
    WHERE episode_id = ? AND classification IS NULL`)
    .bind(spec ? request.caseId : null, request.classification, Number(restricted), request.episodeId).run();
  const row = await readRow(env, request.episodeId);
  if (!row) return { state: 'not_found' };
  if (row.classification !== request.classification || (!restricted && row.incident_case !== request.caseId)) {
    return { state: 'classification_conflict' };
  }
  if (restricted) return { state: 'restricted' };
  if (row.section_slug !== `axalvc-${spec!.section}`) return { state: 'ineligible' };
  return advance(env, row, now.getTime());
}

/** The scheduled pass: classified episodes with a bug to file or a count milestone to publish. */
export async function syncSectionIncidentIssues(env: Env, now = new Date()) {
  if (!sectionIssuesEnabled(env)) return 'unconfigured' as const;
  const instant = now.getTime();
  const rows = await env.DB.prepare(`SELECT episode_id, section_slug, occurrence_total, version, incident_case, classification, github_state,
    github_issue, github_milestone, github_milestone_pending, github_next_at
    FROM section_incident_outbox
    WHERE classification = ? AND incident_case IS NOT NULL AND github_next_at <= ?
      AND (github_state IS NULL OR (github_state = 'linked'
        AND (github_milestone_pending IS NOT NULL OR occurrence_total > github_milestone)))
    ORDER BY github_next_at, episode_id`).bind(eligibleClassification, instant).all<Row>();
  let sent = 0;
  for (const row of rows.results) {
    if (row.github_state === 'linked' && row.github_milestone_pending == null
        && countMilestone(row.occurrence_total) <= (row.github_milestone ?? 0)) continue;
    if (++sent > 4) break;
    const outcome = await advance(env, row, instant);
    if (outcome.state === 'rate_limited') break;
  }
  return 'checked' as const;
}

async function advance(env: Env, row: Row, instant: number): Promise<IssueLink> {
  if (row.github_next_at > instant) return { state: 'deferred' };
  const repo = `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`;
  const key = await sha256Hex(issueKeyInput(repo, row.incident_case!, row.episode_id));
  if (row.github_state === 'filing') return { state: 'filing_uncertain' };
  if (row.github_state === 'linked') return publishCount(env, row, key, instant);
  if (row.occurrence_total < 1) return { state: 'deferred' };
  const draft = issueDraft({ repo, caseId: row.incident_case!, key, count: row.occurrence_total,
    revision: row.version && /^[0-9a-f]{40}$/.test(row.version) ? row.version : null });
  const owner = sectionOwners[draft.spec.section];
  // The durable intent, before the create call. Any unresolved intent blocks every new filing.
  const intent = await env.DB.prepare(`UPDATE section_incident_outbox
    SET github_state = 'filing', github_milestone = ?, github_reason = NULL
    WHERE episode_id = ? AND github_state IS NULL
      AND NOT EXISTS (SELECT 1 FROM section_incident_outbox o WHERE o.github_state = 'filing')
    RETURNING episode_id`).bind(row.occurrence_total, row.episode_id).first<{ episode_id: string }>();
  if (!intent) {
    const current = await readRow(env, row.episode_id);
    if (current?.github_state === 'linked') return { state: 'linked', issue: current.github_issue ?? undefined };
    return { state: current?.github_state === 'filing' ? 'filing_uncertain' : 'filing_blocked' };
  }
  const result = await createIssue(env, { title: draft.title, body: draft.body, labels: draft.labels,
    ...(validOwner(owner) ? { assignees: [owner.login] } : {}) }, { retry: false });
  const issue = result.data;
  if (result.ok && Number.isSafeInteger(issue?.number) && issue.number > 0 && !issue.pull_request
      && typeof issue.body === 'string' && issue.body.split('\n').includes(draft.marker)) {
    await env.DB.prepare(`UPDATE section_incident_outbox SET github_state = 'linked', github_issue = ?
      WHERE episode_id = ? AND github_state = 'filing'`).bind(issue.number, row.episode_id).run();
    return { state: 'filed', issue: issue.number };
  }
  const refused = rejection(result);
  if (refused) {
    await env.DB.prepare(`UPDATE section_incident_outbox SET github_state = NULL, github_milestone = NULL,
      github_reason = ?, github_next_at = ? WHERE episode_id = ? AND github_state = 'filing'`)
      .bind(refused, instant + (refused === 'rate_limited' ? rateLimitDelay : rejectionDelay), row.episode_id).run();
    return { state: refused };
  }
  // A lost or unverifiable answer may have opened the issue. Keep the intent for reconciliation.
  await env.DB.prepare(`UPDATE section_incident_outbox SET github_reason = 'create_unconfirmed'
    WHERE episode_id = ? AND github_state = 'filing'`).bind(row.episode_id).run();
  return { state: 'filing_uncertain' };
}

async function publishCount(env: Env, row: Row, key: string, instant: number): Promise<IssueLink> {
  const issue = row.github_issue!;
  if (row.github_milestone_pending != null) {
    const receipt = milestoneReceipt(key, row.github_milestone_pending);
    const comments = await fetchComments(env, issue);
    if (!comments.ok || !Array.isArray(comments.data)
        || !comments.data.some((c: { body?: unknown }) => typeof c?.body === 'string' && c.body.split('\n').includes(receipt))) {
      return { state: 'count_delivery_uncertain', issue };
    }
    await env.DB.prepare(`UPDATE section_incident_outbox SET github_milestone = github_milestone_pending,
      github_milestone_pending = NULL WHERE episode_id = ? AND github_milestone_pending = ?`)
      .bind(row.episode_id, row.github_milestone_pending).run();
    return { state: 'count_posted', issue };
  }
  const bucket = countMilestone(row.occurrence_total);
  if (bucket <= (row.github_milestone ?? 0)) return { state: 'linked', issue };
  const claim = await env.DB.prepare(`UPDATE section_incident_outbox SET github_milestone_pending = ?
    WHERE episode_id = ? AND github_state = 'linked' AND github_milestone_pending IS NULL AND github_milestone < ?
    RETURNING episode_id`).bind(bucket, row.episode_id, bucket).first<{ episode_id: string }>();
  if (!claim) return { state: 'linked', issue };
  const result = await addComment(env, issue, milestoneComment(key, bucket), { retry: false });
  if (result.ok) {
    await env.DB.prepare(`UPDATE section_incident_outbox SET github_milestone = ?, github_milestone_pending = NULL,
      github_reason = NULL WHERE episode_id = ? AND github_milestone_pending = ?`).bind(bucket, row.episode_id, bucket).run();
    return { state: 'count_posted', issue };
  }
  const refused = rejection(result);
  if (refused) {
    await env.DB.prepare(`UPDATE section_incident_outbox SET github_milestone_pending = NULL, github_reason = ?,
      github_next_at = ? WHERE episode_id = ? AND github_milestone_pending = ?`)
      .bind(refused, instant + (refused === 'rate_limited' ? rateLimitDelay : rejectionDelay), row.episode_id, bucket).run();
    return { state: refused, issue };
  }
  return { state: 'count_delivery_uncertain', issue };
}

/**
 * An operator settles an unknown create: the named issue must be an issue, not
 * a pull request, and carry this episode's marker. Without that the intent
 * stays and filing stays blocked.
 */
export async function reconcileSectionIncidentIssue(env: Env, episodeId: string, issueNumber: number) {
  if (!sectionIssuesEnabled(env)) return 'unconfigured' as const;
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return 'mismatch' as const;
  const row = await readRow(env, episodeId);
  if (!row || row.github_state !== 'filing') return 'not_filing' as const;
  const repo = `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`;
  const key = await sha256Hex(issueKeyInput(repo, row.incident_case!, row.episode_id));
  const marker = issueDraft({ repo, caseId: row.incident_case!, key, count: 1, revision: null }).marker;
  const found = await fetchIssue(env, issueNumber);
  if (!found.ok) return 'unavailable' as const;
  const issue = found.data;
  if (!issue || issue.pull_request || issue.number !== issueNumber || typeof issue.body !== 'string'
      || !issue.body.split('\n').includes(marker)) return 'mismatch' as const;
  await env.DB.prepare(`UPDATE section_incident_outbox SET github_state = 'linked', github_issue = ?, github_reason = NULL
    WHERE episode_id = ? AND github_state = 'filing'`).bind(issueNumber, episodeId).run();
  return 'linked' as const;
}

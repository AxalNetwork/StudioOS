/**
 * D1319 (#3480, part 1 of #2400) — the core of founder publishing: who may,
 * what a destination's preview and check say, and the send's state machine.
 * `routes/publish.ts` is its only caller; each provider adapter plugs in
 * through `ProviderImpl`'s publish methods and its `PUBLISH_TARGETS` row.
 *
 * NOTHING IS EVER SENT AUTOMATICALLY. A send happens only inside `confirm`
 * or `retry`, which the founder presses in the confirm dialog. No AI, no
 * cron and no `push` reaches `publish`.
 *
 * THE STATE MACHINE (migration 642's header names each state):
 *   - a confirm with a key already used returns that row, and sends nothing;
 *   - the claim is ONE conditional UPDATE from `ready` (or `failed`, for a
 *     retry) to `sending`, with the daily cap counted inside it: a
 *     destination's sends today plus those `sending`, under its cap;
 *   - `publish` runs once. A provider "not created" (a 4xx; a 429 reads
 *     `rate_limited` with `retry_after`) is `failed`, retried only when the
 *     founder presses Retry; anything else is `unknown`;
 *   - `unknown` is never re-sent. Check looks for the post; Mark as not sent
 *     is the founder's word, after a dialog that warns it may post twice;
 *   - a row still `sending` 10 minutes after its claim becomes `unknown`
 *     (`releaseStrandedSends`, on read and in the cron), never `failed`.
 *
 * Logs keep codes and kinds only: never a post body, a token or a figure.
 */
import type { Env, User } from '../types';
import { getProviderImpl, PublishError, type IntegrationRow, type PublishInput, type PublishPreview } from '../integrations/registry';
import { publishTarget, PUBLISH_DAILY_CAP } from '../integrations/publishTargets';
import { projectEnabled } from '../integrations/companyScope';
import { publishLint, type PublishLintResult } from './publishLint';
import { isVentureFounder } from './ventureFounder';

export const STRANDED_MINUTES = 10;

export class PublishRefusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.name = 'PublishRefusal';
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

/** #2400's refusal codes, each with its status and our sentence. */
export const REFUSALS = Object.freeze({
  publish_not_allowed: [403, 'Only the venture’s founder publishes for it, through their own connection.'],
  support_session: [403, 'A support session cannot publish for a member.'],
  company_not_enabled: [409, 'This connection is not switched on for this company.'],
  destination_off: [409, 'Publishing to this place is off for this company. Turn it on first.'],
  content_changed: [409, 'What would be sent changed since the preview. Preview it again before you send.'],
  lint_blocked: [422, 'Remove the highlighted text before you send.'],
  not_publishable: [422, 'This place cannot take the post as it is. Fix the problems the preview lists.'],
  daily_cap_reached: [429, 'This place has reached its posts for today. Try again tomorrow.'],
  rate_limited: [429, 'The service asked us to wait before posting again.'],
  not_retractable: [409, 'This post cannot be deleted from Axal VC. Delete it on the service, then mark it as removed.'],
  outcome_unknown: [409, 'It is not known whether this arrived. Check the service before sending again.'],
  not_found: [404, 'That is not here, or not yours to see.'],
  invalid: [400, 'That request is not one publishing understands.'],
  wrong_state: [409, 'That is not something this post can do now.'],
  reconnect_to_retract: [409, 'Reconnect the service to delete this post from it.'],
  check_not_supported: [409, 'This service cannot be checked from Axal VC. Look for the post there.'],
} as const satisfies Record<string, readonly [number, string]>);
export type RefusalCode = keyof typeof REFUSALS;
export const refused = (code: RefusalCode) => new PublishRefusal(REFUSALS[code][0], code, REFUSALS[code][1]);

// ---------------------------------------------------------------------------
// Who may
// ---------------------------------------------------------------------------

/** Roles that never publish, whatever else they may edit (#2400 "Never allowed"). */
const NEVER = new Set(['admin', 'partner', 'advisor', 'investor']);

/**
 * May this member publish for this venture? Throws the refusal, in this order:
 * a support session; a role that never publishes, or anyone but the venture's
 * founder (#2400 decision A, (a): a co-founder is refused); a connection that
 * is not theirs; a company the connection is not switched on for; and, with
 * a destination, one that is off or belongs to another company.
 */
export async function canPublish(env: Env, ctx: {
  user: User; support: boolean; projectId: number;
  integration?: IntegrationRow | null;
  destination?: { company_id: number; enabled: number; integration_id: number } | null;
}): Promise<void> {
  if (ctx.support) throw refused('support_session');
  if (NEVER.has(String(ctx.user.role ?? '').toLowerCase())) throw refused('publish_not_allowed');
  if (!(await isVentureFounder(env, ctx.user, ctx.projectId))) throw refused('publish_not_allowed');
  if (ctx.integration === undefined) return;
  if (!ctx.integration || Number(ctx.integration.user_id) !== Number(ctx.user.id)) throw refused('publish_not_allowed');
  if (!(await projectEnabled(env, Number(ctx.integration.id), ctx.projectId))) throw refused('company_not_enabled');
  if (ctx.destination === undefined) return;
  const project = await env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(ctx.projectId).first<{ company_id: number | null }>();
  if (!ctx.destination || Number(ctx.destination.integration_id) !== Number(ctx.integration.id)
    || Number(ctx.destination.company_id) !== Number(project?.company_id) || Number(ctx.destination.enabled) !== 1) throw refused('destination_off');
}

// ---------------------------------------------------------------------------
// Drafts, previews and the envelope
// ---------------------------------------------------------------------------

export interface DraftRow {
  id: number; uid: string; project_id: number; company_id: number | null; module: string; source_refs_json: string;
  author_user_id: number; body_json: string; media_r2_keys: string; alt_texts: string; team_only_included: number;
  named_consent_json: string; status: string;
}
export interface DestinationRow {
  id: number; uid: string; integration_id: number; company_id: number; provider_key: string; external_account_id: string;
  display_name: string; audience_label: string | null; enabled: number; daily_cap: number | null;
}

const parse = <T>(raw: string | null | undefined, fallback: T): T => { try { const v = raw ? JSON.parse(raw) : fallback; return v ?? fallback; } catch { return fallback; } };
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The text the destination gets: its own edit, else the shared text. */
export function textFor(draft: DraftRow, destinationUid: string): string {
  const body = parse<{ text?: unknown; per_destination?: Record<string, unknown> }>(draft.body_json, {});
  const own = body.per_destination && typeof body.per_destination[destinationUid] === 'string' ? body.per_destination[destinationUid] as string : null;
  return own ?? (typeof body.text === 'string' ? body.text : '');
}

/** The team-only figures the draft quotes (part 2's builders mark them on `source_refs`). */
export function teamOnlyFigures(draft: DraftRow): string[] {
  return parse<Array<{ team_only?: unknown; text?: unknown }>>(draft.source_refs_json, [])
    .filter((r) => r && r.team_only === true && typeof r.text === 'string').map((r) => r.text as string);
}

/** JSON with its keys sorted, at every depth: the hash input is the same for the same envelope. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export async function envelopeHash(envelope: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(envelope)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DestinationPreview {
  destination_uid: string;
  provider_key: string;
  account: string;
  audience: string | null;
  retract: string;
  preview: PublishPreview | null;
  problems: string[];
  lint: PublishLintResult;
  envelope: { input: PublishInput; preview: PublishPreview } | null;
  envelope_hash: string | null;
  sendable: boolean;
}

/**
 * One destination's preview and check, built as `publish` will send it: the
 * adapter's `publishPreview` on the draft's final text, then `publishLint` on
 * that text and every alt text. A provider with no row, or a row whose text
 * limit is not confirmed, refuses to preview.
 */
export async function previewFor(env: Env, draft: DraftRow, dest: DestinationRow, integration: IntegrationRow): Promise<DestinationPreview> {
  const target = publishTarget(dest.provider_key);
  const impl = getProviderImpl(dest.provider_key);
  const input: PublishInput = {
    text: textFor(draft, dest.uid),
    media_r2_keys: strings(parse(draft.media_r2_keys, [])),
    alt_texts: strings(parse(draft.alt_texts, [])),
    destination: { external_account_id: dest.external_account_id, display_name: dest.display_name, audience_label: dest.audience_label },
  };
  const lint = await publishLint(env, [input.text, ...input.alt_texts].join('\n'), {
    teamOnly: teamOnlyFigures(draft), teamOnlyIncluded: Number(draft.team_only_included) === 1,
    namedConsent: parse<unknown[]>(draft.named_consent_json, []).map(Number).filter(Number.isSafeInteger),
  });
  const base = { destination_uid: dest.uid, provider_key: dest.provider_key, account: dest.display_name, audience: dest.audience_label ?? target?.audience ?? null, retract: target?.retract ?? 'unknown', lint };
  const problems: string[] = [];
  if (!target || !impl?.publishPreview || !impl.publish) problems.push('This service does not publish from Axal VC yet.');
  else if (target.text_limit == null) problems.push('This service’s limits are not confirmed yet, so it cannot be previewed.');
  if (problems.length) return { ...base, preview: null, problems, envelope: null, envelope_hash: null, sendable: false };
  const preview = await impl!.publishPreview!(env, integration, input);
  const envelope = { input, preview };
  const allProblems = [...preview.problems];
  return { ...base, preview, problems: allProblems, envelope, envelope_hash: await envelopeHash(envelope), sendable: allProblems.length === 0 && lint.ok };
}

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

export interface SendRow {
  id: number; uid: string; draft_id: number; destination_id: number | null; project_id: number; module: string; provider_key: string;
  destination_label: string; audience_label: string | null; idempotency_key: string; envelope_json: string; envelope_hash: string;
  lint_kinds_json: string; status: string; confirmed_by: number; confirmed_at: string; claimed_at: string | null; sent_at: string | null;
  external_post_id: string | null; external_url: string | null; error_code: string | null; retry_after: string | null; attempts: number;
  retracted_at: string | null; retracted_by: number | null; retraction_reason: string | null; retract_error: string | null;
}

/** A send as the routes answer it; the post's text only for the venture's team. */
export function sendView(row: SendRow, withBody: boolean) {
  const target = publishTarget(row.provider_key);
  const envelope = parse<{ input?: PublishInput }>(row.envelope_json, {});
  return {
    uid: row.uid, module: row.module, provider_key: row.provider_key, destination: row.destination_label, audience: row.audience_label,
    status: row.status, confirmed_by: row.confirmed_by, confirmed_at: row.confirmed_at, sent_at: row.sent_at,
    external_post_id: row.external_post_id, external_url: row.external_url, error_code: row.error_code, retry_after: row.retry_after,
    attempts: row.attempts, retracted_at: row.retracted_at, retraction_reason: row.retraction_reason, retract_error: row.retract_error,
    retract: target?.retract ?? 'unknown', lint_kinds: parse<string[]>(row.lint_kinds_json, []),
    text: withBody ? envelope.input?.text ?? null : null,
  };
}

const loadSend = (env: Env, id: number) => env.DB.prepare('SELECT * FROM publish_sends WHERE id = ?').bind(id).first<SendRow>();

/** A row left `sending` for STRANDED_MINUTES is `unknown`: not known whether it arrived, and never re-sent. */
export async function releaseStrandedSends(env: Env, projectId: number | null = null): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE publish_sends SET status = 'unknown', error_code = 'outcome_unknown', updated_at = datetime('now')
      WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < datetime('now', ?)) AND (? IS NULL OR project_id = ?)`,
  ).bind(`-${STRANDED_MINUTES} minutes`, projectId, projectId).run();
  return Number(res.meta?.changes ?? 0);
}

async function audit(env: Env, row: { project_id: number; uid: string }, userId: number, action: string, kinds: string[] = []) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (project_id, user_id, actor, action, details, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, 'publish_send', ?)`,
  ).bind(row.project_id, userId, `user:${userId}`, action, kinds.length ? `kinds: ${kinds.join(', ')}` : null, row.uid).run().catch(() => {});
}
async function logOutbound(env: Env, integration: IntegrationRow, userId: number, status: 'ok' | 'error', code: string, externalId: string | null, httpStatus: number | null) {
  // Codes only: no body, no token, no figure.
  await env.DB.prepare(
    `INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, http_status, request_summary, response_summary, external_id, payload_json)
     VALUES (?, ?, ?, 'outbound', 'publish', ?, ?, 'publish', ?, ?, NULL)`,
  ).bind(integration.id, userId, integration.provider_key, status, httpStatus, code, externalId).run().catch(() => {});
}

/**
 * Claim the row from `from` to `sending` with the cap counted in the same
 * statement, then publish once and settle. Returns the row as it ended. A
 * claim that changed nothing means another press already holds the row (it
 * is answered as it is) or the cap is reached (refused, the row unchanged).
 */
async function claimAndSend(env: Env, row: SendRow, from: 'ready' | 'failed', dest: DestinationRow, integration: IntegrationRow, userId: number): Promise<SendRow> {
  const cap = Math.min(PUBLISH_DAILY_CAP, dest.daily_cap ?? PUBLISH_DAILY_CAP);
  const claim = await env.DB.prepare(
    `UPDATE publish_sends SET status = 'sending', claimed_at = datetime('now'), attempts = attempts + 1, error_code = NULL, retry_after = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = ?
        AND (SELECT COUNT(*) FROM publish_sends s WHERE s.destination_id = ?
              AND (s.status = 'sending' OR (s.sent_at IS NOT NULL AND s.sent_at >= datetime('now', 'start of day')))) < ?`,
  ).bind(row.id, from, dest.id, cap).run();
  if (!Number(claim.meta?.changes ?? 0)) {
    const now = (await loadSend(env, row.id))!;
    if (now.status !== from) return now;
    // Refused before the request: the row keeps its state, with the reason.
    await env.DB.prepare(`UPDATE publish_sends SET error_code = 'daily_cap_reached', updated_at = datetime('now') WHERE id = ? AND status = ?`).bind(row.id, from).run();
    throw refused('daily_cap_reached');
  }
  const envelope = parse<{ input: PublishInput; preview: PublishPreview }>(row.envelope_json, null as never);
  const impl = getProviderImpl(dest.provider_key);
  try {
    if (!impl?.publish) throw new PublishError('not_created', 'not_publishable');
    const result = await impl.publish(env, integration, envelope, { idempotencyKey: row.idempotency_key });
    try {
      await env.DB.prepare(
        `UPDATE publish_sends SET status = 'sent', sent_at = datetime('now'), external_post_id = ?, external_url = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'sending'`,
      ).bind(String(result.external_post_id).slice(0, 200), result.external_url ? String(result.external_url).slice(0, 500) : null, row.id).run();
    } catch {
      // The provider said yes and the record failed: the row stays `sending`
      // and becomes `unknown` when stranded. Never `failed`: that could post twice.
      console.warn('[publish] sent but not recorded', dest.provider_key);
      return (await loadSend(env, row.id).catch(() => null)) ?? { ...row, status: 'sending' };
    }
    await logOutbound(env, integration, userId, 'ok', 'sent', String(result.external_post_id), null);
    await audit(env, row, userId, 'publish_sent');
  } catch (e) {
    const known = e instanceof PublishError && e.kind === 'not_created';
    const code = known ? (e.httpStatus === 429 || e.code === 'rate_limited' ? 'rate_limited' : e.code) : 'outcome_unknown';
    const retryAfter = known ? (e as PublishError).retryAfter : null;
    await env.DB.prepare(
      `UPDATE publish_sends SET status = ?, error_code = ?, retry_after = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sending'`,
    ).bind(known ? 'failed' : 'unknown', String(code).slice(0, 60), retryAfter, row.id).run();
    await logOutbound(env, integration, userId, 'error', String(code).slice(0, 60), null, e instanceof PublishError ? e.httpStatus : null);
    await audit(env, row, userId, known ? 'publish_failed' : 'publish_unknown');
  }
  return (await loadSend(env, row.id))!;
}

/**
 * The founder's confirm for one destination. A key already used returns that
 * row and sends nothing. Otherwise every check runs again on a fresh preview,
 * and the hash must be the one the founder saw.
 */
export async function confirmSend(env: Env, ctx: { user: User; support: boolean }, draft: DraftRow, dest: DestinationRow, integration: IntegrationRow,
  input: { envelope_hash: unknown; idempotency_key: unknown }): Promise<{ row: SendRow; repeated: boolean }> {
  const key = typeof input.idempotency_key === 'string' ? input.idempotency_key.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key) || typeof input.envelope_hash !== 'string') throw refused('invalid');
  const existing = await env.DB.prepare('SELECT * FROM publish_sends WHERE draft_id = ? AND destination_id = ? AND idempotency_key = ?')
    .bind(draft.id, dest.id, key).first<SendRow>();
  if (existing) return { row: existing, repeated: true };
  await canPublish(env, { user: ctx.user, support: ctx.support, projectId: draft.project_id, integration, destination: dest });
  if (draft.status !== 'draft') throw refused('wrong_state');
  const p = await previewFor(env, draft, dest, integration);
  if (!p.envelope || p.problems.length) throw refused('not_publishable');
  if (!p.lint.ok) throw refused('lint_blocked');
  if (p.envelope_hash !== input.envelope_hash) throw refused('content_changed');
  await env.DB.prepare(
    `INSERT INTO publish_sends (uid, draft_id, destination_id, project_id, module, provider_key, destination_label, audience_label, idempotency_key,
                                envelope_json, envelope_hash, lint_kinds_json, confirmed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
     ON CONFLICT (draft_id, destination_id, idempotency_key) DO NOTHING`,
  ).bind(crypto.randomUUID(), draft.id, dest.id, draft.project_id, draft.module, dest.provider_key, dest.display_name, p.audience,
    key, JSON.stringify(p.envelope), p.envelope_hash, ctx.user.id).run();
  const row = (await env.DB.prepare('SELECT * FROM publish_sends WHERE draft_id = ? AND destination_id = ? AND idempotency_key = ?')
    .bind(draft.id, dest.id, key).first<SendRow>())!;
  if (row.status !== 'ready') return { row, repeated: true };
  await audit(env, row, ctx.user.id, 'publish_confirmed');
  return { row: await claimAndSend(env, row, 'ready', dest, integration, ctx.user.id), repeated: false };
}

/**
 * Retry, pressed by the founder: a `failed` send, or a `ready` one refused
 * before its request (the cap), on the same row, re-checked, with the same
 * content. Never an `unknown` one.
 */
export async function retrySend(env: Env, ctx: { user: User; support: boolean }, row: SendRow, draft: DraftRow, dest: DestinationRow, integration: IntegrationRow): Promise<SendRow> {
  if (row.status === 'unknown' || row.status === 'sending') throw refused('outcome_unknown');
  if (row.status !== 'failed' && row.status !== 'ready') throw refused('wrong_state');
  await canPublish(env, { user: ctx.user, support: ctx.support, projectId: row.project_id, integration, destination: dest });
  const p = await previewFor(env, draft, dest, integration);
  if (!p.envelope || p.problems.length) throw refused('not_publishable');
  if (!p.lint.ok) throw refused('lint_blocked');
  if (p.envelope_hash !== row.envelope_hash) throw refused('content_changed');
  await audit(env, row, ctx.user.id, 'publish_retried');
  return claimAndSend(env, row, row.status as 'ready' | 'failed', dest, integration, ctx.user.id);
}

/** Check: look for the post whose outcome is not known. Found is `sent`; not found stays `unknown`. */
export async function checkSend(env: Env, row: SendRow, integration: IntegrationRow, userId: number): Promise<{ row: SendRow; found: boolean }> {
  if (row.status !== 'unknown') throw refused('wrong_state');
  const impl = getProviderImpl(row.provider_key);
  if (!impl?.findPublished) throw refused('check_not_supported');
  const found = await impl.findPublished(env, integration, parse(row.envelope_json, null as never));
  if (!found) return { row, found: false };
  await env.DB.prepare(
    `UPDATE publish_sends SET status = 'sent', sent_at = COALESCE(sent_at, datetime('now')), external_post_id = ?, external_url = ?, error_code = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'unknown'`,
  ).bind(String(found.external_post_id).slice(0, 200), found.external_url ? String(found.external_url).slice(0, 500) : null, row.id).run();
  await audit(env, row, userId, 'publish_found');
  return { row: (await loadSend(env, row.id))!, found: true };
}

/** Mark as not sent: the founder's word on an `unknown` row, after the dialog that warns it may post twice. */
export async function markNotSent(env: Env, row: SendRow, userId: number): Promise<SendRow> {
  if (row.status !== 'unknown') throw refused('wrong_state');
  await env.DB.prepare(`UPDATE publish_sends SET status = 'failed', error_code = 'marked_not_sent', updated_at = datetime('now') WHERE id = ? AND status = 'unknown'`).bind(row.id).run();
  await audit(env, row, userId, 'publish_marked_not_sent');
  return (await loadSend(env, row.id))!;
}

/** Retract: delete the post at the provider where it can. A failed delete leaves it `sent`, with the code. */
export async function retractSend(env: Env, row: SendRow, integration: IntegrationRow | null, userId: number, reason: unknown): Promise<SendRow> {
  if (row.status !== 'sent') throw refused('wrong_state');
  const target = publishTarget(row.provider_key);
  const impl = getProviderImpl(row.provider_key);
  if (target?.retract !== 'delete' || !impl?.retract) throw refused('not_retractable');
  if (!integration || !row.external_post_id) throw refused('reconnect_to_retract');
  const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  try {
    await impl.retract(env, integration, row.external_post_id);
  } catch (e) {
    const code = e instanceof PublishError ? e.code : 'retract_failed';
    await env.DB.prepare(`UPDATE publish_sends SET retract_error = ?, updated_at = datetime('now') WHERE id = ?`).bind(String(code).slice(0, 60), row.id).run();
    await logOutbound(env, integration, userId, 'error', `retract:${String(code).slice(0, 50)}`, row.external_post_id, e instanceof PublishError ? e.httpStatus : null);
    return (await loadSend(env, row.id))!;
  }
  await env.DB.prepare(
    `UPDATE publish_sends SET status = 'retracted', retracted_at = datetime('now'), retracted_by = ?, retraction_reason = ?, retract_error = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'sent'`,
  ).bind(userId, why || null, row.id).run();
  await logOutbound(env, integration, userId, 'ok', 'retracted', row.external_post_id, null);
  await audit(env, row, userId, 'publish_retracted');
  return (await loadSend(env, row.id))!;
}

/** Mark as removed: the founder deleted it on the service and says so. */
export async function markRemoved(env: Env, row: SendRow, userId: number): Promise<SendRow> {
  if (row.status !== 'sent') throw refused('wrong_state');
  await env.DB.prepare(`UPDATE publish_sends SET status = 'removed_outside', retracted_at = datetime('now'), retracted_by = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sent'`).bind(userId, row.id).run();
  await audit(env, row, userId, 'publish_marked_removed');
  return (await loadSend(env, row.id))!;
}

/**
 * D5153 (#5153): the meeting bot's runtime startup, as closed vocabularies.
 *
 * A Record a Session run has two lifecycles. The public one (`queued →
 * joining → waiting_room → recording → processing → done`) is the member's.
 * This one is the operator's: how far the container host got before the
 * runtime accepted the signed start command. A run enters `joining` only
 * after `runtime_command_accepted`, so `joining` never means "the container
 * is starting".
 *
 * Only these codes and stages cross the container host → site Worker → D1
 * boundary. Anything else (an older host's reply, an exception string) maps
 * to `null` code / the generic member-facing `runtime_unavailable`, never to
 * free text. No meeting link, provider page text, participant, transcript,
 * secret or signature is ever part of a startup fact.
 */

export const RUNTIME_STAGES = [
  'dispatch_accepted',
  'container_binding_resolved',
  'image_resolved',
  'container_starting',
  'runtime_port_waiting',
  'runtime_health_ready',
  'runtime_command_accepted',
  'provider_starting',
] as const;
export type MeetingBotRuntimeStage = typeof RUNTIME_STAGES[number];

export const RUNTIME_ERROR_CODES = [
  'binding_missing',
  'image_unavailable',
  'container_start_failed',
  'runtime_no_answer',
  'runtime_process_exited',
  'runtime_health_failed',
  'runtime_refused',
  'runtime_command_timeout',
  'runtime_lost',
] as const;
export type RuntimeErrorCode = typeof RUNTIME_ERROR_CODES[number];

const STAGE_SET: ReadonlySet<string> = new Set(RUNTIME_STAGES);
const CODE_SET: ReadonlySet<string> = new Set(RUNTIME_ERROR_CODES);
export const runtimeStage = (v: unknown): MeetingBotRuntimeStage | null => typeof v === 'string' && STAGE_SET.has(v) ? v as MeetingBotRuntimeStage : null;
export const runtimeErrorCode = (v: unknown): RuntimeErrorCode | null => typeof v === 'string' && CODE_SET.has(v) ? v as RuntimeErrorCode : null;
/** The deployed commit, as `MEETING_BOT_VERSION` carries it; anything else is not a version. */
export const runtimeVersion = (v: unknown): string | null => typeof v === 'string' && /^[a-f0-9]{7,40}$/.test(v) ? v : null;

/**
 * Time budgets for one start, outermost last. The host waits for the runtime's
 * port and health, then for the signed command; the site Worker's transport
 * and the run's own deadline each leave room for the layer inside them to
 * answer with a code instead of being cut off.
 *
 * Session 54 (2026-11-09) spent ~25 s and never reached the runtime: the old
 * host gave a cold image 20 s for port 8080 and the run 25 s in all. A cold
 * standard-2 instance with Chromium and the Zoom SDK needs longer, so the
 * port/health wait is 40 s. `runtime_start_ms` on each run is the measurement
 * to tune these against.
 */
export const HOST_READY_MS = 40_000;
export const HOST_COMMAND_MS = 10_000;
export const TRANSPORT_START_MS = HOST_READY_MS + HOST_COMMAND_MS + 3_000;
export const RUN_START_MS = TRANSPORT_START_MS + 2_000;

/** The host's answer to `/start`: a code and a stage, never a reason in words. */
export interface StartupReply { ok: boolean; code: string; stage: MeetingBotRuntimeStage | null; runtime_version: string | null; start_ms?: number | null }

export interface RuntimeStartResult { stage: 'runtime_command_accepted'; runtime_version: string | null }

/** A start that stopped at a known boundary. `code` is always from the closed vocabulary. */
export class MeetingBotRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly stage: MeetingBotRuntimeStage | null;
  readonly runtimeVersion: string | null;
  constructor(code: RuntimeErrorCode, stage: MeetingBotRuntimeStage | null, runtimeVersion: string | null = null) {
    // The message is the code: nothing else can leak through `String(e)`.
    super(code);
    this.name = 'MeetingBotRuntimeError';
    this.code = code; this.stage = stage; this.runtimeVersion = runtimeVersion;
  }
}

/**
 * Reads the host's `/start` reply. A current host sends `{ok, code, stage,
 * runtime_version}`. An older host sends only `{code}` (`started`,
 * `runtime_unavailable`, `image_unavailable`, …): its known codes keep their
 * meaning and everything else is a plain failure with no startup code, so a
 * mixed deployment never crashes the control plane.
 */
export function readStartupReply(status: number, body: unknown): RuntimeStartResult | MeetingBotRuntimeError | null {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const version = runtimeVersion(b.runtime_version);
  if (status >= 200 && status < 300) return { stage: 'runtime_command_accepted', runtime_version: version };
  const code = runtimeErrorCode(b.code);
  if (code) return new MeetingBotRuntimeError(code, runtimeStage(b.stage) ?? DEFAULT_STAGE[code], version);
  // An older host's own name for "the binding has no container".
  if (b.code === 'container_unavailable') return new MeetingBotRuntimeError('container_start_failed', 'container_starting', version);
  return null;
}

/** Where each code stops when an older host sends no stage. */
const DEFAULT_STAGE: Record<RuntimeErrorCode, MeetingBotRuntimeStage> = {
  binding_missing: 'container_binding_resolved',
  image_unavailable: 'image_resolved',
  container_start_failed: 'container_starting',
  runtime_no_answer: 'runtime_port_waiting',
  runtime_process_exited: 'runtime_port_waiting',
  runtime_health_failed: 'runtime_health_ready',
  runtime_refused: 'runtime_command_accepted',
  runtime_command_timeout: 'runtime_command_accepted',
  runtime_lost: 'runtime_command_accepted',
};

/** HQ's next step for each code. Operator copy; never shown to a member. */
export const RUNTIME_ACTION: Record<RuntimeErrorCode, string> = {
  binding_missing: 'The site Worker has no MEETING_BOT_CONTAINER binding. Bind it to the meeting-bot Worker and redeploy.',
  image_unavailable: 'The container has no runtime image. Redeploy the meeting-bot Worker so its image is published.',
  container_start_failed: 'The container did not start. Check the meeting-bot Worker’s container instances and limits, then run the staged diagnostic.',
  runtime_no_answer: 'The container started but the runtime never opened port 8080 in time. Run the staged diagnostic and read this run’s container logs.',
  runtime_process_exited: 'The runtime process exited while booting. Read this run’s container logs, then redeploy the meeting-bot Worker.',
  runtime_health_failed: 'The runtime answered but was not ready, or runs a different version than its host. Redeploy the meeting-bot Worker.',
  runtime_refused: 'The runtime refused the signed start command. Check that MEETING_BOT_SECRET and the published notice match on both Workers.',
  runtime_command_timeout: 'The runtime was healthy but did not answer the start command in time. Run the staged diagnostic.',
  runtime_lost: 'The runtime was lost after it started. Read this run’s container logs.',
};

/**
 * The member-facing category of a failed run. `infrastructure` means the
 * runtime never reported back, so the meeting provider was never contacted
 * and provider causes ("the link changed", "outside participants are
 * blocked") must not be suggested. Null when the run did not fail, when it
 * failed after the runtime reported, or when the row predates D5153 (no
 * column to tell).
 */
export function botFailureCategory(run: { status: string; failure_code: string | null } & Record<string, unknown>): 'infrastructure' | null {
  if (run.status !== 'failed' || !('runtime_callback_seen_at' in run)) return null;
  if (run.runtime_callback_seen_at !== null && run.runtime_callback_seen_at !== undefined) return null;
  return run.failure_code === 'runtime_unavailable' || run.failure_code === 'heartbeat_timeout' || runtimeErrorCode(run.runtime_error_code) ? 'infrastructure' : null;
}

/** One structured line per startup transition; only these fields, never a link, name, header or signature. */
export function logRuntimeStage(fields: { run_uid: string; platform: string | null; stage: MeetingBotRuntimeStage; runtime_version: string | null; elapsed_ms: number; result: 'ok' | 'fail'; error_code: RuntimeErrorCode | null }) {
  try { console.log(JSON.stringify({ event: 'meeting_bot.runtime_stage', ...fields })); } catch { /* logging never fails a run */ }
}

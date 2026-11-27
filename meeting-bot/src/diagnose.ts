/**
 * #3708: the owner's staged diagnostic, inside the container.
 *
 * One probe against a Meet the owner hosts, in order. Each stage reports
 * pass or fail with a code, never page text, a name, a link or audio:
 * - `container`: this process received the signed command;
 * - `browser`: Chromium launches;
 * - `egress`: the container reaches Google's hosts (or Zoom's);
 * - `join`: where the Meet page stops (Eadwyn's own sign-in, D3678; a sign-in
 *   wall, refusal, lobby, in the call);
 * - `admission`: waiting for the host, then admitted or not;
 * - `audio`: frames arrive, and one silent probe chunk of the same length uploads.
 *
 * A screenshot of the stopping point goes to the Worker, which keeps it for
 * the owner only. The probe chunk is zeros: it proves the upload path without
 * carrying what was said.
 *
 * Running a stage and telling the Worker about it are two facts (#4857). Every
 * stage the bot has finished sits in a ledger with its own `delivered` flag; a
 * report is the whole ledger so far (a cumulative snapshot with the diagnosis
 * id, a revision and each stage's event revision), so a report that fails is
 * simply carried by the next one, and the Worker merges by (diagnosis, stage,
 * event revision) and can take a snapshot twice or out of order. A failed send
 * is retried a bounded number of times with backoff on the injected clock; it
 * never reruns the stage's action.
 *
 * Zoom joins through the native SDK with a run's own credentials, so Zoom's
 * container stages stop at egress; the Worker checks Zoom's credentials and
 * reads the last Zoom run instead.
 */
import { encodeWav } from './wav.ts';
import { BOT_NAME } from './constants.ts';
import { signRequest } from './callback.ts';
import { AdapterFailure } from './types.ts';
import type { AudioFrame, Clock, LogSink, MeetingAdapter, Platform } from './types.ts';

export type DiagnoseStage = 'container' | 'browser' | 'egress' | 'join' | 'admission' | 'audio';
export type DiagnoseResult = 'pass' | 'fail' | 'skipped' | 'running';
export type DiagnoseFact = string | number | boolean;
export interface DiagnoseReport {
  readonly stage: DiagnoseStage;
  readonly result: DiagnoseResult;
  /** A lowercase code; for `join`, where the page stopped. */
  readonly code: string;
  readonly facts?: Readonly<Record<string, DiagnoseFact>>;
}
/** A stage's result with its stable identity: `rev` orders this stage's events, `at` is when it ran, `attempts` how many sends of it failed first. */
export interface DiagnoseEvent extends DiagnoseReport {
  readonly rev: number;
  readonly at: number;
  readonly attempts: number;
}
/** What one callback carries: every stage run so far, so no earlier callback is needed. */
export interface DiagnoseSnapshot {
  readonly diagnosis_id: string;
  readonly revision: number;
  readonly events: readonly DiagnoseEvent[];
}
/** The page of the stopping point: a screenshot and an address read for its host only. */
export interface DiagnosePage { screenshot(): Promise<Uint8Array>; url(): string }
export interface DiagnoseMeet extends MeetingAdapter { diagnostic(): string | null }
export interface DiagnoseDeps {
  readonly launch: () => Promise<{ page: DiagnosePage; meet: DiagnoseMeet; close(): Promise<void> }>;
  readonly fetch: typeof fetch;
  /** The Worker's acknowledgement is this promise resolving; a rejection means the snapshot may not have arrived. */
  readonly report: (snapshot: DiagnoseSnapshot) => Promise<void>;
  readonly diagnosisId: string;
  readonly screenshot: (png: Uint8Array) => Promise<void>;
  readonly probe: (wav: Uint8Array) => Promise<void>;
  readonly clock: Clock;
  readonly log?: LogSink;
  readonly stop?: AbortSignal;
  /** How long the host has to admit the bot, and how long frames may take after. */
  readonly admitMs?: number;
  readonly audioMs?: number;
}

export const DIAGNOSE_ADMIT_MS = 3 * 60_000;
export const DIAGNOSE_AUDIO_MS = 20_000;
export const EGRESS_HOSTS: Record<Platform, readonly string[]> = {
  google_meet: ['meet.google.com', 'accounts.google.com'],
  zoom: ['zoom.us', 'api.zoom.us'],
  teams: ['teams.microsoft.com', 'login.microsoftonline.com'],
};
const CODE = /^[a-z0-9_]{1,40}$/;
const code = (value: unknown, fallback: string) => (typeof value === 'string' && CODE.test(value) ? value : fallback);
export const DIAGNOSE_STAGES: readonly DiagnoseStage[] = ['container', 'browser', 'egress', 'join', 'admission', 'audio'];
const STAGES = DIAGNOSE_STAGES;
/** Sends per report while the check runs (short, so a dead callback never stalls it) and in the last flush after it. */
export const REPORT_TRIES = 2;
export const FINAL_REPORT_TRIES = 6;
/** Backoff after the n-th failed send: 0.5 s, 1 s, 2 s … capped at 8 s. */
export const reportBackoffMs = (failed: number) => Math.min(500 * 2 ** failed, 8000);
/** The stages whose result the Worker has not acknowledged. */
export interface DiagnoseOutcome { readonly undelivered: readonly DiagnoseStage[] }

/** Where the Meet page stopped: D1368's step, D1373's page kind, or the adapter's refusal. */
export function joinStop(error: unknown, step: string | null): string {
  // D3678: the signed-in join's own codes (`meet/signin.ts`).
  if (error instanceof AdapterFailure && error.detail?.startsWith('signin_')) return error.detail;
  if (step === 'meet_page_signin') return 'signin_wall';
  if (step?.startsWith('meet_page_')) return `page_${step.slice('meet_page_'.length)}`;
  // D1374: Meet's own "You can't join this video call".
  if (step?.endsWith(':platform_blocked')) return 'cannot_join';
  if (error instanceof AdapterFailure && error.code !== 'platform_blocked') return error.code;
  if (step === 'meet_navigation_started') return 'navigation_failed';
  if (step === 'meet_join_click_started') return 'join_button_failed';
  // Asked to join, and the page showed neither the lobby, the call nor a refusal.
  if (step?.startsWith('meet_join_result:')) return 'join_click_unanswered';
  return 'page_unread';
}

async function reach(doFetch: typeof fetch, host: string): Promise<DiagnoseFact> {
  try {
    const res = await doFetch(`https://${host}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return res.status;
  } catch (e) {
    return e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'unreachable';
  }
}

export async function runDiagnosis(platform: Platform, meetingUrl: string, deps: DiagnoseDeps): Promise<DiagnoseOutcome> {
  // "Ran" is a ledger entry; "delivered" is the Worker's acknowledgement of it. Neither implies the other.
  const ledger = new Map<DiagnoseStage, { event: DiagnoseReport & { rev: number; at: number }; delivered: boolean; failed: number }>();
  let revision = 0;
  const snapshot = (): DiagnoseSnapshot => ({ diagnosis_id: deps.diagnosisId, revision,
    events: STAGES.flatMap((stage) => { const l = ledger.get(stage); return l ? [{ ...l.event, attempts: l.failed }] : []; }) });
  const deliver = async (tries: number) => {
    for (let n = 0; n < tries; n += 1) {
      const sent = snapshot();
      try {
        await deps.report(sent);
        for (const e of sent.events) { const l = ledger.get(e.stage); if (l?.event.rev === e.rev) l.delivered = true; }
        return;
      } catch {
        for (const e of sent.events) { const l = ledger.get(e.stage); if (l && !l.delivered && l.event.rev === e.rev) l.failed += 1; }
        if (n + 1 < tries) await deps.clock.sleep(reportBackoffMs(n));
      }
    }
  };
  const say = async (r: DiagnoseReport) => {
    revision += 1;
    ledger.set(r.stage, { event: { ...r, rev: revision, at: deps.clock.now() }, delivered: false, failed: 0 });
    await deliver(REPORT_TRIES);
  };
  const ran = (stage: DiagnoseStage) => { const l = ledger.get(stage); return !!l && l.event.result !== 'running'; };
  const skipRest = async (why: string) => {
    for (const stage of STAGES) if (!ran(stage)) await say({ stage, result: 'skipped', code: why });
  };
  try {
    await execute(say, skipRest);
  } finally {
    // What the check could not tell the Worker while it ran, it tells now: the whole ledger, retried with backoff.
    const pending = () => STAGES.filter((s) => ledger.has(s) && !ledger.get(s)!.delivered);
    if (pending().length) await deliver(FINAL_REPORT_TRIES);
    if (pending().length) deps.log?.('diagnose_delivery_failed', { undelivered: pending().length });
  }
  return { undelivered: STAGES.filter((s) => ledger.has(s) && !ledger.get(s)!.delivered) };

  async function execute(say: (r: DiagnoseReport) => Promise<void>, skipRest: (why: string) => Promise<void>): Promise<void> {
  await say({ stage: 'container', result: 'pass', code: 'command_received' });

  // Egress first for Zoom (no browser); for Meet the browser needs the hosts anyway.
  const hosts = EGRESS_HOSTS[platform];
  const reached: Record<string, DiagnoseFact> = {};
  for (const host of hosts) reached[host] = await reach(deps.fetch, host);
  const egressOk = Object.values(reached).every((v) => typeof v === 'number');
  if (platform !== 'google_meet') {
    await say({ stage: 'browser', result: 'skipped', code: 'not_used_by_platform' });
    await say({ stage: 'egress', result: egressOk ? 'pass' : 'fail', code: egressOk ? 'hosts_reached' : 'host_unreachable', facts: reached });
    return skipRest('zoom_joins_with_run_credentials');
  }

  let session: Awaited<ReturnType<DiagnoseDeps['launch']>>;
  try {
    session = await deps.launch();
  } catch (e) {
    // Playwright's error kind (timeouterror, ...) when it has one; never its message.
    const kind = code((e as Error)?.name?.toLowerCase(), 'error');
    await say({ stage: 'browser', result: 'fail', code: 'launch_failed', ...(kind === 'error' ? {} : { facts: { error: kind } }) });
    await say({ stage: 'egress', result: egressOk ? 'pass' : 'fail', code: egressOk ? 'hosts_reached' : 'host_unreachable', facts: reached });
    return skipRest('browser_failed');
  }
  const { page, meet } = session;
  let shot = false;
  const capture = async () => {
    if (shot) return;
    shot = true;
    try { await deps.screenshot(await page.screenshot()); } catch { /* the table still says where it stopped */ }
  };
  try {
    await say({ stage: 'browser', result: 'pass', code: 'launched' });
    await say({ stage: 'egress', result: egressOk ? 'pass' : 'fail', code: egressOk ? 'hosts_reached' : 'host_unreachable', facts: reached });
    if (!egressOk) { await capture(); return await skipRest('egress_failed'); }

    const stop = deps.stop ?? new AbortController().signal;
    let landed: 'lobby' | 'in_call';
    try {
      await meet.join({ url: meetingUrl, botName: BOT_NAME, signal: stop });
      landed = meet.diagnostic() === 'meet_join_result:in_call' ? 'in_call' : 'lobby';
    } catch (e) {
      const step = meet.diagnostic();
      await capture();
      await say({ stage: 'join', result: 'fail', code: joinStop(e, step), facts: step ? { step } : {} });
      return await skipRest('join_failed');
    }
    await say({ stage: 'join', result: 'pass', code: landed === 'in_call' ? 'admitted_directly' : 'asked_to_join' });

    if (landed === 'lobby') {
      await say({ stage: 'admission', result: 'running', code: 'waiting_for_admission' });
      const wait = new AbortController();
      const cancel = deps.clock.setTimeout(() => wait.abort(), deps.admitMs ?? DIAGNOSE_ADMIT_MS);
      try {
        await meet.admitted(AbortSignal.any([wait.signal, stop]));
      } catch (e) {
        await capture();
        await say({ stage: 'admission', result: 'fail', code: wait.signal.aborted ? 'admission_timed_out' : e instanceof AdapterFailure ? e.code : 'admission_unread' });
        return await skipRest('not_admitted');
      } finally { cancel(); }
    }
    await say({ stage: 'admission', result: 'pass', code: landed === 'lobby' ? 'admitted' : 'admitted_directly' });

    let frames = 0, samples = 0;
    const off = meet.audio((f: AudioFrame) => { frames += 1; samples += f.samples.length; });
    const until = deps.clock.now() + (deps.audioMs ?? DIAGNOSE_AUDIO_MS);
    while (frames === 0 && deps.clock.now() < until && !stop.aborted) await deps.clock.sleep(250);
    // One more second of frames, so the probe has a length worth uploading.
    if (frames) await deps.clock.sleep(1000);
    off();
    await capture();
    if (!frames) { await say({ stage: 'audio', result: 'fail', code: 'no_frames' }); return; }
    const silent = encodeWav(new Int16Array(Math.min(samples, 16_000)));
    try {
      await deps.probe(silent);
      await say({ stage: 'audio', result: 'pass', code: 'chunk_uploaded', facts: { frames, uploaded_bytes: silent.byteLength } });
    } catch {
      await say({ stage: 'audio', result: 'fail', code: 'upload_failed', facts: { frames } });
    }
  } finally {
    try { await meet.leave(); } catch { /* the browser closes below */ }
    try { await session.close(); } catch { /* the container ends with its lease */ }
  }
  }
}

/** The Worker's three diagnostic callbacks, each signed like B2's events, with the run's own key. */
export function diagnoseCallbacks(origin: string, id: string, key: string, doFetch: typeof fetch = fetch, now: () => number = Date.now) {
  const post = async (name: 'report' | 'screenshot' | 'probe', body: object) => {
    const url = new URL(`/api/meeting-bots/diagnostics/${id}/${name}`, origin), raw = JSON.stringify(body);
    const res = await doFetch(url, { method: 'POST', body: raw, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', ...await signRequest(key, url.pathname, raw, now()) } });
    if (!res.ok) throw new Error(`diagnose_${res.status}`);
  };
  return {
    report: (snapshot: DiagnoseSnapshot) => post('report', snapshot),
    screenshot: (png: Uint8Array) => post('screenshot', { png: Buffer.from(png).toString('base64') }),
    probe: (wav: Uint8Array) => post('probe', { wav: Buffer.from(wav).toString('base64') }),
  };
}

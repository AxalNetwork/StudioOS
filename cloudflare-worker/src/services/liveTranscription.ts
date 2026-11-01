/**
 * D657 — the live transcript: a WebSocket relay to Workers AI, paid for as it
 * runs.
 *
 * The page streams 16 kHz linear16 PCM to `GET …/sessions/:id/live`. The
 * Worker opens the chosen live model with
 * `env.AI.run(model, { encoding: 'linear16', sample_rate: '16000' }, { websocket: true })`,
 * relays the audio in and the model's events out, and stores each FINISHED
 * passage as a `live` segment — a draft the final transcript replaces.
 *
 * BUDGET IN BLOCKS. A live stream has no length up front, and a D640
 * reservation expires after five minutes (`aiBudget.reserveAiBudget`), so the
 * stream holds one block of `LIVE_BLOCK_MINUTES` at a time: one before the
 * socket opens, and the next as the stream crosses into it. A block the budget
 * refuses closes the stream with the budget's own message. When the stream
 * ends, every block is settled against the minutes actually streamed, on the
 * Worker's clock, and one receipt is written for the job.
 *
 * "Live transcript off" opens no socket and holds nothing.
 *
 * #3936 (D1478 task 2, part 2) — THE SAME HOLD, GUARD AND SETTLE AS `run()`.
 * A WebSocket cannot be held open inside the router, so the stream does each
 * step `run()` does, here:
 *   - the model is the Record a Session live job's (VA2) through
 *     `speechChoice`: offered, doing live work, and allowed by the plan lock;
 *     a locked or unoffered model is refused before any socket opens;
 *   - each block's hold carries the guard's share for the text that block can
 *     produce (`blockHoldMicro`), as `run()`'s quote does for a transcription;
 *   - when the stream ends its final text, the live passages it stored, goes
 *     through the output guard (`guardFinalText`). A block, or a guard that
 *     cannot answer, removes the live draft (the final transcript replaces it
 *     anyway) and says so on the receipt; nothing unchecked stays on screen;
 *   - the stream's minutes and the guard's calls settle against the holds, and
 *     one `ai_usage_logs` row records the stream on Interviews' surface, with
 *     the guard's rows naming it.
 */
import type { Env } from '../types';
import * as aiBudget from './aiBudget';
import { PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET, TRANSCRIPT_CHARS_PER_MINUTE, budgetRefusalMessage, guardFinalText, guardQuoteMicro, recordUsage } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { speechChoice, type SpeechChoice } from './ai/speechJobs';
import type { CatalogueSwitches } from './ai/catalogue';
import type { PlanTier } from './ai/drawJobs';
import { liveInputFor, parseLiveEvent } from './sttFormats';
import { websocketUnits, type Units } from './ai/shapes';
import { labelSegments, recordReceipt, storeLiveSegment, type SessionRow } from './interviewSessions';

/** Under the reservation's five-minute expiry, so a held block never lapses mid-stream. */
export const LIVE_BLOCK_MINUTES = 4;

/** One block of streaming on this model, in micro-USD, at `multiplier` over cost (D762: 1 while billing is on cost). */
export function blockQuoteMicro(model: string, multiplier = 1): number {
  const perMinute = PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[model];
  if (typeof perMinute !== 'number') throw new Error(`no websocket price for ${model}`);
  return aiBudget.billedUsdToMicro(perMinute * LIVE_BLOCK_MINUTES, multiplier);
}

/** The guard's share of one block: the output check on the most text a block of streaming can produce. */
export function blockGuardMicro(multiplier = 1): number {
  return guardQuoteMicro('', TRANSCRIPT_CHARS_PER_MINUTE * LIVE_BLOCK_MINUTES, multiplier);
}

/** What one block holds: its minutes and the guard's share, at `multiplier`. */
export function blockHoldMicro(model: string, multiplier = 1): number {
  return blockQuoteMicro(model, multiplier) + blockGuardMicro(multiplier);
}

/** Record a Session's live transcript (plan job VA2). */
export const LIVE_JOB = 'VA2';

/** The live model a session may stream on, by the VA2 job's rules: the session's model, offered, live, and allowed by the plan. */
export function liveChoice(model: string, switches: CatalogueSwitches, tier: PlanTier): SpeechChoice {
  return speechChoice(LIVE_JOB, { switches, tier, caller: model });
}

/** Blocks needed to cover `elapsedMs` of streaming (at least one). */
export function blocksFor(elapsedMs: number): number {
  return Math.max(1, Math.ceil(Math.max(0, elapsedMs) / (LIVE_BLOCK_MINUTES * 60_000)));
}

/** Whole minutes billed for a stream, rounded up, as the rate is quoted. */
export function billedMinutes(elapsedMs: number): number {
  return elapsedMs <= 0 ? 0 : Math.ceil(elapsedMs / 60_000);
}

/**
 * How a stream's actual cost is split over the blocks it held: each block is
 * charged up to its own hold, in order, and the rest refunded.
 */
export function splitCost(totalMicro: number, blockMicro: number, blocks: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.round(totalMicro));
  for (let i = 0; i < blocks; i++) {
    const take = Math.min(left, blockMicro);
    out.push(take);
    left -= take;
  }
  return out;
}

export type HoldResult = { ok: true; reservation: aiBudget.AiReservation } | { ok: false; refusal: string; message: string };

/** Hold one block. A refusal carries the budget's own message. */
export async function holdBlock(env: Env, userId: number, model: string): Promise<HoldResult> {
  const held = await aiBudget.reserveAiBudget(env, userId, blockHoldMicro(model, await aiBudget.memberChargeMultiplier(env, userId)));
  if (!held.ok) return { ok: false, refusal: held.refusal, message: budgetRefusalMessage(held.refusal, held.refusal === 'spend_limit' ? held : null) };
  return { ok: true, reservation: held.reservation };
}

export type LiveGuard = 'passed' | 'blocked' | 'unavailable';

/**
 * Settle every block against the minutes streamed and the guard's calls,
 * write the stream's usage row and its guard rows, and the job's receipt.
 * The final text is the live passages the stream stored; a blocked or
 * unanswered guard removes them.
 */
export async function settleStream(
  env: Env, session: SessionRow, model: string, holds: aiBudget.AiReservation[], elapsedMs: number,
): Promise<{ minutes: number; cost_microusd: number; units: Units; guard: LiveGuard }> {
  const minutes = billedMinutes(elapsedMs);
  const perMinute = PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[model] ?? 0;
  const userId = holds[0]?.userId ?? session.created_by_user_id;
  // D762: the stream is settled at the billed price its blocks were held at.
  const multiplier = holds.length ? await aiBudget.memberChargeMultiplier(env, holds[0].userId) : 1;
  const streamMicro = aiBudget.billedUsdToMicro(minutes * perMinute, multiplier);

  // The guard over the final text, as run() checks a transcription's output.
  const rows = await env.DB.prepare("SELECT text FROM interview_transcript_segments WHERE session_id = ? AND source = 'live' ORDER BY start_ms, id")
    .bind(session.id).all<{ text: string | null }>().catch(() => ({ results: [] as Array<{ text: string | null }> }));
  const finalText = (rows.results ?? []).map((r) => String(r.text ?? '')).filter(Boolean).join('\n');
  const surface = AI_SURFACE.validateInterviews;
  let checked: Awaited<ReturnType<typeof guardFinalText>> | null = null;
  try { checked = await guardFinalText(env, { userId, surface }, finalText, multiplier); }
  catch (e) { console.error('[live] guard failed:', (e as Error).message); }
  const guardState: LiveGuard = !checked || checked.decision.action === 'fail' ? 'unavailable'
    : checked.decision.action === 'block' ? 'blocked' : 'passed';
  if (guardState !== 'passed') {
    // Nothing unchecked, and nothing the guard blocked, stays as the draft.
    await env.DB.prepare("DELETE FROM interview_transcript_segments WHERE session_id = ? AND source = 'live'").bind(session.id).run()
      .catch((e: Error) => console.error('[live] draft removal failed:', e.message));
  }

  const total = streamMicro + (checked?.micro ?? 0);
  const parts = splitCost(total, blockHoldMicro(model, multiplier), holds.length);
  let charged = 0;
  for (let i = 0; i < holds.length; i++) {
    try {
      await aiBudget.settleAiReservation(env, holds[i], parts[i], parts[i] === 0);
      charged += parts[i];
    } catch (e) {
      console.error('[live] settlement failed:', (e as Error).message);
    }
  }
  // D761 PR 3: the stream's units, as WebSocket minutes, apart from a file's `audio_minutes`.
  const units = websocketUnits(minutes);
  const reservationUid = holds[0]?.uid ?? null;
  const streamCharged = Math.min(charged, streamMicro);
  const rowId = await recordUsage(env, { userId, surface }, {
    task: 'transcribe', model, latency_ms: Math.max(0, Math.round(elapsedMs)), prompt_tokens: 0, completion_tokens: 0,
    est_cost_usd: minutes * perMinute, fallback_used: false, cached: false,
    safety_score: guardState === 'passed' ? 1 : guardState === 'blocked' ? 0 : null,
  }, null, { charged: streamCharged, reservationUid, units: units as Record<string, number> });
  await checked?.record(rowId, reservationUid);
  await recordReceipt(env, session.id, {
    kind: 'live', model, requested_model: model, fallback_used: false,
    audio_minutes: minutes, cost_microusd: charged, outcome: 'ok',
    refusal: guardState === 'passed' ? null : guardState === 'blocked' ? 'guard_blocked' : 'guard_unavailable',
  });
  return { minutes, cost_microusd: charged, units, guard: guardState };
}

type AnyWebSocket = WebSocket & { accept(): void };

/**
 * Relay one live stream. `first` is the block already held before the upgrade
 * was answered. Returns the client half of the pair for the 101 response.
 */
export async function openLiveRelay(
  env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  session: SessionRow, userId: number, intervieweeName: string | null, first: aiBudget.AiReservation,
): Promise<Response> {
  const model = session.live_model!;
  const ai = (env as unknown as { AI: { run(m: string, i: unknown, o: unknown): Promise<Response> } }).AI;
  const upstreamResp = await ai.run(model, liveInputFor(model, session.language), { websocket: true });
  const upstream = (upstreamResp as unknown as { webSocket?: AnyWebSocket }).webSocket;
  if (!upstream) {
    await aiBudget.settleAiReservation(env, first, 0, true).catch(() => {});
    return new Response(JSON.stringify({ detail: 'live_unavailable' }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
  upstream.accept();

  const pair = new (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, AnyWebSocket> }).WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const startedAt = Date.now();
  const holds: aiBudget.AiReservation[] = [first];
  let pending: Promise<unknown> | null = null;
  let closed = false;

  const finish = (reason?: { code: number; text: string }) => {
    if (closed) return;
    closed = true;
    try { upstream.close(); } catch { /* already closed */ }
    try { server.close(reason?.code ?? 1000, reason?.text ?? 'done'); } catch { /* already closed */ }
    const elapsed = Date.now() - startedAt;
    const done = Promise.resolve(pending).then(() => settleStream(env, session, model, holds, elapsed));
    ctx?.waitUntil(done);
  };

  server.addEventListener('message', (ev: MessageEvent) => {
    if (closed) return;
    // A new block before the stream crosses into it; refused ends the stream.
    if (!pending && blocksFor(Date.now() - startedAt + 30_000) > holds.length) {
      pending = holdBlock(env, userId, model).then((h) => {
        pending = null;
        if (h.ok) holds.push(h.reservation);
        else {
          try { server.send(JSON.stringify({ type: 'budget_exhausted', refusal: h.refusal, message: h.message })); } catch { /* gone */ }
          finish({ code: 4402, text: 'budget' });
        }
      });
    }
    try { upstream.send(ev.data as ArrayBuffer); } catch { finish({ code: 1011, text: 'upstream' }); }
  });

  upstream.addEventListener('message', (ev: MessageEvent) => {
    if (closed) return;
    try { server.send(ev.data as string); } catch { /* client gone */ }
    const seg = parseLiveEvent(model, ev.data);
    if (seg) {
      const [stored] = labelSegments([seg], intervieweeName);
      ctx?.waitUntil(storeLiveSegment(env, session, stored, model));
    }
  });

  server.addEventListener('close', () => finish());
  server.addEventListener('error', () => finish({ code: 1011, text: 'client' }));
  upstream.addEventListener('close', () => finish());
  upstream.addEventListener('error', () => finish({ code: 1011, text: 'upstream' }));

  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}

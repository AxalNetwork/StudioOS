/**
 * D1580 part 2b (#3827) — a rehearsal's live transcript, for pd38's live words
 * a minute and its notes checklist.
 *
 * The same relay as an interview session's (`liveTranscription.relayLive`):
 * a block of LIVE_BLOCK_MINUTES held before the socket opens, the next held as
 * the stream crosses into it, a refused block ending the stream with the
 * budget's own message, and every block settled against the minutes streamed.
 * What differs is whose it is:
 *   - the model is the member's AIRail pick for the rail option
 *     `transcribe:rehearsal-live` (Flux by default), checked by the live job's
 *     rules (offered, live, allowed by the plan);
 *   - the finished passages stay in the stream: the browser counts words a
 *     minute and ticks the notes from them, and the rehearsal's record is the
 *     transcript of the recording (part 1), never the live draft;
 *   - the stream settles on the pitch deck's page, with its usage row naming
 *     the rail option and the deck, and the guard over the text it streamed.
 */
import type { Env } from '../../types';
import * as aiBudget from '../aiBudget';
import { PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET, guardFinalText, railPicks, recordUsage } from '../aiRouter';
import { AI_SURFACE } from '../aiSurfaces';
import { websocketUnits } from '../ai/shapes';
import { billedMinutes, blockHoldMicro, livePerMinute, splitCost } from '../liveTranscription';

export const LIVE_OPTION = 'transcribe:rehearsal-live';
export const LIVE_DEFAULT = '@cf/deepgram/flux';
/** The pitch deck's page: the stream's usage surface, and so its price (it does not opt out of Deepgram's program, as part 1's transcript does not). */
export const LIVE_REHEARSAL_SURFACE = AI_SURFACE.raisePitch;
/** The most live text a stream keeps for the guard (ten minutes of speech is far under it). */
const TEXT_MAX = 40_000;

/** The member's pick for the live option, or the default. */
export async function liveModelFor(env: Env, userId: number, page: string): Promise<string> {
  try { return (await railPicks(env, userId, page, LIVE_OPTION)).option ?? LIVE_DEFAULT; } catch { return LIVE_DEFAULT; }
}

/** A stream's finished passages, kept in memory for the guard, bounded. */
export function liveText() {
  const parts: string[] = [];
  let size = 0;
  return {
    add(text: string) { const t = String(text ?? '').trim(); if (t && size < TEXT_MAX) { parts.push(t); size += t.length + 1; } },
    get text() { return parts.join('\n').slice(0, TEXT_MAX); },
  };
}

/** Settle a rehearsal's stream: the minutes and the guard over what it streamed, one usage row on the pitch deck's page. */
export async function settleRehearsalLive(
  env: Env, run: { userId: number; model: string; railPage: string; deckId: number },
  holds: aiBudget.AiReservation[], elapsedMs: number, text: string,
): Promise<{ minutes: number; cost_microusd: number; guard: 'passed' | 'blocked' | 'unavailable' }> {
  const minutes = billedMinutes(elapsedMs);
  const surface = LIVE_REHEARSAL_SURFACE;
  const perMinute = run.model in PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET ? livePerMinute(run.model, surface) : 0;
  const multiplier = holds.length ? await aiBudget.memberChargeMultiplier(env, run.userId) : 1;
  const streamMicro = aiBudget.billedUsdToMicro(minutes * perMinute, multiplier);
  let checked: Awaited<ReturnType<typeof guardFinalText>> | null = null;
  try { checked = text ? await guardFinalText(env, { userId: run.userId, surface }, text, multiplier) : null; }
  catch (e) { console.error('[rehearsal-live] guard failed:', (e as Error).message); }
  const guard = !text ? 'passed' : !checked || checked.decision.action === 'fail' ? 'unavailable' : checked.decision.action === 'block' ? 'blocked' : 'passed';
  const parts = splitCost(streamMicro + (checked?.micro ?? 0), blockHoldMicro(run.model, multiplier, surface), holds.length);
  let charged = 0;
  for (let i = 0; i < holds.length; i++) {
    try { await aiBudget.settleAiReservation(env, holds[i], parts[i], parts[i] === 0); charged += parts[i]; }
    catch (e) { console.error('[rehearsal-live] settlement failed:', (e as Error).message); }
  }
  const reservationUid = holds[0]?.uid ?? null;
  const rowId = await recordUsage(env, { userId: run.userId, surface, railPage: run.railPage, railOption: LIVE_OPTION, recordRef: `deck:${run.deckId}` }, {
    task: 'transcribe', model: run.model, latency_ms: Math.max(0, Math.round(elapsedMs)), prompt_tokens: 0, completion_tokens: 0,
    est_cost_usd: minutes * perMinute, fallback_used: false, cached: false,
    safety_score: guard === 'passed' ? 1 : guard === 'blocked' ? 0 : null,
  }, null, { charged: Math.min(charged, streamMicro), reservationUid, units: websocketUnits(minutes) as Record<string, number> });
  await checked?.record(rowId, reservationUid);
  return { minutes, cost_microusd: charged, guard };
}

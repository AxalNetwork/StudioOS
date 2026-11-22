/**
 * D6897 part 4 (#6897, canvas D6054 RA-31): the Raise status page a founder shares outside Axal.
 *
 * A one-page summary of the Overview, frozen on the day it is made ("This shows the raise as of that day; it does not
 * update"). It carries:
 *
 * - **Stage** — the stage `/overview` shows (D6045 `raiseJourney`), with the stages before it done.
 * - **Materials** — Investor narrative, Pitch, Data room, Cap table and Use of funds, in state words only. A card's
 *   caption, figures and rows are never copied; the Pitch row is its state label (`PITCH_STATE_LABEL`).
 * - **Investors · counts by stage** — In pipeline, Active conversations, In diligence and Committed, counted with the
 *   summary SQL that selects no name, contact, note or amount (`capitalSummary`); In pipeline is every investor not
 *   passed, as the Overview counts it (`pipelineCounts`). Investor names and commitment
 *   amounts are left out (Q3 A).
 * - **Readiness by area** — the seven areas exactly as the readiness snapshot (RA-30) shows them.
 * - **Next steps** — the three the Overview lists, as their label and line; no score gain, no link.
 * - **Connected tools** — each tool's read state and when it was read; never the fact it read (a runway, a count).
 *
 * Nothing is exported half-filled (RA-34): when any part cannot be read, no link and no copy is made.
 * The link and the PDF copy share the stores of RA-28/RA-30 with `output = 'status'`; listing and revoking are theirs.
 * Nothing here sends anything: making a link only returns its address to the founder.
 */
import type { Card } from './cycleCards';
import type { Ctx } from './raiseCycle';
import { CARD_FOR, connectors, nextSteps, NEXT_STEPS_MAX } from './raiseCycle';
import { JOURNEY_STAGES, raiseJourney, type CurrentDeck } from './raiseJourney';
import { capitalSummary } from './capRelAccess';
import { logCycleWriteStatement } from './cycleActivity';
import type { RaiseEvidenceContext } from './raiseEvidence';
import {
  EvidenceShareError, LINK_BOUNDS, LINK_DEFAULTS, founderOnly, intIn, newShareToken, newUid, readinessBody, recordCopy, sha256Hex,
  tokenHash, ventureName, type SnapshotArea,
} from './raiseEvidenceShare';

/** What the route lends: the two reads that live with it (the deck and the data room's summary card). */
export type StatusDeps = { currentDeck: () => Promise<CurrentDeck>; roomCard: () => Promise<Card> };

export type StatusMaterial = { key: string; label: string; state: string; words: string };
export type StatusStage = { key: string; label: string; state: 'done' | 'current' | 'ahead' };
export type StatusBody = {
  stage: { key: string; label: string; stages: StatusStage[] };
  materials: StatusMaterial[];
  investors: { in_pipeline: number; active_conversations: number; in_diligence: number; committed: number };
  readiness: { areas: SnapshotArea[] };
  next_steps: Array<{ label: string; text: string }>;
  tools: Array<{ key: string; label: string; state: 'connected' | 'not_connected' | 'unreadable'; words: string; as_of: string | null }>;
};

/** The materials RA-02 lists, in its order. */
export const STATUS_MATERIALS = [
  { key: 'investor-narrative', label: 'Investor narrative' },
  { key: 'pitch-deck', label: 'Pitch' },
  { key: 'data-room', label: 'Data room' },
  { key: 'cap-table', label: 'Cap table' },
  { key: 'use-of-funds', label: 'Use of funds' },
] as const;

/** A card's state as one or two words. `ok` names what the card holds; nothing else from the card is copied. */
const OK_WORD: Record<string, string> = { 'investor-narrative': 'Saved', 'data-room': 'Recorded', 'cap-table': 'Recorded', 'use-of-funds': 'Saved' };
const CARD_WORD: Record<string, string> = { empty: 'Not started', too_little: 'Partial', not_recorded: 'Not recorded' };
export function materialWords(slug: string, state: string): string | null {
  if (state === 'ok') return OK_WORD[slug] ?? 'Recorded';
  return CARD_WORD[state] ?? null;
}

// D8258: a lost connection is its own word, never Connected or Unavailable.
const TOOL_WORD = { connected: 'Connected', not_connected: 'Not connected', disconnected: 'Disconnected', unreadable: 'Unavailable' } as const;
const IN_TALKS = ['contacted', 'meeting', 'diligence'];

class Unreadable extends Error {}
const must = <T>(ok: boolean, v: T): T => { if (!ok) throw new Unreadable('status part unreadable'); return v; };

/**
 * The page as it would be made now, and the hash "Changed since sent" compares. Throws `status_unreadable` when any
 * part could not be read: a status page is whole or not made.
 */
export async function statusBody(ctx: Ctx, deps: StatusDeps): Promise<{ body: StatusBody; hash: string }> {
  try {
    const [journey, cards, room, pipeline, readiness, steps, tools] = await Promise.all([
      raiseJourney(ctx, { currentDeck: deps.currentDeck }, { names: false, act: false }),
      Promise.all((['investor-narrative', 'cap-table', 'use-of-funds'] as const).map((slug) => CARD_FOR[slug](ctx))),
      deps.roomCard(),
      capitalSummary(ctx.env, ctx.projectId),
      readinessBody(ctx.env, ctx.projectId),
      nextSteps(ctx),
      connectors(ctx),
    ]);
    const stage = must(journey.stage.state === 'ok', journey.stage as { state: 'ok'; key: string; label: string });
    const at = JOURNEY_STAGES.findIndex((s) => s.key === stage.key);
    must(at >= 0, null);
    const pitch = must(journey.pitch_state.state === 'ok', journey.pitch_state as { state: 'ok'; key: string; label: string });
    const bySlug = new Map<string, Card>([...cards, room].map((c) => [c.slug, c]));
    const materials = STATUS_MATERIALS.map(({ key, label }): StatusMaterial => {
      if (key === 'pitch-deck') return { key, label, state: pitch.key, words: pitch.label };
      const card = bySlug.get(key);
      const words = card ? materialWords(key, card.state) : null;
      if (!card || words == null) throw new Unreadable('material unreadable');
      return { key, label, state: card.state, words };
    });
    must(pipeline.state === 'ok', null);
    const count = (stages: string[]) => pipeline.stages.filter((s) => stages.includes(s.stage)).reduce((n, s) => n + s.count, 0);
    must(steps.state !== 'unreadable' && Array.isArray(tools), null);
    const body: StatusBody = {
      stage: {
        key: stage.key, label: stage.label,
        stages: JOURNEY_STAGES.map((s, i) => ({ key: s.key, label: s.label, state: i < at ? 'done' : i === at ? 'current' : 'ahead' })),
      },
      materials,
      investors: { in_pipeline: Number(pipeline.total) - count(['passed']), active_conversations: count(IN_TALKS), in_diligence: count(['diligence']), committed: count(['committed']) },
      readiness: readiness.body,
      next_steps: steps.items.slice(0, NEXT_STEPS_MAX).map((s) => ({ label: s.label, text: s.text })),
      tools: (tools as Array<{ key: string; label: string; state: keyof typeof TOOL_WORD; as_of: string | null }>).map((t) => ({
        key: t.key, label: t.label, state: t.state, words: TOOL_WORD[t.state], as_of: t.state === 'connected' ? t.as_of : null,
      })),
    };
    return { body, hash: await sha256Hex(JSON.stringify(body)) };
  } catch (e) {
    if (e instanceof EvidenceShareError) throw e;
    throw new EvidenceShareError('status_unreadable', 503);
  }
}

const ctxOf = (ctx: RaiseEvidenceContext): Ctx => ({ env: ctx.env, projectId: ctx.projectId, today: new Date().toISOString().slice(0, 10) });

function labelOf(data: Record<string, unknown>, allowed: string[]): string {
  if (!data || typeof data !== 'object' || Object.keys(data).some((k) => !allowed.includes(k))) throw new EvidenceShareError('invalid', 400);
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (!label || label.length > LINK_BOUNDS.label) throw new EvidenceShareError('invalid', 400);
  return label;
}

/** RA-31 A: make the status page and its link. Nothing is sent; the founder copies the address. */
export async function createStatusLink(ctx: RaiseEvidenceContext, data: Record<string, unknown>, deps: StatusDeps) {
  founderOnly(ctx);
  const label = labelOf(data, ['label', 'expires_in_days', 'view_limit']);
  const days = data.expires_in_days ?? LINK_DEFAULTS.expires_in_days;
  const limit = data.view_limit ?? LINK_DEFAULTS.view_limit;
  if (!intIn(days, LINK_BOUNDS.expires_in_days) || !intIn(limit, LINK_BOUNDS.view_limit)) throw new EvidenceShareError('invalid', 400);
  const made = await statusBody(ctxOf(ctx), deps);
  const now = new Date();
  const madeAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Number(days) * 86400000).toISOString();
  const page = { kind: 'status', ...made.body, venture: await ventureName(ctx.env, ctx.projectId), made_at: madeAt };
  const token = newShareToken();
  const uid = newUid();
  const itemCount = made.body.materials.length;
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO raise_evidence_share_links(uid,project_id,output,token_hash,label,reader,nda_signed_on,nda_confirmed_by,item_uids_json,item_count,
          snapshot_json,pack_hash,expires_at,view_limit,created_by,created_at) VALUES(?,?,'status',?,?,'before_nda',NULL,NULL,NULL,?,?,?,?,?,?,?)`)
        .bind(uid, ctx.projectId, await tokenHash(token), label, itemCount, JSON.stringify(page), made.hash, expiresAt, limit, ctx.user.id, madeAt),
      logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'fundraising-readiness', entityId: uid,
        action: 'raise_status_shared', summary: 'A raise status page link was made.' }),
    ]);
  } catch { throw new EvidenceShareError('failed', 503); }
  return { uid, output: 'status' as const, path: '/share/status/' + token, label, item_count: itemCount, created_at: madeAt, expires_at: expiresAt,
    view_limit: limit, view_count: 0, state: 'live' as const, sent: false };
}

/** RA-31 C: the status page as a PDF copy. The same page a link would freeze; no expiry, no view limit. */
export async function createStatusPdf(ctx: RaiseEvidenceContext, data: Record<string, unknown>, deps: StatusDeps) {
  founderOnly(ctx);
  const label = labelOf(data, ['label']);
  const made = await statusBody(ctxOf(ctx), deps);
  const madeAt = new Date().toISOString();
  const page = { kind: 'status', ...made.body, venture: await ventureName(ctx.env, ctx.projectId), made_at: madeAt };
  const itemCount = made.body.materials.length;
  const uid = await recordCopy(ctx, { output: 'status', label, reader: 'before_nda', ndaOn: null, itemCount, hash: made.hash, madeAt,
    action: 'raise_status_pdf_copied', summary: 'A raise status page PDF was downloaded.' });
  return { uid, kind: 'pdf' as const, output: 'status' as const, label, item_count: itemCount, created_at: madeAt, status: page };
}

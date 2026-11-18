/**
 * D6045 (#6045, Raise V2 build 1/5) — the Raise Overview's stage, its one
 * primary action, the Pitch card's state and the investor activity, worked
 * out on the Worker so the page never guesses them in the browser.
 *
 * RA-03's rule, most advanced first. Each step reads only what it needs, so
 * a source that could not be read makes the answer Unavailable only when it
 * could have changed it:
 *   1. at least one prospect in the pipeline (not passed) → Run the raise · Add investor
 *   2. the current deck passes `/deck-ready`               → Prepare diligence · Share with investor
 *   3. at least one saved narrative version                → Build the story · Build pitch
 *   4. otherwise                                           → Prepare · Prepare to raise
 * Readiness scores never choose the stage or the action.
 *
 * RA-05's Pitch states (RA-C: the Worker can tell a draft from a saved deck):
 *   no_deck  no saved version and no unkept proposal;
 *   draft    no saved version, but an unkept proposal (`pitch_deck_proposals`) is being built;
 *   saved    a saved version (`pitch_decks.is_current`) that `/deck-ready` still has rows against;
 *   reviewed a saved version `/deck-ready` passes;
 *   shared   a live investor link (not revoked, expired or used up) on any version.
 * `unsaved_changes` says whether a working copy (`hasWorkingCopy` in `routes/deck_draft.ts`) or an
 * unkept proposal sits beside a saved version; null when that could not be read.
 *
 * RA-02's investor activity reads three sources, each with its own freshness
 * (`OperationalReadMeta`): the pipeline (`raise_prospects`), deck link views
 * (`deck_share_views`) and call-for-capital responses (`round_call_recipients`,
 * only while round calls are on). A source that could not be read leaves its
 * figures null, never 0.
 */
import type { Env } from '../types';
import { readMeta, type OperationalReadMeta } from '../util/operationalRead';
import { deckReady } from './narrative/coach';
import { deckShareMetrics } from './deckShareUse';
import { roundCallsEnabled } from './roundCallPolicy';
import { IN_CONVERSATION, LIST_STAGE_LABEL, raiseLinks, type Ctx } from './raiseCycle';
import { hasWorkingCopy } from '../routes/deck_draft';

export type Unreadable = { state: 'unreadable'; reason: string };

export const JOURNEY_STAGES = [
  { key: 'prepare', label: 'Prepare' },
  { key: 'build_the_story', label: 'Build the story' },
  { key: 'prepare_diligence', label: 'Prepare diligence' },
  { key: 'run_the_raise', label: 'Run the raise' },
] as const;
export type StageKey = (typeof JOURNEY_STAGES)[number]['key'];

/** RA-03's four rules, each with its stage, its action and the recorded fact that chose it. */
export const JOURNEY_RULES = {
  early: { stage: 'prepare', action: { key: 'prepare_to_raise', label: 'Prepare to raise' }, rule: 'No narrative version saved' },
  narrative: { stage: 'build_the_story', action: { key: 'build_pitch', label: 'Build pitch' }, rule: 'A narrative version is saved and the deck is not ready to send' },
  deck: { stage: 'prepare_diligence', action: { key: 'share_with_investor', label: 'Share with investor' }, rule: 'The deck is ready to send' },
  active: { stage: 'run_the_raise', action: { key: 'add_investor', label: 'Add investor' }, rule: 'At least one investor is in the pipeline' },
} as const;
export type JourneyRule = keyof typeof JOURNEY_RULES;

export const PITCH_STATE_LABEL = {
  no_deck: 'No deck',
  draft: 'Working draft only',
  saved: 'Saved, not reviewed',
  reviewed: 'Reviewed, ready to send',
  shared: 'Shared',
} as const;
export type PitchKey = keyof typeof PITCH_STATE_LABEL;

export type CurrentDeck = { id: number; version: number; slides: unknown[] } | null;

/** One read that either answered or failed; a failure is kept, never thrown. */
type Got<T> = { ok: true; value: T } | { ok: false };
async function got<T>(read: () => Promise<T>, what: string): Promise<Got<T>> {
  try { return { ok: true, value: await read() }; }
  catch (e) {
    console.warn('[raiseJourney] unreadable:', what, (e as Error)?.message);
    return { ok: false };
  }
}

/** Reads each source at most once, however many answers ask for it. */
function once<T>(read: () => Promise<T>, what: string): () => Promise<Got<T>> {
  let p: Promise<Got<T>> | null = null;
  return () => (p ??= got(read, what));
}

export type JourneyDeps = {
  /** The current deck version with its cards, as `/deck-ready` reads it; throws when it cannot be read. */
  currentDeck: () => Promise<CurrentDeck>;
};

/** The pipeline by stage: how many are live (not passed), how many are in conversation, and the last change. */
export async function pipelineCounts(env: Env, projectId: number): Promise<{ live: number; talking: number; last: string | null }> {
  const res = await env.DB.prepare(
    'SELECT stage, COUNT(*) AS n, MAX(updated_at) AS last FROM raise_prospects WHERE project_id = ? GROUP BY stage',
  ).bind(projectId).all<{ stage: string; n: number; last: string | null }>();
  let live = 0, talking = 0, last: string | null = null;
  for (const r of res.results || []) {
    const n = Number(r.n) || 0;
    if (r.stage !== 'passed') live += n;
    if (IN_CONVERSATION.includes(r.stage)) talking += n;
    if (r.last && (!last || r.last > last)) last = r.last;
  }
  return { live, talking, last };
}

const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function sources(ctx: Ctx, deps: JourneyDeps) {
  const db = ctx.env.DB;
  return {
    pipeline: once(() => pipelineCounts(ctx.env, ctx.projectId), 'pipeline'),
    deck: once(deps.currentDeck, 'deck'),
    narrative: once(async () => {
      const r = await db.prepare(
        'SELECT COUNT(DISTINCT version) AS n FROM spinout_deck_overrides WHERE project_id = ? AND version > 0',
      ).bind(ctx.projectId).first<{ n: number }>();
      return Number(r?.n ?? 0);
    }, 'narrative'),
    proposal: once(async () => {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals WHERE project_id = ?').bind(ctx.projectId).first<{ n: number }>();
      return Number(r?.n ?? 0) > 0;
    }, 'proposal'),
    links: once(async () => {
      const res = await db.prepare(
        `SELECT t.expires_at, t.revoked_at, t.used_at, t.view_limit, t.view_count, d.version
           FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
          WHERE d.project_id = ?`,
      ).bind(ctx.projectId).all<{ expires_at: string | null; revoked_at: string | null; used_at: string | null; view_limit: number | null; view_count: number | null; version: number }>();
      const now = nowStamp();
      // A link is live as the Pitch card's records say it (`pitchRecords`): not revoked, not expired, not used up.
      return (res.results || []).filter((t) => !t.revoked_at && !(String(t.expires_at) < now) && !deckShareMetrics(t).exhausted);
    }, 'links'),
    workingCopy: (deckId: number) => got(() => hasWorkingCopy(db, deckId), 'working copy'),
  };
}
type Sources = ReturnType<typeof sources>;

const unreadable = (reason: string): Unreadable => ({ state: 'unreadable', reason });

/** RA-03: which rule holds, or why it is not known. */
export async function journeyRule(src: Pick<Sources, 'pipeline' | 'deck' | 'narrative'>, projectId: number): Promise<JourneyRule | Unreadable> {
  const pipeline = await src.pipeline();
  if (!pipeline.ok) return unreadable('The investor pipeline could not be read, so the stage is not known.');
  if (pipeline.value.live > 0) return 'active';
  const deck = await src.deck();
  if (!deck.ok) return unreadable('The deck could not be read, so the stage is not known.');
  if (deck.value && deckReady(deck.value, projectId).state === 'ready') return 'deck';
  const narrative = await src.narrative();
  if (!narrative.ok) return unreadable('The narrative versions could not be read, so the stage is not known.');
  return narrative.value > 0 ? 'narrative' : 'early';
}

export type Stage = { state: 'ok'; key: StageKey; label: string; rule: string } | Unreadable;
export type PrimaryAction = { state: 'ok'; key: string; label: string; href: string; rule: string } | Unreadable;

export function stageOf(rule: JourneyRule | Unreadable): Stage {
  if (typeof rule !== 'string') return rule;
  const r = JOURNEY_RULES[rule];
  return { state: 'ok', key: r.stage, label: JOURNEY_STAGES.find((s) => s.key === r.stage)!.label, rule: r.rule };
}

export function primaryActionOf(ctx: Ctx, rule: JourneyRule | Unreadable): PrimaryAction {
  if (typeof rule !== 'string') return rule;
  const r = JOURNEY_RULES[rule];
  const href = rule === 'early' ? raiseLinks.module(ctx, 'fundraising-readiness')
    : rule === 'narrative' ? raiseLinks.pitch(ctx)
      : rule === 'deck' ? raiseLinks.share(ctx)
        : raiseLinks.add(ctx, 'capital-relationships');
  return { state: 'ok', key: r.action.key, label: r.action.label, href, rule: r.rule };
}

export type PitchState = {
  state: 'ok'; key: PitchKey; label: string;
  /** The saved version the card names: the current one, or for `shared` the newest version with a live link. */
  version: number | null;
  live_links: number;
  /** `/deck-ready`'s rows still to fix on the current version; null with no saved version. */
  to_fix: number | null;
  unsaved_changes: boolean | null;
} | Unreadable;

/** RA-05: the Pitch card's state, or Unavailable when a source that decides it could not be read. */
export async function pitchStateOf(src: Pick<Sources, 'deck' | 'links' | 'proposal' | 'workingCopy'>, projectId: number): Promise<PitchState> {
  const deck = await src.deck();
  if (!deck.ok) return unreadable('The deck could not be read, so its state is not known.');
  const proposal = await src.proposal();
  if (!deck.value) {
    if (!proposal.ok) return unreadable('The deck being built could not be read, so its state is not known.');
    const key: PitchKey = proposal.value ? 'draft' : 'no_deck';
    return { state: 'ok', key, label: PITCH_STATE_LABEL[key], version: null, live_links: 0, to_fix: null, unsaved_changes: proposal.value };
  }
  const links = await src.links();
  if (!links.ok) return unreadable('The investor links could not be read, so whether the deck is shared is not known.');
  const ready = deckReady(deck.value, projectId);
  const working = await src.workingCopy(deck.value.id);
  // Either one found is enough to say yes; no needs both read.
  const unsaved = (working.ok && working.value) || (proposal.ok && proposal.value) ? true
    : working.ok && proposal.ok ? false : null;
  const live = links.value;
  const key: PitchKey = live.length ? 'shared' : ready.state === 'ready' ? 'reviewed' : 'saved';
  return {
    state: 'ok', key, label: PITCH_STATE_LABEL[key],
    version: key === 'shared' ? Math.max(...live.map((t) => Number(t.version))) : deck.value.version,
    live_links: live.length, to_fix: ready.rows.length, unsaved_changes: unsaved,
  };
}

// ---------------------------------------------------------------------------
// RA-02: investor activity
// ---------------------------------------------------------------------------

export type ActivityEvent = { at: string; kind: 'deck_opened' | 'call_response' | 'prospect_updated'; investor: string; detail: string };
export type NotApplicable = { status: 'not_applicable'; reason: string };
export type InvestorActivity = {
  in_pipeline: number | null;
  active_conversations: number | null;
  deck_views_8_weeks: number | null;
  /** Call-for-capital responses this calendar month; null while round calls are off or unreadable. */
  call_responses_this_month: number | null;
  /** The three latest events, newest first; omitted for a count-only (staff) read. */
  recent?: ActivityEvent[];
  sources: { pipeline: OperationalReadMeta; deck_views: OperationalReadMeta; round_calls: OperationalReadMeta | NotApplicable };
};

const RECENT = 3;

export async function investorActivity(ctx: Ctx, opts: { names: boolean }, pipelineRead?: () => Promise<Got<{ live: number; talking: number; last: string | null }>>): Promise<InvestorActivity> {
  const db = ctx.env.DB;
  const readAt = new Date().toISOString();
  const month = ctx.today.slice(0, 7);
  const events: ActivityEvent[] = [];

  const counts = await (pipelineRead ?? (() => got(() => pipelineCounts(ctx.env, ctx.projectId), 'activity pipeline')))();
  const pipeline: Got<{ live: number; talking: number; last: string | null; recent: ActivityEvent[] }> = !counts.ok ? counts : await got(async () => {
    let recent: ActivityEvent[] = [];
    if (opts.names) {
      const res = await db.prepare(
        `SELECT name, firm, stage, updated_at FROM raise_prospects WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
      ).bind(ctx.projectId, RECENT).all<{ name: string | null; firm: string | null; stage: string; updated_at: string }>();
      recent = (res.results || []).map((p) => ({
        at: p.updated_at, kind: 'prospect_updated' as const,
        investor: [p.name, p.firm].filter(Boolean).join(' · ') || 'An investor',
        detail: `Stage: ${LIST_STAGE_LABEL[p.stage] ?? p.stage}`,
      }));
    }
    return { ...counts.value, recent };
  }, 'activity pipeline');
  if (pipeline.ok) events.push(...pipeline.value.recent);

  const views = await got(async () => {
    const r = await db.prepare(
      `SELECT COUNT(*) AS n, MAX(v.created_at) AS last
         FROM deck_share_views v JOIN pitch_decks d ON d.id = v.deck_id
        WHERE d.project_id = ? AND julianday(substr(v.created_at, 1, 10)) <= julianday(?)
          AND julianday(?) - julianday(substr(v.created_at, 1, 10)) < 56`,
    ).bind(ctx.projectId, ctx.today, ctx.today).first<{ n: number; last: string | null }>();
    let recent: ActivityEvent[] = [];
    if (opts.names) {
      const res = await db.prepare(
        `SELECT v.created_at, t.investor_label, p.name AS prospect_name, p.firm AS prospect_firm
           FROM deck_share_views v JOIN pitch_decks d ON d.id = v.deck_id
           LEFT JOIN pitch_deck_share_tokens t ON t.id = v.share_token_id
           LEFT JOIN raise_prospects p ON p.id = t.prospect_id AND p.project_id = d.project_id
          WHERE d.project_id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT ?`,
      ).bind(ctx.projectId, RECENT).all<{ created_at: string; investor_label: string | null; prospect_name: string | null; prospect_firm: string | null }>();
      recent = (res.results || []).map((v) => ({
        at: v.created_at, kind: 'deck_opened' as const,
        investor: [v.prospect_name, v.prospect_firm].filter(Boolean).join(' · ') || String(v.investor_label ?? '').trim() || 'An investor link',
        detail: 'Opened the deck',
      }));
    }
    return { n: Number(r?.n ?? 0), last: r?.last ?? null, recent };
  }, 'activity deck views');
  if (views.ok) events.push(...views.value.recent);

  let calls: Got<{ n: number; last: string | null; recent: ActivityEvent[] }> | null = null;
  if (roundCallsEnabled(ctx.env)) {
    calls = await got(async () => {
      const r = await db.prepare(
        `SELECT SUM(CASE WHEN substr(r.responded_at, 1, 7) = ? THEN 1 ELSE 0 END) AS n, MAX(r.last_response_at) AS last
           FROM round_call_recipients r JOIN round_calls rc ON rc.id = r.call_id
          WHERE rc.project_id = ? AND r.responded_at IS NOT NULL`,
      ).bind(month, ctx.projectId).first<{ n: number | null; last: string | null }>();
      let recent: ActivityEvent[] = [];
      if (opts.names) {
        const res = await db.prepare(
          `SELECT r.responded_at, u.name, rc.name AS call_name
             FROM round_call_recipients r JOIN round_calls rc ON rc.id = r.call_id JOIN users u ON u.id = r.investor_user_id
            WHERE rc.project_id = ? AND r.responded_at IS NOT NULL ORDER BY r.responded_at DESC, r.id DESC LIMIT ?`,
        ).bind(ctx.projectId, RECENT).all<{ responded_at: string; name: string | null; call_name: string }>();
        recent = (res.results || []).map((x) => ({
          at: x.responded_at, kind: 'call_response' as const,
          investor: String(x.name ?? '').trim() || 'An investor', detail: `Responded to ${x.call_name}`,
        }));
      }
      return { n: Number(r?.n ?? 0), last: r?.last ?? null, recent };
    }, 'activity round calls');
    if (calls.ok) events.push(...calls.value.recent);
  }

  const meta = (g: Got<{ last: string | null }>, source: string, what: string) => readMeta({
    answered: g.ok, read_at: readAt, source, source_updated_at: g.ok ? g.value.last : null,
    reason: g.ok ? null : `${what} could not be read.`,
  });
  return {
    in_pipeline: pipeline.ok ? pipeline.value.live : null,
    active_conversations: pipeline.ok ? pipeline.value.talking : null,
    deck_views_8_weeks: views.ok ? views.value.n : null,
    call_responses_this_month: calls && calls.ok ? calls.value.n : null,
    ...(opts.names ? { recent: events.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, RECENT) } : {}),
    sources: {
      pipeline: meta(pipeline, 'raise_prospects', 'The investor pipeline'),
      deck_views: meta(views, 'deck_share_views', 'Deck link views'),
      round_calls: calls ? meta(calls, 'round_call_recipients', 'Call-for-capital responses')
        : { status: 'not_applicable', reason: 'Calls for capital are not switched on.' },
    },
  };
}

/** The whole answer when it could not be worked out at all: every field Unavailable, never a guess. */
export function journeyUnreadable(act: boolean) {
  const reason = 'Raise could not be read, so the stage is not known.';
  const meta = (source: string) => readMeta({ answered: false, read_at: new Date().toISOString(), source, reason: 'This source could not be read.' });
  return {
    stage: unreadable(reason) as Stage,
    primary_action: act ? unreadable(reason) as PrimaryAction : null,
    pitch_state: unreadable('The deck could not be read, so its state is not known.') as PitchState,
    investor_activity: {
      in_pipeline: null, active_conversations: null, deck_views_8_weeks: null, call_responses_this_month: null,
      sources: { pipeline: meta('raise_prospects'), deck_views: meta('deck_share_views'), round_calls: meta('round_call_recipients') },
    } as InvestorActivity,
  };
}

/** Everything D6045 adds to `GET /overview`: the stage, the primary action, the Pitch state and investor activity. */
export async function raiseJourney(ctx: Ctx, deps: JourneyDeps, opts: { names: boolean; act: boolean }) {
  const src = sources(ctx, deps);
  const rule = await journeyRule(src, ctx.projectId);
  const [pitch_state, investor_activity] = await Promise.all([pitchStateOf(src, ctx.projectId), investorActivity(ctx, { names: opts.names }, src.pipeline)]);
  return {
    stage: stageOf(rule),
    // A read-only (staff) viewer is shown no action: the page's actions are the venture's.
    primary_action: opts.act ? primaryActionOf(ctx, rule) : null,
    pitch_state,
    investor_activity,
  };
}

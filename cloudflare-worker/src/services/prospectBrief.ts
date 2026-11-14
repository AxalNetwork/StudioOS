/**
 * D1585 (#3832, deck v2 F6) — the brief for one investor meeting: what the
 * founder needs before walking in, read from what is already recorded. NO
 * MODEL RUNS: every line is a row the venture already holds, so it costs
 * nothing and quotes nothing.
 *
 * It reads, for one prospect of the venture:
 *   prospect     who they are and where they stand (name, firm, stage, warm
 *                path, next step) — never their email;
 *   meeting      the meeting asked for (`event`), else the next meeting or call
 *                with a start, else null;
 *   last_met     the latest meeting or call before now, else null;
 *   timeline     the five latest logged steps, newest first;
 *   deck         each link made for them (D1565), its views, read time and
 *                the follow-up signals of its views (D1568, `signalsForLinks`);
 *   objections   what they raised first (`of_prospect` > 0, D1582's count),
 *                then up to three the venture heard from others.
 *
 * A part that cannot be read says so (`state: 'unreadable'`) and the rest of
 * the brief still answers; an unreadable part never reads as "none".
 *
 * THE SHAPE IS A CONTRACT. F3's ranking (#3829) and F9's `raise.prospect_brief`
 * (#3835) read this object; add fields, never rename or drop one.
 *
 * `objections_extract` (from a meeting bot's transcript) is deferred: the
 * meeting bot is not deployed.
 */
import type { Env } from '../types';
import { signalsForLinks, type SignalKind } from './raiseSignals';
import { readObjections, type Objection } from './narrative/objections';

export const TIMELINE_MAX = 5;
export const ELSEWHERE_MAX = 3;
export const LINKS_MAX = 10;
export const BRIEF_BASIS = 'Read from Capital relationships, your deck links and the feedback you logged. No model ran.';

type Part<T> = ({ state: 'ok' } & T) | { state: 'unreadable' };

export type ProspectBrief = {
  prospect: { id: number; name: string | null; firm: string | null; stage: string; warm_path: string | null; next_step: string | null; next_step_due: string | null };
  meeting: { event_id: number; kind: 'meeting' | 'call'; starts_at: string; note: string | null } | null;
  last_met: { event_id: number; kind: 'meeting' | 'call'; at: string } | null;
  timeline: Part<{ items: Array<{ kind: string; note: string | null; at: string }> }>;
  deck: Part<{ links: Array<{
    link_id: number; deck_id: number; deck_title: string | null; sent_at: string | null; revoked: boolean;
    views: number; read_seconds: number; last_viewed_at: string | null;
    signals: Array<{ kind: SignalKind; at: string; words: string }>;
  }> }>;
  objections: Part<{ theirs: Objection[]; elsewhere: Objection[] }>;
  basis: string;
};

type ProspectRow = { id: number; name: string | null; firm: string | null; stage: string | null; warm_path: string | null; next_step: string | null; next_step_due: string | null };
type EventRow = { id: number; kind: string; note: string | null; starts_at: string | null; created_at: string; done_at: string | null };

const MEETING_KINDS = new Set(['meeting', 'call']);
const trimmed = (v: unknown) => { const s = String(v ?? '').trim(); return s ? s : null; };

/**
 * The brief for `prospectId` of `projectId`, or null when the prospect is not
 * this venture's. `eventId` names the meeting being prepared (the calendar
 * item's step); one that is not this prospect's meeting or call is ignored.
 */
export async function prospectBrief(env: Env, projectId: number, prospectId: number, o: { eventId?: number | null; now?: Date } = {}): Promise<ProspectBrief | null> {
  const p = await env.DB.prepare(
    `SELECT id, name, firm, stage, warm_path, next_step, next_step_due FROM raise_prospects WHERE id = ? AND project_id = ?`,
  ).bind(prospectId, projectId).first<ProspectRow>();
  if (!p) return null;
  const now = (o.now ?? new Date()).toISOString();

  let events: EventRow[] | null = null;
  try {
    events = (await env.DB.prepare(
      `SELECT id, kind, note, starts_at, created_at, done_at FROM raise_prospect_events WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`,
    ).bind(prospectId).all<EventRow>()).results ?? [];
  } catch { events = null; }

  const meetings = (events ?? []).filter((e) => MEETING_KINDS.has(e.kind) && e.starts_at);
  const asked = o.eventId != null ? meetings.find((e) => Number(e.id) === Number(o.eventId)) ?? null : null;
  const next = asked ?? meetings.filter((e) => String(e.starts_at) >= now).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0] ?? null;
  const last = meetings.filter((e) => String(e.starts_at) < now && (!next || e.id !== next.id))
    .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)))[0] ?? null;

  return {
    prospect: {
      id: Number(p.id), name: trimmed(p.name), firm: trimmed(p.firm), stage: p.stage || 'to_contact',
      warm_path: trimmed(p.warm_path), next_step: trimmed(p.next_step), next_step_due: trimmed(p.next_step_due),
    },
    meeting: next ? { event_id: Number(next.id), kind: next.kind as 'meeting' | 'call', starts_at: String(next.starts_at), note: trimmed(next.note) } : null,
    last_met: last ? { event_id: Number(last.id), kind: last.kind as 'meeting' | 'call', at: String(last.starts_at) } : null,
    timeline: events == null ? { state: 'unreadable' } : {
      state: 'ok',
      items: events.slice(0, TIMELINE_MAX).map((e) => ({ kind: e.kind, note: trimmed(e.note), at: String(e.starts_at || e.created_at) })),
    },
    deck: await deckPart(env, projectId, prospectId),
    objections: await objectionPart(env, projectId, prospectId),
    basis: BRIEF_BASIS,
  };
}

async function deckPart(env: Env, projectId: number, prospectId: number): Promise<ProspectBrief['deck']> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT t.id, t.deck_id, d.title, t.created_at, t.revoked_at, t.last_viewed_at,
              (SELECT COUNT(*) FROM deck_share_views v WHERE v.share_token_id = t.id) AS views,
              (SELECT COALESCE(SUM(v.read_seconds), 0) FROM deck_share_views v WHERE v.share_token_id = t.id) AS read_seconds
         FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
        WHERE d.project_id = ? AND t.prospect_id = ?
        ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    ).bind(projectId, prospectId, LINKS_MAX).all<{
      id: number; deck_id: number; title: string | null; created_at: string | null; revoked_at: string | null; last_viewed_at: string | null; views: number; read_seconds: number;
    }>()).results ?? [];
    const signals = await signalsForLinks(env, rows.map((r) => Number(r.id)));
    return {
      state: 'ok',
      links: rows.map((r) => ({
        link_id: Number(r.id), deck_id: Number(r.deck_id), deck_title: trimmed(r.title), sent_at: r.created_at ?? null, revoked: !!r.revoked_at,
        views: Number(r.views), read_seconds: Number(r.read_seconds), last_viewed_at: r.last_viewed_at ?? null,
        signals: signals.get(Number(r.id)) ?? [],
      })),
    };
  } catch { return { state: 'unreadable' }; }
}

async function objectionPart(env: Env, projectId: number, prospectId: number): Promise<ProspectBrief['objections']> {
  try {
    const read = await readObjections(env, projectId, prospectId);
    const theirs = read.items.filter((x) => Number(x.of_prospect ?? 0) > 0)
      .sort((a, b) => Number(b.of_prospect) - Number(a.of_prospect) || b.count - a.count || a.text.localeCompare(b.text));
    const elsewhere = read.items.filter((x) => Number(x.of_prospect ?? 0) === 0).slice(0, ELSEWHERE_MAX);
    return { state: 'ok', theirs, elsewhere };
  } catch { return { state: 'unreadable' }; }
}

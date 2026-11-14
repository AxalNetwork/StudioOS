/**
 * D1568 (#3815, deck v2 D7) — follow-up signals from an investor's views.
 *
 * The share heartbeat (`POST /api/decks/share/:token/heartbeat`) calls
 * `recordViewSignals` once its read time and slide totals are stored. A view
 * of a link made for a prospect (D1565's per-investor links) may write:
 *
 *   first_view   the link's first view that was read (one per link);
 *   revisit      a view opened 48 hours or more after the link's previous
 *                read view (one per view); a view never read is not a visit;
 *   reached_ask  a view whose read cards include the version's ask card or a
 *                card after it (`askCardIndex`, one per link).
 *
 * Each new signal (the unique indexes of migration 740 make a repeated
 * heartbeat a no-op) leaves three things, and none of them changes a record:
 *
 *   · an in-app notice to the founder who made the link;
 *   · an `after_view` email draft for the prospect (`mail_drafts`, D1341),
 *     written from a template: no model, no charge, and no seconds and no
 *     figure in its words. The founder edits and sends it, or not;
 *   · when the prospect's stage is behind what the signal suggests, a stage
 *     PROPOSAL on the rail (`ai_rail_proposals`, option `signal:stage`, record
 *     `prospect:<id>`). The prospect's stage changes only when the founder
 *     presses Accept and the record's own route saves it: this file never
 *     writes `raise_prospects.stage`. A proposal already waiting for that
 *     prospect is not repeated.
 *
 * The stage it proposes only ever moves forward: a first view of someone
 * still `to_contact` proposes `contacted`; a revisit or the ask reached by
 * someone `to_contact` or `contacted` proposes `meeting`. Later stages
 * (meeting, diligence, committed) are never proposed back or forward here.
 *
 * Nothing here fails a heartbeat: every write is caught, and logs carry the
 * signal kind only, never a name, an email or a figure.
 */
import type { Env } from '../types';
import { askCardIndex } from './decks/shareAnalytics';
import { proposeRail } from './railProposals';

export const REVISIT_AFTER_HOURS = 48;
export const SIGNAL_KINDS = ['first_view', 'revisit', 'reached_ask'] as const;
export type SignalKind = typeof SIGNAL_KINDS[number];

/** The words each signal shows: on the investor row (pd35's TAG) and in the visit timeline (pd37). */
export const SIGNAL_WORDS: Readonly<Record<SignalKind, string>> = Object.freeze({
  first_view: 'Opened',
  revisit: 'Revisited after 48 h',
  reached_ask: 'Reached the ask',
});

export const SIGNAL_RAIL = { page: 'Founder · Raise · Capital relationships', option: 'signal:stage' } as const;

type ViewRow = {
  view_id: number; share_token_id: number; view_at: string; deck_id: number; project_id: number;
  prospect_id: number | null; created_by: number | null; slides: string | null;
  prospect_row: number | null; prospect_name: string | null; stage: string | null;
};

const toMs = (sqlTime: string) => Date.parse(String(sqlTime).replace(' ', 'T') + (/[zZ+]/.test(String(sqlTime).slice(10)) ? '' : 'Z'));

/** The stage a signal suggests for a prospect at `stage`, or null when the stage is already there or past it. */
export function proposedStage(kind: SignalKind, stage: string | null): string | null {
  const at = stage || 'to_contact';
  if (kind === 'first_view') return at === 'to_contact' ? 'contacted' : null;
  return at === 'to_contact' || at === 'contacted' ? 'meeting' : null;
}

/** The `after_view` draft's words: a greeting by first name, no seconds, no figures. */
export function afterViewDraft(kind: SignalKind, prospectName: string | null): { subject: string; body: string } {
  const first = String(prospectName || '').trim().split(/\s+/)[0]?.replace(/[0-9]/g, '') || '';
  const hello = first ? `Hi ${first},` : 'Hi,';
  const line = kind === 'reached_ask'
    ? 'Thank you for reading through to the round. I would be glad to walk you through it and answer any questions.'
    : kind === 'revisit'
      ? 'Thank you for coming back to the deck. Is there anything I can clarify, or a part you would like to go through together?'
      : 'Thank you for opening the deck. I would be glad to hear your first thoughts, and to set up a short call if it is useful.';
  return { subject: 'Following up on our deck', body: `${hello}\n\n${line}\n\nBest regards` };
}

/** The kinds this view newly earns, from the view, the link's previous view and the cards read. */
export function signalKinds(o: { isFirst: boolean; previousAt: string | null; viewAt: string; askIndex: number | null; readSlides: number[] }): SignalKind[] {
  const out: SignalKind[] = [];
  if (o.isFirst) out.push('first_view');
  if (!o.isFirst && o.previousAt && toMs(o.viewAt) - toMs(o.previousAt) >= REVISIT_AFTER_HOURS * 3_600_000) out.push('revisit');
  if (o.askIndex != null && o.readSlides.some((i) => i >= o.askIndex!)) out.push('reached_ask');
  return out;
}

export type RecordedSignal = { uid: string; kind: SignalKind; draft_uid: string | null; proposal_uid: string | null };

/**
 * After a heartbeat: the signals this view newly earns, each with its notice,
 * draft and proposal. `readSlides` are the slide indexes the heartbeat
 * reported read. Answers what it wrote; never throws.
 */
export async function recordViewSignals(env: Env, viewId: number, deckId: number, readSlides: number[]): Promise<RecordedSignal[]> {
  let v: ViewRow | null;
  try {
    v = await env.DB.prepare(
      `SELECT sv.id AS view_id, sv.share_token_id, sv.created_at AS view_at, sv.deck_id, d.project_id, t.prospect_id, t.created_by, d.slides,
              p.id AS prospect_row, p.name AS prospect_name, p.stage
         FROM deck_share_views sv
         JOIN pitch_deck_share_tokens t ON t.id = sv.share_token_id
         JOIN pitch_decks d ON d.id = sv.deck_id
         LEFT JOIN raise_prospects p ON p.id = t.prospect_id AND p.project_id = d.project_id
        WHERE sv.id = ? AND sv.deck_id = ?`,
    ).bind(viewId, deckId).first<ViewRow>();
  } catch { return []; }
  // A link made for no prospect (a typed name, D902), or for one of another venture, has no one to signal.
  if (!v || v.prospect_id == null || v.prospect_row == null) return [];
  const prospectId = Number(v.prospect_id);
  let previous: { created_at: string } | null = null;
  try {
    // A view that was opened and never read (no heartbeat) is not a visit: it neither is the first nor starts the 48 hours.
    previous = await env.DB.prepare('SELECT created_at FROM deck_share_views WHERE share_token_id = ? AND id < ? AND read_seconds > 0 ORDER BY id DESC LIMIT 1')
      .bind(v.share_token_id, v.view_id).first<{ created_at: string }>();
  } catch { return []; }
  let slides: unknown = [];
  try { slides = JSON.parse(v.slides || '[]'); } catch { slides = []; }
  const kinds = signalKinds({ isFirst: !previous, previousAt: previous?.created_at ?? null, viewAt: v.view_at, askIndex: askCardIndex(slides), readSlides });
  const out: RecordedSignal[] = [];
  for (const kind of kinds) {
    const uid = crypto.randomUUID();
    let fresh = false;
    try {
      const ins = await env.DB.prepare(
        `INSERT OR IGNORE INTO raise_prospect_signals (uid, project_id, prospect_id, share_token_id, deck_id, view_id, kind, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid, Number(v.project_id), prospectId, v.share_token_id, v.deck_id, v.view_id, kind, v.view_at).run();
      fresh = Number((ins as any)?.meta?.changes ?? 0) === 1;
    } catch { fresh = false; }
    if (!fresh) continue;
    const founder = await founderOf(env, v);
    const draftUid = founder ? await writeDraft(env, founder, prospectId, kind, v.prospect_name) : null;
    const proposalUid = founder ? await proposeStage(env, founder, prospectId, kind, v.stage, uid) : null;
    try {
      await env.DB.prepare('UPDATE raise_prospect_signals SET draft_uid = ?, proposal_uid = ? WHERE uid = ?').bind(draftUid, proposalUid, uid).run();
    } catch { /* the signal stands without its links */ }
    if (founder) await notifySignal(env, founder, v, kind);
    console.info(`[raise-signal] ${kind}`);
    out.push({ uid, kind, draft_uid: draftUid, proposal_uid: proposalUid });
  }
  return out;
}

/** Who hears of it: the member who made the link, else the venture's founder account. */
async function founderOf(env: Env, v: ViewRow): Promise<number | null> {
  if (v.created_by != null && Number(v.created_by) > 0) return Number(v.created_by);
  try {
    const r = await env.DB.prepare(
      "SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ? AND u.role = 'founder' ORDER BY u.id LIMIT 1",
    ).bind(Number(v.project_id)).first<{ id: number }>();
    return r ? Number(r.id) : null;
  } catch { return null; }
}

async function writeDraft(env: Env, userId: number, prospectId: number, kind: SignalKind, name: string | null): Promise<string | null> {
  const d = afterViewDraft(kind, name);
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO mail_drafts (uid, user_id, person_ref, intent, tone, length, refs_json, blocks_json, subject, body)
       VALUES (?, ?, ?, 'after_view', 'warm', 'short', '[]', '[]', ?, ?)`,
    ).bind(uid, userId, `prospect:${prospectId}`, d.subject, d.body).run();
    return uid;
  } catch { return null; }
}

async function proposeStage(env: Env, userId: number, prospectId: number, kind: SignalKind, stage: string | null, signalUid: string): Promise<string | null> {
  const to = proposedStage(kind, stage);
  if (!to) return null;
  try {
    const open = await env.DB.prepare(
      "SELECT uid FROM ai_rail_proposals WHERE user_id = ? AND rail_option = ? AND record_ref = ? AND status = 'proposed' LIMIT 1",
    ).bind(userId, SIGNAL_RAIL.option, `prospect:${prospectId}`).first<{ uid: string }>();
    if (open) return null;
    const row = await proposeRail(env, {
      userId, page: SIGNAL_RAIL.page, option: SIGNAL_RAIL.option, record: `prospect:${prospectId}`, kind: 'proposal',
      payload: { prospect_id: prospectId, stage_from: stage || 'to_contact', stage_to: to, signal: kind, signal_uid: signalUid, words: SIGNAL_WORDS[kind] },
    });
    return row.uid;
  } catch { return null; }
}

async function notifySignal(env: Env, userId: number, v: ViewRow, kind: SignalKind): Promise<void> {
  try {
    const { notify } = await import('./notify');
    const who = String(v.prospect_name || '').trim() || 'An investor';
    await notify(env, {
      userId, type: 'raise_prospect_signal', category: 'deals', channels: ['in_app'],
      title: `${who}: ${SIGNAL_WORDS[kind].toLowerCase()}`,
      body: 'A follow-up draft is ready for you to edit and send.',
      link: '/raise/pitch',
      payload: { prospect_id: Number(v.prospect_id), deck_id: v.deck_id, signal: kind },
    });
  } catch { /* a notice that cannot be sent never undoes the signal */ }
}

/** The signals of each link, oldest first, for the investor row and the visit timeline. */
export async function signalsForLinks(env: Pick<Env, 'DB'>, linkIds: number[]): Promise<Map<number, Array<{ kind: SignalKind; at: string; words: string }>>> {
  const out = new Map<number, Array<{ kind: SignalKind; at: string; words: string }>>();
  if (!linkIds.length) return out;
  try {
    const rows = (await env.DB.prepare(
      `SELECT share_token_id, kind, occurred_at FROM raise_prospect_signals
        WHERE share_token_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY occurred_at, id`,
    ).bind(JSON.stringify(linkIds)).all<{ share_token_id: number; kind: SignalKind; occurred_at: string }>()).results || [];
    for (const r of rows) {
      const list = out.get(Number(r.share_token_id)) ?? [];
      list.push({ kind: r.kind, at: r.occurred_at, words: SIGNAL_WORDS[r.kind] ?? r.kind });
      out.set(Number(r.share_token_id), list);
    }
  } catch { /* no signal store here: no signals */ }
  return out;
}

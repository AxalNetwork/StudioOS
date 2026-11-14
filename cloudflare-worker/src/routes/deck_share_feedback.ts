/**
 * D6064 (#6064) — the founder's read of what viewers sent back through a share
 * link: per-card reactions and the written feedback, by link (Share & analytics, ps7).
 *
 *   GET /api/decks/:id/share-feedback?version=N   → { deck_id, cap, truncated, items, discovery_mirror }
 *
 * THE STORE. `deck_share_feedback` (migration 071, `slide_reactions_by_uid`
 * from 714), written by `POST /api/decks/share/:token/feedback`
 * (`deck_share_actions.ts`). The table is also made at runtime by that file's
 * `ensureDeckShareConversionSchema`, which this read calls first; a table or
 * column still missing after it reads as no feedback, never a 500.
 *
 * THE READ. The venture's feedback across its versions (or one, `version=N`),
 * newest first, at most `FEEDBACK_CAP` rows: `truncated` says when there were
 * more. Each item is `{ id, created_at, deck_id, version, link, viewer,
 * reactions, note, problem_fit, willingness_to_pay }`. `link` is the investor
 * link it came through, `{ id, investor: { label, fund } }`, found from the
 * feedback's own view or its `feedback` conversion row, and null when neither
 * names a link of that version. `reactions` are `{ card_uid, place, title,
 * reaction }`, keyed by card uid (714) and, for a row written before it, by the
 * place on the cards that link sends. `discovery_mirror: true` because the same
 * POST copies the note into `discovery_interviews`: the Customer Discovery
 * panel shows it too.
 *
 * ANONYMITY. `viewer` is `'signed_in'` or `'anonymous'` and nothing else: no
 * user id, name or email, and not the free-form `contact` field, leaves this
 * read for any row. The link's investor is the founder's own label for the link.
 *
 * WHO. `deckFor(c, user, true)`, exactly as `GET /:id/analytics/daily`
 * (`deck_slide_analytics.ts`): the venture's writers, which are its owner and
 * its co-founders; an advisor or another founder is refused 403, an unknown
 * deck 404, no session 401.
 *
 * Mounts itself (#4105), with no `before`: no `decks` route answers this path.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { linkSentCards } from './decks';
import { deckFor } from './deck_investor_links';
import { ensureDeckShareConversionSchema } from './deck_share_actions';
import { assignCardUids, cardUidAt } from '../services/decks/cardUids';
import type { RouteMount } from '../util/routeRegistry';

export const FEEDBACK_CAP = 200;

const deckShareFeedback = new Hono<{ Bindings: Env }>();

type FeedbackRow = {
  id: number; deck_id: number; version: number; user_id: number | null; link_id: number | null;
  slide_reactions: string | null; slide_reactions_by_uid: string | null;
  overall_note: string | null; problem_fit: string | null; willingness_to_pay: string | null; created_at: string | null;
};
type LinkRow = { id: number; deck_id: number; include_json: string | null; variant_id: number | null; investor_label: string | null; prospect_name: string | null; prospect_firm: string | null };

const parseMap = (s: string | null): Record<string, unknown> => {
  try { const v = s ? JSON.parse(s) : null; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};
const missingStore = (e: unknown) => /no such (table|column)/i.test(String((e as Error)?.message || ''));
const reactionOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.slice(0, 40) : null);

function feedbackSql(version: number | null, byUid: boolean) {
  return `SELECT f.id, f.deck_id, d.version, f.user_id, f.slide_reactions, ${byUid ? 'f.slide_reactions_by_uid' : 'NULL AS slide_reactions_by_uid'},
            f.overall_note, f.problem_fit, f.willingness_to_pay, f.created_at,
            COALESCE(v.share_token_id, (SELECT cv.share_token_id FROM deck_share_conversions cv
               WHERE cv.type = 'feedback' AND cv.deck_id = f.deck_id AND cv.ref_id = CAST(f.id AS TEXT) LIMIT 1)) AS link_id
       FROM deck_share_feedback f
       JOIN pitch_decks d ON d.id = f.deck_id
       LEFT JOIN deck_share_views v ON v.id = f.view_id AND v.deck_id = f.deck_id
      WHERE d.project_id = ?${version == null ? '' : ' AND d.version = ?'}
      ORDER BY f.created_at DESC, f.id DESC LIMIT ${FEEDBACK_CAP + 1}`;
}

/** The venture's feedback rows, newest first, one past the cap; [] when the store is not there. */
async function feedbackRows(env: Env, projectId: number, version: number | null): Promise<FeedbackRow[]> {
  const binds = version == null ? [projectId] : [projectId, version];
  try {
    return (await env.DB.prepare(feedbackSql(version, true)).bind(...binds).all<FeedbackRow>()).results || [];
  } catch (e) {
    if (!missingStore(e)) throw e;
  }
  // Migration 714 unapplied: the by-uid column is missing, the rest is still readable. No table at all is no feedback.
  try {
    return (await env.DB.prepare(feedbackSql(version, false)).bind(...binds).all<FeedbackRow>()).results || [];
  } catch (e) {
    if (missingStore(e)) return [];
    throw e;
  }
}

/** The read: rows → items, with each link's investor and each reaction's card. */
export async function shareFeedback(env: Env, projectId: number, version: number | null) {
  await ensureDeckShareConversionSchema(env);
  const all = await feedbackRows(env, projectId, version);
  const rows = all.slice(0, FEEDBACK_CAP);

  const linkIds = [...new Set(rows.map((r) => Number(r.link_id)).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const links = new Map<number, LinkRow>();
  if (linkIds.length) {
    const got = (await env.DB.prepare(
      `SELECT t.id, t.deck_id, t.include_json, t.variant_id, t.investor_label, p.name AS prospect_name, p.firm AS prospect_firm
         FROM pitch_deck_share_tokens t LEFT JOIN raise_prospects p ON p.id = t.prospect_id
        WHERE t.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    ).bind(JSON.stringify(linkIds)).all<LinkRow>()).results || [];
    for (const l of got) links.set(Number(l.id), l);
  }

  const deckIds = [...new Set(rows.map((r) => Number(r.deck_id)))];
  const decks = new Map<number, any>();
  if (deckIds.length) {
    const got = (await env.DB.prepare('SELECT * FROM pitch_decks WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND project_id = ?')
      .bind(JSON.stringify(deckIds), projectId).all<any>()).results || [];
    for (const d of got) decks.set(Number(d.id), d);
  }

  // The cards each (version, link) sends, computed once; a reaction by place names a card of that list.
  const sent = new Map<string, any[]>();
  async function sentCards(deckRow: any, link: LinkRow | null) {
    const key = `${deckRow.id}:${link?.id ?? ''}`;
    if (!sent.has(key)) {
      let cards: any[] = [];
      try { cards = await linkSentCards(env, deckRow, link); } catch { cards = []; }
      sent.set(key, assignCardUids(cards));
    }
    return sent.get(key)!;
  }

  const items = [];
  for (const r of rows) {
    const deckRow = decks.get(Number(r.deck_id)) ?? null;
    const lr = r.link_id == null ? null : links.get(Number(r.link_id)) ?? null;
    // A link of another version (or deck) never names this feedback.
    const link = lr && Number(lr.deck_id) === Number(r.deck_id) ? lr : null;
    const cards = deckRow ? await sentCards(deckRow, link) : [];
    const titleOf = (uid: string | null) => (uid ? cards.find((c) => c.uid === uid)?.title ?? null : null);
    const placeOf = (uid: string | null) => { const i = uid ? cards.findIndex((c) => c.uid === uid) : -1; return i < 0 ? null : i; };

    const reactions: Array<{ card_uid: string | null; place: number | null; title: string | null; reaction: string }> = [];
    const byUid = parseMap(r.slide_reactions_by_uid);
    if (Object.keys(byUid).length) {
      for (const [uid, v] of Object.entries(byUid)) {
        const reaction = reactionOf(v);
        if (reaction) reactions.push({ card_uid: uid, place: placeOf(uid), title: titleOf(uid), reaction });
      }
    } else {
      for (const [k, v] of Object.entries(parseMap(r.slide_reactions))) {
        const reaction = reactionOf(v);
        if (!reaction || !/^(0|[1-9][0-9]{0,2})$/.test(k)) continue;
        const uid = cardUidAt(cards, Number(k));
        reactions.push({ card_uid: uid, place: Number(k), title: titleOf(uid), reaction });
      }
    }
    reactions.sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9));

    items.push({
      id: Number(r.id),
      created_at: r.created_at,
      deck_id: Number(r.deck_id),
      version: r.version == null ? null : Number(r.version),
      link: link ? { id: Number(link.id), investor: { label: link.prospect_name || link.investor_label || null, fund: link.prospect_firm || null } } : null,
      // Signed in or not, and nothing more: never the account, nor the contact the POST accepts.
      viewer: r.user_id == null ? 'anonymous' as const : 'signed_in' as const,
      reactions,
      note: r.overall_note || null,
      problem_fit: r.problem_fit || null,
      willingness_to_pay: r.willingness_to_pay || null,
    });
  }
  return { cap: FEEDBACK_CAP, truncated: all.length > FEEDBACK_CAP, discovery_mirror: true, items };
}

deckShareFeedback.get('/:id{[0-9]+}/share-feedback', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if ('refused' in got) return got.refused;
  const raw = c.req.query('version');
  let version: number | null = null;
  if (raw != null && raw !== '') {
    version = Number(raw);
    if (!Number.isSafeInteger(version) || version < 1) return refuse(c, 422, { code: 'bad_version', message: 'There is no such version.' });
  }
  try {
    return c.json({ deck_id: Number(got.row.id), ...(await shareFeedback(c.env, Number(got.row.project_id), version)) });
  } catch (e) {
    console.error('[deck_share_feedback] read failed:', (e as Error)?.name || 'error');
    return c.json({ state: 'unreadable', detail: "Feedback couldn't be read." }, 500);
  }
});

export default deckShareFeedback;

export const mount: RouteMount = { path: '/api/decks', router: deckShareFeedback };

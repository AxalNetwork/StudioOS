/**
 * D5791 (#5791, deck v2 F11 follow-up) — an investor plays the walkthrough
 * attached to their share link.
 *
 *   GET /api/decks/share/:token/walkthrough                 → { attached, takes: [shared take] }
 *   GET /api/decks/share/:token/walkthrough/:uid/media      → the take's file (Range answered, `private, no-store`)
 *
 * The founder records a take per card (`routes/deck_recordings.ts`, D1590) and
 * attaches the walkthrough to one investor link (`deck_recording_links`). This
 * is the only public read of it, and it serves that link only.
 *
 * The checks, in this order, each refusing before the next is read:
 *
 *   1. the token: signed, unexpired, scoped to a deck version (403 / 410 / 400).
 *   2. the link: live (not withdrawn, not run out) and this browser's when
 *      forwarding is off (`bindShareViewer`, `shareLinkLive`): 403
 *      `forwarding_off`, 410 `link_closed`.
 *   3. the reader's consent: a published link's email gate (`emailGatePassed`,
 *      403 `email_required`), then the link's NDA, accepted on this link by
 *      the signed-in reader (`ndaGate`, 403 `nda_required` with the gate's
 *      answer). The same gates, in the same order, as the share read.
 *   4. the attachment: a `deck_recording_links` row for exactly this link and
 *      this version. None answers `{ attached: false, takes: [] }`.
 *   5. the switch: `deck:walkthrough` as the walkthrough's maker reads it
 *      (`flagsFor(maker)`): the member routes read it for the maker, so the
 *      walkthrough plays only while its maker could still record it. Off
 *      answers 404 `not_switched_on`. An anonymous viewer has no flags of their
 *      own, and HQ's global row is one of the rows the maker's read consults.
 *   6. the takes: the maker's newest take of each card the link sends: a card
 *      hidden from the version, or an appendix card on a link without sources,
 *      plays nothing (`shareSlides`). Each take names its card by uid, so a
 *      variant's order places it.
 *
 * A take carries its card, number, length, type and captions, and nothing of
 * the member (no caption model, charge, size or date). The media route serves
 * a take only when it is one of those takes. Nothing here uses a view.
 * Rate-limited per IP (`deck_share_walkthrough`, `middleware/rateLimit.ts`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { bindShareViewer, ndaGate, rowToDeck, sha256Hex, shareLinkLive, verifySignedToken } from './decks';
import { emailGatePassed, linkStandsFor } from './deck_publish';
import { gateFor, publishOf } from '../services/decks/publish';
import { parseShareInclude, shareSlides } from '../services/decks/shareInclude';
import { flagsFor, notSwitchedOn } from '../services/featureFlags';
import { sharedWalkthroughOf, type TakeRow } from '../services/decks/recordings';

const deckShareWalkthrough = new Hono<{ Bindings: Env }>();

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLOSED = { code: 'link_closed', message: 'This link is no longer open.' } as const;
const NOT_FOUND = { code: 'not_found', message: 'There is no walkthrough for this card on this link.' } as const;

type LinkRow = { id: number; deck_id: number; nda_required: number | null; include_json: string | null };
type Walkthrough = { attached: false } | { attached: true; takes: ReturnType<typeof sharedWalkthroughOf>; rows: TakeRow[] };

/** Steps 1 to 6: the link's walkthrough, or the refusal. */
async function walkthroughFor(c: any): Promise<Walkthrough | Response> {
  const token = c.req.param('token');
  let payload: any;
  try { payload = await verifySignedToken(c.env, token); }
  catch (e: any) {
    if (/expired/i.test(String(e?.message || ''))) return refuse(c, 410, CLOSED);
    return refuse(c, 403, { code: 'forbidden', message: 'This share link is not valid.', raw: e });
  }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return refuse(c, 400, { code: 'bad_token_scope', message: 'This share link is not valid.' });
  const deckId = Number(m[1]);
  const hash = await sha256Hex(token);

  // 2. The link: live, and this browser's.
  const bind = await bindShareViewer(c, hash);
  if (bind.refused) return refuse(c, 403, { code: 'forwarding_off', message: 'This link was sent to someone else.' });
  if (bind.setCookie) c.header('Set-Cookie', bind.setCookie);
  const live = await shareLinkLive(c.env, hash, bind.viewerHash);
  if (!live || live.deck_id !== deckId) return refuse(c, 410, CLOSED);
  const link = await c.env.DB.prepare('SELECT id, deck_id, nda_required, include_json FROM pitch_deck_share_tokens WHERE id = ?')
    .bind(live.id).first() as LinkRow | null;
  if (!link) return refuse(c, 410, CLOSED);

  // 3. The reader's consent: the published link's email gate, then the NDA, as the share read applies them.
  const stored = publishOf(link.include_json);
  if (stored && gateFor(stored) === 'email' && await linkStandsFor(c.env, deckId)
    && !(await emailGatePassed(c.env, c.req.header('cookie'), Number(link.id)))) {
    return refuse(c, 403, { code: 'email_required', message: 'Enter your email on this link first.' });
  }
  const ndaRequired = Number(link.nda_required ?? 0) === 1;
  if (ndaRequired) {
    const gate = await ndaGate(c, Number(link.id), deckId);
    if (gate) return refuse(c, 403, { code: 'nda_required', message: 'Accept the NDA on this link first.', extra: gate });
  }

  // 4. The attachment: this link, this version.
  const attached = await c.env.DB.prepare('SELECT user_id FROM deck_recording_links WHERE share_token_id = ? AND deck_id = ?')
    .bind(Number(link.id), deckId).first() as { user_id: number } | null;
  if (!attached) return { attached: false };
  const makerId = Number(attached.user_id);

  // 5. The switch, as the maker reads it.
  const maker = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(makerId).first() as { id: number; role: string } | null;
  if (!maker) return { attached: false };
  if (!(await flagsFor(c.env, maker as any)).on('deck:walkthrough')) return refuse(c, 404, notSwitchedOn);

  // 6. The maker's takes of the cards this link sends.
  const deck = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(deckId).first() as any;
  if (!deck) return refuse(c, 410, CLOSED);
  const cards = rowToDeck(deck).slides || [];
  const sentUids = new Set<string>(shareSlides(cards, parseShareInclude(link.include_json)).map((s: any) => String(s.uid)));
  const rows = ((await c.env.DB.prepare('SELECT * FROM deck_recordings WHERE deck_id = ? AND user_id = ? ORDER BY card, take')
    .bind(deckId, makerId).all()).results || []) as TakeRow[];
  return { attached: true, takes: sharedWalkthroughOf(rows, cards, sentUids), rows };
}

deckShareWalkthrough.get('/share/:token/walkthrough', async (c) => {
  const w = await walkthroughFor(c);
  if (w instanceof Response) return w;
  c.header('Cache-Control', 'private, no-store');
  return c.json(w.attached ? { attached: true, takes: w.takes } : { attached: false, takes: [] });
});

/** One `bytes=a-b` range of a file `size` bytes long: the slice, null for the whole file, or 'unsatisfiable'. */
export function byteRange(header: string | null | undefined, size: number): { offset: number; length: number } | null | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2]) || !(size > 0)) return null;
  if (!m[1]) {
    const tail = Math.min(Number(m[2]), size);
    return tail > 0 ? { offset: size - tail, length: tail } : 'unsatisfiable';
  }
  const start = Number(m[1]);
  if (start >= size) return 'unsatisfiable';
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (end < start) return 'unsatisfiable';
  return { offset: start, length: end - start + 1 };
}

deckShareWalkthrough.get('/share/:token/walkthrough/:uid/media', async (c) => {
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return refuse(c, 404, NOT_FOUND);
  const w = await walkthroughFor(c);
  if (w instanceof Response) return w;
  // Only a take this link plays: attached, the maker's newest of a card the link sends.
  if (!w.attached || !w.takes.some((t) => t.uid === uid)) return refuse(c, 404, NOT_FOUND);
  const row = w.rows.find((r) => r.uid === uid);
  if (!row || !c.env.FILES) return refuse(c, 404, NOT_FOUND);
  const size = Number(row.media_bytes);
  const headers: Record<string, string> = {
    'content-type': row.media_mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
  };
  const range = byteRange(c.req.header('range'), size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  const obj = await c.env.FILES.get(row.media_r2_key, range ? { range } : undefined);
  if (!obj) return refuse(c, 404, NOT_FOUND);
  if (range) {
    return new Response(obj.body, { status: 206, headers: { ...headers, 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`, 'content-length': String(range.length) } });
  }
  return new Response(obj.body, { headers: { ...headers, 'content-length': String(size) } });
});

export default deckShareWalkthrough;

/** `/api/decks`, before `decks`, whose `/:id` routes must not answer a share path. */
export const mount: RouteMount = { path: '/api/decks', router: deckShareWalkthrough, before: [decks] };

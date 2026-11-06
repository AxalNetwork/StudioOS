/**
 * D1540 (#3791, deck v2 B15) — a founder reports a bad result, and HQ reads
 * and resolves the reports.
 *
 *   POST /api/decks/proposals/:uid/report        { reason, note? }
 *        → 201 { report } ; 409 already_reported with { report } when this
 *          member already reported this result
 *   GET  /api/admin/deck-reports?status=open|resolved|all&model=&reason=
 *        → { reports: [{ uid, proposal_uid, record_ref, rail_option, model,
 *            usage_log_id, charged_microusd, reason, note, status, outcome,
 *            resolution_note, resolved_at, created_at, proposal,
 *            founder: { uid, name } | null, deck: { uid, title, version } | null,
 *            card: { index, label } | null, asked, before, after }],
 *            counts: { open, resolved_this_week } }
 *   POST /api/admin/deck-reports/:uid/resolve    { outcome: addressed|no_fault, note }
 *        → { report } ; 400 note_required ; 409 already_resolved
 *
 * #4188 (K1 of D4155) adds the queue's names and words, read at query time
 * from what is already stored (no migration):
 *   · `founder` is the member who filed it, by `users.uid` and name, never an
 *     email; null when the account is gone.
 *   · `deck` is the version the result was made on (`record_ref` `deck:<id>`,
 *     or the payload's `deck_id`): `uid` is that `pitch_decks.id` as text
 *     (versions have no uid column), with its title and version number.
 *   · `card` is the card the payload names, `index` from 0 as every deck
 *     route counts, `label` "Card 4 · Traction" from that version's slide
 *     title (or the catalogue's title for the slide's kind).
 *   · `asked` is the press in the editor's words (Shorten, Change tone ·
 *     warm, an instruction as typed) from the payload's action, or the rail
 *     option for a new-deck run; `before` and `after` are the area's words
 *     from the payload. Each is null when not recorded, never "".
 *   · `counts` reads the whole queue, not the filters: open now, and resolved
 *     since Monday 00:00 UTC. Each count is null when its read fails, never 0.
 * #4375 adds `images`: the deck images the result and its card name, each
 *   `{ uid, url, taken_down }`, at most REPORT_IMAGES_MAX, which HQ can take down
 *   (`POST /api/admin/deck-images/:uid/takedown`, `admin_deck_images.ts`).
 * The resolution note is required (at least NOTE_MIN characters, trimmed):
 * the founder reads it on their report. The audit row keeps it and names the
 * admin.
 *
 * WHAT CAN BE REPORTED. A deck rail proposal (`ai_rail_proposals`, the result
 * cards of `AreaResults.jsx`) that is the caller's own, decided or not. Any
 * other uid, or another member's, answers 404 the same way, so a uid is never
 * confirmed to exist. The option, model and usage row are copied onto the
 * report (`deck_proposal_reports`, migration 733) so HQ reads what ran.
 *
 * WHAT A REPORT DOES NOT DO. It refunds nothing and changes no proposal. A
 * run that failed was never charged (D844: released on throw, timeout or
 * cancel); a refund for a result that ran is HQ's call through the token
 * ledger's own adjustment (`/api/ai-budget`), never this route.
 *
 * WHO. The report: the member whose proposal it is, never a support session
 * on their behalf. The queue: an HQ administrator (`requireHqAdmin`); every
 * read and every resolution is in the admin audit log. The founder's note is
 * shown to HQ and never logged; HQ's resolution note is logged with the
 * admin's name.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireHqAdmin } from '../auth';
import { isSupportSession } from '../integrations/providers/mercury';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { NEW_DECK_RAIL } from './deck_new';
import { CARD_CATALOGUE } from '../services/decks/newDeck';
import { cardIndexOf } from '../services/decks/cardUids';
import type { RouteMount } from '../util/routeRegistry';
import decks from './decks';

/** The reasons a founder picks from, in the words the card shows. */
export const REPORT_REASONS = Object.freeze({
  wrong_figure: 'States something my records do not',
  poor_writing: 'Badly written or unusable',
  wrong_place: 'Put in the wrong place',
  bad_image: 'The picture is wrong',
  unsafe: 'Offensive or unsafe',
  other: 'Something else',
} as const);
export type ReportReason = keyof typeof REPORT_REASONS;
export const NOTE_MAX = 280;
export const RESOLUTION_NOTE_MAX = 500;
/** #4188: the founder reads the resolution note, so it says something. */
export const RESOLUTION_NOTE_MIN = 10;
/** #4188: the longest model id the queue filters by. */
export const MODEL_FILTER_MAX = 200;
export const OUTCOMES = ['addressed', 'no_fault'] as const;

const UID = /^[A-Za-z0-9_-]{1,64}$/;

const reportView = (r: any) => ({
  uid: String(r.uid), proposal_uid: String(r.proposal_uid), record_ref: r.record_ref ?? null, rail_option: String(r.rail_option),
  model: r.model ?? null, usage_log_id: r.usage_log_id == null ? null : Number(r.usage_log_id),
  reason: String(r.reason), reason_label: REPORT_REASONS[r.reason as ReportReason] ?? null, note: r.note ?? null,
  status: String(r.status), outcome: r.outcome ?? null, resolution_note: r.resolution_note ?? null,
  resolved_at: r.resolved_at ?? null, created_at: String(r.created_at),
});

// ─────────────────────────────────────────────────────────── the founder's report

export const deckReports = new Hono<{ Bindings: Env }>();

deckReports.post('/proposals/:uid/report', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return refuse(c, 404, { code: 'not_found', message: 'That result is not one of yours.' });
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot report a result for this member.' });
  const body = await c.req.json().catch(() => null) as { reason?: unknown; note?: unknown } | null;
  const reason = body?.reason;
  if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(REPORT_REASONS, reason)) {
    return refuse(c, 400, { code: 'invalid_reason', message: `Pick a reason: ${Object.keys(REPORT_REASONS).join(', ')}.` });
  }
  const raw = body?.note;
  if (raw != null && typeof raw !== 'string') return refuse(c, 400, { code: 'invalid_note', message: 'The note must be text.' });
  const note = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (note && note.length > NOTE_MAX) return refuse(c, 400, { code: 'note_too_long', message: `The note is at most ${NOTE_MAX} characters.` });

  const userId = Number(user.id) || 0;
  const proposal = await c.env.DB.prepare(
    'SELECT uid, record_ref, rail_option, model, usage_log_id FROM ai_rail_proposals WHERE uid = ? AND user_id = ? AND rail_page = ?',
  ).bind(uid, userId, NEW_DECK_RAIL.page).first<any>();
  if (!proposal) return refuse(c, 404, { code: 'not_found', message: 'That result is not one of yours.' });

  const existing = await c.env.DB.prepare('SELECT * FROM deck_proposal_reports WHERE proposal_uid = ? AND user_id = ?').bind(uid, userId).first<any>();
  if (existing) {
    return refuse(c, 409, { code: 'already_reported', message: 'You already reported this result. HQ will look at it.', extra: { report: reportView(existing) } });
  }
  const reportUid = `dr_${crypto.randomUUID().replace(/-/g, '')}`;
  await c.env.DB.prepare(
    `INSERT INTO deck_proposal_reports (uid, proposal_uid, user_id, record_ref, rail_option, model, usage_log_id, reason, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(reportUid, uid, userId, proposal.record_ref ?? null, String(proposal.rail_option), proposal.model ?? null,
    proposal.usage_log_id ?? null, reason, note).run();
  const row = await c.env.DB.prepare('SELECT * FROM deck_proposal_reports WHERE uid = ?').bind(reportUid).first<any>();
  return c.json({ report: reportView(row) }, 201);
});

// ─────────────────────────────────────────────────────────── HQ's queue

export const hqDeckReports = new Hono<{ Bindings: Env }>();

/** #4188: each press in the editor's words (`areaLightboxModel.js`, `deck_assist`, `deck_transform`). */
export const ASKED_LABELS: Readonly<Record<string, string>> = Object.freeze({
  rewrite: 'Rewrite', shorten: 'Shorten', expand: 'Expand', tone: 'Change tone', translate: 'Translate', ask: 'Instruction',
  headline: 'Headline', chart: 'Chart', table: 'Table', timeline: 'Timeline',
  speaker_notes: 'Speaker notes', proofread: 'Proofread', fix_slide: 'Fix this slide',
});
/** #4188: a new-deck run has no action in its payload; its rail option says what was asked. */
const ASKED_BY_OPTION: Readonly<Record<string, string>> = Object.freeze({ [NEW_DECK_RAIL.outline]: 'Outline', [NEW_DECK_RAIL.build]: 'Build the deck' });

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null);

/** What the founder asked for, or null when neither the payload nor the option says. */
export function askedOf(payload: Record<string, any> | null, railOption: unknown): string | null {
  const action = typeof payload?.action === 'string' ? payload.action : null;
  const label = action && Object.prototype.hasOwnProperty.call(ASKED_LABELS, action) ? ASKED_LABELS[action] : null;
  if (!label) return typeof railOption === 'string' && Object.prototype.hasOwnProperty.call(ASKED_BY_OPTION, railOption) ? ASKED_BY_OPTION[railOption] : null;
  const instruction = text(payload?.instruction);
  if (action === 'ask') return instruction ? `Instruction · “${instruction.trim()}”` : label;
  const detail = action === 'tone' ? text(payload?.tone) : action === 'translate' ? text(payload?.language) : null;
  return detail ? `${label} · ${detail.trim()}` : label;
}

/** The area's words before and after: the assist's own, or a one-card transform's notes or blocks. */
export function wordsOf(payload: Record<string, any> | null): { before: string | null; after: string | null } {
  if (!payload) return { before: null, after: null };
  if (typeof payload.before === 'string' || typeof payload.after === 'string') return { before: text(payload.before), after: text(payload.after) };
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  if (cards.length !== 1) return { before: null, after: null };
  const notes = obj(cards[0]?.notes);
  if (notes) return { before: text(notes.before), after: text(notes.after) };
  const blocks = (Array.isArray(cards[0]?.blocks) ? cards[0].blocks : []).map(obj).filter(Boolean) as Record<string, any>[];
  const join = (k: 'before' | 'after') => text(blocks.map((b) => text(b[k])).filter(Boolean).join('\n\n'));
  return { before: join('before'), after: join('after') };
}

/** The deck version a report's result was made on: `deck:<id>`, or the payload's `deck_id`. */
export function deckIdOf(recordRef: unknown, payload: Record<string, any> | null): number | null {
  const m = typeof recordRef === 'string' ? /^deck:([1-9][0-9]{0,15})$/.exec(recordRef) : null;
  const id = m ? Number(m[1]) : Number(payload?.deck_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The card a payload names, on the version's slides: by uid first, then by place. */
export function cardOf(payload: Record<string, any> | null, slides: unknown[] | null): { index: number; label: string } | null {
  const only = Array.isArray(payload?.cards) && payload.cards.length === 1 ? obj(payload.cards[0]) : null;
  const uid = payload?.card_uid ?? only?.card_uid ?? null;
  const place = payload?.card ?? only?.index ?? null;
  let index = slides && typeof uid === 'string' ? cardIndexOf(slides, uid) : -1;
  if (index < 0) index = Number.isInteger(place) && place >= 0 ? Number(place) : -1;
  if (index < 0) return null;
  const slide = obj(slides?.[index]);
  const kind = typeof slide?.card === 'string' ? slide.card : typeof slide?.type === 'string' ? slide.type : null;
  const title = text(slide?.title)?.trim() ?? (kind ? CARD_CATALOGUE.find((c) => c.card === kind)?.title ?? null : null);
  return { index, label: title ? `Card ${index + 1} · ${title}` : `Card ${index + 1}` };
}

const IMAGE_REF = /\/api\/decks\/images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/file/g;
/** #4375: at most this many images are listed on one report. */
export const REPORT_IMAGES_MAX = 6;

/**
 * #4375: the deck images a report's result and its card name, by uid, for HQ's
 * Take down: the file URLs and `image_id`s in the proposal's payload, then in
 * the card on the version. Order kept, no repeats.
 */
export function reportImageUids(payload: Record<string, any> | null, slides: unknown[] | null, card: { index: number } | null): string[] {
  const out: string[] = [];
  const add = (u: unknown) => { if (typeof u === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(u) && !out.includes(u)) out.push(u); };
  const scan = (v: unknown) => {
    if (v == null) return;
    const json = typeof v === 'string' ? v : JSON.stringify(v);
    for (const m of json.matchAll(IMAGE_REF)) add(m[1]);
    for (const m of json.matchAll(/"image_id"\s*:\s*"([a-f0-9-]{36})"/g)) add(m[1]);
  };
  scan(payload);
  if (card && slides) scan(slides[card.index]);
  return out.slice(0, REPORT_IMAGES_MAX);
}

/** One count of the queue, or null when it cannot be read: never 0 for a failed read. */
async function countOf(stmt: () => D1PreparedStatement): Promise<number | null> {
  try {
    const row = await stmt().first<{ n: number }>();
    return row?.n == null ? null : Number(row.n);
  } catch (e) {
    console.warn('[deck_reports] count unreadable', (e as Error)?.message);
    return null;
  }
}

hqDeckReports.get('/', async (c) => {
  const actor = await requireHqAdmin(c);
  const status = c.req.query('status') ?? 'open';
  if (!['open', 'resolved', 'all'].includes(status)) return refuse(c, 400, { code: 'invalid_status', message: 'status is open, resolved or all.' });
  const reasonQ = c.req.query('reason');
  const reason = reasonQ == null || reasonQ === '' ? null : reasonQ;
  if (reason != null && !Object.prototype.hasOwnProperty.call(REPORT_REASONS, reason)) {
    return refuse(c, 400, { code: 'invalid_reason', message: `reason is one of ${Object.keys(REPORT_REASONS).join(', ')}.` });
  }
  const modelQ = c.req.query('model');
  const model = modelQ == null || modelQ === '' ? null : modelQ;
  if (model != null && model.length > MODEL_FILTER_MAX) {
    return refuse(c, 400, { code: 'invalid_model', message: `model is a model id of at most ${MODEL_FILTER_MAX} characters.` });
  }
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, l.charged_microusd AS charged_microusd, p.payload_json AS payload_json, p.status AS proposal_status,
            u.uid AS founder_uid, COALESCE(u.display_name, u.name) AS founder_name
       FROM deck_proposal_reports r
       LEFT JOIN ai_usage_logs l ON l.id = r.usage_log_id
       LEFT JOIN ai_rail_proposals p ON p.uid = r.proposal_uid AND p.user_id = r.user_id
       LEFT JOIN users u ON u.id = r.user_id
      WHERE (? = 'all' OR r.status = ?)
        AND (? IS NULL OR r.model = ?)
        AND (? IS NULL OR r.reason = ?)
      ORDER BY r.id DESC LIMIT 200`,
  ).bind(status, status, model, model, reason, reason).all<any>();
  const rows = (results ?? []).map((r: any) => {
    let payload: unknown = null;
    try { payload = r.payload_json ? JSON.parse(r.payload_json) : null; } catch { payload = null; }
    return { r, payload: obj(payload) };
  });

  // The deck versions the reports name, read once each. A version that cannot be read is null on its rows, never a failed queue.
  const ids = [...new Set(rows.map(({ r, payload }) => deckIdOf(r.record_ref, payload)).filter((x): x is number => x != null))];
  const decksById = new Map<number, { id: number; title: string | null; version: number | null; slides: unknown[] | null }>();
  if (ids.length) {
    try {
      const { results: found } = await c.env.DB.prepare(
        'SELECT id, title, version, slides FROM pitch_decks WHERE id IN (SELECT value FROM json_each(?))',
      ).bind(JSON.stringify(ids)).all<any>();
      for (const d of found ?? []) {
        let slides: unknown[] | null = null;
        try { const s = JSON.parse(d.slides || '[]'); slides = Array.isArray(s) ? s : null; } catch { slides = null; }
        decksById.set(Number(d.id), { id: Number(d.id), title: text(d.title)?.trim() ?? null, version: d.version == null ? null : Number(d.version), slides });
      }
    } catch (e) {
      console.warn('[deck_reports] deck versions unreadable', (e as Error)?.message);
    }
  }

  // #4375: the images each report names, with whether HQ already took them down; read once for the page.
  const imagesByRow = rows.map(({ r, payload }) => {
    const deck = decksById.get(deckIdOf(r.record_ref, payload) ?? -1) ?? null;
    return reportImageUids(payload, deck?.slides ?? null, cardOf(payload, deck?.slides ?? null));
  });
  const takenDown = new Map<string, boolean>();
  const allImages = [...new Set(imagesByRow.flat())];
  if (allImages.length) {
    try {
      const { results: found } = await c.env.DB.prepare(
        'SELECT uid, taken_down_at FROM deck_images WHERE uid IN (SELECT value FROM json_each(?))',
      ).bind(JSON.stringify(allImages)).all<any>();
      for (const im of found ?? []) takenDown.set(String(im.uid), im.taken_down_at != null);
    } catch (e) {
      console.warn('[deck_reports] report images unreadable', (e as Error)?.message);
    }
  }

  const counts = {
    open: await countOf(() => c.env.DB.prepare("SELECT COUNT(*) AS n FROM deck_proposal_reports WHERE status = 'open'")),
    resolved_this_week: await countOf(() => c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM deck_proposal_reports WHERE status = 'resolved' AND resolved_at >= datetime('now', 'weekday 0', '-6 days', 'start of day')",
    )),
  };
  await logAdminAction(c.env, Number(actor.id), (actor as any).email ?? '', 'deck_reports_read', { status, model, reason, count: rows.length });
  return c.json({
    reports: rows.map(({ r, payload }, i) => {
      const deckId = deckIdOf(r.record_ref, payload);
      const deck = deckId != null ? decksById.get(deckId) ?? null : null;
      return {
        ...reportView(r),
        // A charge that is not recorded reads null ("Not recorded"), never 0.
        charged_microusd: r.charged_microusd == null ? null : Number(r.charged_microusd),
        proposal: r.proposal_status == null ? null : { status: String(r.proposal_status), payload },
        // The member who filed it, by uid and name: never their email.
        founder: r.founder_uid == null ? null : { uid: String(r.founder_uid), name: text(r.founder_name)?.trim() ?? null },
        deck: deck ? { uid: String(deck.id), title: deck.title, version: deck.version } : null,
        card: cardOf(payload, deck?.slides ?? null),
        asked: askedOf(payload, r.rail_option),
        ...wordsOf(payload),
        // #4375: the images this result and its card name, each one HQ can take down; `taken_down` is null when unread.
        images: imagesByRow[i].map((uid) => ({ uid, url: `/api/decks/images/${uid}/file`, taken_down: takenDown.has(uid) ? takenDown.get(uid)! : null })),
      };
    }),
    counts,
  });
});

hqDeckReports.post('/:uid/resolve', async (c) => {
  const actor = await requireHqAdmin(c);
  const uid = c.req.param('uid');
  const body = await c.req.json().catch(() => null) as { outcome?: unknown; note?: unknown } | null;
  const outcome = body?.outcome;
  if (typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return refuse(c, 400, { code: 'invalid_outcome', message: 'outcome is addressed or no_fault.' });
  }
  const raw = body?.note;
  if (raw != null && typeof raw !== 'string') return refuse(c, 400, { code: 'invalid_note', message: 'The note must be text.' });
  // #4188: required, because the founder reads it on their report.
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (note.length < RESOLUTION_NOTE_MIN) {
    return refuse(c, 400, { code: 'note_required', message: `Write a note of at least ${RESOLUTION_NOTE_MIN} characters. The founder sees it on their report.` });
  }
  if (note.length > RESOLUTION_NOTE_MAX) return refuse(c, 400, { code: 'note_too_long', message: `The note is at most ${RESOLUTION_NOTE_MAX} characters.` });
  const row = await c.env.DB.prepare(
    `UPDATE deck_proposal_reports SET status = 'resolved', outcome = ?, resolution_note = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE uid = ? AND status = 'open' RETURNING *`,
  ).bind(outcome, note, Number(actor.id), uid).first<any>();
  if (!row) {
    const known = await c.env.DB.prepare('SELECT status FROM deck_proposal_reports WHERE uid = ?').bind(uid).first<any>();
    return known
      ? refuse(c, 409, { code: 'already_resolved', message: 'This report is already resolved.' })
      : refuse(c, 404, { code: 'not_found', message: 'No report has that id.' });
  }
  // #4188: the audit row names the admin and keeps HQ's note (the founder's own note stays out of it).
  await logAdminAction(c.env, Number(actor.id), (actor as any).email ?? '', 'deck_report_resolved', {
    report_uid: uid, outcome, note, admin: { uid: (actor as any).uid ?? null, name: (actor as any).name ?? null },
  });
  return c.json({ report: reportView(row) });
});

/**
 * #4105: both routers mount themselves, ahead of `decks` (whose `/:id` routes
 * would otherwise answer `/proposals/:uid/report`), where index.ts mounted
 * them by hand: the founder's report under /api/decks, then HQ's queue.
 */
export const mount: RouteMount[] = [
  { path: '/api/decks', router: deckReports, before: [decks] },
  { path: '/api/admin/deck-reports', router: hqDeckReports, before: [decks] },
];

/**
 * D1587 (#3834, deck v2 F8, owner decision R = B) — the investor-side deck
 * view, read-only, on the investor's own deal page. Mounted at `/api/deals`
 * before `dealContext`.
 *
 *   GET    /:id/deck                 investor  the version the venture granted
 *                                              this investor on this deal, or
 *                                              `granted: false`
 *   GET    /:id/deck-grants          founder   the deal's grants and the
 *                                              investors who may receive one
 *   POST   /:id/deck-grants          founder   grant one version to one
 *                                              investor (replaces their live one)
 *   DELETE /:id/deck-grants/:uid     founder   withdraw a grant; the row stays
 *
 * WHO READS. The investor's own deal access is `deal_context.ts`' `context()`
 * (an invitation or a commitment on the deal, for the firm they act for), and a
 * grant is matched on that deal, that investor and that firm exactly. A
 * support session is refused, as on every investor deal read.
 *
 * WHAT LEAVES. The granted version only, through the share link's rules:
 * `publicDeckOf` (no audience, round, author, hash or speaker notes) and
 * `shareSlides` with what the founder ticked (`include_json`, D902), which
 * removes a card's field rather than blanking it, so nothing the founder did
 * not tick reaches the investor, not even a "Not recorded". Provenance never
 * leaves on this page (pd24: badges show only in the editor): every `binding`
 * and provenance key is cut.
 *
 * WHAT THE FOUNDER NEVER SEES. Nothing the investor writes: a founder's answer
 * here names grants and the investors on the deal, never a firm note, a
 * score, a weighting or a decision.
 *
 * NOT HERE (later parts): per-investor links and versions (#3812) and
 * per-slide consent and time per slide (#3820), which this read will honour
 * when they land; notes, the investor's rubric and partner sharing (C); and
 * `investor_summarise`, whose model comes from #3934's per-job table and whose
 * cost HQ absorbs (owner, 2026-11-01).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { canAccessFounderResource, requireAuth, selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import { context as investorDealContext } from './deal_context';
import { publicDeckOf } from './decks';
import { parseShareInclude, shareIncludeFromBody, shareSlides } from '../services/decks/shareInclude';

const r = new Hono<{ Bindings: Env }>();

export const NOT_GRANTED = 'The venture has not shared its deck with you on this deal yet.';
export const NO_LONGER_AVAILABLE = 'The version the venture shared is no longer available.';

/** Keys that carry provenance: never on the investor's deal page (pd24). */
const PROVENANCE_KEY = /^(binding|bindings|provenance|badge|badges|source_chip|source_chips|grade_chip)$/;

/** A card, field or block with every provenance key cut, at any depth. */
export function withoutProvenance<T>(x: T): T {
  if (Array.isArray(x)) return x.map((v) => withoutProvenance(v)) as unknown as T;
  if (!x || typeof x !== 'object') return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (PROVENANCE_KEY.test(k)) continue;
    out[k] = withoutProvenance(v);
  }
  return out as T;
}

type GrantRow = { id: number; uid: string; deal_id: number; deck_id: number; investor_user_id: number; company_id: number | null; include_json: string | null; created_at: string; revoked_at: string | null };

const supportRefused = async (c: any) => !!(await selectJwt(c))?.payload?.impersonated_by;

// ── The investor's read ──────────────────────────────────────────────────

r.get('/:id/deck', async (c) => {
  if (await supportRefused(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot open an investor\'s deal page.' });
  c.header('Cache-Control', 'no-store');
  const x: any = await investorDealContext(c);
  if ('error' in x) return x.error;
  try {
    const grant = await c.env.DB.prepare(
      `SELECT * FROM deck_grants WHERE deal_id = ? AND investor_user_id = ? AND company_id IS ? AND revoked_at IS NULL
        ORDER BY id DESC LIMIT 1`,
    ).bind(x.id, x.user.id, x.company).first<GrantRow>();
    if (!grant) return c.json({ granted: false, message: NOT_GRANTED });
    const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ? AND project_id = ?')
      .bind(grant.deck_id, x.deal.project_id).first<any>();
    if (!row) return c.json({ granted: false, message: NO_LONGER_AVAILABLE });
    const venture = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(x.deal.project_id).first<{ name: string | null }>();
    const include = parseShareInclude(grant.include_json);
    const deck = publicDeckOf(row);
    return c.json({
      granted: true,
      grant: { uid: grant.uid, granted_at: grant.created_at },
      venture: venture?.name ? String(venture.name).slice(0, 200) : null,
      deck: {
        title: deck.title ?? null,
        theme: deck.theme ?? null,
        frozen: { version: Number(row.version), as_of: row.created_at ?? null },
        slides: withoutProvenance(shareSlides(deck.slides, include)),
      },
      included: include,
    });
  } catch (e) {
    return refuse(c, 503, { code: 'deck_unreadable', message: 'The deck could not be read. Try again.', raw: e });
  }
});

// ── The founder's grants ─────────────────────────────────────────────────

/** The deal and its venture, when the caller is that venture's founder (or an admin). */
async function founderDeal(c: any): Promise<{ user: User; deal: { id: number; project_id: number } } | Response> {
  if (await supportRefused(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot share a venture\'s deck.' });
  const user = await requireAuth(c) as User;
  const raw = c.req.param('id');
  if (!/^[1-9][0-9]{0,14}$/.test(raw)) return refuse(c, 400, { code: 'invalid_deal', message: 'That is not a deal.' });
  const env: Env = c.env;
  const deal = await env.DB.prepare(
    `SELECT d.id, d.project_id, p.founder_id FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE d.id = ? AND p.deleted_at IS NULL`,
  ).bind(Number(raw)).first<{ id: number; project_id: number; founder_id: number | null }>();
  if (!deal || !canAccessFounderResource(user, deal.founder_id)) return refuse(c, 404, { code: 'deal_not_found', message: 'Deal not found.' });
  return { user, deal };
}

/** The investors on the deal who may receive a grant: an invitation or a commitment, with the firm it names. */
async function eligible(env: Env, dealId: number) {
  const rows = await env.DB.prepare(
    `SELECT x.investor_user_id AS user_id, x.company_id, u.name AS name, cp.company_name AS company_name FROM (
        SELECT investor_user_id, company_id FROM deal_invitations WHERE deal_id = ?
        UNION SELECT investor_user_id, company_id FROM commitments WHERE deal_id = ?
     ) x JOIN users u ON u.id = x.investor_user_id LEFT JOIN company_profiles cp ON cp.id = x.company_id
     ORDER BY u.name COLLATE NOCASE, x.investor_user_id`,
  ).bind(dealId, dealId).all<{ user_id: number; company_id: number | null; name: string | null; company_name: string | null }>();
  return (rows.results || []).map((r) => ({ user_id: Number(r.user_id), company_id: r.company_id == null ? null : Number(r.company_id), name: r.name ?? null, firm: r.company_name ?? null }));
}

r.get('/:id/deck-grants', async (c) => {
  const f = await founderDeal(c); if (f instanceof Response) return f;
  try {
    const rows = await c.env.DB.prepare(
      `SELECT g.uid, g.investor_user_id, g.company_id, g.include_json, g.created_at, g.revoked_at, d.version,
              u.name AS investor_name, cp.company_name AS firm
         FROM deck_grants g JOIN pitch_decks d ON d.id = g.deck_id JOIN users u ON u.id = g.investor_user_id
         LEFT JOIN company_profiles cp ON cp.id = g.company_id
        WHERE g.deal_id = ? ORDER BY g.id DESC LIMIT 200`,
    ).bind(f.deal.id).all<any>();
    return c.json({
      grants: (rows.results || []).map((g: any) => ({
        uid: g.uid, investor: { user_id: Number(g.investor_user_id), name: g.investor_name ?? null, firm: g.firm ?? null },
        version: Number(g.version), included: parseShareInclude(g.include_json), granted_at: g.created_at, withdrawn_at: g.revoked_at ?? null,
      })),
      investors: await eligible(c.env, f.deal.id),
    });
  } catch (e) {
    return refuse(c, 503, { code: 'grants_unreadable', message: 'The deck grants could not be read. Try again.', raw: e });
  }
});

r.post('/:id/deck-grants', async (c) => {
  const f = await founderDeal(c); if (f instanceof Response) return f;
  const body = await c.req.json().catch(() => null) as any;
  const deckId = Number(body?.deck_id);
  const investorId = Number(body?.investor_user_id);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return refuse(c, 400, { code: 'deck_required', message: 'Choose the version to share.' });
  if (!Number.isSafeInteger(investorId) || investorId <= 0) return refuse(c, 400, { code: 'investor_required', message: 'Choose the investor to share it with.' });
  const include = shareIncludeFromBody(body?.include);
  if (!include) return refuse(c, 400, { code: 'include_invalid', message: 'What is included must be figures, sources, notes and bands, each on or off.' });
  const deck = await c.env.DB.prepare('SELECT id FROM pitch_decks WHERE id = ? AND project_id = ?').bind(deckId, f.deal.project_id).first<{ id: number }>();
  if (!deck) return refuse(c, 404, { code: 'deck_not_found', message: 'That version is not one of this venture\'s.' });
  const on = (await eligible(c.env, f.deal.id)).filter((i) => i.user_id === investorId);
  if (!on.length) return refuse(c, 409, { code: 'investor_not_on_deal', message: 'That investor has no invitation or commitment on this deal.' });
  const company = on[0].company_id;
  const uid = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deck_grants SET revoked_at = datetime('now') WHERE deal_id = ? AND investor_user_id = ? AND company_id IS ? AND revoked_at IS NULL`)
        .bind(f.deal.id, investorId, company),
      c.env.DB.prepare('INSERT INTO deck_grants (uid, deal_id, deck_id, investor_user_id, company_id, include_json, granted_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(uid, f.deal.id, deckId, investorId, company, JSON.stringify(include), f.user.id),
      c.env.DB.prepare(`INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id) VALUES ('deck_granted', ?, ?, 'deal', ?)`)
        .bind(JSON.stringify({ grant_uid: uid, deck_id: deckId, investor_user_id: investorId }), f.user.id, String(f.deal.id)),
    ]);
  } catch (e) {
    return refuse(c, 503, { code: 'grant_failed', message: 'The deck could not be shared. Try again.', raw: e });
  }
  return c.json({ uid, version_id: deckId, investor_user_id: investorId, included: include }, 201);
});

r.delete('/:id/deck-grants/:uid', async (c) => {
  const f = await founderDeal(c); if (f instanceof Response) return f;
  const res = await c.env.DB.prepare(`UPDATE deck_grants SET revoked_at = datetime('now') WHERE uid = ? AND deal_id = ? AND revoked_at IS NULL`)
    .bind(c.req.param('uid'), f.deal.id).run();
  if (Number((res as any)?.meta?.changes || 0) !== 1) return refuse(c, 404, { code: 'grant_not_found', message: 'That grant is not live on this deal.' });
  await c.env.DB.prepare(`INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id) VALUES ('deck_grant_withdrawn', ?, ?, 'deal', ?)`)
    .bind(JSON.stringify({ grant_uid: c.req.param('uid') }), f.user.id, String(f.deal.id)).run().catch(() => {});
  return c.json({ withdrawn: true });
});

export default r;

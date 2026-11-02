/**
 * D1565 (#3812, deck builder v2 D4) — one link per investor, and tailored
 * variants (PD-8 · pd35, "Share, one link per investor").
 *
 *   GET  /api/decks/:id/investor-links                  the version's links, one row per investor
 *   POST /api/decks/:id/investor-links                  a new link: the D902 body, plus `variant_uid?`
 *   POST /api/decks/:id/investor-links/:shareId/withdraw  withdraw it; its analytics are kept
 *   GET  /api/decks/:id/variants                        this version's tailored variants
 *   POST /api/decks/:id/variants                        a variant: { name, prospect_id?, thesis, slide_order? }
 *
 * BUILT ON THE EXISTING PER-PROSPECT LINKS (migration 463), not a second
 * store. A link is made by D902's one link writer (`createDeckLink`), which
 * also writes its recipient watermark (migration 738), and is then given its
 * variant here.
 * Withdraw is D1111's `revokeShareLink`: the link refuses to open, and its
 * views and NDA signatures stay readable here.
 *
 * Each row carries the investor, the frozen version or variant, the NDA state
 * (Accepted with its date, Not accepted yet, or not required), the expiry,
 * the view cap ("No cap" is null), the watermark, and the analytics so far.
 * Time per slide (#3820), the walkthrough (#3837) and the 48-hour revisit
 * signal (#3815) are not here.
 *
 * WHO. `projectOwned`, as every deck route: reads for the venture's readers,
 * writes with `write: true`; a link needs the studio plan (`createDeckLink`).
 *
 * Mounted in index.ts BEFORE `decks`, beside the other /api/decks routers.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { getDeckRow, projectOwned, revokeShareLink, rowToDeck } from './decks';
import { createDeckLink, WriterError } from '../services/raiseWriters';
import { checkVariantFigures, cleanOrder, cleanThesis, tailorMatch, tailorPlan, variantSlides } from '../services/decks/variants';

const deckInvestorLinks = new Hono<{ Bindings: Env }>();

type LinkRow = {
  id: number; deck_id: number; expires_at: string | null; view_limit: number | null; view_count: number | null; revoked_at: string | null;
  prospect_id: number | null; investor_label: string | null; nda_required: number | null; variant_id: number | null; watermark_text: string | null;
  created_at: string | null; prospect_name: string | null; prospect_firm: string | null; variant_uid: string | null; variant_name: string | null;
};
type VariantRow = { id: number; uid: string; deck_id: number; name: string; prospect_id: number | null; thesis_json: string; slide_order_json: string; emphasis_json: string; created_at: string };

const NEVER = '9999';
const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
const newUid = () => crypto.randomUUID().replace(/-/g, '');

async function deckFor(c: any, user: User, write: boolean): Promise<{ row: any } | { refused: Response }> {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return { refused: refuse(c, 400, { code: 'bad_id', message: 'There is no such deck.' }) };
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : {}); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  return { row };
}

/** One pd35 row: the link, its NDA, its cap and its analytics so far (kept after a withdraw). */
async function rowsOf(env: Env, deckId: number) {
  const links = (await env.DB.prepare(
    `SELECT t.id, t.deck_id, t.expires_at, t.view_limit, t.view_count, t.revoked_at, t.prospect_id, t.investor_label, t.nda_required,
            t.variant_id, t.watermark_text, t.created_at, p.name AS prospect_name, p.firm AS prospect_firm, v.uid AS variant_uid, v.name AS variant_name
       FROM pitch_deck_share_tokens t
       LEFT JOIN raise_prospects p ON p.id = t.prospect_id
       LEFT JOIN deck_variants v ON v.id = t.variant_id
      WHERE t.deck_id = ? AND (t.prospect_id IS NOT NULL OR t.investor_label IS NOT NULL)
      ORDER BY t.id DESC LIMIT 200`,
  ).bind(deckId).all<LinkRow>()).results || [];
  const ids = JSON.stringify(links.map((l) => Number(l.id)));
  const views = (await env.DB.prepare(
    `SELECT share_token_id AS id, COUNT(*) AS n, MAX(created_at) AS last_at, SUM(COALESCE(read_seconds, 0)) AS seconds
       FROM deck_share_views WHERE share_token_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) GROUP BY share_token_id`,
  ).bind(ids).all<{ id: number; n: number; last_at: string | null; seconds: number }>()).results || [];
  const ndas = (await env.DB.prepare(
    `SELECT share_token_id AS id, MIN(created_at) AS at FROM deck_share_conversions
      WHERE type = 'nda_signed' AND share_token_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) GROUP BY share_token_id`,
  ).bind(ids).all<{ id: number; at: string }>()).results || [];
  const viewOf = new Map(views.map((v) => [Number(v.id), v]));
  const ndaOf = new Map(ndas.map((n) => [Number(n.id), n.at]));
  const now = Date.now();
  return links.map((l) => {
    const never = String(l.expires_at || '').startsWith(NEVER);
    const expired = !never && l.expires_at != null && Date.parse(String(l.expires_at).replace(' ', 'T') + 'Z') <= now;
    const used = Number(l.view_count || 0);
    const usedUp = l.view_limit != null && used >= Number(l.view_limit);
    const signed = ndaOf.get(Number(l.id)) || null;
    const v = viewOf.get(Number(l.id));
    return {
      id: Number(l.id),
      investor: { label: l.prospect_name || l.investor_label || null, fund: l.prospect_firm || null, prospect_id: l.prospect_id },
      version: { variant: l.variant_uid ? { uid: l.variant_uid, name: l.variant_name } : null },
      nda: Number(l.nda_required) === 1
        ? (signed ? { state: 'accepted' as const, accepted_at: signed } : { state: 'not_accepted' as const, accepted_at: null })
        : { state: 'not_required' as const, accepted_at: null },
      expires_at: never ? null : l.expires_at,
      view_cap: { limit: l.view_limit == null ? null : Number(l.view_limit), used },
      watermark: l.watermark_text,
      status: l.revoked_at ? 'withdrawn' : expired ? 'expired' : usedUp ? 'used_up' : 'live',
      withdrawn_at: l.revoked_at,
      analytics: { views: Number(v?.n ?? 0), last_viewed_at: v?.last_at ?? null, read_seconds: Number(v?.seconds ?? 0) },
      created_at: l.created_at,
    };
  });
}

deckInvestorLinks.get('/:id/investor-links', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, false);
  if ('refused' in got) return got.refused;
  return c.json({ deck_id: Number(got.row.id), version: Number(got.row.version), links: await rowsOf(c.env, Number(got.row.id)) });
});

deckInvestorLinks.post('/:id/investor-links', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if ('refused' in got) return got.refused;
  const b = await c.req.json<any>().catch(() => ({}));
  const body: Record<string, unknown> = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  let variant: VariantRow | null = null;
  if (body.variant_uid != null) {
    variant = await c.env.DB.prepare('SELECT * FROM deck_variants WHERE uid = ? AND deck_id = ?').bind(String(body.variant_uid), Number(got.row.id)).first<VariantRow>();
    if (!variant) return refuse(c, 404, { code: 'variant_not_found', message: 'That variant is not one of this version\'s.' });
  }
  const { variant_uid: _v, ...linkBody } = body;
  let made: Awaited<ReturnType<typeof createDeckLink>>;
  try {
    made = await createDeckLink(c.env, { projectId: Number(got.row.project_id), user, body: { ...linkBody, deck_id: Number(got.row.id) } });
  } catch (e) {
    if (e instanceof WriterError) return refuse(c, e.status, { code: 'link_refused', message: e.sentence });
    if (e instanceof Response) return e;
    throw e;
  }
  // The recipient watermark is written by the one link writer (`createDeckLink`); the variant is this route's.
  if (variant) await c.env.DB.prepare('UPDATE pitch_deck_share_tokens SET variant_id = ? WHERE id = ?').bind(variant.id, made.id).run();
  const row = (await rowsOf(c.env, Number(got.row.id))).find((r) => r.id === made.id);
  // The raw link is answered once, here, and never read back.
  return c.json({ link: row, share_path: made.share_path }, 201);
});

deckInvestorLinks.post('/:id/investor-links/:shareId/withdraw', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if ('refused' in got) return got.refused;
  const shareId = Number(c.req.param('shareId'));
  if (!Number.isSafeInteger(shareId) || shareId < 1) return c.json({ error: 'not found' }, 404);
  const out = await revokeShareLink(c.env, Number(got.row.id), shareId);
  if (!out) return c.json({ error: 'not found' }, 404);
  const row = (await rowsOf(c.env, Number(got.row.id))).find((r) => r.id === shareId) ?? null;
  return c.json({ ok: true, link: row });
});

function variantDto(v: VariantRow, venture: { sector: string | null; stage: string | null }) {
  const thesis = cleanThesis(parse(v.thesis_json, {}));
  return {
    uid: v.uid, name: v.name, prospect_id: v.prospect_id, thesis,
    slide_order: parse<number[]>(v.slide_order_json, []), emphasis: parse(v.emphasis_json, {}),
    tailor_match: tailorMatch(venture, thesis), created_at: v.created_at,
  };
}

async function ventureOf(env: Env, projectId: number) {
  const p = await env.DB.prepare('SELECT sector, stage FROM projects WHERE id = ?').bind(projectId).first<{ sector: string | null; stage: string | null }>();
  return { sector: p?.sector ?? null, stage: p?.stage ?? null };
}

deckInvestorLinks.get('/:id/variants', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, false);
  if ('refused' in got) return got.refused;
  const rows = (await c.env.DB.prepare('SELECT * FROM deck_variants WHERE deck_id = ? ORDER BY id DESC').bind(Number(got.row.id)).all<VariantRow>()).results || [];
  const venture = await ventureOf(c.env, Number(got.row.project_id));
  return c.json({ variants: rows.map((v) => variantDto(v, venture)) });
});

deckInvestorLinks.post('/:id/variants', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if ('refused' in got) return got.refused;
  const b = await c.req.json<any>().catch(() => ({}));
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 80) : '';
  if (!name) return refuse(c, 400, { code: 'name_missing', message: 'Name the variant, for example the investor it is for.' });
  let prospectId: number | null = null;
  if (b?.prospect_id != null) {
    const p = await c.env.DB.prepare('SELECT id FROM raise_prospects WHERE id = ? AND project_id = ?').bind(Number(b.prospect_id), Number(got.row.project_id)).first<{ id: number }>();
    if (!p) return refuse(c, 404, { code: 'prospect_not_found', message: 'That investor is not one of this venture\'s.' });
    prospectId = Number(p.id);
  }
  const thesis = cleanThesis(b?.thesis);
  const master = rowToDeck(got.row).slides || [];
  const plan = tailorPlan(master, thesis);
  const order = b?.slide_order == null ? plan.slide_order : cleanOrder(master, b.slide_order);
  if (!order) return refuse(c, 400, { code: 'order_invalid', message: 'The order must list this version\'s own cards, each once.' });
  // A variant only reorders the master's cards: it can never state a figure the master lacks.
  const extra = checkVariantFigures(master, variantSlides(master, order));
  if (extra.length) return refuse(c, 422, { code: 'figure_not_in_master', message: 'A variant cannot state a figure the version it tailors does not.' });
  const emphasis = b?.slide_order == null ? plan.emphasis : {};
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO deck_variants (uid, deck_id, project_id, name, prospect_id, thesis_json, slide_order_json, emphasis_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, Number(got.row.id), Number(got.row.project_id), name, prospectId, JSON.stringify(thesis), JSON.stringify(order), JSON.stringify(emphasis), user.id).run();
  const v = await c.env.DB.prepare('SELECT * FROM deck_variants WHERE uid = ?').bind(uid).first<VariantRow>();
  return c.json({ variant: variantDto(v as VariantRow, await ventureOf(c.env, Number(got.row.project_id))) }, 201);
});

export default deckInvestorLinks;

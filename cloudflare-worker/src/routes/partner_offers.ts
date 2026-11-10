/**
 * /api/partner/offers — Visibility, Proof and Audience fit.
 *
 * The three zones of the Offers bucket, and the only bucket a partner can use
 * TODAY: its stores key on `partners.id` rather than on an engagement or a
 * quote, so a firm with no marketplace activity still has something to record.
 * Pipeline and Delivery both hang off deals that do not exist yet.
 *
 * WHAT EACH ZONE ASKED FOR, AND THE ONE THING EACH REFUSES:
 *
 *   VISIBILITY. Which surfaces the firm appears on and what each produced. The
 *   zone's argument is that VOLUME IS NOT THE RANKING — a directory listing
 *   with thousands of views and no engagements reads worse than a referral with
 *   two leads and one. `engagement_sources` is that join. **Views are not
 *   here**: a view count needs an impression pipeline, not a table, and the
 *   zone says "Not recorded" rather than dividing by a number nobody measures.
 *
 *   PROOF. Case studies and outcomes, each carrying the engagement that
 *   produced it and whether the client agreed to publish it. **Published is
 *   derived** — `consent_given = 1 AND withdrawn_at IS NULL`, computed at read
 *   time — so a withdrawal cannot be undone by forgetting one of two columns,
 *   and the page cannot assert publication about itself.
 *
 *   AUDIENCE FIT. Who the firm is for and, the working half, who it is not.
 *   This is what lets Pipeline pass a lead with a named reason instead of
 *   silence, so `statement` carries the sentence a pass quotes and
 *   `referred_to` carries the alternative. **No lead is scored here**: the
 *   rules are a record a person reads, not a filter that runs.
 *
 * ONE SCHEMA TRAP WORTH NAMING, because copying 204 wholesale would have hit
 * it silently: **209's consent table is not 204's.** Its columns are
 * `consenter_name` / `consenter_email` / `consenter_role`, not `attester_*`,
 * and it has NO `statement` column — the quoted words are `consent_text`.
 * `advisors.ts`'s `consentDto` mapped over this table returns `undefined` for
 * every field and throws nothing; only a test catches it.
 *
 * CONVENTIONS, from `needs.ts` and `partner_pipeline.ts`: lists are
 * `{items:[…]}`, composite reads use named top-level keys, writes with nothing
 * to return are `{ok:true}`, every >=400 carries `{detail:'Human sentence'}`,
 * and an ownership failure is 404 rather than 403.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { getCurrentUser, requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import {
  CODE_MAX_ATTEMPTS, CODE_TTL_MS, CODES_PER_HOUR, LINK_TTL_MS, emailOf, maskEmail, newCode,
  proofClaimJson, proofClaimSha256, proofCodeHash, proofConsentMailer, proofConsentState,
} from '../services/partnerProofConsent';
import {
  mapError, newUid, nowIso, requirePartnerProfile, trimOrNull,
} from './_t13t14t15_helpers';
import {
  mergePatch, parseCents, requireOwnEngagement, requirePartnerRole,
} from './_partner_workspace_helpers';
import { WON_MEASURE_BASIS } from '../services/serviceMeasures';

const partnerOffers = new Hono<{ Bindings: Env }>();

async function actingPartner(c: any): Promise<{ user: User; partnerId: number }> {
  const user = (await requireAuth(c)) as User;
  requirePartnerRole(user);
  const partner = await requirePartnerProfile(c.env, user);
  return { user, partnerId: Number(partner.id) };
}

async function body<T>(c: any): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T;
}

/** A 404 Response, raised rather than returned so a helper can throw it. */
function notFound(what: string): Response {
  return new Response(JSON.stringify({ detail: `${what} not found` }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

const SURFACE_KINDS = ['directory', 'referral', 'outbound', 'content', 'event', 'other'];

async function ownSurface(env: Env, partnerId: number, id: number) {
  const row = await env.DB.prepare('SELECT * FROM partner_surfaces WHERE id = ?')
    .bind(id).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) throw notFound('Surface');
  return row;
}

/**
 * Surfaces with what each produced, and an honest denominator.
 *
 * `engagements` is counted through `engagement_sources` — a JOIN, never a
 * model. An engagement nobody attributed is simply not counted against any
 * surface, and the unattributed total is returned so the reader can see the
 * size of what is missing rather than having it silently distributed.
 */
partnerOffers.get('/visibility', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);

    const surfaces = await c.env.DB.prepare(
      `SELECT s.id, s.uid, s.name, s.kind, s.is_active, s.created_at,
              COUNT(es.id) AS engagement_count,
              COALESCE(SUM(CASE WHEN e.status <> 'cancelled' THEN 1 ELSE 0 END), 0) AS won_count,
              COALESCE(SUM(CASE WHEN e.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
              COALESCE(SUM(CASE WHEN e.status <> 'cancelled' THEN COALESCE(e.price, 0) ELSE 0 END), 0) AS won_value,
              COALESCE(SUM(CASE WHEN e.status <> 'cancelled' AND e.delivered_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS delivered_count,
              COALESCE(SUM(CASE WHEN e.status <> 'cancelled' AND inv.id IS NOT NULL AND inv.status <> 'void' THEN 1 ELSE 0 END), 0) AS invoiced_count,
              COALESCE(SUM(CASE WHEN e.status <> 'cancelled' AND inv.status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count
         FROM partner_surfaces s
         LEFT JOIN engagement_sources es ON es.surface_id = s.id
         LEFT JOIN engagements e ON e.id = es.engagement_id AND e.partner_id = s.partner_id
         LEFT JOIN engagement_invoices inv ON inv.engagement_id = e.id
        WHERE s.partner_id = ?
        GROUP BY s.id
        ORDER BY COUNT(es.id) DESC, s.name`,
    ).bind(partnerId).all<any>();

    const totals = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN es.id IS NULL THEN 1 ELSE 0 END) AS unattributed
         FROM engagements e
         LEFT JOIN engagement_sources es ON es.engagement_id = e.id
        WHERE e.partner_id = ?`,
    ).bind(partnerId).first<any>();

    const total = Number(totals?.total || 0);
    const unattributed = Number(totals?.unattributed || 0);

    return c.json({
      items: (surfaces.results || []).map((r: any) => ({
        id: Number(r.id),
        uid: r.uid,
        name: r.name,
        kind: r.kind,
        is_active: !!r.is_active,
        engagement_count: Number(r.engagement_count || 0),
        // WON IS ACCEPTED WORK THAT WAS NOT CANCELLED (#4696). It summed every
        // attributed engagement's price, cancelled included, under a heading
        // that says Won. The amount is the accepted quote's price copied onto
        // the engagement, so it does not move when a catalogue entry is repriced.
        won_count: Number(r.won_count || 0),
        cancelled_count: Number(r.cancelled_count || 0),
        // Dollars, not cents: `engagements.price` is a grandfathered REAL.
        won_value: Number(r.won_value || 0),
        delivered_count: Number(r.delivered_count || 0),
        invoiced_count: Number(r.invoiced_count || 0),
        paid_count: Number(r.paid_count || 0),
        // The zone's whole argument is that this column cannot be filled, so
        // the reason travels with the absence rather than being page copy that
        // could drift away from the data.
        views: null,
        views_note: 'No impression is recorded anywhere in the product, so a view count would be invented rather than measured.',
      })),
      engagement_total: total,
      // Each column's basis travels with the figures, so a page cannot relabel
      // a count it did not compute (#4696).
      measures_basis: WON_MEASURE_BASIS,
      won_note: 'Won counts accepted work that was not cancelled, at the price accepted. Cancelled engagements are counted under Engagements and under Cancelled, never under Won.',
      unattributed_count: unattributed,
      // Said as a count with a sentence rather than folded into a percentage.
      // A conversion rate over a denominator that is missing a quarter of its
      // rows is a worse answer than two honest numbers.
      unattributed_note: unattributed
        ? `${unattributed} of ${total} engagement${total === 1 ? '' : 's'} name no surface, so ${unattributed === 1 ? 'it is' : 'they are'} counted against none of these.`
        : null,
      // Leads per surface has no store at all — a lead is a `founder_needs` row
      // nobody owns, and nothing records which surface a founder came through.
      lead_ratio: null,
      lead_ratio_note: 'Engagements per surface is real. Leads per surface is not recorded anywhere, so the ratio between them has an absent denominator and is not stated.',
    });
  } catch (e) { return mapError(c, e); }
});

partnerOffers.post('/surfaces', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const b = await body<any>(c);
    const name = trimOrNull(b.name, 160);
    if (!name) return c.json({ detail: 'A surface needs a name — where the firm appears' }, 400);
    const kind = b.kind === undefined ? 'directory' : String(b.kind);
    if (!SURFACE_KINDS.includes(kind)) {
      return c.json({ detail: `Kind must be one of ${SURFACE_KINDS.join(', ')}` }, 400);
    }
    // `idx_partner_surfaces_name` is UNIQUE on (partner_id, name), so a
    // duplicate is a 409 with a sentence rather than a raw constraint error
    // surfacing as a 500.
    const clash = await c.env.DB.prepare(
      'SELECT id FROM partner_surfaces WHERE partner_id = ? AND name = ?',
    ).bind(partnerId, name).first<any>();
    if (clash) return c.json({ detail: 'A surface with that name is already recorded' }, 409);

    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_surfaces (uid, partner_id, name, kind, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(newUid(), partnerId, name, kind, nowIso(), nowIso()).run();
    const row = await c.env.DB.prepare('SELECT * FROM partner_surfaces WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json({
      id: Number(row.id), uid: row.uid, name: row.name, kind: row.kind,
      is_active: !!row.is_active,
    });
  } catch (e) { return mapError(c, e); }
});

partnerOffers.patch('/surfaces/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownSurface(c.env, partnerId, id);
    const b = await body<any>(c);
    const merged = mergePatch(row, b, ['name', 'kind', 'is_active']);
    const name = trimOrNull(merged.name, 160);
    if (!name) return c.json({ detail: 'A surface needs a name' }, 400);
    if (!SURFACE_KINDS.includes(String(merged.kind))) {
      return c.json({ detail: `Kind must be one of ${SURFACE_KINDS.join(', ')}` }, 400);
    }
    await c.env.DB.prepare(
      'UPDATE partner_surfaces SET name = ?, kind = ?, is_active = ?, updated_at = ? WHERE id = ?',
    ).bind(name, String(merged.kind), merged.is_active ? 1 : 0, nowIso(), id).run();
    const out = await c.env.DB.prepare('SELECT * FROM partner_surfaces WHERE id = ?')
      .bind(id).first<any>();
    return c.json({
      id: Number(out.id), uid: out.uid, name: out.name, kind: out.kind,
      is_active: !!out.is_active,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Deleting a surface unattributes its engagements rather than deleting them.
 *
 * `is_active = 0` is the softer move and the form offers it first — a retired
 * listing that once produced work is a true row. A real delete is offered too,
 * because a surface added by mistake should not have to be carried forever, and
 * it takes the attribution rows with it: an `engagement_sources` row pointing at
 * a surface that no longer exists would be counted by nothing and cleaned by
 * nothing.
 */
partnerOffers.delete('/surfaces/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownSurface(c.env, partnerId, id);
    await c.env.DB.prepare('DELETE FROM engagement_sources WHERE surface_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM partner_surfaces WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/**
 * Attribute one engagement to one surface.
 *
 * PUT because `idx_engagement_sources_engagement` is UNIQUE on engagement_id —
 * an engagement came from one place, and recording a second would double-count
 * it in exactly the comparison this zone exists to make.
 *
 * BOTH SIDES ARE OWNERSHIP-CHECKED. The engagement must be this firm's and so
 * must the surface; without the second check a partner could attribute their
 * own work to another firm's listing, which would corrupt a table that firm
 * reads.
 */
partnerOffers.put('/engagements/:engagementId/source', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const b = await body<any>(c);
    const surface = await ownSurface(c.env, partnerId, Number(b.surface_id));

    const existing = await c.env.DB.prepare(
      'SELECT id FROM engagement_sources WHERE engagement_id = ?',
    ).bind(engagementId).first<any>();
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE engagement_sources SET surface_id = ?, attributed_at = ? WHERE id = ?',
      ).bind(surface.id, nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO engagement_sources (engagement_id, surface_id, attributed_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(engagementId, surface.id, nowIso(), nowIso()).run();
    }
    return c.json({ ok: true, engagement_id: engagementId, surface_id: Number(surface.id) });
  } catch (e) { return mapError(c, e); }
});

partnerOffers.delete('/engagements/:engagementId/source', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    await c.env.DB.prepare('DELETE FROM engagement_sources WHERE engagement_id = ?')
      .bind(engagementId).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/** Every engagement with the surface it names, for the attribution form. */
partnerOffers.get('/attribution', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const rows = await c.env.DB.prepare(
      `SELECT e.id AS engagement_id, e.uid AS engagement_uid, e.status, e.price,
              n.title AS need_title, f.name AS founder_name,
              s.id AS surface_id, s.name AS surface_name
         FROM engagements e
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN founders f ON f.id = e.founder_id
         LEFT JOIN engagement_sources es ON es.engagement_id = e.id
         LEFT JOIN partner_surfaces s ON s.id = es.surface_id
        WHERE e.partner_id = ?
        ORDER BY es.id IS NOT NULL, e.created_at DESC
        LIMIT 200`,
    ).bind(partnerId).all<any>();
    return c.json({
      items: (rows.results || []).map((r: any) => ({
        engagement_id: Number(r.engagement_id),
        engagement_uid: r.engagement_uid,
        status: r.status,
        price: r.price === null ? null : Number(r.price),
        need_title: r.need_title ?? null,
        founder_name: r.founder_name ?? null,
        surface_id: r.surface_id ? Number(r.surface_id) : null,
        surface_name: r.surface_name ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Proof
// ---------------------------------------------------------------------------

const PROOF_KINDS = ['case_study', 'outcome', 'testimonial'];

type ProofRow = {
  id: number; uid: string; partner_id: number; engagement_id: number | null; kind: string; title: string;
  detail: string | null; outcome_note: string | null; revision: number | null; claim_sha256: string | null;
  created_at: string; updated_at: string;
  engagement_uid?: string | null; need_title?: string | null; founder_name?: string | null;
};
type ConsentRow = {
  id: number; uid: string; proof_item_id: number;
  consenter_name: string; consenter_email: string | null; consenter_role: string | null;
  requested_at: string | null; requested_by: number | null; request_token: string | null;
  consent_given: number; consent_given_at: string | null; consent_text: string | null;
  withdrawn_at: string | null; claim_sha256: string | null; claim_json: string | null;
  revision: number | null; expires_at: string | null; closed_at: string | null;
  created_at: string; updated_at: string;
};

/**
 * A consent as the FIRM may see it (D4672).
 *
 * `invite_token` is the link the firm hands over, readable again while the
 * request is open so a refresh never loses it. Since D4672 the link only shows
 * the claim it is about; answering needs a code mailed to the client's address,
 * so holding the link is not being able to answer. Once the request is
 * answered, superseded or expired the link is not returned at all.
 */
function consentDto(r: ConsentRow, currentSha: string) {
  const state = proofConsentState(r, currentSha);
  return {
    id: Number(r.id),
    uid: r.uid,
    proof_item_id: Number(r.proof_item_id),
    consenter_name: r.consenter_name,
    consenter_email: r.consenter_email ?? null,
    consenter_role: r.consenter_role ?? null,
    requested_at: r.requested_at ?? null,
    state,
    // The revision this consent is about. A superseded confirmation stays
    // attached to the revision it confirmed; it is never carried forward.
    revision: r.revision == null ? null : Number(r.revision),
    consent_given: state === 'confirmed',
    consent_given_at: r.consent_given_at ?? null,
    // The exact words agreed to. Consent to "a case study" and consent to "a
    // case study naming our revenue" are different consents, so the wording is
    // returned rather than a boolean standing in for it.
    consent_text: r.consent_text ?? null,
    withdrawn_at: r.withdrawn_at ?? null,
    expires_at: r.expires_at ?? null,
    invite_token: state === 'requested' ? r.request_token : null,
    created_at: r.created_at,
  };
}

/**
 * PUBLISHED IS DERIVED, never stored — migration 209's header, enforced here,
 * and since D4672 a consent counts only while it is confirmed about the claim
 * as it now reads (`proofConsentState`): a withdrawal, an edit after the
 * answer, or a confirmation recorded before D4672 does not.
 *
 * `status` is `published` or `self_stated`, and the second word is the point:
 * the firm's own account of a result and the client's confirmation of it are
 * different evidence and must never render identically.
 */
function proofDto(r: ProofRow, consents: ConsentRow[], currentSha: string) {
  const views = consents.map((x) => consentDto(x, currentSha));
  const live = views.filter((x) => x.state === 'confirmed');
  return {
    id: Number(r.id),
    uid: r.uid,
    engagement_id: r.engagement_id ? Number(r.engagement_id) : null,
    engagement_uid: r.engagement_uid ?? null,
    need_title: r.need_title ?? null,
    founder_name: r.founder_name ?? null,
    kind: r.kind,
    title: r.title,
    detail: r.detail ?? null,
    outcome_note: r.outcome_note ?? null,
    revision: Number(r.revision ?? 1),
    is_published: live.length > 0,
    status: live.length > 0 ? 'published' : 'self_stated',
    consents: views,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function ownProofItem(env: Env, partnerId: number, id: number): Promise<ProofRow> {
  const row = await env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
    .bind(id).first<ProofRow>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) throw notFound('Proof item');
  return row;
}

/** The item's current claim hash, written back when a row from before D4672 has none. */
async function currentClaim(env: Env, row: ProofRow): Promise<string> {
  const sha = await proofClaimSha256(row);
  if (row.claim_sha256 !== sha) {
    await env.DB.prepare('UPDATE partner_proof_items SET claim_sha256 = ? WHERE id = ?').bind(sha, row.id).run();
    row.claim_sha256 = sha;
  }
  return sha;
}

async function proofEvent(env: Env, consentId: number, kind: string, revision: number | null, sha: string | null, at: string) {
  await env.DB.prepare(
    'INSERT INTO partner_proof_consent_events (consent_id, kind, revision, claim_sha256, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(consentId, kind, revision, sha, at).run();
}

partnerOffers.get('/proof', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const items = await c.env.DB.prepare(
      `SELECT p.*, e.uid AS engagement_uid, n.title AS need_title, f.name AS founder_name
         FROM partner_proof_items p
         LEFT JOIN engagements e ON e.id = p.engagement_id
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN founders f ON f.id = e.founder_id
        WHERE p.partner_id = ?
        ORDER BY p.created_at DESC
        LIMIT 200`,
    ).bind(partnerId).all<ProofRow>();

    // Joined back to `partner_proof_items.partner_id` for the same two reasons
    // the pipeline reads do: no `${}` reaches `DB.prepare`, and a consent can
    // only come back for an item this firm owns.
    const consents = await c.env.DB.prepare(
      `SELECT k.*
         FROM partner_proof_consents k
         JOIN partner_proof_items p ON p.id = k.proof_item_id
        WHERE p.partner_id = ?
        ORDER BY k.proof_item_id, k.created_at ASC, k.id ASC`,
    ).bind(partnerId).all<ConsentRow>();
    const byItem = new Map<number, ConsentRow[]>();
    for (const k of consents.results || []) {
      const id = Number(k.proof_item_id);
      if (!byItem.has(id)) byItem.set(id, []);
      byItem.get(id)!.push(k);
    }

    const list = [];
    for (const r of items.results || []) {
      // Hashed from the row as it reads, not trusted from the stored column, so
      // an item written before D4672 is judged by its content too.
      list.push(proofDto(r, byItem.get(Number(r.id)) || [], await proofClaimSha256(r)));
    }
    const published = list.filter((x: any) => x.is_published).length;
    return c.json({
      items: list,
      published_count: published,
      // Said as two counts rather than one, because "3 case studies" and
      // "3 case studies, none of which the client agreed to publish" describe
      // very different storefronts.
      self_stated_count: list.length - published,
    });
  } catch (e) { return mapError(c, e); }
});

partnerOffers.post('/proof', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const b = await body<any>(c);
    const title = trimOrNull(b.title, 200);
    if (!title) return c.json({ detail: 'A proof item needs a title' }, 400);
    const kind = b.kind === undefined ? 'case_study' : String(b.kind);
    if (!PROOF_KINDS.includes(kind)) {
      return c.json({ detail: `Kind must be one of ${PROOF_KINDS.join(', ')}` }, 400);
    }
    // An engagement is optional but, if named, must be this firm's — otherwise
    // a firm could attach its case study to somebody else's work.
    let engagementId: number | null = null;
    if (b.engagement_id !== undefined && b.engagement_id !== null && b.engagement_id !== '') {
      const e = await requireOwnEngagement(c.env, partnerId, Number(b.engagement_id));
      engagementId = Number(e.id);
    }
    const detail = trimOrNull(b.detail, 4000);
    const outcome = trimOrNull(b.outcome_note, 1000);
    const sha = await proofClaimSha256({ kind, title, detail, outcome_note: outcome, engagement_id: engagementId });
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_proof_items
         (uid, partner_id, engagement_id, kind, title, detail, outcome_note, revision, claim_sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(newUid(), partnerId, engagementId, kind, title, detail, outcome, sha, nowIso(), nowIso()).run();
    const row = await c.env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<ProofRow>();
    return c.json(proofDto(row!, [], sha));
  } catch (e) { return mapError(c, e); }
});

/**
 * Edit a proof item (D4672). A MATERIAL edit — kind, title, detail, outcome or
 * the engagement it is about — is a new revision. Every consent stays attached
 * to the revision it was asked about: a confirmation of the old wording no
 * longer publishes the new one, and a request still out about the old wording
 * can no longer confirm anything. Each consent that was live or open when the
 * claim moved gets a `superseded` event, so the history says when.
 */
partnerOffers.patch('/proof/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownProofItem(c.env, partnerId, id);
    const b = await body<any>(c);
    const merged = mergePatch(row, b, ['kind', 'title', 'detail', 'outcome_note', 'engagement_id']);
    const title = trimOrNull(merged.title, 200);
    if (!title) return c.json({ detail: 'A proof item needs a title' }, 400);
    if (!PROOF_KINDS.includes(String(merged.kind))) {
      return c.json({ detail: `Kind must be one of ${PROOF_KINDS.join(', ')}` }, 400);
    }
    let engagementId: number | null = null;
    if (merged.engagement_id !== null && merged.engagement_id !== undefined && (merged.engagement_id as unknown) !== '') {
      const e = await requireOwnEngagement(c.env, partnerId, Number(merged.engagement_id));
      engagementId = Number(e.id);
    }
    const next = {
      kind: String(merged.kind), title, detail: trimOrNull(merged.detail, 4000),
      outcome_note: trimOrNull(merged.outcome_note, 1000), engagement_id: engagementId,
    };
    const before = await proofClaimSha256(row);
    const after = await proofClaimSha256(next);
    const moved = before !== after;
    const revision = Number(row.revision ?? 1) + (moved ? 1 : 0);
    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE partner_proof_items
          SET engagement_id = ?, kind = ?, title = ?, detail = ?, outcome_note = ?,
              revision = ?, claim_sha256 = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(next.engagement_id, next.kind, next.title, next.detail, next.outcome_note, revision, after, now, id).run();
    if (moved) {
      const stale = await c.env.DB.prepare(
        `SELECT id, revision, claim_sha256 FROM partner_proof_consents
          WHERE proof_item_id = ? AND claim_sha256 = ? AND withdrawn_at IS NULL AND closed_at IS NULL`,
      ).bind(id, before).all<{ id: number; revision: number | null; claim_sha256: string }>();
      for (const k of stale.results || []) await proofEvent(c.env, k.id, 'superseded', k.revision, k.claim_sha256, now);
    }
    const out = await c.env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
      .bind(id).first<ProofRow>();
    const consents = await c.env.DB.prepare(
      'SELECT * FROM partner_proof_consents WHERE proof_item_id = ? ORDER BY created_at ASC, id ASC',
    ).bind(id).all<ConsentRow>();
    return c.json(proofDto(out!, consents.results || [], after));
  } catch (e) { return mapError(c, e); }
});

partnerOffers.delete('/proof/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownProofItem(c.env, partnerId, id);
    // The consents and their codes go with it. A consent row whose item is gone
    // is a record of a decision about nothing, and it would keep a person's
    // name and email in the store after the thing they agreed to had been
    // removed. The event history stays: it holds no name or address.
    await c.env.DB.prepare(
      'DELETE FROM partner_proof_consent_codes WHERE consent_id IN (SELECT id FROM partner_proof_consents WHERE proof_item_id = ?)',
    ).bind(id).run();
    await c.env.DB.prepare('DELETE FROM partner_proof_consents WHERE proof_item_id = ?')
      .bind(id).run();
    await c.env.DB.prepare('DELETE FROM partner_proof_items WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/**
 * Record the ASK, about this revision of the claim. It does not send it.
 *
 * Whether this product should email a client on a firm's behalf is a separate
 * decision, so the firm hands over the link by whatever channel it already has
 * with the client. The client's email is required because answering needs a
 * code mailed there on the client's own request (D4672), and it cannot be an
 * address of the firm asking: the subject of a claim never confirms it.
 */
partnerOffers.post('/proof/:id/consent-request', async (c) => {
  try {
    const { user, partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const item = await ownProofItem(c.env, partnerId, id);
    const b = await body<any>(c);
    const name = trimOrNull(b.consenter_name, 200);
    if (!name) return refuse(c, 400, { code: 'consenter_name_required', message: 'Name the person being asked to confirm.' });
    const email = emailOf(b.consenter_email);
    if (!email) {
      return refuse(c, 400, { code: 'consenter_email_required', message: 'Give the client’s email address; the code that lets them answer is sent there.' });
    }
    const firm = await c.env.DB.prepare('SELECT email FROM partners WHERE id = ?').bind(partnerId).first<{ email: string | null }>();
    const members = await c.env.DB.prepare('SELECT email FROM users WHERE partner_id = ?').bind(partnerId).all<{ email: string | null }>();
    const own = [user.email, firm?.email, ...(members.results || []).map((m) => m.email)].map(emailOf).filter(Boolean);
    if (own.includes(email)) {
      return refuse(c, 422, { code: 'consenter_is_requester', message: 'The client confirms your claim, not your firm: that address belongs to your firm.' });
    }
    const sha = await currentClaim(c.env, item);
    const revision = Number(item.revision ?? 1);
    const token = newUid();
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_proof_consents
         (uid, proof_item_id, consenter_name, consenter_email, consenter_role,
          requested_at, requested_by, request_token, consent_given,
          claim_sha256, claim_json, revision, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), item.id, name, email, trimOrNull(b.consenter_role, 200),
      now, user.id, token, sha, proofClaimJson(item), revision,
      new Date(nowMs + LINK_TTL_MS).toISOString(), now, now,
    ).run();
    const consentId = Number((ins as any).meta?.last_row_id);
    await proofEvent(c.env, consentId, 'asked', revision, sha, now);
    const row = await c.env.DB.prepare('SELECT * FROM partner_proof_consents WHERE id = ?')
      .bind(consentId).first<ConsentRow>();
    return c.json({ ...consentDto(row!, sha), delivered: false });
  } catch (e) { return mapError(c, e); }
});

/**
 * The firm records a withdrawal it was told about out of band.
 *
 * WITHDRAWAL IS A STATE, NOT A DELETE — 209's header — and since D4672 it
 * closes the request: nothing reopens it, and asking again is a new request on
 * the record. Only an agreement can be withdrawn; a request nobody answered
 * has nothing to take back. The firm CANNOT grant consent through any route.
 */
partnerOffers.post('/proof/:id/consents/:consentId/withdraw', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const item = await ownProofItem(c.env, partnerId, id);
    const consentId = Number(c.req.param('consentId'));
    const row = await c.env.DB.prepare(
      'SELECT * FROM partner_proof_consents WHERE id = ? AND proof_item_id = ?',
    ).bind(consentId, id).first<ConsentRow>();
    if (!row) return c.json({ detail: 'Consent not found' }, 404);
    if (row.withdrawn_at || row.closed_at) {
      return refuse(c, 409, { code: 'consent_closed', message: 'This consent is already withdrawn or declined.' });
    }
    if (Number(row.consent_given) !== 1) {
      return refuse(c, 409, { code: 'nothing_to_withdraw', message: 'The client has not agreed to this yet, so there is nothing to withdraw.' });
    }
    const now = nowIso();
    const upd = await c.env.DB.prepare(
      `UPDATE partner_proof_consents
          SET consent_given = 0, withdrawn_at = ?, closed_at = ?, updated_at = ?
        WHERE id = ? AND withdrawn_at IS NULL AND closed_at IS NULL`,
    ).bind(now, now, now, consentId).run();
    if (Number((upd as any)?.meta?.changes ?? 1)) await proofEvent(c.env, consentId, 'withdrawn', row.revision, row.claim_sha256, now);
    const out = await c.env.DB.prepare('SELECT * FROM partner_proof_consents WHERE id = ?')
      .bind(consentId).first<ConsentRow>();
    return c.json(consentDto(out!, await proofClaimSha256(item)));
  } catch (e) { return mapError(c, e); }
});

/** The consent a link names, the item it is about, the firm, and the item's current claim hash. */
async function consentByToken(env: Env, token: string) {
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare('SELECT * FROM partner_proof_consents WHERE request_token = ?')
    .bind(token).first<ConsentRow>();
  if (!row) return null;
  const item = await env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
    .bind(row.proof_item_id).first<ProofRow>();
  if (!item) return null;
  const firm = await env.DB.prepare('SELECT id, name, company FROM partners WHERE id = ?')
    .bind(item.partner_id).first<{ id: number; name: string | null; company: string | null }>();
  return { row, item, firm, currentSha: await proofClaimSha256(item) };
}

const NO_REQUEST = { code: 'consent_not_found', message: 'This request does not exist, or the claim it was about was removed.' } as const;

/** Why a request answers nothing, as the client reads it; null when it can be answered. */
function unanswerable(row: ConsentRow, currentSha: string) {
  const state = proofConsentState(row, currentSha);
  if (state === 'declined' || state === 'withdrawn') {
    return { code: 'consent_closed', message: 'This request is closed: it was declined or withdrawn, and that stays on the record. The firm can send a new request.' };
  }
  if (state === 'expired') return { code: 'request_expired', message: 'This request has expired. Ask the firm to send a new one.' };
  if (state === 'superseded' && Number(row.consent_given) !== 1) {
    return { code: 'claim_changed', message: 'The firm changed this claim after asking, so this request can no longer confirm it. Ask the firm to send a new request.' };
  }
  return null;
}

/**
 * The client's view (D4672): the claim exactly as they are asked to confirm
 * it, the firm that asked, the revision, and the history of the request. No
 * account and no code: reading is what the link is for. Never the client's
 * address in full, and never anything about another claim.
 *
 * Three segments with a literal first, so `/proof/:id` two segments up cannot
 * shadow these, and neither can any future single-segment route.
 */
partnerOffers.get('/proof-consents/:token/claim', async (c) => {
  try {
    const found = await consentByToken(c.env, String(c.req.param('token') || ''));
    if (!found) return refuse(c, 404, NO_REQUEST);
    const { row, firm, currentSha } = found;
    const events = (await c.env.DB.prepare(
      'SELECT kind, revision, created_at FROM partner_proof_consent_events WHERE consent_id = ? ORDER BY id ASC',
    ).bind(row.id).all<{ kind: string; revision: number | null; created_at: string }>()).results || [];
    c.header('Cache-Control', 'private, no-store');
    return c.json({
      firm_name: firm?.company || firm?.name || null,
      consenter_name: row.consenter_name,
      email_hint: maskEmail(row.consenter_email),
      // Only the claim as pinned. A request from before D4672 pinned nothing,
      // and showing today's wording would ask the client about text they were
      // never shown.
      claim: row.claim_json ? JSON.parse(row.claim_json) : null,
      revision: row.revision == null ? null : Number(row.revision),
      claim_sha256: row.claim_sha256,
      claim_changed: !!row.claim_sha256 && row.claim_sha256 !== currentSha,
      state: proofConsentState(row, currentSha),
      consent_text: row.consent_text,
      expires_at: row.expires_at,
      history: events,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Mail the client a one-time code (D4672), on their own request, to the
 * address the firm named. Five an hour per request; a code lasts 15 minutes.
 * The address is never echoed in full and never logged. A closed, expired or
 * superseded request sends nothing: there is nothing it could answer.
 */
partnerOffers.post('/proof-consents/:token/code', async (c) => {
  try {
    const found = await consentByToken(c.env, String(c.req.param('token') || ''));
    if (!found) return refuse(c, 404, NO_REQUEST);
    const { row, firm, currentSha } = found;
    const why = unanswerable(row, currentSha);
    if (why) return refuse(c, 409, why);
    const to = emailOf(row.consenter_email);
    if (!to) {
      return refuse(c, 409, { code: 'consenter_email_missing', message: 'This request names no email address, so no code can be sent. Ask the firm to send a new request.' });
    }
    const nowMs = Date.now();
    const recent = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM partner_proof_consent_codes WHERE consent_id = ? AND datetime(created_at) > datetime(?)',
    ).bind(row.id, new Date(nowMs - 3600_000).toISOString()).first<{ n: number }>();
    if (Number(recent?.n || 0) >= CODES_PER_HOUR) {
      return refuse(c, 429, { code: 'code_rate_limited', message: 'Several codes were sent in the last hour. Use the latest one, or try again later.' });
    }
    const code = newCode();
    await c.env.DB.prepare(
      'INSERT INTO partner_proof_consent_codes (consent_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)',
    ).bind(row.id, await proofCodeHash(row.id, code), new Date(nowMs + CODE_TTL_MS).toISOString(), new Date(nowMs).toISOString()).run();
    const sent = await proofConsentMailer.send(c.env, to, firm?.company || firm?.name || 'A firm', code);
    if (!sent) return refuse(c, 503, { code: 'code_unsent', message: 'The code could not be emailed just now. Try again in a few minutes.' });
    return c.json({ sent: true, email_hint: maskEmail(to), expires_in_seconds: CODE_TTL_MS / 1000 });
  } catch (e) { return mapError(c, e); }
});

/**
 * The client answers (D4672). The link names the request; the code proves the
 * person answering reads the address the firm named, and is spent by the
 * answer. `claim_sha256` is the claim the client was shown: a confirmation is
 * recorded only when it is the claim this request pinned AND the item still
 * reads that way. Declining or withdrawing closes the request for good. A
 * signed-in member of the firm is refused even with a code.
 *
 * `requireAuth` is deliberately absent: the counterparty on an engagement is
 * often not a user of this product.
 */
partnerOffers.post('/proof-consents/:token/respond', async (c) => {
  try {
    const found = await consentByToken(c.env, String(c.req.param('token') || ''));
    if (!found) return refuse(c, 404, NO_REQUEST);
    const { row, item, currentSha } = found;
    const b = await body<any>(c);
    const caller = await getCurrentUser(c).catch(() => null);
    if (caller?.partner_id != null && Number(caller.partner_id) === Number(item.partner_id)) {
      return refuse(c, 403, { code: 'requester_cannot_confirm', message: 'Your firm cannot answer a request about its own claim.' });
    }
    const code = typeof b.code === 'string' ? b.code.trim() : '';
    if (!/^\d{6}$/.test(code)) return refuse(c, 400, { code: 'code_required', message: 'Enter the six-digit code emailed to you.' });
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const latest = await c.env.DB.prepare(
      'SELECT id, code_hash, expires_at, attempts, used_at FROM partner_proof_consent_codes WHERE consent_id = ? ORDER BY id DESC LIMIT 1',
    ).bind(row.id).first<{ id: number; code_hash: string; expires_at: string; attempts: number; used_at: string | null }>();
    if (!latest || latest.used_at || Date.parse(latest.expires_at) <= nowMs || Number(latest.attempts) >= CODE_MAX_ATTEMPTS) {
      return refuse(c, 401, { code: 'code_expired', message: 'That code has expired or was already used. Ask for a new one.' });
    }
    if (latest.code_hash !== await proofCodeHash(row.id, code)) {
      await c.env.DB.prepare('UPDATE partner_proof_consent_codes SET attempts = attempts + 1 WHERE id = ?').bind(latest.id).run();
      return refuse(c, 401, { code: 'code_wrong', message: 'That code is not right. Check the latest email and try again.' });
    }

    const declining = b.consent_given === false;
    const why = unanswerable(row, currentSha);
    if (why) return refuse(c, 409, why);
    let consentText = '';
    if (!declining) {
      if (Number(row.consent_given) === 1) {
        return refuse(c, 409, { code: 'already_confirmed', message: 'You have already confirmed this. To take it back, withdraw it.' });
      }
      consentText = String(b.consent_text || '').trim();
      if (!consentText) return refuse(c, 400, { code: 'consent_text_required', message: 'consent_text must record what was agreed to.' });
      if (row.claim_sha256 !== currentSha || b.claim_sha256 !== row.claim_sha256) {
        return refuse(c, 409, { code: 'claim_changed', message: 'The claim has changed since you were asked. Nothing was recorded; the firm needs to ask again.' });
      }
    }

    // The code is spent before anything is written, so it answers once.
    const spent = await c.env.DB.prepare('UPDATE partner_proof_consent_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .bind(now, latest.id).run();
    if (!Number((spent as any)?.meta?.changes ?? 1)) {
      return refuse(c, 401, { code: 'code_expired', message: 'That code has expired or was already used. Ask for a new one.' });
    }

    if (declining) {
      // Declining and withdrawing are the same shape: the row stays, says no,
      // and the request is closed. The event says which it was.
      const upd = await c.env.DB.prepare(
        `UPDATE partner_proof_consents
            SET consent_given = 0, withdrawn_at = ?, closed_at = ?, updated_at = ?
          WHERE id = ? AND withdrawn_at IS NULL AND closed_at IS NULL`,
      ).bind(now, now, now, row.id).run();
      if (Number((upd as any)?.meta?.changes ?? 1)) {
        await proofEvent(c.env, row.id, row.consent_given_at ? 'withdrawn' : 'declined', row.revision, row.claim_sha256, now);
      }
    } else {
      const upd = await c.env.DB.prepare(
        `UPDATE partner_proof_consents
            SET consent_given = 1, consent_given_at = ?, consent_text = ?, updated_at = ?
          WHERE id = ? AND consent_given = 0 AND withdrawn_at IS NULL AND closed_at IS NULL AND claim_sha256 = ?`,
      ).bind(now, consentText.slice(0, 2000), now, row.id, currentSha).run();
      if (!Number((upd as any)?.meta?.changes ?? 1)) {
        return refuse(c, 409, { code: 'consent_closed', message: 'This request changed while you were answering. Nothing was recorded; reload to see where it stands.' });
      }
      await proofEvent(c.env, row.id, 'confirmed', row.revision, currentSha, now);
    }
    const out = await c.env.DB.prepare('SELECT * FROM partner_proof_consents WHERE id = ?')
      .bind(row.id).first<ConsentRow>();
    // The client's own answer: never the firm's link, never the address.
    const { invite_token: _link, consenter_email: _addr, ...answer } = consentDto(out!, currentSha);
    return c.json(answer);
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Audience fit
// ---------------------------------------------------------------------------

const FIT_KINDS = ['budget_floor', 'sector_declined', 'capability_absent', 'best_fit'];

/**
 * How strong a fit a PROFILE is, in the firm's own words (migration 229).
 *
 * NOT A SCORE, AND `enforcement` STAYS `'none'`. Nothing computes this about
 * anybody: a firm writes "Series A companies without design leadership —
 * qualified" the way it writes the sentence beside it. The artboard's own
 * `Weak intent` row is the point of the field — "pre-product founders read as
 * weak intent rather than declined, because the honest answer is 'not yet'".
 */
const FIT_SIGNALS = ['best_fit', 'qualified', 'weak_intent'];

/**
 * A signal is meaningful only on a profile row. An exclusion has no strength —
 * a declined sector is declined — so one sent on any other kind is refused
 * rather than stored where nothing reads it. Migration 229's CHECK cannot say
 * this, because a CHECK on an added column may not reference another column.
 */
function signalFor(kind: string, raw: unknown): { signal: string | null } | { error: string } {
  if (raw === null || raw === undefined || raw === '') return { signal: null };
  const s = String(raw);
  if (!FIT_SIGNALS.includes(s)) return { error: `Signal must be one of ${FIT_SIGNALS.join(', ')}` };
  if (kind !== 'best_fit') return { error: 'Only a fit profile carries a signal; an exclusion has no strength' };
  return { signal: s };
}

async function ownFitRule(env: Env, partnerId: number, id: number) {
  const row = await env.DB.prepare('SELECT * FROM partner_fit_rules WHERE id = ?')
    .bind(id).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) throw notFound('Fit rule');
  return row;
}

function fitDto(r: any) {
  return {
    id: Number(r.id),
    uid: r.uid,
    kind: r.kind,
    signal: r.signal ?? null,
    floor_cents: r.floor_cents === null || r.floor_cents === undefined ? null : Number(r.floor_cents),
    value: r.value ?? null,
    statement: r.statement ?? null,
    referred_to: r.referred_to ?? null,
    is_active: !!r.is_active,
    created_at: r.created_at,
  };
}

/**
 * How Pipeline uses the rules — the one definition the response and the zone
 * copy are written from. `enforcement` was `'none'` here while `scoreLead`
 * read the same rows to score and to exclude, so the response contradicted the
 * page beside it (#4696). Active rules only; an inactive rule is read by nothing.
 */
export const FIT_RULE_USE = {
  enforcement: 'score_and_rank',
  used_for: [
    'A budget floor, a best-fit profile and its signal (best fit or weak intent) become receipts on a lead’s score in Pipeline · Leads.',
    'A declined sector or an absent capability that a lead mentions marks the lead excluded: it carries your sentence and no score, and it is left out of the ranking.',
  ],
  not_used_for: [
    'No lead is rejected, declined or hidden: an excluded lead is still listed, and a pass is your click and your sentence.',
    'A qualified signal is a note you keep; scoring reads best fit and weak intent only.',
  ],
  note: 'Pipeline reads your active rules to score leads and to leave a lead that matches a declined sector or an absent capability out of its ranking. Nothing is auto-declined: an excluded lead stays on Leads, and passing on it is still your click.',
} as const;

partnerOffers.get('/fit-rules', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM partner_fit_rules WHERE partner_id = ?
        ORDER BY is_active DESC, kind, id`,
    ).bind(partnerId).all<any>();
    const items = (rows.results || []).map(fitDto);
    const active = items.filter((x: any) => x.is_active);
    return c.json({
      items,
      // A rule with no statement produces exactly the silence the zone exists
      // to replace, so the count of them is returned rather than left for the
      // reader to notice row by row.
      unstated_count: active.filter((x: any) => !x.statement).length,
      // WHAT READS THESE, said in the response so the page cannot imply
      // otherwise (#4696). Pipeline · Leads reads the active rules to score a
      // lead and to leave an excluded one out of the AI ranking
      // (`scoreLead` and `POST /leads/rank` in routes/partner_pipeline.ts).
      // Neither declines, rejects or hides anything: an excluded lead is still
      // listed, and passing on a lead is the firm's own click.
      enforcement: FIT_RULE_USE.enforcement,
      auto_decline: false,
      used_for: FIT_RULE_USE.used_for,
      not_used_for: FIT_RULE_USE.not_used_for,
      enforcement_note: FIT_RULE_USE.note,
    });
  } catch (e) { return mapError(c, e); }
});

partnerOffers.post('/fit-rules', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const b = await body<any>(c);
    const kind = String(b.kind ?? '');
    if (!FIT_KINDS.includes(kind)) {
      return c.json({ detail: `Kind must be one of ${FIT_KINDS.join(', ')}` }, 400);
    }
    const floor = parseCents(b.floor_cents, 'Budget floor');
    if ('error' in floor) return c.json({ detail: floor.error }, 400);
    if (kind === 'budget_floor' && floor.cents === null) {
      return c.json({ detail: 'A budget floor needs an amount' }, 400);
    }
    const value = trimOrNull(b.value, 200);
    if (kind !== 'budget_floor' && !value) {
      return c.json({ detail: 'Name the sector, capability or fit this rule is about' }, 400);
    }
    const sig = signalFor(kind, b.signal);
    if ('error' in sig) return c.json({ detail: sig.error }, 400);
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_fit_rules
         (uid, partner_id, kind, signal, floor_cents, value, statement, referred_to, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      newUid(), partnerId, kind, sig.signal,
      // A floor is only meaningful on a budget_floor rule; storing one on a
      // declined sector would put an amount where the zone reads a reason.
      kind === 'budget_floor' ? floor.cents : null,
      value, trimOrNull(b.statement, 1000), trimOrNull(b.referred_to, 300),
      nowIso(), nowIso(),
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM partner_fit_rules WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json(fitDto(row));
  } catch (e) { return mapError(c, e); }
});

partnerOffers.patch('/fit-rules/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownFitRule(c.env, partnerId, id);
    const b = await body<any>(c);
    const merged = mergePatch(row, b, [
      'kind', 'floor_cents', 'value', 'statement', 'referred_to', 'is_active',
    ]);
    const kind = String(merged.kind);
    if (!FIT_KINDS.includes(kind)) {
      return c.json({ detail: `Kind must be one of ${FIT_KINDS.join(', ')}` }, 400);
    }
    const floor = parseCents(merged.floor_cents, 'Budget floor');
    if ('error' in floor) return c.json({ detail: floor.error }, 400);
    if (kind === 'budget_floor' && floor.cents === null) {
      return c.json({ detail: 'A budget floor needs an amount' }, 400);
    }
    const value = trimOrNull(merged.value, 200);
    if (kind !== 'budget_floor' && !value) {
      return c.json({ detail: 'Name the sector, capability or fit this rule is about' }, 400);
    }
    // `signal` IS NOT MERGED THE WAY THE OTHER FIELDS ARE, and the difference
    // matters. A signal the caller SENDS is validated strictly, so an attempt to
    // put a strength on an exclusion is refused rather than dropped. A signal
    // the ROW already carries is inherited only while the rule is still a
    // profile: editing a graded profile into a declined sector clears it, the
    // same way the floor is cleared one line down, because an exclusion has no
    // strength and a merge that kept one would refuse the edit outright.
    const sent = Object.prototype.hasOwnProperty.call(b, 'signal');
    const sig = signalFor(kind, sent ? b.signal : (kind === 'best_fit' ? row.signal : null));
    if ('error' in sig) return c.json({ detail: sig.error }, 400);
    await c.env.DB.prepare(
      `UPDATE partner_fit_rules
          SET kind = ?, signal = ?, floor_cents = ?, value = ?, statement = ?, referred_to = ?,
              is_active = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      kind, sig.signal, kind === 'budget_floor' ? floor.cents : null, value,
      trimOrNull(merged.statement, 1000), trimOrNull(merged.referred_to, 300),
      merged.is_active ? 1 : 0, nowIso(), id,
    ).run();
    const out = await c.env.DB.prepare('SELECT * FROM partner_fit_rules WHERE id = ?')
      .bind(id).first<any>();
    return c.json(fitDto(out));
  } catch (e) { return mapError(c, e); }
});

partnerOffers.delete('/fit-rules/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownFitRule(c.env, partnerId, id);
    await c.env.DB.prepare('DELETE FROM partner_fit_rules WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export { partnerOffers };
export default partnerOffers;

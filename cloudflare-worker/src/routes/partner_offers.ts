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
import { requireAuth } from '../auth';
import {
  mapError, newUid, nowIso, requirePartnerProfile, trimOrNull,
} from './_t13t14t15_helpers';
import {
  mergePatch, parseCents, requireOwnEngagement, requirePartnerRole,
} from './_partner_workspace_helpers';

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
              SUM(COALESCE(e.price, 0)) AS won_value
         FROM partner_surfaces s
         LEFT JOIN engagement_sources es ON es.surface_id = s.id
         LEFT JOIN engagements e ON e.id = es.engagement_id AND e.partner_id = s.partner_id
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
        // Dollars, not cents: `engagements.price` is a grandfathered REAL.
        won_value: Number(r.won_value || 0),
        // The zone's whole argument is that this column cannot be filled, so
        // the reason travels with the absence rather than being page copy that
        // could drift away from the data.
        views: null,
        views_note: 'No impression is recorded anywhere in the product, so a view count would be invented rather than measured.',
      })),
      engagement_total: total,
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
         LEFT JOIN users f ON f.id = e.founder_id
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

/**
 * A consent as the FIRM may see it.
 *
 * `request_token` is never included — it is the client's credential for
 * answering, and a firm that could read it back could answer on the client's
 * behalf, which would make every consent in the table self-issued and worth
 * nothing. The same reasoning `advisors.ts` records; the column names are 209's
 * (`consenter_*`, `consent_text`), NOT 204's.
 */
function consentDto(r: any) {
  return {
    id: Number(r.id),
    uid: r.uid,
    proof_item_id: Number(r.proof_item_id),
    consenter_name: r.consenter_name,
    consenter_email: r.consenter_email ?? null,
    consenter_role: r.consenter_role ?? null,
    requested_at: r.requested_at ?? null,
    consent_given: !!r.consent_given,
    consent_given_at: r.consent_given_at ?? null,
    // The exact words agreed to. Consent to "a case study" and consent to "a
    // case study naming our revenue" are different consents, so the wording is
    // returned rather than a boolean standing in for it.
    consent_text: r.consent_text ?? null,
    withdrawn_at: r.withdrawn_at ?? null,
    created_at: r.created_at,
  };
}

/**
 * PUBLISHED IS DERIVED, never stored — migration 209's header, enforced here.
 *
 * A live consent is `consent_given = 1 AND withdrawn_at IS NULL`. Both halves,
 * so a withdrawal cannot be undone by forgetting to update one of two columns.
 *
 * `status` is `published` or `self_stated`, and the second word is the point:
 * the firm's own account of a result and the client's confirmation of it are
 * different evidence and must never render identically. An item with no consent
 * is the firm reporting a metric about itself, which the zone says out loud.
 */
function proofDto(r: any, consents: any[]) {
  const live = consents.filter((x) => Number(x.consent_given) === 1 && !x.withdrawn_at);
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
    is_published: live.length > 0,
    status: live.length > 0 ? 'published' : 'self_stated',
    consents: consents.map(consentDto),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function ownProofItem(env: Env, partnerId: number, id: number) {
  const row = await env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
    .bind(id).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) throw notFound('Proof item');
  return row;
}

partnerOffers.get('/proof', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const items = await c.env.DB.prepare(
      `SELECT p.*, e.uid AS engagement_uid, n.title AS need_title, f.name AS founder_name
         FROM partner_proof_items p
         LEFT JOIN engagements e ON e.id = p.engagement_id
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN users f ON f.id = e.founder_id
        WHERE p.partner_id = ?
        ORDER BY p.created_at DESC
        LIMIT 200`,
    ).bind(partnerId).all<any>();

    // Joined back to `partner_proof_items.partner_id` for the same two reasons
    // the pipeline reads do: no `${}` reaches `DB.prepare`, and a consent can
    // only come back for an item this firm owns.
    const consents = await c.env.DB.prepare(
      `SELECT k.*
         FROM partner_proof_consents k
         JOIN partner_proof_items p ON p.id = k.proof_item_id
        WHERE p.partner_id = ?
        ORDER BY k.proof_item_id, k.created_at ASC`,
    ).bind(partnerId).all<any>();
    const byItem = new Map<number, any[]>();
    for (const k of consents.results || []) {
      const id = Number(k.proof_item_id);
      if (!byItem.has(id)) byItem.set(id, []);
      byItem.get(id)!.push(k);
    }

    const list = (items.results || []).map((r: any) => proofDto(r, byItem.get(Number(r.id)) || []));
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
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_proof_items
         (uid, partner_id, engagement_id, kind, title, detail, outcome_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), partnerId, engagementId, kind, title,
      trimOrNull(b.detail, 4000), trimOrNull(b.outcome_note, 1000), nowIso(), nowIso(),
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json(proofDto(row, []));
  } catch (e) { return mapError(c, e); }
});

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
    if (merged.engagement_id !== null && merged.engagement_id !== undefined) {
      const e = await requireOwnEngagement(c.env, partnerId, Number(merged.engagement_id));
      engagementId = Number(e.id);
    }
    await c.env.DB.prepare(
      `UPDATE partner_proof_items
          SET engagement_id = ?, kind = ?, title = ?, detail = ?, outcome_note = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      engagementId, String(merged.kind), title,
      trimOrNull(merged.detail, 4000), trimOrNull(merged.outcome_note, 1000), nowIso(), id,
    ).run();
    const out = await c.env.DB.prepare('SELECT * FROM partner_proof_items WHERE id = ?')
      .bind(id).first<any>();
    const consents = await c.env.DB.prepare(
      'SELECT * FROM partner_proof_consents WHERE proof_item_id = ? ORDER BY created_at ASC',
    ).bind(id).all<any>();
    return c.json(proofDto(out, consents.results || []));
  } catch (e) { return mapError(c, e); }
});

partnerOffers.delete('/proof/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownProofItem(c.env, partnerId, id);
    // The consents go with it. A consent row whose item is gone is a record of
    // a decision about nothing, and it would keep a person's name and email
    // in the store after the thing they agreed to had been removed.
    await c.env.DB.prepare('DELETE FROM partner_proof_consents WHERE proof_item_id = ?')
      .bind(id).run();
    await c.env.DB.prepare('DELETE FROM partner_proof_items WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/**
 * Record the ASK. It does not send it.
 *
 * Whether this product should email a client on a firm's behalf is a separate
 * decision, and a route that quietly sent mail to an address a user typed would
 * be making it. The token is returned to the firm ONCE here so the link can be
 * handed over by whatever channel they already have with the client; no later
 * read includes it.
 */
partnerOffers.post('/proof/:id/consent-request', async (c) => {
  try {
    const { user, partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const item = await ownProofItem(c.env, partnerId, id);
    const b = await body<any>(c);
    const name = trimOrNull(b.consenter_name, 200);
    if (!name) return c.json({ detail: 'Name the person being asked to confirm' }, 400);
    const token = newUid();
    const now = nowIso();
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_proof_consents
         (uid, proof_item_id, consenter_name, consenter_email, consenter_role,
          requested_at, requested_by, request_token, consent_given, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      newUid(), item.id, name,
      trimOrNull(b.consenter_email, 300), trimOrNull(b.consenter_role, 200),
      now, user.id, token, now, now,
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM partner_proof_consents WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json({ ...consentDto(row), request_token: token, delivered: false });
  } catch (e) { return mapError(c, e); }
});

/**
 * The firm records a withdrawal it was told about out of band.
 *
 * WITHDRAWAL IS A STATE, NOT A DELETE — 209's header. The row stays and says
 * so, because a consent that can silently vanish is not evidence, and because
 * the fact that consent was once given and then taken back is itself worth
 * keeping. The firm CANNOT grant consent through any route: only the token
 * holder can, which is the whole value of the record.
 */
partnerOffers.post('/proof/:id/consents/:consentId/withdraw', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownProofItem(c.env, partnerId, id);
    const consentId = Number(c.req.param('consentId'));
    const row = await c.env.DB.prepare(
      'SELECT * FROM partner_proof_consents WHERE id = ? AND proof_item_id = ?',
    ).bind(consentId, id).first<any>();
    if (!row) return c.json({ detail: 'Consent not found' }, 404);
    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE partner_proof_consents
          SET consent_given = 0, withdrawn_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, now, consentId).run();
    const out = await c.env.DB.prepare('SELECT * FROM partner_proof_consents WHERE id = ?')
      .bind(consentId).first<any>();
    return c.json(consentDto(out));
  } catch (e) { return mapError(c, e); }
});

/**
 * The client answers. Token-authenticated and NOT firm-scoped.
 *
 * `requireAuth` is deliberately absent, for the reason `advisors.ts` records
 * for its twin: the counterparty on an engagement is often not a user of this
 * product, and requiring an account would mean the only publishable outcomes
 * are the ones a client who already has an Axal login will vouch for.
 *
 * Three segments with a literal first, so `/proof/:id` two segments up cannot
 * shadow it and neither can any future single-segment route.
 */
partnerOffers.post('/proof-consents/:token/respond', async (c) => {
  try {
    const token = String(c.req.param('token') || '');
    const row = await c.env.DB.prepare(
      'SELECT * FROM partner_proof_consents WHERE request_token = ?',
    ).bind(token).first<any>();
    if (!row) return c.json({ detail: 'Consent request not found' }, 404);
    const b = await body<any>(c);
    const now = nowIso();
    if (b.consent_given === false) {
      // Declining and withdrawing are the same shape: the row stays and says
      // no. A request that vanished on refusal would let a firm re-ask until
      // it got a yes, with nothing on the record.
      await c.env.DB.prepare(
        `UPDATE partner_proof_consents
            SET consent_given = 0, withdrawn_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(now, now, row.id).run();
    } else {
      const text = String(b.consent_text || '').trim();
      if (!text) {
        return c.json({ detail: 'consent_text must record what was agreed to' }, 400);
      }
      await c.env.DB.prepare(
        `UPDATE partner_proof_consents
            SET consent_given = 1, consent_given_at = ?, consent_text = ?,
                withdrawn_at = NULL, updated_at = ?
          WHERE id = ?`,
      ).bind(now, text.slice(0, 2000), now, row.id).run();
    }
    const out = await c.env.DB.prepare('SELECT * FROM partner_proof_consents WHERE id = ?')
      .bind(row.id).first<any>();
    return c.json(consentDto(out));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Audience fit
// ---------------------------------------------------------------------------

const FIT_KINDS = ['budget_floor', 'sector_declined', 'capability_absent', 'best_fit'];

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
    floor_cents: r.floor_cents === null || r.floor_cents === undefined ? null : Number(r.floor_cents),
    value: r.value ?? null,
    statement: r.statement ?? null,
    referred_to: r.referred_to ?? null,
    is_active: !!r.is_active,
    created_at: r.created_at,
  };
}

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
      // Nothing runs these. Said in the response so the page cannot imply
      // otherwise while the response says nothing either way.
      enforcement: 'none',
      enforcement_note: 'These rules are a record a person reads before passing on a lead. Nothing scores, filters or auto-declines against them.',
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
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_fit_rules
         (uid, partner_id, kind, floor_cents, value, statement, referred_to, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      newUid(), partnerId, kind,
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
    await c.env.DB.prepare(
      `UPDATE partner_fit_rules
          SET kind = ?, floor_cents = ?, value = ?, statement = ?, referred_to = ?,
              is_active = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      kind, kind === 'budget_floor' ? floor.cents : null, value,
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

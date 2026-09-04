/**
 * /api/partner/pipeline — Negotiations and Retainers.
 *
 * Two of the nine partner workspace zones that rendered a "no store behind
 * this yet" card until migration 208 gave them one. This file is the first
 * thing that reads those tables.
 *
 * WHAT THE ZONES ASKED FOR AND WHY THE STORE IS SHAPED THIS WAY:
 *
 *   NEGOTIATIONS. A quote is sent or decided; the conversation between those
 *   two states was unmodelled. `quote_negotiations` adds the stage, whose move
 *   it is, and the one open question blocking it — the canvas's own framing is
 *   that "a negotiation without a named blocker is a negotiation nobody is
 *   running". `quote_terms` adds the clause-level view: what we asked, what
 *   they asked, where it lands. Three positions rather than one value, because
 *   collapsing to a current value loses the two halves that explain the third.
 *
 *   RETAINERS. An engagement is a single accepted quote at a single price, so
 *   nothing distinguished a retainer from a one-off. `partner_retainers.shape`
 *   is that missing fact and every figure on the zone depends on it.
 *
 * CONVENTIONS, from `needs.ts`: lists are `{items:[…]}`, a single item is a
 * bare DTO, composite reads use named top-level keys, writes with nothing to
 * return are `{ok:true}`, and every >=400 carries `{detail:'Human sentence'}`.
 * Ownership failures are 404 rather than 403 — a non-owner must not learn the
 * row exists.
 *
 * NO DYNAMIC SQL. `check-sql-prepare.mjs` fails a new `${}` inside
 * `DB.prepare`, so every PATCH is read → merge in JS → one literal UPDATE with
 * the full column list bound. That also preserves the semantics a PATCH ought
 * to have: an absent key leaves a column alone, an explicit null clears it.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  mapError, newUid, nowIso, requirePartnerProfile, trimOrNull,
} from './_t13t14t15_helpers';
import {
  daysBetween, mergePatch, parseCents, parseHours, parsePeriod,
  requireOwnEngagement, requireOwnQuote, requirePartnerRole, utilisationFor,
} from './_partner_workspace_helpers';

const partnerPipeline = new Hono<{ Bindings: Env }>();

/** The partner row for the caller, or a throw `mapError` will shape. */
async function actingPartner(c: any): Promise<{ user: User; partnerId: number }> {
  const user = (await requireAuth(c)) as User;
  requirePartnerRole(user);
  const partner = await requirePartnerProfile(c.env, user);
  return { user, partnerId: Number(partner.id) };
}

async function body<T>(c: any): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T;
}

// ---------------------------------------------------------------------------
// Negotiations
// ---------------------------------------------------------------------------

function negotiationDto(r: any) {
  return {
    id: Number(r.id),
    uid: r.uid,
    quote_id: Number(r.quote_id),
    stage: r.stage,
    ball: r.ball,
    open_question: r.open_question ?? null,
    last_moved_at: r.last_moved_at,
    // Computed here AND the raw timestamp returned beside it. A page computing
    // its own age from a clock that is not the server's would make the row and
    // the "stalled 7d+" count disagree about the same negotiation.
    days_stalled: daysBetween(r.last_moved_at),
  };
}

function termDto(r: any) {
  return {
    id: Number(r.id),
    uid: r.uid,
    negotiation_id: Number(r.negotiation_id),
    label: r.label,
    our_position: r.our_position ?? null,
    their_position: r.their_position ?? null,
    landing: r.landing ?? null,
    state: r.state,
  };
}

const STAGES = ['scoping', 'terms', 'legal', 'ready_to_sign', 'closed'];
const BALLS = ['us', 'them'];
const TERM_STATES = ['open', 'agreed', 'conceded', 'refused'];

partnerPipeline.get('/negotiations', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const rows = await c.env.DB.prepare(
      `SELECT q.id AS quote_id, q.uid AS quote_uid, q.price, q.status AS quote_status,
              q.need_id, n.title AS need_title, n.category AS need_category,
              g.id AS negotiation_id, g.uid AS negotiation_uid, g.stage, g.ball,
              g.open_question, g.last_moved_at
         FROM quotes q
         LEFT JOIN founder_needs n ON n.id = q.need_id
         LEFT JOIN quote_negotiations g ON g.quote_id = q.id
        WHERE q.partner_id = ?
        ORDER BY q.created_at DESC
        LIMIT 200`,
    ).bind(partnerId).all<any>();

    const list = rows.results || [];

    // The terms for every negotiation this firm owns, in one read.
    //
    // JOINED BACK TO `quotes.partner_id` RATHER THAN `IN (…ids)`. Two reasons,
    // and the second is the one that matters: an id list built in JS becomes a
    // `${}` inside `DB.prepare`, which `check-sql-prepare.mjs` fails on sight
    // — placeholders are safe but the check cannot tell a placeholder string
    // from a value, and it is right not to try. And the ownership predicate
    // then lives in the query rather than in the JS that assembled the list,
    // so a term can only be returned for a quote that is this partner's.
    const terms = await c.env.DB.prepare(
      `SELECT t.*
         FROM quote_terms t
         JOIN quote_negotiations g ON g.id = t.negotiation_id
         JOIN quotes q ON q.id = g.quote_id
        WHERE q.partner_id = ?
        ORDER BY t.negotiation_id, t.id`,
    ).bind(partnerId).all<any>();
    const termsByNegotiation = new Map<number, any[]>();
    for (const t of terms.results || []) {
      const k = Number(t.negotiation_id);
      if (!termsByNegotiation.has(k)) termsByNegotiation.set(k, []);
      termsByNegotiation.get(k)!.push(termDto(t));
    }

    const items = list.map((r: any) => ({
      quote_id: Number(r.quote_id),
      quote_uid: r.quote_uid,
      quote_status: r.quote_status,
      price: r.price,
      need_id: r.need_id ? Number(r.need_id) : null,
      need_title: r.need_title ?? null,
      need_category: r.need_category ?? null,
      negotiation: r.negotiation_id ? negotiationDto(r) : null,
      terms: r.negotiation_id ? (termsByNegotiation.get(Number(r.negotiation_id)) || []) : [],
    }));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

/**
 * PUT because `idx_quote_negotiations_quote` is UNIQUE on quote_id — one
 * negotiation per quote, so this is an upsert rather than a create.
 *
 * `last_moved_at` advances on a STAGE or BALL change, or on an explicit
 * `touch: true`. It deliberately does NOT advance when only `open_question`
 * changes: rewording the question is not a move, and if it reset the clock the
 * "stalled 7d+" count could be cleared by typing.
 */
partnerPipeline.put('/negotiations/:quoteId', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const quoteId = Number(c.req.param('quoteId'));
    await requireOwnQuote(c.env, partnerId, quoteId);
    const b = await body<any>(c);

    const existing = await c.env.DB.prepare(
      'SELECT * FROM quote_negotiations WHERE quote_id = ?',
    ).bind(quoteId).first<any>();

    const stage = b.stage === undefined ? (existing?.stage ?? 'scoping') : String(b.stage);
    const ball = b.ball === undefined ? (existing?.ball ?? 'them') : String(b.ball);
    if (!STAGES.includes(stage)) return c.json({ detail: `Stage must be one of ${STAGES.join(', ')}` }, 400);
    if (!BALLS.includes(ball)) return c.json({ detail: "Ball must be 'us' or 'them'" }, 400);

    const openQuestion = Object.prototype.hasOwnProperty.call(b, 'open_question')
      ? trimOrNull(b.open_question, 600)
      : (existing?.open_question ?? null);

    const moved = !existing
      || stage !== existing.stage
      || ball !== existing.ball
      || b.touch === true;
    const lastMoved = moved ? nowIso() : existing.last_moved_at;

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE quote_negotiations
            SET stage = ?, ball = ?, open_question = ?, last_moved_at = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(stage, ball, openQuestion, lastMoved, nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO quote_negotiations
           (uid, quote_id, stage, ball, open_question, last_moved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newUid(), quoteId, stage, ball, openQuestion, lastMoved, nowIso(), nowIso()).run();
    }
    const row = await c.env.DB.prepare(
      'SELECT * FROM quote_negotiations WHERE quote_id = ?',
    ).bind(quoteId).first<any>();
    return c.json(negotiationDto(row));
  } catch (e) { return mapError(c, e); }
});

/**
 * No DELETE on a negotiation. `stage: 'closed'` is in the CHECK constraint for
 * exactly this: deleting the row would lose the conversation that produced the
 * decision, which is the only part of it worth keeping afterwards.
 */

partnerPipeline.post('/negotiations/:quoteId/terms', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const quoteId = Number(c.req.param('quoteId'));
    await requireOwnQuote(c.env, partnerId, quoteId);
    const b = await body<any>(c);
    const label = trimOrNull(b.label, 160);
    if (!label) return c.json({ detail: 'A term needs a label — what is being negotiated' }, 400);

    // Auto-create the negotiation: a term implies one, and making the caller
    // create the parent first would be a round trip that exists only because
    // of our table layout.
    let negotiation = await c.env.DB.prepare(
      'SELECT * FROM quote_negotiations WHERE quote_id = ?',
    ).bind(quoteId).first<any>();
    if (!negotiation) {
      await c.env.DB.prepare(
        `INSERT INTO quote_negotiations (uid, quote_id, last_moved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(newUid(), quoteId, nowIso(), nowIso(), nowIso()).run();
      negotiation = await c.env.DB.prepare(
        'SELECT * FROM quote_negotiations WHERE quote_id = ?',
      ).bind(quoteId).first<any>();
    }

    const state = b.state === undefined ? 'open' : String(b.state);
    if (!TERM_STATES.includes(state)) return c.json({ detail: `State must be one of ${TERM_STATES.join(', ')}` }, 400);

    const ins = await c.env.DB.prepare(
      `INSERT INTO quote_terms
         (uid, negotiation_id, label, our_position, their_position, landing, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), negotiation.id, label,
      trimOrNull(b.our_position, 600), trimOrNull(b.their_position, 600),
      trimOrNull(b.landing, 600), state, nowIso(), nowIso(),
    ).run();
    const row = await c.env.DB.prepare('SELECT * FROM quote_terms WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<any>();
    return c.json(termDto(row));
  } catch (e) { return mapError(c, e); }
});

/** The term, if it hangs off a negotiation on a quote this partner owns. */
async function ownTerm(env: Env, partnerId: number, termId: number) {
  const row = await env.DB.prepare(
    `SELECT t.*, q.partner_id
       FROM quote_terms t
       JOIN quote_negotiations g ON g.id = t.negotiation_id
       JOIN quotes q ON q.id = g.quote_id
      WHERE t.id = ?`,
  ).bind(termId).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) {
    throw new Response(JSON.stringify({ detail: 'Term not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  return row;
}

partnerPipeline.patch('/negotiation-terms/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    const row = await ownTerm(c.env, partnerId, id);
    const b = await body<any>(c);
    const merged = mergePatch(row, b, ['label', 'our_position', 'their_position', 'landing', 'state']);
    if (!trimOrNull(merged.label, 160)) return c.json({ detail: 'A term needs a label' }, 400);
    if (!TERM_STATES.includes(String(merged.state))) {
      return c.json({ detail: `State must be one of ${TERM_STATES.join(', ')}` }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE quote_terms
          SET label = ?, our_position = ?, their_position = ?, landing = ?, state = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      trimOrNull(merged.label, 160), trimOrNull(merged.our_position, 600),
      trimOrNull(merged.their_position, 600), trimOrNull(merged.landing, 600),
      String(merged.state), nowIso(), id,
    ).run();
    const out = await c.env.DB.prepare('SELECT * FROM quote_terms WHERE id = ?').bind(id).first<any>();
    return c.json(termDto(out));
  } catch (e) { return mapError(c, e); }
});

partnerPipeline.delete('/negotiation-terms/:id', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const id = Number(c.req.param('id'));
    await ownTerm(c.env, partnerId, id);
    await c.env.DB.prepare('DELETE FROM quote_terms WHERE id = ?').bind(id).run();
    return c.json({ ok: true, id });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Retainers
// ---------------------------------------------------------------------------

const SHAPES = ['retainer', 'embedded_seat'];
const CADENCES = ['monthly', 'quarterly'];

/** The current period label for a cadence, from the server clock. */
function currentPeriod(cadence: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  if (cadence === 'quarterly') return `${y}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  return `${y}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

partnerPipeline.get('/retainers', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    // LEFT JOIN, matching `/negotiations` above: every engagement this firm
    // holds comes back, with `retainer: null` where none is recorded. An inner
    // join would return only the retainers that already exist, which reads as
    // an empty book to a firm whose engagements are all one-off — and leaves
    // the zone with no list to record the first retainer against.
    const rows = await c.env.DB.prepare(
      `SELECT e.id AS engagement_id, e.uid AS engagement_uid, e.status AS engagement_status,
              e.price, e.founder_id, e.delivered_at, e.cancelled_at,
              n.title AS need_title, f.name AS founder_name,
              r.id AS retainer_id, r.uid AS retainer_uid, r.shape, r.cadence,
              r.amount_cents, r.retained_hours, r.renews_at, r.ended_at
         FROM engagements e
         LEFT JOIN founder_needs n ON n.id = e.need_id
         LEFT JOIN users f ON f.id = e.founder_id
         LEFT JOIN partner_retainers r ON r.engagement_id = e.id
        WHERE e.partner_id = ?
        ORDER BY r.id IS NULL, r.renews_at IS NULL, r.renews_at, e.created_at DESC
        LIMIT 200`,
    ).bind(partnerId).all<any>();

    const list = rows.results || [];

    // Same join-back-to-owner shape as the terms read above, for the same two
    // reasons: no `${}` reaches `DB.prepare`, and a usage row can only come
    // back for a retainer on one of this firm's engagements.
    const usageRows = await c.env.DB.prepare(
      `SELECT u.*
         FROM retainer_usage u
         JOIN partner_retainers r ON r.id = u.retainer_id
         JOIN engagements e ON e.id = r.engagement_id
        WHERE e.partner_id = ?
        ORDER BY u.retainer_id, u.period DESC`,
    ).bind(partnerId).all<any>();
    const usageByRetainer = new Map<number, any[]>();
    for (const u of usageRows.results || []) {
      const k = Number(u.retainer_id);
      if (!usageByRetainer.has(k)) usageByRetainer.set(k, []);
      usageByRetainer.get(k)!.push({
        period: u.period, hours_used: Number(u.hours_used), note: u.note ?? null,
      });
    }

    let mrrCents = 0;
    let counted = 0;
    let unpriced = 0;
    let withRetainer = 0;
    const items = list.map((r: any) => {
      const base = {
        engagement_id: Number(r.engagement_id),
        engagement_uid: r.engagement_uid,
        engagement_status: r.engagement_status,
        engagement_price: r.price === null ? null : Number(r.price),
        founder_id: r.founder_id ? Number(r.founder_id) : null,
        founder_name: r.founder_name ?? null,
        need_title: r.need_title ?? null,
      };
      if (!r.retainer_id) {
        // Not a gap in a retainer — an engagement that is not one. The zone
        // offers it as something to record against; it is not counted as an
        // unpriced retainer, because it is not a retainer at all.
        return { ...base, retainer: null, current_period: null, usage: [], ...utilisationFor(null, null) };
      }
      withRetainer += 1;
      const period = currentPeriod(String(r.cadence));
      const usage = usageByRetainer.get(Number(r.retainer_id)) || [];
      const thisPeriod = usage.find((u: any) => u.period === period) || null;
      const u = utilisationFor(
        { retained_hours: r.retained_hours === null ? null : Number(r.retained_hours) },
        thisPeriod,
      );
      if (r.amount_cents === null || r.amount_cents === undefined) unpriced += 1;
      else {
        // A quarterly amount is not a monthly one. Dividing here rather than
        // summing raw is the difference between MRR and a number that is three
        // times too big for every quarterly line.
        mrrCents += r.cadence === 'quarterly'
          ? Math.round(Number(r.amount_cents) / 3)
          : Number(r.amount_cents);
        counted += 1;
      }
      return {
        ...base,
        retainer: {
          id: Number(r.retainer_id),
          uid: r.retainer_uid,
          shape: r.shape,
          cadence: r.cadence,
          amount_cents: r.amount_cents === null ? null : Number(r.amount_cents),
          retained_hours: r.retained_hours === null ? null : Number(r.retained_hours),
          renews_at: r.renews_at ?? null,
          ended_at: r.ended_at ?? null,
          days_to_renewal: r.renews_at ? -(daysBetween(r.renews_at) ?? 0) : null,
        },
        current_period: period,
        usage,
        ...u,
      };
    });

    return c.json({
      items,
      retainer_count: withRetainer,
      mrr_cents: counted ? mrrCents : null,
      // Says what it counted rather than presenting a total as complete. A
      // retainer with no amount is skipped, never counted as zero — zero would
      // claim the client pays nothing.
      mrr_basis: counted
        ? `${counted} retainer${counted === 1 ? '' : 's'} with a recorded amount; quarterly amounts divided by three.`
        : null,
      mrr_note: counted
        ? (unpriced ? `${unpriced} retainer${unpriced === 1 ? ' has' : 's have'} no amount recorded and ${unpriced === 1 ? 'is' : 'are'} not in this total.` : null)
        : (withRetainer
          ? 'No retainer has an amount recorded, so there is no monthly total to state.'
          : 'No engagement is recorded as a retainer yet, so there is no recurring total to state.'),
    });
  } catch (e) { return mapError(c, e); }
});

partnerPipeline.put('/retainers/:engagementId', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const b = await body<any>(c);

    const existing = await c.env.DB.prepare(
      'SELECT * FROM partner_retainers WHERE engagement_id = ?',
    ).bind(engagementId).first<any>();

    const shape = b.shape === undefined ? (existing?.shape ?? 'retainer') : String(b.shape);
    const cadence = b.cadence === undefined ? (existing?.cadence ?? 'monthly') : String(b.cadence);
    if (!SHAPES.includes(shape)) return c.json({ detail: `Shape must be one of ${SHAPES.join(', ')}` }, 400);
    if (!CADENCES.includes(cadence)) return c.json({ detail: `Cadence must be one of ${CADENCES.join(', ')}` }, 400);

    const amount = Object.prototype.hasOwnProperty.call(b, 'amount_cents')
      ? parseCents(b.amount_cents, 'Monthly amount')
      : { cents: existing ? existing.amount_cents : null };
    if ('error' in amount) return c.json({ detail: amount.error }, 400);

    const hours = Object.prototype.hasOwnProperty.call(b, 'retained_hours')
      ? parseHours(b.retained_hours, 'Retained hours')
      : { hours: existing ? existing.retained_hours : null };
    if ('error' in hours) return c.json({ detail: hours.error }, 400);

    const renewsAt = Object.prototype.hasOwnProperty.call(b, 'renews_at')
      ? trimOrNull(b.renews_at, 40) : (existing?.renews_at ?? null);
    const endedAt = Object.prototype.hasOwnProperty.call(b, 'ended_at')
      ? trimOrNull(b.ended_at, 40) : (existing?.ended_at ?? null);

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE partner_retainers
            SET shape = ?, cadence = ?, amount_cents = ?, retained_hours = ?,
                renews_at = ?, ended_at = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(shape, cadence, amount.cents, hours.hours, renewsAt, endedAt, nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO partner_retainers
           (uid, engagement_id, shape, cadence, amount_cents, retained_hours, renews_at, ended_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newUid(), engagementId, shape, cadence, amount.cents, hours.hours,
        renewsAt, endedAt, nowIso(), nowIso(),
      ).run();
    }
    const row = await c.env.DB.prepare(
      'SELECT * FROM partner_retainers WHERE engagement_id = ?',
    ).bind(engagementId).first<any>();
    return c.json({
      id: Number(row.id), uid: row.uid, engagement_id: engagementId,
      shape: row.shape, cadence: row.cadence,
      amount_cents: row.amount_cents === null ? null : Number(row.amount_cents),
      retained_hours: row.retained_hours === null ? null : Number(row.retained_hours),
      renews_at: row.renews_at ?? null, ended_at: row.ended_at ?? null,
    });
  } catch (e) { return mapError(c, e); }
});

partnerPipeline.delete('/retainers/:engagementId', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const row = await c.env.DB.prepare(
      'SELECT id FROM partner_retainers WHERE engagement_id = ?',
    ).bind(engagementId).first<any>();
    if (!row) return c.json({ detail: 'No retainer is recorded against this engagement' }, 404);
    await c.env.DB.prepare('DELETE FROM retainer_usage WHERE retainer_id = ?').bind(row.id).run();
    await c.env.DB.prepare('DELETE FROM partner_retainers WHERE id = ?').bind(row.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

partnerPipeline.put('/retainers/:engagementId/usage/:period', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const retainer = await c.env.DB.prepare(
      'SELECT * FROM partner_retainers WHERE engagement_id = ?',
    ).bind(engagementId).first<any>();
    if (!retainer) return c.json({ detail: 'Record the retainer before logging hours against it' }, 404);

    // Checked against THIS retainer's cadence: the column is free text, and
    // without this a monthly retainer accumulates a quarterly usage row and
    // utilisation divides one period's hours by another's allowance.
    const p = parsePeriod(c.req.param('period'), retainer.cadence === 'quarterly' ? 'quarterly' : 'monthly');
    if ('error' in p) return c.json({ detail: p.error }, 400);

    const b = await body<any>(c);
    const hours = parseHours(b.hours_used, 'Hours used');
    if ('error' in hours) return c.json({ detail: hours.error }, 400);
    if (hours.hours === null) return c.json({ detail: 'Hours used is required' }, 400);

    const existing = await c.env.DB.prepare(
      'SELECT id FROM retainer_usage WHERE retainer_id = ? AND period = ?',
    ).bind(retainer.id, p.period).first<any>();
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE retainer_usage SET hours_used = ?, note = ?, updated_at = ? WHERE id = ?',
      ).bind(hours.hours, trimOrNull(b.note, 400), nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO retainer_usage (retainer_id, period, hours_used, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(retainer.id, p.period, hours.hours, trimOrNull(b.note, 400), nowIso(), nowIso()).run();
    }
    const row = await c.env.DB.prepare(
      'SELECT * FROM retainer_usage WHERE retainer_id = ? AND period = ?',
    ).bind(retainer.id, p.period).first<any>();
    const u = utilisationFor(
      { retained_hours: retainer.retained_hours === null ? null : Number(retainer.retained_hours) },
      { hours_used: Number(row.hours_used) },
    );
    // `hours_used` comes from `...u` rather than being repeated here: the helper
    // already carries the figure it divided by, and two keys of the same name
    // would let the round-trip disagree with the percentage beside it.
    return c.json({
      retainer_id: Number(retainer.id), period: row.period,
      note: row.note ?? null, ...u,
    });
  } catch (e) { return mapError(c, e); }
});

partnerPipeline.delete('/retainers/:engagementId/usage/:period', async (c) => {
  try {
    const { partnerId } = await actingPartner(c);
    const engagementId = Number(c.req.param('engagementId'));
    await requireOwnEngagement(c.env, partnerId, engagementId);
    const retainer = await c.env.DB.prepare(
      'SELECT id FROM partner_retainers WHERE engagement_id = ?',
    ).bind(engagementId).first<any>();
    if (!retainer) return c.json({ detail: 'No retainer is recorded against this engagement' }, 404);
    // A real delete rather than writing zero: `hours_used: 0` is the claim that
    // they worked none, which is not the same as no record.
    await c.env.DB.prepare(
      'DELETE FROM retainer_usage WHERE retainer_id = ? AND period = ?',
    ).bind(retainer.id, String(c.req.param('period'))).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export { partnerPipeline };
export default partnerPipeline;

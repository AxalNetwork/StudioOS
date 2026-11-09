/**
 * #4715 (D4715) — Engagements: the contract behind the sessions, its lanes, renewals and corrections (migration 238).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError, nowIso, newUid, trimOrNull } from './_t13t14t15_helpers';
import { pageFacts, pageWindow } from '../services/listPage';
import {
  type AdvisorRow, type EngagementRow, PRACTICE_PAGE, parsePriceCents, requireMyAdvisor, requireOwnEngagement,
} from '../services/advisorPractice';

const advisors = new Hono<{ Bindings: Env }>();


// ---------------------------------------------------------------------------
// 238 — Engagements. The contract behind the sessions, and whether it renewed.
//
// WHY THESE ARE FOUR VERBS AND NOT ONE PATCH. `advisor_engagements` carries
// three fields nothing else in the product has — `lane`, `cycles` and
// `outcome` — and the renewal rate is computed from the last two. A single
// merge-PATCH over all three would let a caller set `outcome = 'renewed'`
// without a cycle behind it, or clear a cycle without a decision, and the
// instrument the artboard calls "the number that judges a practice" would be
// whatever the last writer typed. So the descriptive columns merge freely
// through PATCH, and the two columns the rate reads move ONLY through
// `/advance` (a lane) and `/renewal` (a decision), each with its own rules.
//
// THE ONE TRANSITION THAT IS REFUSED is signed → ended through `/advance`.
// Ending a signed contract IS the renewal decision that did not go the
// advisor's way, and routing it through the lane verb would drop it out of
// the denominator — the exact failure the canvas names: "a rate that excludes
// its failures is not a rate." Ending an UNSIGNED row is allowed there and
// records no outcome, because an abandoned draft never had a renewal to lose.
// ---------------------------------------------------------------------------
export const ENGAGEMENT_LANES = ['drafting', 'proposed', 'signed', 'renewal_due', 'ended'];
export const ENGAGEMENT_SHAPES = ['retainer', 'sprint', 'equity', 'per_call'];
/** The two lanes that mean "under contract" — what the Active tile counts. */
const SIGNED_LANES = new Set(['signed', 'renewal_due']);

/**
 * D4695: WHERE A LANE MAY GO THROUGH `/advance`, enforced here and not by the board.
 *   · an unsigned engagement moves between drafting and proposed, is signed, or is abandoned;
 *   · a signed one only flips between signed and renewal_due (a lane correction);
 *   · a signed one NEVER returns to drafting or proposed (that left an 'active' outcome on an unsigned row, which
 *     could then be ended without a decision), and it ends only through `/renewal`;
 *   · ended is terminal.
 */
export const ENGAGEMENT_GRAPH: Readonly<Record<string, readonly string[]>> = Object.freeze({
  drafting: ['proposed', 'signed', 'ended'],
  proposed: ['drafting', 'signed', 'ended'],
  signed: ['renewal_due'],
  renewal_due: ['signed'],
  ended: [],
});

/**
 * #4715 (D4715): the terms of an engagement, and which of them a write changes.
 * The client account link (`founder_user_id`) is not a term: linking who the
 * contract is with to their Axal account changes nothing either side signed.
 */
export const ENGAGEMENT_TERMS = ['client_name', 'shape', 'scope_label', 'scope_includes', 'scope_excludes', 'amount_cents', 'term_ends_at'] as const;
export function termChanges(before: Record<string, any>, after: Record<string, any>) {
  return ENGAGEMENT_TERMS
    .filter((f) => (before[f] ?? null) !== (after[f] ?? null))
    .map((f) => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }));
}

function engagementDto(r: EngagementRow): any {
  return {
    id: r.id, uid: r.uid, advisor_id: r.advisor_id,
    // NULL means the client is not (or not yet) a platform user. The name is
    // what the board renders either way — see migration 238's header.
    founder_user_id: r.founder_user_id ?? null,
    client_name: r.client_name,
    lane: r.lane, shape: r.shape,
    scope_label: r.scope_label, scope_includes: r.scope_includes, scope_excludes: r.scope_excludes,
    // Not zero. An advisory relationship with no amount recorded has not been
    // declared free, and an equity engagement has no cents by its nature.
    amount_cents: r.amount_cents ?? null,
    proposed_at: r.proposed_at, started_at: r.started_at,
    term_ends_at: r.term_ends_at, ended_at: r.ended_at,
    cycles: Number(r.cycles || 0),
    // NULL until the row is signed. The fixture's placeholder 'Active' on an
    // unsent draft is the thing this deliberately does not reproduce.
    outcome: r.outcome ?? null,
    renewal_note: r.renewal_note,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** YYYY-MM-DD, or null. A malformed date is dropped rather than stored. */
function engagementDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) ? s : null;
}

/**
 * A client link — an account this advisor ALREADY HAS A RELATIONSHIP WITH, or
 * null.
 *
 * THIS USED TO ACCEPT ANY EXISTING `users.id`, and that was wrong in both
 * directions at once. An advisor has no way to learn another account's numeric
 * id, so the column was unusable by a human; and an advisor who guessed one
 * could attach a stranger's account to their own contract, then open a message
 * thread with them through Delivery's nudge. A write that is simultaneously
 * unreachable and over-trusting is not a link, it is a hole.
 *
 * THE RELATIONSHIP IS THE PERMISSION, and it is one of two facts the product
 * already records: the account has BOOKED this advisor, or it has OPENED A
 * RECORD to them (an active grant from migration 218). Either means the two
 * people have met in this product; neither can be manufactured by the advisor
 * alone. `DocumentShares` on the founder side settled this shape first —
 * "offering an address the API would refuse is how a control teaches the wrong
 * model" — so the picker on Engagements offers exactly this set.
 *
 * AN UNRELATED ACCOUNT RESOLVES TO NULL rather than erroring, which is the
 * behaviour a dangling id already had: the engagement keeps its client NAME and
 * simply stays unsendable. One rule, one outcome, and no new error path on the
 * two routes that call this.
 *
 * `m.user_id` IS NULLABLE, so the grant half is skipped rather than compared
 * against null — an advisor record with no account behind it has no grants by
 * definition, and `advisor_user_id = NULL` would match nothing while reading as
 * though it might.
 */
async function engagementClientUser(env: Env, m: AdvisorRow, v: unknown): Promise<number | null> {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  const u = await env.DB.prepare(
    `SELECT u.id FROM users u
      WHERE u.id = ?
        AND (EXISTS (SELECT 1 FROM advisor_bookings b
                      WHERE b.advisor_id = ? AND b.founder_user_id = u.id)
          OR EXISTS (SELECT 1 FROM advisor_client_grants g
                      WHERE g.advisor_user_id = ? AND g.granted_by_user_id = u.id
                        AND g.status = 'active'
                        AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))))`
  ).bind(n, m.id, m.user_id ?? -1).first<{ id: number }>();
  return u ? Number(u.id) : null;
}

advisors.get('/me/engagements', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    // #4714 (D4714): the totals are over EVERY engagement, and the list is a
    // page of them (`?limit=&offset=`, `page.next_offset`). The old LIMIT 400
    // hid row 401 and computed the totals over the 400 it kept.
    const w = pageWindow(c.req.query(), PRACTICE_PAGE);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisor_engagements WHERE advisor_id = ?
        ORDER BY updated_at DESC, id DESC`
    ).bind(m.id).all<EngagementRow>();
    const items = (rows.results || []).map(engagementDto);
    const shown = items.slice(w.offset, w.offset + w.limit);

    // THE RATE IS COMPUTED HERE RATHER THAN ON THE PAGE, because its
    // denominator is the whole argument. `decided` counts renewals that went
    // either way and nothing else: a signed contract still running has made no
    // decision, and an unsent draft never had one to make.
    const renewed = items.filter((e) => e.outcome === 'renewed').length;
    const ended = items.filter((e) => e.outcome === 'ended').length;
    const decided = renewed + ended;
    return c.json({
      items: shown,
      page: pageFacts(w, items.length, shown.length),
      totals: {
        // Lanes, not outcomes — the canvas is explicit that a draft never sent
        // and a proposal awaiting an answer are not engagements.
        active: items.filter((e) => SIGNED_LANES.has(e.lane)).length,
        renewal_due: items.filter((e) => e.lane === 'renewal_due').length,
        ended_lane: items.filter((e) => e.lane === 'ended').length,
        renewed, ended, decided,
        // Null, never 0%. A practice that has not yet reached a renewal has
        // not failed to renew, and 0% would say it had.
        renewal_rate: decided > 0 ? Math.round((renewed / decided) * 100) : null,
        // What the Active tile's breakdown note ("2 retainers, 1 sprint…")
        // reads from.
        by_shape: ENGAGEMENT_SHAPES.reduce((acc, s) => {
          acc[s] = items.filter((e) => SIGNED_LANES.has(e.lane) && e.shape === s).length;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/engagements', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const clientName = String(body.client_name || '').trim().slice(0, 200);
    // The one required field. A contract board row with no client is a card
    // nobody can act on, and the column is NOT NULL for the same reason.
    if (!clientName) return c.json({ detail: 'An engagement needs a client name' }, 400);
    const shape = String(body.shape || 'retainer').trim();
    if (!ENGAGEMENT_SHAPES.includes(shape)) {
      return c.json({ detail: `shape must be one of: ${ENGAGEMENT_SHAPES.join(', ')}` }, 400);
    }
    // A row is BORN DRAFTING. Signing is a transition with its own stamps and
    // its own cycle, so letting a caller open one straight into 'signed' would
    // mean two code paths for the same event and one of them would drift.
    const now = nowIso();
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_engagements
         (uid, advisor_id, founder_user_id, client_name, lane, shape,
          scope_label, scope_includes, scope_excludes, amount_cents,
          term_ends_at, cycles, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'drafting', ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(
      uid, m.id, await engagementClientUser(c.env, m, body.founder_user_id), clientName, shape,
      trimOrNull(body.scope_label, 200), trimOrNull(body.scope_includes, 2000),
      trimOrNull(body.scope_excludes, 2000), parsePriceCents(body.amount_cents),
      engagementDate(body.term_ends_at), now, now,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<EngagementRow>();
    return c.json(engagementDto(fresh!), 201);
  } catch (e) { return mapError(c, e); }
});

// PATCH — the descriptive columns only. `lane`, `cycles` and `outcome` are
// absent by design; see the block comment above.
advisors.patch('/me/engagements/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const shape = body.shape == null ? row.shape : String(body.shape).trim();
    if (!ENGAGEMENT_SHAPES.includes(shape)) {
      return c.json({ detail: `shape must be one of: ${ENGAGEMENT_SHAPES.join(', ')}` }, 400);
    }
    // D4695-style stale-view refusal: the caller may name the version it read.
    if (body.expected_updated_at !== undefined && String(body.expected_updated_at) !== row.updated_at) {
      return c.json({ detail: 'this engagement changed since you opened it — reload it', code: 'engagement_changed' }, 409);
    }
    const next = {
      // Merge, not replace: the board edits one field at a time, and an empty
      // client name would blank a card rather than rename it.
      client_name: String(body.client_name ?? '').trim().slice(0, 200) || row.client_name,
      shape,
      scope_label: 'scope_label' in body ? trimOrNull(body.scope_label, 200) : row.scope_label,
      scope_includes: 'scope_includes' in body ? trimOrNull(body.scope_includes, 2000) : row.scope_includes,
      scope_excludes: 'scope_excludes' in body ? trimOrNull(body.scope_excludes, 2000) : row.scope_excludes,
      amount_cents: 'amount_cents' in body ? parsePriceCents(body.amount_cents) : row.amount_cents,
      term_ends_at: 'term_ends_at' in body ? engagementDate(body.term_ends_at) : row.term_ends_at,
    };
    const founderUserId = 'founder_user_id' in body
      ? await engagementClientUser(c.env, m, body.founder_user_id) : row.founder_user_id;
    // #4715 (D4715): once signed, the terms change only as a recorded correction.
    const changes = termChanges(row, next);
    const signed = !!row.started_at;
    const reason = trimOrNull(body.correction_reason, 500);
    if (signed && changes.length > 0 && !reason) {
      return c.json({
        detail: 'These terms were signed. Say why they are being corrected; the correction is kept in the engagement’s history.',
        code: 'correction_reason_required', fields: changes.map((x) => x.field),
      }, 409);
    }
    const now = nowIso();
    const [wrote] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE advisor_engagements
            SET client_name = ?, founder_user_id = ?, shape = ?, scope_label = ?,
                scope_includes = ?, scope_excludes = ?, amount_cents = ?,
                term_ends_at = ?, updated_at = ?
          WHERE id = ? AND updated_at = ?`
      ).bind(
        next.client_name, founderUserId, next.shape, next.scope_label,
        next.scope_includes, next.scope_excludes, next.amount_cents, next.term_ends_at,
        now, row.id, row.updated_at,
      ),
      // The correction lands only if the update above did (its `updated_at` is this request's), so the history
      // and the terms cannot disagree.
      c.env.DB.prepare(
        `INSERT INTO advisor_engagement_corrections
           (uid, engagement_id, lane, reason, changes_json, corrected_by_user_id, created_at)
         SELECT ?, id, lane, ?, ?, ?, ? FROM advisor_engagements
          WHERE id = ? AND ? = 1 AND updated_at = ?`
      ).bind(newUid(), reason ?? '', JSON.stringify(changes), user.id, now,
        row.id, signed && changes.length > 0 ? 1 : 0, now),
    ]);
    if (Number((wrote as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({ detail: 'this engagement changed while you were looking at it — reload it', code: 'engagement_changed' }, 409);
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind(row.id).first<EngagementRow>();
    return c.json(engagementDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/engagements/:id/advance — move a card between lanes.
 *
 * A CONTROL RATHER THAN A DRAG, and the divergence is deliberate. The canvas
 * labels the board "By contract state · drag to advance"; a per-card control
 * is keyboard-reachable without a drag-and-drop implementation to make
 * accessible, and the state change it writes is identical.
 */
advisors.post('/me/engagements/:id/advance', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const lane = String(body.lane || '').trim();
    if (!ENGAGEMENT_LANES.includes(lane)) {
      return c.json({ detail: `lane must be one of: ${ENGAGEMENT_LANES.join(', ')}` }, 400);
    }
    // D4695: a stale view is refused. `expected_lane` is the lane the caller read; when it is sent and the row has
    // moved, nothing is written. Without it the write is still conditional on the lane read in this request.
    if (body.expected_lane !== undefined && String(body.expected_lane) !== row.lane) {
      return c.json({ detail: 'this engagement moved since you opened it — reload it', code: 'lane_changed', current_lane: row.lane }, 409);
    }
    // The same command twice is one change: a retry after a timeout finds the lane already there.
    if (row.lane === lane) return c.json(engagementDto(row));
    // Ended is terminal, the same rule `portfolio_support.ts` applies to a
    // delivered promise: re-opening one would let a recorded outcome be
    // quietly un-recorded, and the renewal rate is exactly what that would
    // falsify.
    if (row.lane === 'ended') {
      return c.json({ detail: 'an engagement that has ended cannot change lane' }, 409);
    }
    if (lane === 'ended' && SIGNED_LANES.has(row.lane)) {
      return c.json({
        detail: 'a signed engagement ends through a renewal decision — POST /me/engagements/:id/renewal with decision "ended"',
      }, 409);
    }
    if (!(ENGAGEMENT_GRAPH[row.lane] ?? []).includes(lane)) {
      return c.json({
        detail: `a ${row.lane.replace('_', ' ')} engagement cannot move to ${lane.replace('_', ' ')}`,
        code: 'lane_not_allowed', allowed: ENGAGEMENT_GRAPH[row.lane] ?? [],
      }, 409);
    }

    const now = nowIso();
    const day = now.slice(0, 10);
    const signing = SIGNED_LANES.has(lane) && !SIGNED_LANES.has(row.lane);
    // THE UPDATE NAMES THE LANE IT READ, and its row count is read. A signing also appends its event in the same
    // batch, guarded by the state the UPDATE leaves, so the history and the lane cannot disagree.
    const [wrote] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE advisor_engagements
            SET lane = ?, proposed_at = ?, started_at = ?, ended_at = ?,
                cycles = ?, outcome = ?, updated_at = ?
          WHERE id = ? AND lane = ?`
      ).bind(
        lane,
        lane === 'proposed' ? (engagementDate(body.proposed_at) || day) : row.proposed_at,
        signing ? (row.started_at || engagementDate(body.started_at) || day) : row.started_at,
        // Only an UNSIGNED row can reach 'ended' here, so this stamps an abandoned draft and nothing else.
        lane === 'ended' ? (row.ended_at || day) : row.ended_at,
        // The first term begins at signing. `max` rather than `+ 1` so a lane
        // correction (renewal_due → signed and back) cannot inflate the count.
        signing ? Math.max(Number(row.cycles || 0), 1) : row.cycles,
        // Signing is what gives a row an outcome to have. Ending an unsigned one leaves it NULL, which keeps an
        // abandoned draft out of the renewal rate's denominator. A row that somehow holds an outcome is not left
        // 'active' by ending: it reads 'ended'.
        signing ? (row.outcome || 'active') : (lane === 'ended' && row.outcome ? 'ended' : row.outcome),
        now, row.id, row.lane,
      ),
      c.env.DB.prepare(
        `INSERT INTO advisor_engagement_events
           (uid, engagement_id, kind, from_lane, to_lane, cycles_before, cycles_after, created_at)
         SELECT ?, id, 'signed', ?, lane, 0, cycles, ? FROM advisor_engagements
          WHERE id = ? AND ? = 1 AND lane = ? AND updated_at = ?
         ON CONFLICT DO NOTHING`
      ).bind(newUid(), row.lane, now, row.id, signing ? 1 : 0, lane, now),
    ]);
    if (Number((wrote as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({ detail: 'this engagement changed while you were looking at it — reload it', code: 'lane_changed' }, 409);
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind(row.id).first<EngagementRow>();
    return c.json(engagementDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/engagements/:id/renewal — record the decision the practice is
 * judged on.
 *
 * This is the only writer of `outcome` after signing and the only thing that
 * moves `cycles` past 1, which is what makes the renewal rate mean something.
 * It refuses an unsigned row rather than inventing a decision for it.
 */
advisors.post('/me/engagements/:id/renewal', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const decision = String(body.decision || '').trim();
    if (decision !== 'renewed' && decision !== 'ended') {
      return c.json({ detail: 'decision must be "renewed" or "ended"' }, 400);
    }
    // D4695: A DECISION IS ABOUT ONE TERM. `expected_cycles` is the cycle count the caller read, i.e. the term being
    // decided. It is required, because without it a retry after a timeout and a second renewal look the same.
    const expected = body.expected_cycles;
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) {
      return c.json({ detail: 'expected_cycles is required: the number of cycles you read, a whole number from 1', code: 'expected_cycles_required' }, 400);
    }
    // A term already decided: the same decision again is a replay and returns the engagement as it stands; a different
    // decision is a conflict. Neither writes.
    const decidedOf = async () => c.env.DB.prepare(
      `SELECT kind FROM advisor_engagement_events WHERE engagement_id = ? AND cycles_before = ? AND kind IN ('renewed', 'ended')`
    ).bind(row.id, expected).first<{ kind: string }>();
    const replayOrConflict = async () => {
      const prior = await decidedOf();
      if (!prior) return null;
      if (prior.kind === decision) {
        const cur = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?').bind(row.id).first<EngagementRow>();
        return c.json({ ...engagementDto(cur!), replayed: true });
      }
      return c.json({
        detail: prior.kind === 'ended' ? 'this engagement has already ended' : 'this term was already renewed',
        code: 'term_decided', decided: prior.kind,
      }, 409);
    };
    const prior = await replayOrConflict();
    if (prior) return prior;
    if (!SIGNED_LANES.has(row.lane)) {
      return c.json({
        detail: row.lane === 'ended'
          ? 'this engagement has already ended'
          : 'only a signed engagement has a renewal to decide',
      }, 409);
    }
    if (Number(row.cycles || 0) !== expected) {
      return c.json({ detail: 'this engagement moved on since you opened it — reload it', code: 'cycles_changed', current_cycles: Number(row.cycles || 0) }, 409);
    }

    const now = nowIso();
    const day = now.slice(0, 10);
    const renewed = decision === 'renewed';
    const cyclesAfter = renewed ? expected + 1 : expected;
    const note = 'note' in body ? trimOrNull(body.note, 2000) : row.renewal_note;
    // THE UPDATE NAMES THE TERM AND THE LANES IT MAY ACT ON, and the event is written in the same batch, guarded by
    // the state the UPDATE leaves. The event's unique index is the second line: a concurrent duplicate meets it.
    const [wrote] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE advisor_engagements
            SET lane = ?, cycles = ?, outcome = ?, renewal_note = ?,
                term_ends_at = ?, ended_at = ?, updated_at = ?
          WHERE id = ? AND cycles = ? AND lane IN ('signed', 'renewal_due')`
      ).bind(
        renewed ? 'signed' : 'ended',
        // A renewal starts a term, so it adds one. Ending does not: the term that just ran was already counted.
        cyclesAfter,
        decision,
        // One note column, because the artboard draws one — migration 238's header records why there is no separate
        // end_reason beside it.
        note,
        renewed ? engagementDate(body.term_ends_at) : row.term_ends_at,
        renewed ? row.ended_at : (row.ended_at || day),
        now, row.id, expected,
      ),
      c.env.DB.prepare(
        `INSERT INTO advisor_engagement_events
           (uid, engagement_id, kind, from_lane, to_lane, cycles_before, cycles_after, note, created_at)
         SELECT ?, id, ?, ?, lane, ?, cycles, ?, ? FROM advisor_engagements
          WHERE id = ? AND cycles = ? AND outcome = ? AND updated_at = ?
         ON CONFLICT DO NOTHING`
      ).bind(newUid(), decision, row.lane, expected, note, now, row.id, cyclesAfter, decision, now),
    ]);
    if (Number((wrote as any)?.meta?.changes ?? 0) !== 1) {
      // Someone decided this term between the read and the write. The same decision is a replay.
      return (await replayOrConflict())
        ?? c.json({ detail: 'this engagement changed while you were looking at it — reload it', code: 'cycles_changed' }, 409);
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind(row.id).first<EngagementRow>();
    return c.json(engagementDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// GET /me/engagements/:id/events — D4695: the renewal history, oldest first. Engagements decided before the events
// existed have none; that is "not recorded", not "no decisions".
advisors.get('/me/engagements/:id/events', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const rows = await c.env.DB.prepare(
      `SELECT uid, kind, from_lane, to_lane, cycles_before, cycles_after, note, created_at
         FROM advisor_engagement_events WHERE engagement_id = ? ORDER BY id ASC LIMIT 200`
    ).bind(row.id).all();
    // #4715 (D4715): a correction to signed terms is part of the same history, with what changed.
    const fixes = await c.env.DB.prepare(
      `SELECT uid, lane, reason, changes_json, created_at
         FROM advisor_engagement_corrections WHERE engagement_id = ? ORDER BY id ASC LIMIT 200`
    ).bind(row.id).all<any>();
    const corrections = (fixes.results || []).map((r: any) => ({
      uid: r.uid, kind: 'corrected', from_lane: r.lane, to_lane: r.lane, note: r.reason,
      changes: (() => { try { return JSON.parse(r.changes_json); } catch { return []; } })(),
      created_at: r.created_at,
    }));
    const items = [...(rows.results || []), ...corrections]
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

export default advisors;

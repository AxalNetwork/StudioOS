/**
 * Investment Decision / IC record (Commit stage).
 *
 * One per-deal object that unifies the IC memo, proposed terms, member votes,
 * the final decision, and the post-hoc outcome — data that today is smeared
 * across Pipeline votes, the Scoring deal-memo, and Watchlist decision fields.
 *
 * Mounted at /api/ic. Readers/writers are admin/partner/investor. Investor
 * callers are professional-tier gated in index.ts (INVESTOR_PRO_PREFIXES),
 * matching Deal Flow / Pipeline.
 *
 * THE LICENCE IS NOT THE SCOPE, and for a while this file behaved as though it
 * were. `canUseIc` says whether an account may use the Commit stage at all;
 * until migration 219 nothing said WHOSE decisions it may use it on, so every
 * read here ran unfiltered — `GET /` was `WHERE 1=1`, `GET /:uid` matched on
 * the uid alone, and `POST /:uid/vote` let an outsider vote into another
 * committee's tally. `icDecisionScope` is now on every query that touches
 * `ic_decisions`, read and write, and it is the ONLY thing standing between one
 * firm's memo and another's.
 *
 * A ROW OUTSIDE THE SCOPE IS 404, NEVER 403 — because the scope lives in the
 * WHERE clause rather than in a branch after the load, the two answers are
 * literally the same code path and there is nothing to forget. That matches
 * `requireOwnEngagement` and `requireOwnQuote`, whose own comment says it: a
 * 403 confirms to a non-owner that the row exists.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { icDecisionScope } from '../services/tenancyScope';
import { activeCompanyFor } from '../middleware/activeCompany';
import { isAdmin, isInvestor, isPartner, mapError, nowIso, newUid, jload } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type DecisionRow = {
  id: number; uid: string; project_id: number | null; deal_id: number | null;
  title: string; memo: string | null; terms_json: string | null;
  status: string; decision: string | null; outcome: string | null;
  created_by: number | null; decided_at: string | null;
  dd_case_id: number | null;
  created_at: string; updated_at: string;
};

export type VoteRow = {
  vote: string; rationale: string | null; user_id: number;
  created_at: string; user_name: string | null;
};

function canUseIc(user: User): boolean {
  return isAdmin(user) || isInvestor(user) || isPartner(user);
}

/**
 * The decision at `uid`, if this caller may see it at all. `null` otherwise,
 * and every caller turns that into the same 404 it already returned for a uid
 * that does not exist.
 *
 * ONE LOADER FOR ALL THREE SINGLE-ROW ENDPOINTS. Detail, update and vote each
 * used to run their own `SELECT * FROM ic_decisions WHERE uid = ?`; three
 * copies of a query is three chances for the next one to be written without the
 * predicate, which is exactly how the vote endpoint came to be the most open of
 * the five. There is now one place to get this right and one place to read it.
 *
 * The scope fragment reaches the query TEXT through `where`, the interpolation
 * this file already carries in `scripts/sql-prepare-baseline.json`. It is
 * literal SQL from `services/tenancyScope.ts` with every value bound as `?` —
 * nothing from the request is in it.
 */
async function loadDecision(env: Env, user: User, uid: string): Promise<DecisionRow | null> {
  const scope = icDecisionScope(user);
  const where = `d.uid = ? AND ${scope.sql}`;
  return env.DB.prepare(`SELECT d.* FROM ic_decisions d WHERE ${where}`)
    .bind(uid, ...scope.binds).first<DecisionRow>();
}

/**
 * The newest decisions this caller may see, with their votes — the ONE scoped
 * list read of `ic_decisions`, exported so the second caller does not write a
 * second copy of the predicate.
 *
 * `routes/research.ts` needs exactly this for the `deals/commit` AI band: the
 * decision to draft an IC memo from, and the votes to attribute reasons to. It
 * could have run its own `SELECT ... WHERE ${scope.sql}`, and that is precisely
 * what this file's header warns against — "three copies of a query is three
 * chances for the next one to be written without the predicate". A draft
 * surface reading `ic_decisions` unscoped would hand another committee's
 * deliberations to a model on this caller's behalf: the hole migration 219
 * closed, reopened through a side door.
 *
 * It also keeps the `${where}` interpolation in the one file whose entry
 * `scripts/sql-prepare-baseline.json` already carries. That is a consequence of
 * the design rather than the reason for it, but the gate and the rule agree
 * here, which is the point of the gate.
 */
export async function scopedDecisions(
  env: Env, user: User, limit = 100,
): Promise<Array<DecisionRow & { votes: VoteRow[] }>> {
  const scope = icDecisionScope(user);
  const where = scope.sql;
  // `limit` is a clamped integer from this module's own callers, never from a
  // request, and it is bound rather than interpolated regardless.
  const rows = await env.DB.prepare(
    `SELECT d.* FROM ic_decisions d WHERE ${where} ORDER BY d.updated_at DESC LIMIT ?`
  ).bind(...scope.binds, Math.max(1, Math.min(500, Math.trunc(limit)))).all<DecisionRow>();
  const out: Array<DecisionRow & { votes: VoteRow[] }> = [];
  for (const d of ((rows.results || []) as DecisionRow[])) {
    const votes = await env.DB.prepare(
      `SELECT v.vote, v.rationale, v.user_id, v.created_at, u.name AS user_name
         FROM ic_votes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.ic_decision_id = ? ORDER BY v.created_at ASC`
    ).bind(d.id).all<VoteRow>();
    out.push({ ...d, votes: (votes.results || []) as VoteRow[] });
  }
  return out;
}

async function tally(env: Env, decisionId: number): Promise<{ yes: number; no: number; abstain: number }> {
  const rows = await env.DB.prepare(
    'SELECT vote, COUNT(*) AS n FROM ic_votes WHERE ic_decision_id = ? GROUP BY vote'
  ).bind(decisionId).all<{ vote: string; n: number }>();
  const out = { yes: 0, no: 0, abstain: 0 };
  for (const row of (rows.results || [])) {
    if (row.vote in out) (out as any)[row.vote] = Number(row.n) || 0;
  }
  return out;
}

async function dto(env: Env, d: DecisionRow, opts: { votes?: boolean } = {}): Promise<any> {
  const proj = d.project_id
    ? await env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE id = ? AND deleted_at IS NULL').bind(d.project_id).first<any>()
    : null;
  const base: any = {
    id: d.id, uid: d.uid, project_id: d.project_id, deal_id: d.deal_id,
    project: proj || null,
    title: d.title, memo: d.memo, terms: jload(d.terms_json, null),
    status: d.status, decision: d.decision, outcome: d.outcome,
    created_by: d.created_by, decided_at: d.decided_at,
    dd_case_id: d.dd_case_id ?? null,
    created_at: d.created_at, updated_at: d.updated_at,
    tally: await tally(env, d.id),
  };
  if (d.dd_case_id != null) {
    base.dd_case = await env.DB.prepare('SELECT uid, subject_label, status FROM dd_cases WHERE id = ?')
      .bind(d.dd_case_id).first<any>().catch(() => null);
  }
  if (opts.votes) {
    const votes = await env.DB.prepare(
      `SELECT v.vote, v.rationale, v.user_id, v.created_at, u.name AS user_name
         FROM ic_votes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.ic_decision_id = ? ORDER BY v.created_at ASC`
    ).bind(d.id).all<any>();
    base.votes = votes.results || [];
  }
  return base;
}

// ---------------------------------------------------------------------------
// GET /api/ic  — list decisions (filter by status / project_id)
// ---------------------------------------------------------------------------
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const status = c.req.query('status');
    const projectId = c.req.query('project_id');
    // The scope OPENS the clause rather than being appended after the reader's
    // filters. Same rows either way; the ordering is so that the one condition
    // that must never be absent is the first thing in the string, not the last
    // of a run of conditional `+=`s where the next filter could be added below
    // it and the predicate quietly left behind. `1=1` is gone with it — a base
    // that matches everything is only ever one deleted line away from being the
    // whole clause, which is what this endpoint shipped as.
    const scope = icDecisionScope(user);
    const params: any[] = [...scope.binds];
    let where = scope.sql;
    if (status) { where += ' AND d.status = ?'; params.push(status); }
    if (projectId) { where += ' AND d.project_id = ?'; params.push(Number(projectId)); }
    const rows = await c.env.DB.prepare(
      `SELECT d.* FROM ic_decisions d WHERE ${where} ORDER BY d.updated_at DESC LIMIT 500`
    ).bind(...params).all<DecisionRow>();
    const items: any[] = [];
    for (const d of (rows.results || []) as DecisionRow[]) items.push(await dto(c.env, d));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// POST /api/ic  — create a decision (optionally seed memo from scoring deal-memo)
r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const title = body.title ? String(body.title).slice(0, 300) : null;
    if (!title) return c.json({ detail: 'title required' }, 400);
    const projectId = body.project_id != null ? Number(body.project_id) : null;
    if (projectId != null && Number.isFinite(projectId)) {
      const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number }>();
      if (!proj) return c.json({ detail: 'Project not found' }, 404);
    }
    // `deal_id` was the one foreign key on this row that nothing checked, so a
    // create could point a decision at any integer — and that id is copied
    // straight into `decision_journal_entries.deal_id` by the vote handler
    // below. Checked the same way `project_id` is, one line above: existence
    // only. Which deals a caller may see is the Deal Flow surface's question
    // and `deals` carries no company column by design (migration 194 says why);
    // what this closes is a decision that references a row that is not there.
    const dealId = body.deal_id != null ? Number(body.deal_id) : null;
    if (dealId != null && Number.isFinite(dealId)) {
      const deal = await c.env.DB.prepare('SELECT id FROM deals WHERE id = ?').bind(dealId).first<{ id: number }>();
      if (!deal) return c.json({ detail: 'Deal not found' }, 404);
    }
    let memo = body.memo ? String(body.memo).slice(0, 20000) : null;
    // Optional: seed the memo from the latest stored scoring deal-memo. Main
    // stores deal memos as structured columns in `deal_memos` (not a single
    // free-text blob), so compose a readable memo from the narrative fields.
    if (!memo && (body.from_scoring || c.req.query('from_scoring')) && projectId != null) {
      const dm = await c.env.DB.prepare(
        "SELECT problem, solution, why_now, key_insight, risks FROM deal_memos WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
      ).bind(projectId).first<any>().catch(() => null);
      if (dm) {
        const parts: string[] = [];
        if (dm.problem) parts.push(`Problem: ${dm.problem}`);
        if (dm.solution) parts.push(`Solution: ${dm.solution}`);
        if (dm.why_now) parts.push(`Why now: ${dm.why_now}`);
        if (dm.key_insight) parts.push(`Key insight: ${dm.key_insight}`);
        if (dm.risks) parts.push(`Risks: ${dm.risks}`);
        if (parts.length) memo = parts.join('\n\n').slice(0, 20000);
      }
    }
    const termsJson = body.terms != null ? JSON.stringify(body.terms) : null;
    // Task #83 — an IC decision may carry the Due-Diligence case it was formed
    // from, so the Diligence → Commit hand-off is a real link, not a re-search.
    let ddCaseId: number | null = null;
    if (body.dd_case_id != null && Number.isFinite(Number(body.dd_case_id))) {
      const cs = await c.env.DB.prepare('SELECT id FROM dd_cases WHERE id = ?').bind(Number(body.dd_case_id)).first<{ id: number }>();
      if (cs) ddCaseId = Number(cs.id);
    }
    // The firm this decision belongs to (migration 219), taken from the
    // creator's VERIFIED active company — `activeCompanyFor` checks the header
    // against `user_company_links` and returns null for any claim that does not
    // hold, so a forged `X-Company-Id` files the row under nobody rather than
    // under someone else. Null is a real state: the creator has no company, or
    // has not chosen one, and `icDecisionScope` then shows the row to them and
    // to whoever votes on it — never to a firm at large.
    const companyId = await activeCompanyFor(c, user);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO ic_decisions (uid, project_id, deal_id, dd_case_id, title, memo, terms_json, status, created_by, company_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    ).bind(uid, projectId, dealId, ddCaseId, title, memo, termsJson, user.id, companyId, nowIso(), nowIso()).run();
    const d = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<DecisionRow>();
    return c.json(await dto(c.env, d!, { votes: true }), 201);
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// GET /api/ic/commit-room — canvas ID3, the desk behind `/deals/commit`.
//
// REGISTERED BEFORE `/:uid` ON PURPOSE. Hono matches in registration order, so
// a literal that lands after a parameter is unreachable — `commit-room` would
// be read as a uid and 404. Same ordering care `/deals/screening` needs ahead
// of `/deals/:id`.
//
// AND IT LIVES IN THIS FILE RATHER THAN `deals.ts` FOR ONE REASON: the scope.
// `icDecisionScope` is what stands between one firm's memo and another's, and
// this file's own header says three copies of a query is three chances for the
// next one to be written without the predicate. A commit-room read in a file
// that does not import the scope helper is exactly how that hole gets reopened.
//
// THE OPS ROW UNDER THIS ARTBOARD CARRIED A FALSE REASON, the same defect ID2
// found one zone earlier. `investorZoneActions` marked `Close vote` unbuilt
// because "no vote is opened here, so none can be closed". A vote is opened
// and closed, both stored and both served:
//
//   `POST /api/ic/:uid/vote` moves a decision from `draft` to `voting` on the
//   first vote cast. `PUT /api/ic/:uid` with a `decision` forces `decided`
//   and stamps `decided_at`.
//
// What is missing is a SCREEN, which is a much narrower claim and the one the
// table now makes.
//
// WHAT THE ARTBOARD DRAWS THAT NO STORE HOLDS, reported rather than invented:
// recusal, conditions, quorum and minutes. Each is returned as an explicit
// unavailable-with-reason rather than omitted, so the page states the gap
// instead of rendering a plausible number in its place.
//
// RECUSAL IS THE ONE THAT MUST NOT BE FAKED. `ic_votes.vote` is
// `yes | no | abstain`, and an abstention is a vote CAST — the voter was
// counted and declined. A recusal is a declared conflict that removes the
// voter from the DENOMINATOR. The artboard's own note makes that distinction
// load-bearing ("excluded from the denominator — cast of eligible, not of
// PARTNERS.length"), so mapping `abstain` onto it would put a false statement
// about a conflict of interest on a fund's screen.
// ---------------------------------------------------------------------------
r.get('/commit-room', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);

    // THE SAME LIST READ `research.ts` USES, not a second copy of it. That is
    // the whole reason `scopedDecisions` is exported rather than inlined here.
    const list = await scopedDecisions(c.env, user, 100);

    const byStatus: Record<string, number> = { draft: 0, voting: 0, decided: 0 };
    const summaries: any[] = [];
    let rationalesRecorded = 0;
    let votesTotal = 0;

    for (const d of list) {
      if (d.status in byStatus) byStatus[d.status] += 1;
      const cast = d.votes;
      votesTotal += cast.length;
      // A rationale is NOT NULL-able in the column and not required by the
      // vote endpoint, so "how many carry one" is a real, countable fact —
      // and it is the fact the artboard's `Rationale required` claim needs
      // checking against. Blank-but-present counts as absent: a rationale of
      // spaces is not a reason.
      rationalesRecorded += cast.filter((v) => String(v.rationale || '').trim().length > 0).length;
      const proj = d.project_id
        ? await c.env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL')
          .bind(d.project_id).first<{ name: string }>().catch(() => null)
        : null;
      summaries.push({
        uid: d.uid,
        title: d.title,
        project_name: proj?.name ?? null,
        deal_id: d.deal_id ?? null,
        status: d.status,
        decision: d.decision ?? null,
        decided_at: d.decided_at ?? null,
        votes_cast: cast.length,
        rationales: cast.filter((v) => String(v.rationale || '').trim().length > 0).length,
        tally: await tally(c.env, d.id),
        votes: cast.map((v) => ({
          user_id: v.user_id,
          user_name: v.user_name ?? null,
          vote: v.vote,
          rationale: String(v.rationale || '').trim() || null,
          created_at: v.created_at,
        })),
      });
    }

    // The newest decision in scope is what the artboard's first chip shows.
    // "This deal" on a page that is not scoped to one deal means the decision
    // most recently touched, and the page says so rather than implying the
    // reader picked it.
    const current = summaries[0] ?? null;

    // WHO WAS IN THE ROOM, WHICH IS NOT WHO MAY VOTE. `ic_meeting_attendees`
    // is a real invited roster with an RSVP, joined to a deal through
    // `ic_meetings.deal_id`. It is the closest thing the schema has to the
    // artboard's "Eligible voters", and it is NOT that: an invitation is not
    // a voting entitlement, and labelling it as one would invent a governance
    // rule the product does not enforce.
    let room: any = {
      available: false,
      reason: 'No IC meeting is linked to this decision’s deal, so no attendee roster can be read.',
    };
    if (current?.deal_id != null) {
      const meeting = await c.env.DB.prepare(
        `SELECT id, title, start_at, status FROM ic_meetings
          WHERE deal_id = ? ORDER BY start_at DESC LIMIT 1`
      ).bind(current.deal_id).first<any>().catch(() => null);
      if (meeting) {
        const att = await c.env.DB.prepare(
          'SELECT rsvp, COUNT(*) AS n FROM ic_meeting_attendees WHERE meeting_id = ? GROUP BY rsvp'
        ).bind(meeting.id).all<{ rsvp: string; n: number }>().catch(() => null);
        const byRsvp: Record<string, number> = {};
        let invited = 0;
        for (const a of ((att?.results || []) as any[])) {
          byRsvp[String(a.rsvp)] = Number(a.n) || 0;
          invited += Number(a.n) || 0;
        }
        room = {
          available: true,
          invited,
          by_rsvp: byRsvp,
          meeting_title: meeting.title ?? null,
          starts_at: meeting.start_at ?? null,
          status: meeting.status ?? null,
          note: 'An invitation to the meeting, not an entitlement to vote. No voting roster is stored.',
        };
      }
    }

    return c.json({
      decisions: {
        available: true,
        total: list.length,
        by_status: byStatus,
        rows: summaries,
      },
      current,
      // The artboard says "Rationale required". The store does not require it,
      // and the vote endpoint accepts a vote without one. Both facts are
      // reported so the page can say which it is rather than repeating the
      // artboard's claim as though the column enforced it.
      rationale: {
        recorded: rationalesRecorded,
        total: votesTotal,
        enforced: false,
        note: 'ic_votes.rationale is nullable and POST /api/ic/:uid/vote accepts a vote without one. '
          + 'The count is what was actually written, not what a rule guarantees.',
      },
      room,
      recusal: {
        available: false,
        reason: 'ic_votes.vote is yes | no | abstain. An abstention is a vote cast; a recusal is a declared '
          + 'conflict that leaves the denominator. Nothing stores the second, so no vote is shown as recused '
          + 'and no denominator is reduced.',
      },
      conditions: {
        available: false,
        reason: 'No condition is stored. ic_decisions carries a free-text memo and a terms blob, and neither '
          + 'is a condition another stage could block a wire on.',
      },
      minutes: {
        available: false,
        reason: 'No minutes are stored. ic_meetings carries an agenda, which is written before the room rather '
          + 'than after it, and nothing records what the room concluded beyond the votes themselves.',
      },
      quorum: {
        available: false,
        reason: 'No quorum is stored. The IC charter template states one in prose, but that is a document body — '
          + 'no number the product can check a tally against.',
      },
      // The correction this artboard is really about, carried in the payload so
      // the page states it from the record rather than from a comment.
      close_vote: {
        served: true,
        screen: false,
        note: 'A vote opens when the first vote is cast (POST /api/ic/:uid/vote moves draft → voting) and closes '
          + 'when a decision is set (PUT /api/ic/:uid forces decided and stamps decided_at). Both are served; '
          + 'no screen offers the form yet.',
      },
    });
  } catch (e) { return mapError(c, e); }
});

// GET /api/ic/:uid — detail with votes
r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await loadDecision(c.env, user, c.req.param('uid'));
    if (!d) return c.json({ detail: 'Not found' }, 404);
    return c.json(await dto(c.env, d, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/ic/:uid — update memo/terms/status/decision/outcome (creator or admin)
r.put('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await loadDecision(c.env, user, c.req.param('uid'));
    if (!d) return c.json({ detail: 'Not found' }, 404);
    // 403 here and 404 above, deliberately. The load has already established
    // the caller is entitled to SEE this decision — they wrote it, they are on
    // its committee, or it is their firm's — so "you may not edit this one" is
    // a rule about authorship inside a firm, not a tenancy boundary, and
    // telling a colleague the row exists gives away nothing they cannot read.
    if (d.created_by !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const title = body.title !== undefined ? (body.title ? String(body.title).slice(0, 300) : d.title) : d.title;
    const memo = body.memo !== undefined ? (body.memo ? String(body.memo).slice(0, 20000) : null) : d.memo;
    const termsJson = body.terms !== undefined ? (body.terms != null ? JSON.stringify(body.terms) : null) : d.terms_json;
    let status = d.status;
    if (body.status && ['draft', 'voting', 'decided'].includes(body.status)) status = body.status;
    let decision = d.decision;
    let decidedAt = d.decided_at;
    if (body.decision !== undefined) {
      decision = body.decision && ['invest', 'pass', 'defer'].includes(body.decision) ? body.decision : null;
      if (decision) { status = 'decided'; decidedAt = decidedAt || nowIso(); }
    }
    let outcome = d.outcome;
    if (body.outcome !== undefined) {
      outcome = body.outcome && ['open', 'vindicated', 'regret'].includes(body.outcome) ? body.outcome : null;
    }
    let ddCaseId = d.dd_case_id;
    if (body.dd_case_id !== undefined) {
      ddCaseId = null;
      if (body.dd_case_id != null && Number.isFinite(Number(body.dd_case_id))) {
        const cs = await c.env.DB.prepare('SELECT id FROM dd_cases WHERE id = ?').bind(Number(body.dd_case_id)).first<{ id: number }>();
        if (cs) ddCaseId = Number(cs.id);
      }
    }
    await c.env.DB.prepare(
      `UPDATE ic_decisions SET title=?, memo=?, terms_json=?, status=?, decision=?, outcome=?, decided_at=?, dd_case_id=?, updated_at=? WHERE id=?`
    ).bind(title, memo, termsJson, status, decision, outcome, decidedAt, ddCaseId, nowIso(), d.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?').bind(d.id).first<DecisionRow>();
    return c.json(await dto(c.env, fresh!, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

// POST /api/ic/:uid/vote — upsert the caller's vote
r.post('/:uid/vote', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await loadDecision(c.env, user, c.req.param('uid'));
    if (!d) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const vote = String(body.vote || '').toLowerCase();
    if (!['yes', 'no', 'abstain'].includes(vote)) return c.json({ detail: 'vote must be yes|no|abstain' }, 400);
    const rationale = body.rationale ? String(body.rationale).slice(0, 2000) : null;
    await c.env.DB.prepare(
      `INSERT INTO ic_votes (ic_decision_id, user_id, vote, rationale, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ic_decision_id, user_id) DO UPDATE SET vote=excluded.vote, rationale=excluded.rationale, created_at=excluded.created_at`
    ).bind(d.id, user.id, vote, rationale, nowIso()).run();
    // First vote moves a draft into the voting stage.
    if (d.status === 'draft') {
      await c.env.DB.prepare("UPDATE ic_decisions SET status='voting', updated_at=? WHERE id=?").bind(nowIso(), d.id).run();
    }
    // Task #83 — auto-draft a PRIVATE decision-journal entry for the voter, so
    // every IC vote lands in the ledger (audit ⑧) without re-typing. It is a
    // draft the voter can later refine on the Watchlist/Journal surface.
    // Idempotent per (owner_user_id, ic_decision_id) via the partial unique
    // index from migration 142: re-voting UPDATES the same draft. Never let a
    // journal failure fail the vote — the vote is the source of truth.
    if (d.project_id != null) {
      try {
        const decisionMap: Record<string, string> = { yes: 'invest', no: 'pass', abstain: 'defer' };
        const journalDecision = decisionMap[vote];
        const thesis = (rationale && rationale.trim().length >= 3)
          ? rationale.trim().slice(0, 4000)
          : `IC vote (${vote}) on "${d.title}"`;
        const existing = await c.env.DB.prepare(
          'SELECT id FROM decision_journal_entries WHERE owner_user_id = ? AND ic_decision_id = ?'
        ).bind(user.id, d.id).first<{ id: number }>();
        if (existing) {
          // Keep the voter's hand-edited thesis unless they supplied a fresh rationale.
          if (rationale && rationale.trim().length >= 3) {
            await c.env.DB.prepare(
              'UPDATE decision_journal_entries SET decision=?, thesis=?, updated_at=? WHERE id=?'
            ).bind(journalDecision, thesis, nowIso(), existing.id).run();
          } else {
            await c.env.DB.prepare(
              'UPDATE decision_journal_entries SET decision=?, updated_at=? WHERE id=?'
            ).bind(journalDecision, nowIso(), existing.id).run();
          }
        } else {
          await c.env.DB.prepare(
            `INSERT INTO decision_journal_entries
               (uid, owner_user_id, project_id, deal_id, ic_decision_id, decision, conviction, thesis, outcome_status, decided_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, '3', ?, 'pending', ?, ?, ?)`
          ).bind(newUid(), user.id, d.project_id, d.deal_id, d.id, journalDecision, thesis, nowIso(), nowIso(), nowIso()).run();
        }
      } catch { /* journal is best-effort; never block the vote */ }
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?').bind(d.id).first<DecisionRow>();
    return c.json(await dto(c.env, fresh!, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

export default r;

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

export type ConditionRow = {
  uid: string; body: string; status: string;
  created_by: number; created_at: string;
  resolved_at: string | null; resolved_by: number | null;
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
): Promise<Array<DecisionRow & { votes: VoteRow[]; conditions: ConditionRow[] }>> {
  const scope = icDecisionScope(user);
  const where = scope.sql;
  // `limit` is a clamped integer from this module's own callers, never from a
  // request, and it is bound rather than interpolated regardless.
  const rows = await env.DB.prepare(
    `SELECT d.* FROM ic_decisions d WHERE ${where} ORDER BY d.updated_at DESC LIMIT ?`
  ).bind(...scope.binds, Math.max(1, Math.min(500, Math.trunc(limit)))).all<DecisionRow>();
  const out: Array<DecisionRow & { votes: VoteRow[]; conditions: ConditionRow[] }> = [];
  for (const d of ((rows.results || []) as DecisionRow[])) {
    const votes = await env.DB.prepare(
      `SELECT v.vote, v.rationale, v.user_id, v.created_at, u.name AS user_name
         FROM ic_votes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.ic_decision_id = ? ORDER BY v.created_at ASC`
    ).bind(d.id).all<VoteRow>();
    // The conditions ride the same read: a condition is visible exactly when
    // its decision is, so no second predicate exists to forget.
    const conditions = await env.DB.prepare(
      `SELECT uid, body, status, created_by, created_at, resolved_at, resolved_by
         FROM ic_conditions WHERE ic_decision_id = ? ORDER BY created_at ASC`
    ).bind(d.id).all<ConditionRow>();
    out.push({ ...d, votes: (votes.results || []) as VoteRow[], conditions: (conditions.results || []) as ConditionRow[] });
  }
  return out;
}

async function tally(env: Env, decisionId: number): Promise<{ yes: number; no: number; abstain: number; recused: number }> {
  const rows = await env.DB.prepare(
    'SELECT vote, COUNT(*) AS n FROM ic_votes WHERE ic_decision_id = ? GROUP BY vote'
  ).bind(decisionId).all<{ vote: string; n: number }>();
  // A RECUSAL IS COUNTED BESIDE THE TALLY, NEVER IN IT. The voter declared a
  // conflict and leaves the yes/no/abstain denominator — an abstention is a
  // vote cast and stays in it. The two were one value before `recused`
  // joined the vocabulary, which is the conflation the ID3 artboard's note
  // is written against.
  const out = { yes: 0, no: 0, abstain: 0, recused: 0 };
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
    // The decision's conditions (migration 334), oldest first — the record a
    // later stage checks.
    const conditions = await env.DB.prepare(
      `SELECT cond.uid, cond.body, cond.status, cond.created_by, cond.created_at,
              cond.resolved_at, cond.resolved_by, cu.name AS created_by_name, ru.name AS resolved_by_name
         FROM ic_conditions cond
         LEFT JOIN users cu ON cu.id = cond.created_by
         LEFT JOIN users ru ON ru.id = cond.resolved_by
        WHERE cond.ic_decision_id = ? ORDER BY cond.created_at ASC`
    ).bind(d.id).all<any>();
    base.conditions = conditions.results || [];
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
// WHAT THE ARTBOARD DRAWS THAT NO STORE HELD when this route was written —
// recusal, conditions, quorum and minutes — was first returned as an explicit
// unavailable-with-reason rather than omitted. D461 (wave 8) built three of
// the four: `recused` is a vote value with its declaration required as the
// rationale, conditions are their own table, and minutes live on the meeting.
// QUORUM is the one that remains unstored: the IC charter states one in
// prose, and a document body is not a number the product can check a tally
// against — so it is still reported as a gap rather than rendered.
//
// RECUSAL IS THE ONE THAT MUST NOT BE FAKED, and the distinction the
// artboard's note makes load-bearing survives the build: an abstention is a
// vote CAST — the voter was counted and declined — while a recusal is a
// declared conflict that removes the voter from the DENOMINATOR. Mapping one
// onto the other would put a false statement about a conflict of interest on
// a fund's screen, which is why they are different values with different
// arithmetic rather than two spellings of one.
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
        // WHO MAY CLOSE THIS ONE, and the reason it travels with the summary.
        // `PUT /:uid` admits the decision's author and an admin, and refuses a
        // colleague with a 403 — a rule about authorship inside a firm, not a
        // tenancy boundary. Without this field the Commit page would have to
        // offer the close form to everyone who can SEE the decision and let the
        // 403 be the explanation, which is a control teaching a reader it is
        // dead by failing. Additive: no existing consumer reads it.
        created_by: d.created_by ?? null,
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
        conditions: {
          open: (d.conditions || []).filter((cond) => cond.status === 'open').length,
          total: (d.conditions || []).length,
        },
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
    // The minutes answer rides the same meeting: none linked, none to read.
    let minutes: any = {
      available: false,
      reason: 'No IC meeting is linked to this decision’s deal, so there are no minutes to read.',
    };
    if (current?.deal_id != null) {
      const meeting = await c.env.DB.prepare(
        `SELECT id, uid, title, start_at, status, organizer_user_id, minutes, minutes_recorded_at, minutes_recorded_by
           FROM ic_meetings
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
        // Minutes (migration 334): what the room concluded, written after it.
        // The organiser or an admin records them; everyone who can see the
        // decision reads them. Unrecorded is a state, not an absence of the
        // store.
        let recordedByName: string | null = null;
        if (meeting.minutes_recorded_by != null) {
          const recorder = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?')
            .bind(meeting.minutes_recorded_by).first<{ name: string }>().catch(() => null);
          recordedByName = recorder?.name ?? null;
        }
        minutes = {
          available: true,
          meeting_uid: meeting.uid,
          meeting_title: meeting.title ?? null,
          recorded: meeting.minutes != null && String(meeting.minutes).trim().length > 0,
          minutes: meeting.minutes ?? null,
          recorded_by: recordedByName,
          recorded_at: meeting.minutes_recorded_at ?? null,
          may_record: meeting.organizer_user_id === user.id || isAdmin(user),
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
      // RECUSAL IS A REAL VALUE NOW (D461). `ic_votes.vote` carries no CHECK,
      // so `recused` joined the vocabulary at the vote endpoint with the
      // declaration required as its rationale; the tally counts recusals
      // beside the denominator and never in it.
      recusal: {
        available: true,
        recused: list.reduce((n, d) => n + d.votes.filter((v) => v.vote === 'recused').length, 0),
        note: 'A recusal is a declared conflict: the voter writes the declaration as the vote’s rationale, '
          + 'is counted as recused, and leaves the yes/no/abstain denominator. An abstention is a vote cast '
          + 'and stays in it.',
      },
      // CONDITIONS ARE A STORE NOW (migration 334): one row per condition on a
      // decision, open | met | waived, and an open one is what ID4's Blocking
      // chip reads.
      conditions: {
        available: true,
        rows: list.flatMap((d) => (d.conditions || []).map((cond) => ({
          ...cond,
          decision_uid: d.uid,
          decision_title: d.title,
          deal_id: d.deal_id ?? null,
        }))),
      },
      minutes,
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

// ---------------------------------------------------------------------------
// GET /api/ic/conditions — the conditions on every decision this caller may
// see, joined to the deal each could block. Canvas ID3's Conditions chip and
// ID4's Blocking chip read the same rows.
//
// REGISTERED BEFORE `/:uid`, like `commit-room`: Hono matches in registration
// order and `conditions` would otherwise be read as a decision uid. The scope
// is the decisions' own — a condition is visible exactly when its decision is,
// so the join carries `icDecisionScope` rather than a second predicate.
// ---------------------------------------------------------------------------
r.get('/conditions', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const status = String(c.req.query('status') || '');
    const scope = icDecisionScope(user);
    const params: any[] = [...scope.binds];
    let where = scope.sql;
    if (['open', 'met', 'waived'].includes(status)) { where += ' AND cond.status = ?'; params.push(status); }
    const rows = await c.env.DB.prepare(
      `SELECT cond.id, cond.uid, cond.ic_decision_id, cond.body, cond.status,
              cond.created_by, cond.created_at, cond.resolved_at, cond.resolved_by,
              d.title AS decision_title, d.deal_id AS deal_id,
              cu.name AS created_by_name, ru.name AS resolved_by_name
         FROM ic_conditions cond
         JOIN ic_decisions d ON d.id = cond.ic_decision_id
         LEFT JOIN users cu ON cu.id = cond.created_by
         LEFT JOIN users ru ON ru.id = cond.resolved_by
        WHERE ${where}
        ORDER BY cond.created_at DESC LIMIT 500`
    ).bind(...params).all<any>();
    return c.json({ items: rows.results || [] });
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
    // `recused` needs no migration: ic_votes.vote carries no CHECK, and the
    // vocabulary is enforced here. What it DOES need is the declaration — a
    // recusal with no conflict written down is an unattributed change to the
    // denominator, so the rationale is required for this one value.
    if (!['yes', 'no', 'abstain', 'recused'].includes(vote)) return c.json({ detail: 'vote must be yes|no|abstain|recused' }, 400);
    const rationale = body.rationale ? String(body.rationale).slice(0, 2000) : null;
    if (vote === 'recused' && !rationale?.trim()) {
      return c.json({
        error: 'recusal_requires_declaration',
        message: 'A recusal records the conflict it declares. Write the declaration as the rationale.',
      }, 400);
    }
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
    //
    // A RECUSAL IS EXCLUDED, because it is not a decision: the map has no key
    // for it and no journal row may claim one. The recusal's own record is the
    // vote row, declaration included. If an auto-draft already exists from an
    // earlier vote, it is now false — remove it when it still carries only the
    // auto-generated fallback thesis (nothing hand-written is lost), and
    // otherwise re-mark it 'other' so the ledger stops saying invest/pass/
    // defer while keeping the voter's own words.
    if (d.project_id != null && vote !== 'recused') {
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
    } else if (d.project_id != null && vote === 'recused') {
      try {
        const existing = await c.env.DB.prepare(
          'SELECT id, thesis FROM decision_journal_entries WHERE owner_user_id = ? AND ic_decision_id = ?'
        ).bind(user.id, d.id).first<{ id: number; thesis: string }>();
        if (existing) {
          if (String(existing.thesis || '').startsWith('IC vote (')) {
            // The fallback thesis carries nothing hand-written; the draft
            // exists only as the old vote's shadow and is now false.
            await c.env.DB.prepare('DELETE FROM decision_journal_entries WHERE id = ?').bind(existing.id).run();
          } else {
            await c.env.DB.prepare(
              "UPDATE decision_journal_entries SET decision='other', updated_at=? WHERE id=?"
            ).bind(nowIso(), existing.id).run();
          }
        }
      } catch { /* same rule: never block the vote on the journal */ }
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?').bind(d.id).first<DecisionRow>();
    return c.json(await dto(c.env, fresh!, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Conditions (migration 334) — the record a later stage can block on.
// ---------------------------------------------------------------------------

// POST /api/ic/:uid/conditions — add one to a decision the caller may see.
// Seeing the decision is the gate: a condition is proposed in the room, and
// the room is everyone the decision is scoped to. Resolving one is the
// narrower act, on the resolve route below.
r.post('/:uid/conditions', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await loadDecision(c.env, user, c.req.param('uid'));
    if (!d) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const text = body?.body != null ? String(body.body).trim().slice(0, 2000) : '';
    if (!text) {
      return c.json({
        error: 'condition_body_required',
        message: 'A condition is the sentence a later stage checks — write it.',
      }, 400);
    }
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO ic_conditions (uid, ic_decision_id, body, status, created_by, created_at)
       VALUES (?, ?, ?, 'open', ?, ?)`
    ).bind(uid, d.id, text, user.id, nowIso()).run();
    const row = await c.env.DB.prepare(
      `SELECT cond.*, cu.name AS created_by_name FROM ic_conditions cond
        LEFT JOIN users cu ON cu.id = cond.created_by WHERE cond.id = ?`
    ).bind((ins as any).meta?.last_row_id).first<any>();
    return c.json({ item: row }, 201);
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/ic/conditions/:uid — mark met or waived, or set back to open.
// The decision's author or an admin: resolving a condition is what unblocks
// the wire, so it sits with whoever may close the vote, not with the room.
r.patch('/conditions/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const cond = await c.env.DB.prepare('SELECT * FROM ic_conditions WHERE uid = ?')
      .bind(c.req.param('uid')).first<any>();
    if (!cond) return c.json({ detail: 'Not found' }, 404);
    // The scope check rides on the decision: a condition on a decision this
    // caller may not see is the same 404 as the decision itself. The fragment
    // reaches the query through `where`, the interpolation this file already
    // carries in scripts/sql-prepare-baseline.json — literal SQL from
    // tenancyScope with every value bound.
    const scope = icDecisionScope(user);
    const where = `d.id = ? AND ${scope.sql}`;
    const d = await c.env.DB.prepare(`SELECT d.* FROM ic_decisions d WHERE ${where}`)
      .bind(cond.ic_decision_id, ...scope.binds).first<DecisionRow>();
    if (!d) return c.json({ detail: 'Not found' }, 404);
    if (d.created_by !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const status = String(body?.status || '');
    if (!['open', 'met', 'waived'].includes(status)) {
      return c.json({
        error: 'condition_status_invalid',
        message: 'A condition is open, met or waived.',
      }, 400);
    }
    const resolving = status !== 'open';
    await c.env.DB.prepare(
      'UPDATE ic_conditions SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?'
    ).bind(status, resolving ? nowIso() : null, resolving ? user.id : null, cond.id).run();
    const row = await c.env.DB.prepare(
      `SELECT cond.*, cu.name AS created_by_name, ru.name AS resolved_by_name FROM ic_conditions cond
        LEFT JOIN users cu ON cu.id = cond.created_by LEFT JOIN users ru ON ru.id = cond.resolved_by
       WHERE cond.id = ?`
    ).bind(cond.id).first<any>();
    return c.json({ item: row });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Minutes (migration 334) — what the room concluded, written after it.
// ---------------------------------------------------------------------------

// PATCH /api/ic/meetings/:uid/minutes — record or replace the minutes. The
// organiser or an admin writes them; the room reads them through the
// commit-room payload, which reaches the meeting only through a decision it
// may already see.
r.patch('/meetings/:uid/minutes', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const m = await c.env.DB.prepare('SELECT * FROM ic_meetings WHERE uid = ?')
      .bind(c.req.param('uid')).first<any>();
    if (!m) return c.json({ detail: 'Not found' }, 404);
    if (m.organizer_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    if (body?.minutes != null && typeof body.minutes !== 'string') {
      return c.json({ error: 'minutes_invalid', message: 'Minutes are the room’s own text.' }, 400);
    }
    const minutes = body?.minutes != null ? String(body.minutes).slice(0, 20000) : null;
    const recording = minutes != null && minutes.trim().length > 0;
    await c.env.DB.prepare(
      'UPDATE ic_meetings SET minutes = ?, minutes_recorded_by = ?, minutes_recorded_at = ?, updated_at = ? WHERE id = ?'
    ).bind(recording ? minutes : null, recording ? user.id : null, recording ? nowIso() : null, nowIso(), m.id).run();
    const fresh = await c.env.DB.prepare(
      `SELECT m.uid, m.title, m.start_at, m.status, m.minutes, m.minutes_recorded_at, u.name AS minutes_recorded_by_name
         FROM ic_meetings m LEFT JOIN users u ON u.id = m.minutes_recorded_by WHERE m.id = ?`
    ).bind(m.id).first<any>();
    return c.json({ item: fresh });
  } catch (e) { return mapError(c, e); }
});

export default r;

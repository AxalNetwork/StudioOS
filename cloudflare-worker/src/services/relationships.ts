/**
 * D1356 (#3571, part 7 of #3564) — who on my teams knows a person.
 *
 * PRIVATE BY DEFAULT. A teammate's contact reaches a reply only through one
 * statement that joins, in SQL, all of:
 *   - my team memberships (`team_memberships`, a view over the memberships Axal
 *     already records, migration 653);
 *   - the teammate's membership of that same team;
 *   - the teammate's share with that team that is effective now: their own row
 *     for the team, or their opt-in for every team (`'*'`) without a
 *     withdrawal for this one (`relationship_shares`);
 *   - the shared projection (`shared_relationships`), which has no email,
 *     phone, notes or URL column and holds only rows an eligible source vouches for.
 * Nothing is filtered after the read. Withdrawing sets `withdrawn_at`, so it
 * takes effect on the next read.
 *
 * IDENTITY is the exact profile URL (`url:`) or the exact email (`email:`);
 * a person matches on either, and a name alone never matches. A member's own
 * rows are never rewritten.
 *
 * Every share, withdrawal, who-knows read and introduction request writes an
 * `integration_audit_log` row (provider `relationships`), by ids and counts,
 * never an email.
 */
import type { Env, User } from '../types';
import { normaliseEmail, normaliseProfileUrl } from './linkedinCsvImport';
import { notify } from './notify';

export class RelationshipRefusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) { super(sentence); this.status = status; this.code = code; this.sentence = sentence; }
}

export const NOT_FOUND = 'Not found.';
export const INTRO_REQUESTS_PER_DAY = 20;
const SOURCE_LABEL: Record<string, string> = { linkedin_csv: 'LinkedIn connections file', csv: 'Spreadsheet', typed: 'Added by hand' };
const TEAM_KEY = /^(\*|hq|project:[1-9][0-9]{0,9}|firm:[1-9][0-9]{0,9})$/;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID().replace(/-/g, '');

async function audit(env: Env, actor: number, owner: number, event: 'share' | 'access', subject: string) {
  await env.DB.prepare("INSERT INTO integration_audit_log (actor_user_id, owner_user_id, provider, event, subject) VALUES (?, ?, 'relationships', ?, ?)")
    .bind(actor, owner, event, subject).run();
}

// ---------------------------------------------------------------- sharing

export async function myTeams(env: Env, user: User) {
  const rows = (await env.DB.prepare(
    `SELECT tm.team_key, MIN(tm.team_kind) AS team_kind, MIN(tm.team_label) AS team_label,
            (SELECT rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL FROM relationship_shares rs WHERE rs.user_id = tm.user_id AND rs.team_key = tm.team_key) AS own,
            (SELECT rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL FROM relationship_shares rs WHERE rs.user_id = tm.user_id AND rs.team_key = '*') AS everyone
       FROM team_memberships tm WHERE tm.user_id = ? GROUP BY tm.team_key ORDER BY tm.team_key`,
  ).bind(user.id).all<{ team_key: string; team_kind: string; team_label: string; own: number | null; everyone: number | null }>()).results || [];
  const optedIn = !!rows[0]?.everyone || !!(await env.DB.prepare("SELECT 1 FROM relationship_shares WHERE user_id = ? AND team_key = '*' AND granted_at IS NOT NULL AND withdrawn_at IS NULL").bind(user.id).first());
  return {
    opted_in: optedIn,
    teams: rows.map((r) => ({ key: r.team_key, kind: r.team_kind, label: r.team_label, shared: r.own === 1 || (r.own === null && optedIn) })),
  };
}

/** Turns sharing on or off, for every team (`'*'`) or one team the member belongs to. */
export async function setShare(env: Env, user: User, teamKey: string, share: boolean) {
  if (!TEAM_KEY.test(teamKey)) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  if (teamKey !== '*' && !await env.DB.prepare('SELECT 1 FROM team_memberships WHERE user_id = ? AND team_key = ?').bind(user.id, teamKey).first()) {
    throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  }
  const at = now();
  await env.DB.prepare(
    `INSERT INTO relationship_shares (user_id, team_key, granted_at, withdrawn_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, team_key) DO UPDATE SET granted_at = CASE WHEN excluded.withdrawn_at IS NULL THEN excluded.granted_at ELSE granted_at END,
       withdrawn_at = excluded.withdrawn_at, updated_at = excluded.updated_at`,
  ).bind(user.id, teamKey, share ? at : null, share ? null : at, at).run();
  await audit(env, user.id, user.id, 'share', `${share ? 'grant' : 'withdraw'}:${teamKey}`);
  return myTeams(env, user);
}

// ---------------------------------------------------------------- who knows

export type WhoKnowsQuery = { kind: 'person' | 'company' | 'fund'; value: string };

/** The query a who-knows read asks: a person by profile URL or email (never a name), or a company or fund by name. */
export function whoKnowsQuery(q: { person?: string; company?: string; fund?: string }): WhoKnowsQuery {
  const given = (['person', 'company', 'fund'] as const).filter((k) => typeof q[k] === 'string' && q[k]!.trim());
  if (given.length !== 1) throw new RelationshipRefusal(400, 'query_required', 'Ask about one person, company or fund.');
  const kind = given[0];
  const raw = q[kind]!.trim();
  if (kind === 'person') {
    const url = normaliseProfileUrl(raw);
    if (url) return { kind, value: `url:${url}` };
    const email = normaliseEmail(raw);
    if (email) return { kind, value: `email:${email}` };
    throw new RelationshipRefusal(400, 'person_unmatchable', 'Give a LinkedIn profile URL or an email address. A name alone never matches a person.');
  }
  if (raw.length > 200) throw new RelationshipRefusal(400, 'query_too_long', 'Give a shorter name.');
  return { kind, value: raw };
}

type Known = {
  contact_id: number; owner_user_id: number; teammate_name: string | null; team_key: string; team_label: string;
  name: string; company: string | null; title: string | null; connected_on: string | null; source: string;
};

// The access rule, written into each statement in full: my team, the teammate's
// membership of it, and their share with it effective now.
const BY_PERSON = `SELECT sr.contact_id, sr.owner_user_id, u.name AS teammate_name, MIN(mine.team_key) AS team_key, MIN(mine.team_label) AS team_label,
       sr.name, sr.company, sr.title, sr.connected_on, sr.source
  FROM team_memberships mine
  JOIN team_memberships theirs ON theirs.team_key = mine.team_key AND theirs.user_id <> mine.user_id
  JOIN shared_relationships sr ON sr.owner_user_id = theirs.user_id
  JOIN users u ON u.id = theirs.user_id
 WHERE mine.user_id = ?
   AND (EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = mine.team_key AND rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL)
        OR (EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = '*' AND rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = mine.team_key AND rs.withdrawn_at IS NOT NULL)))
   AND ? IN (sr.url_key, sr.email_key)
 GROUP BY sr.contact_id ORDER BY u.name, sr.contact_id LIMIT 50`;

const BY_COMPANY = `SELECT sr.contact_id, sr.owner_user_id, u.name AS teammate_name, MIN(mine.team_key) AS team_key, MIN(mine.team_label) AS team_label,
       sr.name, sr.company, sr.title, sr.connected_on, sr.source
  FROM team_memberships mine
  JOIN team_memberships theirs ON theirs.team_key = mine.team_key AND theirs.user_id <> mine.user_id
  JOIN shared_relationships sr ON sr.owner_user_id = theirs.user_id
  JOIN users u ON u.id = theirs.user_id
 WHERE mine.user_id = ?
   AND (EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = mine.team_key AND rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL)
        OR (EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = '*' AND rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = mine.team_key AND rs.withdrawn_at IS NOT NULL)))
   AND sr.company IS NOT NULL AND lower(TRIM(sr.company)) = lower(TRIM(?))
 GROUP BY sr.contact_id ORDER BY u.name, sr.name, sr.contact_id LIMIT 50`;

const ONE_VISIBLE = `SELECT sr.contact_id, sr.owner_user_id, u.name AS teammate_name, MIN(mine.team_key) AS team_key, MIN(mine.team_label) AS team_label,
       sr.name, sr.company, sr.title, sr.connected_on, sr.source, sr.person_key
  FROM team_memberships mine
  JOIN team_memberships theirs ON theirs.team_key = mine.team_key AND theirs.user_id <> mine.user_id
  JOIN shared_relationships sr ON sr.owner_user_id = theirs.user_id
  JOIN users u ON u.id = theirs.user_id
 WHERE mine.user_id = ?
   AND (EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = mine.team_key AND rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL)
        OR (EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = '*' AND rs.granted_at IS NOT NULL AND rs.withdrawn_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM relationship_shares rs WHERE rs.user_id = theirs.user_id AND rs.team_key = mine.team_key AND rs.withdrawn_at IS NOT NULL)))
   AND sr.contact_id = ? AND theirs.user_id = ?
 GROUP BY sr.contact_id`;

/**
 * D4330 (#4330): one teammate's relationship, only when the caller may see it now: the same statement an
 * introduction request checks, so a row the caller cannot see is null whatever the reason.
 */
export async function visibleRelationship(env: Env, user: User, teammate: unknown, ref: unknown) {
  const t = Number(teammate), r = Number(ref);
  if (!Number.isSafeInteger(t) || t < 1 || !Number.isSafeInteger(r) || r < 1) return null;
  const row = await env.DB.prepare(ONE_VISIBLE).bind(user.id, r, t).first<Known>();
  return row ? knownView(row) : null;
}

const knownView = (r: Known) => ({
  ref: r.contact_id,
  teammate: { id: r.owner_user_id, name: r.teammate_name },
  team: { key: r.team_key, label: r.team_label },
  person: { name: r.name, company: r.company, title: r.title },
  how: { source: r.source, source_label: SOURCE_LABEL[r.source] ?? r.source, connected_since: r.connected_on },
});

export async function whoKnows(env: Env, user: User, q: WhoKnowsQuery) {
  const rows = (await env.DB.prepare(q.kind === 'person' ? BY_PERSON : BY_COMPANY).bind(user.id, q.value).all<Known>()).results || [];
  await audit(env, user.id, user.id, 'access', `who_knows:${q.kind}:${rows.length}`);
  // Each teammate whose relationship was shown can see that it was read, and by whom.
  for (const owner of [...new Set(rows.map((r) => r.owner_user_id))]) await audit(env, user.id, owner, 'access', `who_knows_shown:${q.kind}`);
  return { query: { kind: q.kind }, people: rows.map(knownView) };
}

// ---------------------------------------------------------------- introductions
//
// D4329 (#4329, D1357 part 8a): the request lifecycle.
//
//   pending ──accept──▶ accepted ──the intro sent from the Email composer──▶ made
//      │                    (decision_note)                (mail_sent_uid)
//      ├──Not now──▶ declined (decision_note, which the asker reads)
//      └──the asker withdraws──▶ withdrawn
//
// Only the two people on a request ever read it: the asker and the teammate
// they asked. Every read and write names the caller in its WHERE clause, so a
// request between two other members is 404 in the same words as one that does
// not exist, and is in no list and no count. A request exists only because the
// teammate shared with that team when it was asked (D1356 §6), so a teammate
// who never shared is in no request, no log row and no count. No route here
// contacts the person: the intro goes from the introducer's own mailbox.

export type Interaction = {
  uid: string; kind: string; requester_user_id: number; teammate_user_id: number; team_key: string; person_name: string;
  person_company: string | null; note: string | null; context_note: string | null; decision_note: string | null; status: string;
  parent_uid: string | null; decided_at: string | null; accepted_at: string | null; made_at: string | null; withdrawn_at: string | null;
  mail_sent_uid: string | null; created_at: string; contact_id: number | null; person_key: string | null;
};
export type Outcome = { parent_uid: string; outcome: string; outcome_note: string | null; recorded_by_user_id: number | null; created_at: string };
type FollowUp = { request_uid: string; due_on: string; done_at: string | null; snoozed_until: string | null };

export const OUTCOMES = ['meeting_held', 'replied', 'no_reply', 'not_a_fit'] as const;
export const OUTCOME_LABEL: Record<string, string> = { meeting_held: 'Meeting held', replied: 'Replied', no_reply: 'No reply', not_a_fit: 'Not a fit' };
/** What the log reads until someone records an outcome: never "no reply". */
export const NOT_RECORDED = 'Not recorded';
export const LOG_STATUSES = ['pending', 'accepted', 'declined', 'made', 'withdrawn'] as const;
const UID = /^[a-f0-9]{32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

const textOf = (v: unknown, max: number, code: string, what: string): string | null => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new RelationshipRefusal(400, code, `${what} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new RelationshipRefusal(400, code, `Keep ${what.toLowerCase()} under ${max.toLocaleString('en-US')} characters.`);
  return t || null;
};
const dayOf = (v: unknown, code: string, what: string): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!DAY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw new RelationshipRefusal(400, code, `Give ${what} as a date, YYYY-MM-DD.`);
  }
  return s;
};

/** A follow-up is due once its date (or the date it was snoozed to) has come, until it is done. */
export const followUpState = (f: FollowUp | null, on = today()) => {
  if (!f) return null;
  const until = f.snoozed_until && f.snoozed_until > f.due_on ? f.snoozed_until : null;
  const state = f.done_at ? 'done' : until && until > on ? 'snoozed' : (until ?? f.due_on) <= on ? 'due' : 'scheduled';
  return { due_on: f.due_on, snoozed_until: until, done_at: f.done_at, state };
};

function interactionView(r: Interaction, caller: number, outcome: Outcome | null, followUp: FollowUp | null) {
  const asker = r.requester_user_id === caller;
  return {
    uid: r.uid, kind: r.kind, requester_user_id: r.requester_user_id, teammate_user_id: r.teammate_user_id, team_key: r.team_key,
    person: { name: r.person_name, company: r.person_company }, note: r.note,
    // The context for the person is the asker's note to the teammate, to forward if they choose: only the two of them read it.
    context_note: r.context_note, decision_note: r.decision_note,
    status: r.status, parent_uid: r.parent_uid, decided_at: r.decided_at, accepted_at: r.accepted_at, made_at: r.made_at, withdrawn_at: r.withdrawn_at,
    outcome: outcome
      ? { value: outcome.outcome, label: OUTCOME_LABEL[outcome.outcome] ?? outcome.outcome, note: outcome.outcome_note, recorded_by_user_id: outcome.recorded_by_user_id, recorded_at: outcome.created_at }
      : { value: null, label: NOT_RECORDED, note: null, recorded_by_user_id: null, recorded_at: null },
    follow_up: followUpState(followUp),
    // The send that made it, to the introducer who sent it only: the asker never reads the introducer's mailbox.
    mail_sent_uid: asker ? null : r.mail_sent_uid,
    created_at: r.created_at,
  };
}

/** One request, only when the caller is on it (`side`: the asker, the teammate, or either). Else 404 "Not found.". */
export async function requestOf(env: Env, user: User, requestUid: string, side: 'asker' | 'teammate' | 'either'): Promise<Interaction> {
  if (!UID.test(String(requestUid))) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  const sql = side === 'asker'
    ? "SELECT * FROM relationship_interactions WHERE uid = ? AND kind = 'intro_requested' AND requester_user_id = ?"
    : side === 'teammate'
      ? "SELECT * FROM relationship_interactions WHERE uid = ? AND kind = 'intro_requested' AND teammate_user_id = ?"
      : "SELECT * FROM relationship_interactions WHERE uid = ? AND kind = 'intro_requested' AND ? IN (requester_user_id, teammate_user_id)";
  const row = await env.DB.prepare(sql).bind(requestUid, user.id).first<Interaction>();
  if (!row) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  return row;
}

async function viewOf(env: Env, user: User, requestUid: string) {
  const row = (await env.DB.prepare('SELECT * FROM relationship_interactions WHERE uid = ?').bind(requestUid).first<Interaction>())!;
  const outcome = await env.DB.prepare(
    "SELECT parent_uid, outcome, outcome_note, recorded_by_user_id, created_at FROM relationship_interactions WHERE parent_uid = ? AND kind = 'outcome' ORDER BY id DESC LIMIT 1",
  ).bind(requestUid).first<Outcome>();
  const fu = await env.DB.prepare('SELECT request_uid, due_on, done_at, snoozed_until FROM relationship_follow_ups WHERE request_uid = ? AND user_id = ?')
    .bind(requestUid, user.id).first<FollowUp>();
  return interactionView(row, user.id, outcome ?? null, fu ?? null);
}

/** The event row a step writes under its request (653's intro_made/intro_declined shape). */
async function event(env: Env, ask: Interaction, kind: string, status: string, at: string, extra: { outcome?: string; outcome_note?: string | null; recorded_by?: number; mail_sent_uid?: string | null } = {}) {
  await env.DB.prepare(
    `INSERT INTO relationship_interactions (uid, kind, requester_user_id, teammate_user_id, team_key, contact_id, person_key, person_name, person_company,
       status, parent_uid, decided_at, outcome, outcome_note, recorded_by_user_id, mail_sent_uid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid(), kind, ask.requester_user_id, ask.teammate_user_id, ask.team_key, ask.contact_id, ask.person_key, ask.person_name, ask.person_company,
    status, ask.uid, at, extra.outcome ?? null, extra.outcome_note ?? null, extra.recorded_by ?? null, extra.mail_sent_uid ?? null).run();
}

const personLine = (r: { person_name: string; person_company: string | null }) => `${r.person_name}${r.person_company ? `, ${r.person_company}` : ''}`;
const introLink = (u: string) => `/network/introductions?intro=${u}`;

/** Asks a teammate for an introduction. It sends nothing to the contact: the teammate decides. */
export async function requestIntro(env: Env, user: User, b: { teammate?: unknown; ref?: unknown; note?: unknown; context_note?: unknown }) {
  const teammate = Number(b.teammate), ref = Number(b.ref);
  if (!Number.isSafeInteger(teammate) || teammate < 1 || !Number.isSafeInteger(ref) || ref < 1) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
  if (note && note.length > 1000) throw new RelationshipRefusal(400, 'note_too_long', 'Keep the note under 1,000 characters.');
  const contextNote = textOf(b.context_note, 1000, 'context_note_too_long', 'The context for the person');
  const row = await env.DB.prepare(ONE_VISIBLE).bind(user.id, ref, teammate).first<Known & { person_key: string | null }>();
  if (!row) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  const since = new Date(Date.now() - 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  const asked = await env.DB.prepare("SELECT COUNT(*) AS n FROM relationship_interactions WHERE requester_user_id = ? AND kind = 'intro_requested' AND created_at > ?")
    .bind(user.id, since).first<{ n: number }>();
  if (Number(asked?.n ?? 0) >= INTRO_REQUESTS_PER_DAY) throw new RelationshipRefusal(429, 'intro_rate_limited', `You have asked for ${INTRO_REQUESTS_PER_DAY} introductions today. Try again tomorrow.`);
  const id = uid();
  await env.DB.prepare(
    `INSERT INTO relationship_interactions (uid, kind, requester_user_id, teammate_user_id, team_key, contact_id, person_key, person_name, person_company, note, context_note)
     VALUES (?, 'intro_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, user.id, teammate, row.team_key, ref, row.person_key, row.name, row.company, note, contextNote).run();
  await audit(env, user.id, teammate, 'access', `intro_request:${id}`);
  await notify(env, {
    userId: teammate, type: 'relationship_intro_requested', category: 'mentions',
    title: `${user.name || 'A teammate'} asks for an introduction`,
    body: `To ${personLine({ person_name: row.name, person_company: row.company })}. Nothing is sent until you decide.`,
    link: introLink(id), payload: { uid: id },
  }).catch(() => null);
  return viewOf(env, user, id);
}

export type LogFilter = { team?: string | null; status?: string | null };

/** The member's own requests, sent and received, filtered by team and status, with their follow-ups due. */
export async function introRequests(env: Env, user: User, filter: LogFilter = {}) {
  const team = filter.team ? String(filter.team) : null;
  const status = filter.status ? String(filter.status) : null;
  if (status && !(LOG_STATUSES as readonly string[]).includes(status)) {
    throw new RelationshipRefusal(400, 'status_invalid', 'Filter by pending, accepted, declined, made or withdrawn.');
  }
  // A team filter names one of the caller's own teams; any other key is 404, so the log never confirms another team exists.
  if (team && (team === '*' || !TEAM_KEY.test(team) || !await env.DB.prepare('SELECT 1 FROM team_memberships WHERE user_id = ? AND team_key = ?').bind(user.id, team).first())) {
    throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  }
  const rows = (await env.DB.prepare(
    `SELECT * FROM relationship_interactions
      WHERE ? IN (requester_user_id, teammate_user_id) AND kind = 'intro_requested'
        AND (? IS NULL OR team_key = ?) AND (? IS NULL OR status = ?)
      ORDER BY created_at DESC, id DESC LIMIT 100`,
  ).bind(user.id, team, team, status, status).all<Interaction>()).results || [];
  const uids = rows.map((r) => r.uid);
  const outcomes = new Map<string, Outcome>();
  const followUps = new Map<string, FollowUp>();
  if (uids.length) {
    // The page's uids, bound as one JSON array: nothing is written into the statement.
    const list = JSON.stringify(uids);
    for (const o of (await env.DB.prepare(
      `SELECT parent_uid, outcome, outcome_note, recorded_by_user_id, created_at FROM relationship_interactions
        WHERE kind = 'outcome' AND parent_uid IN (SELECT value FROM json_each(?)) ORDER BY id`,
    ).bind(list).all<Outcome>()).results || []) outcomes.set(o.parent_uid, o);
    for (const f of (await env.DB.prepare(
      'SELECT request_uid, due_on, done_at, snoozed_until FROM relationship_follow_ups WHERE user_id = ? AND request_uid IN (SELECT value FROM json_each(?))',
    ).bind(user.id, list).all<FollowUp>()).results || []) followUps.set(f.request_uid, f);
  }
  const view = (r: Interaction) => interactionView(r, user.id, outcomes.get(r.uid) ?? null, followUps.get(r.uid) ?? null);
  return {
    sent: rows.filter((r) => r.requester_user_id === user.id).map(view),
    received: rows.filter((r) => r.teammate_user_id === user.id).map(view),
    follow_ups_due: await followUpsDue(env, user),
  };
}

/** The caller's own follow-ups that are due today, on requests they are still on. Never anyone else's. */
export async function followUpsDue(env: Env, user: User, on = today()): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM relationship_follow_ups f
       JOIN relationship_interactions r ON r.uid = f.request_uid AND r.kind = 'intro_requested'
      WHERE f.user_id = ? AND ? IN (r.requester_user_id, r.teammate_user_id) AND r.status IN ('accepted', 'made')
        AND f.done_at IS NULL AND COALESCE(CASE WHEN f.snoozed_until > f.due_on THEN f.snoozed_until END, f.due_on) <= ?`,
  ).bind(user.id, user.id, on).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/**
 * The teammate's answer: accepted or declined ("Not now"), once, with an optional note the
 * asker reads. Made is not an answer: it is recorded when the intro is sent (`markMadeOnSend`).
 */
export async function decideIntro(env: Env, user: User, requestUid: string, decision: unknown, noteIn?: unknown) {
  if (decision !== 'accepted' && decision !== 'declined') {
    throw new RelationshipRefusal(400, 'decision_invalid', 'Choose accepted or declined. An introduction is made when you send it from the Email composer.');
  }
  const note = textOf(noteIn, 1000, 'decision_note_too_long', 'The note');
  const ask = await requestOf(env, user, requestUid, 'teammate');
  if (ask.status !== 'pending') throw new RelationshipRefusal(409, 'decided', 'This request has already been answered.');
  const at = now();
  const r = await env.DB.prepare(
    `UPDATE relationship_interactions SET status = ?, decided_at = ?, decision_note = ?, accepted_at = CASE WHEN ? = 'accepted' THEN ? END
      WHERE uid = ? AND teammate_user_id = ? AND kind = 'intro_requested' AND status = 'pending'`,
  ).bind(decision, at, note, decision, at, requestUid, user.id).run();
  if (!(r.meta?.changes ?? 0)) throw new RelationshipRefusal(409, 'decided', 'This request has already been answered.');
  await event(env, ask, decision === 'accepted' ? 'intro_accepted' : 'intro_declined', decision, at);
  await audit(env, user.id, ask.requester_user_id, 'access', `intro_${decision}:${requestUid}`);
  await notify(env, {
    userId: ask.requester_user_id, type: 'relationship_intro_answered', category: 'mentions',
    title: decision === 'accepted' ? 'Your introduction request was accepted' : 'Your introduction request was declined',
    body: `${personLine(ask)}.${note ? ' There is a note for you.' : ''}`, link: introLink(requestUid), payload: { uid: requestUid },
  }).catch(() => null);
  return viewOf(env, user, requestUid);
}

/** The asker withdraws a request the teammate has not answered yet. */
export async function withdrawIntro(env: Env, user: User, requestUid: string) {
  const ask = await requestOf(env, user, requestUid, 'asker');
  if (ask.status !== 'pending') throw new RelationshipRefusal(409, 'not_pending', 'Only a request that has not been answered can be withdrawn.');
  const at = now();
  const r = await env.DB.prepare(
    "UPDATE relationship_interactions SET status = 'withdrawn', withdrawn_at = ? WHERE uid = ? AND requester_user_id = ? AND kind = 'intro_requested' AND status = 'pending'",
  ).bind(at, requestUid, user.id).run();
  if (!(r.meta?.changes ?? 0)) throw new RelationshipRefusal(409, 'not_pending', 'Only a request that has not been answered can be withdrawn.');
  await event(env, ask, 'intro_withdrawn', 'withdrawn', at);
  await audit(env, user.id, ask.teammate_user_id, 'access', `intro_withdrawn:${requestUid}`);
  await notify(env, {
    userId: ask.teammate_user_id, type: 'relationship_intro_withdrawn', category: 'mentions',
    title: `${user.name || 'A teammate'} withdrew an introduction request`, body: `${personLine(ask)}. Nothing more is needed from you.`,
    link: introLink(requestUid), payload: { uid: requestUid },
  }).catch(() => null);
  return viewOf(env, user, requestUid);
}

/**
 * Before the Email composer sends an intro: the caller must be the teammate on an accepted request.
 * Checked before anything goes out, so a send for someone else's request never leaves.
 */
export async function introForSend(env: Env, user: User, requestUid: unknown) {
  const ask = await requestOf(env, user, String(requestUid ?? ''), 'teammate');
  if (ask.status === 'made') throw new RelationshipRefusal(409, 'intro_already_made', 'This introduction has already been made.');
  if (ask.status !== 'accepted') throw new RelationshipRefusal(409, 'intro_not_accepted', 'Accept the request before writing the intro.');
  return ask;
}

/** The intro left the introducer's own mailbox (`mail_sent.uid`): the request is made. */
export async function markMadeOnSend(env: Env, user: User, requestUid: string, sentUid: string) {
  const sent = await env.DB.prepare('SELECT 1 FROM mail_sent WHERE uid = ? AND user_id = ? AND sent_at IS NOT NULL AND error IS NULL').bind(sentUid, user.id).first();
  if (!sent) throw new RelationshipRefusal(409, 'intro_not_sent', 'The intro was not sent, so it is not recorded as made.');
  const ask = await requestOf(env, user, requestUid, 'teammate');
  const at = now();
  const r = await env.DB.prepare(
    `UPDATE relationship_interactions SET status = 'made', made_at = ?, mail_sent_uid = ?
      WHERE uid = ? AND teammate_user_id = ? AND kind = 'intro_requested' AND status = 'accepted'`,
  ).bind(at, sentUid, requestUid, user.id).run();
  if (!(r.meta?.changes ?? 0)) return null;
  await event(env, ask, 'intro_made', 'made', at, { mail_sent_uid: sentUid });
  await audit(env, user.id, ask.requester_user_id, 'access', `intro_made:${requestUid}`);
  await notify(env, {
    userId: ask.requester_user_id, type: 'relationship_intro_answered', category: 'mentions',
    title: 'Your introduction was made', body: `${personLine(ask)}.`, link: introLink(requestUid), payload: { uid: requestUid },
  }).catch(() => null);
  return viewOf(env, user, requestUid);
}

/** Either side records what came of a made introduction. The latest recorded outcome is the one the log reads. */
export async function recordOutcome(env: Env, user: User, requestUid: string, b: { outcome?: unknown; note?: unknown }) {
  if (!(OUTCOMES as readonly unknown[]).includes(b.outcome)) {
    throw new RelationshipRefusal(400, 'outcome_invalid', 'Choose meeting held, replied, no reply or not a fit.');
  }
  const note = textOf(b.note, 500, 'outcome_note_too_long', 'The note');
  const ask = await requestOf(env, user, requestUid, 'either');
  if (ask.status !== 'made') throw new RelationshipRefusal(409, 'intro_not_made', 'An outcome is recorded once the introduction has been made.');
  await event(env, ask, 'outcome', 'made', now(), { outcome: String(b.outcome), outcome_note: note, recorded_by: user.id });
  const other = user.id === ask.requester_user_id ? ask.teammate_user_id : ask.requester_user_id;
  await audit(env, user.id, other, 'access', `intro_outcome:${requestUid}`);
  return viewOf(env, user, requestUid);
}

async function followUpOf(env: Env, user: User, requestUid: string) {
  const ask = await requestOf(env, user, requestUid, 'either');
  if (ask.status !== 'accepted' && ask.status !== 'made') throw new RelationshipRefusal(409, 'follow_up_unavailable', 'A follow-up is set on an accepted or made introduction.');
  return ask;
}

/** Sets (or moves) the caller's own follow-up on a request. It reopens a done one. */
export async function setFollowUp(env: Env, user: User, requestUid: string, b: { due_on?: unknown }) {
  const due = dayOf(b.due_on, 'due_on_invalid', 'the follow-up date');
  await followUpOf(env, user, requestUid);
  const at = now();
  await env.DB.prepare(
    `INSERT INTO relationship_follow_ups (uid, request_uid, user_id, due_on, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (request_uid, user_id) DO UPDATE SET due_on = excluded.due_on, done_at = NULL, snoozed_until = NULL, updated_at = excluded.updated_at`,
  ).bind(uid(), requestUid, user.id, due, at).run();
  return viewOf(env, user, requestUid);
}

async function changeFollowUp(env: Env, user: User, requestUid: string, sql: string, binds: unknown[]) {
  await followUpOf(env, user, requestUid);
  const r = await env.DB.prepare(sql).bind(...binds, now(), requestUid, user.id).run();
  if (!(r.meta?.changes ?? 0)) throw new RelationshipRefusal(404, 'follow_up_not_found', 'There is no follow-up on this introduction. Set one first.');
  return viewOf(env, user, requestUid);
}

export const followUpDone = (env: Env, user: User, requestUid: string) =>
  changeFollowUp(env, user, requestUid, 'UPDATE relationship_follow_ups SET done_at = ?2, updated_at = ?2 WHERE request_uid = ?3 AND user_id = ?4', [now()]);

export function snoozeFollowUp(env: Env, user: User, requestUid: string, b: { until?: unknown }) {
  const until = dayOf(b.until, 'until_invalid', 'the date to snooze to');
  if (until <= today()) throw new RelationshipRefusal(400, 'until_not_future', 'Snooze to a date after today.');
  return changeFollowUp(env, user, requestUid,
    'UPDATE relationship_follow_ups SET snoozed_until = ?1, done_at = NULL, updated_at = ?2 WHERE request_uid = ?3 AND user_id = ?4', [until]);
}

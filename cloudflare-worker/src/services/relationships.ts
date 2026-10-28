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

type Interaction = {
  uid: string; kind: string; requester_user_id: number; teammate_user_id: number; team_key: string; person_name: string;
  person_company: string | null; note: string | null; status: string; parent_uid: string | null; decided_at: string | null; created_at: string;
};
const interactionView = (r: Interaction) => ({
  uid: r.uid, kind: r.kind, requester_user_id: r.requester_user_id, teammate_user_id: r.teammate_user_id, team_key: r.team_key,
  person: { name: r.person_name, company: r.person_company }, note: r.note, status: r.status, parent_uid: r.parent_uid,
  decided_at: r.decided_at, created_at: r.created_at,
});

/** Asks a teammate for an introduction. It sends nothing to the contact: the teammate decides. */
export async function requestIntro(env: Env, user: User, b: { teammate?: unknown; ref?: unknown; note?: unknown }) {
  const teammate = Number(b.teammate), ref = Number(b.ref);
  if (!Number.isSafeInteger(teammate) || teammate < 1 || !Number.isSafeInteger(ref) || ref < 1) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
  if (note && note.length > 1000) throw new RelationshipRefusal(400, 'note_too_long', 'Keep the note under 1,000 characters.');
  const row = await env.DB.prepare(ONE_VISIBLE).bind(user.id, ref, teammate).first<Known & { person_key: string | null }>();
  if (!row) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  const since = new Date(Date.now() - 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  const asked = await env.DB.prepare("SELECT COUNT(*) AS n FROM relationship_interactions WHERE requester_user_id = ? AND kind = 'intro_requested' AND created_at > ?")
    .bind(user.id, since).first<{ n: number }>();
  if (Number(asked?.n ?? 0) >= INTRO_REQUESTS_PER_DAY) throw new RelationshipRefusal(429, 'intro_rate_limited', `You have asked for ${INTRO_REQUESTS_PER_DAY} introductions today. Try again tomorrow.`);
  const id = uid();
  await env.DB.prepare(
    `INSERT INTO relationship_interactions (uid, kind, requester_user_id, teammate_user_id, team_key, contact_id, person_key, person_name, person_company, note)
     VALUES (?, 'intro_requested', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, user.id, teammate, row.team_key, ref, row.person_key, row.name, row.company, note).run();
  await audit(env, user.id, teammate, 'access', `intro_request:${id}`);
  await notify(env, {
    userId: teammate, type: 'relationship_intro_requested', category: 'mentions',
    title: `${user.name || 'A teammate'} asks for an introduction`,
    body: `To ${row.name}${row.company ? `, ${row.company}` : ''}. Nothing is sent until you decide.`,
    link: `/network/relationships?intro=${id}`, payload: { uid: id },
  }).catch(() => null);
  return interactionView((await env.DB.prepare('SELECT * FROM relationship_interactions WHERE uid = ?').bind(id).first<Interaction>())!);
}

export async function introRequests(env: Env, user: User) {
  const rows = (await env.DB.prepare(
    `SELECT * FROM relationship_interactions WHERE (requester_user_id = ? OR teammate_user_id = ?) AND kind = 'intro_requested'
      ORDER BY created_at DESC, id DESC LIMIT 100`,
  ).bind(user.id, user.id).all<Interaction>()).results || [];
  return {
    sent: rows.filter((r) => r.requester_user_id === user.id).map(interactionView),
    received: rows.filter((r) => r.teammate_user_id === user.id).map(interactionView),
  };
}

/** The teammate's answer: made or declined. Only they decide, and once. */
export async function decideIntro(env: Env, user: User, requestUid: string, decision: unknown) {
  if (decision !== 'made' && decision !== 'declined') throw new RelationshipRefusal(400, 'decision_invalid', 'Choose made or declined.');
  if (!/^[a-f0-9]{32}$/.test(requestUid)) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  const at = now();
  const r = await env.DB.prepare(
    "UPDATE relationship_interactions SET status = ?, decided_at = ? WHERE uid = ? AND teammate_user_id = ? AND kind = 'intro_requested' AND status = 'pending'",
  ).bind(decision, at, requestUid, user.id).run();
  if (!(r.meta?.changes ?? 0)) {
    const exists = await env.DB.prepare('SELECT 1 FROM relationship_interactions WHERE uid = ? AND teammate_user_id = ?').bind(requestUid, user.id).first();
    throw exists ? new RelationshipRefusal(409, 'decided', 'This request has already been answered.') : new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  }
  const ask = (await env.DB.prepare('SELECT * FROM relationship_interactions WHERE uid = ?').bind(requestUid).first<Interaction & { contact_id: number | null; person_key: string | null }>())!;
  await env.DB.prepare(
    `INSERT INTO relationship_interactions (uid, kind, requester_user_id, teammate_user_id, team_key, contact_id, person_key, person_name, person_company, status, parent_uid, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid(), decision === 'made' ? 'intro_made' : 'intro_declined', ask.requester_user_id, user.id, ask.team_key, ask.contact_id, ask.person_key,
    ask.person_name, ask.person_company, decision, requestUid, at).run();
  await audit(env, user.id, ask.requester_user_id, 'access', `intro_${decision}:${requestUid}`);
  await notify(env, {
    userId: ask.requester_user_id, type: 'relationship_intro_answered', category: 'mentions',
    title: decision === 'made' ? 'Your introduction was made' : 'Your introduction request was declined',
    body: `${ask.person_name}${ask.person_company ? `, ${ask.person_company}` : ''}.`, link: `/network/relationships?intro=${requestUid}`, payload: { uid: requestUid },
  }).catch(() => null);
  return interactionView((await env.DB.prepare('SELECT * FROM relationship_interactions WHERE uid = ?').bind(requestUid).first<Interaction>())!);
}

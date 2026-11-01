/**
 * D1497 (#3727) — the Team page's words and every derivation from its reads,
 * kept pure so the tests read them without a browser.
 *
 * WHAT IS READ (wired today):
 *   - `GET /api/company/:uid` (company.ts `detailDto`) → People, company form;
 *   - `GET /api/company/:uid/invitations` (an editor's) → Invitations;
 *   - `GET /api/company/team-vocabulary` → the title ladder and what each
 *     authority level means: the tooltips and the invite's suggestion are its
 *     words, never written here;
 *   - `GET /api/projects/:id` and `/members` → People and Invitations,
 *     project form; `GET /api/account/projects` → its company's uid and name;
 *   - `GET /api/account/people/search` (#3841) → the accounts an Invite can
 *     link by name: `{ uid, name, avatar_url, shared }`, never an email.
 * The people and invitation clients are `teamsApi` (`lib/api/teams.js`, #3841).
 * Agents, rule books, approvals and agent settings come through
 * `agentsAdapter.js`: the registry and rule books on #3840's routes
 * (`teamAgentsApi`), approvals, runs and tools unavailable until #3842–#3844.
 *
 * THREE RULES the tests hold:
 *   - another member's email is never drawn; your own may be (since #3841 the
 *     Worker sends only yours, and the model still keeps it on your row only);
 *   - "Not recorded" is never a zero: an unread count, spend or time is the
 *     muted words, and a count that cannot be read draws no badge;
 *   - a refusal reaches the page in words, never as its code.
 */
import { NOT_RECORDED } from '../../lib/absence.js';
import { day, roleWord, seatWord } from '../account/companies/companiesModel.js';

export { NOT_RECORDED };

// ---------------------------------------------------------------- the page

export const TABS = [
  { key: 'people', label: 'People and agents' },
  { key: 'skills', label: 'Skills' },
  { key: 'roles', label: 'Roles and rule books' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'settings', label: 'Settings' },
];
const TAB_KEYS = new Set(TABS.map((t) => t.key));
/** The tab an address opens: `?tab=`, else People and agents. */
export function tabFrom(search = '') {
  const t = new URLSearchParams(String(search).replace(/^\?/, '')).get('tab');
  return TAB_KEYS.has(t) ? t : 'people';
}

export const TITLE = 'Team';
export const purposeLine = (name) => `The people and AI agents working on ${name}. Agents propose; people decide.`;
export const AGENTS_FOOT = 'Agents propose; a named person accepts. Nothing is written without Accept.';
export const ROSTER_LINE = 'The company’s roster, including people without an account, is on Build › Team.';

/**
 * Whether the company's editors already manage a project under it. It is the
 * owner's rule (#3697), and the Worker's `isProjectManager` gains its company
 * branch in #3697 part 2; until then the page says only what is true.
 */
export const COMPANY_AUTHORITY_LIVE = false;

/** The note under a project-in-a-company's title (TM1b, TM1f). */
/** The agents card's footer: the company's reach is named only once it is live. */
export function agentsFootLine(companyName, live = COMPANY_AUTHORITY_LIVE) {
  return live
    ? `Company editors manage the agents of every project under ${companyName}. Agents propose; a named person accepts.`
    : AGENTS_FOOT;
}

export function managedNote(company, live = COMPANY_AUTHORITY_LIVE) {
  return live
    ? `Managed under ${company}'s authority. Company editors can manage this team and its agents.`
    : `This project sits under ${company}. Its own Owner manages this team today.`;
}

/** TM9a3: a member without editor rights. The owner's list of editors, in full. */
export function readOnlyLine(kind) {
  return kind === 'company'
    ? 'You can see the team. Only its editors invite or change people: an Owner, Admin or Founder, the primary admin, or an Axal VC admin.'
    : 'You can see the team. Only the project’s Owner invites or changes people.';
}

// ---------------------------------------------------------------- people

export const COMPANY_ROLES = ['Owner', 'Admin', 'Founder', 'Member'];
export const COMPANY_ROLE_HELP = 'Owner, Admin, Founder or Member. Owners, Admins and Founders can change the team.';
export const AUTHORITY_KEYS = ['VIEW', 'WORK', 'FLAG', 'SPONSOR', 'VOTE'];
export const authorityWord = (a) => (a ? roleWord(String(a).toLowerCase()) : null);

/** `{ VIEW: 'Sees the pipeline…', … }` from the vocabulary read; empty when it was not read. */
export function meanings(vocab) {
  const out = {};
  for (const l of Array.isArray(vocab?.authority_levels) ? vocab.authority_levels : []) out[String(l.key).toUpperCase()] = l.meaning;
  return out;
}

/** An authority pill's tooltip: "Vote: Decides. The only level that does.", in the vocabulary's words. */
export function authorityTip(a, vocab) {
  const word = authorityWord(a);
  if (!word) return undefined;
  const m = meanings(vocab)[String(a).toUpperCase()];
  return m ? `${word}: ${m}` : word;
}

/** The ladder's suggestion for a title: `{ authority, line }`, or null. */
export function suggestedAuthority(title, vocab) {
  const rung = (Array.isArray(vocab?.ladder) ? vocab.ladder : []).find((r) => r.title === title);
  if (!rung?.defaultAuthority) return null;
  return { authority: rung.defaultAuthority, line: `Suggested for ${title}: ${authorityWord(rung.defaultAuthority)}. You can choose another.` };
}

export function initials(name) {
  const parts = String(name || '').replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * People from `GET /api/company/:uid`. `email` is kept on your own row only:
 * the Worker sends every member's address to every member today, and the
 * owner's rule is that the page never draws another's.
 */
export function peopleFromCompany(detail, meId, vocab) {
  const members = Array.isArray(detail?.members) ? detail.members : [];
  const primaries = members.filter((m) => m.is_primary_admin).length;
  return members.map((m) => {
    const you = meId != null && Number(m.user_id) === Number(meId);
    const recorded = String(m.name || '').trim();
    return {
      key: `u-${m.user_id}`,
      userId: m.user_id,
      // `name` stays a string for the dialogs' sentences; `unnamed` draws it muted.
      name: recorded || NOT_RECORDED,
      unnamed: !recorded,
      initials: initials(m.name),
      you,
      email: you ? (m.email || null) : null,
      role: m.is_primary_admin && !m.role_in_company ? 'Owner' : (m.role_in_company ? roleWord(m.role_in_company) : null),
      roleKey: m.role_in_company || null,
      primary: !!m.is_primary_admin,
      // The Worker refuses to remove the only primary admin: no Remove is offered there.
      removable: !(m.is_primary_admin && primaries <= 1),
      title: m.title || null,
      authority: authorityWord(m.authority),
      authorityTip: authorityTip(m.authority, vocab),
      status: 'Active',
      joined: day(m.joined_at, { year: false }),
    };
  });
}

/**
 * People from `GET /api/projects/:id/members`. A project seat has no title or
 * authority store, so both are "Not recorded", never a guess.
 */
export function peopleFromProject(read, meId) {
  const members = Array.isArray(read?.members) ? read.members : [];
  return members.map((m) => {
    const you = meId != null && Number(m.user_id) === Number(meId);
    const recorded = String(m.name || '').trim();
    return {
      key: `u-${m.user_id}`,
      userId: m.user_id,
      name: recorded || NOT_RECORDED,
      unnamed: !recorded,
      initials: initials(m.name),
      you,
      email: you ? (m.email || null) : null,
      role: m.role ? seatWord(m.role) : null,
      roleKey: m.role || null,
      // A project's Owner is never removed (the Worker refuses it).
      removable: m.role !== 'owner',
      title: null,
      authority: null,
      authorityTip: undefined,
      status: 'Active',
      joined: day(m.accepted_at || m.created_at, { year: false }),
    };
  });
}

const DAY_MS = 86_400_000;
const stamp = (iso) => {
  const s = String(iso || '');
  const t = Date.parse(s.replace(' ', 'T') + (/[zZ+]/.test(s.slice(10)) ? '' : 'Z'));
  return Number.isFinite(t) ? t : null;
};
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * TM2c: the member who joined through an invitation accepted in the last
 * seven days, matched by the invitation's address. The address is only
 * compared, never drawn. Null when no such invitation was read.
 */
export function freshMemberKey(detail, invitations, now = new Date()) {
  const accepted = (Array.isArray(invitations) ? invitations : [])
    .filter((i) => String(i?.status || '').toLowerCase() === 'accepted' && stamp(i.accepted_at) != null && now.getTime() - stamp(i.accepted_at) < 7 * DAY_MS)
    .sort((a, b) => stamp(b.accepted_at) - stamp(a.accepted_at));
  for (const i of accepted) {
    const m = (Array.isArray(detail?.members) ? detail.members : []).find((x) => x.email && String(x.email).toLowerCase() === String(i.email || '').toLowerCase());
    if (m) return `u-${m.user_id}`;
  }
  return null;
}

/** "31 Oct 09:12" from a stamp; null when there is none. */
export function dayTime(iso) {
  const d = day(iso, { year: false });
  if (!d) return null;
  const m = /[T ](\d{2}):(\d{2})/.exec(String(iso));
  return m ? `${d} ${m[1]}:${m[2]}` : d;
}

/** "a•••@example.com". Invitation addresses are drawn masked, as the canvas draws them (owner question T3). */
export function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at < 1) return s ? '•••' : NOT_RECORDED;
  return `${s[0]}•••${s.slice(at)}`;
}

// ---------------------------------------------------------------- invitations (TM2c)

const past = (iso, now) => {
  const t = Date.parse(String(iso || '').replace(' ', 'T') + (/[zZ+]/.test(String(iso || '').slice(10)) ? '' : 'Z'));
  return Number.isFinite(t) && t < now.getTime();
};

/**
 * When the live link was sent. Resend (company.ts) issues a new token and
 * restarts the 14 days, so the current link went out 14 days before
 * `expires_at`; `updated_at` is used when the invitation read carries it.
 */
export function lastSent(i) {
  const created = stamp(i?.created_at);
  const exp = stamp(i?.expires_at);
  const fromExpiry = exp != null ? exp - 14 * DAY_MS : null;
  const updated = stamp(i?.updated_at);
  const t = updated != null ? updated : fromExpiry;
  return { created, at: t != null && created != null && t - created > 60_000 ? t : created };
}

/** Whether a pending invitation was resent: its live link is newer than the first one. */
export function wasResent(i) {
  if (String(i?.status || 'pending').toLowerCase() !== 'pending') return false;
  const { created, at } = lastSent(i);
  return created != null && at != null && at > created;
}

/** Pending, Resent, Expired, Revoked or Accepted, with its pill tone and the actions it allows. */
export function invitationState(i, now = new Date()) {
  const status = String(i?.status || 'pending').toLowerCase();
  if (status === 'accepted') return { key: 'accepted', label: `Accepted ${day(i.accepted_at, { year: false }) || ''}`.trim(), tone: 'ok', note: 'Moved to People as Active.', resend: false, revoke: false };
  if (status === 'revoked') return { key: 'revoked', label: `Revoked ${day(i.updated_at || i.revoked_at, { year: false }) || ''}`.trim(), tone: 'neutral', muted: true, resend: false, revoke: false };
  if (status === 'expired' || (status === 'pending' && past(i.expires_at, now))) {
    return { key: 'expired', label: `Expired ${day(i.expires_at, { year: false }) || ''}`.trim(), tone: 'neutral', resend: true, revoke: false };
  }
  // Resent and mailed: the new link reached them. Resent with no mail: the old
  // link is dead and the new one was handed to the editor once, so the row is
  // Pending with "email not sent", never "Resent".
  if (wasResent(i) && i.email_sent) return { key: 'resent', label: 'Resent', tone: 'info', note: 'A new link was sent; the old one no longer works.', resend: true, revoke: true };
  return { key: 'pending', label: 'Pending', tone: 'neutral', resend: true, revoke: true };
}

/** A company invitation's line: "a•••@example.com · sent 28 Oct · expires 11 Nov · email sent". */
export function companyInvitationLine(i) {
  const live = !['accepted', 'revoked'].includes(String(i?.status || '').toLowerCase());
  const resent = wasResent(i);
  const sentDay = resent ? day(isoDay(lastSent(i).at), { year: false }) : day(i.created_at, { year: false });
  return [
    maskEmail(i.email),
    sentDay ? `${resent ? 'resent' : 'sent'} ${sentDay}` : null,
    live && i.expires_at ? `expires ${day(i.expires_at, { year: false })}` : null,
    live ? (i.email_sent ? 'email sent' : 'email not sent') : null,
  ].filter(Boolean).join(' · ');
}

const SOURCES = { email: 'Email', link: 'Link', cofounder_match: 'Co-founder match', user_id: 'Account', account: 'Account' };
export const sourceWord = (s) => SOURCES[s] || (s ? roleWord(s) : NOT_RECORDED);

/** A project invitation as a manager reads it (TM1b), from the members read's `invitations`. */
export function projectInvitationRow(i) {
  const seat = seatWord(i.role);
  const created = day(i.created_at, { year: false });
  const expires = day(i.expires_at, { year: false });
  const line = i.source === 'link'
    ? ['Link invitation', seat, created ? `created ${created}` : null, expires ? `expires ${expires}` : null]
    : [i.invitee_email ? maskEmail(i.invitee_email) : 'An Axal VC account', seat, created ? `sent ${created}` : null, expires ? `expires ${expires}` : null];
  return { key: `pi-${i.id}`, id: i.id, source: sourceWord(i.source), sourceKey: i.source, line: line.filter(Boolean).join(' · ') };
}

export const LINK_ONCE = 'A link invitation is shown once, when it is created.';

/**
 * What a project Resend (#3841, `POST /api/projects/:id/invitations/:invId/resend`)
 * did, in words. A new token and 14 new days either way; the old link is dead.
 * `email_sent` is true or false for an email invitation and null for an
 * account's, which is answered from their Account › Invitations.
 */
export function projectResentWords(out) {
  const sent = out?.invitation ? out.invitation.email_sent : out?.email_sent;
  if (sent === true) return 'The invitation was resent. The old link no longer works.';
  if (sent === false) return 'A new link was made and the old one no longer works, but the email did not send. Resend again, or revoke it and invite again.';
  return 'The invitation was renewed for 14 days. It waits in their Account › Invitations.';
}

// ---------------------------------------------------------------- linking an account (TM2b, #3841)

/** The Worker's `SEARCH_MIN` (services/peopleReach.ts): fewer letters answer 400 query_too_short. */
export const SEARCH_MIN = 2;
/** How long typing rests before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_HINT = 'Only people who share a company or a co-founder match with you appear. Their email stays hidden.';
export const SEARCH_SHORT = `Type at least ${SEARCH_MIN} letters of a name.`;

/** What one search result shares with you: "Shares [Northwind Labs] · Co-founder match". Never an email or an id. */
export function sharedLine(person) {
  const words = (Array.isArray(person?.shared) ? person.shared : [])
    .map((s) => (s?.kind === 'company' ? (s.name ? `Shares ${s.name}` : 'Shares a company') : s?.name || 'A connection'))
    .filter(Boolean);
  return words.length ? words.join(' · ') : null;
}

/** An account invitation's refusal (`mode: 'account'`), in words about the person, not an address. */
export function accountRefusalWords(e) {
  switch (e?.code || e?.data?.code || null) {
    case 'account_not_found': return 'That account no longer exists. Search again.';
    case 'not_reachable': return 'You can invite only people you share a company or a co-founder match with.';
    case 'already_member': return 'They are already on this team.';
    case 'already_pending': return 'An invitation to them is already waiting. Nothing was sent.';
    default: return errorWords(e);
  }
}
export const INVITE_NOTE = 'The invitation lasts 14 days. One pending invitation per address.';

// ---------------------------------------------------------------- refusals

/** A Worker refusal in the page's words. The code itself never reaches the markup. */
export function refusalWords(code, detail) {
  switch (code) {
    case 'module_not_allowed': return `Not in its modules${detail ? `: ${detail}` : ''}`;
    case 'option_not_allowed': return 'This kind of proposal isn’t in its rule book';
    case 'plan_required': return 'AI agents come with a paid Founder plan.';
    case 'not_manager': case 'not_member': return 'Only this team’s editors can do this.';
    case 'role_taken': return 'An agent already holds this role here. One agent per role.';
    case 'model_not_offered': return 'That model is not offered on your plan.';
    case 'tool_not_approved': return 'That tool is not one you approved for read-only use.';
    case 'rule_floor': return `This change can’t be saved. ${detail ? `${detail} always needs a person.` : 'These seven always need a person.'}`;
    case 'auto_floor': return 'This change can’t be saved. Nothing is automatic in v1.';
    case 'invalid_rules': return `This change can’t be saved. ${detail ? `Check ${detail}.` : 'Check each section.'}`;
    case 'rulebook_changed': return 'Someone saved this rule book a moment ago. Reload it and try again.';
    case 'invalid_cap': return 'The monthly cap must be more than $0.';
    case 'invalid_name': return 'A name is at most 40 characters.';
    case 'invalid_role': return 'Choose one of the roles.';
    case 'removed': return 'This agent was removed.';
    case 'agent_cap_reached': return 'Reached its monthly cap';
    case 'agent_paused': return 'This agent is paused.';
    case 'not_open': return `Already decided${detail ? ` by ${detail}` : ''}.`;
    case 'already_pending': return 'An invitation to that address is already waiting. Nothing was sent.';
    case 'already_member': return 'That address is already on this team.';
    case 'team_locked': return detail || 'Co-founder and advisor invites are locked for now.';
    case 'not_pending': return 'This invitation was already answered or revoked.';
    default: return 'It could not be saved. Try again.';
  }
}

/** A thrown client error, in words: a known code first, then the Worker's own sentence. */
export function errorWords(e) {
  const code = e?.code || e?.data?.code || null;
  if (code && refusalWords(code) !== refusalWords('')) return refusalWords(code, code === 'team_locked' ? e?.message : undefined);
  if (e?.status === 409 && /already a member/i.test(String(e?.message || ''))) return refusalWords('already_member');
  return e?.message || refusalWords('');
}

// ---------------------------------------------------------------- agents

/** The floor every rule book keeps (#3840's hard floor). Policy text, not data. */
export const FLOOR = [
  ['payment', 'Payments'], ['sign', 'Signing'], ['file', 'Filing'], ['cap_table_write', 'Cap table writes'],
  ['send_email', 'Sending an email'], ['send_post', 'Publishing a post'], ['invite_person', 'Inviting a person'],
];
export const FLOOR_NOTE = 'Required by Axal VC. Agents never do these without a named person.';
/** TM4c: the floor as the Edit sheet words it. */
export const FLOOR_EDIT_NOTE = 'Required by Axal VC. These seven stay, whatever else you change.';
export const FLOOR_TIP = 'Required by Axal VC. It cannot be removed.';
export const AUTO_NOTE = 'Nothing is automatic in v1.';
export const RULEBOOK_SECTIONS = [
  ['mission', 'Mission'], ['works_in', 'Works in'], ['reads', 'Reads'], ['may_propose', 'May propose'],
  ['may_do_automatically', 'May do automatically'], ['always_asks_human', 'Always asks a human'],
  ['escalates_when', 'Escalates when'], ['kpis', 'KPIs'], ['tone', 'Tone'],
];
export const WHO_PAYS = 'Agents run as their sponsor and are paid from the sponsor’s AI tokens, capped per agent.';
export const HOLD_LINE = (amount) => `Holds up to ${amount} · you pay what it uses`;

/**
 * TM8a "Who may add agents", in the owner's rule for each scope. The company's
 * reach over its projects is said only once it is live (`COMPANY_AUTHORITY_LIVE`,
 * #3697 part 2), as `managedNote` says it.
 */
export function whoMayAddAgents(kind, company, live = COMPANY_AUTHORITY_LIVE) {
  if (kind === 'project') return 'Its Owner. A standalone project governs itself.';
  const editors = 'Company editors: an Owner, Admin or Founder, the primary admin, and Axal VC admins.';
  if (kind === 'company_project') {
    const who = company ? `${company}’s editors` : 'The company’s editors';
    return live ? `${who} and the project’s Owner. ${editors}` : `The project’s Owner manages its team today. It sits under ${company || 'its company'}.`;
  }
  return live ? `${editors} They also manage the agents of every project under the company.` : editors;
}

/** "$3.84" from micro-dollars; "$25" for a whole cap. Null stays null. */
export function money(micro, { whole = false } = {}) {
  if (micro == null || !Number.isFinite(Number(micro))) return null;
  const d = Number(micro) / 1e6;
  return whole && Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** "$3.84 of $25 this month", built from the parts that exist; null when the spend was not read. */
export function budgetLine(usedMicro, capMicro, tail = ' this month') {
  const used = money(usedMicro);
  if (!used) return null;
  const cap = money(capMicro, { whole: true });
  return `${used}${cap ? ` of ${cap}` : ''}${tail}`;
}

/** This month's spend: "$3.84 of $25 cap", or "Not recorded" when the read did not answer. Never "$0". */
export function spendLine(a) {
  const s = a?.month_spend;
  const cap = money(a?.monthly_cap_microusd, { whole: true });
  if (!s || !s.available || s.value_microusd == null) return null;
  return cap ? `${money(s.value_microusd)} of ${cap} cap` : money(s.value_microusd);
}

const MIN = 60_000;
/** "2 h ago", "Yesterday", "3 d ago"; null (drawn as Not recorded) when there is no event. */
export function ago(iso, now = new Date()) {
  if (!iso) return null;
  const t = Date.parse(String(iso).replace(' ', 'T') + (/[zZ+]/.test(String(iso).slice(10)) ? '' : 'Z'));
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.round((now.getTime() - t) / MIN));
  if (m < 60) return `${m || 1} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  if (m < 48 * 60) return 'Yesterday';
  return `${Math.round(m / (24 * 60))} d ago`;
}

const EVENTS = {
  added: () => 'Added',
  paused: () => 'Paused',
  resumed: () => 'Resumed',
  removed: (d) => (Number(d?.proposals_withdrawn) > 0 ? `Removed; ${countWord(Number(d.proposals_withdrawn), 'open proposal')} withdrawn` : 'Removed'),
  cap_changed: (d) => {
    const from = money(d?.from_microusd, { whole: true });
    const to = money(d?.to_microusd, { whole: true });
    return to ? `Cap changed${from ? ` from ${from}` : ''} to ${to}` : 'Cap changed';
  },
  rulebook_changed: (d) => (Number.isFinite(Number(d?.version)) && d?.version != null ? `Rule book saved as v${d.version}` : 'Rule book saved'),
  run: () => 'Ran',
  refused: () => 'A run was refused',
};
/**
 * One profile event (#3840's `{ kind, actor: { uid, name } | null, at, detail }`)
 * in words: "Cap changed from $10 to $25 by Avery Stone". The kind is a code
 * and never reaches the page; an actor with no recorded name is "Not recorded".
 */
export function eventWords(e) {
  if (e?.text) return e.text;
  const what = (EVENTS[e?.kind] || (() => 'Changed'))(e?.detail);
  if (!e?.actor) return what;
  const who = String(e.actor.name || '').trim() || NOT_RECORDED;
  return `${what} by ${who}`;
}

export const agentName = (a) => [a?.first_name, a?.last_name].map((s) => String(s || '').trim()).filter(Boolean).join(' ') || a?.role_name || 'Unnamed agent';

const PAUSE = {
  manual: (a) => ({ reason: a?.paused_by?.name ? `Paused by ${a.paused_by.name}` : 'Paused by a person', fix: 'Resume' }),
  cap: (a) => {
    const on = day(a?.resumes_at, { year: false });
    return { reason: `Reached its monthly cap${on ? `. Resumes ${on}.` : ''}`, fix: 'Raise the cap' };
  },
  sponsor_left: () => ({ reason: 'Its sponsor no longer manages this company', fix: 'Choose a new sponsor' }),
  tool_disconnected: (a) => {
    const server = a?.paused_server?.name || a?.paused_tool?.server_name || a?.paused_tool?.name || null;
    return { reason: server ? `A connected tool was disconnected: ${server} is disconnected` : 'A connected tool was disconnected', fix: 'Reconnect' };
  },
  ai_paused: () => ({ reason: 'Eadwyn is paused for this account', fix: null }),
};
/** Why an agent is paused, and the one link that fixes it (TM9b). */
export function pauseWords(a) {
  if (a?.status !== 'paused') return null;
  return (PAUSE[a.paused_reason] || (() => ({ reason: 'Paused', fix: null })))(a);
}

/** One agent row as the table draws it. */
export function agentRow(a, now = new Date()) {
  const tools = Array.isArray(a?.tools) ? a.tools : [];
  const servers = [...new Set(tools.map((t) => t.server_name || t.integration_name).filter(Boolean))];
  return {
    key: a.uid,
    uid: a.uid,
    name: agentName(a),
    role: a.role_name || null,
    roleOrUnrecorded: a.role_name || NOT_RECORDED,
    // The model's own name; null is drawn as the muted "Not recorded".
    model: a.model_label || a.model_id || null,
    tools: tools.length ? `+ ${tools.length} read-only tool${tools.length === 1 ? '' : 's'}${servers.length ? ` from ${servers.join(', ')}` : ''}` : null,
    sponsor: a.sponsor?.name || null,
    status: a.status === 'paused' ? 'Paused' : 'Active',
    pause: pauseWords(a),
    spend: spendLine(a),
    last: ago(a.last_activity_at, now),
    project: a.project || null,
  };
}

/**
 * TM1e: the company's own agents, then each project's under its name. The
 * filter keys are 'company' and `p-<id>`; every group is on by default.
 */
export function agentGroups(agents, companyName, now = new Date()) {
  const list = Array.isArray(agents) ? agents : [];
  const own = list.filter((a) => !a.project);
  const groups = [{ key: 'company', label: 'This company', title: 'This company', line: `${companyName} · ${countWord(own.length, 'agent')}`, rows: own.map((a) => agentRow(a, now)) }];
  const byProject = new Map();
  for (const a of list.filter((x) => x.project)) {
    const k = `p-${a.project.id}`;
    if (!byProject.has(k)) byProject.set(k, { key: k, label: a.project.name, title: a.project.name, rows: [] });
    byProject.get(k).rows.push(agentRow(a, now));
  }
  for (const g of byProject.values()) groups.push({ ...g, line: `Project · ${countWord(g.rows.length, 'agent')}` });
  return groups;
}

/** TM3a: "A CFO", "A research analyst" — who already holds a role, with the article it needs. */
const HELD_LABEL = { ceo: 'A CEO', cfo: 'A CFO', coo: 'A COO', cmo: 'A CMO', cto: 'A CTO', cpo: 'A CPO' };
export function heldLabel(role) {
  if (role?.held_label) return role.held_label;
  const key = String(role?.key || '').toLowerCase();
  if (HELD_LABEL[key]) return HELD_LABEL[key];
  const short = String(role?.name || '').split('/')[0].trim();
  if (!short) return 'An agent in this role';
  const word = /^[A-Z]{2,}$/.test(short.split(' ')[0]) ? short : short.charAt(0).toLowerCase() + short.slice(1);
  return `${/^[aeiou]/i.test(word) && !/^(eu|uni|use)/i.test(word) ? 'An' : 'A'} ${word}`;
}

export const countWord = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A count badge from a block: the number when it was read, else nothing at all (never "0"). */
export function countBadge(block) {
  if (!block || block.available !== true) return null;
  const n = Number(block.value);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

// ---------------------------------------------------------------- moving a project (TM1g2, TM1h)

/** "You are its Owner" / "You are a Member there…" for a company in the Move sheet. */
export function moveTarget(c) {
  const role = String(c?.my_role || '').trim();
  const editor = !!c?.is_primary_admin || ['owner', 'admin', 'founder'].includes(role.toLowerCase());
  return {
    id: c?.id, uid: c?.uid, name: String(c?.company_name || '').trim() || NOT_RECORDED,
    editor,
    line: editor ? `You are its ${c?.is_primary_admin && !role ? 'primary admin' : roleWord(role)}` : `You are a ${roleWord(role || 'member')} there. Only its editors can take in a project.`,
  };
}

/**
 * What moving says before it moves. Only what the Worker does today: the
 * company editors' authority over a project's team and the agents that stop
 * when it leaves are the owner's rule, live once #3697 part 2 and #3840 are.
 */
export function moveUnderLines(company, live = COMPANY_AUTHORITY_LIVE) {
  return live
    ? [`${company}'s editors will manage this project, its team and its agents.`, 'It takes effect at once.']
    : [`It will sit under ${company}, and show only under that company.`, 'It takes effect at once.'];
}

export function moveOutCopy(project, company, live = COMPANY_AUTHORITY_LIVE) {
  return {
    title: `Move ${project} out of ${company}?`,
    body: live
      ? ['It becomes a standalone project managed by its Owner.', `${company}'s editors lose access now.`, 'Agents added by the company stop; their open proposals stay decidable.', 'Project agents keep working.']
      : ['It becomes a standalone project managed by its Owner.', `It no longer shows under ${company}.`],
    button: 'Move out', cancel: 'Cancel', danger: true,
  };
}

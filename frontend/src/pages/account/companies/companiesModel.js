/**
 * D1134 (#2422), completed by D1138 (#3018) — Account › Companies and
 * projects: the words, the tabs and every derivation from the reads, kept
 * pure so the tests read them without a browser.
 *
 * WHAT IS READ, AND FROM WHERE (D1138 §2):
 *   - `GET /api/account/companies` (D1136) → Companies: one card per company,
 *     each figure its own block (`{ available, value }` or `{ available:
 *     false, reason }`), so a failed count is "could not be read", never 0;
 *   - `GET /api/account/projects` (D1136) → Projects: the caller's own and
 *     seated ventures, for every profile, never every venture;
 *   - `GET /api/account/invitations` (D1136) → Invitations to you;
 *   - `GET /api/funds` → an investor's Funds (the funds each firm runs);
 *   - `GET /api/advisor-grants/shared/list` → an advisor's Engagements.
 *
 * ACTIVE ON THIS DEVICE. The active company lives in this browser only
 * (`active_company_id`); the switcher's context carries it. The page says so.
 *
 * PART 5 (D1139, #3019). The company lightbox at `/account/companies/<uid>`
 * (CMP2), the venture lightbox (CMP4, CMP4b) and the lifecycle dialogs
 * (CMP6–CMP8): their words and who may do what are below, under "lifecycle".
 * Archived waits on part 3's read (#3017).
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const SECTION = 'companies';
export const TITLE = 'Companies and projects';
export const LINE = 'Every company you belong to, the ventures inside each, and who works on them.';
export const ACTIVE_HERE = 'Active on this device';
export const ACTIVE_LINE = 'The company marked Active is the one every page reads on this device. Switch it in the sidebar.';
export const SHARED_LINE = 'Projects, deals, funds and quotes belong to the company selected. Marketplaces and your account settings are shared across your companies.';
export const ADMIN_LINE = 'Switching company does not narrow what you see as an admin. Your studio’s reach comes from its licence.';
export const EXPLORER_LINE = 'Creating a company opens once your profile is set.';
export const ADVISOR_LINE = 'Practice and Expertise are not yet separated by company.';

/** Every tab, each at its own address. Which a profile sees is `tabsFor`. */
export const TAB_PATHS = {
  companies: '/account/companies',
  projects: '/account/companies/projects',
  funds: '/account/companies/funds',
  engagements: '/account/companies/engagements',
  invitations: '/account/companies/invitations',
};
export const TAB_LABELS = { companies: 'Companies', projects: 'Projects', funds: 'Funds', engagements: 'Engagements', invitations: 'Invitations' };

/**
 * The profile a member's board is drawn for (CMP1, CMP9–CMP13). A Super Admin
 * is HQ; an Operating Partner's role is `partner`; an Explorer's `exploring`.
 */
export function profileOf(role, superAdmin = false) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return superAdmin ? 'hq' : 'admin';
  if (r === 'exploring') return 'explorer';
  return ['founder', 'investor', 'partner', 'advisor'].includes(r) ? r : 'founder';
}

const PROFILE_TABS = {
  founder: ['companies', 'projects', 'invitations'],
  partner: ['companies', 'projects', 'invitations'],
  investor: ['companies', 'funds', 'invitations'],
  advisor: ['companies', 'engagements', 'invitations'],
  explorer: ['companies', 'invitations'],
  admin: ['companies', 'invitations'],
  hq: ['companies', 'invitations'],
};
export const tabsFor = (profile) => PROFILE_TABS[profile] || PROFILE_TABS.founder;

/** Which tab an address opens: its segment when it is a tab, else Companies. */
export function companiesTabFor(pathname = '') {
  const m = String(pathname).match(/^\/(?:account|settings)\/companies\/([^/?#]+)\/?$/);
  const tab = m && m[1].toLowerCase();
  return tab && TAB_PATHS[tab] ? tab : 'companies';
}
export const companiesPathFor = (tab) => TAB_PATHS[tab] || TAB_PATHS.companies;

/**
 * D1139 — `/account/companies/<uid>` opens that company's lightbox (CMP2): a
 * segment that is not a tab is a company uid. Anything else is null.
 */
export function companyUidFor(pathname = '') {
  const m = String(pathname).match(/^\/(?:account|settings)\/companies\/([A-Za-z0-9_-]{1,64})\/?$/);
  return m && !TAB_PATHS[m[1].toLowerCase()] ? m[1] : null;
}
export const companyPathFor = (uid) => `/account/companies/${encodeURIComponent(uid)}`;

/** Whether a profile may create a company (D1135: an Explorer may not). */
export const canCreate = (profile) => profile !== 'explorer';

// ---------------------------------------------------------------- words

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "3 Oct 2026" from an ISO date or stamp; anything else is null. */
export function day(s, { year = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return `${Number(m[3])} ${M[Number(m[2]) - 1]}${year ? ` ${m[1]}` : ''}`;
}

const CYCLE_WORDS = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };
const STAGE = { idea: 'Idea', validation: 'Validation', mvp: 'MVP', growth: 'Growth', scale: 'Scale', seed: 'Seed', 'pre-seed': 'Pre-seed', series_a: 'Series A' };
const SEATS = { owner: 'Owner', cofounder: 'Co-founder', advisor: 'Advisor' };
export const stageWord = (s) => (s ? STAGE[String(s).toLowerCase()] || String(s) : null);
export const seatWord = (s) => SEATS[s] || (s ? String(s) : NOT_RECORDED);
export const roleWord = (r) => (r ? String(r).charAt(0).toUpperCase() + String(r).slice(1).replace(/_/g, ' ') : NOT_RECORDED);

/** A D1136 block's value, or a sentence for what could not be read. */
const value = (block) => (block && block.available ? { ok: true, value: block.value } : { ok: false, reason: block?.reason || 'could not be read' });

/** The cycles in use, in words; an unread list is never "none". */
export function cyclesLine(block) {
  const v = block && 'available' in block ? value(block) : { ok: Array.isArray(block), value: block };
  if (!v.ok || v.value == null) return 'Cycles: could not be read';
  if (!v.value.length) return 'No cycle in use';
  return v.value.map((c) => CYCLE_WORDS[c] || String(c)).join(', ');
}

/** "4 members" from a count block; unread is "Members: could not be read". */
export function countLine(block, one, many) {
  const v = value(block);
  if (!v.ok) return `${many.charAt(0).toUpperCase() + many.slice(1)}: could not be read`;
  return `${v.value} ${v.value === 1 ? one : many}`;
}

// ---------------------------------------------------------------- companies (CMP1, CMP9, CMP10, CMP13)

function pendingLine(block) {
  if (!block) return null;
  const v = value(block);
  if (!v.ok) return 'Invitations: could not be read';
  return v.value ? `${v.value} invitation${v.value === 1 ? '' : 's'} pending` : null;
}

/**
 * One card per company from `GET /api/account/companies`, the active one
 * (this device's, by uid) first unless sorted otherwise. `known` is the
 * switcher's membership list, which carries the numeric id the funds read uses.
 */
export function companyCards(summary, { activeUid = null, known = [] } = {}) {
  const list = Array.isArray(summary?.companies) ? summary.companies : [];
  const idOf = new Map((known || []).map((c) => [c.uid, Number(c.id)]));
  return list.map((c) => {
    const last = value(c.last_opened);
    return {
      uid: c.uid,
      id: idOf.get(c.uid) ?? null,
      name: String(c.company_name || '').trim() || NOT_RECORDED,
      role: roleWord(c.my_role),
      authority: c.authority ? roleWord(c.authority) : null,
      title: c.title || null,
      primary: !!c.is_primary_admin,
      stage: stageWord(c.stage),
      members: countLine(c.member_count, 'member', 'members'),
      // An editor's only (D1136): absent for anyone else, so nothing is said.
      invitations: pendingLine(c.pending_invitations),
      cycles: cyclesLine(c.cycles_active),
      lastOpened: last.ok ? (day(last.value) || 'Not opened yet') : 'Could not be read',
      counts: Object.fromEntries(Object.entries(c.counts || {}).map(([k, b]) => [k, value(b).ok ? value(b).value : null])),
      active: activeUid != null && c.uid === activeUid,
    };
  });
}

/** Search, role filter and "active first" (CMP1's toolbar). */
export function filterCards(cards, { q = '', role = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return cards
    .filter((c) => (!needle || c.name.toLowerCase().includes(needle)) && (!role || c.role === role))
    .sort((a, b) => Number(b.active) - Number(a.active));
}

// ---------------------------------------------------------------- ventures (CMP3)

/**
 * The ventures from `GET /api/account/projects`, grouped: each of my
 * companies' ventures in the companies' order, then my ventures in no
 * company, then seats on ventures in a company I am not in.
 */
export function projectGroups(read, companies = []) {
  const list = Array.isArray(read?.projects) ? read.projects : [];
  const mine = (Array.isArray(companies) ? companies : []).map((c) => c.uid);
  const row = (p) => ({
    id: p.id, uid: p.uid,
    name: String(p.name || '').trim() || 'Untitled venture',
    stage: stageWord(p.stage) || NOT_RECORDED,
    week: p.playbook_week ? String(p.playbook_week).replace(/_/g, ' ') : null,
    seat: seatWord(p.my_seat),
    owner: p.my_seat === 'owner',
    members: countLine(p.member_count, 'member', 'members'),
    cycles: cyclesLine(p.cycles_active),
    company: p.company_name || null,
    companyUid: p.company_uid || null,
  });
  const groups = (Array.isArray(companies) ? companies : []).map((c) => ({
    key: `c-${c.uid}`, title: String(c.company_name || '').trim() || NOT_RECORDED,
    rows: list.filter((p) => p.company_uid === c.uid).map(row),
  })).filter((g) => g.rows.length);
  const loose = list.filter((p) => !p.company_uid && p.my_seat === 'owner').map(row);
  if (loose.length) groups.push({ key: 'none', title: 'Not in a company', rows: loose, foot: 'It shows under every company until you move it.' });
  const seats = list.filter((p) => (p.company_uid ? !mine.includes(p.company_uid) : p.my_seat !== 'owner')).map(row);
  if (seats.length) groups.push({ key: 'seats', title: 'Seats on other ventures', rows: seats, foot: 'It belongs to its owner’s company.' });
  return groups;
}

export function filterVentures(groups, { q = '', company = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return groups
    .filter((g) => !company || g.key === company)
    .map((g) => ({ ...g, rows: g.rows.filter((r) => !needle || r.name.toLowerCase().includes(needle)) }))
    .filter((g) => g.rows.length);
}

// ---------------------------------------------------------------- invitations (CMP5, CMP12)

/** Invitations to you, both kinds, newest first; each block failing alone. */
export function invitationRows(read) {
  const company = value(read?.company);
  const project = value(read?.project);
  const rows = [
    ...(company.ok ? company.value : []).map((i) => ({
      kind: 'company', key: `c-${i.uid}`, id: i.uid,
      title: `${i.company_name || NOT_RECORDED} · as ${roleWord(i.role_in_company)}${i.title ? ` · ${i.title}` : ''}`,
      from: `From ${i.invited_by_name || 'someone at the company'}`,
      sent: day(i.created_at), expires: day(i.expires_at, { year: false }), at: i.created_at,
      canAccept: true, canDecline: false,
      name: i.company_name || 'this company', seat: roleWord(i.role_in_company),
    })),
    ...(project.ok ? project.value : []).map((i) => ({
      kind: 'project', key: `p-${i.id}`, id: i.id,
      title: `${i.project_name || NOT_RECORDED} · as ${seatWord(i.role)}`,
      from: `From ${i.invited_by_name || 'the venture’s owner'}`,
      sent: day(i.created_at), expires: day(i.expires_at, { year: false }), at: i.created_at,
      canAccept: !!i.can_accept, canDecline: true,
      name: i.project_name || 'this venture', seat: seatWord(i.role),
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    rows,
    failed: [!company.ok && 'Company invitations', !project.ok && 'Venture invitations'].filter(Boolean),
  };
}

/** What accepting or declining tells the person, before they do it. */
export function answerCopy(row, answer) {
  if (answer === 'decline') return { title: `Decline the seat on ${row.name}?`, body: `You will not join ${row.name}. The owner can invite you again.`, button: 'Decline' };
  if (row.kind === 'company') {
    return { title: `Join ${row.name}?`, body: `You join ${row.name} as ${row.seat}. It appears in your company switcher; it does not become your active company.`, button: 'Accept and join' };
  }
  return { title: `Join ${row.name} as ${row.seat}?`, body: `You take the ${row.seat} seat on ${row.name}. It is listed under Projects.`, button: 'Accept' };
}

/** A refusal in words: D1136's codes, else the Worker's own sentence. */
export function refusalWords(e) {
  const code = e?.code || e?.data?.error;
  if (code === 'already_answered') return 'This invitation was answered a moment ago. Nothing changed.';
  if (code === 'expired') return 'This invitation has expired. Ask for a new one.';
  if (code === 'investor') return 'An investor account cannot take a seat on a venture team.';
  if (code === 'not_found') return 'This invitation is no longer yours to answer.';
  return e?.data?.message || e?.message || 'It could not be saved. Try again.';
}

// ---------------------------------------------------------------- funds (CMP9) and engagements (CMP11)

/** The funds each of my firms runs, then a fund with no firm. */
export function fundGroups(read, cards = []) {
  const items = Array.isArray(read?.items) ? read.items : Array.isArray(read) ? read : [];
  const fund = (f) => ({
    id: f.id, name: String(f.name || '').trim() || 'Unnamed fund',
    line: [f.vintage_year ? String(f.vintage_year) : null, f.status ? roleWord(f.status) : null].filter(Boolean).join(' · ') || NOT_RECORDED,
    canManage: !!f.can_manage,
  });
  const groups = cards.filter((c) => c.id != null).map((c) => ({
    key: c.uid, title: c.name, active: c.active,
    rows: items.filter((f) => f.company_id != null && Number(f.company_id) === c.id).map(fund),
  })).filter((g) => g.rows.length);
  const ids = new Set(cards.map((c) => c.id).filter((x) => x != null));
  const loose = items.filter((f) => f.company_id == null || !ids.has(Number(f.company_id))).map(fund);
  if (loose.length) groups.push({ key: 'none', title: 'A fund with no firm', rows: loose, foot: 'It shows under every firm you pick.' });
  return groups;
}

/** An advisor's engagements: each a founder's grant, what it shares and until when. */
export function engagementRows(read) {
  const items = Array.isArray(read?.items) ? read.items : [];
  return items.map((g) => ({
    key: g.grant_uid,
    name: String(g.project_name || '').trim() || 'Untitled venture',
    shares: [g.scope_project && 'Project', g.scope_data_room && 'Data room', g.scope_sessions && 'Sessions'].filter(Boolean),
    since: day(g.created_at) || NOT_RECORDED,
    until: g.expires_at ? day(g.expires_at) : 'no end date',
  }));
}

// ---------------------------------------------------------------- the tab counts (CMP1, CMP15, CMP16b)

/** A tab's count as `HeaderTab` draws it: grey while reading, a dash when unread. */
export function tabCount(read, n) {
  if (!read || read.status === 'loading') return { kind: 'load' };
  if (read.status === 'error') return { kind: 'dash', tip: 'Could not be read.' };
  if (read.status !== 'ready') return null;
  return n == null ? { kind: 'dash', tip: 'Could not be read.' } : { kind: 'num', value: String(n) };
}

// ---------------------------------------------------------------- lifecycle (D1139: CMP2, CMP4, CMP6–CMP8)

const DAY_MS = 86_400_000;
/** The venture trash keeps a venture this long (`services/projectTrash.ts`'s sweep). */
export const TRASH_DAYS = 30;
/** The last day a venture moved to trash now can be restored. */
export const trashUntil = (now = new Date()) => day(new Date(now.getTime() + TRASH_DAYS * DAY_MS).toISOString());

/** The Worker's `canEdit` (company.ts): a primary admin, or an Owner, Admin or Founder. */
const EDITOR_ROLES = ['owner', 'admin', 'founder'];

/**
 * Who the caller is in a company, from `GET /api/company/:uid`'s members:
 * what they may do there, and the people a transfer can go to.
 */
export function companyPowers(detail, meId) {
  const members = Array.isArray(detail?.members) ? detail.members : [];
  const me = members.find((m) => Number(m.user_id) === Number(meId)) || null;
  const primary = !!me?.is_primary_admin;
  const admins = members.filter((m) => m.is_primary_admin);
  return {
    me,
    member: !!me,
    primary,
    editor: primary || EDITOR_ROLES.includes(String(me?.role_in_company || '').toLowerCase()),
    onlyPrimary: primary && admins.length === 1,
    archived: !!detail?.archived_at,
    others: members.filter((m) => Number(m.user_id) !== Number(meId)),
  };
}

/** A company member's line: "Ana Example · Admin · Associate · joined 3 Oct 2026". */
export function memberLine(m) {
  return [
    m.is_primary_admin ? 'Primary admin' : roleWord(m.role_in_company),
    m.title || null,
    m.authority ? roleWord(String(m.authority).toLowerCase()) : null,
    m.joined_at ? `joined ${day(m.joined_at)}` : null,
  ].filter(Boolean).join(' · ');
}

/** A company invitation this company sent, as an editor reads it. */
export function sentInvitationLine(i) {
  return [
    roleWord(i.role_in_company),
    i.email_sent ? null : 'email not sent',
    i.created_at ? `sent ${day(i.created_at)}` : null,
    i.expires_at ? `expires ${day(i.expires_at, { year: false })}` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * A venture's team from `GET /api/projects/:id/members`: who sits where, and
 * what the caller may do. The Lab lock is the Worker's own (`gate_reason`,
 * from `evaluateTeamGate`), said as it says it, never worked out here.
 */
export function ventureTeam(read, meId) {
  const members = (Array.isArray(read?.members) ? read.members : []).map((m) => ({
    userId: m.user_id,
    name: String(m.name || '').trim() || NOT_RECORDED,
    you: Number(m.user_id) === Number(meId),
    seat: seatWord(m.role),
    role: m.role,
    line: [seatWord(m.role), m.source ? String(m.source).replace(/_/g, ' ') : null, day(m.accepted_at || m.created_at)].filter(Boolean).join(' · '),
  }));
  const owner = read?.my_role === 'owner';
  return {
    members,
    owner,
    manage: !!read?.can_manage,
    seated: !!read?.my_role,
    cofounders: members.filter((m) => m.role === 'cofounder' && !m.you),
    invitations: Array.isArray(read?.invitations) ? read.invitations : [],
    lock: read?.locked ? (read.gate_reason || `Co-founder and advisor invites unlock in Week ${read.unlock_week} of the Spin-Out Lab.`) : null,
  };
}

/** The Worker's refusal of a leave by the only primary admin (company.ts). */
export const isLastPrimaryAdmin = (e) => (e?.code || e?.data?.code) === 'last_primary_admin';

/** A name already used by one of your companies (the Worker's clash rule: trimmed, case-insensitive). */
export function nameClash(name, companies = []) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  const hit = (Array.isArray(companies) ? companies : []).find((c) => String(c.company_name || '').trim().toLowerCase() === want);
  return hit ? String(hit.company_name).trim() : null;
}

/**
 * What every lifecycle dialog says before it changes anything (the canvas's
 * CMP6–CMP8). Each is `{ title, body, button, cancel, danger }`; `body` is a
 * list of sentences, drawn as paragraphs.
 */
export const LIFECYCLE = {
  rename: (name) => ({ title: `Rename ${name}`, body: [`Everyone in ${name} sees the new name.`], button: 'Rename', cancel: 'Cancel' }),
  makeActive: (name) => ({
    title: `Make ${name} your active company?`,
    body: [`Studio, cycles, deals, funds and quotes will show ${name}’s work on this device. Nothing else changes.`],
    button: 'Make active', cancel: 'Cancel',
  }),
  invite: (name) => ({
    title: `Invite people to ${name}`,
    body: ['They get an email with a link that works for 14 days. They join only when they accept.'],
    button: 'Send invitation', cancel: 'Cancel',
  }),
  transferAdmin: (name, to) => ({
    title: `Transfer primary admin of ${name}`,
    body: [`${to || 'The person you pick'} takes over members and the lifecycle actions. This is recorded.`],
    button: 'Transfer', cancel: 'Cancel',
  }),
  archive: (name) => ({
    title: `Archive ${name}?`,
    body: ['It leaves the switcher for every member.', 'Its ventures, deals and files are kept.', 'The primary admin can restore it. Archived, where every member will see it, is not built yet.'],
    foot: 'Deleting a company is not self-serve. Ask the Axal VC team in the Help Center.',
    button: 'Archive', cancel: 'Cancel', danger: true,
  }),
  leave: (name) => ({
    title: `Leave ${name}?`,
    body: ['You lose access to its workspaces. What you added stays with the company. Someone inside must invite you back.'],
    button: 'Leave', cancel: 'Stay', danger: true,
  }),
  leaveRefused: (name) => ({
    title: `Leave ${name}?`,
    body: [`You are the only primary admin of ${name}. Transfer it first.`],
    button: 'Transfer primary admin', cancel: 'Back',
  }),
  move: (name, loose) => ({
    title: `Move ${name} to:`,
    body: [loose ? 'It then shows only under that company. Today it shows under every company.' : 'It then shows only under that company.'],
    button: 'Move', cancel: 'Cancel',
  }),
  transferVenture: (name, to) => ({
    title: `Transfer ownership of ${name}`,
    body: [`${to || 'The co-founder you pick'} becomes the owner. You stay on as Co-founder. Only a founder account can own a venture.`],
    button: 'Transfer', cancel: 'Cancel',
  }),
  leaveVenture: (name, seat) => ({
    title: `Leave ${name}?`,
    body: [`You lose your ${seat || 'seat'} seat. The owner can invite you again.`],
    button: 'Leave', cancel: 'Stay', danger: true,
  }),
  trash: (name, until) => ({
    title: `Move ${name} to trash?`,
    body: [`It is hidden at once and deleted for good after ${TRASH_DAYS} days.`, `It can be restored until ${until}. Archived, where you will restore it yourself, is not built yet.`],
    button: 'Move to trash', cancel: 'Cancel', danger: true,
  }),
  removeMember: (name, venture) => ({
    title: `Remove ${name} from ${venture}?`,
    body: [`${name} loses their seat on ${venture}. You can invite them again.`],
    button: 'Remove', cancel: 'Cancel', danger: true,
  }),
};

/** A lifecycle refusal in words: the Worker's codes for these routes, else its own sentence. */
export function lifecycleRefusal(e) {
  const code = e?.code || e?.data?.code;
  if (code === 'unchanged') return 'Nothing changed: it is already there.';
  if (code === 'already_archived') return 'This company was archived a moment ago. Nothing changed.';
  if (code === 'already_pending') return 'An invitation to that address is already waiting. Nothing was sent.';
  return refusalWords(e);
}

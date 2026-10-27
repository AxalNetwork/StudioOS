/**
 * D1305 (#3402, part 6 of #2377) — All accounts (ACC2, ACC3, ACC12): the
 * table's state, the query it sends D1300's `GET /api/admin/users`, the chips,
 * the saved views D1303 keeps, and each row and menu in the canvas's words.
 * Pure, so `frontend/test/all_accounts_d1305.test.mjs` holds every rule.
 *
 * THE LIST READ IS THE SERVER'S. Filters, sort and paging travel to D1300's
 * read, which counts over every account; nothing here filters or counts the
 * rows on screen.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

/** ACC2's profile chips, in #2377's order and words (G1). `null` is All. */
export const PROFILE_CHIPS = Object.freeze([
  { value: null, label: 'All' },
  { value: 'founder', label: 'Founders' },
  { value: 'investor', label: 'Investors' },
  { value: 'advisor', label: 'Advisors' },
  { value: 'partner', label: 'Operating Partners' },
  { value: 'exploring', label: 'Explorers' },
  { value: 'admin', label: 'Admins' },
]);
export const PROFILE_WORD = Object.freeze({
  founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', exploring: 'Explorer', admin: 'Admin',
});
/** The two sub-accounts, chips beside the profiles. */
export const SUB_CHIPS = Object.freeze([{ value: 'lp', label: 'LPs' }, { value: 'tester', label: 'Product testers' }]);

export const IDENTITY_WORD = Object.freeze({
  not_started: 'Not started', pending: 'Waiting', needs_info: 'Needs information', approved: 'Approved', rejected: 'Rejected', expired: 'Expired',
});

/**
 * ACC3's Filters panel, one group per D1300 filter. `key` is the read's
 * parameter; `single` groups take one value; `values` with no fixed list
 * (plan, persona) come from the rows the read answered.
 */
export const FILTER_GROUPS = Object.freeze([
  { key: 'status', label: 'Status', options: [['active', 'Active'], ['deactivated', 'Deactivated']] },
  { key: 'email', label: 'Email', options: [['verified', 'Verified'], ['unverified', 'Not verified']] },
  { key: 'identity', label: 'Identity check', options: Object.entries(IDENTITY_WORD) },
  { key: 'limited', label: 'Limited access', options: [['on', 'On'], ['off', 'Off']] },
  { key: 'plan', label: 'Plan', options: null },
  { key: 'country', label: 'Country', options: null, search: 'Search a country' },
  { key: 'joined', label: 'Joined', single: true, options: [['', 'Any time'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['custom', 'Custom range']] },
  { key: 'active', label: 'Last active', single: true, options: [['', 'Any'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['over_30d', 'Over 30 days ago'], ['never', 'Never']] },
  { key: 'persona', label: 'Persona segment', options: null, extra: 'Segments are defined on Persona segments.' },
  { key: 'program', label: 'Programs', options: [['lab', 'In the Spin-Out Lab'], ['mentor', 'In a mentor cohort'], ['testing', 'In a testing program']] },
  { key: 'trust', label: 'Trust', options: [['under_50', 'Under 50'], ['50_79', '50 to 79'], ['80_up', '80 and over'], ['not_recorded', 'Not recorded']] },
]);
const MULTI = ['status', 'email', 'identity', 'limited', 'plan', 'country', 'persona', 'program', 'trust'];

export const SORTS = Object.freeze([
  ['joined_desc', 'Joined, newest first'], ['joined_asc', 'Joined, oldest first'],
  ['active_desc', 'Last active, most recent'], ['active_asc', 'Last active, longest ago'],
  ['name_asc', 'Name, A to Z'], ['completeness_asc', 'Profile completeness, lowest first'], ['trust_asc', 'Trust, lowest first'],
]);
export const sortLabel = (key) => (SORTS.find(([k]) => k === key) || SORTS[0])[1];

/** ACC3's Columns picker; Account is always drawn. */
export const COLUMNS = Object.freeze([
  { key: 'profile', label: 'Profile', on: true }, { key: 'status', label: 'Status', on: true },
  { key: 'email', label: 'Email', on: true }, { key: 'identity', label: 'Identity', on: true },
  { key: 'plan', label: 'Plan', on: true }, { key: 'country', label: 'Country', on: true },
  { key: 'last_active', label: 'Last active', on: true }, { key: 'joined', label: 'Joined', on: true },
  { key: 'trust', label: 'Trust', on: true },
  { key: 'persona', label: 'Persona segment', on: false }, { key: 'completeness', label: 'Profile completeness', on: false },
]);
export const DEFAULT_COLUMNS = Object.freeze(COLUMNS.filter((c) => c.on).map((c) => c.key));
export const PAGE_SIZES = Object.freeze([25, 50, 100]);

/** A fresh table: every account, newest first, 25 a page. */
export function initialState() {
  return {
    profile: null, sub: null, q: '', sort: 'joined_desc', page: 0, pageSize: 25,
    filters: Object.fromEntries(MULTI.map((k) => [k, []])), joined: '', joined_from: '', joined_to: '', active: '',
    columns: [...DEFAULT_COLUMNS],
  };
}

/** The options `adminListUsers` sends; an empty filter is not sent, and a search under two characters is not either (D128). */
export function listParams(s) {
  const q = String(s.q || '').trim();
  const out = { envelope: 1, limit: s.pageSize, offset: s.page * s.pageSize, sort: s.sort };
  if (q.length >= 2) out.q = q;
  if (s.profile) out.profile = s.profile;
  if (s.sub) out.sub = s.sub;
  for (const k of MULTI) if (s.filters[k]?.length) out[k] = [...s.filters[k]];
  if (s.joined === 'custom') {
    if (s.joined_from) out.joined_from = s.joined_from;
    if (s.joined_to) out.joined_to = s.joined_to;
  } else if (s.joined) out.joined = s.joined;
  if (s.active) out.active = s.active;
  return out;
}

const optionLabel = (key, value) => {
  const g = FILTER_GROUPS.find((x) => x.key === key);
  const o = g?.options?.find(([v]) => v === value);
  return o ? o[1] : value;
};

/** The chips under the toolbar (ACC3): each names what it narrows, and removes it. */
export function chipsOf(s) {
  const chips = [];
  if (s.profile) chips.push({ id: 'profile', label: PROFILE_CHIPS.find((c) => c.value === s.profile)?.label || s.profile });
  if (s.sub) chips.push({ id: 'sub', label: SUB_CHIPS.find((c) => c.value === s.sub)?.label || s.sub });
  for (const g of FILTER_GROUPS) {
    if (g.single) {
      const v = s[g.key];
      if (!v) continue;
      const word = v === 'custom' ? [s.joined_from || 'any', s.joined_to || 'today'].join(' to ') : optionLabel(g.key, v).toLowerCase();
      chips.push({ id: g.key, label: `${g.label}: ${word}` });
      continue;
    }
    for (const v of s.filters[g.key] || []) chips.push({ id: `${g.key}:${v}`, label: `${g.label}: ${g.key === 'country' || g.key === 'plan' || g.key === 'persona' ? v : optionLabel(g.key, v)}` });
  }
  return chips;
}

/** The state without one chip, back on the first page. */
export function removeChip(s, id) {
  const next = { ...s, filters: { ...s.filters }, page: 0 };
  if (id === 'profile' || id === 'sub') next[id] = null;
  else if (id === 'joined') Object.assign(next, { joined: '', joined_from: '', joined_to: '' });
  else if (id === 'active') next.active = '';
  else {
    const [key, ...rest] = id.split(':');
    const value = rest.join(':');
    next.filters[key] = (next.filters[key] || []).filter((v) => v !== value);
  }
  return next;
}

/** Clear all: every filter and chip goes, the search, sort and columns stay. */
export const clearFilters = (s) => ({ ...initialState(), q: s.q, sort: s.sort, columns: s.columns, pageSize: s.pageSize });

/** One option toggled in a multi-value group, or set in a single one; back to page one. */
export function toggleOption(s, key, value) {
  const g = FILTER_GROUPS.find((x) => x.key === key);
  if (!g) return s;
  if (g.single) {
    const reset = key === 'joined' && value !== 'custom' ? { joined_from: '', joined_to: '' } : {};
    return { ...s, ...reset, [key]: value, page: 0 };
  }
  const cur = s.filters[key] || [];
  const list = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  if (key === 'country' && list.length > 20) return s;
  return { ...s, filters: { ...s.filters, [key]: list }, page: 0 };
}

export const narrowed = (s) => chipsOf(s).length > 0 || String(s.q || '').trim().length >= 2;

// ── Saved views (D1303's VIEW_KEYS) ───────────────────────────────────────────

/** The list's parameter, by the key a saved view keeps it under. */
const VIEW_KEY_OF = Object.freeze({
  profile: 'profile', sub: 'sub_account', status: 'status', email: 'email', identity: 'identity', limited: 'access',
  plan: 'plan', country: 'country', persona: 'persona', program: 'programme', trust: 'trust',
});

/** A view's query: the profile, filters, sort and columns (ACC3 "It keeps the profile, filters, sort and columns"). */
export function toViewQuery(s) {
  const out = {};
  if (s.profile) out.profile = s.profile;
  if (s.sub) out.sub_account = s.sub;
  for (const k of MULTI) if (s.filters[k]?.length) out[VIEW_KEY_OF[k]] = [...s.filters[k]];
  if (s.joined === 'custom') {
    if (s.joined_from) out.joined_from = s.joined_from;
    if (s.joined_to) out.joined_to = s.joined_to;
  } else if (s.joined) out.joined = s.joined;
  if (s.active) out.last_active = s.active;
  if (s.sort !== 'joined_desc') out.sort = s.sort;
  if (s.columns.join() !== DEFAULT_COLUMNS.join()) out.columns = [...s.columns];
  if (s.pageSize !== 25) out.page_size = String(s.pageSize);
  return out;
}

const listOf = (v) => (Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)]);
const oneOf = (v, allowed) => { const x = listOf(v)[0]; return x && (!allowed || allowed.includes(x)) ? x : null; };

/** A saved view applied: a fresh table with its query; a key the table does not know is left out, never guessed. */
export function fromViewQuery(query, keep = {}) {
  const q = query && typeof query === 'object' ? query : {};
  const s = { ...initialState(), q: keep.q ?? '' };
  s.profile = oneOf(q.profile, PROFILE_CHIPS.map((c) => c.value).filter(Boolean));
  s.sub = oneOf(q.sub_account, SUB_CHIPS.map((c) => c.value));
  for (const k of MULTI) {
    const g = FILTER_GROUPS.find((x) => x.key === k);
    const allowed = g.options ? g.options.map(([v]) => v) : null;
    s.filters[k] = listOf(q[VIEW_KEY_OF[k]]).filter((v) => !allowed || allowed.includes(v));
  }
  const joined = oneOf(q.joined, ['7d', '30d']);
  const from = oneOf(q.joined_from); const to = oneOf(q.joined_to);
  if (from || to) Object.assign(s, { joined: 'custom', joined_from: from || '', joined_to: to || '' });
  else if (joined) s.joined = joined;
  s.active = oneOf(q.last_active, ['7d', '30d', 'over_30d', 'never']) || '';
  s.sort = oneOf(q.sort, SORTS.map(([k]) => k)) || 'joined_desc';
  const cols = listOf(q.columns).filter((c) => COLUMNS.some((x) => x.key === c));
  if (cols.length) s.columns = cols;
  const size = Number(oneOf(q.page_size));
  if (PAGE_SIZES.includes(size)) s.pageSize = size;
  return s;
}

/** Save this view's refusal, or null: a name (at most 80 characters) and a scope. */
export function viewProblem(name, scope) {
  const n = String(name || '').trim();
  if (!n) return 'Name the view.';
  if (n.length > 80) return 'A view’s name is at most 80 characters.';
  if (scope !== 'admin' && scope !== 'studio') return 'Choose who sees it.';
  return null;
}

// ── The count and the rows ────────────────────────────────────────────────────

const fmt = (n) => Number(n).toLocaleString('en-GB');

/** "1–25 of 1,284" over the filtered set (D1300's `matched`), "0 of 1,284" when nothing matches. */
export function countLine(env) {
  if (!env) return '';
  const matched = Number(env.matched ?? 0);
  if (!matched) return `0 of ${fmt(env.total ?? 0)}`;
  return `${fmt(env.from)}–${fmt(env.to)} of ${fmt(matched)}`;
}

/** Whether a store or column was not read (D1300's `unreadable`). */
export const unreadableOf = (env, name) => Array.isArray(env?.unreadable) && env.unreadable.includes(name);

const DAY = 86_400_000;
/** A day, in words: "Today", "Yesterday", "5 days ago", else the date. */
export function dayWords(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(String(iso).replace(' ', 'T') + (/[zZ+]/.test(String(iso).slice(10)) ? '' : 'Z'));
  if (!Number.isFinite(t)) return null;
  // Calendar days in UTC, so "Yesterday" is the day before today, not 24 hours ago.
  const days = Math.floor(now / DAY) - Math.floor(t / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** One row as the table draws it. Nothing recorded reads "Not recorded", never a 0 or a guess. */
export function rowView(u, env, now = Date.now()) {
  const kyc = u.kyc_status || 'not_started';
  const lastUnread = unreadableOf(env, 'last_active_at');
  const subs = [u.sub_accounts?.lp ? 'LP' : null, u.sub_accounts?.tester ? 'Tester' : null].filter(Boolean);
  return {
    id: Number(u.id),
    name: u.name || u.email || `Account ${u.id}`,
    email: u.email || '',
    profile: PROFILE_WORD[u.role] || u.role || NOT_RECORDED,
    subs,
    active: Number(u.is_active) !== 0,
    status: Number(u.is_active) !== 0 ? 'Active' : 'Deactivated',
    email_word: Number(u.email_verified) ? 'Verified' : 'Not verified',
    identity: IDENTITY_WORD[kyc] || kyc,
    identity_tone: kyc === 'approved' ? 'pos' : ['rejected', 'expired'].includes(kyc) ? 'neg' : kyc === 'not_started' ? 'mut' : 'amb',
    limited: u.access_level === 'limited',
    plan: unreadableOf(env, 'subscription_tier') ? NOT_RECORDED : u.subscription_tier ? String(u.subscription_tier) : 'Free',
    country: u.country ? String(u.country) : NOT_RECORDED,
    last_active: lastUnread ? NOT_RECORDED : (dayWords(u.last_active_at, now) || 'Never'),
    joined: dayWords(u.created_at, now) || NOT_RECORDED,
    trust: unreadableOf(env, 'trust') ? null : u.trust?.score ?? null,
    trust_reason: u.trust?.score == null ? (u.trust?.reason || NOT_RECORDED) : `${u.trust.open || 0} obligation${u.trust.open === 1 ? '' : 's'} open`,
    persona: u.persona ? String(u.persona.label || u.persona.key || u.persona) : NOT_RECORDED,
    completeness: u.profile_completion_pct == null ? NOT_RECORDED : `${u.profile_completion_pct}%`,
  };
}

/** Values the read answered for a group with no fixed list (plan, persona), plus any already chosen. */
export function seenValues(rows, key, chosen = []) {
  const vals = new Set(chosen);
  for (const u of rows || []) {
    if (key === 'plan') vals.add(u.subscription_tier ? String(u.subscription_tier) : 'free');
    if (key === 'persona' && u.persona) vals.add(String(u.persona.key || u.persona));
  }
  return [...vals].sort();
}

// ── The row menu (ACC2, ACC12) ────────────────────────────────────────────────

export const ADMIN_ROW_NOTE = 'Administrators are removed on their licence (Licences › Administrators).';

/**
 * A row's ⋯ menu, in the canvas's words. `controls` is `drawsAccountControls`
 * (D221): where the server can only refuse, the item is not drawn. An
 * administrator's row has no profile, access or Lab items, and says where an
 * administrator is removed.
 */
export function rowMenu(u, { controls }) {
  const items = [{ id: 'open', label: 'Open account' }];
  const admin = u.role === 'admin';
  if (!admin) {
    items.push({ id: 'profile', label: 'Change profile…' });
    if (u.kyc_status !== 'approved') {
      items.push({ id: 'full', label: 'Grant full access without an identity check…' });
      items.push(u.access_level === 'limited' ? { id: 'unlimit', label: 'Revoke limited access…' } : { id: 'limit', label: 'Grant limited access…' });
    }
    items.push({ id: 'lab', label: 'Admit to Spin-Out Lab…' });
  }
  if (controls) {
    items.push({ id: 'support', label: 'Start a support session…' });
    items.push({ id: 'toggle', label: Number(u.is_active) !== 0 ? 'Deactivate account…' : 'Reactivate account…', danger: Number(u.is_active) !== 0 });
  }
  return { items, note: admin ? ADMIN_ROW_NOTE : '' };
}

/** Change profile (ACC7 A–C): the profiles an account may be moved to, and what an Explorer needs. */
export const CHANGE_PROFILES = Object.freeze(['founder', 'investor', 'advisor', 'partner', 'exploring']);
export function changeProfileView(u, superAdmin) {
  const from = PROFILE_WORD[u.role] || u.role;
  const name = u.name || u.email || 'This account';
  if (u.role === 'exploring' && !superAdmin) {
    return { kind: 'explorer', title: `Change ${name}’s profile?`, line: 'Leaving Explorer needs a signed binding agreement. Give the profile from the Exploring board.', to: '/admin/exploring' };
  }
  return { kind: u.role === 'exploring' ? 'override' : 'change', title: `Change ${name}’s profile from ${from}?`,
    line: 'It takes effect at once. Their menus change on their next page. It is recorded in their activity.',
    options: CHANGE_PROFILES.filter((p) => p !== u.role).map((p) => [p, PROFILE_WORD[p]]) };
}

// ── The bulk bar (ACC2) ───────────────────────────────────────────────────────

export const RESEND_CAP = 50;

/** The resend dialog's words from D1303's dry run (ACC7 J). */
export function resendView(dry) {
  const n = Number(dry?.asked ?? 0); const send = Number(dry?.to_send ?? 0);
  const s = dry?.skipped || {};
  const why = [
    [s.verified, 'already verified'], [s.deactivated, 'deactivated'], [s.administrator, 'another administrator’s account'], [s.not_found, 'no longer an account'],
  ].filter(([k]) => Number(k) > 0).map(([k, w]) => `${k} ${Number(k) === 1 ? 'is' : 'are'} ${w}`);
  return {
    title: `Send the verification email again to ${n} account${n === 1 ? '' : 's'}?`,
    skipped: why.length ? `${why.join('; ')}: ${n - send === 1 ? 'it is' : 'they are'} skipped.` : '',
    send: send ? `Send ${send} email${send === 1 ? '' : 's'}` : null,
    none: send ? '' : 'Nothing is left to send: every account chosen is verified, deactivated or not yours to email.',
  };
}

/** D1303's export columns, in the list's words; the Worker refuses any other. */
export const EXPORT_COLUMNS = Object.freeze([
  ['name', 'Name'], ['email', 'Email'], ['uid', 'Account ID'], ['profile', 'Profile'], ['status', 'Status'],
  ['email_verified', 'Email verified'], ['identity', 'Identity check'], ['access', 'Limited access'], ['joined', 'Joined'],
]);

/** The export's refusal, or null: a reason of 10 to 500 characters and at least one column. */
export function exportProblem(reason, columns) {
  const r = String(reason || '').trim();
  if (r.length < 10) return 'Give a reason of at least 10 characters.';
  if (r.length > 500) return 'A reason is at most 500 characters.';
  if (!columns?.length) return 'Choose at least one column.';
  return null;
}

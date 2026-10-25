/**
 * D979 (#2765) — Advisors & Partners › Firms complete (AP5, AP6, AP9d, AP10),
 * as pure functions: the toolbar's options and the list read's parameters,
 * the table's rows, the "No firm" strip, the drawer's blocks, and every
 * dialog's words. No React here, so `node --test` loads it alone.
 *
 * The reads (D979 §1): `adminPartnerFirmsApi.list` (search, filters, sort and
 * pages answered by the Worker, with an exact total) and `.get` (one firm's
 * drawer), each block in D973's shape — `{ available, recorded, value }`, a
 * figure no store holds `recorded: false` with its reason, a failed store
 * `available: false`. Never a zero for a missing value.
 *
 * The writes already exist: the directory switches
 * (`POST /api/admin/partners/:id/directory`) and attach and detach
 * (`POST /api/admin/partners/links`, D952). You choose both sides; nothing is
 * matched for you.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { dayOr, dealTypeWord, plural, tiersText, termText } from '../partners/partnersDeskModel.js';

export const FIRMS_PAGE = 25;
export const STRIP_ROWS = 5;
export { NOT_RECORDED };
export const COULD_NOT_READ = 'Could not be read';
export const NOTHING_MATCHED = 'You choose both. Nothing is matched for you.';
export const LIST_FIRST = 'List the firm first.';
export const DEALS_ELSEWHERE = 'Deals are ended on Partner invitations, not here.';
export const SETTLEMENTS_ELSEWHERE = 'Read only. Settlements are drafted and issued in Contracts.';
export const OPERATING_PARTNER = 'Operating partner';

export const DIRECTORY_OPTIONS = [
  { key: '', word: 'Any directory state' },
  { key: 'listed', word: 'Listed' },
  { key: 'featured', word: 'Featured' },
  { key: 'not_listed', word: 'Not listed' },
];
export const ENDS_OPTIONS = [
  { key: '', word: 'Any end date' },
  { key: '30', word: 'Ends within 30 days' },
  { key: '60', word: 'Ends within 60 days' },
  { key: '90', word: 'Ends within 90 days' },
];
export const SORT_OPTIONS = [
  { key: 'name_asc', word: 'Name, A to Z' },
  { key: 'name_desc', word: 'Name, Z to A' },
  { key: 'accounts_desc', word: 'Most accounts' },
  { key: 'deal_ends_asc', word: 'Deal ends soonest' },
  { key: 'rating_desc', word: 'Highest rated' },
];
export const INITIAL_QUERY = Object.freeze({ q: '', directory: '', dealType: '', endsWithin: '', noAccounts: false, sort: 'name_asc', page: 1 });

const nf = (n) => Number(n).toLocaleString('en-US');

/** The list read's parameters: only what is chosen travels. */
export function listParams(query) {
  const q = { ...INITIAL_QUERY, ...(query || {}) };
  return {
    q: q.q.trim() || undefined,
    directory: q.directory || undefined,
    deal_type: q.dealType || undefined,
    ends_within: q.endsWithin || undefined,
    no_accounts: q.noAccounts ? 'true' : undefined,
    sort: q.sort && q.sort !== 'name_asc' ? q.sort : undefined,
    limit: FIRMS_PAGE,
    offset: q.page > 1 ? (q.page - 1) * FIRMS_PAGE : undefined,
  };
}

/** True when any search or filter narrows the list (an empty list then says "No firm matches"). */
export const isFiltered = (query) => Boolean(query && (query.q.trim() || query.directory || query.dealType || query.endsWithin || query.noAccounts));

/** A block's state: its value, or the sentence that stands in for it. */
export function blockOf(block) {
  if (!block || block.available === false) return { ok: false, text: COULD_NOT_READ, reason: block?.reason || null, failed: true };
  if (block.recorded === false) return { ok: false, text: block.reason || NOT_RECORDED, reason: block.reason || null, failed: false };
  return { ok: true, value: block.value };
}

/** Whole US dollars where the amount is whole, cents where it is not. */
export function money(cents) {
  const n = Number(cents) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

const DIRECTION = { to_member: 'Studio → firm', from_member: 'Firm → studio' };
const KIND = { revenue_share: 'Revenue share', capital: 'Capital', equity_for_services: 'Equity for services', other: 'Other' };
const STATE = {
  draft: { word: 'Draft', tone: 'muted', glyph: '◇' },
  issued: { word: 'Issued', tone: 'amber', glyph: '◷' },
  matched: { word: 'Matched', tone: 'green', glyph: '✓' },
  void: { word: 'Void', tone: 'muted', glyph: '–' },
};
export const directionWord = (d) => DIRECTION[d] || 'Direction not recorded';
export const settlementKindWord = (k) => KIND[k] || 'Another kind';
export const settlementState = (s) => STATE[s] || { word: s ? 'Another state' : 'State not recorded', tone: 'muted', glyph: '·' };

export function directoryWord(dir) {
  if (dir?.featured) return '★ Featured';
  if (dir?.listed) return '✓ Listed';
  return 'Not listed';
}

export function ratingText(r) {
  if (!r || !r.count) return 'No ratings yet';
  return `${Number(r.average).toFixed(1)} (${nf(r.count)})`;
}

/** The firm's name as the canvas draws it: the company, with the stored name beneath when it differs. */
export function firmName(f) {
  const company = String(f?.company || '').trim();
  const name = String(f?.name || '').trim();
  return { title: company || name || 'Name not recorded', sub: company && name && name !== company ? name : null };
}

function dealCell(d) {
  const b = blockOf(d);
  if (!b.ok) return { word: b.text, failed: b.failed, ends: b.text, endsFailed: b.failed, soon: false };
  const v = b.value;
  if (!v.count) return { word: 'No active deal', none: true, ends: '—', soon: false };
  const word = v.count === 1 ? dealTypeWord(v.types[0]) : `${nf(v.count)} active deals`;
  const ends = v.soonest_end ? dayOr(v.soonest_end) : 'End not recorded';
  return { word, ends, soon: Boolean(v.ending_soon) };
}

function settlementsCell(block) {
  const b = blockOf(block);
  if (!b.ok) return { text: b.failed ? COULD_NOT_READ : 'Kept by HQ', failed: b.failed, reason: b.reason };
  const v = b.value;
  if (!v.count) return { text: '—', none: true };
  const parts = [];
  if (v.to_member_cents) parts.push(`${money(v.to_member_cents)} to the firm`);
  if (v.from_member_cents) parts.push(`${money(v.from_member_cents)} to the studio`);
  return { text: parts.join(' · '), sub: `${nf(v.count)} issued, due within 30 days` };
}

/** AP5's rows from one page of the list read. */
export function firmRows(data) {
  return (data?.items || []).map((f) => {
    const accounts = blockOf(f.accounts);
    const redemptions = blockOf(f.redemptions);
    const rating = blockOf(f.rating);
    return {
      id: f.id,
      ...firmName(f),
      accounts: accounts.ok ? nf(accounts.value) : accounts.text,
      accountsFailed: !accounts.ok,
      specialization: String(f.specialization || '').trim() || NOT_RECORDED,
      deal: dealCell(f.deal),
      redemptions: redemptions.ok ? nf(redemptions.value) : redemptions.text,
      directory: directoryWord(f.directory),
      rating: rating.ok ? ratingText(rating.value) : rating.text,
      settlements: settlementsCell(f.settlements_due),
    };
  });
}

/** "1–25 of 117", from the Worker's exact total. */
export function rangeText(data) {
  const total = Number(data?.total ?? 0);
  const shown = (data?.items || []).length;
  const offset = Number(data?.offset ?? 0);
  if (!total) return 'No firms';
  if (!shown) return `None on this page · ${nf(total)} in all`;
  return `${nf(offset + 1)}–${nf(offset + shown)} of ${nf(total)}`;
}
export const pagesOf = (data, page) => ({ page, pages: Math.max(1, Math.ceil(Number(data?.total ?? 0) / FIRMS_PAGE)) });

/** Which columns came back unreadable this read, said once above the table. */
const SOURCE_WORDS = { accounts: 'account counts', deals: 'active deals', redemptions: 'redemptions', ratings: 'ratings', settlements: 'settlements due' };
export function unreadableLine(data) {
  const keys = (data?.unreadable || []).filter((k) => SOURCE_WORDS[k]);
  if (!keys.length) return null;
  return `The ${keys.map((k) => SOURCE_WORDS[k]).join(', ')} could not be read, so ${keys.length === 1 ? 'that column says so' : 'those columns say so'}. Try again.`;
}

/** The "No firm" strip: the links read's unattached accounts, the first five, with the read's own count. */
export function unattachedOf(linksData) {
  const accounts = (linksData?.accounts || []).filter((a) => a && (a.partner_id === null || a.partner_id === undefined));
  return { count: Number(linksData?.unattached ?? accounts.length), rows: accounts.slice(0, STRIP_ROWS), all: accounts, more: accounts.length > STRIP_ROWS };
}

/** Who an account is, by name, else by the address the admin-only links read carries (D952). */
export const whoOf = (a) => String(a?.name || '').trim() || String(a?.email || '').trim() || 'this account';

/* ------------------------------------------------------------------ *
 * The drawer (AP6)
 * ------------------------------------------------------------------ */

export function drawerOf(data) {
  const accounts = blockOf(data?.accounts);
  const deals = blockOf(data?.deals);
  const settlements = blockOf(data?.settlements);
  const profiles = blockOf(data?.profiles);
  const oh = data?.office_hours || {};
  const fact = (block) => { const b = blockOf(block); return b.ok ? (Array.isArray(b.value) ? b.value.join(' · ') : String(b.value)) : (b.failed ? COULD_NOT_READ : NOT_RECORDED); };
  const rating = blockOf(oh.rating);
  const host = blockOf(oh.lab_host);
  return {
    ...firmName(data?.firm),
    specialization: String(data?.firm?.specialization || '').trim() || null,
    inactive: data?.firm?.status === 'inactive',
    accounts: accounts.ok
      ? { state: 'ready', rows: accounts.value.map((a) => ({ id: a.id, name: String(a.name || '').trim() || 'Name not recorded', sub: [a.headline, OPERATING_PARTNER].filter(Boolean).join(' · '), inactive: a.active === false })) }
      : { state: 'unreadable', reason: accounts.reason },
    directory: { listed: Boolean(data?.directory?.listed), featured: Boolean(data?.directory?.featured), decided: data?.directory?.decided_at ? dayOr(data.directory.decided_at) : null },
    deals: deals.ok
      ? { state: 'ready', more: deals.value.more, rows: deals.value.rows.map((d) => ({
        id: d.id, type: dealTypeWord(d.deal_type), status: d.status, term: termText(d),
        tiers: tiersText(d.granted_tier_founder, d.granted_tier_investor), redemptions: nf(Number(d.redemptions || 0)),
      })) }
      : { state: 'unreadable', reason: deals.reason },
    settlements: settlements.ok
      ? { state: 'ready', more: settlements.value.more, rows: settlements.value.rows.map((s) => ({
        id: s.id, kind: settlementKindWord(s.kind), direction: directionWord(s.direction), amount: money(s.amount_cents), due: dayOr(s.due_on), state: settlementState(s.state),
      })) }
      : (settlements.failed ? { state: 'unreadable', reason: settlements.reason } : { state: 'hq', text: settlements.text }),
    profiles: profiles.ok
      ? { state: 'ready', rows: profiles.value.map((p) => ({
        userId: p.user_id,
        facts: [
          ['Organisation', fact(p.organization)], ['Role title', fact(p.role_title)], ['Expertise', fact(p.expertise)],
          ['Sectors', fact(p.sectors)], ['Geography', fact(p.geography)], ['Capacity per month', fact(p.capacity_per_month)],
          ['Capital capacity', (() => { const b = blockOf(p.capital_capacity); return b.ok ? money(b.value.amount_cents) : (b.failed ? COULD_NOT_READ : NOT_RECORDED); })()],
        ],
      })) }
      : { state: 'unreadable', reason: profiles.reason },
    officeHours: [
      ['When to book', fact(oh.when_to_book)],
      ['Stage fit', fact(oh.stage_fit)],
      ['Session outcome', fact(oh.session_outcome)],
      ['Rating', rating.ok ? ratingText(rating.value) : COULD_NOT_READ],
      ['Lab host', host.ok ? hostWord(host.value.status) : COULD_NOT_READ],
    ],
  };
}

const HOST = { approved: '✓ Approved', pending: 'Waiting for a decision', rejected: 'Not approved', withdrawn: 'Withdrawn', revoked: 'Approval revoked' };
export const hostWord = (status) => (status ? HOST[status] || 'Another state' : 'Not a Lab host');

/** Whose profile a profile block is, from the drawer's own account list. */
export function profileOwner(drawer, userId) {
  const hit = drawer.accounts.state === 'ready' ? drawer.accounts.rows.find((a) => a.id === userId) : null;
  return hit ? hit.name : 'An account no longer attached';
}

/* ------------------------------------------------------------------ *
 * The dialogs: each says what it changes before it saves
 * ------------------------------------------------------------------ */

/** A directory switch's confirm. Featuring needs listing; unlisting a featured firm removes the feature too (the Worker's rule). */
export function directoryCopy(firm, which, next, dir) {
  const name = firmName(firm).title;
  if (which === 'listed' && next) return { title: `List ${name} in the public directory?`, body: `${name} shows in the public directory. The change is recorded in the admin audit log.`, action: 'List', payload: { listed: true } };
  if (which === 'listed') {
    return {
      title: `Take ${name} out of the public directory?`,
      body: `${name} no longer shows in the public directory.${dir?.featured ? ' Its feature is removed too, because featuring needs listing.' : ''} The change is recorded in the admin audit log.`,
      action: 'Take out', payload: { listed: false },
    };
  }
  if (next) return { title: `Feature ${name}?`, body: `${name} is drawn above the standard rows of the public directory, marked as featured. The change is recorded in the admin audit log.`, action: 'Feature', payload: { featured: true } };
  return { title: `Stop featuring ${name}?`, body: `${name} stays listed, among the standard rows. The change is recorded in the admin audit log.`, action: 'Stop featuring', payload: { featured: false } };
}

/** The directory write's answer as a line in the drawer, never a toast. */
export function directorySavedLine(reply) {
  const p = reply?.partner || {};
  if (p.featured) return 'Listed and featured in the public directory.';
  return p.listed ? 'Listed in the public directory, not featured.' : 'Not listed in the public directory.';
}

/** AP9d: detaching an account from its firm. */
export function detachCopy(account, firm) {
  const who = String(account?.name || '').trim() || 'this account';
  const name = firmName(firm).title;
  return {
    title: `Detach ${who} from ${name}?`,
    body: `${who} loses the firm’s pipeline, offers and earnings until they are attached again. The change is recorded in the admin audit log.`,
    action: 'Detach',
  };
}

/** AP10: attaching an account to a firm, both chosen by the admin. */
export function attachCopy({ account, firm }) {
  const who = account ? whoOf(account) : null;
  const name = firm ? firmName(firm).title : null;
  if (account && !firm) return { title: `Attach ${who} to a firm`, sub: `${who} · ${OPERATING_PARTNER}`, pick: 'firm' };
  if (firm && !account) return { title: `Attach an account to ${name}`, sub: 'An operating-partner account with no firm', pick: 'account' };
  return { title: `Attach ${who} to ${name}`, sub: `${who} · ${OPERATING_PARTNER}`, pick: null };
}
export const attachDone = (account, firm) => `Attached ${whoOf(account)} to ${firmName(firm).title}.`;
export const detachDone = (account, firm) => `Detached ${String(account?.name || '').trim() || 'the account'} from ${firmName(firm).title}.`;

/** The attach dialog's firm choices: the links read's firms, searched by name or company. */
export function firmChoices(linksData, needle) {
  const n = String(needle || '').trim().toLowerCase();
  return (linksData?.firms || [])
    .filter((f) => !n || [f.company, f.name].some((v) => String(v || '').toLowerCase().includes(n)))
    .map((f) => ({ id: f.id, ...firmName(f), accounts: `${plural(Number(f.accounts || 0), 'account', 'accounts')}` }));
}

/** The attach dialog's account choices: the unattached accounts, searched by name or address. */
export function accountChoices(linksData, needle) {
  const n = String(needle || '').trim().toLowerCase();
  return unattachedOf(linksData).all
    .filter((a) => !n || [a.name, a.email].some((v) => String(v || '').toLowerCase().includes(n)))
    .map((a) => ({ id: a.id, title: whoOf(a), sub: String(a.name || '').trim() ? a.email : null, account: a }));
}

/** A row's end date in the canvas's amber when it ends within 30 days. */
export const endsSoonSub = (deal) => (deal.soon ? 'within 30 days' : null);

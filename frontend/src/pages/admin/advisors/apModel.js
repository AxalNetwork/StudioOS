/**
 * D972 (#2369) — Advisors & Partners at /admin/advisors-partners, as pure
 * functions: the address and tabs, the moved notice, and the Overview's and
 * Firms' blocks built from the reads that exist today. No React here, so
 * `node --test` loads it alone.
 *
 * The reads (each answers alone; D972 §2). Every one is truthful: a D1 error
 * is a 5xx, never `[]`.
 *   - `advisors`     GET /api/advisors/admin/cohort-assignments/assignable —
 *                    accounts with the Advisor role, `has_advisor_profile`;
 *                    the first 500 by name.
 *   - `assignments`  GET /api/advisors/admin/cohort-assignments — cohort
 *                    assignments, `ended_at` null while active; newest 500.
 *   - `links`        GET /api/admin/partners/links — partner accounts with
 *                    their firm (first 500, unattached first), the firms with
 *                    their account counts (first 500), and the two totals.
 *   - `directory`    GET /api/admin/partners/directory — every firm's
 *                    directory flags, first 500.
 *   - `deals`        GET /api/admin/partners/deals?status=active — the newest
 *                    200 active deals.
 *   - `hosts`        GET /api/admin/lab-hosts?status=pending — all-time counts.
 *   - `roster`       GET /api/admin/network-profiles — every deck row.
 *
 * Guard L (D923): a list that returns exactly its cap is incomplete, and a
 * figure from it says what it covers.
 */
import { parseStamp } from '../../../ui/parseStamp.js';

export const AP_PATH = '/admin/advisors-partners';
export const AP_DECK_PATH = '/admin/advisors-partners/deck';
export const AP_FIRMS_PATH = '/admin/advisors-partners/firms';
export const COMMUNITY_PATH = '/admin/community';
export const AP_TITLE = 'Advisors & Partners';
export const PAGE_LINE = 'The advisors and operating partners the studio works with: who they are, where they stand and what they do.';
export const NOT_YET = 'Not read here yet';
export const RAIL_NOTE = 'Eadwyn reads this page. Nothing here changes until you act on it.';
const DAY = 86400000;

/** The old addresses' sentence (#2375's "renamed" form). */
export const MOVED_NOTICES = {
  'network-profiles': 'Mentor & partner network is now Advisors & Partners, under Community.',
  // D952 (#2728): Partner invitations' Firm links moved to the Firms tab.
  'firm-links': 'Firm links moved here: attach a partner account to its firm under Firms.',
};

/** The tabs this integration draws (D972 §1). People waits for its read. */
export const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'firms', label: 'Firms', path: '/firms' },
  { key: 'deck', label: 'Deck roster', path: '/deck' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === AP_PATH) return 'overview';
  const t = TABS.find((x) => x.path && p === `${AP_PATH}${x.path}`);
  return t ? t.key : null;
}

export function movedTarget(pathname, search, hash, key) {
  const next = new URLSearchParams(search || '');
  next.delete('tab');
  next.set('moved', key);
  return { pathname, search: `?${next.toString()}`, hash: hash || '' };
}

export const WAITS = {
  sessions: 'Sessions are not counted across advisor and partner office hours yet (D972 part 1).',
  settlements: 'Settlements due are read on Contracts; this page reads them with D972 part 1.',
  c1: 'Who is in the network, by stage, waits for a network stage per person (D972 parts 1 and 4).',
  c2: 'Sessions per week waits for the network overview read (D972 part 1).',
  c3: 'Skills against founder demand waits for a demand store; nothing records what founders ask for yet (D972 part 1).',
  c4: 'Active deals by type waits for the network overview read (D972 part 1).',
  people: 'People, one table of every advisor, operating partner and deck-only name, waits for the people read (D972 part 1).',
};

const nf = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;
const failed = (read) => !read || read.status === 'error';
function pending(read, reason) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (failed(read)) return { state: 'unreadable', reason };
  return null;
}
/** "[n]" or "[n]+" when the list came back at its cap. */
const capped = (n, cap) => (n >= cap ? `${nf(n)}+` : nf(n));

/** Active deals whose term ends within 30 days of now. */
export function endingSoon(deals, now) {
  return (deals || []).filter((d) => {
    const end = parseStamp(d.expires_at);
    return end != null && end >= now && end <= now + 30 * DAY;
  });
}

/** The eight tiles of AP1, in the canvas's order. */
export function buildTiles(reads, now) {
  const tiles = [];

  const a = { key: 'advisors', label: 'Advisors' };
  const ap = pending(reads.advisors, 'The advisor accounts could not be read. That is not the same as none.');
  if (ap) tiles.push({ ...a, ...ap });
  else {
    const items = reads.advisors.data?.items || [];
    const noProfile = items.filter((i) => !i.has_advisor_profile).length;
    tiles.push({ ...a, state: 'ready', value: capped(items.length, 500), sub: 'advisor accounts', warn: noProfile > 0 ? `${nf(noProfile)} have no advisor profile yet` : null });
  }

  const p = { key: 'partners', label: 'Operating partners' };
  const pp = pending(reads.links, 'The partner accounts could not be read. That is not the same as none.');
  if (pp) tiles.push({ ...p, ...pp });
  else {
    const d = reads.links.data || {};
    const n = (d.accounts || []).length;
    tiles.push({ ...p, state: 'ready', value: capped(n, 500), sub: 'partner accounts', warn: Number(d.unattached) > 0 ? `${nf(d.unattached)} not attached to a firm` : null });
  }

  const f = { key: 'firms', label: 'Firms' };
  const fp = pending(reads.links, 'The firms could not be read.');
  if (fp) tiles.push({ ...f, ...fp });
  else {
    const firms = reads.links.data?.firms || [];
    let sub;
    if (failed(reads.directory)) sub = 'the directory could not be read';
    else if (reads.directory?.status !== 'ready') sub = 'reading the directory…';
    else {
      const listed = (reads.directory.data?.partners || []).filter((x) => Number(x.directory_listed) === 1).length;
      sub = `${nf(listed)} listed in the public directory`;
    }
    tiles.push({ ...f, state: 'ready', value: capped(firms.length, 500), sub });
  }

  const d = { key: 'deals', label: 'Active partner deals' };
  const dp = pending(reads.deals, 'The partner deals could not be read.');
  if (dp) tiles.push({ ...d, ...dp });
  else {
    const items = reads.deals.data?.items || [];
    const soon = endingSoon(items, now).length;
    tiles.push({ ...d, state: 'ready', value: capped(items.length, 200), sub: items.length >= 200 ? `the newest 200 · ${nf(soon)} end within 30 days` : `${nf(soon)} end within 30 days` });
  }

  const h = { key: 'hosts', label: 'Lab office-hours hosts' };
  const hp = pending(reads.hosts, 'The office-hours hosts could not be read.');
  if (hp) tiles.push({ ...h, ...hp });
  else {
    const c = reads.hosts.data?.counts || {};
    tiles.push({ ...h, state: 'ready', value: nf(Number(c.approved || 0)), sub: `approved · ${nf(Number(c.pending || 0))} waiting, every host` });
  }

  const c = { key: 'assignments', label: 'Cohort assignments' };
  const cp = pending(reads.assignments, 'The cohort assignments could not be read.');
  if (cp) tiles.push({ ...c, ...cp });
  else {
    const items = reads.assignments.data?.items || [];
    const active = items.filter((x) => x.ended_at == null).length;
    tiles.push({ ...c, state: 'ready', value: items.length >= 500 ? `${nf(active)}+` : nf(active), sub: items.length >= 500 ? 'active, within the newest 500' : 'active' });
  }

  tiles.push({ key: 'sessions', label: 'Sessions this month', state: 'notyet', reason: WAITS.sessions });
  tiles.push({ key: 'settlements', label: 'Settlements due in 30 days', state: 'notyet', reason: WAITS.settlements });
  return tiles;
}

/**
 * Needs you: one row per readable queue holding something, each with the
 * place that acts on it. A queue that could not be read says so.
 */
export function buildNeeds(reads, now) {
  const keys = ['advisors', 'links', 'deals', 'hosts', 'roster'];
  if (!keys.every((k) => reads[k] && reads[k].status !== 'loading')) return { state: 'loading' };
  const rows = [];
  const unread = [];

  if (failed(reads.links)) unread.push('Partner accounts with no firm');
  else {
    const n = Number(reads.links.data?.unattached || 0);
    if (n > 0) rows.push({ key: 'unattached', text: `${plural(n, 'partner account')} ${n === 1 ? 'has' : 'have'} no firm.`, action: 'Attach to a firm', to: AP_FIRMS_PATH });
  }
  if (failed(reads.advisors)) unread.push('Advisor accounts with no profile');
  else {
    const n = (reads.advisors.data?.items || []).filter((i) => !i.has_advisor_profile).length;
    if (n > 0) rows.push({ key: 'no-profile', text: `${plural(n, 'advisor account')} ${n === 1 ? 'has' : 'have'} no advisor profile.`, action: 'Open accounts', to: '/admin/held/accounts' });
  }
  if (failed(reads.deals)) unread.push('Partner deals ending soon');
  else {
    const n = endingSoon(reads.deals.data?.items || [], now).length;
    if (n > 0) rows.push({ key: 'ending', text: `${plural(n, 'partner deal')} ${n === 1 ? 'ends' : 'end'} within 30 days.`, action: 'Open deals', to: '/admin/partner-invitations/deals' });
  }
  if (failed(reads.hosts)) unread.push('Office-hours hosts');
  else {
    const n = Number(reads.hosts.data?.counts?.pending ?? NaN);
    if (!Number.isFinite(n)) unread.push('Office-hours hosts');
    else if (n > 0) rows.push({ key: 'hosts', text: `${plural(n, 'office-hours host application')} ${n === 1 ? 'is' : 'are'} waiting.`, action: 'Review', to: '/admin/programs/spinout-lab/hosts' });
  }
  if (failed(reads.roster)) unread.push('Deck cards with no photo');
  else {
    const shown = (reads.roster.data?.profiles || []).filter((r) => r.is_active);
    const n = shown.filter((r) => !r.photo_url).length;
    if (n > 0) rows.push({ key: 'no-photo', text: `${plural(n, 'person')} on the deck ${n === 1 ? 'has' : 'have'} no photo.`, action: 'Edit the deck roster', to: AP_DECK_PATH });
  }
  return { state: 'ready', rows, unread };
}

/**
 * The firms table (AP5), from the three reads that hold its columns. A
 * column whose read failed says so; the rows still come from the firm list.
 */
export function buildFirms(reads, now) {
  const p = pending(reads.links, 'The firms could not be read. That is not the same as no firms.');
  if (p) return p;
  const dir = reads.directory?.status === 'ready' ? new Map((reads.directory.data?.partners || []).map((x) => [Number(x.id), x])) : null;
  const dealsOk = reads.deals?.status === 'ready';
  // A deal belongs to a partner account; the account's firm is on the links read.
  const firmOfUser = new Map((reads.links.data?.accounts || []).filter((a) => a.partner_id != null).map((a) => [Number(a.id), Number(a.partner_id)]));
  const dealsByFirm = new Map();
  if (dealsOk) {
    for (const d of reads.deals.data?.items || []) {
      const firm = firmOfUser.get(Number(d.user_id));
      if (firm == null) continue;
      const list = dealsByFirm.get(firm) || [];
      list.push(d);
      dealsByFirm.set(firm, list);
    }
  }
  const dirWord = (x) => (Number(x.directory_featured) === 1 ? 'Featured' : Number(x.directory_listed) === 1 ? 'Listed' : 'Not listed');
  const rows = (reads.links.data?.firms || []).map((f) => {
    const d = dir ? dir.get(Number(f.id)) : null;
    const deals = dealsByFirm.get(Number(f.id)) || [];
    const soonest = deals.map((x) => parseStamp(x.expires_at)).filter((x) => x != null).sort((x, y) => x - y)[0];
    return {
      id: f.id,
      name: f.name || 'Not recorded',
      company: f.company || null,
      accounts: nf(Number(f.accounts || 0)),
      specialization: d ? (d.specialization || 'Not recorded') : (dir ? 'Not recorded' : 'Could not be read'),
      directory: d ? dirWord(d) : (dir ? 'Not listed' : 'Could not be read'),
      deal: !dealsOk ? 'Could not be read' : deals.length ? `${deals.length === 1 ? deals[0].deal_type : `${nf(deals.length)} deals`}${soonest != null ? ` · ends ${new Date(soonest).toISOString().slice(0, 10)}` : ''}` : 'No active deal',
      endingSoon: soonest != null && soonest >= now && soonest <= now + 30 * DAY,
    };
  });
  return {
    state: 'ready',
    rows,
    capped: rows.length >= 500,
    unattached: Number(reads.links.data?.unattached || 0),
    dealsCapped: dealsOk && (reads.deals.data?.items || []).length >= 200,
  };
}

export function pageFailed(reads) {
  return ['advisors', 'assignments', 'links', 'directory', 'deals', 'hosts', 'roster'].every((k) => failed(reads[k]));
}

// ---------------------------------------------------------------- D1125

/**
 * One header tab's count from `GET /api/admin/network/tabs` (AP1), in the
 * shape `HeaderTab` draws: a number, a dash that says why (never a zero for a
 * count nobody could read), or the reading bar.
 */
export function tabCountOf(read, key) {
  if (!read || read.status === 'loading') return { kind: 'load' };
  if (read.status === 'error') return { kind: 'dash', tip: 'The count could not be read.' };
  const block = read.data?.[key];
  if (!block || block.available === false) return { kind: 'dash', tip: block?.reason || 'The count could not be read.' };
  if (block.recorded === false) return { kind: 'dash', tip: block.reason || 'Not recorded.' };
  const n = Number(block.value);
  return Number.isFinite(n) ? { kind: 'num', value: n.toLocaleString('en-US') } : { kind: 'dash', tip: 'The count could not be read.' };
}

/**
 * AP12b — HQ has paused this studio's admin access. Said when a write on the
 * page is refused for it (a 423 `admin_frozen` or `branch_suspended`, which
 * `lib/api.js` announces). Reading is never paused (D107, D142), so the page
 * keeps its data and says only what is true: changes wait for HQ.
 */
export const PAUSED = {
  title: 'HQ has paused this studio’s admin access.',
  line: 'You can still read everything here. Changes wait until HQ lifts the pause.',
  action: 'Contact HQ',
  to: '/admin/my-licence',
};
export const PAUSE_EVENTS = ['studioos:admin_frozen', 'studioos:branch_suspended'];

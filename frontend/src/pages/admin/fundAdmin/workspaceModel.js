/**
 * D4812 (#4812) — Fund administration v2's words and rules, pure: the six
 * workspaces over today's addresses (FA-10), the one fund-scope control
 * (FA-08), the context-aware primary action, and the Overview's Needs
 * attention, Fund position, Funds and Recent activity (FA-01).
 *
 * Nothing here reads. Each function takes what the console already read
 * (`/api/fund-admin/overview`, `/access`, `/api/fund-performance`, and
 * `/api/fund-admin/activity`) and keeps the canvas's three money states
 * apart: a figure, `Not recorded` with its reason, or `Unreadable`. A block
 * that did not read never becomes 0 or "nothing waiting".
 */
import { BASE, actRow, money } from './fundAdminModel.js';

/**
 * The six workspaces (FA-10). Each owns the views that already exist at their
 * own addresses (D1157), so every old link still opens where it did; the
 * workspace's own link is its first part. Funds is not a workspace: it is the
 * scope control's context and each fund's page.
 */
export const WORKSPACES = Object.freeze([
  { key: 'overview', label: 'Overview', path: '', parts: [] },
  { key: 'investors', label: 'Investors', path: 'lps', parts: [{ key: 'lps', label: 'LP roster', path: 'lps' }] },
  { key: 'capital', label: 'Capital', path: 'calls', parts: [
    { key: 'calls', label: 'Capital calls', path: 'calls' },
    { key: 'distributions', label: 'Distributions', path: 'distributions' },
  ] },
  { key: 'portfolio', label: 'Portfolio', path: 'performance', parts: [{ key: 'performance', label: 'NAV & performance', path: 'performance' }] },
  { key: 'reporting', label: 'Reporting', path: 'reports', parts: [
    { key: 'reports', label: 'Reports', path: 'reports' },
    { key: 'fees', label: 'Fees', path: 'fees' },
  ] },
  { key: 'banking', label: 'Banking & Books', path: 'banking', parts: [
    { key: 'banking', label: 'Transactions', path: 'banking' },
    { key: 'reconciliation', label: 'Reconciliation', path: 'banking/reconciliation' },
    { key: 'books', label: 'Books', path: 'banking/books' },
  ] },
]);

/** The workspace a view sits in; `funds` (the fund list and a fund's page) sits in none. */
export function workspaceOf(view) {
  if (view === 'overview') return 'overview';
  return WORKSPACES.find((w) => w.parts.some((p) => p.key === view))?.key ?? null;
}

const ok = (block) => block?.state === 'ok' && Array.isArray(block.items);
const inScope = (fundId) => (x) => fundId == null || Number(x.fund_id) === Number(fundId);
const sum = (items, f) => items.reduce((n, x) => n + (Number.isSafeInteger(Number(f(x))) ? Number(f(x)) : 0), 0);

/**
 * The amber flags on the workspaces, from the overview only and inside the
 * scope: overdue call lines on Capital, prepared packs on Reporting, bank
 * matches on Banking & Books. A block that did not read flags nothing; a
 * workspace with nothing waiting carries no count at all (never "—").
 */
export function workspaceFlags(overview, fundId = null) {
  const funds = ok(overview?.funds) ? overview.funds.items.filter(inScope(fundId)) : [];
  const drafts = ok(overview?.drafts) ? overview.drafts.items.filter((d) => (fundId == null ? true : Number(d.fund_id) === Number(fundId))) : [];
  const matches = ok(overview?.matches) ? overview.matches.items.filter(inScope(fundId)) : [];
  const flag = (n, key) => (n > 0 ? { kind: 'flag', value: n, testId: `fund-admin-flag-${key}` } : null);
  return {
    capital: flag(sum(funds, (f) => f.overdue_lines), 'capital'),
    reporting: flag(sum(drafts, (d) => d.prepared), 'reporting'),
    banking: flag(sum(matches, (m) => Number(m.proposed || 0) + Number(m.needs_review || 0)), 'banking'),
  };
}

/** Views whose figures are Axal entities', not a fund's: the scope control says so instead of choosing. */
export const ENTITY_VIEWS = Object.freeze(['banking', 'reconciliation']);
export const ENTITY_SCOPE = 'Axal entities · banking is read per entity';

/** "Updated 14:30 UTC", from the moment the overview last answered. */
export function updatedText(at) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
  return `Updated ${at.toISOString().slice(11, 16)} UTC`;
}

// ─────────────────────────────────────────────────────────── the primary action

const fundsIn = (overview, fundId) => (ok(overview?.funds) ? overview.funds.items.filter(inScope(fundId)) : null);

/**
 * The header's one primary action, from state (FA-01, FA-05d). It is never
 * "New capital call" on a fund with nothing committed, and never a money act
 * while the act table could not be read. On the Overview it is the most
 * urgent thing waiting; with nothing waiting it is the next step for the
 * scope. Other workspaces keep D1160's primary (`fallback`).
 */
export function primaryAction({ view, access, overview, fundId = null, fallback = null }) {
  const issue = actRow(access, 'capital_call.issue')?.allowed === true;
  const callAct = () => (access ? { label: issue ? 'New capital call' : 'Preview a capital call', to: `${BASE}/calls${fundId != null ? `?fund=${fundId}` : ''}` } : null);
  const q = (id) => (id != null ? `?fund=${id}` : '');
  if (view === 'overview') {
    const funds = fundsIn(overview, fundId);
    if (!funds) return null;
    if (funds.length === 0) return fundId == null ? { label: 'New fund', to: `${BASE}/funds?new=1` } : null;
    const overdue = funds.find((f) => Number(f.overdue_lines) > 0);
    if (overdue) return { label: 'Review overdue lines', to: `${BASE}/calls?fund=${overdue.fund_id}` };
    const matches = ok(overview.matches) ? sum(overview.matches.items.filter(inScope(fundId)), (m) => Number(m.proposed || 0) + Number(m.needs_review || 0)) : 0;
    if (matches > 0) return { label: `Reconcile ${matches}`, to: `${BASE}/banking/reconciliation` };
    const packs = ok(overview.drafts) ? sum(overview.drafts.items.filter((d) => d.fund_id != null && inScope(fundId)(d)), (d) => d.prepared) : 0;
    if (packs > 0) return { label: `Review ${packs} pack${packs === 1 ? '' : 's'}`, to: `${BASE}/reports${q(fundId)}` };
    const empty = funds.find((f) => Number(f.committed_cents) === 0);
    if (empty) return { label: 'Add LP', to: `${BASE}/lps?add=1&fund=${empty.fund_id}` };
    return callAct();
  }
  if (view === 'calls' && fundId != null) {
    const f = (fundsIn(overview, fundId) || [])[0];
    if (f && Number(f.committed_cents) === 0) return { label: 'Add LP', to: `${BASE}/lps?add=1&fund=${f.fund_id}` };
  }
  if (fallback && !access && /capital call|distribution/i.test(fallback.label)) return null;
  return fallback;
}

// ─────────────────────────────────────────────────────────── Needs attention

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * FA-01's Needs attention, overdue money first: `{ items, unreadable }`.
 * Each item is `{ key, fund, issue, meta, amount, state, action: { label, to } }`.
 * `unreadable` names each source that did not read, so an empty list is
 * "nothing waits" only when every source answered.
 */
export function attentionItems(overview, fundId = null) {
  const items = [];
  const unreadable = [];
  const funds = ok(overview?.funds) ? overview.funds.items.filter(inScope(fundId)) : null;
  if (!funds) unreadable.push('funds');
  const name = new Map((funds || []).map((f) => [Number(f.fund_id), f.name || `Fund #${f.fund_id}`]));
  const entityName = new Map((ok(overview?.entities) ? overview.entities.items : []).map((e) => [e.entity_key, e.name]));

  for (const f of funds || []) {
    const n = Number(f.overdue_lines) || 0;
    if (n > 0) {
      items.push({ key: `overdue-${f.fund_id}`, fund: name.get(Number(f.fund_id)), issue: `${plural(n, 'capital-call line')} overdue`,
        meta: f.next_due_date ? `Next line due ${f.next_due_date}` : 'Past their due date', amount: null, state: 'Overdue',
        action: { label: 'Open lines', to: `${BASE}/calls?fund=${f.fund_id}` } });
    }
  }
  if (ok(overview?.matches)) {
    for (const m of overview.matches.items.filter(inScope(fundId))) {
      const n = Number(m.proposed || 0) + Number(m.needs_review || 0);
      if (n > 0 && name.has(Number(m.fund_id))) {
        items.push({ key: `match-${m.fund_id}`, fund: name.get(Number(m.fund_id)), issue: `${plural(n, 'bank transaction')} to match`,
          meta: `${m.proposed || 0} proposed · ${m.needs_review || 0} need review`, amount: null, state: 'Needs match',
          action: { label: 'Reconcile', to: `${BASE}/banking/reconciliation` } });
      }
    }
  } else if (funds) unreadable.push('matches');
  if (ok(overview?.drafts)) {
    for (const d of overview.drafts.items) {
      const n = Number(d.prepared) || 0;
      if (n <= 0) continue;
      if (d.fund_id != null && name.has(Number(d.fund_id))) {
        items.push({ key: `packs-${d.fund_id}`, fund: name.get(Number(d.fund_id)), issue: `${plural(n, 'report pack')} ready to issue`,
          meta: 'Prepared, waiting for review', amount: null, state: 'Prepared', action: { label: 'Review packs', to: `${BASE}/reports?fund=${d.fund_id}` } });
      } else if (d.fund_id == null && fundId == null) {
        items.push({ key: `packs-${d.entity_key}`, fund: entityName.get(d.entity_key) || d.entity_key, issue: `${plural(n, 'entity report')} ready to issue`,
          meta: 'Prepared, waiting for review', amount: null, state: 'Prepared', action: { label: 'Review packs', to: `${BASE}/reports` } });
      }
    }
  } else unreadable.push('drafts');
  if (ok(overview?.booklets)) {
    for (const b of overview.booklets.items.filter(inScope(fundId))) {
      const n = Number(b.waiting) || 0;
      if (n > 0 && name.has(Number(b.fund_id))) {
        items.push({ key: `booklets-${b.fund_id}`, fund: name.get(Number(b.fund_id)), issue: `${plural(n, 'subscription booklet')} awaiting the GP`,
          meta: 'Signed by the applicant', amount: null, state: 'Awaiting', action: { label: 'Review', to: `${BASE}/lps?fund=${b.fund_id}&booklet=submitted` } });
      }
    }
  } else if (funds && overview?.booklets) unreadable.push('booklets');
  for (const f of funds || []) {
    if (Number(f.committed_cents) === 0) {
      items.push({ key: `setup-${f.fund_id}`, fund: name.get(Number(f.fund_id)), issue: 'Fund setup incomplete',
        meta: 'No commitment is recorded', amount: null, state: 'Open', action: { label: 'Add LP', to: `${BASE}/lps?add=1&fund=${f.fund_id}` } });
    }
  }
  return { items, unreadable };
}

// ─────────────────────────────────────────────────────────── Fund position

/**
 * FA-01's six figures for the scope. Committed, called, received and
 * outstanding come from the overview's funds block; NAV and distributed from
 * the performance list, NAV with its own date. A sum is drawn only when every
 * fund in scope holds the figure: one fund without it makes the total
 * `not_recorded` with the reason, and a failed read makes it `unreadable`.
 */
export function fundPosition(overview, performance, fundId = null) {
  const funds = ok(overview?.funds) ? overview.funds.items.filter(inScope(fundId)) : null;
  const ledger = (key, label) => {
    if (!funds) return { key, label, state: 'unreadable' };
    if (funds.length === 0) return { key, label, state: 'not_recorded', reason: 'No administered fund is recorded.' };
    const missing = funds.filter((f) => !Number.isSafeInteger(Number(f[`${key}_cents`])) || f[`${key}_cents`] == null);
    if (missing.length) return { key, label, state: 'not_recorded', reason: `${missing[0].name} has no ${label.toLowerCase()} figure recorded.` };
    return { key, label, state: 'ok', cents: sum(funds, (f) => f[`${key}_cents`]) };
  };
  const perf = (key, field, label) => {
    if (performance?.status === 'unreadable') return { key, label, state: 'unreadable' };
    if (performance?.status !== 'ready' || !funds) return { key, label, state: funds ? 'loading' : 'unreadable' };
    const rows = Array.isArray(performance.data?.items) ? performance.data.items : [];
    const want = funds.map((f) => rows.find((r) => Number(r.id) === Number(f.fund_id)) || { name: f.name, missing: true });
    if (want.length === 0) return { key, label, state: 'not_recorded', reason: 'No administered fund is recorded.' };
    const gap = want.find((r) => r.missing || r[field] == null || !Number.isSafeInteger(Number(r[field])));
    if (gap) return { key, label, state: 'not_recorded', reason: gap.unavailable?.[field] || `${gap.name || 'A fund'} has no ${label} recorded.` };
    return { key, label, state: 'ok', cents: sum(want, (r) => r[field]), note: key === 'nav' && performance.data?.as_of ? `latest marks to ${performance.data.as_of}` : null };
  };
  return [
    ledger('committed', 'Committed'), ledger('called', 'Called'), ledger('received', 'Received'), ledger('outstanding', 'Outstanding'),
    perf('nav', 'nav_cents', 'NAV'), perf('distributed', 'distributed_cents', 'Distributed'),
  ];
}

// ─────────────────────────────────────────────────────────── Funds (health rows)

const STATUS = { active: 'Active', fundraising: 'Fundraising', closed: 'Closed', setting_up: 'Setting up', draft: 'Setting up' };

/**
 * FA-01's compact fund rows: identity, two figures, and what waits, or one
 * quiet line when nothing does. A source that did not read says so on the row.
 */
export function healthRows(overview, performance, fundId = null) {
  if (!ok(overview?.funds)) return null;
  const perfRows = performance?.status === 'ready' && Array.isArray(performance.data?.items) ? performance.data.items : [];
  const by = (block) => new Map((ok(block) ? block.items : []).filter((x) => x.fund_id != null).map((x) => [Number(x.fund_id), x]));
  const drafts = by(overview.drafts); const matches = by(overview.matches); const fees = by(overview.fees);
  return overview.funds.items.filter(inScope(fundId)).map((f) => {
    const id = Number(f.fund_id);
    const p = perfRows.find((r) => Number(r.id) === id);
    const ident = [p?.status ? STATUS[p.status] || p.status : null, p?.vintage_year ? `Vintage ${p.vintage_year}` : null].filter(Boolean).join(' · ');
    const chips = [];
    const quiet = [];
    const overdue = Number(f.overdue_lines) || 0;
    if (overdue > 0) chips.push({ key: 'overdue', state: 'Overdue', text: `${plural(overdue, 'line')} overdue` });
    else quiet.push(f.next_due_date ? `Next due ${f.next_due_date}` : 'No line due');
    if (!ok(overview.drafts)) chips.push({ key: 'drafts', state: 'Unreadable', text: 'Reports unreadable' });
    else if (Number(drafts.get(id)?.prepared) > 0) chips.push({ key: 'drafts', state: 'Prepared', text: `${drafts.get(id).prepared} ready to issue` });
    else quiet.push(Number(drafts.get(id)?.draft) > 0 ? `${plural(Number(drafts.get(id).draft), 'draft')} in progress` : 'No reports waiting');
    if (!ok(overview.matches)) chips.push({ key: 'matches', state: 'Unreadable', text: 'Matches unreadable' });
    else {
      const m = matches.get(id); const n = m ? Number(m.proposed || 0) + Number(m.needs_review || 0) : 0;
      if (n > 0) chips.push({ key: 'matches', state: 'Needs match', text: `${n} to match` });
      else quiet.push('No bank match waiting');
    }
    const fee = !ok(overview.fees) ? { state: 'unreadable' } : fees.get(id)?.state === 'ok'
      ? { state: 'ok', text: `Fees ${fees.get(id).quarter} · ${fees.get(id).status}` } : { state: 'not_recorded', text: fees.get(id)?.reason || 'No fee period yet' };
    return { id, name: f.name || `Fund #${id}`, ident, committed: f.committed_cents, outstanding: f.outstanding_cents, chips, quiet, fee,
      setup: Number(f.committed_cents) === 0 };
  });
}

// ─────────────────────────────────────────────────────────── Recent activity

/** The time column: "14:12" today, "6 Nov" earlier, from the audit row's UTC time. */
export function activityTime(at, now = new Date()) {
  const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(at || '');
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (day === now.toISOString().slice(0, 10)) return `${m[4]}:${m[5]}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}${m[1] === now.toISOString().slice(0, 4) ? '' : ` ${m[1]}`}`;
}

/** One activity row's words: what happened, to whom, and the amount (or nothing — never $0 for none). */
export function activityRow(item) {
  const what = [item.label, item.lp_name, item.call_number != null ? `call ${item.call_number}` : null].filter(Boolean).join(' · ');
  return {
    id: item.id,
    fund: item.fund_name || (item.fund_id != null ? `Fund #${item.fund_id}` : 'No fund recorded'),
    what,
    amount: item.amount_cents != null ? money(item.amount_cents) : null,
    actor: item.actor_name || 'An admin',
    ref: `audit #${item.id}`,
  };
}

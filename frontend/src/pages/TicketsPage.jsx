import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Search, RefreshCw } from 'lucide-react';
import { safeReadJSON } from '../lib/storage';
import { api } from '../lib/api';
import { isSuperAdminUser } from '../lib/shellRole';
import { TICKET_CATEGORIES } from '../lib/ticketCategories';
import { createDocsFuse } from '../lib/docs/search';
import { SECTIONS, filterSectionsForRole } from './docs/sections';
import { guideHref, readingMinutes } from './docs/helpCenter';
import BountyBadge from '../components/tickets/BountyBadge';
import { bountyLine } from '../components/tickets/BountyBadge';
import ReviewBadge from '../components/tickets/ReviewBadge';
import {
  TONE, TICKET_TYPES, TICKET_PRIORITIES, TICKET_STATUSES, STATUS_TABS, NO_FILTERS, EMPTY_FORM,
  typeChip, priorityChip, statusChip, categoryChip, categoryLabel, slaChip, tierLine,
  reviewLine, bountyPanel, tabCounts, visibleTickets, hasFilters, formErrors, guidesForTitle,
  detailFailure, threadSpeaker, dayOf, momentOf,
} from '../lib/ticketScreens';

// ---------------------------------------------------------------------------
// D604 (#1280 step 4) — the ticket screens, built to their canvas.
//
// `design/canvases/integrated/Help Ticket Screen.dc.html` draws them:
//   H3  a member's tickets: tabs by status, Type and Category filters, rows
//       with every chip, and the three states (loading, none, unreadable);
//   H4  the form: Title and Type required, Type with no default (D544), the
//       priorities with what each is for, and the guides that may answer it;
//   H5  one ticket: the description, the thread by side, the reply box (open
//       only once the ticket is on the tracker), and a rail with the tracker
//       and the bounty (H5b: a feature request's review, with its reason);
//   H6  the admin queue: every member's tickets, with requester, SLA and
//       tracker columns, a title search, and the missing-issue banner;
//   H7  one ticket as an admin sees it: status and assignee controls, the
//       mirror state with its error, and a retry for that one ticket.
//
// The list was one page with an inline form and a GitHub-login comment list.
// The addresses are unchanged: `/help/tickets`, `/help/tickets/<id>`, and
// `?new=1` for the form (D599's "Open a ticket").
// ---------------------------------------------------------------------------

const LABEL = 'font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400';
const CARD = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const PRIMARY = 'inline-flex items-center justify-center whitespace-nowrap rounded-[9px] bg-violet-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = 'inline-flex items-center justify-center whitespace-nowrap rounded-[9px] border border-gray-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:border-violet-200 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-violet-300';
const INPUT = 'w-full rounded-[9px] border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const PANEL_TONE = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  grey: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
// The admin queue's eight columns (H6), from the large breakpoint up; below
// it each row stacks.
const QUEUE_COLUMNS = 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_92px_100px_104px_minmax(150px,1.6fr)_120px]';
const PAGE = 50;

function Chip({ chip }) {
  return chip ? <span className={chip.className}>{chip.text}</span> : null;
}

function Crumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      {items.map((c, i) => (
        <span key={`${i}-${c.label}`} className="flex gap-1.5">
          {i > 0 && <span aria-hidden>/</span>}
          {c.to ? (
            <Link to={c.to} className="hover:text-violet-700 dark:hover:text-violet-300">{c.label}</Link>
          ) : (
            <span aria-current="page" className="text-gray-900 dark:text-gray-100">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function ScreenHeader({ crumbs, title, pills, action }) {
  return (
    <header className="flex flex-col gap-3">
      <Crumbs items={crumbs} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="m-0 text-[20px] font-extrabold leading-tight tracking-tight text-gray-900 md:text-2xl dark:text-gray-100">{title}</h1>
          {pills && pills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{pills.map((p, i) => <Chip key={`${i}-${p.text}`} chip={p} />)}</div>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}

/** A state the canvas names: loading, none, not found, unreadable. */
function StateNote({ tone = 'grey', children, action, role }) {
  return (
    <div role={role} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-[13px] ${PANEL_TONE[tone]}`}>
      <span>{children}</span>
      {action}
    </div>
  );
}

function SkeletonRows({ rows = 3, label }) {
  return (
    <div className="grid gap-3 px-4 py-4" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-2">
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

const firstLine = (text) => String(text || '').split('\n').find((l) => l.trim()) || '';

// ---------------------------------------------------------------------------
// H6's banner: saved tickets that never reached the tracker
// ---------------------------------------------------------------------------

export function TicketGithubRecovery({ isAdmin, pending, configured, busy, onRetry }) {
  if (!isAdmin || !pending) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="min-w-0 text-[13px]">
        <p className="font-semibold">{pending} saved ticket{pending === 1 ? ' is' : 's are'} not on the tracker.</p>
        <p className="mt-1 text-[12.5px]">
          A Super Admin checks the token in <a href="/admin/integration-keys#github" className="underline">HQ → Integration keys → GitHub Sync</a> using Test issue creation.
          {' '}Once that passes, retry here to create up to 25 missing issues. Ticket titles and descriptions are sent to the configured GitHub repository; no name or email is.
        </p>
        {configured === false && <p className="mt-1 text-[12.5px]">Configure GitHub Sync before retrying.</p>}
      </div>
      <button type="button" disabled={busy || configured !== true} onClick={onRetry}
        className="whitespace-nowrap rounded-[9px] border border-amber-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200 dark:hover:bg-amber-950/40">
        {busy ? 'Retrying…' : 'Create missing GitHub issues (up to 25)'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// H3 / H6 — the list
// ---------------------------------------------------------------------------

const EMPTY_TAB = {
  open: 'No open tickets.',
  in_progress: 'No tickets in progress.',
  resolved: 'No resolved tickets.',
  closed: 'No closed tickets.',
  all: 'No tickets.',
};

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none rounded-[9px] border border-gray-200 bg-white py-2 pl-3 pr-8 text-[12.5px] font-semibold text-gray-700 hover:border-violet-200 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
        {children}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">▾</span>
    </label>
  );
}

export function MemberRow({ t }) {
  return (
    <li className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
      <Link to={`/help/tickets/${t.id}`} className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-violet-50/60 dark:hover:bg-violet-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{t.title}</span>
          <span className="whitespace-nowrap font-mono text-[11px] text-gray-500 dark:text-gray-400">Updated {dayOf(t.updated_at || t.created_at) || '—'}</span>
        </div>
        {t.description && <div className="truncate text-[12.5px] text-gray-500 dark:text-gray-400">{firstLine(t.description)}</div>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip chip={typeChip(t.type)} />
          <Chip chip={categoryChip(t.category)} />
          <Chip chip={priorityChip(t.priority)} />
          <Chip chip={statusChip(t.status)} />
          <BountyBadge bounty={t.bounty} />
          <ReviewBadge review={t.review} />
        </div>
      </Link>
    </li>
  );
}

export function QueueRow({ t }) {
  const sla = slaChip(t.sla);
  return (
    <li className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
      <Link to={`/help/tickets/${t.id}`} className={`grid grid-cols-1 gap-x-3 gap-y-1.5 px-4 py-3 text-[13px] hover:bg-violet-50/60 lg:items-center dark:hover:bg-violet-950/20 ${QUEUE_COLUMNS}`}>
        <span className="min-w-0">
          <span className="block font-bold text-gray-900 dark:text-gray-100">{t.title}</span>
          {t.description && <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{firstLine(t.description)}</span>}
        </span>
        <span className="truncate font-semibold text-violet-700 dark:text-violet-300">{t.submitted_by || '—'}</span>
        <span className="text-[12.5px] text-gray-600 dark:text-gray-300">{categoryLabel(t.category)}</span>
        <span className="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-start lg:gap-0.5">
          <Chip chip={priorityChip(t.priority)} />
          <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{tierLine(t.sla)}</span>
        </span>
        <span>{sla ? <Chip chip={sla} /> : <span className="text-xs text-gray-400">—</span>}</span>
        <span className="flex flex-wrap gap-1.5"><Chip chip={statusChip(t.status)} /><Chip chip={typeChip(t.type)} /></span>
        <span className="flex min-w-0 flex-wrap gap-1.5">
          <BountyBadge bounty={t.bounty} />
          <ReviewBadge review={t.review} />
        </span>
        <span className={`font-mono text-[11.5px] ${t.github_issue_number ? 'text-violet-700 dark:text-violet-300' : 'text-amber-800 dark:text-amber-300'}`}>
          {t.github_issue_number ? `#${t.github_issue_number}` : 'Not on the tracker'}
        </span>
      </Link>
    </li>
  );
}

function TicketList({ isAdmin }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');
  const [tab, setTab] = useState('open');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [githubConfigured, setGithubConfigured] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState(null);

  // A failed read is said as one. A reply that is not a list is a failed
  // read too: it must never become "you have no tickets".
  const load = useCallback(() => {
    setStatus('loading');
    api.listTickets()
      .then((data) => {
        if (Array.isArray(data)) { setRows(data); setStatus('ok'); } else setStatus('error');
      })
      .catch(() => setStatus('error'));
  }, []);

  // The sync route refreshes each mirrored ticket from GitHub and sends back
  // the same rows the list does (D604), so taking them keeps every chip.
  const syncFromGithub = useCallback(() => {
    api.syncTickets()
      .then((data) => {
        setGithubConfigured(data?.github_configured === true);
        if (Array.isArray(data?.tickets)) { setRows(data.tickets); setStatus('ok'); }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    syncFromGithub();
    const interval = setInterval(syncFromGithub, 60000);
    return () => clearInterval(interval);
  }, [load, syncFromGithub]);

  useEffect(() => { setShown(PAGE); }, [tab, filters]);

  const retryGithub = async () => {
    if (!isAdmin || retrying) return;
    setRetrying(true);
    try {
      const data = await api.syncTickets({ backfill: true });
      if (Array.isArray(data?.tickets)) setRows(data.tickets);
      setGithubConfigured(data?.github_configured === true);
      const errors = data?.backfill_errors || [];
      setNotice({
        tone: errors.length ? 'amber' : 'grey',
        text: `Created ${data?.backfilled || 0} GitHub issues. ${data?.unsynced_count} tickets still need an issue.`
          + (errors.length ? ` GitHub reported: ${errors[0].error}. Check GitHub Sync before retrying.` : '')
          + (!data?.github_configured ? ' GitHub Sync is not configured.' : ''),
      });
    } catch (e) {
      setNotice({ tone: 'amber', text: e?.message || 'Could not retry GitHub sync.' });
    } finally {
      setRetrying(false);
    }
  };

  const counts = useMemo(() => tabCounts(rows, filters), [rows, filters]);
  const visible = useMemo(() => visibleTickets(rows, tab, filters), [rows, tab, filters]);
  const pending = rows.filter((t) => !t.github_issue_number).length;
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const listTitle = isAdmin ? 'All tickets' : 'Your tickets';
  const filtered = hasFilters(filters);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <ScreenHeader
        crumbs={[{ label: 'Help', to: '/help' }, { label: listTitle }]}
        title={listTitle}
        action={!isAdmin && <Link to="/help/tickets?new=1" className={PRIMARY}>Open a ticket</Link>}
      />

      {status === 'ok' && (
        <TicketGithubRecovery isAdmin={isAdmin} pending={pending} configured={githubConfigured} busy={retrying} onRetry={retryGithub} />
      )}
      {notice && <StateNote tone={notice.tone} role="status">{notice.text}</StateNote>}

      <div role="tablist" aria-label="Ticket status" className="flex flex-nowrap gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
        {STATUS_TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-bold ${on ? 'border-violet-600 text-violet-700 dark:text-violet-300' : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}>
              {t.label}
              <span className="font-mono text-[11px] opacity-70">{status === 'ok' ? counts[t.id] : '·'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-[9px] border border-gray-200 bg-white px-3 py-2 sm:flex-none dark:border-gray-700 dark:bg-gray-900">
            <Search size={14} aria-hidden className="text-gray-400" />
            <span className="sr-only">Search by title</span>
            <input type="search" value={filters.query} onChange={(e) => setFilter('query')(e.target.value)} placeholder="Search by title…"
              className="w-full bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100" />
          </label>
        )}
        <FilterSelect label="Type" value={filters.type} onChange={setFilter('type')}>
          <option value="">Type: all</option>
          {TICKET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </FilterSelect>
        <FilterSelect label="Category" value={filters.category} onChange={setFilter('category')}>
          <option value="">Category: all</option>
          {TICKET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          <option value="none">No category</option>
        </FilterSelect>
        {isAdmin && (
          <>
            <FilterSelect label="Priority" value={filters.priority} onChange={setFilter('priority')}>
              <option value="">Priority: all</option>
              {TICKET_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </FilterSelect>
            <FilterSelect label="SLA" value={filters.sla} onChange={setFilter('sla')}>
              <option value="">SLA: all</option>
              <option value="ok">On time</option>
              <option value="due_soon">Due soon</option>
              <option value="past">Overdue</option>
            </FilterSelect>
          </>
        )}
        <span className="ml-auto font-mono text-[11px] text-gray-500 dark:text-gray-400">
          {status === 'ok' ? `${visible.length} ticket${visible.length === 1 ? '' : 's'}${isAdmin ? ' · every member' : ''}` : ''}
        </span>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        {status === 'loading' && <SkeletonRows label={isAdmin ? 'Loading the queue' : 'Loading your tickets'} />}

        {status === 'error' && (
          <div className="p-4">
            <StateNote tone="red" role="alert" action={<button type="button" onClick={load} className="text-xs font-bold underline">Try again</button>}>
              {isAdmin ? 'The queue could not be read.' : 'Your tickets could not be read.'}
            </StateNote>
          </div>
        )}

        {status === 'ok' && rows.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-gray-600 dark:text-gray-300">
            <span>{isAdmin ? 'No member has opened a ticket yet.' : 'You have not opened a ticket.'}</span>
            {!isAdmin && <Link to="/help/tickets?new=1" className={SECONDARY}>Open a ticket</Link>}
          </div>
        )}

        {status === 'ok' && rows.length > 0 && visible.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-gray-600 dark:text-gray-300">
            <span>{filtered ? 'No tickets match these filters.' : EMPTY_TAB[tab]}</span>
            {filtered && <button type="button" onClick={() => setFilters(NO_FILTERS)} className={SECONDARY}>Clear filters</button>}
          </div>
        )}

        {status === 'ok' && visible.length > 0 && isAdmin && (
          <>
            <div aria-hidden className={`hidden gap-3 border-b border-gray-100 px-4 py-2.5 lg:grid dark:border-gray-800 ${QUEUE_COLUMNS} ${LABEL}`}>
              <span>Ticket</span><span>Requester</span><span>Category</span><span>Priority</span><span>SLA</span><span>Status</span><span>Bounty / review</span><span>Tracker</span>
            </div>
            <ul aria-label={`Tickets, ${visible.length}`}>
              {visible.slice(0, shown).map((t) => <QueueRow key={t.id} t={t} />)}
            </ul>
          </>
        )}

        {status === 'ok' && visible.length > 0 && !isAdmin && (
          <ul aria-label={`Your tickets, ${visible.length}`}>
            {visible.slice(0, shown).map((t) => <MemberRow key={t.id} t={t} />)}
          </ul>
        )}
      </div>

      {status === 'ok' && visible.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`${SECONDARY} self-center`}>
          Show {Math.min(PAGE, visible.length - shown)} more
        </button>
      )}

      {isAdmin && (
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          SLA tiers: urgent is P1, high is P2, medium and low are P3. HQ sets each tier's hours in HQ · Support; the clock stops once a ticket is resolved or closed.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// H4 — the form
// ---------------------------------------------------------------------------

function ChoiceCard({ name, value, checked, onChange, title, note, inputRef }) {
  return (
    <label className={`flex cursor-pointer flex-col gap-0.5 rounded-[9px] border px-3 py-2.5 focus-within:ring-2 focus-within:ring-violet-500/30 ${checked ? 'border-violet-600 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40' : 'border-gray-200 bg-white hover:border-violet-200 dark:border-gray-700 dark:bg-gray-900'}`}>
      <input ref={inputRef} type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{title}</span>
      <span className="text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">{note}</span>
    </label>
  );
}

function FieldError({ id, children }) {
  return children ? <p id={id} role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{children}</p> : null;
}

function TicketForm({ isAdmin, role }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef(null);
  const typeRef = useRef(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // "These guides may answer it": the Help Center's own index, scoped to the
  // reader's role, so it never suggests a guide the reader cannot open.
  const fuse = useMemo(() => createDocsFuse(role), [role]);
  const sectionsById = useMemo(
    () => Object.fromEntries(filterSectionsForRole(SECTIONS, role).map((s) => [s.id, s])),
    [role],
  );
  const guides = useMemo(
    () => guidesForTitle(fuse, form.title, sectionsById, readingMinutes),
    [fuse, form.title, sectionsById],
  );

  const submit = async (e) => {
    e.preventDefault();
    const found = formErrors(form);
    setErrors(found);
    setSubmitError(null);
    if (found.title) { titleRef.current?.focus(); return; }
    if (found.type) { typeRef.current?.focus(); return; }
    setSubmitting(true);
    try {
      // THE RESPONSE WAS DISCARDED HERE ONCE, AND THAT WAS THE WHOLE DEFECT ON
      // THIS SURFACE. `POST /api/tickets` has always returned
      // `github_sync_status` — synced | failed | not_configured — and on a
      // failure a `github_sync_error` naming the cause. The form threw all of
      // it away, so a ticket that never reached the issue tracker looked
      // exactly like one that did, to admin and founder alike.
      //
      // Same two-audience split the advisor uses: a `failed` mirror is said
      // to EVERYONE, because anyone expecting the ticket on the board needs
      // to know it will not appear; `not_configured` is said only to an
      // admin, because it names a deployment secret a founder cannot act on.
      // The outcome is the canvas's H4 "after submit", shown on the ticket.
      const res = await api.createTicket(form);
      const status = res?.github_sync_status || null;
      const reason = String(res?.github_sync_error || '').trim();
      const saved = 'Saved. Replies open once it reaches the tracker';
      let outcome;
      if (status === 'synced') {
        outcome = { tone: 'green', title: `Ticket #${res.id} opened`, text: 'Saved and mirrored to the tracker. Replies are open.' };
      } else if (status === 'failed') {
        let text = `It did not reach the tracker${reason ? `: ${reason}` : '.'}`;
        // The reason is GitHub's own error prose and does not always end in
        // punctuation — normalise before the next sentence, or the two run
        // together with no separator between them.
        if (reason && !/[.!?]$/.test(reason)) text += '.';
        text += ' An admin can retry it from the ticket queue, and you can follow it from Your tickets.';
        if (isAdmin) {
          text += ' A Super Admin can look into it in HQ → Integration keys → GitHub Sync — Test issue creation there will say exactly what the token is missing.';
        }
        outcome = { tone: 'amber', title: saved, text };
      } else if (status === 'not_configured' && isAdmin) {
        outcome = { tone: 'amber', title: saved, text: 'The GitHub mirror is not configured in this environment, so no issue was opened — a Super Admin sets it up in HQ → Integration keys → GitHub Sync.' };
      } else {
        outcome = { tone: 'amber', title: saved, text: 'You can follow it from Your tickets.' };
      }
      navigate(res?.id ? `/help/tickets/${res.id}` : '/help/tickets', { state: { outcome } });
    } catch (err) {
      // The Worker's 400 names the field it refused.
      const msg = err?.message || '';
      if (/^type\b/i.test(msg)) setErrors({ type: 'Type is required. Pick Task, Bug or Feature.' });
      else if (/^title\b/i.test(msg)) setErrors({ title: 'Title is required, at most 200 characters.' });
      else setSubmitError(msg ? `The ticket was not saved: ${msg}` : 'The ticket was not saved. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <ScreenHeader
        crumbs={[{ label: 'Help', to: '/help' }, { label: isAdmin ? 'All tickets' : 'Your tickets', to: '/help/tickets' }, { label: 'Open a ticket' }]}
        title="Open a ticket"
      />
      <form onSubmit={submit} noValidate className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className={`${CARD} flex flex-col gap-4 px-5 py-5`}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ticket-title" className={LABEL}>Title <span className="text-red-700 dark:text-red-300">·</span> required</label>
            <input id="ticket-title" ref={titleRef} type="text" value={form.title} onChange={set('title')} maxLength={200}
              aria-invalid={!!errors.title} aria-describedby={errors.title ? 'ticket-title-error' : undefined}
              placeholder="Say what is wrong or what you need, in a line" className={INPUT} />
            <FieldError id="ticket-title-error">{errors.title}</FieldError>
          </div>

          <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.type ? 'ticket-type-error' : undefined}>
            <legend className={`${LABEL} mb-1.5`}>Type <span className="text-red-700 dark:text-red-300">·</span> required, no default</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TICKET_TYPES.map((t, i) => (
                <ChoiceCard key={t.id} name="ticket-type" value={t.id} checked={form.type === t.id} onChange={set('type')}
                  title={t.label} note={t.note} inputRef={i === 0 ? typeRef : undefined} />
              ))}
            </div>
            {form.type === 'bug' && (
              <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                A confirmed bug earns credits when the fix ships.
              </p>
            )}
            <FieldError id="ticket-type-error">{errors.type}</FieldError>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ticket-category" className={LABEL}>Category</label>
            <select id="ticket-category" value={form.category} onChange={set('category')} className={`${INPUT} cursor-pointer`}>
              <option value="">No category</option>
              {TICKET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${LABEL} mb-1.5`}>Priority</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TICKET_PRIORITIES.map((p) => (
                <ChoiceCard key={p.id} name="ticket-priority" value={p.id} checked={form.priority === p.id} onChange={set('priority')}
                  title={p.label} note={p.note} />
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ticket-description" className={LABEL}>Description</label>
            <textarea id="ticket-description" value={form.description} onChange={set('description')} rows={5}
              placeholder="What happened, what you expected, and where in the product." className={`${INPUT} min-h-[96px] resize-y`} />
          </div>

          {submitError && <StateNote tone="red" role="alert">{submitError}</StateNote>}

          <div className="flex justify-end gap-2">
            <Link to="/help/tickets" className={SECONDARY}>Cancel</Link>
            <button type="submit" disabled={submitting} className={PRIMARY}>{submitting ? 'Opening…' : 'Open ticket'}</button>
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <section aria-labelledby="ticket-guides" className={`${CARD} flex flex-col gap-2.5 px-4 py-4`}>
            <h2 id="ticket-guides" className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-violet-700 dark:text-violet-300">These guides may answer it</h2>
            {guides.length === 0 ? (
              <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
                {form.title.trim().length >= 3 ? 'No guide matches this title.' : 'Type a title to see matching guides.'}
              </p>
            ) : (
              <ul className="flex flex-col">
                {guides.map((g) => (
                  <li key={g.anchor} className="border-b border-gray-100 py-2 last:border-b-0 dark:border-gray-800">
                    <Link to={guideHref(g.anchor)} target="_blank" rel="noopener noreferrer" className="block text-[13px] font-bold text-violet-700 hover:underline dark:text-violet-300">
                      {g.title}
                    </Link>
                    <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{g.area}{g.minutes ? ` · ${g.minutes} min read` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400">Matched on the title as you type. A guide opens in a new tab, so this form keeps what you wrote.</p>
          </section>
        </aside>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// H5 / H7 — one ticket
// ---------------------------------------------------------------------------

function Avatar({ tone, children }) {
  const tones = {
    grey: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
    violet: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  };
  return <span aria-hidden className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full font-mono text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

function RailCard({ label, children }) {
  return (
    <section className={`${CARD} flex flex-col gap-2 px-4 py-3.5`}>
      {label && <h2 className={LABEL}>{label}</h2>}
      {children}
    </section>
  );
}

function AdminControls({ ticket, user, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const me = user?.name || user?.email || '';

  const update = async (data, key) => {
    setBusy(key);
    setNote(null);
    try {
      const res = await api.updateTicket(ticket.id, data);
      // The change is saved here whatever GitHub says; a partial mirror says which part it refused.
      if (res?.github_sync_status === 'partial') {
        setNote({ tone: 'amber', text: `Saved here. The tracker did not take all of it: ${(res.github_sync_errors || []).join('; ')}.` });
      }
      await onChanged();
    } catch (e) {
      setNote({ tone: 'red', text: e?.message || 'The change was not saved.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Manage this ticket" className={`${CARD} flex flex-wrap items-end gap-4 px-4 py-3.5`}>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Status</span>
        <div className="flex flex-wrap gap-1">
          {TICKET_STATUSES.map((s) => {
            const on = ticket.status === s.id;
            return (
              <button key={s.id} type="button" aria-pressed={on} disabled={on || !!busy} onClick={() => update({ status: s.id }, s.id)}
                className={`rounded-[7px] border px-2.5 py-1.5 text-[12px] font-semibold ${on ? 'border-violet-600 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300' : 'border-gray-200 bg-white text-gray-600 hover:border-violet-200 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
                {busy === s.id ? 'Saving…' : s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Assignee</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-gray-900 dark:text-gray-100">{ticket.assigned_to || 'Not assigned yet'}</span>
          {me && ticket.assigned_to !== me && (
            <button type="button" disabled={!!busy} onClick={() => update({ assigned_to: me }, 'assign')} className={SECONDARY}>
              {busy === 'assign' ? 'Assigning…' : 'Assign to me'}
            </button>
          )}
        </div>
      </div>
      {note && <div className="w-full"><StateNote tone={note.tone} role="status">{note.text}</StateNote></div>}
    </section>
  );
}

function Thread({ ticket, isAdmin, viewerIsOwner, onPosted }) {
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);
  const onTracker = !!ticket.github_issue_number;
  const thread = Array.isArray(ticket.thread) ? ticket.thread : [];

  const post = async (e) => {
    e.preventDefault();
    const body = reply.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    try {
      const res = await api.commentTicket(ticket.id, body);
      if (res?.github_sync_status === 'dev-stub') {
        setError(res.message || 'Replies reach the tracker in production only.');
      } else {
        setReply('');
        await onPosted();
      }
    } catch (err) {
      setError(err?.message || 'Your reply was not posted.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <section aria-labelledby="ticket-thread" className={`${CARD} overflow-hidden`}>
      <h2 id="ticket-thread" className={`border-b border-gray-100 px-4 py-3 dark:border-gray-800 ${LABEL}`}>
        Thread · {thread.length} repl{thread.length === 1 ? 'y' : 'ies'}
      </h2>
      {ticket.thread_unreadable && (
        <div className="px-4 pt-3">
          <StateNote tone="red" role="alert" action={<button type="button" onClick={onPosted} className="text-xs font-bold underline">Try again</button>}>
            The thread could not be read from the tracker. This is not a sign that nobody has replied.
          </StateNote>
        </div>
      )}
      {thread.length === 0 && !ticket.thread_unreadable && (
        <p className="px-4 py-4 text-[13px] text-gray-500 dark:text-gray-400">No replies yet.</p>
      )}
      <ol>
        {thread.map((m) => {
          const s = threadSpeaker(m, { viewerIsOwner, submittedBy: ticket.submitted_by });
          return (
            <li key={m.id ?? `${m.created_at}-${m.from}`} className="flex gap-3 border-b border-gray-100 px-4 py-3.5 dark:border-gray-800">
              <Avatar tone={s.tone}>{s.initial}</Avatar>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{s.who}</span>
                  <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[s.tone]}`}>{s.role}</span>
                  <span className="font-mono text-[10.5px] text-gray-400">{momentOf(m.created_at) || ''}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-gray-700 dark:text-gray-300">{m.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <form onSubmit={post} className={`flex flex-col gap-2 px-4 py-3.5 ${onTracker ? '' : 'bg-gray-50 dark:bg-gray-950/40'}`}>
        <label htmlFor="ticket-reply" className="sr-only">Reply</label>
        <textarea id="ticket-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3}
          disabled={!onTracker || posting} placeholder={onTracker ? 'Write a reply…' : 'Replies are closed'}
          className={`${INPUT} min-h-[56px] resize-y disabled:cursor-not-allowed disabled:opacity-60`} />
        {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className={`text-[12px] ${onTracker ? 'text-gray-500 dark:text-gray-400' : 'text-amber-800 dark:text-amber-300'}`}>
            {onTracker
              ? (isAdmin && !viewerIsOwner ? 'Replies go to the member and to the tracker.' : 'Replies go to the Axal team and to the tracker.')
              : 'Replies open once this ticket is on the tracker.'}
          </span>
          <button type="submit" disabled={!onTracker || posting || !reply.trim()} className={PRIMARY}>{posting ? 'Posting…' : 'Reply'}</button>
        </div>
      </form>
    </section>
  );
}

function TrackerCard({ ticket, isAdmin, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const n = ticket.github_issue_number;
  const failed = ticket.github_sync_status === 'failed';

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.retryTicketMirror(ticket.id);
      await onChanged();
    } catch (e) {
      setError(e?.message || 'The issue could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <RailCard label="Tracker">
      {n ? (
        ticket.github_issue_url ? (
          <a href={ticket.github_issue_url} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px] font-bold text-violet-700 hover:underline dark:text-violet-300">#{n} ↗</a>
        ) : (
          <span className="font-mono text-[13px] font-bold text-violet-700 dark:text-violet-300">#{n}</span>
        )
      ) : (
        <span className="font-mono text-[13px] font-bold text-amber-800 dark:text-amber-300">Not on the tracker</span>
      )}
      <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
        {n
          ? 'Mirrored to the team’s tracker. The number is the issue number there.'
          : failed
            ? 'The mirror failed when the ticket was saved. An admin can retry it; until then nobody can reply.'
            : 'This ticket has not reached the tracker yet. Until it does, nobody can reply.'}
      </p>
      {isAdmin && !n && (
        <div className="flex flex-col gap-2 rounded-[9px] border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span>
            Mirror state: {ticket.github_sync_status || 'never tried'}
            {ticket.github_sync_error ? ` · ${ticket.github_sync_error}` : ''}
          </span>
          <button type="button" onClick={retry} disabled={busy} className="self-start font-bold underline disabled:opacity-60">
            {busy ? 'Retrying…' : 'Retry'}
          </button>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
      {isAdmin && n && <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">Mirror state: synced</span>}
    </RailCard>
  );
}

function OutcomePanel({ ticket, reviewer = false }) {
  if (ticket.type === 'bug') {
    const line = bountyLine(ticket.bounty);
    const panel = bountyPanel(ticket.bounty);
    if (!line || !panel) return null;
    return (
      <section aria-label="Bounty" className={`rounded-2xl border px-4 py-3.5 ${PANEL_TONE[panel.tone]}`}>
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.11em]">Bounty</h2>
        <p className="mt-1.5 text-[14px] font-extrabold tracking-tight">{line.text}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed">{panel.text}</p>
      </section>
    );
  }
  if (ticket.type === 'feature') {
    const line = reviewLine(ticket.review);
    if (!line) return null;
    return (
      <section aria-label="Review" className={`rounded-2xl border px-4 py-3.5 ${PANEL_TONE[line.tone === 'amber' ? 'violet' : line.tone]}`}>
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.11em]">Review</h2>
        <p className="mt-1.5 text-[14px] font-extrabold tracking-tight">{line.text}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed">{line.note}</p>
        {/* D606 — H7's link, now that the queue has its page. The Super
            Admin decides; everyone else sees the review only. */}
        {reviewer && ticket.review?.state === 'awaiting' && (
          <Link to="/hq/review" className="mt-2 inline-block text-[12.5px] font-semibold underline" data-testid="ticket-review-queue-link">
            Feature review queue →
          </Link>
        )}
      </section>
    );
  }
  return null;
}

function TicketDetail({ ticketId, isAdmin, user, outcome }) {
  const [state, setState] = useState({ status: 'loading', ticket: null });
  const [attempt, setAttempt] = useState(0);
  const listTitle = isAdmin ? 'All tickets' : 'Your tickets';

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', ticket: null });
    api.getTicket(ticketId)
      .then((t) => { if (alive) setState({ status: 'ok', ticket: t }); })
      .catch((e) => { if (alive) setState({ status: detailFailure(e), ticket: null }); });
    return () => { alive = false; };
  }, [ticketId, attempt]);

  // After a change, read the ticket again without blanking the page.
  const refresh = useCallback(() => api.getTicket(ticketId)
    .then((t) => setState({ status: 'ok', ticket: t }))
    .catch(() => {}), [ticketId]);

  const crumbs = (last) => [{ label: 'Help', to: '/help' }, { label: listTitle, to: '/help/tickets' }, { label: last }];

  if (state.status === 'loading') {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <ScreenHeader crumbs={crumbs('Loading…')} title={<span className="inline-block h-6 w-64 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />} />
        <div className={CARD}><SkeletonRows label="Loading the ticket" /></div>
      </div>
    );
  }
  if (state.status === 'not_found') {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <ScreenHeader crumbs={crumbs('Not found')} title="Ticket not found" />
        <StateNote tone="amber" role="alert" action={<Link to="/help/tickets" className="text-xs font-bold underline">Back to {listTitle.toLowerCase()}</Link>}>
          This ticket does not exist or is not yours.
        </StateNote>
      </div>
    );
  }
  if (state.status === 'unreadable') {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <ScreenHeader crumbs={crumbs('Ticket')} title="Ticket" />
        <StateNote tone="red" role="alert" action={<button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-xs font-bold underline">Try again</button>}>
          This ticket could not be read.
        </StateNote>
      </div>
    );
  }

  return <TicketView ticket={state.ticket} isAdmin={isAdmin} user={user} outcome={outcome} onRefresh={refresh} />;
}

/** One loaded ticket (H5, H5b, H7). Exported so the test renders it with data. */
export function TicketView({ ticket: t, isAdmin, user, outcome, onRefresh }) {
  const listTitle = isAdmin ? 'All tickets' : 'Your tickets';
  const refresh = onRefresh;
  const viewerIsOwner = Number(t.user_id) === Number(user?.id);
  const sla = isAdmin ? slaChip(t.sla) : null;
  const pills = [
    typeChip(t.type), categoryChip(t.category), priorityChip(t.priority), statusChip(t.status),
    sla && { ...sla, text: `${t.sla.tier} · ${sla.text}` },
  ].filter(Boolean);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <ScreenHeader
        crumbs={[{ label: 'Help', to: '/help' }, { label: listTitle, to: '/help/tickets' }, { label: t.title }]}
        title={t.title}
        pills={pills}
        action={(
          <button type="button" onClick={refresh} className={SECONDARY} aria-label="Refresh this ticket">
            <RefreshCw size={14} aria-hidden />
          </button>
        )}
      />

      {outcome && (
        <div role="status" className={`rounded-xl border px-4 py-3 ${PANEL_TONE[outcome.tone] || PANEL_TONE.grey}`}>
          <p className="text-[13px] font-bold">{outcome.title}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed">{outcome.text}</p>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <div className={`${CARD} whitespace-pre-wrap break-words px-5 py-4 text-[14px] leading-7 text-gray-700 dark:text-gray-300`}>
            {t.description || 'No description was given.'}
          </div>
          {isAdmin && <AdminControls ticket={t} user={user} onChanged={refresh} />}
          <Thread ticket={t} isAdmin={isAdmin} viewerIsOwner={viewerIsOwner} onPosted={refresh} />
        </div>

        <aside className="flex flex-col gap-3">
          <RailCard>
            <dl className="flex flex-col gap-2.5">
              <div>
                <dt className={LABEL}>Submitted</dt>
                <dd className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{t.submitted_by || 'A member'} · {dayOf(t.created_at) || '—'}</dd>
              </div>
              <div>
                <dt className={LABEL}>Last updated</dt>
                <dd className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{momentOf(t.updated_at || t.created_at) || '—'}</dd>
              </div>
              <div>
                <dt className={LABEL}>Assigned to</dt>
                <dd className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{t.assigned_to || 'Not assigned yet'}</dd>
              </div>
            </dl>
          </RailCard>
          <TrackerCard ticket={t} isAdmin={isAdmin} onChanged={refresh} />
          <OutcomePanel ticket={t} reviewer={isAdmin && isSuperAdminUser(user)} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page: which screen the address asks for
// ---------------------------------------------------------------------------

export default function TicketsPage() {
  const location = useLocation();
  // D599 — the Help Center's "Open a ticket" lands here as `?new=1`, so the
  // form is open on arrival rather than one more click away.
  const [showForm, setShowForm] = useState(() => new URLSearchParams(location.search).get('new') === '1');
  useEffect(() => {
    setShowForm(new URLSearchParams(location.search).get('new') === '1');
  }, [location.search]);
  // Task #103 — the ticket id in the URL opens the ticket.
  //
  // `/help/:id` was declared by D39 and `/tickets/:id` redirected into it, but
  // this component never read a param: `selectedTicketId` started at null and
  // only a row click could set it. So `tickets.ts`'s "Open ticket" Slack CTA
  // and every ticket_update notification landed on the list and asked the
  // reader to find their own ticket. Both legacy shapes redirect to
  // `/help/tickets/<id>`, and this is what makes that address mean anything.
  const { id: routeTicketId } = useParams();
  const [selectedTicketId, setSelectedTicketId] = useState(routeTicketId || null);

  const user = safeReadJSON('user', {});
  const isAdmin = user.role === 'admin';

  // Follow the URL while mounted: arriving at /help/tickets/<id> from a
  // notification while already on the list has to open that ticket, and
  // leaving the id has to return to the list.
  useEffect(() => {
    setSelectedTicketId(routeTicketId || null);
  }, [routeTicketId]);

  if (selectedTicketId) {
    return <TicketDetail key={selectedTicketId} ticketId={selectedTicketId} isAdmin={isAdmin} user={user} outcome={location.state?.outcome || null} />;
  }
  if (showForm) return <TicketForm isAdmin={isAdmin} role={user.role} />;
  return <TicketList isAdmin={isAdmin} />;
}

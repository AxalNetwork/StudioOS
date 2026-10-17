import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Search, ChevronRight, X, AlertTriangle, Info,
  Compass, Rocket, Hammer, TrendingUp, DollarSign, Scale,
  Network, LayoutDashboard, UserCircle, LifeBuoy, FileText, History,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SECTIONS, filterSectionsForRole, adminOnlyAnchors } from './sections';
import { createDocsFuse, splitForHighlight, snippet } from '../../lib/docs/search';
import { useViewMode } from '../../contexts/ViewModeContext';
import { useAuth } from '../../hooks/useAuthSync';
import { request, api } from '../../lib/api';
import { overallStatus } from '../../lib/statusOverall';
import { canUseCustomerChat } from '../../lib/customerChat';
import CustomerChatWidget from '../../components/CustomerChatWidget';
import BountyBadge from '../../components/tickets/BountyBadge';
import ReviewBadge from '../../components/tickets/ReviewBadge';
import { statusChip } from '../../lib/ticketScreens';
import { parseGuidePath, guideHref, hashTarget, readingMinutes, openTicketsByActivity, guideFor, viewsLine } from './helpCenter';
import { canOpenSurface, guidePlacement, helpAreas } from './guidePlacement';
import { GuideAnswersAdmin, GuideFeedback, PopularGuides, usePopularGuides } from './HelpSignals';
import { usePhoneWidth } from '../../ui';
import { AccountPhonePage, phonePending } from '../account/AccountPhonePage';
import { ACCOUNT_PHONE_PAGES } from '../account/accountPhone';

// ---------------------------------------------------------------------------
// D599 (#1280) — the Help Center, built to its canvas.
//
// `design/canvases/integrated/Help Center.dc.html` draws two screens for the
// corpus: H1, a home page (a lavender search band, the areas as cards, the
// member's open tickets, "Still stuck?"), and H2, one page per guide. Task #103
// had composed a front door onto the old docs site instead: a gray rail listing
// all 96 guides, every guide rendered in one long scroll under the home, and
// the contact block at the very bottom of it. So the page did not look like the
// canvas, and a member's tickets were a footer link away from anything.
//
// Now `/help` is H1 and `/help/<area>/<guide>` is H2. The corpus, its role
// filtering and its search are unchanged; only the composition is new.
//
// Every address that reached a guide still does. `#<area>/<guide>` was the
// guide's address for the whole life of the old page, and it is in sent
// notifications, the advisor's tools and bookmarks, so a hash on `/help` now
// opens that guide's page (see `DocsLayout` below).
//
// D621 (#1280 step 2) wires two canvas elements to D603's stores, in
// `HelpSignals.jsx`: "Popular this week" on the home, and "Did this answer
// it?" on each guide, with the answers shown to an admin on the home.
// D626 (#1369, step 3) groups guides by task and records their surfaces and
// descriptive audiences in guidePlacement.js. Guide addresses never change.
// ---------------------------------------------------------------------------

// Wrap the pure-JS split helper into a JSX-friendly highlighter. Kept
// inside the layout so the search module stays JSX-free.
function highlight(text, q) {
  return splitForHighlight(text, q).map((part, i) =>
    part.match ? (
      <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5 dark:text-gray-100">{part.text}</mark>
    ) : (
      <React.Fragment key={i}>{part.text}</React.Fragment>
    )
  );
}

// Resolve the lucide icon name strings used in section manifests.
const ICONS = {
  Compass, Rocket, Hammer, TrendingUp, DollarSign, Scale,
  Network, LayoutDashboard, UserCircle, LifeBuoy, FileText, History,
};

function SectionIcon({ name, ...rest }) {
  const Icon = ICONS[name] || FileText;
  return <Icon {...rest} />;
}

// The canvas gives each area a tinted icon tile. The tint carries no meaning
// beyond telling neighbouring cards apart, so it is a lookup with a neutral
// default: a new section file gets the gray tile until someone picks it one.
const AREA_TINTS = {
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};
const AREA_TINT_BY_ID = {
  'getting-started': 'violet',
  'spin-out-lab': 'emerald',
  build: 'indigo',
  'validate-grow': 'amber',
  capital: 'amber',
  legal: 'emerald',
  network: 'indigo',
};
const areaTint = (id) => AREA_TINTS[AREA_TINT_BY_ID[id] || 'gray'];

// The canvas's label style: mono, small, uppercase, tracked — gray by default,
// in the callout's own ink inside a callout.
const LABEL_BASE = 'font-mono text-[10px] font-medium uppercase tracking-[0.11em]';
const LABEL = `${LABEL_BASE} text-gray-500 dark:text-gray-400`;

// Fetched markdown lands inside a `<section>` under the guide's `<h1>`, so its
// own headings have to start below that — a `# ` at the top of a file is the
// file's title, not the page's (`/CHANGELOG-user.md` opens with "# What's
// new"). Each level shifts down one.
const MARKDOWN_HEADINGS = {
  h1: ({ node, ...props }) => <h2 {...props} />,
  h2: ({ node, ...props }) => <h3 {...props} />,
  h3: ({ node, ...props }) => <h4 {...props} />,
};

function MarkdownBody({ url }) {
  const [state, setState] = useState({ status: 'loading', text: '' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', text: '' });
    fetch(url, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => { if (!cancelled) setState({ status: 'ok', text }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', text: String(err?.message || err) }); });
    return () => { cancelled = true; };
  }, [url]);

  if (state.status === 'loading') {
    return <p className="text-sm text-gray-500 italic">Loading…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        Could not load <code className="font-mono text-xs">{url}</code>: {state.text}
      </p>
    );
  }
  return (
    <div className="prose prose-sm max-w-none text-[14.5px] text-gray-700 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-gray-900 [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-gray-900 [&_h3]:mt-5 [&_h3]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-gray-900 [&_h4]:mt-4 [&_h4]:mb-2 [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:leading-relaxed [&_li]:mb-1 [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_blockquote]:border-l-2 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_a]:text-violet-700 [&_a]:underline dark:text-gray-300">
      <ReactMarkdown components={MARKDOWN_HEADINGS}>{state.text}</ReactMarkdown>
    </div>
  );
}

// Suggested queries under the hero. These are shortcuts into the corpus, not
// decoration, so the contract test runs each one through the real fuse index
// and fails if it returns nothing: a chip that finds no guide is a dead end
// dressed as a suggestion.
const SUGGESTED_SEARCHES = ['capital call', 'cap table', 'data room'];

function HelpHero({ query, setQuery, searchInputRef, guideCount, areaCount }) {
  return (
    <header className="border-b border-violet-200 bg-violet-50 px-4 pb-8 pt-10 text-center md:px-8 dark:border-violet-900/60 dark:bg-violet-950/30">
      <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-balance text-gray-900 dark:text-gray-100">How can we help?</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-300">
        {guideCount} guide{guideCount === 1 ? '' : 's'} across {areaCount} area{areaCount === 1 ? '' : 's'}, grouped by what you are doing.
      </p>
      <div className="mx-auto mt-5 max-w-[540px]">
        <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(124,58,237,0.08)] focus-within:ring-2 focus-within:ring-violet-500/40 dark:border-violet-900 dark:bg-gray-900">
          <Search size={18} className="shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guides…"
            aria-label="Search the Help Center"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="shrink-0 rounded-[5px] border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">/</kbd>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className={`${LABEL_BASE} text-violet-700 dark:text-violet-300`}>Try</span>
          {SUGGESTED_SEARCHES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-900 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-violet-950"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

// "Browse by what you are doing" — one card per area, built from the
// role-filtered manifest through D626's placement table. Descriptive audiences
// never filter the guides. Counts come from each area's actual guide array.
const PREVIEW_PER_AREA = 4;

export function BrowseByTask({ sections }) {
  const [expanded, setExpanded] = useState({});
  const areas = helpAreas(sections);
  const total = areas.reduce((n, area) => n + area.guides.length, 0);
  return (
    <section aria-labelledby="help-browse">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="help-browse" className={LABEL}>Browse by what you are doing</h2>
        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
          {areas.length} areas · {total} guides
        </span>
      </div>
      <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
        {areas.map((section) => {
          const count = section.guides.length;
          const open = !!expanded[section.id];
          const shown = open ? section.guides : section.guides.slice(0, PREVIEW_PER_AREA);
          return (
            <div
              key={section.id}
              className="rounded-2xl border border-gray-200 bg-white px-5 py-[18px] dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${areaTint(section.id)}`}>
                  <SectionIcon name={section.icon} size={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[14.5px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{section.title}</h3>
                  {section.badge && <span className={LABEL}>{section.badge}</span>}
                  <div className="mt-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                    {count} guide{count === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
              <ul className="mt-3.5 grid gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                {shown.map((sub) => (
                  <li key={sub.anchor}>
                    <Link to={guideHref(sub.anchor)} className="group flex items-start gap-2.5">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-violet-600" aria-hidden />
                      <span className="text-[12.5px] font-semibold leading-snug text-gray-800 group-hover:text-violet-700 dark:text-gray-200 dark:group-hover:text-violet-300">
                        {sub.title}
                        <span className="mt-0.5 block font-mono text-[10px] font-normal text-gray-500 dark:text-gray-400">{sub.surfaceInfo?.label || 'No single screen'}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {count > PREVIEW_PER_AREA && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [section.id]: !open }))}
                  aria-expanded={open}
                  className="mt-3 text-xs font-bold text-violet-700 hover:underline dark:text-violet-300"
                >
                  {open ? 'Show fewer' : `All ${count} →`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The search results, in the column the browse grid leaves. Each result is
// the guide's own page now, not an anchor further down this one.
export function SearchResults({ results, query, sections }) {
  return (
    <section aria-live="polite">
      <h2 className={LABEL}>
        {results.length} result{results.length === 1 ? '' : 's'} for “{query}”
      </h2>
      {results.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          No guide matches that. Try a broader term, or open a ticket below.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {results.map((r) => (
            <li key={r.anchor}>
              <Link
                to={guideHref(r.anchor)}
                className="block rounded-xl border border-gray-200 bg-white px-4 py-3.5 transition-colors hover:border-violet-200 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-violet-900"
              >
                <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">
                  {highlight(r.subsectionTitle, query)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-gray-500 dark:text-gray-400">{guideFor(r.anchor, sections)?.area || r.sectionTitle}</div>
                <div className="mt-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                  {highlight(snippet(r.text, query), query)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// H1's "Your tickets" card: the open tickets `GET /api/tickets` returns, at
// most three, latest activity first. The route answers a member with their own
// tickets and an admin with every member's, so the card says which it is.
// A failed read says so and offers a retry; it never reads as "no tickets".
// The status chip is the ticket screens' own (`lib/ticketScreens.js`, D604),
// and so is the review beside the bounty: one palette on every ticket surface.
const CARD_ROWS = 3;

function YourTicketsCard({ isAdmin }) {
  const [state, setState] = useState({ status: 'loading', open: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', open: [] });
    api.listTickets()
      .then((rows) => {
        if (!alive) return;
        const open = openTicketsByActivity(rows);
        setState(open ? { status: 'ok', open } : { status: 'error', open: [] });
      })
      .catch(() => { if (alive) setState({ status: 'error', open: [] }); });
    return () => { alive = false; };
  }, [attempt]);

  const title = isAdmin ? 'Open tickets across the platform' : 'Your tickets';
  const meta = state.status !== 'ok'
    ? (isAdmin ? 'open · every member' : 'open · latest activity first')
    : `${state.open.length} open${isAdmin ? ' · every member' : ''} · latest activity first`;

  return (
    <section aria-labelledby="help-tickets" className="rounded-2xl border border-gray-200 bg-white px-5 py-[18px] dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="help-tickets" className={LABEL}>{title}</h2>
        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{meta}</span>
      </div>

      {state.status === 'loading' && (
        <div className="mt-3 grid gap-2" aria-busy="true" aria-label="Loading your tickets">
          {[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />)}
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="mt-3 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="text-[12.5px]">{isAdmin ? 'The ticket queue could not be read.' : 'Your tickets could not be read.'}</span>{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-xs font-bold underline">Try again</button>
        </div>
      )}

      {state.status === 'ok' && state.open.length === 0 && (
        <p className="mt-3 text-[12.5px] text-gray-500 dark:text-gray-400">
          {isAdmin ? 'No open tickets across the platform.' : 'No open tickets.'}
        </p>
      )}

      {state.status === 'ok' && state.open.length > 0 && (
        <ul className="mt-2.5">
          {state.open.slice(0, CARD_ROWS).map((t) => {
            const st = statusChip(t.status);
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-b-0 dark:border-gray-800">
                <Link to={`/help/tickets/${t.id}`} className="min-w-0 text-[13px] font-bold tracking-tight text-gray-900 hover:text-violet-700 dark:text-gray-100 dark:hover:text-violet-300">
                  {t.title}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5">
                  {st && <span className={st.className}>{st.text}</span>}
                  <BountyBadge bounty={t.bounty} />
                  <ReviewBadge review={t.review} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
        <Link to="/help/tickets" className="text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300">
          {isAdmin ? 'All tickets →' : 'All your tickets →'}
        </Link>
        <Link
          to="/help/tickets?new=1"
          className="rounded-[9px] border border-gray-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:border-violet-200 hover:text-violet-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-violet-300"
        >
          Open a ticket
        </Link>
      </div>
    </section>
  );
}

// "Still stuck?" — the canvas's contact block, with the one live element it
// asks for: the current platform status, read from `GET /api/public/status`,
// the same endpoint /status renders. The roll-up rule is shared with /status
// (lib/statusOverall.js) so the two pages cannot disagree, and the line renders
// nothing at all until the probe answers — an unreachable status endpoint must
// not read as "all good".
const STATUS_LINE = {
  operational: { text: 'All systems operational', dot: 'bg-emerald-500' },
  degraded: { text: 'Some systems degraded', dot: 'bg-amber-500' },
  down: { text: 'Active outage', dot: 'bg-red-500' },
  // D332 — a failed probe says so, rather than vanishing: silence reads as
  // nothing to report, not as a failed read.
  unknown: { text: 'Status could not be read', dot: 'bg-gray-400' },
};

const PRIMARY_ACTION = 'rounded-[9px] border border-violet-600 bg-violet-600 px-4 py-2 text-[12.5px] font-bold text-white hover:bg-violet-700';
const SECONDARY_ACTION = 'rounded-[9px] border border-gray-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:border-violet-200 hover:text-violet-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-violet-300';

function StillStuck({ user, onOpenChat }) {
  const [overall, setOverall] = useState(null);

  useEffect(() => {
    let alive = true;
    request('/public/status')
      .then((d) => { if (alive) setOverall(overallStatus(d?.services)); })
      .catch(() => { if (alive) setOverall('unknown'); });
    return () => { alive = false; };
  }, []);

  const line = STATUS_LINE[overall];
  // Offered only to viewers the worker would actually serve. The gate is
  // enforced server-side either way (402); this decides whether the channel is
  // shown at all, so nobody is invited into a paywall.
  const chatAvailable = canUseCustomerChat(user);

  return (
    <section aria-labelledby="help-stuck" className="rounded-2xl border border-gray-200 bg-white px-5 py-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 id="help-stuck" className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Still stuck?</h2>
          <p className="mt-1.5 max-w-[440px] text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
            Search first: most answers are here. If not, open a ticket and the team answers in its thread.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link to="/help/tickets?new=1" className={PRIMARY_ACTION}>Open a ticket</Link>
          {chatAvailable && (
            <button type="button" onClick={onOpenChat} className={SECONDARY_ACTION}>Message the team</button>
          )}
          <a href="mailto:support@axal.vc" className={SECONDARY_ACTION}>Email support</a>
          <span className="flex flex-col items-center gap-1">
            <Link to="/trust" className={SECONDARY_ACTION}>What we can see</Link>
            <span className="font-mono text-[9.5px] text-gray-400">Trust Center</span>
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3.5 dark:border-gray-800">
        {line && (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] text-gray-600 dark:text-gray-300">
            <span className={`h-[7px] w-[7px] rounded-full ${line.dot}`} aria-hidden />
            {line.text}
          </span>
        )}
        <Link to="/status" className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300">
          Status page →
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// H2 — one guide on its own page.
//
// The canvas's article column (about 65 characters) and its "On this page"
// rail, filled from what each guide records: the overview is the lede, the
// how-to steps are the body, tips and pitfalls are the two callouts, and
// `related` is the Related list. D626 records the surface and audience metadata,
// with jumps gated like the router; the rail lists the task area's guides.
// ---------------------------------------------------------------------------

function scrollToId(e, id) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function GuideNotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">Guide not found</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        This guide does not exist, or it is not one your account can read.{' '}
        <Link to="/help" className="font-semibold text-violet-700 hover:underline dark:text-violet-300">Back to the Help Center</Link>
      </p>
    </div>
  );
}

export function HelpArticle({ sections, area, guide, user }) {
  const session = useViewMode();
  const section = sections.find((s) => s.id === area);
  const sub = section?.subsections.find((g) => g.id === guide);
  if (!section || !sub) return <GuideNotFound />;

  const placement = guidePlacement(`${area}/${guide}`);
  const areaTitle = placement?.areaTitle || section.title;
  const areaGuides = helpAreas(sections).find((item) => item.id === placement?.area)?.guides || [];
  const howto = Array.isArray(sub.howto) ? sub.howto : [];
  const tips = Array.isArray(sub.tips) ? sub.tips : [];
  const pitfalls = Array.isArray(sub.pitfalls) ? sub.pitfalls : [];
  // A related link is `#<area>/<guide>`; one the viewer cannot read (an admin
  // guide, for anyone else) is left out rather than offered as a dead end.
  const related = (Array.isArray(sub.related) ? sub.related : [])
    .map((r) => {
      const anchor = String(r.href || '').replace(/^#/, '');
      return guideFor(anchor, sections);
    })
    .filter(Boolean);
  const outline = [
    howto.length > 0 && { id: 'how-to', label: 'How to use it' },
    tips.length > 0 && { id: 'tips', label: 'Tips' },
    pitfalls.length > 0 && { id: 'pitfalls', label: 'Common pitfalls' },
    related.length > 0 && { id: 'related', label: 'Related' },
  ].filter(Boolean);

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      <article className="min-w-0 flex-1 px-4 pb-14 pt-6 md:px-9">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400">
          <Link to="/help" className="hover:text-violet-700 dark:hover:text-violet-300">Help</Link>
          <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
          <span>{areaTitle}</span>
          <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
          <span aria-current="page" className="text-gray-900 dark:text-gray-100">{sub.title}</span>
        </nav>

        <div className="mt-7 max-w-[620px]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
              {areaTitle}
            </span>
            <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{readingMinutes(sub)} min read</span>
          </div>
          <h1 className="mt-3.5 text-[30px] font-extrabold leading-[1.14] tracking-tight text-balance text-gray-900 dark:text-gray-100">{sub.title}</h1>
          {sub.overview && (
            <p className="mt-2.5 text-[15px] leading-relaxed text-gray-500 dark:text-gray-400">{sub.overview}</p>
          )}

          <div className="mt-5 flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40">
            <Info size={17} className="shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
            <div><div className={LABEL}>Where this lives</div><p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{placement?.surfaceInfo?.label || 'No single screen'}</p></div>
          </div>
          <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
            <div className={LABEL}>Applies to</div>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{placement?.appliesTo ? placement.appliesTo.map((role) => role[0].toUpperCase() + role.slice(1)).join(', ') : 'Every account'}</p>
            {canOpenSurface(placement?.surfaceInfo, user, session) && <Link to={placement.surface} className="mt-3 inline-flex text-sm font-bold text-violet-700 dark:text-violet-300">Open the surface <ChevronRight size={15} /></Link>}
          </div>
          <div className="mt-6 grid gap-4">
            {sub.markdownUrl && <MarkdownBody url={sub.markdownUrl} />}

            {howto.length > 0 && (
              <section id="how-to" className="scroll-mt-6">
                <h2 className="text-[19px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">How to use it</h2>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14.5px] leading-relaxed text-gray-700 dark:text-gray-300">
                  {howto.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
              </section>
            )}

            {tips.length > 0 && (
              <aside id="tips" className="flex scroll-mt-6 items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-900 dark:bg-violet-950/30">
                <Info size={17} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
                <div className="min-w-0">
                  <div className={`${LABEL_BASE} text-violet-700 dark:text-violet-300`}>Tips</div>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                    {tips.map((tip, i) => <li key={i}>{tip}</li>)}
                  </ul>
                </div>
              </aside>
            )}

            {pitfalls.length > 0 && (
              <aside id="pitfalls" className="flex scroll-mt-6 items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-4 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-800 dark:text-amber-300" aria-hidden />
                <div className="min-w-0">
                  <div className={`${LABEL_BASE} text-amber-800 dark:text-amber-300`}>Common pitfalls</div>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">
                    {pitfalls.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              </aside>
            )}

            {sub.screenshot && (
              <figure className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                <img src={sub.screenshot} alt={sub.title} className="block w-full" loading="lazy" />
                {sub.screenshotCaption && (
                  <figcaption className="bg-gray-50 px-3 py-2 font-mono text-[10.5px] text-gray-500 dark:bg-gray-900 dark:text-gray-400">{sub.screenshotCaption}</figcaption>
                )}
              </figure>
            )}
          </div>

          <GuideFeedback anchor={`${section.id}/${sub.id}`} />

          {related.length > 0 && (
            <section id="related" className="mt-7 scroll-mt-6">
              <h2 className={LABEL}>Related</h2>
              <div className="mt-3 grid gap-2">
                {related.map((r) => (
                  <Link
                    key={r.anchor}
                    to={guideHref(r.anchor)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5 transition-colors hover:border-violet-200 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-violet-900"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold leading-snug text-gray-900 dark:text-gray-100">{r.title}</div>
                      <div className="mt-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">{r.area}</div>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </article>

      <aside className="hidden w-[250px] shrink-0 border-l border-gray-200 bg-white px-6 py-8 lg:block dark:border-gray-800 dark:bg-gray-900">
        {outline.length > 0 && (
          <>
            <div className={LABEL}>On this page</div>
            <nav aria-label="On this page" className="mt-3 grid gap-0.5">
              {outline.map((o, i) => (
                <a
                  key={o.id}
                  href={`#${o.id}`}
                  onClick={(e) => scrollToId(e, o.id)}
                  className={`border-l-2 py-1.5 pl-3 text-[12.5px] leading-snug ${
                    i === 0
                      ? 'border-violet-600 font-bold text-violet-700 dark:text-violet-300'
                      : 'border-gray-200 font-medium text-gray-600 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:text-gray-100'
                  }`}
                >
                  {o.label}
                </a>
              ))}
            </nav>
          </>
        )}
        <div className={outline.length > 0 ? 'mt-6 border-t border-gray-100 pt-5 dark:border-gray-800' : ''}>
          <div className={LABEL}>In {areaTitle}</div>
          <nav aria-label={`Guides in ${areaTitle}`} className="mt-3 grid gap-1">
            {areaGuides.map((g) => (
              <Link
                key={g.anchor}
                to={guideHref(g.anchor)}
                aria-current={g.anchor === `${section.id}/${sub.id}` ? 'page' : undefined}
                className={`text-[12.5px] leading-snug ${
                  g.anchor === `${section.id}/${sub.id}`
                    ? 'font-bold text-violet-700 dark:text-violet-300'
                    : 'text-gray-600 hover:text-violet-700 dark:text-gray-300 dark:hover:text-violet-300'
                }`}
              >
                {g.title}
              </Link>
            ))}
          </nav>
        </div>
      </aside>
    </div>
  );
}

function HelpHome({ visibleSections, role, user, query, setQuery, searchInputRef, onOpenChat }) {
  // The search index is role-scoped, so a viewer never finds a guide the
  // browse grid would not show them.
  const fuse = useMemo(() => createDocsFuse(role), [role]);
  const trimmedQuery = query.trim();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    return fuse.search(trimmedQuery, { limit: 25 }).map((r) => r.item);
  }, [fuse, trimmedQuery]);
  const guideCount = visibleSections.reduce((n, s) => n + s.subsections.length, 0);

  return (
    <>
      <HelpHero
        query={query}
        setQuery={setQuery}
        searchInputRef={searchInputRef}
        guideCount={guideCount}
        areaCount={helpAreas(visibleSections).length}
      />
      <div className="mx-auto grid max-w-5xl gap-5 px-4 pb-10 pt-6 md:px-8">
        {trimmedQuery ? (
          <SearchResults results={searchResults} query={trimmedQuery} sections={visibleSections} />
        ) : (
          <BrowseByTask sections={visibleSections} />
        )}
        {!trimmedQuery && <PopularGuides sections={visibleSections} />}
        <YourTicketsCard isAdmin={role === 'admin'} />
        {role === 'admin' && <GuideAnswersAdmin sections={visibleSections} />}
        <StillStuck user={user} onOpenChat={onOpenChat} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A9m, the Help home on a phone. A guide page is unchanged.
// ---------------------------------------------------------------------------

export const EMAIL_SUPPORT_LINE = 'Opens your mail app. Write from the address on your account.';

/**
 * A9m's three sections. The first is "Popular this week" (D621) where the
 * canvas draws "For you now", which has no store; and Email support's line
 * says what the link does (decision 10). `popular` is `usePopularGuides`'
 * read; `areas` is `helpAreas`, each row opening its guide list in place,
 * because no area has a route of its own.
 */
export function helpPhoneGroups({ popular, onRetry, areas, openArea = null, onArea = () => {} }) {
  const [, guidesTitle, contactTitle] = ACCOUNT_PHONE_PAGES.help.sections;
  const top = { label: 'Popular this week', rows: [], testid: 'help-phone-popular' };
  if (popular.status === 'loading') top.note = phonePending('loading');
  else if (popular.status !== 'ok') top.note = phonePending('unreadable', 'The most-read guides', 'This is not a sign nobody reads them.', onRetry);
  else {
    top.rows = popular.cards.map((c) => ({ key: c.anchor, title: c.title, description: `${viewsLine(c.views)} · ${c.area}`, to: guideHref(c.anchor), testid: 'help-phone-popular-row' }));
    if (!top.rows.length) top.note = 'No views are recorded for these guides this week.';
  }
  const guides = {
    label: guidesTitle,
    testid: 'help-phone-guides',
    rows: areas.map((a) => ({
      key: a.id,
      title: a.title,
      description: `${a.guides.length} guide${a.guides.length === 1 ? '' : 's'}`,
      value: openArea === a.id ? 'Open' : '',
      onClick: () => onArea(openArea === a.id ? null : a.id),
      chevron: true,
      testid: 'help-phone-area',
    })),
  };
  const contact = {
    label: contactTitle,
    testid: 'help-phone-contact',
    rows: [
      { title: 'Open a ticket', description: 'Replies appear in My tickets', to: '/help/tickets?new=1', testid: 'help-phone-ticket' },
      { title: 'Email support', description: EMAIL_SUPPORT_LINE, href: 'mailto:support@axal.vc', testid: 'help-phone-email' },
    ],
  };
  return [top, guides, contact];
}

/** One area's guides, opened from its Guides row. */
function AreaGuides({ area }) {
  return (
    <section aria-labelledby="help-phone-area-title" data-testid="help-phone-area-guides">
      <h2 id="help-phone-area-title" className={LABEL}>{area.title}</h2>
      <ul className="mt-2 grid gap-2">
        {area.guides.map((sub) => (
          <li key={sub.anchor}>
            <Link to={guideHref(sub.anchor)} className="text-[13px] font-semibold text-gray-800 hover:text-violet-700 dark:text-gray-200 dark:hover:text-violet-300">
              {sub.title}
              <span className="block font-mono text-[10px] font-normal text-gray-500 dark:text-gray-400">{sub.surfaceInfo?.label || 'No single screen'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A9m — the bar and the three sections, then `children`: search, the open area, tickets and Still stuck. */
export function HelpPhoneView({ popular, onRetry, areas, openArea, onArea, children = null }) {
  return (
    <AccountPhonePage pageKey="help" bleed testid="help-phone" groups={helpPhoneGroups({ popular, onRetry, areas, openArea, onArea })}>
      {children}
    </AccountPhonePage>
  );
}

function HelpPhoneHome({ visibleSections, role, user, query, setQuery, searchInputRef, onOpenChat }) {
  const [popular, retry] = usePopularGuides(visibleSections);
  const [openArea, setOpenArea] = useState(null);
  const areas = useMemo(() => helpAreas(visibleSections), [visibleSections]);
  const fuse = useMemo(() => createDocsFuse(role), [role]);
  const trimmedQuery = query.trim();
  const results = useMemo(() => (trimmedQuery ? fuse.search(trimmedQuery, { limit: 25 }).map((r) => r.item) : []), [fuse, trimmedQuery]);
  const area = areas.find((a) => a.id === openArea);
  return (
    <HelpPhoneView popular={popular} onRetry={retry} areas={areas} openArea={openArea} onArea={setOpenArea}>
      <div>
        <label htmlFor="help-phone-search" className="sr-only">Search the Help Center</label>
        <input
          id="help-phone-search"
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guides"
          className="w-full rounded-[11px] border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-400"
        />
      </div>
      {trimmedQuery && <SearchResults results={results} query={trimmedQuery} sections={visibleSections} />}
      {!trimmedQuery && area && <AreaGuides area={area} />}
      <YourTicketsCard isAdmin={role === 'admin'} />
      {role === 'admin' && <GuideAnswersAdmin sections={visibleSections} />}
      <StillStuck user={user} onOpenChat={onOpenChat} />
    </HelpPhoneView>
  );
}

export default function DocsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchInputRef = useRef(null);
  // `?q=` prefills the search. `/support?topic=<x>` redirects here as
  // `/help?q=<x>`: `ErrorState` builds that URL from the surface that just
  // failed, which is a better opening query than an empty box. Read once, as
  // the initial value, so typing is never fought.
  const [query, setQuery] = useState(
    () => new URLSearchParams(location.search).get('q') || '',
  );
  const [chatOpen, setChatOpen] = useState(false);
  const { user, role } = useAuth() || {};
  const phone = usePhoneWidth();

  // Task #2 (DD) — the manifest filtered to what this viewer's role may read.
  // Admin sections and subsections are absent for everyone else: from the
  // grid, from search, and from the guide pages, which answer "not found".
  const visibleSections = useMemo(
    () => filterSectionsForRole(SECTIONS, role),
    [role],
  );
  const restrictedAnchors = useMemo(() => adminOnlyAnchors(), []);
  const isAdmin = role === 'admin';
  const route = parseGuidePath(location.pathname);

  // `#<area>/<guide>` was every guide's address until each had its own page,
  // and it is in notifications already sent, the advisor's tools and people's
  // bookmarks. So a hash on the home opens that guide (`hashTarget` says where).
  useEffect(() => {
    if (route) return;
    const target = hashTarget(decodeURIComponent(location.hash), visibleSections, { isAdmin, restricted: restrictedAnchors });
    if (target) navigate(target, { replace: true });
  }, [route, location.hash, isAdmin, restrictedAnchors, visibleSections, navigate]);

  // `/` focuses the search on the home — but only when the reader is not
  // already typing in another field.
  useEffect(() => {
    if (route) return undefined;
    const onKey = (e) => {
      if (e.key !== '/') return;
      const t = e.target;
      const tag = (t && t.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      e.preventDefault();
      const el = searchInputRef.current;
      if (el) {
        el.focus();
        el.select?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route]);

  // A guide opens at its top, not at the scroll position the last page left.
  useEffect(() => {
    if (!route) return;
    document.querySelector('[data-app-scroll]')?.scrollTo?.({ top: 0 });
  }, [route?.area, route?.guide]);

  return (
    <div className="-mx-4 -my-4 min-h-[calc(100vh-64px)] bg-gray-50 md:-mx-6 md:-my-6 dark:bg-gray-950">
      {route ? (
        <HelpArticle sections={visibleSections} area={route.area} guide={route.guide} user={user} />
      ) : phone ? (
        <HelpPhoneHome
          visibleSections={visibleSections}
          role={role}
          user={user}
          query={query}
          setQuery={setQuery}
          searchInputRef={searchInputRef}
          onOpenChat={() => setChatOpen(true)}
        />
      ) : (
        <HelpHome
          visibleSections={visibleSections}
          role={role}
          user={user}
          query={query}
          setQuery={setQuery}
          searchInputRef={searchInputRef}
          onOpenChat={() => setChatOpen(true)}
        />
      )}
      {/* Task #103 — the chat panel renders null while closed and only polls
          while open, so an ineligible viewer (who never gets the button) pays
          nothing for it. */}
      <CustomerChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

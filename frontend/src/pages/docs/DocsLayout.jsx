import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, X, AlertTriangle, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SECTIONS, filterSectionsForRole, adminOnlyAnchors } from './sections';
import { createDocsFuse, splitForHighlight, snippet } from '../../lib/docs/search';
import { useViewMode } from '../../contexts/ViewModeContext';
import { useAuth } from '../../hooks/useAuthSync';
import { request, api } from '../../lib/api';
import { helpCenterApi } from '../../lib/api/helpCenter';
import { overallStatus } from '../../lib/statusOverall';
import { canUseCustomerChat } from '../../lib/customerChat';
import CustomerChatWidget from '../../components/CustomerChatWidget';
import BountyBadge from '../../components/tickets/BountyBadge';
import ReviewBadge from '../../components/tickets/ReviewBadge';
import { statusChip } from '../../lib/ticketScreens';
import { reportError } from '../../lib/log';
import { parseGuidePath, guideHref, hashTarget, readingMinutes, openTicketsByActivity, guideFor, viewsLine, guideBreadcrumbLd } from './helpCenter';
import { injectJsonLd } from '../../lib/seo';
import { guidePlacement, helpAreas } from './guidePlacement';
import { helpGuideMeta } from './helpMeta';
import { usePageMeta } from '../../lib/seo';
import { guideReviewFor, guideVerificationFor } from './guideGovernance';
import { GuideAnswersAdmin, GuideFeedback, PopularGuides, usePopularGuides } from './HelpSignals';
import {
  SEARCH_MISS_IDLE_MS, appliesToLine, areaChips, areasForTerms, broaderTerms, cleanQuery, goToTarget, guideHrefFor, guideOutline,
  guideTicketDraft, inArea, isPlainClick, moveSelection, publicGuides, resultArea, resultLine, searchGuides, searchHref, searchScope,
  searchSuggestions, ticketTitleFromSearch,
  TRACKER_WARNING, TRACKER_WARNING_ANCHOR, TRACKER_WARNING_LINK,
} from './v2/helpV2';
import HelpTicketSheet, { ADVISORY_URL, SECURITY_EMAIL } from './v2/HelpTicketSheet';
import HelpDirectory from './v2/HelpDirectory';
import { usePhoneWidth, StateChip } from '../../ui';
import { AccountPhonePage, phonePending } from '../account/AccountPhonePage';
import { ACCOUNT_PHONE_PAGES } from '../account/accountPhone';

// ---------------------------------------------------------------------------
// D599 (#1280) — the Help Center, built to its canvas: `/help` is the home and
// `/help/<area>/<guide>` is one guide on its own page. Every address that
// reached a guide still does: `#<area>/<guide>` on `/help` opens that guide's
// page (see `DocsLayout` below). D621 wires Popular and "Did this answer it?"
// to D603's stores (`HelpSignals.jsx`); D626 groups the guides by task.
//
// D6861 (#6861) — rebuilt to Help Center v2 (D4957; `design/incoming/Help
// Center v2 Page.dc.html`, boards HC1 to HC16):
//   HC1/HC2   search directly under the title; Popular and Your tickets two
//             across; the areas with their real guide counts; Still stuck?
//             with a status line that carries a glyph and words. Signed out:
//             the six public guides, Account recovery first.
//   HC3/HC4   "First 25 results" (the owner's option A, never a total the
//             search did not count), area chips, arrow keys, Enter and Esc;
//             nothing found offers broader terms that find something, the
//             areas, and a ticket that carries the search. A search that
//             found nothing is recorded with no member (D6861's store).
//   HC5/HC6   the guide column with Go to as the one primary action, On this
//             page with owner and review ("Verification pending" until a
//             first verified date exists), and what next after a No.
//   HC7       one sheet: an ordinary ticket or a security concern, on the
//             same two endpoints as before (`v2/HelpTicketSheet.jsx`).
//   HC8       every guide, with a role filter that dims (`v2/HelpDirectory.jsx`),
//             at `/help?view=all`.
//
// D4640 (#4640) — the journey from a question to a guide and back: a result
// keeps its search in both addresses (`/help?q=` behind it, `?q=` on the
// guide), so Back, the guide's search and its related guides keep it; the
// guide has a search at every width and a Get help block before "Did this
// answer it?"; on a phone the results replace the browsing sections while a
// query is typed; and the results say what the search reads.
// ---------------------------------------------------------------------------

// Wrap the pure-JS split helper into a JSX-friendly highlighter. Kept
// inside the layout so the search module stays JSX-free.
function highlight(text, q) {
  return splitForHighlight(text, q).map((part, i) =>
    part.match ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5 text-gray-900 dark:bg-yellow-500/30 dark:text-gray-100">{part.text}</mark>
    ) : (
      <React.Fragment key={i}>{part.text}</React.Fragment>
    )
  );
}

// The canvas's label style: mono, small, uppercase, tracked — gray by default,
// in the callout's own ink inside a callout.
const LABEL_BASE = 'font-mono text-[10px] font-medium uppercase tracking-[0.11em]';
const LABEL = `${LABEL_BASE} text-gray-500 dark:text-gray-400`;
const CARD = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const CHIP = 'inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[10px] text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
const KBD = 'inline-flex min-w-[20px] items-center justify-center rounded border border-gray-300 bg-white px-1 font-mono text-[10.5px] text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300';

const PRIMARY_ACTION = 'inline-flex min-h-[40px] items-center rounded-[9px] border border-violet-600 bg-violet-600 px-4 text-[12.5px] font-bold text-white hover:bg-violet-700';
const SECONDARY_ACTION = 'inline-flex min-h-[40px] items-center rounded-[9px] border border-gray-200 bg-white px-3.5 text-[12.5px] font-semibold text-gray-700 hover:border-violet-200 hover:text-violet-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-violet-300';

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
    return <p className="text-sm italic text-gray-500 dark:text-gray-400">Loading…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        Could not load <code className="font-mono text-xs">{url}</code>: {state.text}
      </p>
    );
  }
  return (
    <div className="prose prose-sm max-w-none text-[14.5px] text-gray-700 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-gray-900 [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-gray-900 [&_h3]:mt-5 [&_h3]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-gray-900 [&_h4]:mt-4 [&_h4]:mb-2 [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:leading-relaxed [&_li]:mb-1 [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_blockquote]:border-l-2 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_a]:text-violet-700 [&_a]:underline dark:text-gray-300 dark:[&_h2]:text-gray-100 dark:[&_h3]:text-gray-100 dark:[&_h4]:text-gray-100 dark:[&_code]:bg-gray-800">
      <ReactMarkdown components={MARKDOWN_HEADINGS}>{state.text}</ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HC1–HC4: the search, under the title.
// ---------------------------------------------------------------------------

/**
 * The search field: a combobox over the result list. ArrowUp and ArrowDown
 * move `aria-activedescendant`, Enter opens the selected guide, Esc clears.
 * `/` focuses it from anywhere on Help (see `DocsLayout`).
 */
function HelpSearchBox({ query, setQuery, searchInputRef, label, placeholder, sub, activeId, onKeyDown, compact = false }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor="help-search" className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">{label}</label>
      <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-white px-4 shadow-[0_2px_10px_rgba(124,58,237,0.08)] focus-within:ring-2 focus-within:ring-violet-500/40 dark:border-violet-900 dark:bg-gray-900">
        <Search size={18} className="shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
        <input
          id="help-search"
          ref={searchInputRef}
          type="search"
          role="combobox"
          aria-expanded={query.trim() ? 'true' : 'false'}
          aria-controls="help-results"
          aria-autocomplete="list"
          aria-activedescendant={activeId || undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`min-w-0 flex-1 bg-transparent [&::-webkit-search-cancel-button]:appearance-none ${compact ? 'min-h-[44px]' : 'min-h-[50px]'} text-[15px] text-gray-900 placeholder:text-gray-500 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-400`}
        />
        {query ? (
          <button type="button" onClick={() => { setQuery(''); searchInputRef?.current?.focus(); }} aria-label="Clear search" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            <X size={15} />
          </button>
        ) : (
          !compact && <span className={KBD} title="Press / to search">/</span>
        )}
      </div>
      {sub && <small className="text-[12px] text-gray-500 dark:text-gray-400">{sub}</small>}
    </div>
  );
}

/** D7001 (#7001): the suggested searches under the box, each one a public guide's own topic. */
function SearchSuggestions({ setQuery }) {
  const list = searchSuggestions();
  if (!list.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="help-search-suggestions">
      <span className="text-[12px] font-semibold text-gray-600 dark:text-gray-300">Try</span>
      {list.map((s) => (
        <button key={s.query} type="button" onClick={() => setQuery(s.query)} data-testid="help-search-suggestion"
          className="inline-flex min-h-[44px] items-center rounded-full border border-violet-200 bg-white px-3 text-[12.5px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-violet-950">
          {s.query}
        </button>
      ))}
    </div>
  );
}

function HelpHero({ user, publicCount, ...box }) {
  return (
    <header className="border-b border-violet-200 bg-violet-50 px-4 pb-7 pt-8 md:px-8 dark:border-violet-900/60 dark:bg-violet-950/40">
      <div className="mx-auto max-w-3xl">
        {!user && <span className={`${LABEL_BASE} text-violet-700 dark:text-violet-300`}>Help Center · public guides</span>}
        <h1 className="mb-4 text-[28px] font-extrabold leading-tight tracking-tight text-balance text-gray-900 dark:text-gray-100">How can we help?</h1>
        <HelpSearchBox
          {...box}
          label={user ? 'Search the Help Center' : 'Search the public guides'}
          placeholder={user ? 'Search guides, e.g. “account recovery”' : `Search ${publicCount} public guides`}
          sub={user
            ? 'Searches the guides your account can read. Press / from anywhere on Help.'
            : <>{publicCount} guides are public. <Link to="/login?next=%2Fhelp" className="font-bold text-violet-700 dark:text-violet-300">Sign in to search every guide</Link>.</>}
        />
        <SearchSuggestions setQuery={box.setQuery} />
      </div>
    </header>
  );
}

// "Browse by area" — one card per area, built from the role-filtered manifest
// through D626's placement table. Descriptive audiences never filter the
// guides. Counts come from each area's actual guide array. "All N" opens the
// directory at that area.
const PREVIEW_PER_AREA = 4;

export function BrowseByTask({ sections }) {
  const areas = helpAreas(sections);
  const total = areas.reduce((n, area) => n + area.guides.length, 0);
  return (
    <section aria-labelledby="help-browse" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="help-browse" className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Browse by area</h2>
        <span className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{areas.length} areas · {total} guides</span>
          <Link to="/help?view=all" className="text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300">All guides, with a role filter →</Link>
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {areas.map((section) => {
          const count = section.guides.length;
          const shown = section.guides.slice(0, PREVIEW_PER_AREA);
          return (
            <section key={section.id} aria-labelledby={`area-card-${section.id}`} className={`${CARD} flex flex-col px-5 py-4`} data-testid="help-area-card">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id={`area-card-${section.id}`} className="text-[14.5px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{section.title}</h3>
                <span className="shrink-0 font-mono text-[10.5px] text-gray-500 dark:text-gray-400">{count} guide{count === 1 ? '' : 's'}</span>
              </div>
              {section.badge && section.id !== 'admin' && (
                <span className={`${CHIP} mt-1.5 self-start`}>Applies to: {appliesToLine([section.badge.toLowerCase()]).replace('Applies to: ', '')}</span>
              )}
              <ul className="mt-3 grid gap-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
                {shown.map((sub) => (
                  <li key={sub.anchor} className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link to={guideHref(sub.anchor)} className="text-[12.5px] font-semibold leading-snug text-gray-800 hover:text-violet-700 dark:text-gray-200 dark:hover:text-violet-300">
                      {sub.title}
                    </Link>
                    {!section.badge && Array.isArray(sub.appliesTo) && sub.appliesTo.length > 0 && (
                      <span className={CHIP}>{appliesToLine(sub.appliesTo).replace('Applies to: ', '')}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{count > PREVIEW_PER_AREA ? `+${count - PREVIEW_PER_AREA} more` : 'All shown'}</span>
                <Link to={`/help?view=all#area-${section.id}`} className="text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300">All {count} →</Link>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

/**
 * HC3 — the results: the live line, area chips counting the results shown,
 * and the list the search field controls. Each result opens the guide's page.
 */
export function SearchResults({ search, query, chip = 'all', onChip = () => {}, active = -1, onHover = () => {}, keyboardHelp = true, onOpen = () => {}, scope = null }) {
  const chips = areaChips(search.results);
  const shown = inArea(search.results, chip);
  return (
    <section aria-labelledby="help-results-line" className="grid gap-3.5" data-testid="help-results">
      <p id="help-results-line" role="status" aria-live="polite" className="font-mono text-[12px] font-semibold text-gray-700 dark:text-gray-300" data-testid="help-results-line">
        {resultLine(search)}
      </p>
      {chips.length > 2 && (
        <div role="radiogroup" aria-label="Filter results by area" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={chip === c.id}
              onClick={() => onChip(c.id)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${chip === c.id
                ? 'border-violet-600 bg-violet-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-violet-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}
              data-testid="help-results-chip"
            >
              {c.label}<span className="font-mono text-[10.5px] opacity-80">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <ul id="help-results" role="listbox" aria-label="Search results" className={`${CARD} m-0 list-none overflow-hidden p-0`}>
            {shown.map((r, i) => {
              const p = guidePlacement(r.anchor);
              return (
                <li
                  key={r.anchor}
                  id={`help-result-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => onHover(i)}
                  className={`border-b border-gray-100 last:border-b-0 dark:border-gray-800 ${i === active ? 'bg-violet-50 dark:bg-violet-950/40' : ''}`}
                  data-testid="help-result"
                >
                  <Link to={guideHrefFor(r.anchor, query)} onClick={(e) => onOpen(e, r.anchor)} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
                    <span className="min-w-0">
                      <b className="block text-[14px] font-bold text-gray-900 dark:text-gray-100">{highlight(r.subsectionTitle, query)}</b>
                      <span className="mt-0.5 block font-mono text-[10.5px] text-gray-500 dark:text-gray-400">{resultArea(r).title}</span>
                      <span className="mt-1.5 block text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">{highlight(snippet(r.text, query), query)}</span>
                    </span>
                    <span className="flex flex-wrap items-start gap-2 sm:flex-col sm:items-end">
                      <span className={CHIP}>{appliesToLine(p?.appliesTo)}</span>
                      <ResultVerification anchor={r.anchor} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {search.capped && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border border-t-0 border-gray-200 bg-gray-50 px-4 py-2.5 text-[12px] text-gray-600 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300" data-testid="help-results-capped">
              <span>Showing the first 25. More guides match “{query}”: add a word to narrow them.</span>
            </div>
          )}
          {scope && <SearchScope scope={scope} />}
        </div>
        {keyboardHelp && (
          <aside className="hidden gap-3 lg:grid">
            <section className={`${CARD} px-4 py-3.5`}>
              <h2 className="text-[13px] font-extrabold text-gray-900 dark:text-gray-100">Keyboard</h2>
              <ul className="mt-2 grid list-none gap-1.5 p-0 text-[12px] text-gray-600 dark:text-gray-300">
                <li><span className={KBD}>↑</span> <span className={KBD}>↓</span> move the selection</li>
                <li><span className={KBD}>Enter</span> open the selected guide</li>
                <li><span className={KBD}>Esc</span> clear the search</li>
              </ul>
            </section>
            <section className={`${CARD} px-4 py-3.5`}>
              <h2 className="text-[13px] font-extrabold text-gray-900 dark:text-gray-100">Count</h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">The search stops at 25. It does not know how many more match, so it never shows a total.</p>
            </section>
          </aside>
        )}
      </div>
    </section>
  );
}

/** D4640: what the search reads, and a link to the release notes it does not read. */
export function SearchScope({ scope }) {
  return (
    <p className="mt-2.5 text-[12px] text-gray-500 dark:text-gray-400" data-testid="help-search-scope">
      {scope.line}{' '}
      {scope.notes && <Link to={guideHref(scope.notes.anchor)} className="font-bold text-violet-700 hover:underline dark:text-violet-300">{scope.notes.label} →</Link>}
    </p>
  );
}

/**
 * D7515: a result's verification, only where the ledger records one: the
 * first verified date (or the last, labelled as such) and Stale when the
 * agreed review window has passed. A guide with nothing recorded adds nothing
 * to its row; its page says "Verification pending".
 */
export function ResultVerification({ anchor, verification }) {
  const v = verification || guideVerificationFor(anchor);
  if (v.state === 'pending') return null;
  return (
    <>
      <span className={CHIP} data-testid="help-result-verified">{v.line}</span>
      {v.stale.state === 'stale' && <StateChip kind="stale" lastGood={v.stale.since} data-testid="help-result-stale" />}
    </>
  );
}

/** HC4 — nothing found: broader terms that find something, the areas, and a ticket that carries the search. */
export function NothingFound({ query, fuse, user, onQuery, onTicket, publicCount, chatAvailable = false, onOpenChat = () => {}, scope = null }) {
  const terms = useMemo(() => broaderTerms(query, fuse), [query, fuse]);
  const areas = useMemo(() => areasForTerms(terms, fuse), [terms, fuse]);
  const title = ticketTitleFromSearch(query);
  if (!user) {
    return (
      <section aria-labelledby="help-none" className={`${CARD} grid gap-3 px-5 py-4`} data-testid="help-none">
        <p role="status" className="font-mono text-[12px] font-semibold text-gray-700 dark:text-gray-300">0 results</p>
        <h2 id="help-none" className="text-[16px] font-extrabold text-gray-900 dark:text-gray-100">No public guide matches.</h2>
        <p className="text-[13px] text-gray-600 dark:text-gray-300">Sign in to search every guide.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/login?next=%2Fhelp" className={PRIMARY_ACTION}>Sign in</Link>
          <button type="button" onClick={() => onQuery('')} className={SECONDARY_ACTION}>Browse the {publicCount} public guides</button>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="help-none" className={`${CARD} grid gap-3 px-5 py-4`} data-testid="help-none">
      <p role="status" className="font-mono text-[12px] font-semibold text-gray-700 dark:text-gray-300">0 results</p>
      <h2 id="help-none" className="text-[16px] font-extrabold text-gray-900 dark:text-gray-100">No guide matches “{query}”.</h2>
      <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px] text-gray-700 dark:text-gray-300">
        {terms.length > 0 && (
          <li data-testid="help-none-terms">
            • Try a broader term:{' '}
            {terms.map((t, i) => (
              <React.Fragment key={t}>
                {i > 0 && ', '}
                <button type="button" onClick={() => onQuery(t)} className="font-semibold text-violet-700 underline dark:text-violet-300">{t}</button>
              </React.Fragment>
            ))}
            .
          </li>
        )}
        <li>
          • Browse an area:{' '}
          {areas.map((a) => (
            <React.Fragment key={a.id}>
              <Link to={`/help?view=all#area-${a.id}`} className="font-semibold text-violet-700 underline dark:text-violet-300">{a.title}</Link>{' · '}
            </React.Fragment>
          ))}
          <Link to="/help?view=all" className="font-semibold text-violet-700 underline dark:text-violet-300">All guides</Link>
        </li>
      </ul>
      <div className="grid gap-1 rounded-xl border border-dashed border-violet-300 bg-violet-50/60 px-3.5 py-3 dark:border-violet-800 dark:bg-violet-950/30">
        <span className={`${LABEL_BASE} text-violet-700 dark:text-violet-300`}>Open a ticket · carries your search</span>
        <b className="text-[13px] text-gray-900 dark:text-gray-100">Title: {title}</b>
        <span className="text-[12px] text-gray-600 dark:text-gray-300">You can edit the title and add a description before Submit.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onTicket(title)} className={SECONDARY_ACTION} data-testid="help-none-ticket">Open a ticket</button>
        {chatAvailable && <button type="button" onClick={onOpenChat} className={SECONDARY_ACTION} data-testid="help-none-chat">Message the team</button>}
        <Link to="/status" className="inline-flex min-h-[40px] items-center px-2 text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300">Status page →</Link>
      </div>
      {scope && <SearchScope scope={scope} />}
    </section>
  );
}

/**
 * The search's state for one page: the results, the chip, the selection, and
 * the field's keys. A search that found nothing is recorded, once per query,
 * when the member stops typing (`SEARCH_MISS_IDLE_MS`); signed out, never.
 */
function useHelpSearch({ role, query, setQuery, user }) {
  const navigate = useNavigate();
  const fuse = useMemo(() => createDocsFuse(role), [role]);
  const trimmedQuery = query.trim();
  const search = useMemo(() => searchGuides(fuse, trimmedQuery), [fuse, trimmedQuery]);
  const [chip, setChip] = useState('all');
  const [active, setActive] = useState(-1);
  useEffect(() => { setChip('all'); setActive(-1); }, [trimmedQuery]);
  const shown = inArea(search.results, chip);

  const recorded = useRef(new Set());
  useEffect(() => {
    if (!user || !trimmedQuery || search.results.length > 0 || trimmedQuery.length < 2) return undefined;
    const key = trimmedQuery.toLowerCase();
    if (recorded.current.has(key)) return undefined;
    const t = setTimeout(() => {
      recorded.current.add(key);
      helpCenterApi.recordSearchMiss(trimmedQuery).catch((e) => reportError('HelpCenter:search-miss', e));
    }, SEARCH_MISS_IDLE_MS);
    return () => clearTimeout(t);
  }, [user, trimmedQuery, search.results.length]);

  // D4640: opening a result first writes the search into the home's own
  // address, so Back returns to these results, then opens the guide with the
  // search in its address. A click with a modifier is left to the browser.
  const openGuide = (anchor) => {
    navigate(searchHref(trimmedQuery), { replace: true });
    navigate(guideHrefFor(anchor, trimmedQuery));
  };
  const onOpen = (e, anchor) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    openGuide(anchor);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown.length) return;
      e.preventDefault();
      setActive((i) => moveSelection(e.key, i, shown.length));
    } else if (e.key === 'Enter') {
      const r = shown[active];
      if (r) { e.preventDefault(); openGuide(r.anchor); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
    }
  };
  return {
    fuse, trimmedQuery, search, chip, setChip: (c) => { setChip(c); setActive(-1); }, active, setActive, onKeyDown, onOpen,
    activeId: active >= 0 && shown[active] ? `help-result-${active}` : null,
  };
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
    : `${state.open.length} open${isAdmin ? ' · every member' : ''}`;

  return (
    <section aria-labelledby="help-tickets" className={`${CARD} flex flex-col px-5 py-[18px]`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="help-tickets" className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{meta}</span>
      </div>

      {state.status === 'loading' && (
        <div className="mt-3 grid gap-2" aria-busy="true" aria-label="Loading your tickets">
          {[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-gray-100 motion-reduce:animate-none dark:bg-gray-800" />)}
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="mt-3 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="text-[12.5px]">{isAdmin ? 'The ticket queue could not be read.' : 'Your tickets could not be read.'}</span>{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-xs font-bold underline">Try again</button>
          <span className="mt-1 block text-[11.5px]">Not “no open tickets”. Guides and search keep working.</span>
        </div>
      )}

      {state.status === 'ok' && state.open.length === 0 && (
        <p className="mt-3 text-[12.5px] text-gray-500 dark:text-gray-400">
          {isAdmin ? 'No open tickets across the platform.' : 'You have no open tickets.'}
        </p>
      )}

      {state.status === 'ok' && state.open.length > 0 && (
        <ul className="mt-2.5">
          {state.open.slice(0, CARD_ROWS).map((t) => {
            const st = statusChip(t.status);
            return (
              <li key={t.id} className="grid gap-1 border-b border-gray-100 py-2.5 last:border-b-0 dark:border-gray-800">
                <Link to={`/help/tickets/${t.id}`} className="min-w-0 text-[13px] font-bold tracking-tight text-gray-900 hover:text-violet-700 dark:text-gray-100 dark:hover:text-violet-300">
                  {t.title}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                  <span>#{t.id}</span>
                  {st && <span className={st.className}>{st.text}</span>}
                  <BountyBadge bounty={t.bounty} />
                  <ReviewBadge review={t.review} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2.5 pt-3">
        <Link to="/help/tickets?new=1" className={SECONDARY_ACTION}>Open a ticket</Link>
        <Link to="/help/tickets" className="text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300">
          {isAdmin ? 'All tickets →' : 'All your tickets →'}
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
// not read as "all good". HC11: each state carries a word and a glyph, never
// colour alone.
const STATUS_LINE = {
  operational: { text: 'All monitored services operational', dot: 'bg-emerald-600', glyph: '✓' },
  degraded: { text: 'Some systems degraded', dot: 'bg-amber-500', glyph: '!' },
  down: { text: 'Active outage', dot: 'bg-red-600', glyph: '✕' },
  // D332 — a failed probe says so, rather than vanishing: silence reads as
  // nothing to report, not as a failed read.
  unknown: { text: 'Status could not be read', dot: 'bg-gray-500', glyph: '?' },
};

function StillStuck({ user, onOpenChat, onSecurity }) {
  const overall = useOverallStatus();
  // Offered only to viewers the worker would actually serve. The gate is
  // enforced server-side either way (402); this decides whether the channel is
  // shown at all, so nobody is invited into a paywall.
  const chatAvailable = canUseCustomerChat(user);

  return (
    <section aria-labelledby="help-stuck" className={`${CARD} px-5 py-5`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 id="help-stuck" className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Still stuck?</h2>
          <p className="mt-1.5 max-w-[440px] text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
            {user
              ? 'Search first. Ordinary tickets and replies may be mirrored to a public tracker; do not send secrets or confidential records.'
              : 'Search these public guides. Sign in for account-specific support, or report a security concern privately.'}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link to={user ? '/help/tickets?new=1' : '/login?next=%2Fhelp%2Ftickets%3Fnew%3D1'} className={PRIMARY_ACTION}>{user ? 'Open a ticket' : 'Sign in to open a ticket'}</Link>
          {chatAvailable && (
            <button type="button" onClick={onOpenChat} className={SECONDARY_ACTION}>Message the team</button>
          )}
          {user
            ? <button type="button" onClick={onSecurity} className={SECONDARY_ACTION} data-testid="help-stuck-security">Private security report</button>
            : <a href={ADVISORY_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_ACTION}>Private security report ↗</a>}
          <span className="flex flex-col items-center gap-1">
            <Link to={user ? '/trust/me' : '/trust/disclosure'} className={SECONDARY_ACTION}>{user ? 'What we can see' : 'Disclosure guidance'}</Link>
            <span className="font-mono text-[9.5px] text-gray-500 dark:text-gray-400">Trust Center</span>
          </span>
          {!user && <a href={`mailto:${SECURITY_EMAIL}`} className="inline-flex min-h-[40px] items-center px-2 text-[12.5px] font-semibold text-violet-700 dark:text-violet-300">{SECURITY_EMAIL}</a>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3.5 dark:border-gray-800">
        <StatusLine overall={overall} />
        <Link to="/status" className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300">
          Status page →
        </Link>
      </div>
    </section>
  );
}

export function StatusLine({ overall }) {
  const line = STATUS_LINE[overall];
  return (
    <>
      {line && (
        <span role="status" className="inline-flex items-center gap-2 font-mono text-[11px] text-gray-600 dark:text-gray-300" data-testid="help-status-line">
          <span className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded-full text-[9px] font-bold text-white ${line.dot}`} aria-hidden>{line.glyph}</span>
          {line.text}
        </span>
      )}
    </>
  );
}

function useOverallStatus() {
  const [overall, setOverall] = useState(null);
  useEffect(() => {
    let alive = true;
    request('/public/status')
      .then((d) => { if (alive) setOverall(overallStatus(d?.services)); })
      .catch(() => { if (alive) setOverall('unknown'); });
    return () => { alive = false; };
  }, []);
  return overall;
}

// ---------------------------------------------------------------------------
// HC5, HC6, HC9 — one guide on its own page.
//
// The canvas's guide column and its right column: the overview, the steps,
// tips and pitfalls, related guides and "Did this answer it?" in the column;
// a search, On this page, and the owner and review status beside it. Go to is
// the one primary action, drawn only when the guide names a page this viewer
// can open. Below 1024px On this page folds above the content (HC13C, HC14B).
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
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">No guide at this address.</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        This guide does not exist, or it is not one your account can read.{' '}
        <Link to="/help" className="font-semibold text-violet-700 hover:underline dark:text-violet-300">Back to the Help Center</Link>
      </p>
    </div>
  );
}

/**
 * Owner and review, from `guideGovernance.js`: "Verification pending" until a
 * verified date is recorded (#4641); then "First verified <date>" (D7515), or
 * "Last verified <date>" saying the first is not recorded, and Stale with its
 * age once the agreed review window has passed.
 */
export function OwnerReview({ anchor, verification: given }) {
  const review = guideReviewFor(anchor);
  const verification = given || guideVerificationFor(anchor);
  const recorded = verification.state !== 'pending';
  const assigned = review.owner !== 'Unassigned';
  return (
    <dl className="m-0 grid gap-2.5 rounded-xl border border-gray-200 px-3.5 py-3 dark:border-gray-700" data-testid="help-guide-owner">
      <div className="flex items-baseline justify-between gap-3">
        <dt className={LABEL}>Owner</dt>
        <dd className={`m-0 text-right text-[12.5px] ${assigned ? 'font-bold text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>{assigned ? review.owner : 'Unassigned'}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className={LABEL}>Review</dt>
        <dd className="m-0 inline-flex items-center gap-1.5 text-right text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="help-guide-verified">
          <span aria-hidden className={`inline-block h-[11px] w-[11px] shrink-0 rounded-full ${recorded ? 'bg-emerald-600 dark:bg-emerald-400' : 'border border-dashed border-gray-500 dark:border-gray-400'}`} />
          {verification.line}
        </dd>
      </div>
      {verification.stale.state === 'stale' && (
        <div className="flex justify-end">
          <StateChip kind="stale" lastGood={verification.stale.since} data-testid="help-guide-stale" />
        </div>
      )}
    </dl>
  );
}

/**
 * The guide's search: it starts from the search that found this guide
 * (D4640), and Enter opens the Help home's results for what it holds, which is
 * also how a reader changes topic. Drawn in the right column from 1024px and
 * above the guide below that, each with its own id.
 */
export function GuideSearch({ label, id = 'help-guide-search', initial = '', testid = undefined }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  useEffect(() => { setQ(initial); }, [initial]);
  return (
    <form role="search" aria-label={label} onSubmit={(e) => { e.preventDefault(); if (cleanQuery(q)) navigate(searchHref(q)); }} className="flex items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-3 focus-within:ring-2 focus-within:ring-violet-500/40 dark:border-gray-700 dark:bg-gray-900" data-testid={testid}>
      <Search size={14} aria-hidden className="shrink-0 text-gray-500 dark:text-gray-400" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[14px] text-gray-900 placeholder:text-gray-500 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-400" />
      <button type="submit" className="inline-flex min-h-[36px] shrink-0 items-center rounded-[8px] px-2 text-[12px] font-bold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40">Search</button>
    </form>
  );
}

/**
 * D4640 — Get help, after the guide and before "Did this answer it?": the
 * same safe routes as Still stuck? and the after-No next steps, in context.
 * A ticket carries the guide's link and the search that led here, shown and
 * editable in the sheet; nothing from the member's records is copied. Chat
 * only for a plan the Worker serves; security stays private. Signed out: sign
 * in to file a ticket, or the private advisory.
 */
export function GuideSupport({ user, query = '', onOpenTicket, onOpenChat, onSecurity, overall = null }) {
  const q = cleanQuery(query);
  const chatAvailable = canUseCustomerChat(user);
  return (
    <section id="get-help" aria-labelledby="help-guide-support" className={`${CARD} scroll-mt-6 grid gap-3 px-5 py-4`} data-testid="help-guide-support">
      <h2 id="help-guide-support" className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Need more help with this?</h2>
      <p className="max-w-[560px] text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
        {user
          ? <>A ticket carries this guide’s link{q ? <> and your search, “{q}”</> : ''}. You see and edit it before Submit. Tickets may be mirrored to a public tracker: no secrets or confidential records.</>
          : 'Sign in for account-specific support. Report a security concern privately, never in a ticket.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {user
          ? <button type="button" onClick={onOpenTicket} className={SECONDARY_ACTION} data-testid="help-guide-support-ticket">Open a ticket</button>
          : <Link to="/login?next=%2Fhelp%2Ftickets%3Fnew%3D1" className={SECONDARY_ACTION}>Sign in to open a ticket</Link>}
        {chatAvailable && <button type="button" onClick={onOpenChat} className={SECONDARY_ACTION} data-testid="help-guide-support-chat">Message the team</button>}
        {user
          ? <button type="button" onClick={onSecurity} className={SECONDARY_ACTION} data-testid="help-guide-support-security">Private security report</button>
          : <a href={ADVISORY_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_ACTION}>Private security report ↗</a>}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <StatusLine overall={overall} />
        <Link to="/status" className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300">Status page →</Link>
      </div>
    </section>
  );
}

function GuideSupportLive(props) {
  const overall = useOverallStatus();
  return <GuideSupport {...props} overall={overall} />;
}

function OutlineNav({ outline }) {
  return (
    <nav aria-label="On this page" className="mt-2 grid gap-0.5">
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
  );
}

const H2 = 'text-[19px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100';

export function HelpArticle({ sections, area, guide, user, query = '', onOpenTicket, onOpenChat, onSecurity = () => {} }) {
  const session = useViewMode();
  const location = useLocation();
  const headingRef = useRef(null);
  const section = sections.find((s) => s.id === area);
  const sub = section?.subsections.find((g) => g.id === guide);
  // D4640: a guide opened from inside Help takes focus on its title, so a
  // screen reader announces the new page; a guide loaded from outside keeps
  // the browser's own start.
  useEffect(() => {
    if (location.key === 'default') return;
    headingRef.current?.focus({ preventScroll: true });
  }, [area, guide, location.key]);
  if (!section || !sub) return <GuideNotFound />;

  const anchor = `${section.id}/${sub.id}`;
  const placement = guidePlacement(`${area}/${guide}`, user, session);
  const areaTitle = placement?.areaTitle || section.title;
  const go = goToTarget(placement, user, session);
  const recovery = anchor === 'account/auth-recovery';
  const beforeYouStart = Array.isArray(sub.beforeYouStart) ? sub.beforeYouStart : [];
  const howto = Array.isArray(sub.howto) ? sub.howto : [];
  const recoveryRows = sub.recoveryRows || [];
  const tips = Array.isArray(sub.tips) ? sub.tips : [];
  const pitfalls = Array.isArray(sub.pitfalls) ? sub.pitfalls : [];
  // A related link is `#<area>/<guide>`; one the viewer cannot read (an admin
  // guide, for anyone else) is left out rather than offered as a dead end.
  const related = (Array.isArray(sub.related) ? sub.related : [])
    .map((r) => {
      const target = String(r.href || '').replace(/^#/, '');
      return guideFor(target, sections);
    })
    .filter(Boolean);
  // Signed out, account recovery keeps its own "Still can't get in?" (HC9).
  const support = !(recovery && !user);
  const q = cleanQuery(query);
  const searchLabel = user ? 'Search Help' : 'Search public guides';
  const outline = guideOutline(sub, { related: related.length, support, feedback: !!user, stuck: recovery && !user });
  const openTicket = (missing = '') => onOpenTicket({ anchor, title: sub.title, missing, query: q });

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-14 pt-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <article className="min-w-0">
        {q && (
          <Link to={searchHref(q)} className="mb-3 inline-flex min-h-[44px] max-w-full items-center gap-1.5 text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300" data-testid="help-guide-back-results">
            <ChevronLeft size={15} aria-hidden className="shrink-0" />
            <span className="truncate">Results for “{q}”</span>
          </Link>
        )}
        <div className="mb-4 lg:hidden">
          <GuideSearch label={searchLabel} id="help-guide-search-top" initial={q} testid="help-guide-search-top" />
        </div>
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400">
          <Link to="/help" className="hover:text-violet-700 dark:hover:text-violet-300">Help</Link>
          <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
          <Link to={`/help?view=all#area-${placement?.area || section.id}`} className="hover:text-violet-700 dark:hover:text-violet-300">{areaTitle}</Link>
          <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
          <span aria-current="page" className="text-gray-900 dark:text-gray-100">{sub.title}</span>
        </nav>

        <header className="mt-6 max-w-[680px]">
          {recovery && <span className={`${LABEL_BASE} text-violet-700 dark:text-violet-300`}>Can’t sign in?</span>}
          <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }} className="mt-1 text-[30px] font-extrabold leading-[1.14] tracking-tight text-balance text-gray-900 dark:text-gray-100">{sub.title}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-gray-500 dark:text-gray-400">
            <span className={CHIP}>{appliesToLine(placement?.appliesTo)}</span>
            <span>{readingMinutes(sub)} min read</span>
            <span aria-hidden>·</span>
            <span className="break-all">/help/{anchor}</span>
          </div>
          {go && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link to={go.path} className={PRIMARY_ACTION.replace('min-h-[40px]', 'min-h-[44px]')} data-testid="help-guide-go">{go.label}</Link>
              <span className="text-[12px] text-gray-500 dark:text-gray-400">Opens {go.path}</span>
            </div>
          )}
          {go && anchor === TRACKER_WARNING_ANCHOR && (
            <p role="note" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="help-guide-tracker-warning">
              {TRACKER_WARNING}{' '}
              <Link to={TRACKER_WARNING_LINK.path} className="font-bold underline">{TRACKER_WARNING_LINK.label}</Link>
            </p>
          )}
        </header>

        <details className="mt-5 rounded-xl border border-gray-200 bg-white px-4 py-1 lg:hidden dark:border-gray-800 dark:bg-gray-900">
          <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-[13px] font-semibold text-gray-800 dark:text-gray-200">
            On this page · {outline.length} section{outline.length === 1 ? '' : 's'}
          </summary>
          <div className="pb-3"><OutlineNav outline={outline} /></div>
        </details>

        <div className="mt-6 grid max-w-[680px] gap-6">
          {sub.overview && (
            <section id="overview" className="scroll-mt-6">
              <h2 className={H2}>Overview</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">{sub.overview}</p>
            </section>
          )}

          {beforeYouStart.length > 0 && (
            <section id="before-you-start" className="scroll-mt-6" data-testid="help-guide-before">
              <h2 className={H2}>Before you start</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[14.5px] leading-relaxed text-gray-700 dark:text-gray-300">
                {beforeYouStart.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </section>
          )}

          {sub.markdownUrl && <MarkdownBody url={sub.markdownUrl} />}

          {howto.length > 0 && (
            <section id="steps" className="scroll-mt-6">
              <h2 className={H2}>Steps</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14.5px] leading-relaxed text-gray-700 dark:text-gray-300">
                {howto.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </section>
          )}
          {recoveryRows.length > 0 && (
            <table id="recovery" className="w-full scroll-mt-6 border-collapse text-left text-sm text-gray-700 dark:text-gray-300">
              <caption className="pb-2 text-left text-lg font-bold text-gray-900 dark:text-gray-100">Connector status and next action</caption>
              <thead>
                <tr className="border-b border-gray-300 dark:border-gray-700">
                  <th scope="col" className="py-2 pr-3">Status</th>
                  <th scope="col" className="py-2">What to do</th>
                </tr>
              </thead>
              <tbody>
                {recoveryRows.map(({ status, action }) => (
                  <tr key={status} className="border-b border-gray-200 align-top dark:border-gray-800">
                    <th scope="row" className="py-2 pr-3 font-semibold">{status}</th>
                    <td className="py-2">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tips.length > 0 && (
            <aside id="tips" className="flex scroll-mt-6 items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-900 dark:bg-violet-950/30">
              <Info size={17} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
              <div className="min-w-0">
                <h3 className={`${LABEL_BASE} text-violet-700 dark:text-violet-300`}>Tips</h3>
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
                <h3 className={`${LABEL_BASE} text-amber-800 dark:text-amber-300`}>Pitfalls</h3>
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

          {area === 'troubleshooting' && guide === 'contact-support' && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Security vulnerabilities should not be submitted as ordinary tickets.
              Use the <a href={ADVISORY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-700 underline dark:text-violet-300">private GitHub Security Advisory</a>,
              or the <Link to="/trust/disclosure" className="font-semibold text-violet-700 underline dark:text-violet-300">Trust Center disclosure guidance</Link>.
            </p>
          )}

          {related.length > 0 && (
            <section id="related" className="scroll-mt-6">
              <h2 className={H2}>Related guides</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {related.map((r) => (
                  <Link
                    key={r.anchor}
                    to={guideHrefFor(r.anchor, q)}
                    className={`${CARD} flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:border-violet-200 dark:hover:border-violet-900`}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold leading-snug text-gray-900 dark:text-gray-100">{r.title}</div>
                      <div className="mt-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">{appliesToLine(guidePlacement(r.anchor)?.appliesTo)}</div>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-gray-400" aria-hidden />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {support && <GuideSupportLive user={user} query={q} onOpenTicket={() => openTicket('')} onOpenChat={onOpenChat} onSecurity={onSecurity} />}

          {user && <GuideFeedback anchor={`${section.id}/${sub.id}`} next={{ related, chatAvailable: canUseCustomerChat(user), onOpenChat, onOpenTicket: openTicket }} />}

          {recovery && !user && (
            <section id="still-stuck" aria-labelledby="help-recovery-stuck" className={`${CARD} scroll-mt-6 grid gap-3 px-5 py-4`}>
              <h2 id="help-recovery-stuck" className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100">Still can’t get in?</h2>
              <Link to={guideHref('troubleshooting/contact-support')} className="flex min-h-[44px] items-center justify-between gap-3 border-y border-gray-100 py-2 dark:border-gray-800">
                <span>
                  <b className="block text-[13px] text-gray-900 dark:text-gray-100">Contact support</b>
                  <small className="text-[12px] text-gray-500 dark:text-gray-400">Which channel to use, and what never to send.</small>
                </span>
                <ChevronRight size={15} aria-hidden className="text-gray-400" />
              </Link>
              <div className="flex flex-wrap items-start gap-2">
                <a href={ADVISORY_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_ACTION}>Private security report ↗</a>
                <span className="flex flex-col items-center gap-1">
                  <Link to="/trust/disclosure" className={SECONDARY_ACTION}>Disclosure guidance</Link>
                  <span className="font-mono text-[9.5px] text-gray-500 dark:text-gray-400">Trust Center</span>
                </span>
                <a href={`mailto:${SECURITY_EMAIL}`} className="inline-flex min-h-[40px] items-center px-2 text-[12.5px] font-semibold text-violet-700 dark:text-violet-300">{SECURITY_EMAIL}</a>
              </div>
            </section>
          )}
        </div>
      </article>

      <aside className="hidden lg:block" aria-label="About this guide">
        <div className="sticky top-6 grid gap-5">
          <GuideSearch label={searchLabel} initial={q} />
          {outline.length > 0 && (
            <div>
              <div className={LABEL}>On this page</div>
              <OutlineNav outline={outline} />
            </div>
          )}
          <OwnerReview anchor={anchor} />
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HC1, HC2, HC12 — the home.
// ---------------------------------------------------------------------------

/** HC2 — the public guides, Account recovery first. */
function PublicGuideList({ sections }) {
  const guides = publicGuides(sections);
  return (
    <section aria-labelledby="help-public" className="grid gap-2.5">
      <h2 id="help-public" className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Public guides</h2>
      <ul className={`${CARD} m-0 list-none overflow-hidden p-0`}>
        {guides.map((g, i) => (
          <li key={g.anchor} className={`border-b border-gray-100 last:border-b-0 dark:border-gray-800 ${i === 0 ? 'bg-violet-50/60 dark:bg-violet-950/30' : ''}`} data-testid="help-public-guide">
            <Link to={guideHref(g.anchor)} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                {i === 0 && <span className={`${LABEL_BASE} block text-violet-700 dark:text-violet-300`}>Can’t sign in?</span>}
                <b className="block text-[14px] text-gray-900 dark:text-gray-100">{g.title}</b>
                {g.overview && <small className="block text-[12.5px] text-gray-600 dark:text-gray-300">{g.overview}</small>}
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[11.5px] text-gray-500 dark:text-gray-400">
                {readingMinutes(g)} min read <ChevronRight size={14} aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HelpHome({ visibleSections, role, user, query, setQuery, searchInputRef, onOpenChat, onTicket, onSecurity }) {
  // The search index is role-scoped, so a viewer never finds a guide the
  // browse grid would not show them.
  const s = useHelpSearch({ role, query, setQuery, user });
  const { trimmedQuery } = s;
  const publicCount = useMemo(() => publicGuides(visibleSections).length, [visibleSections]);
  const scope = useMemo(() => searchScope(visibleSections), [visibleSections]);

  return (
    <>
      <HelpHero
        user={user}
        publicCount={publicCount}
        query={query}
        setQuery={setQuery}
        searchInputRef={searchInputRef}
        activeId={s.activeId}
        onKeyDown={s.onKeyDown}
      />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-10 pt-6 md:px-8">
        {trimmedQuery && s.search.results.length > 0 && (
          <SearchResults search={s.search} query={trimmedQuery} chip={s.chip} onChip={s.setChip} active={s.active} onHover={s.setActive} onOpen={s.onOpen} scope={scope} />
        )}
        {trimmedQuery && s.search.results.length === 0 && (
          <NothingFound query={trimmedQuery} fuse={s.fuse} user={user} onQuery={setQuery} onTicket={(title) => onTicket({ kind: 'ticket', title })} publicCount={publicCount} chatAvailable={canUseCustomerChat(user)} onOpenChat={onOpenChat} scope={scope} />
        )}
        {!trimmedQuery && user && (
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <section className={`${CARD} px-5 py-[18px]`}>
              <PopularGuides sections={visibleSections} />
            </section>
            <YourTicketsCard isAdmin={role === 'admin'} />
          </div>
        )}
        {!trimmedQuery && (user ? <BrowseByTask sections={visibleSections} /> : <PublicGuideList sections={visibleSections} />)}
        {role === 'admin' && <GuideAnswersAdmin sections={visibleSections} />}
        <StillStuck user={user} onOpenChat={onOpenChat} onSecurity={onSecurity} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A9m, the Help home on a phone. A guide page is unchanged.
// ---------------------------------------------------------------------------

/**
 * A9m's three sections. The first is "Popular this week" (D621) where the
 * canvas draws "For you now", which has no store. Contact opens a ticket,
 * where the team can reply in its thread. `popular` is `usePopularGuides`'
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
            <Link to={guideHref(sub.anchor)} className="block min-h-[44px] py-1 text-[13px] font-semibold text-gray-800 hover:text-violet-700 dark:text-gray-200 dark:hover:text-violet-300">
              {sub.title}
              <span className="block font-mono text-[10px] font-normal text-gray-500 dark:text-gray-400">{appliesToLine(sub.appliesTo)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A9m — the bar and the three sections, then `children`: the open area,
 * results, tickets and Still stuck. D6861 (HC13A): `search` is drawn
 * directly under the bar's title, before the sections. D4640 (HC13B): while
 * a query is typed (`browsing` false) the sections are not drawn, so the
 * results sit directly under the search; clearing it brings them back.
 */
export function HelpPhoneView({ popular, onRetry, areas, openArea, onArea, search = null, browsing = true, children = null }) {
  return (
    <AccountPhonePage
      pageKey="help"
      bleed
      testid="help-phone"
      groups={browsing ? helpPhoneGroups({ popular, onRetry, areas, openArea, onArea }) : []}
      header={search ? (bar) => <>{bar}<div className="px-[22px] pt-3">{search}</div></> : null}
    >
      {children}
    </AccountPhonePage>
  );
}

function HelpPhoneHome({ visibleSections, role, user, query, setQuery, searchInputRef, onOpenChat, onTicket, onSecurity }) {
  const [popular, retry] = usePopularGuides(visibleSections, !!user);
  const [openArea, setOpenArea] = useState(null);
  const areas = useMemo(() => helpAreas(visibleSections), [visibleSections]);
  const s = useHelpSearch({ role, query, setQuery, user });
  const { trimmedQuery } = s;
  const publicCount = useMemo(() => publicGuides(visibleSections).length, [visibleSections]);
  const area = areas.find((a) => a.id === openArea);
  const scope = useMemo(() => searchScope(visibleSections), [visibleSections]);
  const box = (
    <HelpSearchBox
      compact
      query={query}
      setQuery={setQuery}
      searchInputRef={searchInputRef}
      activeId={s.activeId}
      onKeyDown={s.onKeyDown}
      label={user ? 'Search the Help Center' : 'Search the public guides'}
      placeholder="Search guides"
    />
  );
  return (
    <HelpPhoneView popular={popular} onRetry={retry} areas={areas} openArea={openArea} onArea={setOpenArea} search={box} browsing={!trimmedQuery}>
      {trimmedQuery && s.search.results.length > 0 && (
        <SearchResults search={s.search} query={trimmedQuery} chip={s.chip} onChip={s.setChip} active={s.active} onHover={s.setActive} keyboardHelp={false} onOpen={s.onOpen} scope={scope} />
      )}
      {trimmedQuery && s.search.results.length === 0 && (
        <NothingFound query={trimmedQuery} fuse={s.fuse} user={user} onQuery={setQuery} onTicket={(title) => onTicket({ kind: 'ticket', title })} publicCount={publicCount} chatAvailable={canUseCustomerChat(user)} onOpenChat={onOpenChat} scope={scope} />
      )}
      {!trimmedQuery && area && <AreaGuides area={area} />}
      {!trimmedQuery && user && <YourTicketsCard isAdmin={role === 'admin'} />}
      {!trimmedQuery && role === 'admin' && <GuideAnswersAdmin sections={visibleSections} />}
      <StillStuck user={user} onOpenChat={onOpenChat} onSecurity={onSecurity} />
      {user && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <button type="button" onClick={() => onTicket({ kind: 'ticket' })} className={`${PRIMARY_ACTION.replace('min-h-[40px]', 'min-h-[48px]')} shadow-lg`} data-testid="help-phone-need-help">Need help?</button>
        </div>
      )}
    </HelpPhoneView>
  );
}

export default function DocsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchInputRef = useRef(null);
  // `?q=` prefills the search. `/support?topic=<x>` redirects here as
  // `/help?q=<x>`: `ErrorState` builds that URL from the surface that just
  // failed, which is a better opening query than an empty box. Read when the
  // address changes, so typing is never fought.
  const urlQuery = new URLSearchParams(location.search).get('q') || '';
  const directory = new URLSearchParams(location.search).get('view') === 'all';
  const [query, setQuery] = useState(() => urlQuery);
  useEffect(() => { setQuery(urlQuery); }, [urlQuery]);
  const [chatOpen, setChatOpen] = useState(false);
  // HC7: the ticket sheet's draft, or null while it is closed.
  const [sheet, setSheet] = useState(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const { user, role } = useAuth() || {};
  const helpRole = user ? role : 'public';
  const phone = usePhoneWidth();

  // Task #2 (DD) — the manifest filtered to what this viewer's role may read.
  // Admin sections and subsections are absent for everyone else: from the
  // grid, from search, and from the guide pages, which answer "not found".
  const visibleSections = useMemo(
    () => filterSectionsForRole(SECTIONS, helpRole),
    [helpRole],
  );
  const restrictedAnchors = useMemo(() => adminOnlyAnchors(), []);
  const isAdmin = role === 'admin';
  const route = parseGuidePath(location.pathname);

  // D6996 (#6996): the head says which page this is, as its prerendered HTML does. A guide this viewer can read
  // takes its own title and description (`helpMeta.js`); an address with no such guide names none and is noindex;
  // the home and the directory take the registry's /help entry. No pageview beacon: this page never sent one.
  const guideSection = route ? visibleSections.find((s) => s.id === route.area) : null;
  const guideSub = guideSection?.subsections.find((s) => s.id === route.guide) || null;
  const guideMeta = guideSub ? helpGuideMeta(guideSection, guideSub) : null;
  usePageMeta({
    path: guideMeta ? guideMeta.path : location.pathname,
    title: guideMeta?.title,
    description: guideMeta?.description,
    robots: route && !guideMeta ? 'noindex' : undefined,
    analytics: false,
  });

  // `#<area>/<guide>` was every guide's address until each had its own page,
  // and it is in notifications already sent, the advisor's tools and people's
  // bookmarks. So a hash on the home opens that guide (`hashTarget` says where).
  useEffect(() => {
    if (route || directory) return;
    const target = hashTarget(decodeURIComponent(location.hash), visibleSections, { isAdmin, restricted: restrictedAnchors });
    if (target) navigate(target, { replace: true });
  }, [route, directory, location.hash, isAdmin, restrictedAnchors, visibleSections, navigate]);

  // The directory opens at the area its link names (`#area-<id>`).
  useEffect(() => {
    if (!directory || !location.hash.startsWith('#area-')) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [directory, location.hash]);

  // `/` focuses the search on the home — but only when the reader is not
  // already typing in another field.
  useEffect(() => {
    if (route || directory) return undefined;
    const onKey = (e) => {
      if (e.key !== '/') return;
      const t = e.target;
      const tag = (t && t.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      e.preventDefault();
      const el = searchInputRef.current;
      if (el) {
        el.focus();
        el.select?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, directory]);

  // D7004 (#7004): the guide's BreadcrumbList, the same trail its page draws; removed when the page leaves.
  const crumbLd = useMemo(
    () => (route ? guideBreadcrumbLd(visibleSections, route.area, route.guide) : null),
    [route?.area, route?.guide, visibleSections],
  );
  useEffect(() => (crumbLd ? injectJsonLd('help-guide-breadcrumb', crumbLd) : undefined), [crumbLd]);

  // A guide opens at its top, not at the scroll position the last page left.
  useEffect(() => {
    if (!route) return;
    document.querySelector('[data-app-scroll]')?.scrollTo?.({ top: 0 });
  }, [route?.area, route?.guide]);

  // HC6 → HC7: a ticket from a guide carries its link and the member's words.
  // D4640: and the search that led to it, when the guide's address carries one.
  const openGuideTicket = ({ anchor, title, missing, query: q }) => {
    setSheet({ kind: 'ticket', from: { anchor, title }, ...guideTicketDraft({ anchor, title, missing, query: q }) });
  };
  const openSheet = (draft) => { if (user) setSheet({ from: null, ...draft }); };
  const shared = {
    visibleSections,
    role: helpRole,
    user,
    query,
    setQuery,
    searchInputRef,
    onOpenChat: () => setChatOpen(true),
    onTicket: openSheet,
    onSecurity: () => openSheet({ kind: 'security' }),
  };

  return (
    // D4640: a guide takes back the shell's padding only inside the shell
    // (`data-app-main`); rendered on its own it has none to take, and the
    // negative margins pushed it off the left edge and scrolled the page sideways.
    <div className={`${route ? '[[data-app-main]_&]:-mx-4 [[data-app-main]_&]:-my-4 md:[[data-app-main]_&]:-mx-6 md:[[data-app-main]_&]:-my-6 ' : ''}min-h-[calc(100vh-64px)] bg-gray-50 dark:bg-gray-950`} data-testid="help-root">
      {route ? (
        <HelpArticle sections={visibleSections} area={route.area} guide={route.guide} user={user} query={urlQuery} onOpenTicket={openGuideTicket} onOpenChat={() => setChatOpen(true)} onSecurity={shared.onSecurity} />
      ) : directory ? (
        <HelpDirectory sections={visibleSections} role={helpRole} />
      ) : phone ? (
        <HelpPhoneHome {...shared} />
      ) : (
        <HelpHome {...shared} />
      )}
      {user && sheet && <HelpTicketSheet initial={sheet} onClose={closeSheet} />}
      {/* Task #103 — the chat panel renders null while closed and only polls
          while open, so an ineligible viewer (who never gets the button) pays
          nothing for it. */}
      {user && <CustomerChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

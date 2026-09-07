import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  BookOpen, Search, ChevronRight, X, AlertTriangle, MessageSquare,
  Compass, Rocket, Hammer, TrendingUp, DollarSign, Scale,
  Network, LayoutDashboard, UserCircle, LifeBuoy, FileText, History,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SECTIONS, filterSectionsForRole, adminOnlyAnchors } from './sections';
import { createDocsFuse, splitForHighlight, snippet } from '../../lib/docs/search';
import { useAuth } from '../../hooks/useAuthSync';
import { request } from '../../lib/api';
import { overallStatus } from '../../lib/statusOverall';
import { canUseCustomerChat } from '../../lib/customerChat';
import CustomerChatWidget from '../../components/CustomerChatWidget';

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

// Fetched markdown lands inside a `<section>` under the subsection's `<h3>`,
// so its own headings have to start below that — a `# ` at the top of a file
// is the file's title, not the page's. It rendered as a second `<h1>`: the
// page had one, and `/CHANGELOG-user.md` opens with "# What's new", so /docs
// has been shipping two competing top-level headings for as long as that file
// has been linked. The render check is what caught it, on a page whose one
// `<h1>` is now a question the second one does not answer.
//
// Each level shifts down one and the class hooks above shift with it, so the
// visual hierarchy is unchanged — this is a document-structure fix, not a
// restyle.
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
    <div className="prose prose-sm max-w-none text-sm text-gray-700 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-900 [&_h3]:mt-5 [&_h3]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-gray-900 [&_h4]:mt-4 [&_h4]:mb-2 [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:leading-relaxed [&_li]:mb-1 [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_blockquote]:border-l-2 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_a]:text-violet-700 [&_a]:underline dark:text-gray-300">
      <ReactMarkdown components={MARKDOWN_HEADINGS}>{state.text}</ReactMarkdown>
    </div>
  );
}
function SectionIcon({ name, ...rest }) {
  const Icon = ICONS[name] || FileText;
  return <Icon {...rest} />;
}

function SubsectionView({ section, sub }) {
  const anchorId = `${section.id}/${sub.id}`;
  return (
    <section
      id={anchorId}
      data-anchor={anchorId}
      className="scroll-mt-20 mb-12"
    >
      <h3 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">{sub.title}</h3>
      {sub.overview && (
        <p className="text-sm text-gray-700 leading-relaxed mb-4 dark:text-gray-300">{sub.overview}</p>
      )}

      {sub.markdownUrl && (
        <div className="mb-4">
          <MarkdownBody url={sub.markdownUrl} />
        </div>
      )}

      {Array.isArray(sub.howto) && sub.howto.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">How to use it</h4>
          <ol className="list-decimal list-outside pl-5 text-sm text-gray-700 space-y-1.5 dark:text-gray-300">
            {sub.howto.map((step, i) => <li key={i} className="leading-relaxed">{step}</li>)}
          </ol>
        </div>
      )}

      {Array.isArray(sub.tips) && sub.tips.length > 0 && (
        <div className="mb-4 bg-violet-50 border border-violet-100 rounded-lg p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-700 mb-2">Tips</h4>
          <ul className="list-disc list-outside pl-5 text-sm text-gray-700 space-y-1 dark:text-gray-300">
            {sub.tips.map((tip, i) => <li key={i} className="leading-relaxed">{tip}</li>)}
          </ul>
        </div>
      )}

      {Array.isArray(sub.pitfalls) && sub.pitfalls.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800 mb-2">
            <AlertTriangle size={12} /> Common pitfalls
          </h4>
          <ul className="list-disc list-outside pl-5 text-sm text-gray-700 space-y-1 dark:text-gray-300">
            {sub.pitfalls.map((p, i) => <li key={i} className="leading-relaxed">{p}</li>)}
          </ul>
        </div>
      )}

      {sub.screenshot && (
        <figure className="mb-4 border border-gray-200 rounded-lg overflow-hidden dark:border-gray-800">
          <img src={sub.screenshot} alt={sub.title} className="w-full block" loading="lazy" />
          {sub.screenshotCaption && (
            <figcaption className="bg-gray-50 px-3 py-2 text-xs text-gray-500">{sub.screenshotCaption}</figcaption>
          )}
        </figure>
      )}

      {Array.isArray(sub.related) && sub.related.length > 0 && (
        <div className="mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Related features</h4>
          <ul className="flex flex-wrap gap-2">
            {sub.related.map((r, i) => (
              <li key={i}>
                <a
                  href={r.href}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-gray-200 text-violet-700 hover:bg-violet-50 hover:border-violet-200 dark:border-gray-800"
                >
                  {r.label}
                  <ChevronRight size={11} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Task #103 — the Help Center's front door, composed over this corpus.
//
// The Help Center canvas describes a hero ("How can we help?"), a search with
// suggested queries, and a "browse by what you are doing" category grid. All
// three are presentation over the manifest that was already here; nothing
// below authors an article or invents a store.
//
// Four canvas elements are deliberately absent, and each is absent for the
// same reason — there is nothing behind it:
//
//   · "Popular this week" ranks articles by view count. Nothing counts views.
//     A hardcoded top five is a claim about other readers' behaviour.
//   · "Did this answer it? Yes / No" needs somewhere to put the answer. There
//     is no feedback table, so the buttons would discard every press.
//   · "Where this lives" / "Open the surface" need a `surface` route on each
//     of ~98 subsections. That is content authoring, and a deep link to the
//     wrong page is worse than no deep link.
//   · "Applies to <persona>" reads a `roles` array. Exactly one section file
//     carries one (`sections/admin.js`) and it is not in the manifest, so the
//     line would render "Everyone" on 98 articles out of 98.
//
// `frontend/test/help_center_contract.test.mjs` asserts they stay absent, the
// way the Trust Center guard does — so that reinstating one is a decision
// someone takes on purpose rather than a canvas element quietly reappearing
// with fixture data behind it.
// ---------------------------------------------------------------------------

// Suggested queries under the hero. These are shortcuts into the corpus, not
// decoration, so the contract test runs each one through the real fuse index
// and fails if it returns nothing: a chip that finds no article is a dead end
// dressed as a suggestion, and copy edits upstream are exactly how one would
// become that without anyone noticing.
const SUGGESTED_SEARCHES = ['cap table', 'data room', 'capital call', 'KYC', 'integrations'];

function HelpHero({ query, setQuery, searchInputRef, onSuggest }) {
  return (
    <header className="mb-10">
      <div className="flex items-center gap-2 text-violet-600 text-xs font-semibold uppercase tracking-widest mb-2">
        <LifeBuoy size={14} /> Help
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2 dark:text-gray-100">How can we help?</h1>
      <p className="text-sm text-gray-500 max-w-2xl">
        Every guide on the platform, grouped by what you are doing rather than by
        who owns the code. Search it, or browse the categories below.
      </p>

      <div className="relative mt-5 max-w-2xl">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guides… (press /)"
          aria-label="Search the Help Center"
          className="w-full pl-10 pr-9 py-3 text-sm rounded-xl border border-gray-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 placeholder:text-gray-400 dark:border-gray-800 dark:bg-gray-900"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-400">Try</span>
        {SUGGESTED_SEARCHES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className="px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-violet-200 hover:text-violet-700 hover:bg-violet-50 transition-colors dark:border-gray-800 dark:text-gray-300"
          >
            {s}
          </button>
        ))}
      </div>
    </header>
  );
}

// "Browse by what you are doing" — one card per section, built from the
// role-filtered manifest rather than a hand-kept list, so a new section file
// appears here the moment it is added to `sections/index.js` and an
// admin-only one never appears for anyone else.
//
// The card's only figure is its article count, which is `subsections.length`
// — a fact about the manifest in hand. The canvas also puts a persona line on
// each card; see the block comment above for why that one is not here.
const PREVIEW_PER_CATEGORY = 3;

function BrowseByTask({ sections, onPick }) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Browse by what you are doing
        </h2>
        <span className="text-xs text-gray-400">
          {sections.length} categories
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => {
          const preview = section.subsections.slice(0, PREVIEW_PER_CATEGORY);
          const more = section.subsections.length - preview.length;
          return (
            <div
              key={section.id}
              className="rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-200 transition-colors dark:border-gray-800 dark:bg-gray-900"
            >
              <button
                type="button"
                onClick={() => onPick(`${section.id}/${section.subsections[0].id}`)}
                className="flex items-center gap-2 text-left"
              >
                <SectionIcon name={section.icon} size={15} className="text-violet-600" />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{section.title}</span>
              </button>
              <div className="mt-0.5 text-[11px] text-gray-400">
                {section.subsections.length} guide{section.subsections.length === 1 ? '' : 's'}
              </div>
              <ul className="mt-3 space-y-1">
                {preview.map((sub) => (
                  <li key={sub.id}>
                    <button
                      type="button"
                      onClick={() => onPick(`${section.id}/${sub.id}`)}
                      className="text-left text-[12.5px] text-gray-600 hover:text-violet-700 dark:text-gray-300"
                    >
                      {sub.title}
                    </button>
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => onPick(`${section.id}/${section.subsections[0].id}`)}
                  className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:underline dark:text-violet-300"
                >
                  {more} more <ChevronRight size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The search results, rendered in the content column where the reader's eye
// already is. The left rail keeps its own compact list — same state, same
// results, different shape: the rail is navigation, this is the answer.
function SearchResults({ results, query, onPick }) {
  return (
    <section className="mb-12">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">
        {results.length} result{results.length === 1 ? '' : 's'} for “{query}”
      </h2>
      {results.length === 0 ? (
        <p className="text-sm text-gray-500">
          No guide matches that. Try a broader term, or use the contact options at
          the bottom of this page.
        </p>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.anchor}>
              <button
                type="button"
                onClick={() => onPick(r.anchor)}
                className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-200 transition-colors dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {highlight(r.subsectionTitle, query)}
                </div>
                <div className="text-[11px] text-gray-400 mb-1">{r.sectionTitle}</div>
                <div className="text-xs text-gray-600 leading-relaxed dark:text-gray-300">
                  {highlight(snippet(r.text, query), query)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "Still stuck?" — the canvas's contact block, with the one live element it
// asks for: the current platform status, read from `GET /api/public/status`,
// the same endpoint /status renders. Someone reading the docs because a
// feature is not behaving should not have to go looking to find out the
// platform is degraded.
//
// The roll-up rule is shared with /status (lib/statusOverall.js) so the two
// pages cannot disagree, and the line renders nothing at all until the probe
// answers — an unreachable status endpoint must not read as "all good".
const STATUS_LINE = {
  operational: { text: 'All systems operational', dot: 'bg-emerald-500' },
  degraded: { text: 'Some systems degraded', dot: 'bg-amber-500' },
  down: { text: 'Active outage', dot: 'bg-red-500' },
};

function StillStuck({ user, onOpenChat }) {
  const [overall, setOverall] = useState(null);

  useEffect(() => {
    let alive = true;
    request('/public/status')
      .then((d) => { if (alive) setOverall(overallStatus(d?.services)); })
      // A failed probe stays silent rather than claiming either state.
      .catch(() => { if (alive) setOverall('unknown'); });
    return () => { alive = false; };
  }, []);

  const line = STATUS_LINE[overall];
  // Task #103 — offered only to viewers the worker would actually serve. The
  // gate is enforced server-side either way (402); this decides whether the
  // channel is shown at all, so nobody is invited into a paywall.
  const chatAvailable = canUseCustomerChat(user);

  return (
    <footer className="mt-16 pt-6 border-t border-gray-200 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Still stuck?</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Nothing here answering it? Reach a person.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {/* Task #103 — this used to read "Open a ticket from the Tickets page
            in the sidebar", naming a sidebar item D39 had already renamed to
            "Help Center". Directions beat names: the link goes to the flow. */}
        <Link
          to="/help/tickets"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-violet-200 hover:text-violet-700 transition-colors dark:border-gray-800 dark:text-gray-200"
        >
          <FileText size={12} /> Open a ticket
        </Link>
        {chatAvailable && (
          <button
            type="button"
            onClick={onOpenChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-violet-200 hover:text-violet-700 transition-colors dark:border-gray-800 dark:text-gray-200"
          >
            <MessageSquare size={12} /> Message the team
          </button>
        )}
        <a
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-violet-200 hover:text-violet-700 transition-colors dark:border-gray-800 dark:text-gray-200"
          href="mailto:support@axal.vc"
        >
          <LifeBuoy size={12} /> support@axal.vc
        </a>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {line && (
          <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <span className={`h-2 w-2 rounded-full ${line.dot}`} aria-hidden />
            {line.text}
          </span>
        )}
        <Link to="/status" className="text-violet-700 hover:underline dark:text-violet-300">
          Status page →
        </Link>
      </div>
    </footer>
  );
}

export default function DocsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);
  // Task #103 — `?q=` prefills the search. `/support?topic=<x>` redirects here
  // as `/help?q=<x>`: `ErrorState` builds that URL from the surface that just
  // failed ("projects", "integrations", "signals", "activity"), which is a
  // better opening query than an empty box for someone who arrived from a
  // broken page. Read once, as the initial value, so typing is never fought.
  const [query, setQuery] = useState(
    () => new URLSearchParams(location.search).get('q') || '',
  );
  const [chatOpen, setChatOpen] = useState(false);
  const { user, role } = useAuth() || {};

  // Task #2 (DD) — Filter the docs manifest down to what the current
  // viewer's role is allowed to see. Admin sections/subsections are
  // hidden from the rail, the right "On this page" list, and the
  // body content for non-admin viewers.
  const visibleSections = useMemo(
    () => filterSectionsForRole(SECTIONS, role),
    [role],
  );

  // Stable set of admin-only anchors (computed once from the static
  // manifest). Used to guard direct hash navigation below.
  const restrictedAnchors = useMemo(() => adminOnlyAnchors(), []);
  const isAdmin = role === 'admin';

  const firstAnchor = visibleSections.length > 0
    ? `${visibleSections[0].id}/${visibleSections[0].subsections[0].id}`
    : '';
  const [activeAnchor, setActiveAnchor] = useState(firstAnchor);

  // Lazily build the fuse.js index, role-scoped so non-admins never
  // see admin pages in search results.
  const fuse = useMemo(() => createDocsFuse(role), [role]);

  const trimmedQuery = query.trim();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    return fuse.search(trimmedQuery, { limit: 25 }).map(r => r.item);
  }, [fuse, trimmedQuery]);

  // `/` keyboard shortcut focuses the search input — but only when
  // the user is not already typing in another field.
  useEffect(() => {
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
  }, []);

  // Scroll the docs content container (NOT the window) to the given
  // anchor. Using el.scrollIntoView() would also scroll the page body
  // and the protected app shell, which pushes the content area out of
  // view — the user then sees a blank docs body until they manually
  // scroll inside the inner container. Computing scrollTop directly
  // keeps the scroll confined to contentRef.
  //
  // Section-level placeholder divs (line ~431) share the first
  // subsection's data-anchor for "click section header → jump to its
  // top" behavior. querySelectorAll returns them in DOM order, so the
  // SubsectionView (the one we actually want to anchor on) is the
  // LAST match — pick that.
  const SCROLL_MARGIN_PX = 24;
  const scrollContentTo = useCallback((anchor, behavior = 'smooth') => {
    const container = contentRef.current;
    if (!container) return false;
    const nodes = container.querySelectorAll(`[data-anchor="${anchor}"]`);
    if (!nodes.length) return false;
    const el = nodes[nodes.length - 1];
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      SCROLL_MARGIN_PX;
    container.scrollTo({ top: Math.max(0, top), behavior });
    return true;
  }, []);

  // Scroll-to-anchor on initial load and when the URL hash changes.
  // Task #2 (DD) — When a non-admin tries to deep-link to an admin
  // anchor (e.g. `#admin/users`), strip the hash so the page behaves
  // as if the anchor doesn't exist (the section is also absent from
  // the rail and content body, so this is a true 404-by-omission).
  useEffect(() => {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!hash) return;
    if (!isAdmin && restrictedAnchors.has(hash)) {
      navigate('/help', { replace: true });
      return;
    }
    requestAnimationFrame(() => {
      if (scrollContentTo(hash, 'auto')) setActiveAnchor(hash);
    });
  }, [location.hash, isAdmin, restrictedAnchors, navigate, scrollContentTo]);

  // Track which subsection is currently in view to highlight the rail.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const headings = el.querySelectorAll('[data-anchor]');
      let current = activeAnchor;
      for (const h of headings) {
        const top = h.getBoundingClientRect().top;
        if (top <= 140) current = h.getAttribute('data-anchor');
      }
      if (current && current !== activeAnchor) setActiveAnchor(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeAnchor]);

  const goToAnchor = useCallback((anchor) => {
    navigate(`#${anchor}`, { replace: false });
    requestAnimationFrame(() => scrollContentTo(anchor, 'smooth'));
    setActiveAnchor(anchor);
    setQuery('');
  }, [navigate, scrollContentTo]);

  // Activated section in the rail derives from the activeAnchor's section prefix.
  const activeSectionId = activeAnchor.split('/')[0];
  const activeSection = visibleSections.find(s => s.id === activeSectionId) || visibleSections[0];

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden -mx-6 -my-6">
      {/* Left rail */}
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto py-5 px-3 hidden lg:block dark:border-gray-800">
        <div className="px-2 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-violet-600" />
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Help Center</span>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guides… (press /)"
              aria-label="Search the Help Center contents"
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 placeholder:text-gray-400 dark:border-gray-800 dark:bg-gray-900"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {trimmedQuery ? (
          <div className="px-1">
            <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
            </div>
            <ul className="space-y-0.5">
              {searchResults.map(r => (
                <li key={r.anchor}>
                  <button
                    onClick={() => goToAnchor(r.anchor)}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-100 group"
                  >
                    <div className="text-xs font-medium text-gray-900 truncate dark:text-gray-100">
                      {highlight(r.subsectionTitle, trimmedQuery)}
                    </div>
                    <div className="text-[10px] text-gray-500 mb-0.5">{r.sectionTitle}</div>
                    <div className="text-[11px] text-gray-600 leading-snug line-clamp-2">
                      {highlight(snippet(r.text, trimmedQuery), trimmedQuery)}
                    </div>
                  </button>
                </li>
              ))}
              {searchResults.length === 0 && (
                <li className="px-2 py-3 text-xs text-gray-500">No matches. Try a different term.</li>
              )}
            </ul>
          </div>
        ) : (
          <nav aria-label="Help Center contents">
            {visibleSections.map(section => {
              const isActive = section.id === activeSectionId;
              return (
                <div key={section.id} className="mb-3">
                  <button
                    type="button"
                    onClick={() => goToAnchor(`${section.id}/${section.subsections[0].id}`)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs font-semibold uppercase tracking-wider transition-colors ${
                      isActive ? 'text-violet-700' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <SectionIcon name={section.icon} size={12} />
                    {section.title}
                  </button>
                  <ul className="space-y-0.5 mt-0.5">
                    {section.subsections.map(sub => {
                      const anchor = `${section.id}/${sub.id}`;
                      const active = anchor === activeAnchor;
                      return (
                        <li key={sub.id}>
                          <button
                            onClick={() => goToAnchor(anchor)}
                            className={`w-full text-left text-[12.5px] pl-7 pr-2 py-1 rounded-md transition-colors ${
                              active
                                ? 'bg-violet-100 text-violet-700 font-medium'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                            }`}
                          >
                            {sub.title}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
        )}
      </aside>

      {/* Main content */}
      <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto">
        {/* Mobile: collapsed top search bar (rail hidden on small screens). */}
        <div className="lg:hidden sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guides…"
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 dark:border-gray-800 dark:bg-gray-900"
            />
          </div>
          {trimmedQuery && searchResults.length > 0 && (
            <ul className="mt-2 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-sm dark:bg-gray-900 dark:border-gray-800">
              {searchResults.slice(0, 8).map(r => (
                <li key={r.anchor}>
                  <button
                    onClick={() => goToAnchor(r.anchor)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  >
                    <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{highlight(r.subsectionTitle, trimmedQuery)}</div>
                    <div className="text-[10px] text-gray-500">{r.sectionTitle}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Mobile: section/subsection picker */}
          <details className="mt-2">
            <summary className="text-[11px] text-gray-600 cursor-pointer select-none">Browse all sections</summary>
            <nav className="mt-2 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-md p-2 dark:bg-gray-900 dark:border-gray-800">
              {visibleSections.map(section => (
                <div key={section.id} className="mb-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1 mb-0.5">{section.title}</div>
                  <ul>
                    {section.subsections.map(sub => (
                      <li key={sub.id}>
                        <button
                          onClick={() => goToAnchor(`${section.id}/${sub.id}`)}
                          className="w-full text-left text-[12px] px-2 py-1 rounded hover:bg-gray-100"
                        >
                          {sub.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </details>
        </div>

        <div className="flex max-w-6xl mx-auto">
          <div className="max-w-3xl flex-1 min-w-0 px-6 py-8">
            {/* Breadcrumbs */}
            <nav aria-label="Breadcrumb" className="text-[11px] text-gray-500 mb-3 flex items-center gap-1.5">
              <span>Help</span>
              <ChevronRight size={11} />
              <span className="text-gray-700 font-medium dark:text-gray-300">{activeSection.title}</span>
            </nav>

            <HelpHero
              query={query}
              setQuery={setQuery}
              searchInputRef={searchInputRef}
              onSuggest={setQuery}
            />

            {/* A query replaces the browse surface with its answers. The
                corpus stays mounted below either way — every `#section/sub`
                anchor in the product resolves against this page, so hiding
                the sections on search would break deep links arriving with a
                `?q=` still set. It is collapsed, not unmounted. */}
            {trimmedQuery ? (
              <SearchResults results={searchResults} query={trimmedQuery} onPick={goToAnchor} />
            ) : (
              <BrowseByTask sections={visibleSections} onPick={goToAnchor} />
            )}

            <div className={trimmedQuery ? 'hidden' : ''}>
              {visibleSections.map(section => (
                <div key={section.id}>
                  <div
                    id={section.id}
                    data-anchor={`${section.id}/${section.subsections[0].id}`}
                    className="scroll-mt-20"
                  />
                  <div className="flex items-center gap-2 mt-2 mb-4 pb-2 border-b border-gray-200 dark:border-gray-800">
                    <SectionIcon name={section.icon} size={18} className="text-violet-600" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{section.title}</h2>
                  </div>
                  {section.subsections.map(sub => (
                    <SubsectionView key={sub.id} section={section} sub={sub} />
                  ))}
                </div>
              ))}
            </div>

            <StillStuck user={user} onOpenChat={() => setChatOpen(true)} />
          </div>

          {/* "On this page" right rail — auto-built from the active section's subsections. */}
          <aside className="hidden xl:block w-56 shrink-0 pl-4 pr-6 py-8 sticky top-0 self-start">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">On this page</div>
            <ul className="space-y-1 border-l border-gray-200 dark:border-gray-800">
              {activeSection.subsections.map(sub => {
                const anchor = `${activeSection.id}/${sub.id}`;
                const active = anchor === activeAnchor;
                return (
                  <li key={sub.id}>
                    <button
                      onClick={() => goToAnchor(anchor)}
                      className={`w-full text-left text-[11.5px] pl-3 pr-1 py-1 -ml-px border-l ${
                        active
                          ? 'border-violet-500 text-violet-700 font-medium'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {sub.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </div>

      {/* Task #103 — the panel CustomerChatWidget's docblock has been waiting
          for. It renders null while closed and only polls while open, so an
          ineligible viewer (who never gets the button) pays nothing for it. */}
      <CustomerChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

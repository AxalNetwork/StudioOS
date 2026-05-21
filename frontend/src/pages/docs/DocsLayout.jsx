import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, Search, ChevronRight, X, AlertTriangle,
  Compass, Rocket, Hammer, TrendingUp, DollarSign, Scale,
  Network, LayoutDashboard, UserCircle, LifeBuoy, FileText, History,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SECTIONS, filterSectionsForRole, adminOnlyAnchors } from './sections';
import { createDocsFuse, splitForHighlight, snippet } from '../../lib/docs/search';
import { useAuth } from '../../hooks/useAuthSync';

// Wrap the pure-JS split helper into a JSX-friendly highlighter. Kept
// inside the layout so the search module stays JSX-free.
function highlight(text, q) {
  return splitForHighlight(text, q).map((part, i) =>
    part.match ? (
      <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">{part.text}</mark>
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
    <div className="prose prose-sm max-w-none text-sm text-gray-700 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-gray-900 [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-gray-900 [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:leading-relaxed [&_li]:mb-1 [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_blockquote]:border-l-2 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_a]:text-violet-700 [&_a]:underline">
      <ReactMarkdown>{state.text}</ReactMarkdown>
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
      <h3 className="text-lg font-semibold text-gray-900 mb-3">{sub.title}</h3>
      {sub.overview && (
        <p className="text-sm text-gray-700 leading-relaxed mb-4">{sub.overview}</p>
      )}

      {sub.markdownUrl && (
        <div className="mb-4">
          <MarkdownBody url={sub.markdownUrl} />
        </div>
      )}

      {Array.isArray(sub.howto) && sub.howto.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">How to use it</h4>
          <ol className="list-decimal list-outside pl-5 text-sm text-gray-700 space-y-1.5">
            {sub.howto.map((step, i) => <li key={i} className="leading-relaxed">{step}</li>)}
          </ol>
        </div>
      )}

      {Array.isArray(sub.tips) && sub.tips.length > 0 && (
        <div className="mb-4 bg-violet-50 border border-violet-100 rounded-lg p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-700 mb-2">Tips</h4>
          <ul className="list-disc list-outside pl-5 text-sm text-gray-700 space-y-1">
            {sub.tips.map((tip, i) => <li key={i} className="leading-relaxed">{tip}</li>)}
          </ul>
        </div>
      )}

      {Array.isArray(sub.pitfalls) && sub.pitfalls.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800 mb-2">
            <AlertTriangle size={12} /> Common pitfalls
          </h4>
          <ul className="list-disc list-outside pl-5 text-sm text-gray-700 space-y-1">
            {sub.pitfalls.map((p, i) => <li key={i} className="leading-relaxed">{p}</li>)}
          </ul>
        </div>
      )}

      {sub.screenshot && (
        <figure className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
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
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-gray-200 text-violet-700 hover:bg-violet-50 hover:border-violet-200"
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

export default function DocsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);
  const [query, setQuery] = useState('');
  const { role } = useAuth() || {};

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

  // Scroll-to-anchor on initial load and when the URL hash changes.
  // Task #2 (DD) — When a non-admin tries to deep-link to an admin
  // anchor (e.g. `#admin/users`), strip the hash so the page behaves
  // as if the anchor doesn't exist (the section is also absent from
  // the rail and content body, so this is a true 404-by-omission).
  useEffect(() => {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!hash) return;
    if (!isAdmin && restrictedAnchors.has(hash)) {
      navigate('/docs', { replace: true });
      return;
    }
    const el = document.querySelector(`[data-anchor="${hash}"]`);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'auto', block: 'start' }));
      setActiveAnchor(hash);
    }
  }, [location.hash, isAdmin, restrictedAnchors, navigate]);

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
    const el = document.querySelector(`[data-anchor="${anchor}"]`);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    setActiveAnchor(anchor);
    setQuery('');
  }, [navigate]);

  // Activated section in the rail derives from the activeAnchor's section prefix.
  const activeSectionId = activeAnchor.split('/')[0];
  const activeSection = visibleSections.find(s => s.id === activeSectionId) || visibleSections[0];

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden -mx-6 -my-6">
      {/* Left rail */}
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto py-5 px-3 hidden lg:block">
        <div className="px-2 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-violet-600" />
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Documentation</span>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search docs… (press /)"
              aria-label="Search documentation"
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 placeholder:text-gray-400"
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
                    <div className="text-xs font-medium text-gray-900 truncate">
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
          <nav aria-label="Documentation contents">
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
        <div className="lg:hidden sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search docs…"
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
            />
          </div>
          {trimmedQuery && searchResults.length > 0 && (
            <ul className="mt-2 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-sm">
              {searchResults.slice(0, 8).map(r => (
                <li key={r.anchor}>
                  <button
                    onClick={() => goToAnchor(r.anchor)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  >
                    <div className="text-xs font-medium text-gray-900">{highlight(r.subsectionTitle, trimmedQuery)}</div>
                    <div className="text-[10px] text-gray-500">{r.sectionTitle}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Mobile: section/subsection picker */}
          <details className="mt-2">
            <summary className="text-[11px] text-gray-600 cursor-pointer select-none">Browse all sections</summary>
            <nav className="mt-2 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-md p-2">
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
              <span>Documentation</span>
              <ChevronRight size={11} />
              <span className="text-gray-700 font-medium">{activeSection.title}</span>
            </nav>

            <header className="mb-8">
              <div className="flex items-center gap-2 text-violet-600 text-xs font-semibold uppercase tracking-widest mb-2">
                <BookOpen size={14} /> Documentation
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">StudioOS Documentation</h1>
              <p className="text-sm text-gray-500">
                Guides for founders, investors, partners, and mentors using the StudioOS platform.
              </p>
            </header>

            {visibleSections.map(section => (
              <div key={section.id}>
                <div
                  id={section.id}
                  data-anchor={`${section.id}/${section.subsections[0].id}`}
                  className="scroll-mt-20"
                />
                <div className="flex items-center gap-2 mt-2 mb-4 pb-2 border-b border-gray-200">
                  <SectionIcon name={section.icon} size={18} className="text-violet-600" />
                  <h2 className="text-2xl font-bold text-gray-900">{section.title}</h2>
                </div>
                {section.subsections.map(sub => (
                  <SubsectionView key={sub.id} section={section} sub={sub} />
                ))}
              </div>
            ))}

            <footer className="mt-16 pt-6 border-t border-gray-200 text-xs text-gray-500">
              Need help? Open a ticket from the Tickets page in the sidebar, or email <a className="text-violet-700 hover:underline" href="mailto:support@axal.vc">support@axal.vc</a>.
            </footer>
          </div>

          {/* "On this page" right rail — auto-built from the active section's subsections. */}
          <aside className="hidden xl:block w-56 shrink-0 pl-4 pr-6 py-8 sticky top-0 self-start">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">On this page</div>
            <ul className="space-y-1 border-l border-gray-200">
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
    </div>
  );
}

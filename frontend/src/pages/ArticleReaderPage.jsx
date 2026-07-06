import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText, Mail, ChevronRight, Pencil } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';
import { useAuth } from '../hooks/useAuthSync';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import AuthorCard from '../components/AuthorCard';

// ── Brand glyphs ──────────────────────────────────────────────────
function XIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function LinkedinIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
function FacebookIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.884v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────
function useReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const scrollHeight = doc.scrollHeight - doc.clientHeight;
      const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, pct)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return progress;
}

function useTOC(bodyRef, html) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    if (!bodyRef.current) return;
    const headings = Array.from(bodyRef.current.querySelectorAll('h2, h3'));
    const slugify = (text) =>
      text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 60) || 'section';
    const used = new Map();
    const uniq = (base) => {
      const n = used.get(base) || 0;
      used.set(base, n + 1);
      return n === 0 ? base : `${base}-${n + 1}`;
    };
    const list = headings.map((h) => {
      const id = uniq(h.id || slugify(h.textContent || ''));
      h.id = id;
      return { id, text: h.textContent || '', level: h.tagName === 'H2' ? 2 : 3 };
    });
    setItems(list);
  }, [bodyRef, html]);

  useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    items.forEach((it) => {
      const el = document.getElementById(it.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  return { items, activeId };
}

// ── Share bar ───────────────────────────────────────────────────────
function ShareBar({ title, compact = false }) {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title || 'Axal VC article');
  const targets = [
    { key: 'x', label: 'Share on X', Icon: XIcon, href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'linkedin', label: 'Share on LinkedIn', Icon: LinkedinIcon, href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: 'facebook', label: 'Share on Facebook', Icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'email', label: 'Share by email', Icon: Mail, href: `mailto:?subject=${t}&body=${t}%0A%0A${u}` },
  ];
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : ''}`}>
      {!compact && (
        <span className="text-xs text-slate-500 dark:text-slate-400 mr-1 hidden sm:inline">Share</span>
      )}
      {targets.map(({ key, label, Icon, href }) => (
        <a
          key={key}
          href={href}
          target={key === 'email' ? undefined : '_blank'}
          rel={key === 'email' ? undefined : 'noopener noreferrer'}
          aria-label={label}
          title={label}
          className={`rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-violet-700 dark:hover:text-violet-300 hover:border-violet-400 dark:hover:border-violet-600 transition ${compact ? 'p-1.5' : 'p-2'}`}
        >
          <Icon className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
        </a>
      ))}
    </div>
  );
}

// ── Recommended card ──────────────────────────────────────────────
function RecommendedCard({ a }) {
  return (
    <Link
      to={`/articles/${a.slug}`}
      className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition flex flex-col hover:border-violet-400 dark:hover:border-violet-600"
    >
      {a.cover_url ? (
        <img
          src={a.cover_url}
          alt=""
          className="w-full aspect-[16/9] object-cover bg-slate-100 dark:bg-slate-800"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <div className="w-full aspect-[16/9] bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600" />
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          {a.sector && <span>{a.sector.replace(/_/g, ' ')}</span>}
          {a.sector && a.read_minutes ? <span>·</span> : null}
          {a.read_minutes ? <span>{a.read_minutes} min read</span> : null}
        </div>
        <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-violet-300 line-clamp-2">
          {a.title}
        </h3>
        {a.subtitle && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{a.subtitle}</p>
        )}
      </div>
    </Link>
  );
}

// ── TOC components ────────────────────────────────────────────────
function scrollToHeading(e, id) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (window.history?.replaceState) window.history.replaceState(null, '', `#${id}`);
}

function TOCDesktop({ items, activeId }) {
  if (items.length < 2) return null;
  return (
    <aside className="hidden xl:block">
      <nav className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto" aria-label="Table of contents">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Contents
        </h2>
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => scrollToHeading(e, it.id)}
                className={`block text-sm leading-snug rounded px-2 py-1 transition ${
                  it.level === 3 ? 'pl-4 text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300'
                } ${activeId === it.id ? 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 font-medium' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                aria-current={activeId === it.id ? 'true' : undefined}
              >
                {it.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function TOCMobile({ items }) {
  if (items.length < 2) return null;
  return (
    <details className="xl:hidden mb-8 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-900/50">
      <summary className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">
        <ChevronRight className="w-4 h-4 details-chevron" />
        Table of contents
      </summary>
      <nav aria-label="Table of contents">
        <ul className="px-4 pb-3 space-y-1">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => scrollToHeading(e, it.id)}
                className={`block text-sm py-1 ${it.level === 3 ? 'pl-3 text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                {it.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function ArticleReaderPage() {
  const { slug } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState([]);
  const bodyRef = useRef(null);
  const progress = useReadingProgress();
  const { items, activeId } = useTOC(bodyRef, a?.body_html);
  const { user } = useAuth();
  const canEdit = !!(user && a && (user.id === a.author_user_id || user.role === 'admin'));

  useEffect(() => {
    setLoading(true); setErr(null); setRecs([]);
    api.read(slug)
      .then(setA)
      .catch((e) => {
        if (e?.status === 404) setErr('Article not found');
        else { reportError('ArticleReader:read', e); setErr('Failed to load article'); }
      })
      .finally(() => setLoading(false));
  }, [slug]);

  // Task #4 — reader SEO surfacing
  useEffect(() => {
    if (!a) return;
    const title = a.seo_title || a.title || 'Axal VC article';
    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', a.excerpt || a.subtitle || '');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', a.canonical_url || window.location.href);
    return () => {
      document.title = 'Axal VC Studio';
      if (metaDesc) metaDesc.setAttribute('content', '');
    };
  }, [a]);

  useEffect(() => {
    if (!a) return;
    let cancelled = false;
    (async () => {
      try {
        const seen = new Set([a.slug]);
        const out = [];
        const push = (items) => {
          for (const it of (items || [])) {
            if (out.length >= 3) break;
            if (seen.has(it.slug)) continue;
            seen.add(it.slug);
            out.push(it);
          }
        };
        if (a.sector) {
          const r = await api.list({ sector: a.sector, limit: 6 });
          push(r.items);
        }
        if (out.length < 3) {
          const r2 = await api.list({ limit: 8 });
          push(r2.items);
        }
        if (!cancelled) setRecs(out);
      } catch (e) {
        reportError('ArticleReader:recs', e);
      }
    })();
    return () => { cancelled = true; };
  }, [a]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Reading progress bar */}
      <div
        className="fixed top-0 left-0 h-[2px] bg-violet-600 z-[60] transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
        aria-hidden="true"
      />

      <PublicNav />

      {/* Breadcrumb bar */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur pt-16">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <Link to="/articles" className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-violet-700 transition">
            <ArrowLeft className="w-4 h-4" /> All articles
          </Link>
        </div>
      </div>

      <main className="flex-1 w-full">
        {loading && (
          <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" /> Loading…
          </div>
        )}
        {err && (
          <div className="text-center py-20">
            <FileText className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-600 dark:text-slate-400">{err}</p>
            <Link to="/articles" className="mt-4 inline-block text-violet-600 hover:underline">Back to articles</Link>
          </div>
        )}
        {a && (
          <div className="max-w-7xl mx-auto px-6 py-10 xl:py-14">
            {/* Two-column layout: reading column + sticky TOC */}
            <div className="xl:grid xl:grid-cols-[1fr_240px] xl:gap-16">
              {/* Reading column */}
              <div className="max-w-[68ch] mx-auto xl:mx-0">
                <article>
                  {/* Hero */}
                  <header className="mb-10">
                    {/* Category badge */}
                    {a.sector && (
                      <div className="mb-4">
                        <span className="inline-block text-[11px] uppercase tracking-[0.15em] font-semibold text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 px-2.5 py-1 rounded">
                          {a.sector.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )}
                    {/* Title */}
                    <h1 className="text-[clamp(2rem,5vw,3.25rem)] font-bold leading-[1.1] tracking-tight text-slate-900 dark:text-slate-50">
                      {a.title}
                    </h1>
                    {/* Subtitle / deck */}
                    {a.subtitle && (
                      <p className="mt-4 text-xl text-slate-500 dark:text-slate-400 leading-relaxed font-light">
                        {a.subtitle}
                      </p>
                    )}
                    {/* Metadata row */}
                    <div className="mt-6 space-y-2">
                      {a.author && (
                        <AuthorCard
                          compact
                          author={{
                            name: a.author,
                            headline: a.author_headline || null,
                            headshot_url: a.author_photo_url || null,
                            role: a.author_role || null,
                            socials: {},
                          }}
                          userId={a.author_user_id}
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                        {a.published_at && (
                          <time dateTime={a.published_at}>
                            {new Date(a.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                          </time>
                        )}
                        {a.read_minutes && (
                          <>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            <span>{a.read_minutes} min read</span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Top share bar + Edit button */}
                    <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 justify-between">
                      <ShareBar title={a.title} compact />
                      {canEdit && (
                        <Link
                          to={`/articles/edit/${a.id}`}
                          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Link>
                      )}
                    </div>
                  </header>

                  {/* Cover image */}
                  {a.cover_url && (
                    <figure className="my-8">
                      <img
                        src={a.cover_url}
                        alt={a.title}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-800 object-cover max-h-[28rem]"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </figure>
                  )}

                  {/* Mobile TOC */}
                  <TOCMobile items={items} />

                  {/* Body */}
                  <div
                    ref={bodyRef}
                    className="article-prose"
                    dangerouslySetInnerHTML={{ __html: a.body_html || '' }}
                  />

                  {/* Tags */}
                  {(a.tags || []).length > 0 && (
                    <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
                      {a.tags.map((t) => (
                        <span key={t} className="text-xs px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Bottom share bar */}
                  <div className="mt-10 pt-8 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Enjoyed this? Pass it on.</span>
                    <ShareBar title={a.title} />
                  </div>
                </article>

                {/* Recommended reading */}
                {recs.length > 0 && (
                  <section className="mt-16 pt-10 border-t border-slate-200 dark:border-slate-800">
                    <h2 className="text-lg font-semibold mb-6 text-slate-900 dark:text-slate-100">Recommended reading</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      {recs.map((r) => <RecommendedCard key={r.id} a={r} />)}
                    </div>
                  </section>
                )}
              </div>

              {/* Desktop sticky TOC */}
              <TOCDesktop items={items} activeId={activeId} />
            </div>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

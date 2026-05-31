import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText, Linkedin, Twitter, Facebook, Mail } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';

// Task #9 — Public article reader. Reads like a real publication: shared
// public header/footer, a linked author byline, social sharing, and a
// recommended-reading strip. HTML body comes pre-sanitised by the worker via
// renderMarkdown (DOMPurify-equivalent server-side).

function ShareBar({ title }) {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title || 'Axal article');
  const targets = [
    { key: 'x', label: 'Share on X', Icon: Twitter, href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'linkedin', label: 'Share on LinkedIn', Icon: Linkedin, href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: 'facebook', label: 'Share on Facebook', Icon: Facebook, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'email', label: 'Share by email', Icon: Mail, href: `mailto:?subject=${t}&body=${t}%0A%0A${u}` },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Share</span>
      {targets.map(({ key, label, Icon, href }) => (
        <a
          key={key}
          href={href}
          target={key === 'email' ? undefined : '_blank'}
          rel={key === 'email' ? undefined : 'noopener noreferrer'}
          aria-label={label}
          title={label}
          className="p-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-violet-700 dark:hover:text-violet-300 hover:border-violet-400 dark:hover:border-violet-600 transition"
        >
          <Icon className="w-4 h-4" />
        </a>
      ))}
    </div>
  );
}

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
        <div className="w-full aspect-[16/9] bg-gradient-to-br from-violet-100 to-violet-50 dark:from-violet-900/30 dark:to-slate-800 flex items-center justify-center">
          <FileText className="w-8 h-8 text-violet-400" />
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

export default function ArticleReaderPage() {
  const { slug } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState([]);

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

  // Recommended reading: prefer same-sector articles, then fall back to the
  // most recent, always excluding the one currently open.
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
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <Link to="/articles" className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-violet-700">
            <ArrowLeft className="w-4 h-4" /> All articles
          </Link>
        </div>
      </div>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
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
          <article>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 flex flex-wrap items-center gap-2">
              {a.sector && <span>{a.sector.replace(/_/g, ' ')}</span>}
              {a.read_minutes ? <><span>·</span><span>{a.read_minutes} min read</span></> : null}
              {a.published_at && <><span>·</span><span>{new Date(a.published_at).toLocaleDateString()}</span></>}
            </div>
            <h1 className="text-4xl font-bold leading-tight">{a.title}</h1>
            {a.subtitle && (
              <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">{a.subtitle}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <span>by</span>
                {a.author_website ? (
                  <a
                    href={a.author_website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    {a.author || '—'}
                  </a>
                ) : (
                  <span className="font-medium text-slate-800 dark:text-slate-200">{a.author || '—'}</span>
                )}
                {a.author_role && <span className="px-1.5 py-0.5 text-xs rounded bg-slate-100 dark:bg-slate-800">{a.author_role}</span>}
              </div>
              <ShareBar title={a.title} />
            </div>
            {a.cover_url && (
              <img
                src={a.cover_url}
                alt=""
                className="mt-6 w-full max-h-96 object-cover rounded-lg border border-slate-200 dark:border-slate-800"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <div
              className="prose dark:prose-invert max-w-none mt-8"
              // body_html is sanitised server-side by services/newsRender.ts.
              dangerouslySetInnerHTML={{ __html: a.body_html || '' }}
            />
            {(a.tags || []).length > 0 && (
              <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
                {a.tags.map((t) => (
                  <span key={t} className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">#{t}</span>
                ))}
              </div>
            )}

            <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <span className="text-sm text-slate-500 dark:text-slate-400">Enjoyed this? Pass it on.</span>
              <ShareBar title={a.title} />
            </div>

            {recs.length > 0 && (
              <section className="mt-12">
                <h2 className="text-lg font-semibold mb-4">Recommended reading</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  {recs.map((r) => <RecommendedCard key={r.id} a={r} />)}
                </div>
              </section>
            )}
          </article>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

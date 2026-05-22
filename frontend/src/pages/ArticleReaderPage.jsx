import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';

// Task #1 — Public article reader. HTML body comes pre-sanitised by the
// worker via renderMarkdown (DOMPurify-equivalent server-side).

export default function ArticleReaderPage() {
  const { slug } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setErr(null);
    api.read(slug)
      .then(setA)
      .catch((e) => {
        if (e?.status === 404) setErr('Article not found');
        else { reportError('ArticleReader:read', e); setErr('Failed to load article'); }
      })
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/articles" className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-violet-700">
            <ArrowLeft className="w-4 h-4" /> All articles
          </Link>
          <Link to="/articles/draft" className="text-xs text-violet-600 hover:underline">Write an article</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
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
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <span>by</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{a.author || '—'}</span>
              {a.author_role && <span className="px-1.5 py-0.5 text-xs rounded bg-slate-100 dark:bg-slate-800">{a.author_role}</span>}
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
          </article>
        )}
      </main>
    </div>
  );
}

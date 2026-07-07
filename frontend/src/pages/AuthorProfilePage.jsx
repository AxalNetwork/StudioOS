import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import AuthorCard from '../components/AuthorCard';

function ArticleCard({ a }) {
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
        {a.published_at && (
          <p className="mt-auto pt-3 text-xs text-slate-400 dark:text-slate-500">
            {new Date(a.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function AuthorProfilePage() {
  const { userId } = useParams();
  const [author, setAuthor] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      setErr('Invalid author ID');
      setLoading(false);
      return;
    }
    api.authorProfile(id)
      .then((r) => {
        setAuthor(r.author || null);
        setItems(r.items || []);
      })
      .catch((e) => {
        reportError('AuthorProfile:authorProfile', e);
        setErr('Failed to load author profile');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <PublicNav />
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
        {!loading && !err && (
          <div className="max-w-7xl mx-auto px-6 py-10 xl:py-14">
            {author ? (
              <div className="mb-12 pb-10 border-b border-slate-200 dark:border-slate-800">
                <AuthorCard author={author} userId={Number(userId)} />
              </div>
            ) : (
              <div className="mb-10 text-slate-500 dark:text-slate-400 text-sm">Author profile unavailable.</div>
            )}
            {items.length > 0 ? (
              <section>
                <h2 className="text-lg font-semibold mb-6 text-slate-900 dark:text-slate-100">
                  Published articles
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {items.map((a) => (
                    <ArticleCard key={a.id} a={a} />
                  ))}
                </div>
              </section>
            ) : (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p>No published articles yet.</p>
              </div>
            )}
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

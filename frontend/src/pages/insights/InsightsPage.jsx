import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FileText, ArrowRight } from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import { publications } from '../../lib/api';
import { reportError } from '../../lib/log';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function sectionLabel(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function InsightsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    publications.publicList()
      .then((data) => {
        if (cancelled) return;
        setItems(Array.isArray(data?.publications) ? data.publications : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('insights_index_fetch_failed', err);
        setError('We could not load insights right now. Please try again later.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <h1 className="text-3xl font-bold">Insights</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Market intelligence and venture briefs from the Axal VC network.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-12">
          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
              <FileText className="w-10 h-10 mx-auto text-violet-400 mb-3" />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No published insights yet — check back soon.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {items.map((p) => (
                <Link
                  key={p.slug}
                  to={`/insights/public/${p.slug}`}
                  className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col hover:border-violet-400 dark:hover:border-violet-600 transition"
                >
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                    {p.section && <span>{sectionLabel(p.section)}</span>}
                    {p.section && p.published_at ? <span>·</span> : null}
                    {p.published_at && <span>{formatDate(p.published_at)}</span>}
                  </div>
                  <h2 className="font-semibold text-lg text-slate-900 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-violet-300 line-clamp-2">
                    {p.title}
                  </h2>
                  {p.subtitle && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 line-clamp-3 flex-1">
                      {p.subtitle}
                    </p>
                  )}
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-700 dark:text-violet-300">
                    Read brief <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

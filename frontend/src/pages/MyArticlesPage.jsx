import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, Eye, ArrowUpRight, Pencil } from 'lucide-react';
import { articles as api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
};
const STATUS_BADGE = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  in_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  changes_requested: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  published: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export default function MyArticlesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.mine()
      .then((r) => setItems(r.items || []))
      .catch((e) => { reportError('MyArticles:mine', e); setItems([]); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pt-16">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="w-7 h-7 text-violet-600" /> My Articles
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Everything you&apos;ve written — drafts, submissions, and published pieces.
          </p>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading && (
          <div className="flex items-center gap-2 text-slate-500 py-12">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-center py-20 text-slate-500 dark:text-slate-400">
            <FileText className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
            <p className="text-lg">No articles yet.</p>
            <Link to="/articles/draft" className="mt-4 inline-block text-violet-600 hover:underline">
              Write your first article →
            </Link>
          </div>
        )}
        <div className="space-y-3">
          {items.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[a.status] || STATUS_BADGE.draft}`}>
                    {STATUS_LABEL[a.status] || a.status}
                  </span>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {a.title}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                  <span>Updated {new Date(a.updated_at).toLocaleDateString()}</span>
                  {a.published_at && (
                    <>
                      <span>·</span>
                      <span>Published {new Date(a.published_at).toLocaleDateString()}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{a.word_count} words</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Eye className="w-3 h-3" /> {a.views ?? 0} views
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {a.status === 'published' && (
                  <a
                    href={`https://axal.vc/articles/${a.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" /> View live
                  </a>
                )}
                <Link
                  to={`/articles/edit/${a.id}`}
                  className="text-sm inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

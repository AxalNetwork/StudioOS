/**
 * Task #4 (ID) — Public /changelog page.
 *
 * Pulls from `GET /api/public/changelog` which proxies GitHub Releases
 * filtered to the `public-changelog` tag. Each release maps to one entry.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, ExternalLink } from 'lucide-react';
import { request } from '../lib/api';
import { pageReadFailure } from '../lib/pageReadFailure';
import { usePageMeta } from '../lib/seo';

const AUDIENCE_COLOR = {
  founder:  'bg-blue-100 text-blue-700',
  investor: 'bg-purple-100 text-purple-700',
  partner:  'bg-emerald-100 text-emerald-700',
  advisor:   'bg-amber-100 text-amber-700',
  all:      'bg-gray-100 text-gray-700',
};

function AudienceBadge({ tag }) {
  const cls = AUDIENCE_COLOR[tag] || AUDIENCE_COLOR.all;
  const label = tag.charAt(0).toUpperCase() + tag.slice(1);
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}

export default function ChangelogPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  usePageMeta({
    title: 'Changelog',
    description: 'What\'s new in Axal VC StudioOS — every shipped change, tagged by audience.',
    path: '/changelog',
  });

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    (async () => {
      try {
        const res = await request('/public/changelog');
        if (alive) setEntries(res.entries || []);
      } catch (ex) {
        if (alive) setError(pageReadFailure(ex, { unreadable: 'The release notes could not be read, which is not a claim that there are none.' }));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [attempt]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8 min-h-[44px]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Axal VC
        </Link>

        <header className="mb-10">
          <h1 className="text-4xl font-bold text-gray-900 mb-2 dark:text-gray-100">Changelog</h1>
          <p className="text-gray-600">Every shipped change to Axal VC StudioOS — tagged by who it's for.</p>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" size={18} /> Loading…</div>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4">
            <p>{error.message}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-3 inline-flex rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">Try again</button>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-600 dark:border-gray-800" data-card>
            No public release notes yet — check back soon.
          </div>
        )}

        <ol className="space-y-8 relative border-l-2 border-gray-100 pl-6">
          {entries.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[31px] top-2 w-3 h-3 rounded-full bg-violet-600 ring-4 ring-white" aria-hidden="true" />
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <time dateTime={e.published_at}>{new Date(e.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
                <span aria-hidden="true">·</span>
                <AudienceBadge tag={e.audience || 'all'} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">{e.title}</h2>
              {e.image && (
                <img src={e.image} alt="" className="rounded-xl border border-gray-200 mb-3 max-h-72 object-cover dark:border-gray-800" loading="lazy" />
              )}
              <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-line dark:text-gray-300">{e.summary}</div>
              {e.url && (
                <a href={e.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-sm text-violet-600 hover:text-violet-700">
                  Read release details <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

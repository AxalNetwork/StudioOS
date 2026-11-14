import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { publications } from '../../lib/api';
import { usePageMeta } from '../../lib/seo';

/**
 * D1439 (#3914): the tab's tags through `usePageMeta`, the same `ogTagsFor` the
 * Worker's record card for `/insights/public/<slug>` uses, so the tab and a
 * link preview agree. Mounted once the publication has loaded, so the hook's
 * one pageview beacon fires once, for the loaded page.
 */
function InsightMeta({ publication }) {
  const og = publication.og || {};
  usePageMeta({ title: publication.title, description: og.description || publication.subtitle || undefined, type: 'article' });
  return null;
}

export default function PublicInsight() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await publications.publicGet(slug);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Not found');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (err) return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">Report unavailable</h1>
      <p className="text-gray-500">{err}</p>
    </div>
  );
  if (!data) return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin inline" /> Loading…
    </div>
  );

  const p = data.publication;
  const bullets = (p.summary_text || '').split('\n').map(s => s.trim()).filter(s => s.startsWith('-'));
  const audienceColors = {
    internal: 'bg-gray-200 text-gray-700',
    lp: 'bg-violet-100 text-violet-700',
    founder: 'bg-emerald-100 text-emerald-700',
    media: 'bg-amber-100 text-amber-700',
    partners: 'bg-sky-100 text-sky-700',
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <InsightMeta publication={p} />
      {/* Header */}
      <header className="border-t-4 border-violet-600 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="text-violet-700 font-bold tracking-widest text-sm">AXAL · VC</div>
          <span className={`inline-block mt-2 text-xs px-3 py-0.5 rounded-full uppercase font-semibold ${audienceColors[p.audience] || 'bg-gray-100 text-gray-700'}`}>
            {p.audience}
          </span>
          <h1 className="text-4xl font-bold mt-4 leading-tight text-gray-900 dark:text-gray-100">{p.title}</h1>
          {p.subtitle && <p className="text-lg text-gray-600 mt-2">{p.subtitle}</p>}
          <div className="text-xs text-gray-500 mt-6">
            Section: <strong className="text-gray-700 dark:text-gray-300">{p.section}</strong> · Period: {data.period_label}
            {p.published_at && <> · Published {p.published_at}</>}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        <section>
          <h2 className="text-violet-700 text-sm uppercase tracking-wide font-semibold border-b border-violet-100 pb-1 mb-3">
            Headline summary
          </h2>
          {bullets.length > 0 ? (
            <ul className="space-y-2 text-gray-800 dark:text-gray-200">
              {bullets.map((b, i) => (
                <li key={i} className="leading-relaxed">{b.replace(/^-\s*/, '')}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-600 whitespace-pre-wrap">{p.summary_text}</p>
          )}
        </section>

        <section>
          <h2 className="text-violet-700 text-sm uppercase tracking-wide font-semibold border-b border-violet-100 pb-1 mb-3">
            Aggregate cells
          </h2>
          <div className="text-xs text-gray-500 mb-2">
            {data.aggregates.length} cells, k-anonymity floor n≥{data.k_min}.
          </div>
          {data.aggregates.length === 0 ? (
            <p className="text-sm text-gray-500">No publishable cells in window.</p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Dimension</th>
                    <th className="text-left px-3 py-2">Period</th>
                    <th className="text-right px-3 py-2">n</th>
                    <th className="text-right px-3 py-2">value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.aggregates.slice(0, 60).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">{r.dimension_key}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.period_key}</td>
                      <td className="px-3 py-1.5 text-right">{r.n}</td>
                      <td className="px-3 py-1.5 text-right">{r.value === null ? '—' : Number(r.value).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="text-xs text-gray-500">
          <h2 className="text-violet-700 text-sm uppercase tracking-wide font-semibold border-b border-violet-100 pb-1 mb-3">
            Methodology
          </h2>
          <p className="leading-relaxed">
            Aggregates are computed by Axal VC's market-intelligence reconciliation
            from anonymised, persona-tagged contributions. Cells with fewer than{' '}
            {data.k_min} distinct contributors are suppressed. The headline summary is drafted by an
            AI editor from numeric aggregates only and reviewed by an Axal VC admin before publication.
          </p>
        </section>
      </main>

      <footer className="border-t mt-10 py-6 text-center text-xs text-gray-400">
        © Axal VC Venture Studio · Confidential · {p.audience} distribution
      </footer>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import { publications } from '../../lib/api';
import { useToast } from '../../components/useToast';

const AUDIENCE_BADGE = {
  internal: 'bg-gray-200 text-gray-700',
  lp: 'bg-violet-100 text-violet-700',
  founder: 'bg-emerald-100 text-emerald-700',
  media: 'bg-amber-100 text-amber-700',
  partners: 'bg-sky-100 text-sky-700',
};

export default function AdminPublications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await publications.list(filter || undefined);
      setItems(res.publications || []);
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Failed to load publications' });
    } finally { setLoading(false); }
  }, [filter, showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 dark:text-gray-100">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-violet-600" />
            Publications
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Compose Axal VC branded reports from Market Intelligence sections.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <button onClick={load} className="p-2 rounded-lg border hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            to="/admin/publications/new"
            className="bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> New
          </Link>
        </div>
      </header>

      <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg overflow-hidden" data-card>
        {loading ? (
          <div className="p-8 text-center text-gray-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No publications yet. <Link to="/admin/publications/new" className="text-violet-600 hover:underline">Create one</Link>.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Title</th>
                <th className="text-left px-4 py-2">Section</th>
                <th className="text-left px-4 py-2">Audience</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Created</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t dark:border-gray-800">
                  <td className="px-4 py-2 font-medium">
                    <Link to={`/admin/publications/${p.id}`} className="hover:text-violet-600">{p.title}</Link>
                    {p.subtitle && <div className="text-xs text-gray-500">{p.subtitle}</div>}
                  </td>
                  <td className="px-4 py-2 text-xs"><code className="text-violet-600">{p.section}</code></td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${AUDIENCE_BADGE[p.audience] || 'bg-gray-100 text-gray-600'}`}>{p.audience}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{(p.created_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-2 text-right">
                    {p.status === 'published' && (
                      <a
                        href={`/insights/public/${p.slug}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline"
                      >
                        Public <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Save, FileDown, Image as ImageIcon, Table2, Send, ExternalLink, Loader2 } from 'lucide-react';
import { publications } from '../../lib/api';
import { useToast } from '../../components/useToast';

export default function PublicationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { showToast } = useToast();
  const toast = (msg, kind = 'info') => showToast({ kind, msg });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [lastRender, setLastRender] = useState(null);
  // Persisted last-render (from admin_audit_log) — survives reloads.
  const persistedLast = data?.last_render || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await publications.get(id);
      setData(res);
      setSummary(res.publication.summary_text || '');
      setTitle(res.publication.title || '');
      setSubtitle(res.publication.subtitle || '');
    } catch (e) {
      toast(e.message || 'Failed to load', 'error');
    } finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await publications.update(id, { title, subtitle, summary_text: summary });
      setData((d) => ({ ...d, publication: res.publication }));
      toast('Saved', 'success');
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally { setSaving(false); }
  };

  const render = async (format) => {
    setRendering(format);
    try {
      // The api lib triggers the browser download via blob and returns
      // metadata (filename, optional 24h shareable HMAC link).
      const res = await publications.render(id, format);
      setLastRender(res);
      toast(`Downloaded ${res.filename}`, 'success');
    } catch (e) {
      toast(e.message || 'Render failed', 'error');
    } finally { setRendering(null); }
  };

  const copyShareLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied (valid 24h)', 'success');
    } catch {
      toast('Could not copy link', 'error');
    }
  };

  const publish = async () => {
    if (!confirm('Publish this report? It will be readable at /insights/public/<slug> with no auth.')) return;
    setPublishing(true);
    try {
      const res = await publications.publish(id);
      setData((d) => ({ ...d, publication: res.publication }));
      toast('Published', 'success');
    } catch (e) {
      toast(e.message || 'Publish failed', 'error');
    } finally { setPublishing(false); }
  };

  if (loading) return (
    <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin inline" /> Loading…
    </div>
  );
  if (!data) return null;
  const p = data.publication;
  const published = p.status === 'published';

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 dark:text-gray-100">
      <button onClick={() => nav('/admin/publications')} className="text-sm text-gray-500 hover:text-violet-600 flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <header className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">{p.section} · {p.audience}</div>
          <h1 className="text-2xl font-bold mt-1">{p.title}</h1>
          {p.subtitle && <p className="text-sm text-gray-500 mt-1">{p.subtitle}</p>}
          <div className="text-xs text-gray-400 mt-2">
            slug: <code>{p.slug}</code> · status: <strong>{p.status}</strong>
            {p.published_at && <> · published {p.published_at}</>}
          </div>
        </div>
        {published && (
          <Link
            to={`/insights/public/${p.slug}`}
            target="_blank"
            className="text-sm text-violet-600 hover:underline flex items-center gap-1"
          >
            View public <ExternalLink className="w-4 h-4" />
          </Link>
        )}
      </header>

      {/* Edit summary */}
      <section className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-6 mb-6" data-card>
        <h2 className="text-sm font-semibold mb-3">Headline summary {p.summary_human_edited && (
          <span className="ml-2 text-xs text-emerald-600">(human-edited)</span>
        )}</h2>
        {!published && (
          <>
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 mb-2 font-medium dark:bg-gray-800 dark:border-gray-700"
              placeholder="Title"
            />
            <input
              type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 mb-2 text-sm dark:bg-gray-800 dark:border-gray-700"
              placeholder="Subtitle (optional)"
            />
            <textarea
              value={summary} onChange={(e) => setSummary(e.target.value)}
              rows={8}
              className="w-full border rounded-lg px-3 py-2 font-mono text-sm dark:bg-gray-800 dark:border-gray-700"
              placeholder="3–5 bullets, one per line, starting with -"
            />
            <div className="flex justify-end mt-3">
              <button
                onClick={save} disabled={saving}
                className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save edits
              </button>
            </div>
          </>
        )}
        {published && (
          <pre className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-sm whitespace-pre-wrap">{summary}</pre>
        )}
      </section>

      {/* Aggregates preview */}
      <section className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-6 mb-6" data-card>
        <h2 className="text-sm font-semibold mb-3">
          Aggregate cells <span className="text-xs text-gray-400">({data.aggregates.length}, n≥{data.k_min}) · {data.period_label}</span>
        </h2>
        {data.aggregates.length === 0 ? (
          <p className="text-sm text-gray-500">No publishable cells in the selected window.</p>
        ) : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Dimension</th>
                  <th className="text-left px-2 py-1">Period</th>
                  <th className="text-right px-2 py-1">n</th>
                  <th className="text-right px-2 py-1">value</th>
                </tr>
              </thead>
              <tbody>
                {data.aggregates.slice(0, 80).map((r, i) => (
                  <tr key={i} className="border-t dark:border-gray-800">
                    <td className="px-2 py-1 font-mono">{r.dimension_key}</td>
                    <td className="px-2 py-1">{r.period_key}</td>
                    <td className="px-2 py-1 text-right">{r.n}</td>
                    <td className="px-2 py-1 text-right">{r.value === null ? '—' : Number(r.value).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Render + publish actions */}
      <section className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-6" data-card>
        <h2 className="text-sm font-semibold mb-3">Render & publish</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => render('pdf')} disabled={rendering !== null}
            className="border border-violet-200 hover:bg-violet-50 text-violet-700 dark:border-violet-700 dark:hover:bg-violet-900/30 dark:text-violet-300 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {rendering === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Render PDF
          </button>
          <button
            onClick={() => render('csv')} disabled={rendering !== null}
            className="border border-violet-200 hover:bg-violet-50 text-violet-700 dark:border-violet-700 dark:hover:bg-violet-900/30 dark:text-violet-300 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {rendering === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Table2 className="w-4 h-4" />}
            Render CSV
          </button>
          <button
            onClick={() => render('png')} disabled={rendering !== null}
            className="border border-violet-200 hover:bg-violet-50 text-violet-700 dark:border-violet-700 dark:hover:bg-violet-900/30 dark:text-violet-300 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {rendering === 'png' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            Render PNG
          </button>
          <div className="flex-1" />
          {!published && (
            <button
              onClick={publish} disabled={publishing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Publish
            </button>
          )}
        </div>
        {lastRender && (
          <div className="mt-4 text-xs text-gray-500">
            Just downloaded: <strong>{lastRender.filename}</strong>
            {lastRender.download_url && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => copyShareLink(lastRender.download_url)}
                  className="text-violet-600 hover:underline"
                >
                  Copy 24h share link
                </button>
                {lastRender.expires_in_seconds && (
                  <> (expires in {Math.round(lastRender.expires_in_seconds / 3600)}h)</>
                )}
              </>
            )}
          </div>
        )}
        {!lastRender && persistedLast && (
          <div className="mt-4 text-xs text-gray-500">
            Last render: <strong>{persistedLast.format || '—'}</strong> on {persistedLast.exported_at}
            {persistedLast.download_url && (
              <> · <a href={persistedLast.download_url} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">Open (may be expired)</a></>
            )}
            {persistedLast.storage_key && (
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{persistedLast.storage_key}</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

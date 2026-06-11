import React, { useEffect, useState } from 'react';
import { FileText, X, Eye, Download, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { useEscapeClose } from '../../components/useEscapeClose';

// Task #9 — Hardcoded IRS-style forms subsection.
//
// Lists the programmatically-rendered forms (SS-4 + instructions, Form 8821,
// Statement & Acknowledgement of Faxed EIN, Confirmation of Information) from
// the worker catalog. Each card opens a preview lightbox that renders the PDF
// (sample placeholder values by default, or a true blank) in an iframe, with
// a download action. The packet-assembler task later fills these with real
// founder data — here admins only preview/download blanks.
//
// The catalog endpoint is worker-only, so in the dev FastAPI environment the
// list 404s; we surface the same "unavailable in this environment" banner the
// other store-backed admin panels use rather than an error.

function PreviewLightbox({ form, onClose }) {
  const [blank, setBlank] = useState(false);
  const [state, setState] = useState({ loading: true, url: null, filename: null, error: null });
  useEscapeClose(onClose);

  useEffect(() => {
    let active = true;
    let createdUrl = null;
    setState({ loading: true, url: null, filename: null, error: null });
    api
      .adminFormPreviewBlob(form.id, { blank })
      .then(({ url, filename }) => {
        if (!active) { URL.revokeObjectURL(url); return; }
        createdUrl = url;
        setState({ loading: false, url, filename, error: null });
      })
      .catch((e) => {
        if (!active) return;
        reportError('AdminForms:preview', e);
        setState({ loading: false, url: null, filename: null, error: e.message || 'Failed to render preview.' });
      });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [form.id, blank]);

  const onDownload = () => {
    if (!state.url) return;
    const a = document.createElement('a');
    a.href = state.url;
    a.download = state.filename || `axal-form-${form.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <FileText size={18} className="text-violet-600 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{form.title}</div>
            {form.pages > 1 && <div className="text-[11px] text-gray-500">{form.pages} pages</div>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
              {[['sample', false], ['blank', true]].map(([label, val]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setBlank(val)}
                  className={`px-3 py-1.5 font-medium border-l first:border-l-0 border-gray-200 dark:border-gray-700 ${blank === val ? 'bg-violet-600 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  {label === 'sample' ? 'Sample values' : 'Blank'}
                </button>
              ))}
            </div>
            <button
              onClick={onDownload}
              disabled={!state.url}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium flex items-center gap-1.5"
            >
              <Download size={13} /> Download
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 dark:bg-gray-950 relative">
          {state.loading && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Rendering preview…
            </div>
          )}
          {state.error && (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="text-center text-sm text-rose-600 flex flex-col items-center gap-2">
                <AlertTriangle size={20} />
                <div>{state.error}</div>
              </div>
            </div>
          )}
          {state.url && (
            <iframe title={`Preview of ${form.title}`} src={state.url} className="w-full h-full border-0" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminForms() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const res = await api.adminListForms();
      setItems(res?.items || []);
    } catch (e) {
      if (e.status === 404) {
        setUnavailable(true);
      } else {
        reportError('AdminForms:list', e);
        setError(e.message || 'Failed to load forms.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  if (loading) {
    return <div className="text-center text-gray-500 py-12 text-sm flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading forms…</div>;
  }

  if (unavailable) {
    return (
      <div data-testid="legal-forms-unavailable" className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <div>The IRS-style forms are rendered by the production worker and are not available in this development environment. Deploy the worker to preview and download them.</div>
      </div>
    );
  }

  return (
    <div data-testid="legal-forms-grid">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-2xl">
          IRS-style forms rendered as fixed PDF layouts with three placeholder fields (full legal name, company, date).
          Preview a form with sample values or a true blank, then download it. The incorporation packet fills these per founder.
        </p>
        <button onClick={reload} className="text-xs text-gray-500 hover:text-violet-600 flex items-center gap-1 flex-shrink-0">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((form) => (
          <div
            key={form.id}
            className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 flex flex-col"
          >
            <div className="flex items-start gap-2 mb-1.5">
              <FileText size={16} className="text-violet-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{form.title}</div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 flex-1">{form.description}</p>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[11px] text-gray-400">{form.pages} page{form.pages > 1 ? 's' : ''}</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setPreview(form)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium flex items-center gap-1.5"
                >
                  <Eye size={13} /> Preview
                </button>
                <button
                  onClick={async () => {
                    try {
                      const { url, filename } = await api.adminFormPreviewBlob(form.id, { blank: false });
                      const a = document.createElement('a');
                      a.href = url; a.download = filename;
                      document.body.appendChild(a); a.click(); a.remove();
                      URL.revokeObjectURL(url);
                    } catch (e) {
                      reportError('AdminForms:download', e);
                      setError(e.message || 'Download failed.');
                    }
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-300 font-medium flex items-center gap-1.5"
                >
                  <Download size={13} /> Download
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {preview && <PreviewLightbox form={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

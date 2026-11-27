import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { lockScroll } from '../../../ui/lightboxFocus';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { reportError } from '../../../lib/log';
import PdfPages, { FALLBACK_NOTE, pdfjsSource } from './PdfPages';

// D717 (#1854) — a template's saved version on a phone, one page at a time
// (board L12, frame `p-preview`, `DESK:38`; #1782 decision 13). It reads the
// saved row's `preview.pdf` once per open and draws it through PdfPages. It is
// read-only: nothing here edits, saves or publishes.

const bar = 'flex h-11 flex-none items-center justify-between gap-3 border-b border-[#ececf1] px-[18px] dark:border-[#2a2733]';
const pager = 'min-h-[44px] text-[14px] font-bold disabled:text-[#c9c6d2] dark:disabled:text-[#5d5869]';

export default function TemplatePreviewPhone({ slug, title, onClose, loadPdf = api.adminTemplateStorePreviewPdfBlob, pdfLoader = pdfjsSource.load }) {
  const titleId = useId();
  const back = useRef(null);
  const [state, setState] = useState({ status: 'loading', pdf: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEscapeClose(onClose);

  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    const release = typeof document !== 'undefined' && document.body ? lockScroll(document.body) : () => {};
    back.current?.focus?.();
    return () => { release(); opener?.focus?.(); };
  }, []);

  useEffect(() => {
    let alive = true;
    let url = null;
    setState({ status: 'loading', pdf: null, error: '' });
    Promise.resolve().then(() => loadPdf(slug)).then(answer => {
      url = answer?.url || null;
      if (!alive) { if (url) try { URL.revokeObjectURL(url); } catch { /* not a blob URL */ } return; }
      setState({ status: 'ready', pdf: answer, error: '' });
    }, e => {
      if (!alive) return;
      reportError('TemplatePreviewPhone:pdf', e);
      setState({ status: 'failed', pdf: null, error: e?.message || '' });
    });
    return () => { alive = false; if (url) try { URL.revokeObjectURL(url); } catch { /* not a blob URL */ } };
  }, [slug, attempt, loadPdf]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="template-preview-phone"
      className="fixed inset-0 z-50 flex flex-col bg-white text-[#18181b] dark:bg-[#0f0d17] dark:text-[#f4f3f7]">
      <div className={bar}>
        <button ref={back} type="button" data-testid="template-preview-back" onClick={onClose}
          className="min-h-[44px] min-w-0 truncate text-left text-[14px] font-bold">
          <span id={titleId}>‹ {title}</span>
        </button>
        <span className="flex-none text-[12px] font-semibold text-[#615c6e] dark:text-[#a29db0]">Read-only</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-[14px]">
        {state.status === 'loading' && <p role="status" className="text-[13px] text-[#615c6e] dark:text-[#a29db0]">Loading…</p>}
        {state.status === 'failed' && (
          <div role="alert" className="text-[13px]">
            <p>{state.error}</p>
            <button type="button" onClick={() => setAttempt(n => n + 1)}
              className="mt-2 min-h-[44px] rounded-[9px] border border-[#ececf1] px-[13px] text-[12.5px] font-bold dark:border-[#2a2733]">Retry</button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            {/* The page stays white in both themes, as it prints. dark-mode-exempt */}
            <div className="bg-white">
              <PdfPages blob={state.pdf.blob} title={title} load={pdfLoader}
                controls={({ page, pages, prev, next }) => (
                  <div className="sticky bottom-0 -mx-[18px] mt-3 flex items-center justify-between border-t border-[#ececf1] bg-white px-[18px] pb-[calc(26px+env(safe-area-inset-bottom))] pt-3 text-[14px] font-bold text-[#18181b] dark:border-[#2a2733] dark:bg-[#0f0d17] dark:text-[#f4f3f7]" data-testid="template-preview-pager">
                    <button type="button" className={pager} disabled={page <= 1} onClick={prev}>‹ Previous</button>
                    <span role="status">{`Page ${page} of ${pages}`}</span>
                    <button type="button" className={`${pager} text-[#881337] dark:text-rose-300`} disabled={page >= pages} onClick={next}>Next ›</button>
                  </div>
                )} />
            </div>
            <p className="mt-2.5 text-center text-[12.5px] font-semibold text-[#615c6e] dark:text-[#a29db0]">Pinch to zoom</p>
            <p className="text-center text-[12px] text-[#615c6e] dark:text-[#a29db0]">Edit on a larger screen.</p>
            {state.pdf.renderer === 'pdf_lib' && <p role="note" className="mt-2 text-center text-[11.5px] text-amber-800 dark:text-amber-300" data-testid="template-preview-fallback">{FALLBACK_NOTE}</p>}
          </>
        )}
      </div>
    </div>
  );
}

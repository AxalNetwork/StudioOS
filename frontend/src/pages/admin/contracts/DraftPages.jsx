import React, { useCallback, useEffect, useRef, useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts.js';
import PdfPages from './PdfPages';

// D717 (#1853) — the template editor's Pages pane: the unsaved draft's real PDF
// from POST /templates/render.pdf, drawn by PdfPages. Every draw is a Browser
// Run render on the Worker, so it draws when the pane opens and on Redraw
// pages, never on each keystroke (#1853 decision 5). `request` is
// `paperRequest(...)`, the same body the live paper posts (#1853 decision 8).

export default function DraftPages({ request }) {
  const key = JSON.stringify(request);
  const [drawn, setDrawn] = useState(null); // { key, blob, renderer }
  const [state, setState] = useState({ loading: true, error: null });
  const controller = useRef(null);
  const latest = useRef(request);
  latest.current = request;

  const draw = useCallback(async () => {
    controller.current?.abort?.();
    const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
    controller.current = ctl;
    const body = latest.current;
    const drawnKey = JSON.stringify(body);
    setState({ loading: true, error: null });
    try {
      const { blob, renderer } = await contractsApi.renderPdfBlob(body, { signal: ctl?.signal });
      if (ctl?.signal.aborted) return;
      setDrawn({ key: drawnKey, blob, renderer });
      setState({ loading: false, error: null });
    } catch (e) {
      if (ctl?.signal.aborted || e?.name === 'AbortError') return;
      setState({ loading: false, error: e });
    }
  }, []);

  useEffect(() => {
    draw();
    return () => controller.current?.abort?.();
  }, [draw]);

  const stale = !!drawn && drawn.key !== key;
  const { loading, error } = state;
  return (
    <div data-testid="draft-pages">
      {stale && !loading && (
        <div role="status" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ececf1] bg-[#faf9fb] px-3 py-2 text-[11.5px] text-[#615c6e] dark:border-[#2a2733] dark:bg-[#18161f] dark:text-[#a29db0]">
          <span>The draft changed since these pages were drawn.</span>
          <button type="button" onClick={draw} className="font-bold text-[#881337] dark:text-rose-300">Redraw pages</button>
        </div>
      )}
      {loading && <p role="status" className="p-4 text-xs text-gray-500 dark:text-gray-400">Drawing the pages…</p>}
      {error && !loading && (
        <div role="alert" className="p-4 text-[12.5px] text-amber-800 dark:text-amber-300" data-testid="draft-pages-error">
          {error.message || 'The pages could not be drawn.'}
          {error.status !== 413 && <>{' '}<button type="button" className="font-bold underline" onClick={draw}>Try again</button></>}
        </div>
      )}
      {drawn && !loading && !error && <PdfPages blob={drawn.blob} renderer={drawn.renderer} title={request?.title || 'Document'} />}
    </div>
  );
}

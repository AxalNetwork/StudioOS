import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createThumbnailQueue } from '../../../lib/thumbnailQueue';
import { reportError } from '../../../lib/log';

// D717 — a template's page-1 thumbnail, the Worker's PNG (#1851, board L8's
// rules), shared by the desktop catalog and the phone list (#1854). `compact`
// is the phone's 32 × 42 row image: no Retry in a frame that small (the row
// still opens the real pages), and the failure sentence is the frame's title
// and a hidden span, never a generic icon.

export const THUMB_NOT_DRAWN = 'Thumbnail not drawn: the page renderer did not answer.';

// One IntersectionObserver and one queue of four for the whole tab (decision
// 5). Without IntersectionObserver (the test DOM), each thumbnail starts on
// mount, still four at a time.
export function useThumbnails() {
  return useMemo(() => {
    const queue = createThumbnailQueue(4);
    const watchers = new Map();
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting && watchers.has(e.target)) { const go = watchers.get(e.target); watchers.delete(e.target); io.unobserve(e.target); go(); }
      }, { rootMargin: '200px' })
      : null;
    return {
      queue,
      watch(el, go) {
        if (!io || !el) { go(); return () => {}; }
        watchers.set(el, go); io.observe(el);
        return () => { watchers.delete(el); io.unobserve(el); };
      },
    };
  }, []);
}

let thumbSeq = 0;
export function Thumbnail({ thumbs, load, version, stub, title, width = 70, height = 90, compact = false }) {
  const frame = useRef(null);
  const [state, setState] = useState({ url: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const shown = useRef(null);
  useEffect(() => {
    let active = true;
    const key = `thumb-${thumbSeq += 1}`;
    const stop = thumbs.watch(frame.current, () => {
      thumbs.queue.enqueue(key, load).then(({ url }) => {
        if (!active) { try { URL.revokeObjectURL(url); } catch { /* not a blob URL */ } return; }
        if (shown.current) try { URL.revokeObjectURL(shown.current); } catch { /* not a blob URL */ }
        shown.current = url;
        setState({ url, error: null });
      }, e => {
        if (!active) return;
        reportError('TemplateCatalog:thumbnail', e);
        setState(s => ({ ...s, error: e?.code ? e.message : THUMB_NOT_DRAWN }));
      });
    });
    return () => { active = false; stop(); thumbs.queue.cancel(key); };
  // `load` is rebuilt each render; the thumbnail it draws is named by `version`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, version, attempt]);
  useEffect(() => () => { if (shown.current) try { URL.revokeObjectURL(shown.current); } catch { /* not a blob URL */ } }, []);
  const border = stub ? 'border-dashed border-[#c9c6d2]' : 'border-solid border-[#e3e1ea]';
  if (compact) {
    return <div ref={frame} style={{ width, height }} title={state.error || undefined} data-testid="template-thumbnail"
      className={`flex-none overflow-hidden rounded-[3px] border bg-white ${border}`}>{/* dark-mode-exempt: the paper stays white */}
      {state.error ? <span className="sr-only">{state.error}</span>
        : state.url && <img src={state.url} alt="" className="h-full w-full object-cover object-top" />}
    </div>;
  }
  return <div ref={frame} className={`h-[90px] w-[70px] flex-none overflow-hidden rounded-[3px] border bg-white ${border}`}>{/* dark-mode-exempt: the paper stays white (frame "Catalog · dark") */}
    {state.error
      ? <div role="alert" className="flex h-full flex-col justify-between p-1 text-[8.5px] leading-[10px] text-[#615c6e]">
        <span>{state.error}</span>
        <button type="button" className="self-start rounded border border-[#e3e1ea] px-1 text-[9px] font-bold text-[#881337]" onClick={() => { setState(s => ({ ...s, error: null })); setAttempt(n => n + 1); }}>Retry</button>
      </div>
      : state.url && <img src={state.url} alt={`Page 1 of ${title}`} className="h-full w-full object-cover object-top" />}
  </div>;
}

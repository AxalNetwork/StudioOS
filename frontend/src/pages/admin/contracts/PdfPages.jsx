import React, { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../../../lib/log';

// D717 (#1853) — the page viewer: a PDF drawn one page at a time on a canvas,
// with "Page X of Y", Previous and Next, and pinch-to-zoom on touch (boards L9
// and L12, `pPrev()`). The template editor's Pages view uses it here; the phone
// preview (#1854) imports it unchanged.
//
// pdf.js is this file's alone, and only ever loaded dynamically, from the
// pinned legacy build (#1853 decisions 1 to 4): canvas only, no text,
// annotation or XFA layer, no eval path, nothing fetched from another origin.

let pdfjsPromise = null;

/** pdf.js and its worker, imported once. A failed load clears the cache, so Try again imports again. */
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    }).catch((e) => {
      pdfjsPromise = null;
      throw e;
    });
  }
  return pdfjsPromise;
}

/**
 * Where a PdfPages with no `load` prop gets pdf.js. The editor's Pages view
 * mounts PdfPages through DraftPages, so a component test swaps `load` here
 * and never loads the real pdf.js.
 */
export const pdfjsSource = { load: loadPdfjs };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
/** iOS Safari draws no canvas above 16,777,216 pixels. */
export const CANVAS_MAX_PIXELS = 16777216;

/** The zoom a pinch gives: the scale it started at, times how far the fingers moved apart, held to 1–3. */
export function pinchScale(startScale, startDistance, distance) {
  if (!(startDistance > 0) || !(distance > 0)) return startScale;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (startScale * distance) / startDistance));
}

export const FALLBACK_NOTE = 'These page breaks come from the fallback renderer. A sent copy may break differently.';
const FAILED = 'The pages could not be drawn. Try again.';
const pagerButton = 'text-[14px] font-bold disabled:cursor-default disabled:text-[#a29db0] dark:disabled:text-[#615c6e]';

const isCancel = e => e?.name === 'RenderingCancelledException';
const coarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;

/**
 * `controls({ page, pages, prev, next })` (#1854) replaces the pager and the
 * pinch hint, for a host that places them itself; without it the viewer draws
 * its own, as before.
 */
export default function PdfPages({ blob, renderer = null, title = 'Document', load = pdfjsSource.load, controls }) {
  const [doc, setDoc] = useState(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pinch, setPinch] = useState(null); // the CSS scale while two fingers move
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pdfjsRef = useRef(null);
  const canvas = useRef(null);
  const wrapper = useRef(null);
  const renderTask = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  // Open the document: a fresh read of the blob each time, because pdf.js moves
  // the bytes it is given into its worker (#1853 decision 6).
  useEffect(() => {
    if (!blob) return undefined;
    let alive = true;
    let task = null;
    setDoc(null);
    setPages(0);
    setPage(1);
    setFailed(false);
    (async () => {
      try {
        const pdfjs = await load();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        pdfjsRef.current = pdfjs;
        task = pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false });
        const opened = await task.promise;
        if (!alive) return;
        setDoc(opened);
        setPages(opened.numPages);
      } catch (e) {
        if (!alive) return;
        reportError('contracts:pdf-pages', e);
        setFailed(true);
      }
    })();
    return () => {
      alive = false;
      renderTask.current?.cancel?.();
      task?.destroy?.();
    };
  }, [blob, load, attempt]);

  // Draw the page at the wrapper's width × zoom × device pixels.
  useEffect(() => {
    if (!doc || !pages) return undefined;
    let alive = true;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (!alive) return;
        const base = p.getViewport({ scale: 1 });
        const width = wrapper.current?.clientWidth || 400;
        const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        let scale = (width / base.width) * zoom * ratio;
        const pixels = base.width * base.height * scale * scale;
        if (pixels > CANVAS_MAX_PIXELS) scale *= Math.sqrt(CANVAS_MAX_PIXELS / pixels);
        const viewport = p.getViewport({ scale });
        const el = canvas.current;
        if (!el) return;
        el.width = Math.floor(viewport.width);
        el.height = Math.floor(viewport.height);
        el.style.width = `${Math.floor(viewport.width / ratio)}px`;
        renderTask.current?.cancel?.();
        const task = p.render({ canvas: el, viewport, annotationMode: pdfjsRef.current?.AnnotationMode?.DISABLE ?? 0 });
        renderTask.current = task;
        await task.promise;
      } catch (e) {
        if (!alive || isCancel(e)) return;
        reportError('contracts:pdf-pages', e);
        setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [doc, pages, page, zoom]);

  // Pinch: two touch pointers on the page. The scale shows as a CSS transform
  // while the fingers move, and the page redraws at it on release.
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = useCallback((e) => {
    if (e.pointerType !== 'touch') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) gesture.current = { scale: zoom, distance: distance() };
  }, [zoom]);
  const onPointerMove = useCallback((e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.current && pointers.current.size === 2) {
      setPinch(pinchScale(gesture.current.scale, gesture.current.distance, distance()) / zoom);
    }
  }, [zoom]);
  const onPointerUp = useCallback((e) => {
    pointers.current.delete(e.pointerId);
    if (gesture.current && pointers.current.size < 2) {
      const next = pinch == null ? zoom : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * pinch));
      gesture.current = null;
      setPinch(null);
      if (next !== zoom) setZoom(next);
    }
  }, [pinch, zoom]);

  if (failed) {
    return (
      <div role="alert" className="p-4 text-[12.5px] text-amber-800 dark:text-amber-300" data-testid="pdf-pages-failed">
        {FAILED}{' '}
        <button type="button" className="font-bold underline" onClick={() => setAttempt(n => n + 1)}>Try again</button>
      </div>
    );
  }

  return (
    <div data-testid="pdf-pages">
      {renderer === 'pdf_lib' && (
        <p role="note" className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" data-testid="pdf-pages-fallback">
          {FALLBACK_NOTE}
        </p>
      )}
      {!doc && <p role="status" className="p-4 text-xs text-gray-500 dark:text-gray-400">Drawing the pages…</p>}
      {/* The page stays white in both themes, as it prints. dark-mode-exempt */}
      <div
        ref={wrapper}
        className="overflow-auto bg-white p-3"
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={pages ? `Page ${page} of ${pages} of ${title}` : `${title}, drawing`}
          className="mx-auto block max-w-none shadow-sm"
          style={pinch != null ? { transform: `scale(${pinch})`, transformOrigin: 'top center' } : undefined}
        />
      </div>
      {doc && controls && controls({
        page, pages,
        prev: () => setPage(n => Math.max(1, n - 1)),
        next: () => setPage(n => Math.min(pages, n + 1)),
      })}
      {doc && !controls && (
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <button type="button" className={`${pagerButton} text-[#18181b] dark:text-[#f4f3f7]`} disabled={page <= 1} onClick={() => setPage(n => Math.max(1, n - 1))}>‹ Previous</button>
          <span role="status" className="text-[14px] font-bold">{`Page ${page} of ${pages}`}</span>
          <button type="button" className={`${pagerButton} text-[#881337] dark:text-rose-300`} disabled={page >= pages} onClick={() => setPage(n => Math.min(pages, n + 1))}>Next ›</button>
        </div>
      )}
      {doc && !controls && coarsePointer() && <p className="pb-2 text-center text-[11.5px] text-gray-500 dark:text-gray-400">Pinch to zoom</p>}
    </div>
  );
}

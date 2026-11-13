/** #5218: one lazy preview surface for methods, stored templates and saved versions. */
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import DeckTemplatePreview from '../../../decks/DeckTemplatePreview';
import { cardOf } from './presentExportModel';

const PresentCard = lazy(() => import('./PitchPresent').then((m) => ({ default: m.PresentCard })));
const NOTE = 'flex aspect-video w-full items-center justify-center rounded-[6px] border border-axal-hairline bg-axal-ground p-3 text-center text-xs text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';

/** Cache belongs to this chooser, so a later signed-in member never inherits a saved deck. */
export function previewRead(cache, key, load) {
  if (!cache.has(key)) {
    const pending = Promise.resolve().then(load).catch((error) => { cache.delete(key); throw error; });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export function useVisible() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

class PreviewBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <span className={NOTE}>Preview unavailable</span> : this.props.children; }
}

export default function DeckPreview({ templateKey = null, deck = null, load = null, cache = null, cacheKey = null, slideIndex = 0 }) {
  const [ref, visible] = useVisible();
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (!visible || !load) return undefined;
    let live = true;
    setRead({ status: 'loading', data: null });
    previewRead(cache, cacheKey, load).then(
      (data) => { if (live) setRead({ status: 'ok', data }); },
      () => { if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  // Load functions close over this key; a new render alone must not re-read it.
  }, [visible, cache, cacheKey, Boolean(load)]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = load ? read.data : deck;
  const slides = data?.cards || data?.slides;
  const slide = slides?.[slideIndex];
  return (
    <div ref={ref} className="w-full min-w-0" data-testid="deck-choice-preview">
      {!visible ? <span className={NOTE}>Preview loads when visible</span>
        : templateKey ? <DeckTemplatePreview templateKey={templateKey} slideIndex={slideIndex} />
          : load && read.status === 'loading' ? <span className={NOTE}>Loading preview…</span>
            : !slide ? <span className={NOTE}>Preview unavailable</span>
              : <PreviewBoundary key={cacheKey || slideIndex}>
                <div className="pointer-events-none overflow-hidden rounded-[6px]" inert aria-hidden="true">
                  <Suspense fallback={<span className={NOTE}>Loading preview…</span>}>
                    <PresentCard card={cardOf(slide, slideIndex)} small sources={false} theme={data.theme} aspect={data.theme?.aspect || '16:9'} />
                  </Suspense>
                </div>
              </PreviewBoundary>}
    </div>
  );
}

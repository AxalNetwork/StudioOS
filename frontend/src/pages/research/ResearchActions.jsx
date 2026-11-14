/**
 * D5157 part 3 (#5157) — a company or fund profile's Add to research and
 * Compare (RS-04 B, RS-05 B). Two buttons that open `AddToResearch.jsx`,
 * loaded only when pressed, with focus returned to the button that opened it.
 * Drawn only in a shell whose Research row has My Research (`canAddToResearch`).
 */
import React, { lazy, Suspense, useRef, useState } from 'react';

const AddToResearch = lazy(() => import('./AddToResearch.jsx'));

const BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** `kind` is company or fund; `item` is `{ uid, name }`. */
export default function ResearchActions({ kind, item, addLabel = 'Add to research', compare = true }) {
  const [mode, setMode] = useState(null);
  const addRef = useRef(null);
  const compareRef = useRef(null);
  if (!item?.uid) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid={`research-actions-${kind}`}>
      <button type="button" ref={addRef} className={BUTTON} onClick={() => setMode('add')} data-testid={`button-research-add-${kind}`}>{addLabel}</button>
      {compare ? <button type="button" ref={compareRef} className={BUTTON} onClick={() => setMode('compare')} data-testid={`button-research-compare-${kind}`}>Compare</button> : null}
      {mode ? (
        <Suspense fallback={null}>
          <AddToResearch kind={kind} items={[{ uid: item.uid, name: item.name }]} mode={mode} returnFocusTo={mode === 'compare' ? compareRef : addRef} onClose={() => setMode(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** #5218: visual Start from chooser; a plan lock gates use, never preview. */
import React, { useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { Lightbox } from '../../../ui';
import DeckPreview from './DeckPreview';

const BUTTON = 'min-h-[36px] rounded-[9px] border border-axal-hairline px-3 py-2 text-[12px] font-bold text-axal-violet disabled:opacity-50 dark:border-gray-700 dark:text-violet-300';

export function TemplateStructure({ option, all = false }) {
  const titles = option?.slides || [];
  return (
    <section className="flex flex-col gap-3" aria-label="Template structure" data-testid="pitch-new-template-structure">
      <h3 className="m-0 text-[14px] font-bold">{option.label} · Template structure</h3>
      <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">The template controls the slide structure. The generic outline is not used.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(all ? titles : titles.slice(0, 3)).map((s, i) => (
          <div key={s.id || i} className="flex min-w-0 flex-col gap-1">
            <DeckPreview templateKey={option.templateKey} slideIndex={i} />
            <span className="text-xs">{i + 1}. {s.title || `Slide ${i + 1}`}</span>
          </div>
        ))}
        {!titles.length ? <DeckPreview templateKey={option.templateKey} /> : null}
      </div>
      <ol className="m-0 list-inside list-decimal p-0 text-[12px]">{titles.map((s, i) => <li key={s.id || i}>{s.title || `Slide ${i + 1}`}</li>)}</ol>
      {!titles.length ? <span className="text-xs">Structure not recorded</span> : null}
    </section>
  );
}

export default function TemplateChooser({ options, start, onSelect, onUse }) {
  const cache = useRef(new Map()).current;
  const [all, setAll] = useState(false);
  const selected = options.find((op) => op.kind === start.kind && String(op.id) === String(start.id));
  return (
    <>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 xl:grid-cols-3" data-testid="pitch-new-start-options">
        {options.map((op) => (
          <button key={`${op.kind}:${op.id}`} type="button" aria-pressed={op === selected} onClick={() => { onSelect({ kind: op.kind, id: op.id }); setAll(false); }}
            className={`flex w-[min(80vw,320px)] min-w-0 shrink-0 snap-start flex-col gap-2 sm:w-auto rounded-[8px] border p-2 text-left text-[12px] ${op === selected ? 'border-axal-violet dark:border-violet-400' : 'border-axal-hairline dark:border-gray-700'}`}
            data-testid={`pitch-new-option-${op.kind}-${op.id}`}>
            {op.kind === 'blank' ? <span className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[6px] border border-dashed border-axal-lavender-edge bg-axal-ground text-axal-muted dark:bg-gray-800"><span aria-hidden="true" className="text-3xl">＋</span><span>Empty deck · your own structure</span></span>
              : op.kind === 'template' ? <DeckPreview templateKey={op.templateKey} />
                : <DeckPreview cache={cache} cacheKey={op.id} load={() => api.deckGet(op.id)} />}
            <span className="font-bold">{op.label}</span>
            {op.slide_count ? <span>{op.slide_count} slides{op.category ? ` · ${op.category}` : ''}</span> : null}
            {op.best_for ? <span className="text-axal-muted dark:text-gray-400">{op.best_for}</span> : null}
            {op.recommended ? <span className="font-bold text-axal-violet" data-testid="pitch-new-recommended">Recommended</span> : null}
            {op.recommended && op.reason ? <span data-testid="pitch-new-recommended-reason">Recommended: {op.label}. {op.reason}</span> : null}
            {op.locked ? <span>Plan · preview available</span> : null}
          </button>
        ))}
      </div>
      {selected?.kind === 'template' ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="pitch-new-template-line">
          <button type="button" className={BUTTON} onClick={() => setAll(true)}>Preview all slides</button>
          <button type="button" className={BUTTON} disabled={selected.locked} onClick={onUse} data-testid="pitch-new-use-template">Use this template</button>
          {selected.locked ? <span className="text-xs">Your plan does not include this template.</span> : null}
        </div>
      ) : null}
      {selected?.kind === 'template' ? <TemplateStructure option={selected} /> : null}
      {all && selected?.kind === 'template' ? <Lightbox label={`Preview · ${selected.label}`} title={`Preview · ${selected.label}`} width={960} onClose={() => setAll(false)}><TemplateStructure option={selected} all /></Lightbox> : null}
    </>
  );
}

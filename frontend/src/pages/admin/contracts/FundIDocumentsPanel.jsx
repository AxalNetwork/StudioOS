import React, { useMemo } from 'react';
import { Pill } from '../../../ui';
import { fundIPanel } from '../../../lib/fundIDocuments';
import { card } from './parts';

// D717 (#1851) decision 7 — the Fund I documents above the layers, in signing
// order (board L9, `DESK:17-18`). It ignores search and filters. "Ready"
// counts recorded publications only, because New envelope offers nothing else.

const STAGE_LABEL = {
  formation: 'Formation', offering: 'Offering', booklet: 'Booklet',
  closing: 'Closing', operations: 'Operations', compliance: 'Compliance',
};
const action = 'w-[58px] flex-none text-right text-[11.5px] font-bold text-[#881337] dark:text-rose-300';

function Row({ item, authoring, onOpen }) {
  const { slug, row, missing, state } = item;
  return <div data-testid={`fund-i-row-${slug}`} className="flex items-center gap-2 border-t border-axal-hairline py-1 text-xs dark:border-[#2a2733]">
    {missing
      ? <span className="min-w-0 flex-1 truncate font-mono">{slug}</span>
      : <span className="min-w-0 flex-1 truncate" title={row.title}>{row.title}</span>}
    {missing ? <Pill tone="info">Not in the catalog</Pill>
      : state === 'stub' ? <Pill tone="neutral">Stub</Pill>
        : state === 'published' ? <Pill tone="ok">Published v{row.published_version}</Pill>
          : <Pill tone="ok">Has a body</Pill>}
    {missing ? <span className="w-[58px] flex-none" />
      : state === 'stub' && authoring
        ? <button type="button" className={action} onClick={() => onOpen(slug, { focus: 'body' })}>Add body</button>
        : <button type="button" className={action} onClick={() => onOpen(slug)}>Open</button>}
  </div>;
}

export default function FundIDocumentsPanel({ items, authoring, onOpen }) {
  const panel = useMemo(() => fundIPanel(items), [items]);
  return <section data-testid="fund-i-panel" className={`${card} flex flex-col gap-2.5 px-4 py-3.5 dark:border-[#2a2733] dark:bg-[#18161f]`}>
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-[15px] font-extrabold">Fund I documents</h3>
      <span className="text-[12.5px] font-semibold text-axal-muted dark:text-[#a29db0]">{panel.ready} of {panel.total} ready to send · signing order</span>
    </header>
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      {panel.stages.map(stage => <div key={stage.stage} className={`${card} px-3 py-2.5 dark:border-[#2a2733] dark:bg-[#18161f]`}>
        <h4 className="mb-1.5 text-xs font-extrabold">{STAGE_LABEL[stage.stage]} <span className="font-medium text-axal-muted dark:text-[#a29db0]">· {stage.items.length}</span></h4>
        {stage.items.map(item => <Row key={item.slug} item={item} authoring={authoring} onOpen={onOpen} />)}
      </div>)}
    </div>
  </section>;
}

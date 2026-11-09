import React from 'react';
import { Link } from 'react-router-dom';
import { contractsApi } from '../../../lib/api/contracts';
import { adminGovernanceApi } from '../../../lib/api/adminGovernance';
import { InconsistencyFlag, LifecycleBadge, SafetyOverlayBadge } from './LifecycleBadge';
import { QUEUE_ROWS, repairOf, reviewItems, stalledItem } from './attentionQueues';
import { ReadState, card, useRead } from './parts';

/**
 * D4811 (#4811) part 11 — the overview's short queues (board CT-01): stalled
 * and awaiting signature (oldest send first), data repair required (each with
 * its repair), and legal review required (templates, and HQ's governance
 * records). Each shows its first three and opens the whole list. A queue that
 * could not be read says so, and never reads as empty.
 */
export default function AttentionQueues({ hq, revision, onOpen, onLink, onDrill }) {
  const stalled = useRead(() => contractsApi.agreements({ status: 'awaiting_signature', sort: 'sent_at', direction: 'asc', limit: QUEUE_ROWS }), [revision]);
  const repairs = useRead(() => contractsApi.agreements({ attention: 'repair', limit: QUEUE_ROWS }), [revision]);
  const templates = useRead(() => contractsApi.templates(), [revision]);
  const governance = useRead(() => (hq ? adminGovernanceApi.list() : Promise.resolve(null)), [hq, revision]);
  const reviews = templates.data ? reviewItems(templates.data.items, governance.data) : [];
  return <div className="grid gap-3 lg:grid-cols-3" data-testid="contracts-queues">
    <Queue title="Stalled and awaiting signature" testId="queue-stalled" read={stalled} what="Awaiting signature"
      meta={stalled.data ? `${stalled.data.total} · oldest send first` : null}
      empty="Nothing is awaiting signature." foot="All awaiting signature" onFoot={() => onDrill({ kind: 'filter', filters: { status: 'awaiting_signature', sort: 'sent_at', direction: 'asc' } })}>
      {stalled.data?.items.map((r) => { const s = stalledItem(r); return <Row key={r.uid} title={s.title} sub={s.party} onTitle={() => onOpen(r.uid)}>
        <span>{s.line}{s.age == null ? <> · <span className="text-axal-muted">send not recorded</span></> : ` · ${s.age} d`}{s.stalled && <span className="font-semibold text-amber-800 dark:text-amber-300"> · stalled</span>}</span>
      </Row>; })}
    </Queue>
    <Queue title="Data repair required" testId="queue-repair" read={repairs} what="Data repairs"
      meta={repairs.data ? String(repairs.data.total) : null}
      empty="No agreement needs a repair." foot="All repairs" onFoot={() => onDrill({ kind: 'filter', filters: { attention: 'repair' } })}>
      {repairs.data?.items.map((r) => { const fix = repairOf(r); return <Row key={r.uid} title={r.title} sub={fix?.kind === 'evidence' ? <InconsistencyFlag text={fix.problem} /> : fix?.problem} onTitle={() => onOpen(r.uid)}>
        {fix && <button type="button" data-testid={`repair-${fix.action.kind}-${r.uid}`} onClick={() => (fix.action.kind === 'link' ? onLink(r) : onOpen(r.uid))}
          className="min-h-[44px] rounded-lg border border-dashed border-violet-400 px-2 text-[11px] font-semibold text-violet-700 dark:text-violet-300 md:min-h-0 md:py-1">{fix.action.label}</button>}
      </Row>; })}
    </Queue>
    <Queue title="Legal review required" testId="queue-review" read={templates} what="Templates"
      meta={templates.data ? `${reviews.length}${hq && governance.error ? ' · governance unreadable' : ''}` : null}
      empty="No template or governance record is waiting on review." foot="All reviews" onFoot={() => onDrill({ kind: 'tab', tab: 'templates' })}>
      {reviews.slice(0, QUEUE_ROWS).map((it) => <Row key={it.key} title={<Link to={it.to} className="underline decoration-transparent hover:decoration-current">{it.title}</Link>}
        sub={<><span className={`mr-1 rounded border border-axal-hairline px-1 text-[10px] font-bold uppercase tracking-wider ${it.type === 'template' ? 'border-dashed' : ''}`}>{it.type === 'template' ? 'Template' : 'Governance'}</span>{it.context}</>}>
        <span className="flex flex-wrap gap-1">{it.badge && <LifecycleBadge badge={it.badge} />}{it.overlays.map((k) => <SafetyOverlayBadge key={k} kind={k} />)}</span>
      </Row>)}
    </Queue>
  </div>;
}

function Queue({ title, testId, read, what, meta, empty, foot, onFoot, children }) {
  const rows = React.Children.toArray(children);
  return <section aria-label={title} className={`${card} flex flex-col`} data-testid={testId}>
    <header className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3"><h2 className="text-[13px] font-bold">{title}</h2>{meta && <span className="font-mono text-[11px] text-axal-muted">{meta}</span>}</header>
    <ReadState read={read} what={what}>{read.data && (rows.length ? <ul className="flex-1 divide-y divide-axal-hairline">{rows}</ul> : <p className="flex-1 px-4 py-3 text-[12px] text-axal-muted">{empty}</p>)}</ReadState>
    <button type="button" onClick={onFoot} className="min-h-[44px] border-t border-axal-hairline px-4 py-2 text-left text-[12px] font-semibold text-violet-700 dark:text-violet-300">{foot}</button>
  </section>;
}

function Row({ title, sub, onTitle, children }) {
  return <li className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-[12px]">
    <span className="min-w-0"><span className="block font-semibold">{onTitle ? <button type="button" className="text-left underline decoration-transparent hover:decoration-current" onClick={onTitle}>{title}</button> : title}</span>
      {sub && <span className="block text-[11px] text-axal-muted">{sub}</span>}</span>
    <span className="text-[11px]">{children}</span>
  </li>;
}


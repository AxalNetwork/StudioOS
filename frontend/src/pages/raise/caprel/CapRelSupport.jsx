import React, { useEffect, useState } from 'react';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships.js';
import { NOT_RECORDED } from '../../../lib/absence';
import ReasonGate, { AccessBanner, AccessPill, RecordSkeleton } from '../../../ui/ReasonGate';
import { stageLabel } from './capRelModel';

/**
 * D1464 (#4021, RR12): an admin on Capital relationships. The pipeline is the
 * founder's; the Worker answers staff 403 `support_read_required` on every
 * private read (D1191) and gives one private response per reason through
 * `POST …/capital-relationships/support-read`. So: the gate (per open, 1–500
 * characters, a skeleton behind it), then that one response read only under
 * the amber banner, with no timer and no End access. Each further page is a
 * further private response, so it asks for a fresh reason too. The rows draw
 * an investor's name, firm and stage only: never an email or a note.
 *
 *   onOpen(true|false)   the page's rail turns Eadwyn off while the read shows
 */

export const CAPREL_GATE = Object.freeze({ record: 'Capital relationships', what: 'these capital relationships', rule: Object.freeze({ kind: 'per_open' }), min: 1, max: 500 });

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';

const shown = (v) => (String(v ?? '').trim() || NOT_RECORDED);

/** One support response, read only. `onNext` returns to the gate for the next page. */
export function CapRelSupportView({ data, reason, viewer = 'admin', onNext }) {
  const items = Array.isArray(data?.items) ? data.items : null;
  return (
    <div className="flex flex-col gap-3" data-testid="caprel-support-view">
      <AccessBanner reason={reason} viewer={viewer} testId="caprel-support-banner" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`m-0 text-[16px] font-extrabold ${INK}`}>Investors{data?.round?.name ? ` · ${data.round.name}` : ''}</h2>
        <AccessPill viewer={viewer} testId="caprel-support-pill" />
      </div>
      <section className={`${CARD} overflow-hidden`} aria-label="Investors">
        {items == null ? <p className={`m-0 px-4 py-3 text-[13px] ${INK}`} data-testid="caprel-support-unreadable">Unreadable. This is not a claim that the pipeline is empty.</p>
          : items.length ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
              {items.map((p, i) => (
                <li key={p?.uid ?? i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="caprel-support-row">
                  <span className="flex min-w-0 flex-col">
                    <span className={`truncate text-[13px] font-bold ${INK}`}>{shown(p?.name)}</span>
                    <span className={`text-[12px] ${MUTED}`}>{shown(p?.firm)}</span>
                  </span>
                  <span className={`text-[12px] ${MUTED}`}>{stageLabel(p?.stage)}</span>
                </li>
              ))}
            </ul>
          ) : <p className={`m-0 px-4 py-3 text-[13px] ${MUTED}`} data-testid="caprel-support-empty">This venture has no investors in its pipeline.</p>}
      </section>
      {data?.has_more === true && onNext ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`text-[12.5px] font-bold ${INK} underline underline-offset-2`} onClick={onNext} data-testid="caprel-support-next">Next 25</button>
          <span className={`text-[12px] ${MUTED}`}>Each page asks for a new reason.</span>
        </div>
      ) : null}
    </div>
  );
}

/** The gate, then one response. `projectId` is the venture's. */
export default function CapRelSupport({ projectId, venture = null, viewer = 'admin', onOpen }) {
  const [page, setPage] = useState(1);
  const [read, setRead] = useState(null);
  useEffect(() => { onOpen?.(Boolean(read)); }, [read, onOpen]);
  useEffect(() => () => onOpen?.(false), [onOpen]);
  if (read) return <CapRelSupportView data={read.data} reason={read.reason} viewer={viewer} onNext={() => { setPage(read.page + 1); setRead(null); }} />;
  return (
    <ReasonGate key={page} {...CAPREL_GATE} venture={venture} viewer={viewer}
      onSubmit={async (reason) => { const data = await capitalRelationshipsApi.supportRead(projectId, reason, { page }); setRead({ reason, data, page }); }}
      preview={<RecordSkeleton rows={4} />} testId="caprel-support" />
  );
}

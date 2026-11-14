import React, { useEffect, useMemo, useState } from 'react';
import { dataRoomApi } from '../../../lib/api/dataRoom.js';
import ReasonGate, { AccessBanner, AccessPill, RecordSkeleton } from '../../../ui/ReasonGate';
import Sheet from '../../../ui/Sheet';
import { fileRows } from './dataRoomModel';

/**
 * D1464 (#4021, RR11): an admin on the Data room. The room is the founder's,
 * so an admin reads it only through `POST /api/data-room/:p/support-read`
 * (D1102), once per reason: the gate first (per open, 1–500 characters, a
 * skeleton behind it), then the Worker's answer drawn read only under the
 * amber banner — no timer and no End access, because a per-open read has no
 * end to count to. The file detail opens in the right Sheet. Nothing here
 * uploads, shares, sends an NDA or downloads: the support answer carries no
 * signed link, and no write is drawn. A reload asks again; nothing is kept.
 *
 *   onOpen(true|false)   the page's rail turns Eadwyn off while the read shows
 */

export const DATA_ROOM_GATE = Object.freeze({ record: 'Data room', what: 'this data room', rule: Object.freeze({ kind: 'per_open' }), min: 1, max: 500 });

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

function Fact({ k, v }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={EYEBROW}>{k}</dt>
      <dd className={`m-0 text-[13px] ${INK}`}>{v}</dd>
    </div>
  );
}

/** The room as the support answer gives it: files by folder, each opening its detail. */
export function DataRoomSupportView({ room, reason, viewer = 'admin' }) {
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => fileRows(room), [room]);
  const file = open ? rows.find((r) => r.uid === open) : null;
  const name = room?.project?.name || null;
  return (
    <div className="flex flex-col gap-3" data-testid="dataroom-support-view">
      <AccessBanner reason={reason} viewer={viewer} testId="dataroom-support-banner" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`m-0 text-[16px] font-extrabold ${INK}`}>{name ? `${name} · Data room` : 'Data room'}</h2>
        <AccessPill viewer={viewer} testId="dataroom-support-pill" />
      </div>
      <section className={`${CARD} overflow-hidden`} aria-label="Files">
        {rows.length ? (
          <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
            {rows.map((r) => (
              <li key={r.uid}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800"
                  onClick={() => setOpen(r.uid)} data-testid="dataroom-support-file">
                  <span className="flex min-w-0 flex-col">
                    <span className={`truncate text-[13px] font-bold ${INK}`}>{r.name}</span>
                    <span className={`text-[12px] ${MUTED}`}>{r.folder}</span>
                  </span>
                  <span className={`text-[12px] ${MUTED}`}>{r.gate} · {r.tier}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className={`m-0 px-4 py-3 text-[13px] ${MUTED}`} data-testid="dataroom-support-empty">This room holds no files.</p>}
      </section>
      {file ? (
        <Sheet label={file.name} title={file.name} eyebrow="Read only" width={520} onClose={() => setOpen(null)} testId="dataroom-support-sheet">
          <dl className="m-0 grid grid-cols-2 gap-3">
            <Fact k="Folder" v={file.folder} />
            <Fact k="Gate" v={file.gate} />
            <Fact k="Who it is for" v={file.tier} />
            <Fact k="End date" v={file.until} />
            <Fact k="Downloads" v={file.downloads} />
            <Fact k="Who can open it now" v={file.opens} />
          </dl>
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * The gate, then the read. `projectUid` is the room's; `venture` names it in
 * the gate's header when the projects list does.
 */
export default function DataRoomSupport({ projectUid, venture = null, viewer = 'admin', onOpen }) {
  const [read, setRead] = useState(null);
  useEffect(() => { onOpen?.(Boolean(read)); }, [read, onOpen]);
  useEffect(() => () => onOpen?.(false), [onOpen]);
  if (read) return <DataRoomSupportView room={read.room} reason={read.reason} viewer={viewer} />;
  return (
    <ReasonGate {...DATA_ROOM_GATE} venture={venture} viewer={viewer}
      onSubmit={async (reason) => { const room = await dataRoomApi.supportRead(projectUid, reason); setRead({ reason, room }); }}
      preview={<RecordSkeleton rows={4} />} testId="dataroom-support" />
  );
}

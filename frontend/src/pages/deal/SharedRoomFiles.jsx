/** Search, sort and page the investor's admitted room files; withheld files stay a count (#6185). */
import React, { useMemo, useState } from 'react';
import DataRoomSearch from '../raise/dataroom/DataRoomSearch.jsx';
import { CARD, SUB } from './DealFrame.jsx';
import { roomFilesQuery } from './roomFilesQuery.js';

const FIELD = 'min-h-11 min-w-0 rounded-axal-sm border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BUTTON = 'min-h-11 rounded-lg px-2 py-1 text-left text-[13px] font-semibold text-axal-ink disabled:opacity-50 dark:text-gray-100';

export default function SharedRoomFiles({ projectUid, listing, rawFiles = [], withheld = 0, onDownload, downloads = {} }) {
  const [folder, setFolder] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('added');
  const [page, setPage] = useState(1);
  const view = useMemo(() => roomFilesQuery(listing, rawFiles, { folder, q, sort, page }), [listing, rawFiles, folder, q, sort, page]);
  const openHit = (uid) => { const file = listing.files.find((f) => f.uid === uid); if (file) onDownload(file); };
  return <div className="grid min-w-0 gap-3.5 md:grid-cols-[240px_minmax(0,1fr)]" data-testid="shared-room-files">
    <section className={`${CARD} flex min-w-0 flex-col p-4`} data-testid="deal-room-folders">
      <h3 className="m-0 text-[14px] font-bold">Folders</h3>
      <button type="button" className={BUTTON} onClick={() => setFolder('')} aria-pressed={!folder} data-testid="room-folder-all">All files · {listing.files.length}</button>
      {listing.folders.map((f) => <button key={f.uid} type="button" className={`${BUTTON} break-words`} onClick={() => setFolder(f.uid)} aria-pressed={folder === f.uid} data-testid={`room-folder-${f.uid}`}>{f.name} · {f.count}</button>)}
      {withheld > 0 ? <p className={SUB} data-testid="deal-room-withheld">{withheld} {withheld === 1 ? 'file needs' : 'files need'} your NDA. Their names show once you sign.</p> : null}
    </section>
    <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid="deal-room-files">
      <h3 className="m-0 text-[14px] font-bold">Files · {view.total}</h3>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input type="search" className={`${FIELD} flex-1`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search file names" aria-label="Search file names" data-testid="room-name-filter" />
        <label className="flex items-center gap-2 text-[13px]">Sort <select className={FIELD} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="room-sort"><option value="added">Added · newest</option><option value="name">Name</option><option value="size">Size · largest</option></select></label>
      </div>
      <div className="min-w-0 [&_button]:min-h-11 [&_button]:max-w-full [&_button]:break-words [&_span]:break-words">
        <DataRoomSearch key={projectUid} projectUid={projectUid} shared allowedFileUids={listing.files.map((f) => f.uid)} onOpen={openHit}
          unavailableLabel="Search inside files is not switched on yet" emptyLabel="No file matches" />
      </div>
      {!view.rows.length ? <p className={SUB}>No file matches</p> : view.rows.map((file) => <div key={file.uid} className="flex min-w-0 flex-col gap-1 border-t border-axal-hairline pt-2 md:flex-row md:flex-wrap md:items-center md:gap-3 dark:border-gray-700" data-testid="deal-room-file">
        <strong className="min-w-0 flex-1 break-words text-[13px]">{file.name}</strong>
        <span className={SUB}>{file.size} · {file.added}</span>
        <button type="button" className={`${BUTTON} text-violet-700 underline dark:text-violet-300`} disabled={downloads[file.uid]?.busy} onClick={() => onDownload(file)} aria-label={`Open ${file.name}`}>Open</button>
        {downloads[file.uid]?.err ? <p className="m-0 text-[12px] text-red-700 dark:text-red-300" role="alert">{downloads[file.uid].err}</p> : null}
      </div>)}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span role="status" data-testid="room-page-range">{view.range}</span>
        <div className="flex gap-2"><button type="button" className={BUTTON} disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} data-testid="room-page-prev">Previous</button><button type="button" className={BUTTON} disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} data-testid="room-page-next">Next</button></div>
      </div>
      <p className={SUB}>Content search covers all files in your listing. Each download uses the existing logged one-time link.</p>
    </section>
  </div>;
}

import React, { useState } from 'react';
import { dataRoomApi } from '../../../lib/api/dataRoom.js';
import { reportError } from '../../../lib/log';

/**
 * #3938 part 2 (D1478 task 4) — search inside the room's files.
 *
 * The room's own index answers (qwen3-embedding, fixed): there is no model to
 * pick here, by design. Until the owner binds the index, the Worker answers
 * "Data room search is not switched on yet." and this says exactly that.
 * The founders index and search the whole room; `shared` searches as an
 * investor, over the files their listing shows.
 */
const BTN = 'inline-flex min-h-[34px] items-center rounded-[8px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-lavender disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'min-h-[34px] min-w-0 flex-1 rounded-[8px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const NOTE = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';

export default function DataRoomSearch({ projectUid, shared = false, canIndex = false, onOpen }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [indexLine, setIndexLine] = useState(null);

  const search = async (e) => {
    e?.preventDefault?.();
    if (!q.trim()) return;
    setBusy('search');
    try { setAnswer(await (shared ? dataRoomApi.sharedSearch(projectUid, q) : dataRoomApi.search(projectUid, q))); }
    catch (err) { reportError('DataRoomSearch:search', err); setAnswer({ available: false, reason: err?.message || 'The data room could not be searched right now.' }); }
    finally { setBusy(null); }
  };
  const index = async () => {
    setBusy('index');
    try {
      const r = await dataRoomApi.searchIndex(projectUid);
      if (!r?.available) setIndexLine(r?.reason || 'Data room search is not switched on yet.');
      else {
        const v = r.value;
        setIndexLine(`${v.indexed} indexed${v.no_text ? `, ${v.no_text} with no text` : ''}${v.failed?.length ? `, ${v.failed.length} could not be read` : ''}${v.remaining ? ` · ${v.remaining} left, press again` : ' · all files indexed'}`);
      }
    } catch (err) { reportError('DataRoomSearch:index', err); setIndexLine(err?.message || 'Indexing did not run.'); }
    finally { setBusy(null); }
  };

  const hits = answer?.available ? answer.value?.hits || [] : [];
  return (
    <div className="flex flex-col gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800" data-testid="dataroom-search">
      <form className="flex flex-wrap items-center gap-2" onSubmit={search}>
        <input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inside the files" aria-label="Search inside the files" maxLength={500} />
        <button type="submit" className={BTN} disabled={!q.trim() || busy === 'search'} data-testid="dataroom-search-go">{busy === 'search' ? 'Searching…' : 'Search'}</button>
        {canIndex ? <button type="button" className={BTN} onClick={index} disabled={busy === 'index'} data-testid="dataroom-search-index">{busy === 'index' ? 'Indexing…' : 'Index files for search'}</button> : null}
      </form>
      {indexLine ? <p className={NOTE} role="status" data-testid="dataroom-search-index-line">{indexLine}</p> : null}
      {answer && !answer.available ? <p className={NOTE} role="status" data-testid="dataroom-search-off">{answer.reason}</p> : null}
      {answer?.available ? (
        hits.length ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="dataroom-search-hits">
            {hits.map((h, i) => (
              <li key={`${h.file_uid}-${i}`} className="flex flex-col gap-0.5">
                <button type="button" className="self-start text-left text-[13px] font-bold text-axal-violet hover:underline dark:text-violet-300" onClick={() => onOpen?.(h.file_uid)}>{h.file_name}</button>
                <span className="text-[12.5px] leading-[1.45] text-axal-ink dark:text-gray-200">{h.snippet}{h.snippet.length >= 320 ? '…' : ''}</span>
              </li>
            ))}
          </ol>
        ) : <p className={NOTE} role="status">Nothing in the indexed files matches.</p>
      ) : null}
    </div>
  );
}

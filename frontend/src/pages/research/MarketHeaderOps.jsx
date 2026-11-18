import React, { useEffect, useState } from 'react';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { readMarketQuery } from './marketDirectoryQuery.js';
import {
  THESIS_EDIT, exportControl, newMarketResearchHref, researchSubject, runViewExport,
} from './marketDirectoryExport.js';

/**
 * D7171 part 2 (#7171, canvas D7036, RMD-01 and RMD-08 headers) — the page's
 * side of the Markets header ops. The per-licence tables declare them as
 * `kind: 'handler'`; this hook supplies them:
 *
 *   exportFilteredView every market the directory view holds, paged from the Worker
 *   newMarketResearch  My Research's New research form, the market named (founder)
 *   editThesis         Settings › My thesis (investor)
 *
 * `read` is what the directory panel reports through `onRead`: the read's
 * status and data, the exact request and the thesis it matched against.
 */
export function useMarketHeaderOps({ tab, read, params, navigate, list = researchMarketsApi.list }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const key = `${tab}|${JSON.stringify(read?.request || null)}`;
  useEffect(() => { setNote(null); }, [key]);

  const ctl = tab === 'directory'
    ? exportControl(read)
    : { disabled: true, title: 'Export view writes the market directory. Open the Market directory tab.' };
  const run = async () => {
    if (ctl.disabled || busy) return;
    setBusy(true);
    setNote(null);
    const result = await runViewExport(read, { list });
    setBusy(false);
    setNote(result);
  };
  const view = readMarketQuery(params);
  const subject = researchSubject(view, read?.data?.items || []);
  const handlers = {
    exportFilteredView: { onClick: run, disabled: ctl.disabled, busy, title: ctl.title },
    newMarketResearch: {
      onClick: () => navigate(newMarketResearchHref(subject)),
      title: subject ? `Opens New research in My Research with ${subject} named.` : 'Opens New research in My Research.',
    },
    editThesis: { onClick: () => navigate(THESIS_EDIT), title: 'Opens My thesis in Settings, where your investor thesis is edited.' },
  };
  return { handlers, note };
}

/** What the last export did, said once under the header. */
export function ExportNote({ note }) {
  if (!note) return null;
  return (
    <p role="status" data-testid="markets-export-note"
      className={`text-[12px] ${note.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
      {note.text}
    </p>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { deckCheckApi } from '../../../lib/api/deckCheck';
import { reportError } from '../../../lib/log';
import { checksByDeck, checksCell } from './checkModel';
import { VERSION_SORTS, audienceOptions, versionRows } from './pitchStudioModel';

/**
 * D894 / D898 group D (PD15) — every version of the deck, as a table (a list
 * on a phone): Audience and Sort, Compare on each version but the current
 * one, and each version's last check (D900). D1604 (#3716): moved off the
 * studio's home into ⋯ › Versions…, the sheet `DeckSheets.VersionsSheet`
 * draws on the home's deck card and in the editor.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;

/**
 * D900 (#2679): `GET /api/decks/checks` — each version's last check. `null`
 * while it reads, `'error'` when it failed (the cells then say Not read, never
 * Not checked), else a Map by deck id.
 */
export function useDeckChecks(projectId, count) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (projectId == null) { setState(null); return undefined; }
    let live = true;
    setState(null);
    deckCheckApi.versions(projectId).then(
      (r) => { if (live) setState(checksByDeck(r) ?? 'error'); },
      (e) => { if (live) setState('error'); reportError('pitch-studio:checks', e); },
    );
    return () => { live = false; };
  }, [projectId, count]);
  return state;
}

const SELECT = 'min-h-[30px] rounded-[8px] border border-axal-hairline bg-white px-2 font-mono text-[11px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function Versions({ versions, phone, onCompare, checks }) {
  const checkCell = (id) => (checks == null ? '…' : checks === 'error' ? 'Not read' : checksCell(checks.get(Number(id))));
  const [audience, setAudience] = useState('all');
  const [sort, setSort] = useState('newest');
  const options = useMemo(() => audienceOptions(versions), [versions]);
  const rows = useMemo(() => versionRows(versions, { sort, audience }), [versions, sort, audience]);
  return (
    <section className={`${CARD} overflow-hidden`} data-testid="pitch-studio-versions">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className={`text-[14px] font-extrabold ${INK}`}>Versions</span>
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 font-mono text-[11px] text-axal-muted dark:text-gray-400">Audience
            <select className={SELECT} value={audience} onChange={(e) => setAudience(e.target.value)} data-testid="pitch-studio-versions-audience">
              {options.map((o) => <option key={o.id} value={o.id}>{o.t}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 font-mono text-[11px] text-axal-muted dark:text-gray-400">Sort
            <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="pitch-studio-versions-sort">
              {VERSION_SORTS.map((o) => <option key={o.id} value={o.id}>{o.t}</option>)}
            </select>
          </label>
        </span>
      </div>
      {!rows.length ? <p className={`m-0 border-t border-axal-hairline px-4 py-3 dark:border-gray-700 ${MUTED}`} data-testid="pitch-studio-versions-filtered">No version is written for this audience.</p> : null}
      {phone ? (
        <ul className="m-0 list-none border-t border-axal-hairline p-0 dark:border-gray-700">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-[44px] items-center justify-between gap-3 border-b border-axal-hairline px-4 text-[12.5px] last:border-b-0 dark:border-gray-700">
              <span className={INK}><b>{r.label}</b> · {r.title} <span className="text-axal-muted dark:text-gray-400">· {r.audience}</span></span>
              <span className="font-mono text-axal-muted dark:text-gray-400">{r.saved} · {r.links} link{r.links === '1' ? '' : 's'} · {checkCell(r.id)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="bg-axal-ground font-mono text-[9.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
              <th className="px-4 py-2 font-semibold">Version</th>
              <th className="px-4 py-2 font-semibold">Title</th>
              <th className="px-4 py-2 font-semibold">Audience</th>
              <th className="px-4 py-2 font-semibold">Round</th>
              <th className="px-4 py-2 font-semibold">Saved</th>
              <th className="px-4 py-2 font-semibold">By</th>
              <th className="px-4 py-2 font-semibold">Shared links</th>
              <th className="px-4 py-2 font-semibold">Checks</th>
              <th className="px-4 py-2 font-semibold"><span className="sr-only">Compare</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`pitch-studio-version-${r.id}`}>
                <td className={`px-4 py-2.5 font-bold ${INK}`}>{r.label}{r.current ? <span className={`${PILL_VIO} ml-2`}>Current</span> : null}</td>
                <td className={`px-4 py-2.5 ${INK}`}>{r.title}</td>
                <td className={`px-4 py-2.5 ${INK}`}>{r.audience}</td>
                <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{r.round}</td>
                <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{r.saved}</td>
                <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{r.by}</td>
                <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400" data-testid={`pitch-studio-version-links-${r.id}`}>{r.links}</td>
                <td className="px-4 py-2.5 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`pitch-studio-version-checks-${r.id}`}>{checkCell(r.id)}</td>
                <td className="px-4 py-2.5 text-right">
                  {!r.current && onCompare ? (
                    <button type="button" className="text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300" onClick={() => onCompare(r.id)} data-testid={`pitch-studio-compare-${r.id}`}>Compare</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

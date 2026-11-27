/**
 * D9025 (#9025): Network › People, the shared directory of people (D7676, NPD-01, NPD-02, NPD-09, NPD-13,
 * NPD-14), drawn inside the Network workspace shell as its fifth link (owner answer A on #7675, Q1).
 *
 * WHAT IT READS. `GET /api/network/directory/entries?kind=person` for one page of 50 and the true total
 * under the same search; the sheet reads `/entries/:uid` and the viewer's own overlay. Only the
 * Discoverable scope exists on the Worker: My relationships and Team relationships wait on #7674's
 * book-to-person reference and draw as not yet available, never as a count. While people publication is
 * held (#7739), the true answer is an empty directory and the page says so.
 *
 * THE ADDRESS. `/network/people?q=…&c=…` is the list; `/network/people/:uid?q=…&c=…` is the same list with
 * a person's sheet open, so a copied link, Back and a reload all land on the same thing. Closing the sheet
 * returns to the list's address, and the shared `Sheet` returns focus to the row link that opened it (the
 * list stays mounted under the sheet, so the link is still there).
 */
import { useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { DataState } from '../../ui/Honesty.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import {
  CARD, DirectoryPager, DirectorySearchForm, DirectoryTotal, INK, LaterPageFailed, MUTED,
} from './directory/DirectorySearch.jsx';
import PersonSheet from './directory/PersonSheet.jsx';
import { day, focusLine, readListState, writeListState } from './directory/directoryModel.js';
import { useDirectoryPage } from './directory/useDirectoryPage.js';
import { orgPath } from './directory/orgModel.js';
import { networkDirectoryApi } from '../../lib/api/networkDirectory.js';

const NOUN = ['person', 'people'];

function ScopeButtons({ total, state }) {
  const n = state === 'ready' ? total.toLocaleString('en-US') : state === 'error' ? 'Unavailable' : 'Counting…';
  const base = 'inline-flex min-h-[36px] items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-bold max-md:min-h-[44px]';
  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label="Whose people" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed="true" className={`${base} border-axal-violet bg-violet-50 text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200`}>
          Discoverable people <span className="font-mono">{n}</span>
        </button>
        {['My relationships', 'Team relationships'].map((t) => (
          <button key={t} type="button" aria-pressed="false" disabled aria-describedby="people-scope-note"
            className={`${base} cursor-not-allowed border-axal-hairline bg-white text-axal-faint dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500`}>{t}</button>
        ))}
      </div>
      <span id="people-scope-note" className={`text-[11.5px] ${MUTED}`}>My relationships and Team relationships are not linked to directory people yet, so they are not counted here.</span>
    </div>
  );
}

function SourceCell({ entry }) {
  return (
    <span className="flex flex-col">
      <span>{entry.source?.name || 'Source not recorded'}</span>
      {entry.source?.observed_at ? <span className={`font-mono text-[11px] ${MUTED}`}>observed {day(entry.source.observed_at)}</span> : null}
    </span>
  );
}

export default function NetworkPeoplePage({ api = networkDirectoryApi }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { uid } = useParams();
  const phone = usePhoneWidth();
  const { q, stack } = useMemo(() => readListState(location.search), [location.search]);
  const read = useDirectoryPage({ kind: 'person', q, stack, api });

  const go = useCallback((next) => navigate(`/network/people${writeListState(next)}`), [navigate]);
  const listHref = `/network/people${writeListState({ q, stack })}`;
  const personHref = (id) => `/network/people/${encodeURIComponent(id)}${writeListState({ q, stack })}`;

  const closeSheet = useCallback(() => navigate(listHref), [navigate, listHref]);
  const shownStack = read.laterFailed ? (read.shownStack || stack.slice(0, read.page - 1)) : stack;

  const rows = read.rows;
  let results;
  if (read.state === 'loading') {
    results = <DataState state="loading" size="block" />;
  } else if (read.state === 'error') {
    results = (
      <DataState state="unavailable" size="block" announce="always" what="People"
        claim="It is not a claim that the directory is empty." onRetry={read.retry} retryLabel="Try again" data-people-unreadable="" />
    );
  } else if (!rows.length) {
    results = q ? (
      <DataState state="none" size="block" data-people-no-match=""
        action={<button type="button" className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" onClick={() => go({ q: '', stack: [] })}>Clear search</button>}>
        ○ 0 people match “{q}” among the people you can see. Check the spelling or try part of the name.
      </DataState>
    ) : (
      <DataState state="none" size="block" data-people-empty="">
        ○ No people yet. Nobody has been published to the shared directory.
      </DataState>
    );
  } else if (phone) {
    results = (
      <ul className="m-0 flex list-none flex-col p-0" aria-label="People">
        {rows.map((e) => (
          <li key={e.uid} className="border-t border-axal-hairline first:border-t-0 dark:border-gray-800">
            <Link to={personHref(e.uid)} data-person-uid={e.uid}
              className="flex min-h-[44px] flex-col gap-0.5 py-3 [overflow-wrap:anywhere]">
              <h2 className={`m-0 text-[14px] font-bold ${INK}`}>{e.name}</h2>
              <span className={`text-[12px] ${MUTED}`}>{[e.geography || 'Geography not recorded', focusLine(e) || 'Focus not recorded'].join(' · ')}</span>
              <span className={`text-[11.5px] ${MUTED}`}>{e.source?.name || 'Source not recorded'}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  } else {
    results = (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <caption className="sr-only">{`People${q ? ` matching “${q}”` : ''}. ${read.total} results, page ${read.page}.`}</caption>
          <thead><tr className={`text-[11px] uppercase tracking-[.04em] ${MUTED}`}>
            <th scope="col" className="py-2 pr-3 font-bold">Person</th>
            <th scope="col" className="py-2 pr-3 font-bold">Geography</th>
            <th scope="col" className="py-2 pr-3 font-bold">Focus · stage</th>
            <th scope="col" className="py-2 font-bold">Profile source</th>
          </tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.uid} className={`border-t border-axal-hairline align-top dark:border-gray-800 ${e.uid === uid ? 'bg-violet-50/60 dark:bg-violet-950/30' : ''}`}>
              <td className="py-2.5 pr-3">
                <Link to={personHref(e.uid)} data-person-uid={e.uid} className="font-bold text-axal-ink hover:text-axal-violet hover:underline dark:text-gray-100 dark:hover:text-violet-300">{e.name}</Link>
              </td>
              <td className={`py-2.5 pr-3 ${INK}`}>{e.geography || <DataState state="not_recorded" />}</td>
              <td className={`py-2.5 pr-3 ${INK}`}>{focusLine(e) || <DataState state="not_recorded" />}</td>
              <td className={`py-2.5 ${INK}`}><SourceCell entry={e} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-network-people="">
      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="people-find">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="people-find" className={`m-0 text-[16px] font-extrabold ${INK}`}>Find people</h2>
            <p className={`m-0 mt-0.5 text-[12px] ${MUTED}`}>Counts are for people you are allowed to see. Opening someone never makes them your relationship.</p>
          </div>
        </div>
        <ScopeButtons total={read.total} state={read.state} />
        <DirectorySearchForm q={q} onSearch={(term) => go({ q: term, stack: [] })} label="Search people by name" placeholder="Search people by name" />
        <DirectoryTotal state={read.state} total={read.total} q={q} noun={NOUN} />
        {results}
        {read.laterFailed ? <LaterPageFailed page={read.laterFailed} shown={rows.length} onRetry={read.retry} /> : null}
        {read.state === 'ready' && rows.length ? (
          <DirectoryPager page={read.page} shown={rows.length} total={read.total} hasNext={!!read.next && !read.laterFailed}
            onPrev={() => go({ q, stack: shownStack.slice(0, -1) })}
            onNext={() => go({ q, stack: [...shownStack, read.next] })} />
        ) : null}
        <p className={`m-0 text-[11.5px] ${MUTED}`}>The shared directory lists published profiles from named sources. A listing is not a relationship, and nobody is contacted when you open, save or note someone.</p>
      </section>
      {uid ? <PersonSheet uid={uid} onClose={closeSheet} api={api} orgHref={(orgUid) => orgPath(orgUid)} /> : null}
    </div>
  );
}

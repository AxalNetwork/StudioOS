/**
 * D9071 (#9071): Network › Organizations, the shared directory scope (D7680, NPO-01, NPO-15, NPO-17A, NPO-19),
 * people first: each published organization with its distinct published people by affiliation status.
 *
 * WHAT IT READS. `GET /api/network/directory/entries?kind=organization` for one page of 50 and the true total,
 * the same read and the same address rules as People (D9025, `directory/useDirectoryPage.js`), then
 * `GET /organizations/people-counts` for the organizations on that page. Counts read "Counting…" until they
 * answer and "Unavailable" if they fail, never 0; an organization with no published people says
 * "No people recorded". No organization is called a fund: the directory records no type (`orgModel.js`).
 */
import { useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { DataState } from '../../ui/Honesty.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { networkDirectoryApi } from '../../lib/api/networkDirectory.js';
import {
  CARD, DirectoryPager, DirectorySearchForm, DirectoryTotal, INK, LaterPageFailed, MUTED,
} from './directory/DirectorySearch.jsx';
import { day, focusLine, readListState, writeListState } from './directory/directoryModel.js';
import { TYPE_NOT_RECORDED, TYPE_REASON, orgPath, peopleLine } from './directory/orgModel.js';
import { useDirectoryPage } from './directory/useDirectoryPage.js';
import { usePeopleCounts } from './directory/usePeopleCounts.js';

const NOUN = ['organization', 'organizations'];

function People({ count }) {
  const line = peopleLine(count);
  if (line.state === 'loading') return <span className={`text-[12px] ${MUTED}`} data-people-count="loading">Counting…</span>;
  if (line.state === 'unavailable') return <DataState state="unavailable" claim="People could not be counted." data-people-count="unavailable" />;
  if (line.state === 'none') return <span className={`text-[12.5px] ${MUTED}`} data-people-count="0">{line.text}</span>;
  return <span className={`text-[12.5px] font-semibold ${INK}`} data-people-count={count.people}>{line.text}</span>;
}

/** The scope control (NPO-01): the shared directory, the reader's own organizations, and team paths. */
export function OrgScopes({ scope, total, state }) {
  const n = state === 'ready' ? ` · ${Number(total).toLocaleString('en-US')}` : '';
  const base = 'inline-flex min-h-[36px] items-center rounded-[9px] border px-3 text-[12.5px] font-bold max-md:min-h-[44px]';
  const on = `${base} border-axal-violet bg-violet-50 text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200`;
  const off = `${base} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
  return (
    <div className="flex flex-col gap-1">
      <nav aria-label="Scope" className="flex flex-wrap gap-2">
        <Link to="/network/organizations" aria-current={scope === 'shared' ? 'page' : undefined} className={scope === 'shared' ? on : off}>Shared directory{scope === 'shared' ? n : ''}</Link>
        <Link to="/network/organizations?scope=mine" aria-current={scope === 'mine' ? 'page' : undefined} className={scope === 'mine' ? on : off}>My relationships</Link>
        <span aria-disabled="true" aria-describedby="org-scope-note" className={`${base} cursor-not-allowed border-axal-hairline bg-white text-axal-faint dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500`}>Team paths</span>
      </nav>
      <span id="org-scope-note" className={`text-[11.5px] ${MUTED}`}>Team paths are not linked to directory organizations yet, so they are not counted here.</span>
    </div>
  );
}

export default function NetworkOrganizationsDirectory({ api = networkDirectoryApi }) {
  const location = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const { q, stack } = useMemo(() => readListState(location.search), [location.search]);
  const read = useDirectoryPage({ kind: 'organization', q, stack, api });
  const uids = useMemo(() => (read.state === 'ready' ? read.rows.map((o) => o.uid) : []), [read.state, read.rows]);
  const people = usePeopleCounts(uids, api);
  const go = useCallback((next) => navigate(`/network/organizations${writeListState(next)}`), [navigate]);
  const listSearch = writeListState({ q, stack });
  const shownStack = read.laterFailed ? (read.shownStack || stack.slice(0, read.page - 1)) : stack;
  const rows = read.rows;

  let results;
  if (read.state === 'loading') results = <DataState state="loading" size="block" />;
  else if (read.state === 'error') {
    results = <DataState state="unavailable" size="block" announce="always" what="Organizations" claim="It is not a claim that the directory is empty." onRetry={read.retry} retryLabel="Try again" data-orgs-unreadable="" />;
  } else if (!rows.length) {
    results = q
      ? <DataState state="none" size="block" data-orgs-no-match="" action={<button type="button" className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" onClick={() => go({ q: '', stack: [] })}>Clear search</button>}>○ 0 organizations match “{q}”.</DataState>
      : <DataState state="none" size="block" data-orgs-empty="">○ No organizations yet. Nobody has published an organization to the shared directory.</DataState>;
  } else if (phone) {
    results = (
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Organizations">
        {rows.map((o) => (
          <li key={o.uid} className="rounded-[12px] border border-axal-hairline p-3 dark:border-gray-800">
            <Link to={orgPath(o.uid, listSearch)} data-org-uid={o.uid} className="flex min-h-[44px] flex-col gap-0.5 [overflow-wrap:anywhere]">
              <h2 className={`m-0 text-[14px] font-bold ${INK}`}>{o.name}</h2>
              <span className={`text-[12px] ${MUTED}`}>{TYPE_NOT_RECORDED} · {o.geography || 'Geography not recorded'}</span>
              <People count={people.counts[o.uid]} />
            </Link>
          </li>
        ))}
      </ul>
    );
  } else {
    results = (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <caption className="sr-only">{`Organizations${q ? ` matching “${q}”` : ''}. ${read.total} results, page ${read.page}.`}</caption>
          <thead><tr className={`text-[11px] uppercase tracking-[.04em] ${MUTED}`}>
            <th scope="col" className="py-2 pr-3 font-bold">Organization · where it is</th>
            <th scope="col" className="py-2 pr-3 font-bold">People here</th>
            <th scope="col" className="py-2 pr-3 font-bold">Mandate · from the source</th>
            <th scope="col" className="py-2 font-bold">Source · observed</th>
          </tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.uid} className="border-t border-axal-hairline align-top dark:border-gray-800">
              <td className="py-2.5 pr-3">
                <Link to={orgPath(o.uid, listSearch)} data-org-uid={o.uid} className="font-bold text-axal-ink hover:text-axal-violet hover:underline dark:text-gray-100 dark:hover:text-violet-300">{o.name}</Link>
                <span className={`mt-0.5 block text-[11.5px] ${MUTED}`} title={TYPE_REASON}>{TYPE_NOT_RECORDED} · {o.geography || 'geography not recorded'}</span>
              </td>
              <td className="py-2.5 pr-3"><People count={people.counts[o.uid]} /></td>
              <td className={`py-2.5 pr-3 ${INK}`}>{focusLine(o) || <DataState state="not_recorded" />}</td>
              <td className={`py-2.5 ${INK}`}>{o.source?.name || 'Source not recorded'}{o.source?.observed_at ? <span className={`block font-mono text-[11px] ${MUTED}`}>observed {day(o.source.observed_at)}</span> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-network-orgs="">
      <OrgScopes scope="shared" total={read.total} state={read.state} />
      <p className={`m-0 text-[12.5px] ${INK}`}><b>Shared directory</b> lists sourced organizations and the people they name. A listing is not a relationship, and opening one sends nothing.</p>
      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="orgs-all">
        <h2 id="orgs-all" className={`m-0 text-[16px] font-extrabold ${INK}`}>All organizations</h2>
        <DirectorySearchForm q={q} onSearch={(term) => go({ q: term, stack: [] })} label="Search organizations by name" placeholder="Search organizations by name" />
        <DirectoryTotal state={read.state} total={read.total} q={q} noun={NOUN} />
        {people.state === 'error' && rows.length ? (
          <DataState state="unavailable" announce="always" claim="People could not be counted for this page. The organizations are still listed." onRetry={people.retry} retryLabel="Count again" data-counts-unreadable="" />
        ) : null}
        {results}
        {read.laterFailed ? <LaterPageFailed page={read.laterFailed} shown={rows.length} onRetry={read.retry} noun="organizations" /> : null}
        {read.state === 'ready' && rows.length ? (
          <DirectoryPager page={read.page} shown={rows.length} total={read.total} hasNext={!!read.next && !read.laterFailed} noun="organizations"
            onPrev={() => go({ q, stack: shownStack.slice(0, -1) })}
            onNext={() => go({ q, stack: [...shownStack, read.next] })} />
        ) : null}
        <p className={`m-0 text-[11.5px] ${MUTED}`}>People counts are distinct published people; a person listed by several sources counts once. Current, former and status not recorded are counted apart. The directory does not record an organization’s type, so none is called a firm or a fund.</p>
      </section>
    </div>
  );
}

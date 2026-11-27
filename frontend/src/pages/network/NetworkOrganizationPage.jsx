/**
 * D9071 (#9071): one organization in the shared Network directory, people first (D7680, NPO-03, NPO-04, NPO-07,
 * NPO-10, NPO-17B/C/D): its published people grouped current, former and status not recorded, then its identity
 * and the mandate its source gives. `/network/organizations/:uid`; a person opened from here is
 * `/network/organizations/:uid/people/:personUid`, the People sheet (D9025) with this organization as context.
 *
 * WHAT IT READS. `GET /api/network/directory/entries/:uid` (the organization and every published affiliation,
 * not paged) and `GET /organizations/people-counts?uids=:uid` for the counted figures. An organization with no
 * published people says so and offers nothing that would contact anyone. No organization is called a fund.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { DataState } from '../../ui/Honesty.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { networkDirectoryApi } from '../../lib/api/networkDirectory.js';
import { CARD, GHOST, INK, MUTED, PRIMARY } from './directory/DirectorySearch.jsx';
import PersonSheet, { AffiliationStatus } from './directory/PersonSheet.jsx';
import { dateSpan, day, focusLine, verificationWord } from './directory/directoryModel.js';
import {
  ORG_NOT_AVAILABLE, STATUS_FILTERS, TYPE_NOT_RECORDED, TYPE_REASON, filterPeople, orgPath, orgPersonPath, peopleAt, peopleLine,
} from './directory/orgModel.js';
import { usePeopleCounts } from './directory/usePeopleCounts.js';

const REQUEST_NOTE = 'Introduction requests that name a person, with this organization as context, are not open yet.';

function Fact({ label, children }) {
  return <><dt className={`text-[12px] ${MUTED}`}>{label}</dt><dd className={`m-0 min-w-0 text-[12.5px] [overflow-wrap:anywhere] ${INK}`}>{children}</dd></>;
}

export default function NetworkOrganizationPage({ api = networkDirectoryApi }) {
  const { uid, personUid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const [read, setRead] = useState({ state: 'loading', data: null, status: null });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('all');
  const counts = usePeopleCounts(read.state === 'ready' ? [uid] : [], api);

  useEffect(() => {
    let live = true;
    setRead({ state: 'loading', data: null, status: null });
    api.entry(uid).then((data) => { if (live) setRead({ state: 'ready', data, status: null }); },
      (err) => { if (live) setRead({ state: 'failed', data: null, status: err?.status ?? null }); });
    return () => { live = false; };
  }, [uid, attempt, api]);

  const org = read.data?.entry || null;
  const isOrg = org?.kind === 'organization';
  const people = useMemo(() => peopleAt(read.data?.affiliations), [read.data]);
  const shown = filterPeople(people, status);
  const listHref = `/network/organizations${location.search}`;
  const closeSheet = useCallback(() => navigate(orgPath(uid, location.search)), [navigate, uid, location.search]);
  const opened = personUid ? people.find((p) => p.person.uid === personUid) : null;

  const back = <Link to={listHref} className="inline-flex min-h-[36px] items-center text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300 max-md:min-h-[44px]">‹ All organizations</Link>;

  if (read.state === 'loading') return <div className="flex flex-col gap-3" data-org-detail="loading">{back}<DataState state="loading" size="block" /></div>;
  if (read.state === 'failed' || !isOrg) {
    const hidden = read.state !== 'failed' || read.status === 404 || read.status === 400;
    return (
      <div className="flex flex-col gap-3" data-org-detail="failed">
        {back}
        {hidden
          ? <p className={`m-0 rounded-[9px] bg-axal-ground p-3 text-[13px] dark:bg-gray-800/60 ${INK}`} data-org-not-available=""><b>{ORG_NOT_AVAILABLE}</b> The same words are used for every reference that is unpublished, withdrawn or unknown.</p>
          : <DataState state="unavailable" size="block" announce="always" what="This organization" claim="It is not a claim that it is not in the directory." onRetry={() => setAttempt((n) => n + 1)} retryLabel="Try again" />}
      </div>
    );
  }

  const c = counts.counts[uid];
  const line = peopleLine(c);
  const focus = focusLine(org);
  const counted = line.state === 'value' ? line.text : line.state === 'none' ? 'No people recorded' : line.text;

  const peopleBody = people.length ? (
    <>
      <div role="group" aria-label="Affiliation status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(([key, label]) => {
          const n = key === 'all' ? c?.people : c?.[key];
          return (
            <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}
              className={`inline-flex min-h-[32px] items-center rounded-full border px-3 text-[12px] font-bold max-md:min-h-[44px] ${status === key
                ? 'border-axal-violet bg-violet-50 text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200'
                : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
              {label}{Number.isFinite(Number(n)) ? ` · ${n}` : ''}
            </button>
          );
        })}
      </div>
      {!shown.length ? <DataState state="none" size="block">○ Nobody here has that status.</DataState> : phone ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`People at ${org.name}`}>
          {shown.map((a) => (
            <li key={a.person.uid} className="flex flex-col gap-1 rounded-[12px] border border-axal-hairline p-3 dark:border-gray-800">
              <Link to={orgPersonPath(uid, a.person.uid, location.search)} data-person-uid={a.person.uid} className="flex min-h-[44px] flex-col [overflow-wrap:anywhere]">
                <b className={`text-[14px] ${INK}`}>{a.person.name}</b>
                <span className={`text-[12px] ${MUTED}`}>{a.title || 'Role not recorded'}</span>
              </Link>
              <AffiliationStatus a={a} />
              <span className={`text-[11.5px] ${MUTED}`}>{dateSpan(a) || 'Dates not recorded'} · observed {day(a.observed_at) || 'not recorded'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <caption className="sr-only">People at {org.name}</caption>
            <thead><tr className={`text-[11px] uppercase tracking-[.04em] ${MUTED}`}>
              <th scope="col" className="py-2 pr-3 font-bold">Person</th>
              <th scope="col" className="py-2 pr-3 font-bold">Role · status</th>
              <th scope="col" className="py-2 pr-3 font-bold">Dates</th>
              <th scope="col" className="py-2 pr-3 font-bold">Evidence · observed</th>
              <th scope="col" className="py-2 font-bold"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.person.uid} className={`border-t border-axal-hairline align-top dark:border-gray-800 ${a.person.uid === personUid ? 'bg-violet-50/60 dark:bg-violet-950/30' : ''}`}>
                <td className="py-2.5 pr-3"><Link to={orgPersonPath(uid, a.person.uid, location.search)} data-person-uid={a.person.uid} className="font-bold text-axal-ink hover:text-axal-violet hover:underline dark:text-gray-100 dark:hover:text-violet-300">{a.person.name}</Link></td>
                <td className={`py-2.5 pr-3 ${INK}`}>{a.title || 'Role not recorded'}<div className="mt-1"><AffiliationStatus a={a} /></div></td>
                <td className={`py-2.5 pr-3 ${INK}`}>{dateSpan(a) || <DataState state="not_recorded" />}</td>
                <td className={`py-2.5 pr-3 ${INK}`}>{verificationWord(a.verification)}<span className={`block font-mono text-[11px] ${MUTED}`}>observed {day(a.observed_at) || 'not recorded'}</span></td>
                <td className="py-2.5"><Link to={orgPersonPath(uid, a.person.uid, location.search)} className={GHOST} aria-label={`Open ${a.person.name}, ${a.title || 'role not recorded'}, ${org.name}`}>Open</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>Dates are the affiliation’s own. A source observed on a date does not mean the role started then; a missing date reads Not recorded.</p>
    </>
  ) : (
    <div className="flex flex-col gap-2 rounded-[12px] border border-dashed border-axal-hairline p-4 dark:border-gray-700" data-org-no-people="">
      <b className={`text-[13.5px] ${INK}`}>○ No people are recorded at {org.name}.</b>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>The source that brought this organization in names the organization only. An introduction needs a named person, so nobody here is a recipient yet. The organization stays a useful record until a source or a review adds people.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4" data-org-detail={org.uid}>
      {back}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">Organization · shared directory</span>
          <h2 className={`m-0 text-[20px] font-extrabold tracking-[-.01em] [overflow-wrap:anywhere] ${INK}`}>{org.name}</h2>
          <p className={`m-0 mt-0.5 text-[12.5px] ${MUTED}`} data-org-counted={line.state}>{counted}{org.source?.observed_at ? ` · observed ${day(org.source.observed_at)}` : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1 max-md:w-full max-md:items-stretch">
          <button type="button" className={PRIMARY} disabled aria-describedby="org-request-note">Request introduction</button>
          <span id="org-request-note" className={`max-w-[320px] text-[11.5px] ${MUTED}`}>{REQUEST_NOTE}</span>
        </div>
      </header>
      {counts.state === 'error' ? <DataState state="unavailable" announce="always" claim="People could not be counted. The list below is still every published person here." onRetry={counts.retry} retryLabel="Count again" /> : null}
      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="org-people">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="org-people" className={`m-0 text-[15px] font-extrabold ${INK}`}>People</h3>
          <span className={`text-[12px] ${MUTED}`}>{line.state === 'value' ? line.text : line.state === 'none' ? 'None recorded' : line.text}</span>
        </div>
        {peopleBody}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="org-identity">
          <h3 id="org-identity" className={`m-0 text-[15px] font-extrabold ${INK}`}>Identity</h3>
          <dl className="m-0 grid grid-cols-[minmax(104px,auto)_1fr] gap-x-3 gap-y-2">
            <Fact label="Type"><DataState state="not_recorded" reason={TYPE_REASON}>{TYPE_NOT_RECORDED}</DataState></Fact>
            <Fact label="Website">{org.website
              ? <a href={org.website} target="_blank" rel="noopener noreferrer" className="text-axal-violet hover:underline dark:text-violet-300">{org.website.replace(/^https?:\/\//, '')} ↗</a>
              : <DataState state="not_recorded" reason="The source gave none; nothing is filled in from search." />}</Fact>
            <Fact label="Where">{org.geography || <DataState state="not_recorded" />}</Fact>
            <Fact label="Aliases">{Array.isArray(read.data?.aliases) && read.data.aliases.length
              ? read.data.aliases.map((al) => al?.alias || al).filter(Boolean).join(', ')
              : <DataState state="not_recorded" reason="No reviewed alias is recorded." />}</Fact>
            <Fact label="Verification">{verificationWord(org.verification)}</Fact>
            <Fact label="Source">{org.source?.name || 'Source name not recorded'}{org.source?.observed_at ? <span className={MUTED}> · observed <span className="font-mono">{day(org.source.observed_at)}</span></span> : null}</Fact>
          </dl>
        </section>
        <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="org-mandate">
          <h3 id="org-mandate" className={`m-0 text-[15px] font-extrabold ${INK}`}>Mandate · the organization’s</h3>
          <dl className="m-0 grid grid-cols-[minmax(104px,auto)_1fr] gap-x-3 gap-y-2">
            <Fact label="Sectors">{org.sectors?.length ? org.sectors.join(', ') : <DataState state="not_recorded" />}</Fact>
            <Fact label="Stages">{org.stages?.length ? org.stages.join(', ') : <DataState state="not_recorded" />}</Fact>
          </dl>
          <p className={`m-0 text-[11.5px] ${MUTED}`}>{focus ? `From ${org.source?.name || 'the source'}. ` : ''}It belongs to the organization and is not shown on a person unless a source gives it to them.</p>
        </section>
      </div>
      {personUid ? (
        <PersonSheet uid={personUid} onClose={closeSheet} api={api}
          orgHref={(orgUid) => orgPath(orgUid)}
          context={{ name: org.name, title: opened?.title || null, current: opened?.current || null }} />
      ) : null}
    </div>
  );
}

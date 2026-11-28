/**
 * D9025 (#9025): the Person Sheet (D7676 NPD-02, NPD-13C/D): one published directory person read by id
 * from `/api/network/directory/entries/:uid`, the shared profile above and the viewer's own private record
 * below. Opened from People (#9025) and from an organization's people (#9071, which passes `context`, the
 * affiliation it was opened from, as D7680 NPO-07's context bar). The shared profile is the same for every
 * viewer; only `PersonOverlay` depends on who is looking.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { networkDirectoryApi } from '../../../lib/api/networkDirectory.js';
import { Sheet } from '../../../ui';
import { DataState } from '../../../ui/Honesty.jsx';
import { GHOST, INK, MUTED, PRIMARY } from './DirectorySearch.jsx';
import PersonOverlay from './PersonOverlay.jsx';
import {
  AFFILIATION_STATUS, currentLine, dateSpan, day, entryFailure, focusLine, personLink, verificationWord,
} from './directoryModel.js';

const STATUS_CHIP = {
  current: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  former: 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300',
  unknown: 'border-dotted border-gray-400 bg-transparent text-gray-600 dark:border-gray-500 dark:text-gray-400',
};

export function AffiliationStatus({ a }) {
  const key = AFFILIATION_STATUS[a?.current] ? a.current : 'unknown';
  const s = AFFILIATION_STATUS[key];
  const span = key === 'former' ? dateSpan(a) : null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-bold ${STATUS_CHIP[key]}`} data-affiliation-status={key}>
      <span aria-hidden="true">{s.glyph}</span>{s.word}{span ? ` · ${span}` : ''}
    </span>
  );
}

function Fact({ label, children }) {
  return <><dt className={`text-[12px] ${MUTED}`}>{label}</dt><dd className={`m-0 min-w-0 text-[12.5px] [overflow-wrap:anywhere] ${INK}`}>{children}</dd></>;
}

const nr = (reason) => <DataState state="not_recorded" reason={reason} />;

/** The shared profile, as every viewer who can see this person reads it. */
export function SharedProfile({ entry, affiliations, orgHref }) {
  const focus = focusLine(entry);
  return (
    <section aria-label="Shared profile" className="flex flex-col gap-3 rounded-[12px] border border-axal-hairline p-4 dark:border-gray-800" data-shared-profile="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>Shared profile</h3>
        <span className={`text-[11.5px] ${MUTED}`}>Same for everyone who can see {entry.name}</span>
      </div>
      <p className="m-0 rounded-[9px] bg-axal-ground p-3 text-[12.5px] text-axal-ink dark:bg-gray-800/60 dark:text-gray-100" data-sourced-not-verified="">
        <b>A sourced profile.</b> It is not a verified identity, not consent to be contacted, and not an endorsement or due-diligence result.
      </p>
      {affiliations.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left text-[12.5px] max-sm:min-w-0">
            <caption className="sr-only">Affiliations of {entry.name}</caption>
            <thead><tr className={`text-[11px] uppercase tracking-[.04em] ${MUTED}`}>
              <th scope="col" className="py-1.5 pr-2 font-bold">Role · organization</th>
              <th scope="col" className="py-1.5 pr-2 font-bold">Status</th>
              <th scope="col" className="py-1.5 font-bold max-sm:hidden">Observed</th>
            </tr></thead>
            <tbody>{affiliations.map((a, i) => (
              <tr key={`${a.organization?.uid || a.person?.uid || i}-${i}`} className="border-t border-axal-hairline align-top dark:border-gray-800">
                <td className={`py-2 pr-2 ${INK}`}>
                  <b>{a.title || 'Role not recorded'}</b> · {orgHref && a.organization?.uid
                    ? <Link className="font-semibold text-axal-violet hover:underline dark:text-violet-300" to={orgHref(a.organization.uid)}>{a.organization.name}</Link>
                    : (a.organization?.name || a.person?.name)}
                </td>
                <td className="py-2 pr-2"><AffiliationStatus a={a} /></td>
                <td className={`py-2 font-mono text-[11.5px] max-sm:hidden ${MUTED}`}>{day(a.observed_at) || 'Not recorded'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-no-affiliations="">○ No affiliation is recorded for {entry.name}.</p>}
      <dl className="m-0 grid grid-cols-[minmax(104px,auto)_1fr] gap-x-3 gap-y-2">
        <Fact label="Geography">{entry.geography || nr('No source gave a location.')}</Fact>
        <Fact label="Focus">{focus || nr('No source gave sectors or stages.')}</Fact>
        <Fact label="Public links">{entry.profile_url || entry.website
          ? <span className="flex flex-col gap-0.5">{[entry.profile_url, entry.website].filter(Boolean).map((u) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-axal-violet hover:underline dark:text-violet-300">{u.replace(/^https?:\/\//, '')} ↗</a>
          ))}</span>
          : nr()}</Fact>
        <Fact label="Biography">{nr('The directory keeps no biography.')}</Fact>
        <Fact label="Verification">{verificationWord(entry.verification)}</Fact>
        <Fact label="Source">{entry.source?.name || 'Source name not recorded'}{entry.source?.observed_at ? <span className={MUTED}> · observed <span className="font-mono">{day(entry.source.observed_at)}</span></span> : null}</Fact>
      </dl>
    </section>
  );
}

/**
 * `uid` is the person; `onClose` returns to the list (focus goes back to the opener, `returnFocusTo`).
 * `context` is `{ name, title, current }` when opened from an organization (#9071).
 */
export default function PersonSheet({ uid, onClose, returnFocusTo, context = null, orgHref = null, api = networkDirectoryApi }) {
  const [read, setRead] = useState({ state: 'loading', data: null, failure: null });
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let live = true;
    setRead({ state: 'loading', data: null, failure: null });
    api.entry(uid).then((data) => { if (live) setRead({ state: 'ready', data, failure: null }); },
      (err) => { if (live) setRead({ state: 'failed', data: null, failure: entryFailure(err) }); });
    return () => { live = false; };
  }, [uid, attempt, api]);

  const entry = read.data?.entry || null;
  // A person's associations name organizations; anything else is not a person and is not drawn as one.
  const isPerson = entry?.kind === 'person';
  const affiliations = Array.isArray(read.data?.affiliations) ? read.data.affiliations : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(personLink(window.location.origin, uid));
      setCopied('Link copied');
    } catch { setCopied('The link could not be copied.'); }
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className={`mr-auto text-[11.5px] ${MUTED}`} id={`req-${uid}`}>Introductions to people outside Axal are not open yet.</span>
      <button type="button" className={PRIMARY} disabled aria-describedby={`req-${uid}`}>Request introduction</button>
    </div>
  );

  let body;
  if (read.state === 'loading') body = <div className="p-5"><DataState state="loading" size="block" /></div>;
  else if (read.state === 'failed' || !isPerson) {
    const f = read.failure || { kind: 'not_available', text: 'This person is not available to you.' };
    body = (
      <div className="p-5">
        {f.kind === 'unavailable'
          ? <DataState state="unavailable" size="block" announce="always" claim={`${f.text} It is not a claim that they are not in the directory.`} onRetry={() => setAttempt((n) => n + 1)} retryLabel="Try again" />
          : <p className={`m-0 rounded-[9px] bg-axal-ground p-3 text-[13px] dark:bg-gray-800/60 ${INK}`} data-person-not-available=""><b>{f.text}</b> The same words are used for every id that is private, unpublished, removed or unknown.</p>}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 p-5 max-sm:p-4">
        {context ? (
          <p className={`m-0 rounded-[9px] border-l-[3px] border-axal-violet bg-violet-50/50 px-3 py-2 text-[12.5px] dark:border-violet-400 dark:bg-violet-950/30 ${INK}`} data-context-bar="">
            ↳ Opened from <b>{context.name}</b>{context.title ? ` · ${context.title}` : ''}{context.current ? ` · ${(AFFILIATION_STATUS[context.current] || AFFILIATION_STATUS.unknown).word.toLowerCase()}` : ''}. The person is the same from People.
          </p>
        ) : null}
        <SharedProfile entry={entry} affiliations={affiliations} orgHref={orgHref} />
        <PersonOverlay uid={entry.uid} name={entry.name} api={api} />
      </div>
    );
  }

  return (
    <Sheet
      eyebrow="Person · shared directory"
      title={entry && isPerson ? entry.name : 'Person'}
      sub={entry && isPerson ? (currentLine(affiliations) || undefined) : undefined}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      width={640}
      testId="person-sheet"
      headerActions={(
        <>
          <button type="button" onClick={copy} aria-label="Copy link to this person" className={`${GHOST} min-h-[36px] px-2`}>⧉</button>
          <span role="status" aria-live="polite" className="sr-only">{copied}</span>
        </>
      )}
      footer={footer}
    >
      {body}
    </Sheet>
  );
}

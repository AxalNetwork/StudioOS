// D7175 (#7175, canvas D7041, boards RS-13 A2, A3, A5, B1–B3): the subject
// company of a competitor analysis, drawn the same on setup and on results,
// and the run's evidence chip. The subject is read from the company directory
// (`GET /api/research/company-directory/:uid`); a failed read says Unavailable
// with Retry and shows only the name from the link, never a guessed website.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StateChip } from '../../ui/Honesty.jsx';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import { companyHref } from '../../lib/companyDirectoryView.js';
import { EVIDENCE, evidenceLabel, subjectCard } from './companyAnalysisRead';

const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const link = 'font-semibold text-violet-700 underline hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200';

/**
 * One read of the subject's directory record. `uid` null reads nothing (a
 * custom market). The newest read wins; `retry` reads again.
 */
export function useSubjectRecord(uid) {
  const [read, setRead] = useState(() => (uid ? { loading: true } : null));
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!uid) { setRead(null); return; }
    setRead({ loading: true });
    try {
      const data = await researchCompaniesApi.get(uid);
      if (seq.current === mine) setRead({ data });
    } catch (error) {
      if (seq.current === mine) setRead({ error: { status: error?.status ?? null } });
    }
  }, [uid]);
  useEffect(() => { load(); return () => { seq.current += 1; }; }, [load]);
  return { read, retry: load };
}

/** The directory record's source, in the profile's words. */
function sourceWords(card) {
  if (card.source === 'Companies House') return { label: 'Companies House · OGL v3.0', link: 'View the record ↗' };
  return { label: 'Wikidata · CC0', link: 'View the Wikidata record ↗' };
}

/** The website's own state, in words: Not verified until a check is recorded. */
export function WebsiteState({ card }) {
  if (card.websiteStatus === 'not_recorded') return <StateChip kind="not_recorded" />;
  if (card.websiteStatus === 'verified') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 text-[11px] font-bold leading-[1.6] text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300">
        {`Verified${card.verifiedAt ? ` · checked ${String(card.verifiedAt).slice(0, 10)}` : ''}`}
      </span>
    );
  }
  return <StateChip kind="provisional" label="Not verified" />;
}

/** A link to the subject's site, opened in a new tab. */
function Site({ card }) {
  if (!card.website) return null;
  const href = /^https?:\/\//i.test(card.website) ? card.website : `https://${card.website}`;
  return <a href={href} target="_blank" rel="noreferrer" className={link}>{`${card.host || card.website} ↗`}</a>;
}

/**
 * The subject card on setup (RS-13 A2, A3): name and uid, the website with
 * its state, the field source, Change company, and the self-match line. Each
 * state names itself in words.
 */
export function SubjectCard({ read, linkName, onRetry, onChange }) {
  const card = subjectCard(read, linkName);
  return (
    <section aria-label="Subject" data-testid="analysis-subject" data-subject-state={card.state}
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={eyebrow}>Subject · from the directory</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-[17px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{card.name || 'This company'}</span>
            {card.uid ? <span className="font-mono text-[11px] text-axal-muted">{`uid ${card.uid}`}</span> : null}
          </div>
        </div>
        {onChange ? (
          <button type="button" onClick={onChange}
            className="min-h-[44px] rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1.5">
            Change company
          </button>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-[110px_1fr]">
        <dt className="font-semibold text-axal-muted">Website</dt>
        <dd className="flex flex-wrap items-center gap-2 text-axal-ink dark:text-gray-100" aria-live="polite">
          {card.state === 'loading' && <StateChip kind="provisional" label="Loading" />}
          {card.state === 'unavailable' && (
            <>
              <StateChip kind="unavailable" />
              <span className="text-axal-muted">The company record could not be read.</span>
              <button type="button" onClick={onRetry} className={`${link} min-h-[44px] sm:min-h-0`}>Retry</button>
            </>
          )}
          {card.state === 'missing' && (
            <>
              <StateChip kind="not_recorded" label="Not found" />
              <span className="text-axal-muted">This company is not in the directory. Pick another, or run on a custom market.</span>
            </>
          )}
          {card.state === 'ok' && (
            <>
              <Site card={card} />
              <WebsiteState card={card} />
              {card.websiteStatus === 'not_recorded' && (
                <span className="text-axal-muted">{`${card.source || 'The directory'} lists no website for this company. You can run without it.`}</span>
              )}
            </>
          )}
        </dd>
        <dt className="font-semibold text-axal-muted">Field source</dt>
        <dd className="text-axal-muted">
          {card.state === 'ok' ? (
            <>
              {`${sourceWords(card).label}${card.asOf ? ` · as of ${card.asOf}` : ''}`}
              {card.sourceUrl ? <> · <a href={card.sourceUrl} target="_blank" rel="noreferrer" className={link}>{sourceWords(card).link}</a></> : null}
            </>
          ) : card.state === 'loading' ? <span className="inline-block h-3 w-40 rounded bg-gray-200 align-middle dark:bg-gray-700" aria-hidden="true" />
            : 'Name from the link you followed; nothing else is shown until the record is read.'}
        </dd>
      </dl>
      <p className="mt-2 text-[11.5px] text-axal-muted">The subject is never listed as a competitor.</p>
    </section>
  );
}

/** The custom-market subject line (RS-13 A4): no company is the subject. */
export function NoSubject() {
  return (
    <section aria-label="Subject" data-testid="analysis-subject" data-subject-state="none"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-axal-hairline p-3 dark:border-gray-700">
      <p className="text-[12.5px] text-axal-ink dark:text-gray-100">
        <span className="font-bold">Subject</span> <span className="text-axal-muted">None · custom market. Only the market you type is searched.</span>
      </p>
      <Link to="/research/companies" className={`${link} text-[12px]`}>Pick a company from the Directory</Link>
    </section>
  );
}

const EV_CLASS = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300',
  partial: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300',
  insufficient: 'border-[1.5px] border-dashed border-amber-500 bg-white text-amber-900 dark:border-amber-500/60 dark:bg-gray-900 dark:text-amber-200',
  none: 'border-[1.5px] border-dotted border-gray-400 bg-white text-gray-700 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-300',
  unavailable: 'border-[1.5px] border-dashed border-gray-400 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100',
};
const EV_GLYPH = { ok: '✓', partial: '◐', insufficient: '∅', none: '○', unavailable: '!' };

/** The run's evidence status as a chip: a word and a glyph, never colour alone. Null when the run has none. */
export function EvidenceChip({ evidence, short = false }) {
  const e = evidence && EVIDENCE[evidence.status];
  if (!e) return null;
  return (
    <span data-evidence={evidence.status}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 text-[11px] font-bold leading-[1.6] ${EV_CLASS[e.tone]}`}>
      <span aria-hidden="true">{EV_GLYPH[e.tone]}</span>{short ? e.word : evidenceLabel(evidence)}
    </span>
  );
}

/**
 * The subject bar on results and while running (RS-13 A5, B1–B3): the subject
 * and its site, and the evidence status. A custom run says it has no subject.
 */
export function SubjectBar({ uid, read, onRetry, evidence, running }) {
  const card = uid ? subjectCard(read) : null;
  return (
    <div data-testid="analysis-subject-bar"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-axal-hairline bg-white px-4 py-2.5 text-[12px] dark:border-gray-800 dark:bg-gray-900">
      <span className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>Subject</span>
        {!uid && <span className="text-axal-muted">None · custom market</span>}
        {card?.state === 'loading' && <StateChip kind="provisional" label="Loading" />}
        {card?.state === 'unavailable' && (
          <>
            <StateChip kind="unavailable" />
            <button type="button" onClick={onRetry} className={`${link} min-h-[44px] sm:min-h-0`}>Retry</button>
          </>
        )}
        {card?.state === 'missing' && <StateChip kind="not_recorded" label="Not in the directory" />}
        {card?.state === 'ok' && (
          <>
            <Link to={companyHref(card.uid || uid)} className="font-bold text-axal-ink hover:underline dark:text-gray-100">{card.name}</Link>
            {card.website ? <Site card={card} /> : <StateChip kind="not_recorded" label="Website not recorded" />}
            {card.website ? <WebsiteState card={card} /> : null}
          </>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>Evidence</span>
        {running ? <span role="status" className="text-axal-muted">Running · nothing is listed until the run returns</span>
          : evidence ? <EvidenceChip evidence={evidence} /> : <StateChip kind="not_recorded" />}
      </span>
    </div>
  );
}

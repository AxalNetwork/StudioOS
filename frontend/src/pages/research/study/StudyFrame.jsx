/**
 * D7729 (#7729, canvas `design/incoming/Research Markets Market Study Page.dc.html`,
 * D7703-p2 RST-01, RST-12 to RST-15) — the Study tab of a Research Project:
 * `/research/projects/:uid/study` (the study home) and
 * `/research/projects/:uid/study/:section`.
 *
 * THE FRAME. The section list (a phone sheet below 1024px) holds the seven
 * sections in order. The loader is the one glob below: a section whose file is
 * in `sections/` is built and mounted; one whose file is absent is drawn as
 * "Not built yet". A later section adds its file and edits nothing here.
 *
 * THE STUDY READ is its own (`GET /api/research/projects/:uid/study`, D7719),
 * read once here and handed to the section. A failed read is Unavailable with
 * Retry, never "no study"; the other tabs still open. A project with no study,
 * which is every project made before studies, reads None with Start a study,
 * and nothing is saved until Scope is saved. An archived project is read-only.
 *
 * The question, objective, scope and exclusions stay edited on Overview (D5157)
 * and show here read-only, with Edit on Overview.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataState, StateChip } from '../../../ui/Honesty';
import { PhoneSheet, SheetRow } from '../../../ui/phone/PhoneSheet.jsx';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { researchStudiesApi } from '../../../lib/api/researchStudies.js';
import { STUDY_SECTIONS, studyHref, studySections, studyState } from './studyModel.js';
import { ArchivedNote, CARD, FromOverview, H2, MUTED, PRIMARY } from './StudyParts.jsx';

const SECTION_MODULES = import.meta.glob('./sections/*.jsx', { eager: true });
/** The seven sections, each built or not by whether its file exists. */
export const SECTIONS = studySections(SECTION_MODULES);

/** The study read, with Retry and a way for a section to put a saved answer in its place. */
export function useStudyRead(uid) {
  const [read, setRead] = useState({ status: 'loading', value: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', value: r.value }));
    researchStudiesApi.read(uid).then(
      (value) => { if (live) setRead({ status: 'ok', value }); },
      (e) => { if (live) setRead({ status: e?.status === 404 ? 'not_found' : 'failed', value: null, error: e }); },
    );
    return () => { live = false; };
  }, [uid, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback((value) => setRead({ status: 'ok', value }), []);
  return { read, retry, replace };
}

function SectionNav({ uid, current }) {
  return (
    <nav aria-label="Study sections" className="flex flex-col gap-0.5" data-testid="study-sections">
      <Link to={studyHref(uid)} aria-current={current ? undefined : 'page'}
        className={`rounded-lg px-2.5 py-2 text-[12.5px] font-bold ${current ? 'text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800' : 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200'}`}>Study home</Link>
      <h3 className="mt-2 px-2.5 text-[11px] font-extrabold uppercase tracking-wide text-axal-muted dark:text-gray-400">Study sections</h3>
      {SECTIONS.map((s) => {
        const on = s.slug === current;
        return (
          <Link key={s.slug} to={studyHref(uid, s.slug)} aria-current={on ? 'page' : undefined} data-testid={`study-section-${s.slug}`}
            className={`flex min-h-[40px] flex-col justify-center rounded-lg px-2.5 py-1.5 text-[12.5px] ${on ? 'bg-violet-50 font-extrabold text-violet-800 dark:bg-violet-950 dark:text-violet-200' : s.built ? 'font-semibold text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800' : 'font-semibold text-axal-faint hover:bg-axal-ground dark:text-gray-500 dark:hover:bg-gray-800'}`}>
            <span>{s.n} · {s.label}</span>
            {s.built ? null : <small className="text-[11px] font-medium text-axal-muted dark:text-gray-400">Not built yet</small>}
          </Link>
        );
      })}
    </nav>
  );
}

function PhoneSectionPicker({ uid, current }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const here = current ? `${current.n} · ${current.label}` : 'Study home';
  return (
    <>
      <button type="button" ref={opener} aria-haspopup="dialog" aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-axal-hairline bg-white px-3 text-left text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        onClick={() => setOpen(true)} data-testid="button-study-sections">
        <span>{here}</span><span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <PhoneSheet title="Study sections" onClose={close} opener={opener}>
          <SheetRow title="Study home" to={studyHref(uid)} onClose={close} />
          {SECTIONS.map((s) => (
            <SheetRow key={s.slug} title={`${s.n} · ${s.label}`} description={s.built ? null : 'Not built yet'} to={studyHref(uid, s.slug)} onClose={close} />
          ))}
        </PhoneSheet>
      ) : null}
    </>
  );
}

/** RST-01 A: the study home — the Overview texts and the seven sections. */
function StudyHome({ uid, project, data, archived }) {
  const live = Array.isArray(data?.segments) ? data.segments.length : 0;
  const summary = { scope: live ? `${live} ${live === 1 ? 'segment' : 'segments'}` : 'No segment yet' };
  const built = SECTIONS.filter((s) => s.built).length;
  return (
    <>
      <FromOverview project={project} archived={archived} />
      <section className={CARD} aria-labelledby="study-sections-h" data-testid="study-home-sections">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="study-sections-h" className="text-[14px] font-extrabold text-axal-ink dark:text-white">Sections</h3>
          <span className={MUTED}>{SECTIONS.length} sections · {built} built in this release</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {SECTIONS.map((s) => (
            <Link key={s.slug} to={studyHref(uid, s.slug)} data-testid={`study-home-${s.slug}`}
              className="flex min-h-[64px] flex-col gap-1 rounded-lg border border-axal-hairline p-3 hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800">
              <b className="text-[13px] text-axal-ink dark:text-white">{s.n} · {s.label}</b>
              {s.built
                ? <span className={MUTED}>{summary[s.slug] || 'Open'}</span>
                : <StateChip kind="not_applicable" label="Not built yet" className="self-start" />}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

/** RST-01 B: no study yet. */
function NoStudy({ uid, project, archived }) {
  return (
    <>
      <section className={`${CARD} items-start`} data-testid="study-none">
        <DataState state="none">None</DataState>
        <h3 className="text-[17px] font-extrabold text-axal-ink dark:text-white">This project has no study</h3>
        <p className="max-w-[560px] text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">
          Every project made before studies existed reads None here. A study adds a product, segments, questions with evidence for and against, and a decision. Nothing is saved until you save Scope.
        </p>
        {archived
          ? <p className={MUTED}>Restore the project to start a study.</p>
          : <Link className={PRIMARY} to={studyHref(uid, 'scope')} data-testid="button-start-study">Start a study</Link>}
      </section>
      <FromOverview project={project} archived={archived} />
    </>
  );
}

function NotBuilt({ section }) {
  return (
    <section className={`${CARD} items-start`} data-testid={`study-not-built-${section.slug}`}>
      <StateChip kind="not_applicable" label="Not built yet" />
      <p className="text-[13px] text-axal-ink dark:text-gray-100">{section.label} is not built yet. It comes in a later release; the study’s other sections still open.</p>
    </section>
  );
}

/**
 * The Study tab. `project` is the project read's item; the frame reads the
 * study itself. A section's component gets `{ projectUid, project, data,
 * archived, replace, retry }`: `data` is the study read, `replace` puts a saved
 * answer (the Worker's whole study read) in its place, `retry` reads again.
 */
export default function StudyFrame({ project, archived }) {
  const { uid, section: slug } = useParams();
  const projectUid = project?.uid || uid;
  const { read, retry, replace } = useStudyRead(projectUid);
  const phone = usePhoneWidth('(max-width: 1023px)');
  const heading = useRef(null);
  const section = slug ? SECTIONS.find((s) => s.slug === slug) || null : null;
  const state = studyState(read);
  const data = read.value;
  // RST-17: focus lands on the heading of each new view, not on the first one.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus?.();
  }, [slug]);

  let body = null;
  if (slug && !section) {
    body = (
      <section className={CARD} data-testid="study-unknown-section">
        <strong className="text-axal-ink dark:text-white">No such section</strong>
        <p className={MUTED}>A study has seven sections; this address names none of them. <Link className="underline" to={studyHref(projectUid)}>Study home</Link></p>
      </section>
    );
  } else if (state === 'loading' && !data) {
    body = <section className={CARD}><DataState state="loading" size="block" /></section>;
  } else if (state === 'not_found') {
    body = (
      <section className={CARD} data-testid="study-not-found">
        <strong className="text-axal-ink dark:text-white">No such project</strong>
        <p className={MUTED}>This project does not exist, or it is not yours. <Link className="underline" to="/research/projects">My Research</Link></p>
      </section>
    );
  } else if (state === 'unreadable') {
    body = (
      <section className={CARD} data-testid="study-unreadable">
        <DataState state="unavailable" size="block" what="The study" announce="always"
          claim="That is not the same as having no study. The project's other tabs still open." onRetry={retry} retryLabel="Try again" />
      </section>
    );
  } else if (section && !section.built) {
    body = <NotBuilt section={section} />;
  } else if (section) {
    const Section = section.Component;
    body = <Section projectUid={projectUid} project={project} data={data} archived={archived} replace={replace} retry={retry} />;
  } else if (state === 'none') {
    body = <NoStudy uid={projectUid} project={project} archived={archived} />;
  } else {
    body = <StudyHome uid={projectUid} project={project} data={data} archived={archived} />;
  }

  const title = section ? section.label : 'Study';
  return (
    <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]" data-testid="study-frame">
      {phone ? <PhoneSectionPicker uid={projectUid} current={section} /> : <SectionNav uid={projectUid} current={slug || ''} />}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          {/* In a section the section draws its own heading; this one reads as the crumb and takes focus on a new view. */}
          <h2 ref={heading} tabIndex={-1} data-testid="study-heading"
            className={section ? 'text-[12px] font-semibold text-axal-muted outline-none dark:text-gray-400' : `${H2} text-[18px] outline-none`}>
            {section ? <>Study / {title}</> : title}
          </h2>
          {section ? null : <p className={MUTED}>One market, defined once. Open the sections in any order; each saves on its own.</p>}
        </div>
        {archived ? <ArchivedNote /> : null}
        {body}
      </div>
    </div>
  );
}

export { STUDY_SECTIONS };

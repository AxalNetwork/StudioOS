import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cyclesApi, cyclesWrite } from '../../../lib/api/cycles';
import { Lightbox, Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import {
  CHECK_RUNS, FIX_NEWEST_ONLY, HOME_PATH, LINE, NEEDS_NONE, NEW_PATH, NOT_RECORDED, NO_VERSION, SLUG, TABS, TITLE,
  checkRows, checkSummary, chosenVersion, compareView, deleteLine, duplicateSentence, homeFooter, homePart, homeTiles, homeUnreadable,
  needsYou, nextVersion, readByLine, startFromHref, tabHref, tabSearch, versionHref, versionSub, versionsOf,
} from './narrativeModel';
import StoryTab from './StoryTab';
import { NarrativeNotes, NarrativeOtherVenture, NarrativeReads } from './NarrativeAdmin';
import PositioningTab from './PositioningTab';


/**
 * D906 (#2454) — the Investor narrative tool's tab bar and its tab pages.
 * CycleRoute draws Home (the module page) with `NarrativeTabBar` under its
 * header, and draws `NarrativeTabPage` for the tab words under the module.
 * Every figure here comes from a read on `main`; see `narrativeModel.js`.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep';
const SELECT = 'rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PILL = {
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const NOT_SET = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';

/** The tool's own tabs, a second level under the Raise modules: text with an underline. */
export function NarrativeTabBar({ active, search = '', versions = [], version = null }) {
  const navigate = useNavigate();
  const picks = active === 'story' || active === 'check';
  const here = TABS.find((t) => t.id === active) || TABS[0];
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-axal-hairline dark:border-gray-700" data-testid="narrative-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search, t.id === 'story' || t.id === 'check' ? version : null)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`narrative-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {picks && versions.length > 0 && (
        <label className="mb-1.5 flex items-center gap-2">
          <span className={EYEBROW}>Version</span>
          <select aria-label="Version" className={SELECT} value={version ?? ''} data-testid="narrative-version"
            onChange={(e) => navigate(tabHref(here, search, e.target.value))}>
            {versions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/** The saved versions (form-options), and one version's record, each read on its own. */
function useVersions(projectId, reload) {
  const [state, setState] = useState({ status: 'loading', versions: [] });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState({ status: 'loading', versions: [] });
    cyclesWrite.formOptions('raise', projectId, SLUG)
      .then((data) => { if (alive) setState({ status: 'ready', versions: versionsOf(data) }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', versions: [], message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return state;
}

function useVersionRecord(projectId, version, reload) {
  const [state, setState] = useState({ status: 'idle', data: null });
  useEffect(() => {
    if (!projectId || version == null) { setState({ status: 'idle', data: null }); return undefined; }
    let alive = true;
    setState({ status: 'loading', data: null });
    cyclesApi.record('raise', projectId, SLUG, version)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, version, reload]);
  return state;
}

function Skeleton({ testId }) {
  return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={testId} />;
}

function NoVersion({ search, admin }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-3 p-5`} data-testid="narrative-no-version">
      <span className={`text-[13.5px] font-bold ${INK}`}>{NO_VERSION}</span>
      {admin ? null : <Link className={BTN} to={`${NEW_PATH}${tabSearch(search, null, false)}`}>New version</Link>}
    </div>
  );
}

/**
 * Check: the version's consistency check, in the Worker's own words. Home's
 * "Phrase the fix" band phrases the first mismatch of the newest version only,
 * and only while AI assistance is on, so the link is drawn only then.
 */
function CheckTab({ record, search, newest, fixOn }) {
  const rows = checkRows(record);
  const summary = checkSummary(rows);
  const mismatch = rows.some((r) => r.result === 'Mismatch');
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-check">
      <section className={CARD}>
        <div className="flex flex-col gap-1 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Check against the metrics</h2>
          {summary && <span className={`text-[12.5px] font-semibold ${INK}`} data-testid="narrative-check-summary">{summary}</span>}
        </div>
        {rows.length === 0
          ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="narrative-check-none">Nothing compared yet.</p>
          : rows.map((r) => (
            <div key={r.figure} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="narrative-check-row">
              <div className="flex min-w-0 flex-col">
                <span className={`text-[13px] font-semibold ${INK}`}>{r.figure}</span>
                {r.detail && <span className={`text-[12px] ${MUTED}`}>{r.detail}</span>}
              </div>
              <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL[r.tone] || PILL.grey}`}>{r.result}</span>
            </div>
          ))}
      </section>
      <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`}>{CHECK_RUNS}</p>
      {mismatch && fixOn && newest && (
        <Link className={`${LINK} text-[12.5px]`} to={`${HOME_PATH}${tabSearch(search, null, false)}`} data-testid="narrative-check-fix">
          Phrase the fix for the first mismatch with Eadwyn on Home
        </Link>
      )}
      {mismatch && fixOn && !newest && <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="narrative-check-fix-newest">{FIX_NEWEST_ONLY}</p>}
    </div>
  );
}

/** The module read, for its `parts.narrative` (D909): Home draws it from CycleRoute's read; the Versions tab reads it here. */
function useHomeRead(projectId, reload) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    cyclesApi.module('raise', projectId, SLUG)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: 'error', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return state;
}

/** D908's section-by-section compare of two versions. */
function useCompare(projectId, a, b, reload) {
  const [state, setState] = useState({ status: 'idle', rows: [] });
  useEffect(() => {
    if (!projectId || a == null || b == null) { setState({ status: 'idle', rows: [] }); return undefined; }
    let alive = true;
    setState({ status: 'loading', rows: [] });
    cyclesApi.narrativeCompare(projectId, a, b)
      .then((data) => { if (alive) setState({ status: 'ready', rows: compareView(data) }); })
      .catch(() => { if (alive) setState({ status: 'error', rows: [] }); });
    return () => { alive = false; };
  }, [projectId, a, b, reload]);
  return state;
}

const BTN_SECONDARY = 'inline-flex min-h-[36px] w-full items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** Duplicate opens a dialog that says what it creates; nothing in the version changes. */
function DuplicateDialog({ projectId, version, next, onClose, onDone }) {
  const [state, setState] = useState({ busy: false, error: '' });
  const run = () => {
    setState({ busy: true, error: '' });
    cyclesApi.recordAction('raise', projectId, SLUG, version.version, 'duplicate')
      .then(() => { onDone(); onClose(); })
      .catch((e) => setState({ busy: false, error: e?.message || 'The copy was not made.' }));
  };
  return (
    <Lightbox label={`Duplicate v${version.version}`} title={`Duplicate v${version.version}?`} onClose={onClose} width={480} testId="narrative-duplicate-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} disabled={state.busy} onClick={run} data-testid="narrative-duplicate-confirm">Duplicate</button>
        </div>
      )}>
      <p className={`m-0 text-[13px] leading-relaxed ${INK}`}>{duplicateSentence(version, next)}</p>
      {state.error && <p role="alert" className="m-0 mt-2 text-[12.5px] text-red-700 dark:text-red-300">{state.error}</p>}
    </Lightbox>
  );
}

/**
 * Versions (NAR12): every saved version with where it started, two of them
 * side by side through D908's compare, who reads each, and Duplicate or "Make
 * vN the start of a new version". No Delete is drawn.
 */
function VersionsTab({ projectId, versions, search, reload, onChanged, admin = false }) {
  const [a, setA] = useState(() => versions[1]?.value ?? null);
  const [b, setB] = useState(() => versions[0]?.value ?? null);
  const [dup, setDup] = useState(null);
  const read = useHomeRead(projectId, reload);
  const part = homePart(read.data);
  const listed = part?.versions ?? [];
  const cmp = useCompare(projectId, a, b, reload);
  const label = (v) => versions.find((x) => x.value === String(v))?.label || `v${v}`;
  const row = (v) => listed.find((x) => String(x.version) === String(v)) || null;
  const picked = [b, a].filter((v) => v != null).map(row).filter(Boolean);
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[240px_minmax(0,1fr)_280px]" data-testid="narrative-versions">
      <section className={CARD}>
        <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[15px] font-extrabold tracking-[-.015em] dark:border-gray-800 ${INK}`}>Versions</h2>
        {read.status === 'error' || homeUnreadable(read.data)
          ? <div className="px-4 py-3"><Unreadable what="Where each version started" claim="This is not a claim that none are saved." /></div>
          : (
            <ul className="m-0 list-none p-0">
              {versions.map((v) => {
                const r = row(v.value);
                return (
                  <li key={v.value} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800">
                    <Link to={versionHref(v.value, search)} className={`flex min-h-[44px] flex-col justify-center px-4 py-2 hover:bg-axal-ground dark:hover:bg-gray-800`} data-testid="narrative-version-row">
                      <span className={`text-[13px] font-semibold ${INK}`}>{v.label}</span>
                      {r && <span className={`text-[11.5px] ${MUTED}`} data-testid="narrative-version-sub">{versionSub(r)}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </section>
      <section className={CARD} data-testid="narrative-compare">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 mr-auto text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Compare</h2>
          {versions.length > 1 && (
            <>
              <select aria-label="First version" className={SELECT} value={a ?? ''} onChange={(e) => setA(e.target.value)}>
                {versions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
              <span className={`text-[12px] ${MUTED}`}>with</span>
              <select aria-label="Second version" className={SELECT} value={b ?? ''} onChange={(e) => setB(e.target.value)}>
                {versions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </>
          )}
        </div>
        {versions.length < 2
          ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="narrative-compare-one">Save a second version to compare two side by side.</p>
          : cmp.status === 'error'
            ? <div className="px-4 py-3"><Unreadable what="The compare" claim="This is not a claim that the two versions are the same." /></div>
            : cmp.status !== 'ready'
              ? <div className="p-4"><Skeleton testId="narrative-compare-loading" /></div>
              : (
                <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
                  <span className={`hidden px-4 pt-3 lg:block ${EYEBROW}`}>{label(a)}</span>
                  <span className={`hidden px-4 pt-3 lg:block ${EYEBROW}`}>{label(b)}</span>
                  {cmp.rows.map((r) => (
                    <React.Fragment key={r.key}>
                      {[r.a, r.b].map((text, i) => (
                        <div key={i} className={`flex flex-col gap-1 px-4 py-2.5 ${r.changed ? 'lg:border-l-2 lg:border-axal-amber' : ''}`} data-testid={r.changed ? 'narrative-compare-changed' : undefined}>
                          <span className={EYEBROW}>{r.label}<span className="lg:hidden"> · {label(i ? b : a)}</span>{r.changed && i === 0 ? ' · changed' : ''}</span>
                          {text ? <span className={`whitespace-pre-line text-[13px] leading-relaxed ${INK}`}>{text}</span> : <span className={`${NOT_SET} w-fit`}>{NOT_RECORDED}</span>}
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
      </section>
      <div className="flex flex-col gap-3.5">
        <section className={CARD} data-testid="narrative-read-by">
          <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[15px] font-extrabold tracking-[-.015em] dark:border-gray-800 ${INK}`}>Read by</h2>
          {picked.map((r) => (
            <div key={r.version} className="flex flex-col gap-0.5 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800">
              <span className={`text-[13px] font-semibold ${INK}`}>{label(r.version)}</span>
              <span className={`text-[12px] ${MUTED}`}>{readByLine(r)}</span>
              {r.read_by && <Link className={`${LINK} text-[12px]`} to={`/raise/pitch${tabSearch(search, null, false)}`}>Open in Pitch deck studio ›</Link>}
            </div>
          ))}
          {!picked.length && <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`}>{read.status === 'loading' ? 'Reading…' : NOT_RECORDED}</p>}
        </section>
        {!admin && b != null && (
          <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="narrative-actions">
            <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Actions</h2>
            {row(b) && <button type="button" className={BTN_SECONDARY} onClick={() => setDup(row(b))} data-testid="narrative-duplicate">Duplicate v{b}</button>}
            {a != null && a !== b && <Link className={BTN_SECONDARY} to={startFromHref(a, search)} data-testid="narrative-start-from">Make v{a} the start of a new version</Link>}
            {picked.map(deleteLine).filter(Boolean).map((line) => <p key={line} className={`m-0 text-[12px] ${MUTED}`}>{line}</p>)}
          </section>
        )}
      </div>
      {!admin && dup && <DuplicateDialog projectId={projectId} version={dup} next={nextVersion(versions)} onClose={() => setDup(null)} onDone={onChanged} />}
    </div>
  );
}

/**
 * Home's own parts (NAR1), under the module page's card and table: the four
 * tiles, "Needs you" and the footer, from the module read's `parts.narrative`.
 * CycleRoute draws it as the module's part (D909); it reads nothing itself.
 */
export function NarrativeHome({ data, search }) {
  // The module page's address: the venture is kept on Needs you's links.
  const here = useLocation().search;
  if (homeUnreadable(data)) {
    return <div className={`${CARD} p-4`} data-testid="narrative-home-unreadable"><Unreadable what="Your narrative versions" claim="This is not a claim that none are saved." /></div>;
  }
  const part = homePart(data);
  if (!part) return null;
  const needs = needsYou(part, search ?? here);
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-home">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {homeTiles(part).map((t) => (
          <div key={t.key} className={`${CARD} flex flex-col gap-1 px-3.5 py-3`} data-testid={`narrative-tile-${t.key}`}>
            <span className={EYEBROW}>{t.label}</span>
            <span className={`font-mono text-[22px] font-extrabold ${t.waits ? MUTED : INK}`}>{t.value}</span>
            <span className={`text-[11.5px] leading-snug ${MUTED}`}>{t.sub}</span>
          </div>
        ))}
      </div>
      <section className={CARD} data-testid="narrative-needs-you">
        <div className="flex items-baseline justify-between border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Needs you</h2>
          <span className={`font-mono text-[12px] ${MUTED}`}>{needs.length}</span>
        </div>
        {needs.length === 0
          ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`}>{NEEDS_NONE}</p>
          : needs.map((n) => (
            <div key={n.key} className="flex flex-wrap items-start justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="narrative-needs-row">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL.bad}`}>{n.pill}</span>
                  <span className={`text-[13px] font-semibold ${INK}`}>{n.title}</span>
                </span>
                <span className={`text-[12px] ${MUTED}`}>{n.sub}</span>
              </div>
              <Link className={`${LINK} text-[12px]`} to={n.href}>Open the check ›</Link>
            </div>
          ))}
      </section>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="narrative-home-footer">{homeFooter(part)}</p>
    </div>
  );
}

/**
 * One tab of the tool, under the Raise header and the tool's tab bar.
 * `cards` are the Raise modules for the header's rail; `action` is Call for
 * Capital, as on every Raise module page.
 */
export function NarrativeTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, fixOn = true, search = '', cards, action, phone = false, admin = false }) {
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const list = useVersions(projectId, reload);
  const wanted = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('version');
  const version = chosenVersion(list.versions, wanted);
  // Story reads the narrative's own stores (D910, StoryTab); Check reads the version's record.
  const needsRecord = tab === 'check';
  const record = useVersionRecord(projectId, needsRecord ? version : null, reload);
  const here = TABS.find((t) => t.id === tab) || TABS[0];

  let body;
  // No venture means no versions read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (list.status === 'loading') body = <Skeleton testId="narrative-loading" />;
  // D914, NAR14b: the Worker refuses another venture's narrative; an admin's refusal is the reason gate's, above this page.
  else if (list.status === 'refused') body = admin
    ? <p role="status" className={`m-0 text-[13px] ${INK}`} data-testid="narrative-refused">{list.message || 'You do not have access to this venture’s narrative.'}</p>
    : <NarrativeOtherVenture />;
  else if (list.status === 'error') body = <Unreadable what="Your narrative versions" claim="This is not a claim that none are saved." onRetry={retry} />;
  // Positioning may be read without a saved narrative version; admin controls remain read only.
  else if (tab === 'positioning') body = <PositioningTab projectId={projectId} version={version} readOnly={admin} />;
  else if (!list.versions.length) body = <NoVersion search={search} admin={admin} />;

  else if (tab === 'versions') body = <VersionsTab key={list.versions.map((v) => v.value).join(',')} projectId={projectId} versions={list.versions} search={search} reload={reload} onChanged={retry} admin={admin} />;
  else if (tab === 'story') body = (
    <>
      <StoryTab key={version} projectId={projectId} version={version} search={search} phone={phone} readOnly={admin} aiOn={fixOn} />
      <NarrativeNotes projectId={projectId} version={version} admin={admin} />
      {admin ? null : <NarrativeReads projectId={projectId} />}
    </>
  );
  else if (record.status === 'loading' || record.status === 'idle') body = <Skeleton testId="narrative-loading" />;
  else if (record.status === 'refused') body = <p className={`m-0 text-[13px] ${INK}`}>{record.message || 'This version could not be opened.'}</p>;
  else if (record.status === 'error') body = <Unreadable what={`Version ${version}`} claim="This is not a claim that it is empty." onRetry={retry} />;
  else body = <CheckTab record={record.data} search={search} newest={version === list.versions[0]?.value} fixOn={fixOn && !admin} />;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`narrative-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search, null, false)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search, null, false)} />}
      <NarrativeTabBar active={tab} search={search} versions={list.versions} version={version} />
      {body}
    </div>
  );
}

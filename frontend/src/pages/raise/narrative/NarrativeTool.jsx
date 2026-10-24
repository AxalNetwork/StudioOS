import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cyclesApi, cyclesWrite } from '../../../lib/api/cycles';
import { Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import {
  CHECK_RUNS, HOME_PATH, LINE, NEW_PATH, NOT_RECORDED, NO_VERSION, POSITIONING_WAITS, SLUG, TABS, TITLE, WAITING_SECTIONS,
  checkRows, checkSummary, chosenVersion, compareRows, positioningHref, previousVersion, storyRows, tabHref, tabSearch,
  versionHref, versionsOf,
} from './narrativeModel';

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
      .catch(() => { if (alive) setState({ status: 'error', versions: [] }); });
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

function NoVersion({ search }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-3 p-5`} data-testid="narrative-no-version">
      <span className={`text-[13.5px] font-bold ${INK}`}>{NO_VERSION}</span>
      <Link className={BTN} to={`${NEW_PATH}${tabSearch(search, null, false)}`}>New version</Link>
    </div>
  );
}

/** Story: one version's words, section by section, as its record states them. */
function StoryTab({ record, version, search }) {
  const rows = storyRows(record);
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-story">
      {rows.map((r) => (
        <section key={r.label} className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`}>
          <h2 className={`m-0 text-[13.5px] font-extrabold tracking-[-.01em] ${INK}`}>{r.label}</h2>
          {r.text
            ? <p className={`m-0 whitespace-pre-line text-[13px] leading-relaxed ${INK}`}>{r.text}</p>
            : <span className={`${NOT_SET} w-fit`}>{NOT_RECORDED}</span>}
        </section>
      ))}
      <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`} data-testid="narrative-story-waiting">
        {WAITING_SECTIONS.join(', ')}: these sections are stored once the Investor narrative keeps its own sections.
        One-liner, Why now and The ask are edited on the version’s page.
      </p>
      <Link className={`${LINK} text-[12.5px]`} to={versionHref(version, search)} data-testid="narrative-story-open">Open v{version} to edit it</Link>
    </div>
  );
}

/** Check: the version's consistency check, in the Worker's own words. */
function CheckTab({ record, search }) {
  const rows = checkRows(record);
  const summary = checkSummary(rows);
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-check">
      <section className={CARD}>
        <div className="flex flex-col gap-1 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Check against the metrics</h2>
          {summary && <span className={`text-[12.5px] font-semibold ${INK}`} data-testid="narrative-check-summary">{summary}</span>}
        </div>
        {rows.length === 0
          ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`}>Nothing compared yet.</p>
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
      <Link className={`${LINK} text-[12.5px]`} to={`${HOME_PATH}${tabSearch(search, null, false)}`} data-testid="narrative-check-fix">
        Phrase a fix with Eadwyn on Home
      </Link>
    </div>
  );
}

/** Versions: every saved version, and two of them side by side. */
function VersionsTab({ projectId, versions, search, reload }) {
  const [a, setA] = useState(() => versions[0]?.value ?? null);
  const [b, setB] = useState(() => previousVersion(versions, versions[0]?.value) ?? null);
  const left = useVersionRecord(projectId, a, reload);
  const right = useVersionRecord(projectId, b, reload);
  const rows = left.status === 'ready' && right.status === 'ready' ? compareRows(left.data, right.data) : [];
  const label = (v) => versions.find((x) => x.value === v)?.label || `v${v}`;
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-versions">
      <section className={CARD}>
        <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[15px] font-extrabold tracking-[-.015em] dark:border-gray-800 ${INK}`}>Versions</h2>
        <ul className="m-0 list-none p-0">
          {versions.map((v) => (
            <li key={v.value} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800">
              <Link to={versionHref(v.value, search)} className={`flex min-h-[44px] items-center px-4 text-[13px] font-semibold ${INK} hover:bg-axal-ground dark:hover:bg-gray-800`}>{v.label}</Link>
            </li>
          ))}
        </ul>
      </section>
      {versions.length > 1 && (
        <section className={CARD} data-testid="narrative-compare">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
            <h2 className={`m-0 mr-auto text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Compare</h2>
            <select aria-label="First version" className={SELECT} value={a ?? ''} onChange={(e) => setA(e.target.value)}>
              {versions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <span className={`text-[12px] ${MUTED}`}>with</span>
            <select aria-label="Second version" className={SELECT} value={b ?? ''} onChange={(e) => setB(e.target.value)}>
              {versions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          {(left.status === 'error' || right.status === 'error' || left.status === 'refused' || right.status === 'refused')
            ? <div className="px-4 py-3"><Unreadable what="A version" claim="This is not a claim that the two versions are the same." /></div>
            : rows.length === 0
              ? <div className="p-4"><Skeleton testId="narrative-compare-loading" /></div>
              : (
                <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
                  <span className={`hidden px-4 pt-3 lg:block ${EYEBROW}`}>{label(a)}</span>
                  <span className={`hidden px-4 pt-3 lg:block ${EYEBROW}`}>{label(b)}</span>
                  {rows.map((r) => (
                    <React.Fragment key={r.label}>
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
      )}
    </div>
  );
}

function PositioningTab({ search }) {
  return (
    <section className={`${CARD} flex flex-col items-start gap-3 p-5`} data-testid="narrative-positioning">
      <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Positioning</h2>
      <p className={`m-0 text-[13px] leading-relaxed ${INK}`}>{POSITIONING_WAITS}</p>
      <Link className={BTN} to={positioningHref(search)} data-testid="narrative-positioning-open">Open positioning</Link>
    </section>
  );
}

/**
 * One tab of the tool, under the Raise header and the tool's tab bar.
 * `cards` are the Raise modules for the header's rail; `action` is Call for
 * Capital, as on every Raise module page.
 */
export function NarrativeTabPage({ tab, projectId, search = '', cards, action, phone = false }) {
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const list = useVersions(projectId, reload);
  const wanted = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('version');
  const version = chosenVersion(list.versions, wanted);
  const needsRecord = tab === 'story' || tab === 'check';
  const record = useVersionRecord(projectId, needsRecord ? version : null, reload);
  const here = TABS.find((t) => t.id === tab) || TABS[0];

  let body;
  if (tab === 'positioning') body = <PositioningTab search={search} />;
  else if (list.status === 'loading') body = <Skeleton testId="narrative-loading" />;
  else if (list.status === 'error') body = <Unreadable what="Your narrative versions" claim="This is not a claim that none are saved." onRetry={retry} />;
  else if (!list.versions.length) body = <NoVersion search={search} />;
  else if (tab === 'versions') body = <VersionsTab key={list.versions.map((v) => v.value).join(',')} projectId={projectId} versions={list.versions} search={search} reload={reload} />;
  else if (record.status === 'loading' || record.status === 'idle') body = <Skeleton testId="narrative-loading" />;
  else if (record.status === 'refused') body = <p className={`m-0 text-[13px] ${INK}`}>{record.message || 'This version could not be opened.'}</p>;
  else if (record.status === 'error') body = <Unreadable what={`Version ${version}`} claim="This is not a claim that it is empty." onRetry={retry} />;
  else body = tab === 'story' ? <StoryTab record={record.data} version={version} search={search} /> : <CheckTab record={record.data} search={search} />;

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

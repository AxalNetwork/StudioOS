/**
 * D5078 (#5078; Build v2 boards BD20 A, B and C, BD12, BD24 B) — Operating
 * systems as one founder workspace in three sections: Systems (the company's
 * bank, accounting, payroll, CRM and workspace), Cadence (the weekly rhythm)
 * and Tools (what feeds Build). It is the module's `homes` entry
 * (`defs/build.jsx`), drawn in place of the generic chart and records table.
 *
 *   - No company yet (BD20 A, BD24 B): one prerequisite, "Company not linked
 *     yet", with Go to Company Creation; no system rows and no Not recorded
 *     facts until a company exists.
 *   - Systems (BD20 B): one state per row drives its one line and its one
 *     action (Connected → Manage, Failing or Reconnect required → Reconnect,
 *     Not connected → Connect), from `parts.systems`. Reconnect is the
 *     connection owner's; anyone else reads who owns it, where the Tools
 *     privacy rule lets them.
 *   - Cadence (BD20 C): the one entry to the operating cadence
 *     (`/build/cadence`, the existing workflow and its store), its rituals as
 *     that workflow reads them, then the Monday plan, retro and annotation
 *     drafts (`OsCadenceBands`). No second store and no second cadence screen.
 *   - Tools (BD12): the module's connector parts (`sources`, the Sources region
 *     as the page builds it), which no longer compete with system setup.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DataState } from '../../ui/Honesty.jsx';
import { api } from '../../lib/api';
import { dayLabel, kindLabel, scheduleLabel } from '../../lib/cadence';
import {
  OS_SECTIONS, RUN_WORD, cadenceHref, cadenceView, companyCreationHref, companyMissing, sectionOf, systemRowView, systemsSummaryText, ventureQuery,
} from './operatingSystemsModel.js';
import { accountOnlyText } from './codeSystem.js';

/**
 * D8774 (#8774, BLS08 A): where a venture with no company is linked to one inside
 * Build: Connect a tool opens its link dialog for the owner (`link=company`) and
 * names the owner to anyone else, and the setup carries on there.
 */
export function linkCompanyHref(search = '') {
  const q = ventureQuery(search);
  return `/build/connect${q ? `${q}&` : '?'}link=company`;
}

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-violet-700 px-4 text-[13px] font-bold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-violet-deep hover:bg-axal-lavender dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-violet-900/30';
const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

/** The three sections as links: each keeps the venture and names its section in the hash. */
export function OsTabs({ section, search = '', phone = false }) {
  return (
    <nav aria-label="Operating systems" className="flex min-w-0 gap-1 border-b border-axal-hairline dark:border-gray-800" data-testid="os-tabs">
      {OS_SECTIONS.map((s) => (
        <Link key={s.key} to={{ search, hash: `#${s.key}` }} aria-current={s.key === section ? 'page' : undefined} data-testid={`os-tab-${s.key}`}
          className={`-mb-px inline-flex min-h-[44px] items-center border-b-2 px-3 text-[13px] font-bold ${phone ? 'flex-1 justify-center' : ''} ${s.key === section
            ? 'border-violet-700 text-axal-ink dark:border-violet-400 dark:text-gray-100'
            : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>
          {s.name}
        </Link>
      ))}
    </nav>
  );
}

/** BD20 A and BD24 B: the one step first. Systems and tools connect to a company, so nothing is listed before it. */
export function CompanyNotLinked({ search = '', phone = false, what = 'systems', code = null }) {
  const account = what === 'tools' ? accountOnlyText(code) : null;
  return (
    <section className={CARD} aria-labelledby="os-no-company-title" data-testid="os-no-company">
      <span className="text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">One step first</span>
      <h2 id="os-no-company-title" className={H2}>Company not linked yet</h2>
      <p className="m-0 text-[13px] leading-relaxed text-axal-ink/80 dark:text-gray-300">
        {what === 'tools'
          ? 'Tools connect to a company, too. They appear here after this venture has a company.'
          : 'Core company systems become available after this venture has a company.'}
      </p>
      {account && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="os-no-company-account">{account}</p>}
      <div className={`flex gap-2 ${phone ? 'flex-col' : 'flex-wrap'}`}>
        <Link to={companyCreationHref(search)} className={`${PRIMARY} ${phone ? 'w-full' : 'self-start'}`} data-testid="os-no-company-go">Go to Company Creation →</Link>
        {/* D8774: a venture whose owner already has a company is linked to it in Build, not re-formed. */}
        <Link to={linkCompanyHref(search)} className={`${SECONDARY} ${phone ? 'w-full' : 'self-start'}`} data-testid="os-no-company-link">Link to a company you have</Link>
      </div>
      {what === 'systems' && (
        <p className="m-0 text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="os-no-company-preview">Bank, Accounting, Payroll, CRM and Workspace appear here, each with Connect, once it is linked.</p>
      )}
    </section>
  );
}

/** BD20 B: the five systems, one state each, its line and its one action. */
export function SystemsList({ systems, phone = false }) {
  const rows = (Array.isArray(systems?.rows) ? systems.rows : []).map(systemRowView);
  const summary = systemsSummaryText(systems?.summary);
  return (
    <section className={CARD} aria-labelledby="os-systems-title" data-testid="os-systems">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="os-systems-title" className={H2}>Systems</h2>
        {summary && <span className="text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="os-systems-summary">{summary}</span>}
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.kind} data-testid={`os-system-${r.kind}`} data-state={r.state}
            className={phone
              ? 'flex min-w-0 flex-col gap-1.5 border-b border-axal-ground py-3 last:border-b-0 dark:border-gray-800'
              : 'grid min-w-0 grid-cols-[110px_minmax(0,150px)_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-axal-ground py-2.5 last:border-b-0 dark:border-gray-800'}>
            <div className={phone ? 'flex items-baseline justify-between gap-2' : 'contents'}>
              <b className="text-[13px] text-axal-ink dark:text-gray-100">{r.label}</b>
              {phone && <StateTag view={r} />}
            </div>
            <span className="min-w-0 truncate text-[12.5px] text-axal-ink/80 dark:text-gray-300">{r.provider || <span className="text-axal-faint dark:text-gray-500">No provider yet</span>}</span>
            {!phone && <StateTag view={r} />}
            <span className="flex min-w-0 flex-col gap-0.5 text-[12px] text-axal-muted dark:text-gray-400">
              <span data-testid={`os-system-line-${r.kind}`}>{r.line}</span>
              {r.why && <span className="text-red-700 dark:text-red-300" data-testid={`os-system-why-${r.kind}`}>{r.why}</span>}
              {r.owner && r.owner !== 'You' && <span data-testid={`os-system-owner-${r.kind}`}>Connected by {r.owner}</span>}
            </span>
            {r.action
              ? <Link to={r.action.href} className={`${r.action.primary ? PRIMARY : SECONDARY} ${phone ? 'w-full' : ''}`} data-testid={`os-system-action-${r.kind}`}>{r.action.text}</Link>
              : <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`os-system-reason-${r.kind}`}>{r.reason || ''}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StateTag({ view }) {
  return <span className={`justify-self-start whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE[view.tone]}`}>{view.word}</span>;
}

/** BD20 C: the rituals the cadence workflow holds, each with its last filed run. */
export function CadenceRituals({ view, onRetry, phone = false }) {
  if (view.state === 'loading') return <DataState state="loading" size="block" />;
  if (view.state === 'unavailable') {
    return <DataState state="unavailable" what="Your rituals" claim="The cadence itself is not affected." onRetry={onRetry} size="block" />;
  }
  if (view.state === 'not_recorded') return <DataState state="not_recorded" reason="The cadence store is not set up yet." size="block" />;
  if (view.state === 'empty') return <p className={MUTED} data-testid="os-cadence-empty">No ritual is set up yet. Add your Monday plan, weekly review or Friday retro in the operating cadence.</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="os-cadence-rituals">
      {view.rituals.map((r) => (
        <li key={r.id} className={`flex min-w-0 gap-x-3 gap-y-0.5 border-b border-axal-ground py-2 last:border-b-0 dark:border-gray-800 ${phone ? 'flex-col' : 'flex-wrap items-baseline justify-between'}`} data-testid={`os-cadence-ritual-${r.id}`}>
          <span className="flex min-w-0 flex-col">
            <b className="text-[13px] text-axal-ink dark:text-gray-100">{r.name}</b>
            <small className="text-[11.5px] text-axal-muted dark:text-gray-400">{kindLabel(r.kind)} · {scheduleLabel(r)}</small>
          </span>
          <span className="text-[12px] text-axal-ink/80 dark:text-gray-300">
            {r.last ? `Last: ${dayLabel(r.last.run_date)} · ${RUN_WORD[r.last.state] || 'Not recorded'}` : 'No run filed yet'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CadenceSection({ projectId, search, phone }) {
  const [view, setView] = useState({ state: 'loading', rituals: [] });
  const load = useCallback(() => {
    if (!projectId) return undefined;
    let live = true;
    setView({ state: 'loading', rituals: [] });
    api.getCadence(projectId).then((read) => { if (live) setView(cadenceView(read)); }, () => { if (live) setView({ state: 'unavailable', rituals: [] }); });
    return () => { live = false; };
  }, [projectId]);
  useEffect(() => load(), [load]);
  return <CadenceView view={view} onRetry={load} search={search} phone={phone} />;
}

/** BD20 C: the one entry, then the rituals. The drafts follow, from the page's bands (`OsCadenceBands`). */
export function CadenceView({ view, onRetry, search = '', phone = false }) {
  return (
    <section className={CARD} aria-labelledby="os-cadence-title" data-testid="os-cadence">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="os-cadence-title" className={H2}>Operating cadence</h2>
        <Link to={cadenceHref(search)} className={`${PRIMARY} ${phone ? 'w-full' : ''}`} data-testid="os-cadence-open">Open the operating cadence →</Link>
      </div>
      <p className={MUTED}>The one home of the Monday plan, the weekly review, the Friday retro and metric annotations. Rituals and reviews are filed in the operating cadence.</p>
      <CadenceRituals view={view} onRetry={onRetry} phone={phone} />
    </section>
  );
}

/** BD12 inside Operating systems: what feeds Build, and where company systems live instead. */
export function ToolsSection({ sources, search = '' }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="os-tools">
      <p className="m-0 rounded-xl border border-axal-hairline bg-axal-ground/60 px-4 py-3 text-[12.5px] text-axal-ink/80 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-300">
        These are the tools that feed Build with evidence. Company systems (bank, accounting, payroll, CRM, workspace) live in{' '}
        <Link to={{ search, hash: '#systems' }} className="font-bold text-axal-violet-deep hover:underline dark:text-violet-300">Systems</Link>.
      </p>
      {sources}
    </div>
  );
}

/** The section's body, drawn from the module read (`data`) once the address names a section. */
export function OperatingSystemsView({ section, data, projectId, search = '', phone = false, sources = null, onRetry }) {
  const tabs = <OsTabs section={section} search={search} phone={phone} />;
  const wrap = (body) => <div className="flex min-w-0 flex-col gap-4" data-testid="os-home" data-section={section}>{tabs}{body}</div>;
  if (section === 'cadence') return wrap(<CadenceSection projectId={projectId} search={search} phone={phone} />);
  if (!data) return wrap(<DataState state="loading" size="block" />);
  if (data?.card?.state === 'unreadable') {
    return wrap(<DataState state="unavailable" what="Operating systems" claim="This is not a claim that nothing is connected." onRetry={onRetry} size="block" />);
  }
  if (companyMissing(data)) return wrap(<CompanyNotLinked search={search} phone={phone} what={section === 'tools' ? 'tools' : 'systems'} code={data?.parts?.tools?.code} />);
  if (section === 'tools') return wrap(<ToolsSection sources={sources} search={search} />);
  if (!data?.parts?.systems) return wrap(<DataState state="unavailable" what="Systems" claim="This is not a claim that nothing is connected." onRetry={onRetry} size="block" />);
  return wrap(<SystemsList systems={data.parts.systems} phone={phone} />);
}

export default function OperatingSystemsHome(props) {
  const location = useLocation();
  return <OperatingSystemsView {...props} section={sectionOf(location.hash)} search={props.search ?? location.search} />;
}

/** The page's Eadwyn bands (the Monday plan, the retro summary, the annotation) belong to Cadence only. */
export function OsCadenceBands({ children }) {
  const location = useLocation();
  if (sectionOf(location.hash) !== 'cadence') return null;
  return <section className="flex min-w-0 flex-col gap-3" aria-label="Eadwyn drafts for the weekly rhythm" data-testid="os-cadence-drafts">{children}</section>;
}

/**
 * D696: unmounted record body. The route owns reads, forms, confirms and errors.
 * Reusable parts also serve Customer research (#1659) and phone layout (#1665).
 */
import { isPlainClick } from './cycleModel.js';
import { declaredActions, dispatchOf, pillView, rowAction, rowView, sectionId, toneOf } from './recordModel.js';

// Same NR class as CycleModulePage. PR 2 imports its export after its owners merge.
const NR = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';
const PILL = {
  v1: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  v2: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  v3: 'border-axal-lavender-edge bg-white text-axal-violet-deep dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const BUTTON = {
  default: 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
  primary: 'border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-600 dark:text-white',
  danger: 'border-red-300 bg-white text-red-700 dark:border-red-800 dark:bg-gray-900 dark:text-red-300',
};
const CARD = 'scroll-mt-4 overflow-hidden rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const QUIET = 'text-xs font-bold text-axal-violet dark:text-violet-300 hover:underline';
const text = (value) => value == null ? '' : String(value);

function Status({ value, tone }) {
  const style = PILL[toneOf(tone)];
  return style ? <span className={'inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ' + style}>{text(value)}</span> : <span>{text(value)}</span>;
}

function RecordAction({ action, quiet = false, onLink, onForm, onWrite, onClient }) {
  const kind = dispatchOf(action);
  if (!kind) return null;
  const className = quiet ? QUIET : 'inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-bold ' + (BUTTON[action.tone] || BUTTON.default);
  if (kind === 'link' || kind === 'mailto') {
    return <a href={action.href} className={className} onClick={(event) => {
      if (onLink && isPlainClick(event)) { event.preventDefault(); onLink(action); }
    }}>{action.label}</a>;
  }
  const run = kind === 'form' ? onForm : kind === 'write' ? onWrite : onClient;
  return <button type="button" className={className} disabled={!run} onClick={() => run?.(action)}>{action.label}</button>;
}

export function RecordActions({ actions = [], ...handlers }) {
  return <div className="flex flex-wrap items-center gap-1.5" data-testid="record-actions">
    {actions.map((action) => <RecordAction key={action.key} action={action} {...handlers} />)}
  </div>;
}

export function RecordFacts({ facts = [] }) {
  return <div className="grid grid-cols-1 gap-2.5 @[760px]/cycle:grid-cols-4" data-testid="record-facts">
    {facts.map((fact, index) => <div key={index} className="flex min-w-0 flex-col gap-1 rounded-xl border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-axal-muted dark:text-gray-400">{fact.label}</div>
      {fact.value == null ? <div><span className={NR}>Not recorded</span>
        {fact.reason && <p className="mt-1 text-[11.5px] text-axal-muted dark:text-gray-400">{fact.reason}</p>}
      </div> : <div className="break-words text-[15px] font-bold text-axal-ink dark:text-gray-100">{text(fact.value)}</div>}
    </div>)}
  </div>;
}

export function RecordSection({ section, side = false, cycleName, moduleName, declarations = new Map(), ...handlers }) {
  const action = typeof section.action === 'object' ? section.action : rowAction(section.action, declarations);
  const rows = section.rows ?? [];
  return <section id={sectionId(cycleName, moduleName, section.title)} className={CARD}>
    <header className="flex items-center justify-between gap-3 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
      <h2 className="text-sm font-bold text-axal-ink dark:text-gray-100">{section.title}</h2>
      {action && <RecordAction action={action} quiet {...handlers} />}
    </header>
    {rows.length === 0 ? <p className="px-4 py-3 text-[12.5px] text-axal-muted dark:text-gray-400">{section.empty || 'Nothing recorded here yet.'}</p> : rows.map((raw, index) => {
      const row = rowView(raw);
      const ownAction = rowAction(row.action, declarations);
      return <div key={index} className={side
        ? 'flex items-center justify-between gap-2.5 border-b border-axal-ground px-4 py-[9px] text-[12.5px] last:border-b-0 dark:border-gray-800'
        : 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-axal-ground px-4 py-2.5 text-[12.5px] last:border-b-0 dark:border-gray-800'}>
        <div className="min-w-0 break-words text-axal-ink dark:text-gray-200">{row.href ? <a className={QUIET} href={row.href} onClick={(event) => {
          if (handlers.onLink && isPlainClick(event)) { event.preventDefault(); handlers.onLink({ kind: 'link', href: row.href }); }
        }}>{text(row.a)}</a> : text(row.a)}</div>
        <div className={'min-w-0 break-words text-axal-muted dark:text-gray-400' + (side ? ' text-right' : '')}>
          {text(row.b)}
          {side && row.c !== '' && <span className="ml-2"><Status value={row.c} tone={row.tone} /></span>}
          {side && ownAction && <span className="ml-2"><RecordAction action={ownAction} quiet {...handlers} /></span>}
        </div>
        {!side && <div className="flex items-center gap-2"><Status value={row.c} tone={row.tone} />{ownAction && <RecordAction action={ownAction} quiet {...handlers} />}</div>}
      </div>;
    })}
  </section>;
}

export function RecordActivity({ rows = [], total = 0, cycleName, moduleName, onShowAll }) {
  return <section id={sectionId(cycleName, moduleName, 'Activity')} className={CARD}>
    <header className="flex items-center justify-between gap-3 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
      <h2 className="text-sm font-bold text-axal-ink dark:text-gray-100">Activity</h2>
      {total > rows.length && <button type="button" className={QUIET} disabled={!onShowAll} onClick={onShowAll}>Show all</button>}
    </header>
    {rows.length ? rows.map((row, index) => <div key={index} className="flex items-center justify-between gap-2.5 border-b border-axal-ground px-4 py-[9px] text-[12.5px] last:border-b-0 dark:border-gray-800">
      <span className="min-w-0 break-words text-axal-ink dark:text-gray-200">{text(row.a)}</span>
      <span className="shrink-0 text-right text-axal-muted dark:text-gray-400">{text(row.b)}</span>
    </div>) : <p className="px-4 py-3 text-[12.5px] text-axal-muted dark:text-gray-400">Nothing recorded here yet.</p>}
  </section>;
}

export default function RecordView({ record, activity, cycleName, moduleName, ...handlers }) {
  const declarations = declaredActions(record);
  const context = { cycleName, moduleName, declarations, ...handlers };
  return <div className="space-y-3" data-testid="record-view">
    <div className="flex flex-wrap items-center justify-between gap-3.5">
      <div className="flex flex-wrap items-center gap-2">{(record.pills ?? []).map((pill, index) => {
        const view = pillView(pill); return <Status key={index} value={view.text} tone={view.tone} />;
      })}</div>
      <RecordActions actions={record.actions} {...handlers} />
    </div>
    <RecordFacts facts={record.facts} />
    <div className="grid grid-cols-1 items-start gap-3 @[760px]/cycle:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">{(record.main ?? []).map((section) => <RecordSection key={section.key} section={section} {...context} />)}</div>
      <div className="min-w-0 space-y-3">{(record.side ?? []).map((section) => <RecordSection key={section.key} section={section} side {...context} />)}
        <RecordActivity rows={activity ?? record.activity} total={record.activity_total} {...context} />
      </div>
    </div>
  </div>;
}

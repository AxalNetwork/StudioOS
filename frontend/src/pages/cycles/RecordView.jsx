/**
 * D696: record body mounted by CycleRoute. The route owns reads, forms, confirms and errors.
 * Reusable parts also serve Customer research (#1659) and phone layout (#1665).
 *
 * D703 (#1665): below 1024px the same parts draw CO:270-273's groups of rows.
 * They read the switch from `RecordPhoneProvider`, which `CycleRoute` puts
 * around the record, so a record built from these parts (#1659's Customer
 * research) gets the phone layout without an edit of its own:
 *   · "Next for this record": the read's `next`, its CTA the declared action
 *     `next.action` names, run through the same handlers; none when the read
 *     declares no such action;
 *   · the record's pills as one chip row;
 *   · "At a glance": each fact, "Not recorded" with its reason beneath;
 *   · each main, then each side section, with its anchor, its action as the
 *     group's last row;
 *   · "Activity", with "Show all";
 *   · "Actions", a danger action in red.
 */
import { createContext, useContext } from 'react';
import { PhoneRows } from '../../ui';
import { isPlainClick } from './cycleModel.js';
import { declaredActions, dispatchOf, pillView, rowAction, rowView, sectionId, toneOf } from './recordModel.js';

import { NR } from './CycleModulePage.jsx';
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

const RecordPhone = createContext(false);
/** The phone switch for the record parts; `CycleRoute` passes `usePhoneWidth()`. */
export function RecordPhoneProvider({ phone = false, children }) {
  return <RecordPhone.Provider value={!!phone}>{children}</RecordPhone.Provider>;
}
export const useRecordPhone = () => useContext(RecordPhone);

/** A record tone as a `ui/Pill` tone, for a phone row's pill. */
const PILL_TONE = { v1: 'info', v2: 'info', v3: 'info', ok: 'ok', warn: 'warn', bad: 'danger', grey: 'neutral', muted: 'neutral' };

/** How a phone row runs a declared action: the same handlers the buttons call. */
function runOf(action, { onLink, onForm, onWrite, onClient }) {
  const kind = dispatchOf(action);
  if (!kind) return {};
  if (kind === 'link') return onLink ? { onClick: () => onLink(action) } : { href: action.href };
  if (kind === 'mailto') return { href: action.href };
  const run = { form: onForm, write: onWrite, client: onClient }[kind];
  return run ? { onClick: () => run(action) } : {};
}

/** A group of phone rows inside the body's gutter: `PhoneRows` draws its own. */
function PhoneGroup({ id, testid, label, rows }) {
  return <section id={id} className="-mx-[22px] scroll-mt-[1rem]" data-testid={testid}><PhoneRows groups={[{ label, rows }]} /></section>;
}
const danger = (label) => <span className="text-red-700 dark:text-red-300">{label}</span>;

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
  const phone = useRecordPhone();
  if (phone) {
    const rows = actions.filter((action) => dispatchOf(action)).map((action) => ({
      key: action.key, title: action.tone === 'danger' ? danger(action.label) : action.label, ...runOf(action, handlers),
    }));
    return rows.length ? <PhoneGroup testid="record-actions" label="Actions" rows={rows} /> : null;
  }
  return <div className="flex flex-wrap items-center gap-1.5" data-testid="record-actions">
    {actions.map((action) => <RecordAction key={action.key} action={action} {...handlers} />)}
  </div>;
}

export function RecordFacts({ facts = [] }) {
  if (useRecordPhone()) {
    return <PhoneGroup testid="record-facts" label="At a glance" rows={facts.map((fact, index) => ((fact.value ?? null) === null
      ? { key: index, title: fact.label, description: fact.reason || undefined, notRecorded: true, notRecordedReason: fact.reason || undefined }
      : { key: index, title: fact.label, value: text(fact.value) }))} />;
  }
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
  const action = rowAction(section.action, declarations);
  const rows = section.rows ?? [];
  if (useRecordPhone()) {
    const phoneRows = rows.map((raw, index) => {
      const row = rowView(raw);
      const own = rowAction(row.action, declarations);
      const tone = toneOf(row.tone);
      const right = row.c === '' ? {} : tone ? { pill: { label: text(row.c), tone: PILL_TONE[tone] || 'neutral' } } : { value: text(row.c) };
      const go = row.href ? (handlers.onLink ? { onClick: () => handlers.onLink({ kind: 'link', href: row.href }) } : { href: row.href })
        : own ? runOf(own, handlers) : {};
      return { key: index, title: text(row.a), description: text(row.b) || undefined, ...right, ...go };
    });
    if (!rows.length) phoneRows.push({ key: 'empty', title: section.empty ? section.empty : 'Nothing recorded here yet.', chevron: false });
    if (action) phoneRows.push({ key: 'action', title: action.tone === 'danger' ? danger(action.label) : action.label, ...runOf(action, handlers) });
    return <PhoneGroup id={sectionId(cycleName, moduleName, section.title)} testid="record-section" label={section.title} rows={phoneRows} />;
  }
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
  if (useRecordPhone()) {
    const phoneRows = rows.length ? rows.map((row, index) => ({ key: index, title: text(row.a), description: text(row.b) || undefined }))
      : [{ key: 'empty', title: 'Nothing recorded here yet.', chevron: false }];
    if (rows.length < total && onShowAll) phoneRows.push({ key: 'all', title: 'Show all', onClick: onShowAll });
    return <PhoneGroup id={sectionId(cycleName, moduleName, 'Activity')} testid="record-activity" label="Activity" rows={phoneRows} />;
  }
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

/** "Next for this record" (CO:270): the read's `next`, run through its declared action, never CO:269's link back. */
function RecordNext({ next, declarations, handlers }) {
  if (!next?.text) return null;
  const action = next.action ? rowAction(next.action, declarations) : null;
  const run = action ? runOf(action, handlers) : {};
  const className = 'mt-6 flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-violet-700 px-4 text-[15px] font-bold text-white dark:bg-violet-600';
  return <section data-testid="record-next">
    <p className="m-0 flex min-h-[40px] items-center text-[10px] font-extrabold uppercase tracking-[.12em] text-violet-700 dark:text-violet-300">Next for this record</p>
    <h2 className="m-0 mt-2 text-[24px] font-black leading-[1.2] tracking-[-.02em] text-gray-900 [text-wrap:balance] dark:text-gray-100">{text(next.text)}</h2>
    {run.onClick ? <button type="button" className={className} onClick={run.onClick} data-testid="record-next-cta">{action.label}</button>
      : run.href ? <a href={run.href} className={className} data-testid="record-next-cta">{action.label}</a> : null}
  </section>;
}

export default function RecordView({ record, activity, cycleName, moduleName, ...handlers }) {
  const declarations = declaredActions(record);
  const context = { cycleName, moduleName, declarations, ...handlers };
  if (useRecordPhone()) {
    const phoneActivity = activity ?? record.activity;
    return <div className="flex flex-col gap-[18px]" data-testid="record-view" data-phone="true">
      <RecordNext next={record.next} declarations={declarations} handlers={handlers} />
      {(record.pills ?? []).length > 0 && <div className="flex flex-wrap items-center gap-2" data-testid="record-pills">{record.pills.map((pill, index) => {
        const view = pillView(pill); return <Status key={index} value={view.text} tone={view.tone} />;
      })}</div>}
      <RecordFacts facts={record.facts} />
      {(record.main ?? []).map((section) => <RecordSection key={section.key} section={section} {...context} />)}
      {(record.side ?? []).map((section) => <RecordSection key={section.key} section={section} side {...context} />)}
      <RecordActivity rows={phoneActivity} total={record.activity_total} {...context} />
      <RecordActions actions={record.actions} {...handlers} />
    </div>;
  }
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

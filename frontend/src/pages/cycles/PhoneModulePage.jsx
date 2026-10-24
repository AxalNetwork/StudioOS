import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PhoneBar, PhoneRows, Unreadable } from '../../ui';
import { CardBody } from './CycleOverview';
import { recordHref, recordId, rowLinks } from './recordModel.js';
import { cardView, cellView, cycleOf, isPlainClick, recordsCount, safeHref } from './cycleModel';
import { verdictInterviewLine } from './validatePhone.js';

/**
 * D703 (#1665) — a module as a pushed page on a phone (CMM:40, CO:259-261),
 * taking `CycleModulePage`'s props:
 *   · `CycleBar`: "‹ <Cycle>", the module, the card's caption, and the page's
 *     Eadwyn button labelled "<Cycle> · <Module>";
 *   · "One next thing": the card's `next`, else the Add label, with the
 *     module's own Add as a 52px CTA (none when the module has no Add);
 *   · the chart, "<Module> · at a glance" with its range, in #1655's wrapper
 *     (480px, scrolling sideways in the cycle column);
 *   · the table's search, filters and sort, then one group "<records> ·
 *     <count>": each row's first cell as its title, the second as its
 *     description and the first toned cell as its pill. A row opens its record
 *     exactly when the desktop table links it (`rowLinks`), else its Edit;
 *     any other row is plain;
 *   · paging, the module's tool links as handed, then `children`.
 * `CycleRoute` renders it below 1024px on a module route, in place of
 * `CycleModulePage`, with the same props (#1665's PR 2c).
 */

/** The cycle body's gutter below `lg` (`CycleRoute`'s `cycle-route-body`): an action page draws it itself. */
export const PHONE_GUTTER = 'px-[22px] pt-[14px] pb-[18px]';

/**
 * #1661's `PhoneBar`, lifted out of the body's gutter and kept at the top of
 * the scroll area (CO:24-25), with the body's 14px under it.
 */
export function CycleBar({ back, title, sub, eadwynLabel }) {
  return (
    <div className="sticky top-0 z-10 -mx-[22px] -mt-[14px] mb-[14px]" data-testid="cycle-bar">
      <PhoneBar back={back} title={title} sub={sub} eadwynLabel={eadwynLabel} />
    </div>
  );
}

/** A record cell's tone as a `ui/Pill` tone. */
const PILL_TONE = { v1: 'info', v2: 'info', v3: 'info', ok: 'ok', warn: 'warn', bad: 'danger', grey: 'neutral', muted: 'neutral' };
const CONTROL = 'rounded-full border border-gray-200 bg-white px-[11px] py-[5px] text-[12px] font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** One table row as a phone row: the first cell, the second, and the first toned cell as its pill. */
export function phoneRow(cols, row) {
  const cells = cols.map((c) => cellView(row?.cells?.[c.key]));
  const title = cells[0] ? cells[0].text : 'Not recorded';
  const second = cells[1];
  const toned = cells.find((v) => !v.nr && v.tone);
  return {
    title,
    description: second ? second.text : undefined,
    pill: toned ? { label: toned.text, tone: PILL_TONE[toned.tone] || 'neutral' } : undefined,
  };
}

/** The Add the desktop page would draw first: `add` as handed, else the read's own. */
function firstAdd(add, records) {
  const list = Array.isArray(add) ? add : [add || records?.add].filter(Boolean);
  return list.find((a) => a?.text && (a.onClick || safeHref(a.href))) || null;
}

function Cta({ add }) {
  const className = 'mt-6 flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-violet-700 px-4 text-[15px] font-bold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500';
  if (add.onClick) return <button type="button" onClick={add.onClick} className={className} data-testid="phone-module-cta">{add.text}</button>;
  return <Link to={safeHref(add.href)} state={add.state} className={className} data-testid="phone-module-cta"
    onClick={add.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); add.onOpen(); } } : undefined}>{add.text}</Link>;
}

export default function PhoneModulePage({
  cycle, slug, moduleName, data, status = data ? 'ready' : 'loading', message = '', onRetry,
  records, recordsStatus, recordsMessage, query = {}, onQuery, onRetryRecords, add, rowAction, tool, tools = [], children, search = '', subnav = null,
}) {
  const [text, setText] = useState(query.q || '');
  const meta = cycleOf(cycle);
  if (!meta) return null;
  const cycleName = meta.name;
  const card = data?.card || null;
  const view = cardView(card);
  const interviewLine = verdictInterviewLine(data);
  // A refused or unreadable read sends no card, so the cycle's own list names it (never its slug).
  const name = card?.name || data?.module?.name || moduleName || slug;
  const recs = records ?? data?.records;
  const bar = (
    <CycleBar back={{ label: cycleName, to: `/${meta.key}${search}` }} title={name} sub={card?.caption || undefined}
      eadwynLabel={`${cycleName} · ${name}`} />
  );

  if (status === 'unreadable') {
    return <div data-testid="phone-module" data-cycle={meta.key} data-module={slug}>{bar}
      <Unreadable what={name} claim={message || 'This is not a claim that nothing is recorded.'} onRetry={onRetry} />
    </div>;
  }
  if (status === 'refused') {
    // #1704: the Worker's own sentence (Verdict for a partner), with no chart, no rows and no CTA.
    return <div data-testid="phone-module" data-cycle={meta.key} data-module={slug}>{bar}
      <p role="status" className="m-0 rounded-xl border border-gray-200 bg-gray-50 p-4 text-[13px] text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300" data-testid="phone-module-refused">{message}</p>
    </div>;
  }

  const addOne = firstAdd(add, recs);
  const headline = card?.next?.text || addOne?.text || null;
  const cols = Array.isArray(recs?.cols) ? recs.cols : [];
  const rows = Array.isArray(recs?.rows) ? recs.rows : [];
  const filters = Array.isArray(recs?.filters) ? recs.filters : [];
  const sorts = Array.isArray(recs?.sorts) ? recs.sorts : [];
  const count = recordsCount(recs);
  const title = data?.module?.records_title || name;
  const rStatus = recordsStatus || (recs ? 'ready' : status);
  const set = (patch) => onQuery?.({ ...query, page: 1, ...patch });
  const searching = !!(query.q || Object.values(query.filter || {}).some(Boolean));
  const toolLinks = [tool, ...tools].filter((item) => safeHref(item?.href));

  const group = {
    label: `${title} · ${count.label}`,
    testid: 'phone-module-records',
    rows: rows.map((r, i) => {
      const base = phoneRow(cols, r);
      const href = rowLinks(recs, r) ? recordHref(meta.key, slug, recordId(r), search) : null;
      const act = !href && typeof rowAction === 'function' ? rowAction(r) : null;
      return {
        key: r.id ?? i, ...base, testid: 'phone-module-row',
        ...(href ? { to: href } : act?.text && typeof act.onClick === 'function' ? { onClick: act.onClick } : {}),
      };
    }),
  };

  return (
    <div className="flex min-w-0 flex-col" data-testid="phone-module" data-cycle={meta.key} data-module={slug}>
      {bar}
      {/* A module that is also a tool draws its own tabs here (D906: Investor narrative). */}
      {subnav && <div className="mb-[14px] min-w-0">{subnav}</div>}
      {headline && (
        <section data-testid="phone-module-next" aria-labelledby="phone-module-next-title">
          <p className="m-0 flex min-h-[40px] items-center text-[10px] font-extrabold uppercase tracking-[.12em] text-violet-700 dark:text-violet-300">One next thing</p>
          <h2 id="phone-module-next-title" className="m-0 mt-2 text-[29px] font-black leading-[1.15] tracking-[-.032em] text-gray-900 [text-wrap:balance] dark:text-gray-100">{headline}</h2>
          {addOne && <Cta add={addOne} />}
        </section>
      )}
      <section className={`${headline ? 'mt-[22px]' : ''} min-w-0`.trim()} data-testid="phone-module-chart" data-state={view.state}>
        <div className="mb-2.5 flex items-baseline justify-between gap-2">
          <h2 className="m-0 text-[10px] font-extrabold uppercase tracking-[.12em] text-gray-700 dark:text-gray-300">{name} · at a glance</h2>
          {card?.range && <span className="text-[10.5px] text-gray-600 dark:text-gray-400">{card.range}</span>}
        </div>
        <CardBody card={card} onRetry={onRetry} search={search} />
        {/* D757 §2.6 (#1928): Verdict's interview evidence since the last decision, writers only. */}
        {interviewLine && <p className="m-0 mt-2.5 text-[13px] font-semibold text-gray-900 dark:text-gray-100" data-testid="verdict-interview-line">{interviewLine}</p>}
      </section>

      <div className="mt-[22px] flex flex-col gap-2" data-testid="phone-module-controls">
        <form role="search" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Search ${title}`} placeholder={`Search ${String(title || '').toLowerCase()}…`}
            className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
        </form>
        {(filters.length > 0 || sorts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.map((f) => (
              <select key={f.key} aria-label={f.label} className={CONTROL} value={query.filter?.[f.key] || ''}
                onChange={(e) => set({ filter: { ...(query.filter || {}), [f.key]: e.target.value } })}>
                <option value="">{f.label}: all</option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ))}
            {sorts.length > 0 && (
              <select aria-label="Sort" className={CONTROL} value={query.sort || sorts[0].key} onChange={(e) => set({ sort: e.target.value })}>
                {sorts.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      <div className="-mx-[22px] mt-[18px]">
        {rStatus === 'unreadable' && <div className="px-[22px]"><Unreadable what={`The ${String(title || 'records').toLowerCase()}`} claim={recordsMessage || 'This is not a claim that there are none.'} onRetry={onRetryRecords || onRetry} /></div>}
        {rStatus === 'loading' && <div className="flex flex-col gap-2 px-[22px]" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-[56px] rounded bg-gray-100 dark:bg-gray-800" />)}</div>}
        {rStatus === 'ready' && <PhoneRows groups={[group]} />}
        {rStatus === 'ready' && rows.length === 0 && (
          <p className="m-0 px-[22px] text-[13px] text-gray-600 dark:text-gray-400" data-testid="phone-module-empty">{searching ? 'Nothing matches this search.' : 'No records yet.'}</p>
        )}
      </div>
      {rStatus === 'ready' && count.pages > 1 && (
        <nav aria-label="Pages" className="mt-2 flex items-center justify-between gap-2" data-testid="phone-module-pages">
          <button type="button" className={CONTROL} disabled={count.page <= 1} onClick={() => onQuery?.({ ...query, page: count.page - 1 })} aria-label="Previous page">‹</button>
          <span className="text-[12px] text-gray-600 dark:text-gray-400">Page {count.page} of {count.pages}</span>
          <button type="button" className={CONTROL} disabled={count.page >= count.pages} onClick={() => onQuery?.({ ...query, page: count.page + 1 })} aria-label="Next page">›</button>
        </nav>
      )}
      {toolLinks.map((item) => (
        <Link key={item.href} to={item.href} className="mt-3 text-[13px] font-bold text-violet-700 hover:underline dark:text-violet-300" data-testid="phone-module-tool">
          {item.label || `Open ${name}`}
        </Link>
      ))}
      {children && <div className="mt-[18px] flex min-w-0 flex-col gap-3">{children}</div>}
    </div>
  );
}

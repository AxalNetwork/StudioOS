import React, { isValidElement } from 'react';
import { Link } from 'react-router-dom';
import Pill from '../Pill';

/**
 * A row's icon: a drawn element as given, or an icon component (a sidebar
 * row's lucide icon, which More's rows carry) drawn at 18px. A component handed
 * to React as a child is React error #31; More crashed on it (2026-10-21).
 */
export function rowIcon(icon) {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  const Icon = icon;
  return <Icon size={18} aria-hidden="true" className="text-gray-600 dark:text-gray-400" />;
}

/**
 * D699's page rows, with D700's optional parts (`Account Mobile Page.dc.html`):
 *   · a group's `action`, drawn at the right of its title;
 *   · a row's `pill` ({ label, tone }), a `ui/Pill` tone in place of a plain value;
 *   · a row's `bar`, a 7px meter under it, as a percentage;
 *   · a row's `notRecordedReason`, carried on the Not recorded chip as
 *     `ui/Honesty`'s `Unrecorded` carries its reason;
 *   · a group's `cta` ({ label, to | href | onClick }) and `note`;
 *   · a row's `icon` (`rowIcon`).
 * A row is a link (`to`, or `href` for a whole-page address such as
 * `mailto:`), a button (`onClick`), or, with neither, a plain row with no ›.
 */
export function PhoneRows({ groups = [] }) {
  return <div className="space-y-[18px] px-[22px] pb-[18px]">
    {groups.map((group, index) => <section key={group.label || index} data-testid={group.testid}>
      {(group.label || group.action) && <div className="mb-2 flex items-center justify-between gap-2.5">
        {group.label && <h2 className="text-[10px] font-extrabold uppercase tracking-wide text-gray-700 dark:text-gray-300">{group.label}</h2>}
        {group.action && <span className="text-[13px] font-bold text-violet-700 dark:text-violet-300">{group.action}</span>}
      </div>}
      <div className="border-t border-[#f0eff3] dark:border-gray-800">
        {group.rows.map((row, rowIndex) => {
          const live = !!(row.to || row.href || row.onClick);
          const line = <>
            {row.icon && <span className="flex-none">{rowIcon(row.icon)}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-gray-900 dark:text-gray-100">{row.title}</span>
              {row.description && <span className="block text-[11.5px] text-gray-600 dark:text-gray-400">{row.description}</span>}
            </span>
            {row.notRecorded ? <span title={row.notRecordedReason || undefined} className="max-w-[40%] rounded border border-gray-300 dark:border-gray-700 px-1.5 text-[9.5px] font-bold text-gray-700 dark:text-gray-300">Not recorded</span>
              : row.pill ? <Pill tone={row.pill.tone} className="max-w-[40%] truncate">{row.pill.label}</Pill>
                : row.value && <span className="max-w-[40%] truncate text-right text-[12.5px] font-bold text-gray-700 dark:text-gray-300">{row.value}</span>}
            {(row.chevron ?? live) && <span aria-hidden="true" className="text-gray-500 dark:text-gray-400">›</span>}
          </>;
          const content = row.bar == null ? line : <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-[9px]">
            <span className="flex items-center gap-2">{line}</span>
            <span aria-hidden="true" className="block h-[7px] overflow-hidden rounded-full bg-[#ececf1] dark:bg-gray-800">
              <span className="block h-full rounded-full bg-violet-700 dark:bg-violet-400" style={{ width: `${Math.max(0, Math.min(100, row.bar))}%` }} />
            </span>
          </span>;
          const classes = 'flex min-h-[56px] w-full items-center gap-2 border-b border-[#f0eff3] dark:border-gray-800 text-left';
          const key = row.key || row.to || row.href || row.title || rowIndex;
          if (row.to) return <Link key={key} to={row.to} className={classes} data-testid={row.testid}>{content}</Link>;
          if (row.href) return <a key={key} href={row.href} className={classes} data-testid={row.testid}>{content}</a>;
          if (row.onClick) return <button key={key} type="button" onClick={row.onClick} className={classes} data-testid={row.testid}>{content}</button>;
          return <div key={key} className={classes} data-testid={row.testid}>{content}</div>;
        })}
      </div>
      {group.cta && <PhoneCta cta={group.cta} />}
      {group.note && <div className="mt-2 text-[12px] leading-normal text-gray-600 dark:text-gray-400">{group.note}</div>}
    </section>)}
  </div>;
}

function PhoneCta({ cta }) {
  const classes = 'mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-violet-700 text-[14.5px] font-bold text-white dark:bg-violet-600';
  if (cta.to) return <Link to={cta.to} className={classes} data-testid={cta.testid}>{cta.label}</Link>;
  if (cta.href) return <a href={cta.href} className={classes} data-testid={cta.testid}>{cta.label}</a>;
  return <button type="button" onClick={cta.onClick} className={classes} data-testid={cta.testid}>{cta.label}</button>;
}

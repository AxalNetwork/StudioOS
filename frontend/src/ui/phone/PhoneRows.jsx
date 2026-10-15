import React from 'react';
import { Link } from 'react-router-dom';

export function PhoneRows({ groups = [] }) {
  return <div className="space-y-[18px] px-[22px] pb-[18px]">
    {groups.map((group, index) => <section key={group.label || index}>
      {group.label && <h2 className="mb-2 text-[10px] font-extrabold uppercase tracking-wide text-gray-700 dark:text-gray-300">{group.label}</h2>}
      <div className="border-t border-[#f0eff3] dark:border-gray-800">
        {group.rows.map((row, rowIndex) => {
          const content = <>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-gray-900 dark:text-gray-100">{row.title}</span>
              {row.description && <span className="block text-[11.5px] text-gray-600 dark:text-gray-400">{row.description}</span>}
            </span>
            {row.notRecorded ? <span className="max-w-[40%] rounded border border-gray-300 dark:border-gray-700 px-1.5 text-[9.5px] font-bold text-gray-700 dark:text-gray-300">Not recorded</span>
              : row.value && <span className="max-w-[40%] truncate text-right text-[12.5px] font-bold text-gray-700 dark:text-gray-300">{row.value}</span>}
            {row.chevron !== false && <span aria-hidden="true" className="text-gray-500 dark:text-gray-400">›</span>}
          </>;
          const classes = 'flex min-h-[56px] w-full items-center gap-2 border-b border-[#f0eff3] dark:border-gray-800 text-left';
          return row.to ? <Link key={row.to} to={row.to} className={classes}>{content}</Link>
            : <button key={row.title || rowIndex} type="button" onClick={row.onClick} className={classes}>{content}</button>;
        })}
      </div>
    </section>)}
  </div>;
}

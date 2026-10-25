import React from 'react';
import { MODELLED, ON_RECORD } from './capTableModel';

/** The two tags every board uses: On record (positive, solid edge) and Modelled (muted, dashed edge). */
export function Tag({ kind }) {
  const on = kind === 'record';
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${on
      ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
      : 'border-dashed border-gray-300 text-axal-muted dark:border-gray-600 dark:text-gray-400'}`}
      data-testid={on ? 'tag-on-record' : 'tag-modelled'}>
      {on ? ON_RECORD : MODELLED}
    </span>
  );
}

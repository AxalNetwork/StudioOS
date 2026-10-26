import React from 'react';
import { Link } from 'react-router-dom';
import { NOT_YET, READS, TITLE, validateHref } from './pmfModel';
import { PmfMethodButton } from './PmfMethod';

/**
 * D1141 (#2433) — Fundraising readiness's Product-market fit part, and the
 * door to it from Validate's overview (RD12). Not computed yet: the part says
 * so. Since D1146 (#3032) RD4 opens from here and RD12 is `PmfChip`, both in
 * `PmfMethod.jsx`. See `pmfModel.js`.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

export function PmfPart({ projectId = null }) {
  const search = projectId ? `?project_id=${projectId}` : '';
  return (
    <section className={CARD} id="product-market-fit" data-testid="pmf-part">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{TITLE}</h2>
        <span className={PILL} data-testid="pmf-not-yet">Not scored yet</span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className={`m-0 text-[12.5px] ${INK}`}>{NOT_YET}</p>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{READS} <Link className={LINK} to={validateHref(null, search)}>Open Validate</Link></p>
        {/* D1146 (#3032, RD4): the method, from the stored model. */}
        <PmfMethodButton projectId={projectId} search={search} />
      </div>
    </section>
  );
}

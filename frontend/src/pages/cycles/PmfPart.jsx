import React from 'react';
import { Link } from 'react-router-dom';
import { BANDS, GRADES, INPUTS, MODEL_VERSION, NOT_YET, READS, TITLE, readinessHref, validateHref } from './pmfModel';

/**
 * D1141 (#2433) — Fundraising readiness's Product-market fit part, and the
 * door to it from Validate's overview (RD12). Not computed yet: the part says
 * so and shows model v1 (RD4). See `pmfModel.js`.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';

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
        <details data-testid="pmf-model">
          <summary className={`cursor-pointer text-[12.5px] font-bold ${INK}`}>How it will be scored · {MODEL_VERSION}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-axal-hairline dark:border-gray-800"><th className={TH}>Input</th><th className={TH}>Rule</th><th className={TH}>Weight</th></tr></thead>
              <tbody>
                {INPUTS.map((i) => (
                  <tr key={i.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="pmf-input">
                    <td className={TD}>{i.module ? <Link className={LINK} to={validateHref(i.module, search)}>{i.name}</Link> : i.name}</td>
                    <td className={TD}>{i.rule}</td>
                    <td className={`${TD} font-mono tabular-nums`}>{i.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={`m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-[12px] ${MUTED}`}>
            {GRADES.map(([g, f, why]) => <li key={g}><span className={`font-bold ${INK}`}>{g} {f}</span> · {why}</li>)}
          </ul>
          <p className={`m-0 mt-2 text-[12px] ${MUTED}`}>{BANDS}</p>
        </details>
      </div>
    </section>
  );
}

/** RD12: Validate's overview hands off to the readiness page. */
export function ReadinessDoor({ search = '' }) {
  return (
    <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="pmf-door">
      What Validate records will feed Product-market fit on Fundraising readiness. <Link className={LINK} to={readinessHref(search)}>Open Fundraising readiness</Link>
    </p>
  );
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesWrite } from '../../lib/api/cycles';
import { Unreadable } from '../../ui';
import Lightbox from '../../ui/Lightbox';
import { chipOf, methodOf, readinessHref, validateHref } from './pmfModel';

/**
 * D1146 (#3032) — Product-market fit part 5.
 *
 *   RD4  `PmfMethodDialog`: "How Product-market fit is scored", from the stored
 *        model (`GET /api/cycles/raise/pmf/model`). It reads when it opens; a
 *        failed read says Unreadable with Try again, and nothing in it is a
 *        copy of the model kept by the page. SCORING's method page (#2428)
 *        can draw the same dialog when it lands.
 *   RD12 `PmfChip`: the chip on Validate's overview header, the venture's latest
 *        stored band and confidence (`pmfHistory`, one point), opening the
 *        readiness page. It reads the store only, so opening Validate computes
 *        nothing.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const EYE = 'm-0 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep';
const CHIP = 'inline-flex min-h-[32px] items-center rounded-full border border-axal-lavender-edge bg-axal-lavender px-3 text-[12px] font-bold text-axal-violet hover:text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:text-violet-200';

const refused = (e) => e?.status === 401 || e?.status === 403 || e?.status === 404;

function useRead(load, key) {
  const [read, setRead] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading' });
    load().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { if (live) setRead({ status: refused(e) ? 'refused' : 'error' }); },
    );
    return () => { live = false; };
  // `load` is rebuilt each render; `key` names what it reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return [read, () => setTick((n) => n + 1)];
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-800">
      <h3 className={EYE}>{title}</h3>
      {children}
    </section>
  );
}

/** RD4: how Product-market fit is scored, from the stored model. */
export function PmfMethodDialog({ projectId, search = '', onClose }) {
  const [read, retry] = useRead(() => cyclesWrite.raise.pmfModel(projectId), `model:${projectId}`);
  const m = methodOf(read);
  return (
    <Lightbox label="How Product-market fit is scored" eyebrow="How this is scored" title="How Product-market fit is scored" width={960}
      onClose={onClose} testId="pmf-method"
      footer={<div className="flex justify-end"><button type="button" className={BTN} onClick={onClose}>Close</button></div>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {m.state === 'loading' && <span className={`font-mono text-[12px] ${MUTED}`} data-testid="pmf-method-loading">Reading the model…</span>}
        {m.state === 'refused' && <p className={`m-0 text-[13px] ${INK}`} data-testid="pmf-method-refused">You do not have access to this venture’s Raise.</p>}
        {m.state === 'unreadable' && (
          <div data-testid="pmf-method-unreadable">
            <Unreadable what="How Product-market fit is scored" claim="This is not a claim that the score has no model." onRetry={retry} />
          </div>
        )}
        {m.state === 'ready' && (
          <>
            <div className="flex flex-col gap-1">
              <span className={`w-fit rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300`} data-testid="pmf-method-version">{m.title}</span>
              <span className={`text-[12px] ${MUTED}`} data-testid="pmf-method-status">{m.status}</span>
            </div>
            <p className={`m-0 text-[13px] ${INK}`}>Built only from what you recorded in Validate. Missing data lowers confidence; it is never a zero.</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" data-testid="pmf-method-inputs">
                <caption className="sr-only">The inputs, what each reads, and its weight</caption>
                <thead><tr className="border-b border-axal-hairline dark:border-gray-800"><th scope="col" className={TH}>Input</th><th scope="col" className={TH}>What it reads</th><th scope="col" className={`${TH} text-right`}>Weight</th></tr></thead>
                <tbody>
                  {m.inputs.map((i) => (
                    <tr key={i.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="pmf-method-input">
                      <td className={`${TD} font-semibold`}>{i.module ? <Link className={LINK} to={validateHref(i.module, search)}>{i.name}</Link> : i.name}</td>
                      <td className={TD}>{i.reads}</td>
                      <td className={`${TD} text-right font-mono tabular-nums`}>{i.weight}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td className={`${TD} font-bold`} colSpan={2}>Total</td><td className={`${TD} text-right font-mono font-bold tabular-nums`} data-testid="pmf-method-total">{m.total}</td></tr></tfoot>
              </table>
            </div>
            <Section title="Grades">
              <ul className={`m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] ${MUTED}`} data-testid="pmf-method-grades">
                {m.grades.map((g) => <li key={g.key}><span className={`font-bold ${INK}`}>{g.label}{g.factor === null ? '' : ` ${g.factor}`}</span> · {g.why}</li>)}
              </ul>
              <p className={`m-0 text-[12px] ${MUTED}`}>{m.freshness}</p>
            </Section>
            <Section title="Confidence and the floor">
              <p className={`m-0 text-[12.5px] ${INK}`} data-testid="pmf-method-confidence">{m.confidence}</p>
              <p className={`m-0 text-[12.5px] ${INK}`} data-testid="pmf-method-floor">{m.floor}</p>
            </Section>
            <Section title="Bands">
              <p className={`m-0 text-[12.5px] ${INK}`} data-testid="pmf-method-bands">{m.bands}</p>
            </Section>
            <Section title="Words">
              <ul className={`m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] ${MUTED}`}>
                <li><span className={`font-bold ${INK}`}>Not expected yet</span> · an input that does not apply at this stage, such as Product pull before a product is live. It leaves the coverage count.</li>
                <li><span className={`font-bold ${INK}`}>Recorded zero or not recorded</span> · “0 of 12 signals paid” is a real 0 and lowers the score. Nothing recorded lowers confidence instead.</li>
                <li><span className={`font-bold ${INK}`}>After a pivot</span> · records from before a Pivot verdict are left out.</li>
              </ul>
            </Section>
          </>
        )}
      </div>
    </Lightbox>
  );
}

/** The button that opens RD4. */
export function PmfMethodButton({ projectId, search = '', className = LINK }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${className} text-left`} aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid="pmf-method-open">How Product-market fit is scored</button>
      {open && projectId ? <PmfMethodDialog projectId={projectId} search={search} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** RD12: Validate's overview header chip, opening Fundraising readiness. */
export function PmfChip({ projectId, search = '' }) {
  const [read, retry] = useRead(() => cyclesWrite.raise.pmfHistory(projectId, { limit: 1 }), `chip:${projectId}`);
  const chip = chipOf(read);
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="pmf-chip" data-state={chip.state}>
      <Link className={CHIP} to={readinessHref(search)} aria-label={chip.label ? `${chip.label}. Open Fundraising readiness` : 'Open Fundraising readiness'}
        title={chip.when ? `Scored ${chip.when}` : undefined} data-testid="pmf-chip-link">{chip.text} ›</Link>
      {chip.state === 'unreadable' ? <button type="button" className={`text-[12px] ${LINK}`} onClick={retry} data-testid="pmf-chip-retry">Try again</button> : null}
    </span>
  );
}

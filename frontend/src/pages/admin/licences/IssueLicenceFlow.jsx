/**
 * D5929 (#5929) — New licence as a stepped issuance (Licences v2 board L21, with the frame details of the New Licence
 * Steps canvas: LNS41 to LNS47E and the phone's Steps sheet, LNS48D). New licence and Issue first licence open it in
 * place of the ledger.
 *
 * THE FRAME. The crumb (Licences / New licence), "Issue a licence" with "Step n of 6 · <step>", what is saved so far
 * (nothing until step 1 creates the draft, then its reference and entity with Draft), Leave, and the six steps as a
 * 240px list with the current one marked `aria-current="step"`. Below `md` the list is a Steps sheet.
 *
 * THE CARD SLOT. Step 2, Territory, is `TerritoryStep` (`TerritoryEditor.jsx`), L21's own. Steps 1 and 3 to 6 are
 * #5931's cards (`NewLicenceStep`, D4819 part 5), placed here unchanged. `NewLicenceStep` stays mounted on step 2
 * (it draws nothing there), so the values typed on the other steps survive a visit to Territory; the countries
 * chosen are held here for the same reason.
 *
 * LEAVING. With a draft created or anything typed, Leave (and the crumb) asks first, in the words of LNS47E; closing
 * the tab asks through the browser. Nothing is deleted: a draft stays in the ledger as Draft.
 */
import React, { useEffect, useRef, useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { NewLicenceStep } from './NewLicenceSteps';
import { TerritoryStep } from './TerritoryEditor';
import { kindLabel } from './newLicenceModel';
import { KIND_HOSTS, NEW_LICENCE_STEPS, TERRITORY_STEP, canOpenStep, codesOf, leavePlan, stepLine, stepMarks } from './issueLicenceFlowModel';

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800 max-md:min-h-[44px]';
const PRIMARY = 'inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md bg-violet-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-800 max-md:min-h-[44px]';

/** The six steps, as L21 draws them. `onOpen(i)` is offered on the steps that may be opened. */
function StepList({ step, passed, licence, reached, onOpen, testId }) {
  return (
    <ol aria-label="Steps" data-testid={testId}
      className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-0 dark:border-gray-800 dark:bg-gray-950">
      {stepMarks(step, passed).map((s) => {
        const open = s.state !== 'current' && canOpenStep(s.i, { licence, reached });
        const body = (
          <>
            <i aria-hidden="true" className={`grid h-[22px] w-[22px] place-items-center rounded-full border font-mono text-[11px] font-bold not-italic ${
              s.state === 'current' ? 'border-violet-700 bg-violet-700 text-white'
                : s.state === 'done' ? 'border-green-700 bg-green-700 text-white'
                  : 'border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400'
            }`}>{s.state === 'done' ? '✓' : s.i + 1}</i>
            <span className="min-w-0 text-left">{s.name}</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{s.state === 'current' ? 'Current' : s.state === 'done' ? 'Done' : ''}</span>
          </>
        );
        const row = 'grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2 text-[12.5px] text-gray-900 dark:text-gray-100 max-md:min-h-[44px]';
        return (
          <li key={s.i} aria-current={s.state === 'current' ? 'step' : undefined} data-testid={`nl-steplist-${s.i + 1}`} data-state={s.state}
            className={`border-b border-gray-200 last:border-b-0 dark:border-gray-800 ${s.state === 'current' ? 'bg-violet-50 font-semibold dark:bg-violet-950/30' : ''}`}>
            {open ? (
              <button type="button" className={`${row} hover:bg-gray-50 dark:hover:bg-gray-900`} onClick={() => onOpen(s.i)} data-testid={`nl-goto-${s.i + 1}`}>
                {body}<span className="sr-only"> · open this step</span>
              </button>
            ) : <div className={row}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Today's kind explainer (D196, D197), under step 1 until the draft exists: nothing the inline form said is lost. */
function KindHosts() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 text-[12.5px] dark:border-gray-800 dark:bg-gray-950" data-testid="nl-kind-hosts">
      <h3 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">Where each kind’s members land</h3>
      <dl className="m-0 grid gap-1.5 md:grid-cols-[10rem_minmax(0,1fr)]">
        {KIND_HOSTS.map(([k, line]) => (
          <React.Fragment key={k}>
            <dt className="font-semibold text-gray-800 dark:text-gray-200">{kindLabel(k)}</dt>
            <dd className="m-0 text-gray-600 dark:text-gray-400">{line}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="m-0 mt-2 text-gray-600 dark:text-gray-400">A new licence starts as a draft holding no territory. It cannot be issued until it has a country, seats, terms and a renewal date.</p>
    </section>
  );
}

/**
 * `onLeave(licence)` closes the flow: `licence` is the draft (or the issued licence) when one exists, else null, so
 * the page can read the ledger again.
 */
export default function IssueLicenceFlow({ onLeave }) {
  const [step, setStep] = useState(0);
  const [licence, setLicence] = useState(null);
  const [passed, setPassed] = useState(() => new Set());
  const [reached, setReached] = useState(0);
  const [codes, setCodesRaw] = useState([]);
  const [held, setHeld] = useState(undefined);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const stay = useRef(null);

  const readHeld = () => {
    setHeld(undefined);
    api.licenceTerritories()
      .then((d) => setHeld(Array.isArray(d?.items) ? d.items : null))
      .catch((e) => { reportError('new_licence_holders_failed', e); setHeld(null); });
  };
  useEffect(readHeld, []);

  // The countries start from what the draft holds, once per draft.
  const seeded = useRef(null);
  if (licence?.uid && seeded.current !== licence.uid) {
    seeded.current = licence.uid;
    setCodesRaw(codesOf(licence));
  }
  const setCodes = (next) => { setDirty(true); setCodesRaw(next); };

  const go = (i) => {
    if (i > step) setPassed((cur) => new Set(cur).add(step));
    setReached((r) => Math.max(r, i));
    setStep(i);
    setStepsOpen(false);
  };

  const plan = leavePlan({ licence, dirty });
  // Closing or reloading the tab with a draft or typed values: the browser asks.
  useEffect(() => {
    if (!plan.ask || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [plan.ask]);

  const requestLeave = (e) => {
    e?.preventDefault?.();
    if (plan.ask) setAsking(plan.body);
    else onLeave?.(licence);
  };

  const list = (testId) => <StepList step={step} passed={passed} licence={licence} reached={reached} onOpen={go} testId={testId} />;

  return (
    // Any field typed in, on any step, makes leaving ask first.
    <div onInput={() => setDirty(true)} data-testid="licence-issue-flow" data-step={NEW_LICENCE_STEPS[step]}>
      <nav aria-label="Breadcrumb" className="text-xs font-semibold text-gray-500 dark:text-gray-400" data-testid="nl-crumb">
        <a href="/admin/licences" onClick={requestLeave} className="inline-flex min-h-[44px] items-center hover:underline md:min-h-0">Licences</a>
        {' / '}
        <span aria-current="page" className="text-gray-900 dark:text-gray-100">New licence</span>
      </nav>
      <header className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Issue a licence</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400" data-testid="nl-step-line">{stepLine(step)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {licence ? (
            <>
              <span className="font-mono text-[12px] text-gray-600 dark:text-gray-400" data-testid="nl-saved">
                {licence.licence_ref}{licence.legal_entity_name ? ` · ${licence.legal_entity_name}` : ''}
              </span>
              <span className="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300" data-testid="nl-status">
                {licence.status === 'draft' || !licence.status ? '◷ Draft' : `● ${String(licence.status).charAt(0).toUpperCase()}${String(licence.status).slice(1)}`}
              </span>
            </>
          ) : (
            <span className="text-[12px] text-gray-600 dark:text-gray-400" data-testid="nl-saved">Nothing is saved until you create the draft</span>
          )}
          <button type="button" className={BTN} onClick={requestLeave} data-testid="nl-leave">Leave</button>
        </div>
      </header>

      {/* Below md the list is a sheet: the step line and Steps, as LNS48 draws them. */}
      <div className="mt-3 flex items-center justify-between gap-2 md:hidden">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{stepLine(step)}</span>
        <button type="button" className={BTN} aria-haspopup="dialog" onClick={() => setStepsOpen(true)} data-testid="nl-steps-open">Steps</button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-start">
        <div className="max-md:hidden">{list('nl-steplist')}</div>
        <div className="flex min-w-0 flex-col gap-3">
          {step === TERRITORY_STEP && licence ? (
            <TerritoryStep
              licence={licence} codes={codes} setCodes={setCodes} held={held} onRetryHeld={readHeld} onHeldStale={readHeld}
              onLicence={setLicence} onBack={() => go(0)} onContinue={() => go(2)}
            />
          ) : null}
          <NewLicenceStep step={step} licence={licence} onLicence={setLicence} onStep={go} />
          {step === 0 && !licence ? <KindHosts /> : null}
        </div>
      </div>

      {stepsOpen ? (
        <Lightbox label="Steps" title="Steps" onClose={() => setStepsOpen(false)} width={480} phone="sheet" testId="nl-steps-sheet"
          footer={<div className="flex justify-end"><button type="button" className={BTN} onClick={() => setStepsOpen(false)}>Close</button></div>}>
          {list('nl-steplist-sheet')}
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Done steps show ✓. Opening another step keeps what you typed on this one.</p>
        </Lightbox>
      ) : null}

      {asking ? (
        <Lightbox label="Leave New licence?" title="Leave New licence?" onClose={() => setAsking(null)} width={480} testId="nl-leave-dialog" initialFocus={stay}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={BTN} onClick={() => { setAsking(null); onLeave?.(licence); }} data-testid="nl-leave-confirm">Leave</button>
              <button type="button" ref={stay} className={PRIMARY} onClick={() => setAsking(null)} data-testid="nl-leave-stay">Stay</button>
            </div>
          )}>
          <p className="m-0 text-sm text-gray-800 dark:text-gray-200" data-testid="nl-leave-body">{asking}</p>
        </Lightbox>
      ) : null}
    </div>
  );
}

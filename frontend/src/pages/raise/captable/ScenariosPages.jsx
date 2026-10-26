import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { capTableHolderApi } from '../../../lib/api/capTableHolder';
import { capTableScenariosApi } from '../../../lib/api/capTableScenarios';
import { useAuth } from '../../../hooks/useAuthSync';
import { hasTier } from '../../../sidebarConfig';
import { Unreadable } from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth';
import { ChartTable, Columns, ExitSteps, Legend, WeekLines } from '../../../ui/Charts';
import CapTableDialog, { useWrite } from './CapTableDialog';
import { Tag } from './CapTableTag';
import { VariantEditor } from './ScenarioModelEditor';
import { PLAN_LINE } from './overviewModel';
import { dollars, tabSearch } from './capTableModel';
import {
  ASSUMPTIONS_FALLBACK, COMPARE, READ_SOURCE, GROUPS, MAX_COMPARE, MAX_EXITS, MODEL_LOCKED, READ_ONLY, SAVED, SCENARIOS_PATH,
  attachRead, attachedRead, beforeAfter, todayPrice, compareExits, compareHref, compareIds, compareRows, dialogCopy, exitTable,
  draftFromScenario, engineNotes, exitPanels, founderPanels, fromToday, inputsFromDraft, nameError,
  newScenarioInputs, nextName, notModelled, paymentReadBack, roundEvents, roundReadBack, runRequest,
  sameInputs, scenarioCards, scenarioHref, scenariosHead, shareSteps, short, shortName, swipeCards, todayBody, todayDraft,
  toggleCompare, variantSaveErrors, waterfallTable, waterfallsOf, withNotes,
} from './scenariosModel';

/**
 * D1024 (#2861) — Scenarios complete (CT6–CT9): the cards with Compare and
 * New scenario at `/raise/cap-table/scenarios`, one scenario at
 * `/scenarios/<uid>` (its inputs, results, the exit waterfall and Eadwyn's
 * reads), and `/scenarios/compare?ids=` (CT7, CT8 in dark). Every rule and
 * line is in `scenariosModel.js`; every write opens a dialog except the
 * editor's own Save, which edits in place as the variants page did.
 *
 * D1028 (#2865, CT23c): on a phone the compare page is one scenario per card,
 * swiped or stepped with ‹ and ›, and the exit waterfall of the card in view
 * as a table.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400 dark:hover:text-violet-300';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-200';
const MONO = 'font-mono tabular-nums';
const AMBER = 'rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:border-amber-300/55 dark:bg-amber-300/10 dark:text-amber-300';
const BTN = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink hover:border-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const PRIMARY = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-axal-violet bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
const INPUT = 'w-full min-w-0 rounded-md border border-axal-hairline bg-white px-2 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const LAV = 'rounded-xl border border-axal-lavender-edge bg-axal-lavender dark:border-[#4c3a8a] dark:bg-[#211f3d]';

// ─────────────────────────────────────────────────────────── shared parts

/** One read, answering alone: loading, ready, refused (403 or 404) or error. */
function useRead(load, key, reload) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (key == null) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(() => load(key))
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [load, key, reload]);
  return state;
}

const readCompare = (id) => capTableScenariosApi.compare(id);
const readToday = (id) => capTableScenariosApi.today(id);
const readGrants = (id) => capTableHolderApi.grants(id);
const readScenario = (uid) => capTableScenariosApi.get(uid);

/** Who may change scenarios: the plan, then the venture's owner or a co-founder (the grants read answers), or an admin. */
function useWrites(projectId) {
  const { user } = useAuth() || {};
  const grants = useRead(readGrants, projectId, 0);
  const plan = hasTier(user, 'studio');
  const admin = String(user?.role || '').toLowerCase() === 'admin';
  return { plan, writes: plan && (grants.status === 'ready' || admin) };
}

function Block({ title, tags, aside, testId, children, foot }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
        <h2 className={`m-0 flex flex-wrap items-center gap-2 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title} {tags}</h2>
        {aside}
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {children}
        {foot ? <p className={`m-0 text-[12px] ${MUTED}`}>{foot}</p> : null}
      </div>
    </section>
  );
}

function Skeleton({ testId }) {
  return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={testId} />;
}

function ReadState({ read, what, claim, onRetry, testId, children }) {
  if (read.status === 'loading') return <Skeleton testId={`${testId}-loading`} />;
  if (read.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid={`${testId}-refused`}>{read.message || 'You do not have access to this venture’s cap table.'}</p>;
  if (read.status === 'error') return <div data-testid={`${testId}-unreadable`}><Unreadable what={what} claim={claim} onRetry={onRetry} /></div>;
  return children;
}

/** A chart with its Table toggle (D893's "View as table"), the alt sentence on the drawing. */
function ChartBlock({ title, testId, alt, legend, table, foot, children }) {
  const [asTable, setAsTable] = useState(false);
  const seg = (on) => `min-h-[28px] rounded-[7px] px-2.5 text-[12px] font-bold ${on ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-700 dark:text-gray-200' : MUTED}`;
  return (
    <Block title={title} tags={<Tag kind="modelled" />} testId={testId} foot={foot}
      aside={(
        <span className="inline-flex rounded-[9px] bg-axal-ground p-0.5 dark:bg-gray-800">
          <button type="button" className={seg(!asTable)} aria-pressed={!asTable} onClick={() => setAsTable(false)} data-testid={`${testId}-as-chart`}>Chart</button>
          <button type="button" className={seg(asTable)} aria-pressed={asTable} onClick={() => setAsTable(true)} data-testid={`${testId}-as-table`}>Table</button>
        </span>
      )}>
      {asTable
        ? <div data-testid={`${testId}-table`}><ChartTable chart={{ table }} caption={title} /></div>
        : (
          <>
            {legend ? <Legend items={legend} /> : null}
            <div role="img" aria-label={alt} data-testid={`${testId}-chart`}>{children}</div>
          </>
        )}
    </Block>
  );
}

/**
 * The read-back band (CT7, CT9): every step shown; nothing lands until it is
 * attached. Eadwyn's own band (ZoneDraft's `raise/capital` and
 * `raise/liquidity`, on Overview) reads the saved model, never a chosen
 * scenario, so this one is read off the engine's numbers and says so.
 */
function EadwynBand({ read, attached, canAttach, onAttach, testId }) {
  const [gone, setGone] = useState(false);
  if (!read) return null;
  if (gone) {
    return (
      <p className={`m-0 text-[12px] ${MUTED}`} data-testid={`${testId}-discarded`}>
        Discarded. Nothing was saved. <button type="button" className={LINK} onClick={() => setGone(false)}>Show it again</button>
      </p>
    );
  }
  return (
    <section className={`${LAV} flex flex-col gap-2 px-4 py-3`} data-testid={testId}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-violet dark:text-violet-400">Proposal · plain-language read</span>
      <h2 className={`m-0 flex items-center gap-2 text-[15px] font-extrabold ${INK}`}>{read.title} <Tag kind="modelled" /></h2>
      <p className="m-0 text-[12.5px] font-semibold text-axal-violet dark:text-violet-400" data-testid={`${testId}-source`}>{READ_SOURCE}</p>
      <ol className="m-0 flex list-none flex-col p-0">
        {read.steps.map((t, i) => (
          <li key={i} className="flex gap-2.5 border-t border-axal-lavender-edge py-1.5 text-[13px] leading-[1.55] dark:border-[#4c3a8a]" data-testid={`${testId}-step`}>
            <span className={`w-3.5 flex-none font-mono text-[12px] font-bold text-axal-violet dark:text-violet-400`}>{i + 1}</span>
            <span className={INK}>{t}</span>
          </li>
        ))}
      </ol>
      {attached
        ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid={`${testId}-attached`}>Attached to this scenario.</p>
        : (
          <div className="flex flex-wrap items-center gap-2">
            {canAttach ? <button type="button" className={BTN} onClick={onAttach} data-testid={`${testId}-attach`}>Attach to scenario</button> : null}
            <button type="button" className={`${LINK} min-h-[34px] px-1.5 text-[13px]`} onClick={() => setGone(true)} data-testid={`${testId}-discard`}>Discard</button>
            <span className={`text-[12px] ${MUTED}`}>Nothing lands until you attach it.</span>
          </div>
        )}
    </section>
  );
}

/** The name dialogs: New scenario, Duplicate and Rename. */
function NameDialog({ copy, initial, onClose, onSave, testId }) {
  const [name, setName] = useState(initial);
  const write = useWrite(null);
  const err = nameError(name);
  return (
    <CapTableDialog title={copy.title} onClose={onClose} action={copy.action} disabled={!!err} write={write} testId={testId}
      onAction={() => write.run(() => onSave(name.trim()))}>
      {copy.lines.map((l) => <p key={l} className="m-0">{l}</p>)}
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>Scenario name</span>
        <input className={INPUT} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid={`${testId}-name`} />
      </label>
      {err ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid={`${testId}-name-error`}>{err}</p> : null}
    </CapTableDialog>
  );
}

function ConfirmDialog({ copy, onClose, onGo, tone, testId }) {
  const write = useWrite(null);
  return (
    <CapTableDialog title={copy.title} onClose={onClose} action={copy.action} tone={tone} write={write} testId={testId} onAction={() => write.run(onGo)}>
      {copy.lines.map((l) => <p key={l} className="m-0">{l}</p>)}
    </CapTableDialog>
  );
}

// ─────────────────────────────────────────────────────────── the list (CT6)

export function ScenariosList({ projectId, reload, retry, search }) {
  const navigate = useNavigate();
  const read = useRead(readCompare, projectId, reload);
  const today = useRead(readToday, projectId, reload);
  const { plan, writes } = useWrites(projectId);
  const [picked, setPicked] = useState([]);
  const [creating, setCreating] = useState(false);
  const cards = read.status === 'ready' ? scenarioCards(read.data) : [];
  const start = read.status === 'ready' ? newScenarioInputs(today.status === 'ready' ? today.data : null, read.data?.canonical) : null;
  const create = async (name) => {
    const made = await capTableScenariosApi.create(projectId, { name, inputs: start.inputs });
    navigate(scenarioHref(made.uid, search));
    return made;
  };
  return (
    <div className="flex flex-col gap-3.5" data-testid="captable-scenarios">
      <div className="flex flex-wrap items-center gap-2.5" data-testid="captable-scenarios-head">
        {!plan
          ? <span className="inline-flex min-h-[30px] items-center rounded-full border border-axal-lavender-edge bg-axal-lavender px-3 text-[12.5px] font-bold text-axal-violet dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-violet-400" data-testid="captable-scenarios-plan">{PLAN_LINE} Everything here still reads.</span>
          : <span className={`text-[13px] font-semibold ${INK}`}>{read.status === 'ready' ? scenariosHead(read.data, today.status === 'ready' ? today.data : null) : 'Scenarios'}</span>}
        {writes && start ? <button type="button" className={BTN} onClick={() => setCreating(true)} data-testid="captable-scenario-new">New scenario</button> : null}
        {picked.length
          ? <Link className={BTN} to={compareHref(picked, search)} data-testid="captable-scenario-compare">Compare selected ({picked.length})</Link>
          : <span className={`text-[12px] ${MUTED}`}>Tick up to {MAX_COMPARE} to compare them with Today.</span>}
      </div>
      {today.status === 'ready' && !today.data?.today?.available
        ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="captable-scenarios-no-today">{today.data?.today?.sentence || 'Nothing is recorded yet.'} A new scenario starts from your saved model until the record holds shares.</p>
        : null}
      {today.status === 'error' ? <div data-testid="captable-scenarios-today-unreadable"><Unreadable what="Today, from the record" claim="Your scenarios still draw." onRetry={retry} /></div> : null}
      <ReadState read={read} what="Your scenarios" claim="This is not a claim that none are saved." onRetry={retry} testId="captable-scenarios">
        {cards.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-scenarios-none">No scenarios yet, and no saved model. Record what was issued on Overview, then start a scenario from it.</p>
          : (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((s) => (
                <div key={s.uid || s.name} className={`${CARD} flex flex-col gap-1.5 px-3.5 py-3`} data-testid="captable-scenario-card">
                  <span className={EYEBROW}>{s.model ? 'Main cap table' : 'Scenario'}</span>
                  <Link to={scenarioHref(s.uid, search)} className={`text-[14px] font-extrabold ${INK} hover:text-axal-violet dark:hover:text-violet-400`} data-testid="captable-scenario-open">{s.name}</Link>
                  <span className={`flex flex-wrap items-center gap-2 text-[12px] ${MUTED}`}>{s.start} <Tag kind="modelled" /></span>
                  <span className={`border-t border-axal-hairline pt-2 font-mono text-[12px] leading-[1.5] ${INK} dark:border-gray-700`}>{s.round}</span>
                  <span className={`text-[12px] ${MUTED}`}>Founders after <span className={MONO}>{s.founders}</span> · changed {s.changed}{s.computed ? '' : ' · not computed'}</span>
                  {s.uid ? (
                    <label className={`flex items-center gap-2 text-[12.5px] font-semibold ${INK}`}>
                      <input type="checkbox" checked={picked.includes(s.uid)} disabled={!picked.includes(s.uid) && picked.length >= MAX_COMPARE}
                        onChange={() => setPicked((p) => toggleCompare(p, s.uid))} data-testid="captable-scenario-pick" />
                      Compare
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          )}
      </ReadState>
      {creating && start ? (
        <NameDialog copy={dialogCopy('new', null, { from: start.from })} initial={nextName(read.data)} testId="captable-scenario-new-dialog"
          onClose={() => setCreating(false)} onSave={create} />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── one scenario (CT6, CT9)

/** Runs a scenario (a request from `runRequest`, or a draft's) and keeps the latest answer. */
function useRun(projectId, request) {
  const key = request ? JSON.stringify(request) : null;
  const [run, setRun] = useState({ status: 'idle', data: null });
  useEffect(() => {
    if (!key) { setRun({ status: 'idle', data: null }); return undefined; }
    const req = JSON.parse(key);
    if (req.errors?.length) { setRun({ status: 'invalid', data: null, errors: req.errors }); return undefined; }
    let alive = true;
    setRun((r) => ({ status: 'loading', data: r.data }));
    const call = req.kind === 'today'
      ? capTableScenariosApi.simulate(projectId, req.body)
      : capTableScenariosApi.simulateModel(req.inputs).then((result) => ({ source: 'model', inputs: req.inputs, result }));
    call.then((data) => { if (alive) setRun({ status: 'ready', data }); })
      .catch((e) => { if (alive) setRun({ status: 'refused', data: null, errors: variantSaveErrors(e) }); });
    return () => { alive = false; };
  }, [projectId, key]);
  return run;
}

function TodayEditor({ draft, setDraft, instruments }) {
  const putRound = (k, field) => (e) => setDraft((d) => ({ ...d, rounds: d.rounds.map((r, j) => (j === k ? { ...r, [field]: e.target.value } : r)) }));
  return (
    <div className="flex flex-col gap-3" data-testid="captable-scenario-inputs">
      {draft.rounds.map((r, k) => (
        <fieldset key={k} className="m-0 flex flex-col gap-2 border-0 border-t border-axal-hairline p-0 pt-2 dark:border-gray-700" data-testid="captable-scenario-round">
          <div className="flex items-center justify-between">
            <legend className={EYEBROW}>Round {k + 1}</legend>
            <button type="button" className={`${LINK} text-[12px]`} onClick={() => setDraft((d) => ({ ...d, rounds: d.rounds.filter((_, j) => j !== k) }))} aria-label={`Remove round ${k + 1}`}>Remove</button>
          </div>
          {[['name', 'Round name'], ['pre_money', 'Pre-money'], ['investment', 'Amount raised'], ['pool', 'Pool target, % after the round']].map(([f, label]) => (
            <label key={f} className="flex flex-col gap-1">
              <span className={EYEBROW}>{label}</span>
              <input className={`${INPUT} ${f === 'name' ? '' : MONO}`} inputMode={f === 'name' ? 'text' : 'decimal'} value={r[f]} onChange={putRound(k, f)} aria-label={`Round ${k + 1} ${label}`} />
            </label>
          ))}
          <div className="flex flex-col gap-1" role="radiogroup" aria-label={`Who pays for round ${k + 1}'s top-up`}>
            <span className={EYEBROW}>Who pays for the top-up</span>
            <span className="flex flex-wrap gap-1.5">
              {[['pre_money', 'Pre-money (founders)'], ['post_money', 'Post-money (everyone)']].map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={r.payer === v} onClick={() => setDraft((d) => ({ ...d, rounds: d.rounds.map((x, j) => (j === k ? { ...x, payer: v } : x)) }))}
                  className={`min-h-[30px] rounded-full border px-3 text-[12px] font-bold ${r.payer === v ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-violet-400' : `border-axal-hairline ${MUTED} dark:border-gray-700`}`}
                  data-testid={`captable-scenario-payer-${v}`}>{label}</button>
              ))}
            </span>
          </div>
        </fieldset>
      ))}
      <button type="button" className={`${LINK} self-start text-[12.5px]`} onClick={() => setDraft((d) => ({ ...d, rounds: [...d.rounds, { name: '', pre_money: '', investment: '', pool: '', payer: 'pre_money' }] }))} data-testid="captable-scenario-add-round">Add a round</button>
      <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYEBROW}>Instruments that convert</span>
        {instruments.length === 0
          ? <span className={`text-[12px] ${MUTED}`}>The record holds no SAFE or note that has not converted.</span>
          : instruments.map((x) => (
            <label key={x.name} className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
              <input type="checkbox" checked={!draft.holdOut.includes(x.name)} data-testid="captable-scenario-converts"
                onChange={() => setDraft((d) => ({ ...d, holdOut: d.holdOut.includes(x.name) ? d.holdOut.filter((n) => n !== x.name) : [...d.holdOut, x.name] }))} />
              {x.name} · <span className={MONO}>{dollars(x.amount)}</span>
            </label>
          ))}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYEBROW}>New investors</span>
        <span className={`text-[12px] ${MUTED}`}>Each round’s new money is one line, “{draft.rounds[0]?.name || 'Round'} Investors”: the engine does not split it by investor, so who invests is not modelled here.</span>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYEBROW}>Exit values (up to {MAX_EXITS})</span>
        {draft.exits.map((v, k) => (
          <span key={k} className="flex items-center gap-2">
            <input className={`${INPUT} ${MONO}`} inputMode="decimal" value={v} aria-label={`Exit value ${k + 1}`}
              onChange={(e) => setDraft((d) => ({ ...d, exits: d.exits.map((x, j) => (j === k ? e.target.value : x)) }))} />
            <button type="button" className={`${LINK} text-[12px]`} aria-label={`Remove exit value ${k + 1}`} onClick={() => setDraft((d) => ({ ...d, exits: d.exits.filter((_, j) => j !== k) }))}>Remove</button>
          </span>
        ))}
        {draft.exits.length < MAX_EXITS
          ? <button type="button" className={`${LINK} self-start text-[12.5px]`} onClick={() => setDraft((d) => ({ ...d, exits: [...d.exits, ''] }))} data-testid="captable-scenario-add-exit">Add an exit value</button>
          : null}
        {draft.exits.length === 0 ? <span className={`text-[12px] ${MUTED}`}>No exit value yet, so no waterfall is drawn.</span> : null}
      </div>
    </div>
  );
}

function ResultsBlocks({ run, onRecord, today }) {
  if (run.status === 'idle') return null;
  if (run.status === 'invalid' || run.status === 'refused') {
    return (
      <ul className="m-0 flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-800 dark:border-red-400/50 dark:bg-red-400/10 dark:text-red-400" data-testid="captable-scenario-run-errors">
        {(run.errors || []).map((m) => <li key={m} className="ml-4">{m}</li>)}
      </ul>
    );
  }
  if (!run.data) return <Skeleton testId="captable-scenario-run-loading" />;
  const result = run.data.result || {};
  if (result.errors) return <ul className="m-0 text-[12.5px] text-red-700 dark:text-red-400" data-testid="captable-scenario-run-errors">{result.errors.map((m) => <li key={m}>{m}</li>)}</ul>;
  const rows = beforeAfter(result, todayPrice(today, onRecord));
  const events = roundEvents(result);
  const notes = [...engineNotes(result), ...notModelled(run.data)];
  return (
    <>
      <Block title="Before and after" tags={<>{onRecord ? <Tag kind="record" /> : null}<Tag kind="modelled" /></>} testId="captable-scenario-results"
        foot={onRecord ? 'Today is on record. Everything after the round is Modelled.' : 'The start is your typed model, not the record. Everything here is Modelled.'}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-testid="captable-scenario-results-table">
            <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
              {['Holder or group', onRecord ? 'Today' : 'Start', `After ${result.rounds?.length ? result.rounds[result.rounds.length - 1].name : 'the rounds'}`, 'Change'].map((c) => <th key={c} className={TH}>{c}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-axal-ground last:border-b-0 dark:border-gray-700" data-testid="captable-scenario-result-row">
                  <td className={`${TD} ${r.group ? 'font-bold' : 'pl-6'}`}>{r.label}</td>
                  <td className={`${TD} ${MONO} ${MUTED}`}>{r.before}{r.note ? <span className="block font-sans text-[11px]" data-testid="captable-scenario-before-note">{r.note}</span> : null}</td>
                  <td className={`${TD} ${MONO} font-bold`}>{r.after}</td>
                  <td className={`${TD} ${MONO}`}>{r.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      <Block title="What happens in each round" tags={<Tag kind="modelled" />} testId="captable-scenario-events">
        {events.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No round is planned, so nothing changes yet.</p>
          : events.map((e) => (
            <div key={e.round} className="flex flex-col gap-1">
              <span className={EYEBROW}>{e.round}</span>
              {e.lines.map((l) => <span key={l} className={`flex gap-2 text-[12.5px] ${INK}`} data-testid="captable-scenario-event"><span aria-hidden="true" className="text-axal-violet dark:text-violet-400">→</span>{l}</span>)}
            </div>
          ))}
        {notes.length ? <ul className={`m-0 flex list-none flex-col gap-1 p-0`} data-testid="captable-scenario-notes">{notes.map((n) => <li key={n} className={AMBER}>{n}</li>)}</ul> : null}
      </Block>
    </>
  );
}

/** The exit waterfall (CT9) of one run: the table at a chosen exit, the step chart, and Eadwyn's order of payment. */
function WaterfallBlocks({ result, assumptions, attached, canAttach, onAttach }) {
  const list = waterfallsOf(result);
  const [at, setAt] = useState(0);
  if (!list.length) {
    return <Block title="Exit waterfall" tags={<Tag kind="modelled" />} testId="captable-waterfall"><p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-waterfall-none">No exit value is set, so no waterfall is drawn. Add one in the inputs.</p></Block>;
  }
  const pick = list[Math.min(at, list.length - 1)];
  const ledger = result?.rounds?.length ? result.rounds[result.rounds.length - 1].ledger : result?.founding;
  const table = waterfallTable(pick.wf, ledger);
  const steps = shareSteps(result);
  const read = paymentReadBack(pick.wf);
  const assume = `Assumptions: ${assumptions.join(' ')}`;
  return (
    <>
      <Block title={`Exit waterfall · ${dollars(pick.exit)} exit`} tags={<Tag kind="modelled" />} testId="captable-waterfall" foot={table ? `${table.foot} ${assume}` : assume}
        aside={list.length > 1 ? (
          <label className={`flex items-center gap-2 text-[12px] ${MUTED}`}>Exit
            <select className={`${INPUT} w-auto`} value={Math.min(at, list.length - 1)} onChange={(e) => setAt(Number(e.target.value))} data-testid="captable-waterfall-exit">
              {list.map((w, i) => <option key={w.exit} value={i}>{dollars(w.exit)}</option>)}
            </select>
          </label>
        ) : null}>
        {!table
          ? <p className={AMBER} data-testid="captable-waterfall-not-calculated">This exit is not calculated. {engineNotes(result).join(' ')}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" data-testid="captable-waterfall-table">
                <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{['Holder', 'Group', 'Preference', 'Takes the preference or converts', 'Payout'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.holder} className="border-b border-axal-ground last:border-b-0 dark:border-gray-700" data-testid="captable-waterfall-row">
                      <td className={`${TD} font-bold`}>{r.holder}</td>
                      <td className={TD}>{r.group}</td>
                      <td className={`${TD} ${MONO}`}>{r.preference}</td>
                      <td className={TD}>{r.takes}</td>
                      <td className={`${TD} ${MONO} font-bold`}>{r.payout}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Block>
      <ChartBlock title="Share of the exit, by group" testId="captable-steps"
        alt={`The share of each exit that founders, investors and employees take, at ${steps.columns.map((c) => dollars(c.exit)).join(', ')}.${steps.points.length ? ` ${steps.points.map((p) => `${p.holder} converts above ${short(p.at)}`).join('; ')}.` : ''}`}
        legend={GROUPS.slice(0, 3).map((g) => ({ label: g.label, tone: g.tone }))}
        table={{ head: ['Exit', ...GROUPS.slice(0, 3).map((g) => g.label)], rows: steps.columns.map((c) => [dollars(c.exit), ...(c.shares ? [c.shares.founders, c.shares.investors, c.shares.people].map((v) => `${v.toFixed(2)}%`) : ['not recorded', 'not recorded', 'not recorded'])]) }}
        foot={steps.paidInFull != null ? `Exit value on a log scale. Up to ${short(steps.paidInFull)}, investors take everything as preferences.` : 'Exit value on a log scale.'}>
        <ExitSteps columns={steps.columns.map((c) => ({ exit: c.exit, label: short(c.exit), parts: c.shares ? [{ value: c.shares.founders, tone: 'violet' }, { value: c.shares.investors, tone: 'sky' }, { value: c.shares.people, tone: 'muted' }] : null }))}
          markers={[...(steps.paidInFull != null ? [{ at: steps.paidInFull, label: `Preferences paid in full at ${short(steps.paidInFull)}` }] : []), ...steps.points.map((p) => ({ at: p.at, label: `${p.holder} converts above ${short(p.at)}` }))]} />
      </ChartBlock>
      <EadwynBand read={read} attached={attached} canAttach={canAttach} onAttach={() => onAttach(read)} testId="captable-ead-payment" />
    </>
  );
}

export function ScenarioPage({ projectId, uid, search, reload, retry }) {
  const navigate = useNavigate();
  const [own, setOwn] = useState(0);
  const read = useRead(readScenario, uid, `${reload}-${own}`);
  const today = useRead(readToday, projectId, reload);
  const { plan, writes } = useWrites(projectId);
  const scenario = read.status === 'ready' ? read.data : null;
  const model = scenario && !scenario.is_variant;
  const today_ = fromToday(scenario);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saveErrors, setSaveErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(null);
  useEffect(() => { if (scenario) { setDraft(today_ ? todayDraft(scenario) : draftFromScenario(scenario)); setSaveErrors([]); } }, [scenario, today_]);
  const instruments = today.status === 'ready' && today.data?.today?.available ? today.data.today.inputs?.safes || [] : [];
  const request = useMemo(() => {
    if (!scenario || !draft) return null;
    if (model) return runRequest(scenario);
    if (today_) {
      if (today.status !== 'ready') return null;
      const { errors, body } = todayBody(draft, instruments);
      return errors.length ? { errors } : { kind: 'today', body };
    }
    const { errors, inputs } = inputsFromDraft(draft);
    return errors.length ? { errors } : { kind: 'model', inputs: { ...inputs, ...(inputs.exit_value != null ? { exit_values: [inputs.exit_value] } : {}) } };
  }, [scenario, draft, model, today_, today.status, instruments]);
  const run = useRun(projectId, request);
  const assumptions = today.status === 'ready' && Array.isArray(today.data?.assumptions) ? today.data.assumptions : ASSUMPTIONS_FALLBACK;
  const edit = (f) => { setSaved(false); setDraft(f); };

  const save = async () => {
    setSaved(false); setSaveErrors([]);
    let inputs;
    if (today_) {
      if (run.status !== 'ready') { setSaveErrors(run.errors?.length ? run.errors : ['The results are still being worked out. Save again in a moment.']); return; }
      inputs = run.data.inputs;
    } else {
      const out = inputsFromDraft(draft);
      if (out.errors.length) { setSaveErrors(out.errors); return; }
      inputs = out.inputs;
    }
    setSaving(true);
    try {
      await capTableScenariosApi.update(uid, { name: scenario.name, inputs: withNotes(inputs, scenario.inputs, { keep: sameInputs(inputs, scenario.inputs) }) });
      setSaved(true);
      setOwn((n) => n + 1);
    } catch (e) { setSaveErrors(variantSaveErrors(e)); } finally { setSaving(false); }
  };
  const attach = (r) => setDialog({ kind: 'attach', read: r });
  const done = () => { setDialog(null); setOwn((n) => n + 1); };

  return (
    <div className="flex flex-col gap-3.5" data-testid="captable-scenario-page">
      <Link className={`${LINK} self-start text-[12.5px]`} to={`${SCENARIOS_PATH}${tabSearch(search)}`} data-testid="captable-scenario-back">‹ All scenarios</Link>
      <ReadState read={read} what="This scenario" claim="This is not a claim that it was deleted." onRetry={retry} testId="captable-scenario">
        {scenario ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={`m-0 flex flex-wrap items-center gap-2 text-[18px] font-extrabold ${INK}`} data-testid="captable-scenario-name">
                {model ? 'Cap table · model' : scenario.name} <Tag kind="modelled" />
                <span className={`text-[12px] font-semibold ${MUTED}`}>{model ? 'Your saved model' : today_ ? 'Starts from Today' : 'Starts from your model'}</span>
              </h2>
              {writes ? (
                <span className="flex flex-wrap gap-2" data-testid="captable-scenario-actions">
                  <button type="button" className={BTN} onClick={() => setDialog({ kind: 'duplicate' })} data-testid="captable-scenario-duplicate">Duplicate</button>
                  {!model ? <button type="button" className={BTN} onClick={() => setDialog({ kind: 'rename' })} data-testid="captable-scenario-rename">Rename</button> : null}
                  {!model ? <button type="button" className={BTN} onClick={() => setDialog({ kind: 'delete' })} data-testid="captable-scenario-delete">Delete</button> : null}
                </span>
              ) : null}
            </div>
            {model ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-scenario-model-locked">{MODEL_LOCKED}</p> : null}
            {!plan ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-scenario-plan">{PLAN_LINE} Everything here still reads.</p>
              : !writes && !model ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-scenario-read-only">{READ_ONLY}</p> : null}
            <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Block title="Inputs" testId="captable-scenario-inputs-block">
                {model
                  ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Duplicate the model to change its inputs.</p>
                  : !draft ? <Skeleton testId="captable-scenario-draft-loading" />
                    : today_
                      ? (today.status === 'ready'
                        ? (today.data?.today?.available
                          ? <TodayEditor draft={draft} setDraft={edit} instruments={instruments} />
                          : <p className={AMBER} data-testid="captable-scenario-no-today">{today.data?.today?.sentence || 'Nothing is recorded yet.'} This scenario starts from Today, so it cannot be run until the record holds shares.</p>)
                        : <ReadState read={today} what="Today, from the record" claim="This scenario’s inputs are kept." onRetry={retry} testId="captable-scenario-today">{null}</ReadState>)
                      : <VariantEditor draft={draft} setDraft={edit} onSave={save} saving={saving} errors={saveErrors} saved={saved} naming={false} />}
                {today_ && writes && draft ? (
                  <div className="flex flex-col gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700">
                    {saveErrors.length ? <ul className="m-0 text-[12.5px] text-red-700 dark:text-red-400" data-testid="captable-scenario-save-errors">{saveErrors.map((m) => <li key={m}>{m}</li>)}</ul> : null}
                    <span className="flex flex-wrap items-center gap-3">
                      <button type="button" className={PRIMARY} onClick={save} disabled={saving} data-testid="captable-scenario-save">{saving ? 'Saving…' : 'Save scenario'}</button>
                      {saved ? <span className="text-[12px] text-emerald-700 dark:text-emerald-400" data-testid="captable-scenario-saved">{SAVED}</span> : null}
                    </span>
                  </div>
                ) : null}
              </Block>
              <div className="flex min-w-0 flex-col gap-3.5">
                <ResultsBlocks run={run} onRecord={today_} today={today} />
                {run.status === 'ready' && run.data?.result && !run.data.result.errors ? (
                  <>
                    <EadwynBand read={roundReadBack(run.data.result)} attached={!!attachedRead(scenario.inputs, 'round')} canAttach={writes && !model} onAttach={() => attach(roundReadBack(run.data.result))} testId="captable-ead-round" />
                    <WaterfallBlocks result={run.data.result} assumptions={assumptions} attached={!!attachedRead(scenario.inputs, 'payment')} canAttach={writes && !model} onAttach={attach} />
                  </>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </ReadState>
      {dialog?.kind === 'duplicate' ? (
        <NameDialog copy={dialogCopy('duplicate', { name: model ? 'Cap table · model' : scenario.name })} initial={`${model ? 'Cap table · model' : scenario.name} · copy`} testId="captable-scenario-duplicate-dialog"
          onClose={() => setDialog(null)}
          onSave={async (name) => { const { notes: _n, ...inputs } = scenario.inputs || {}; const made = await capTableScenariosApi.create(projectId, { name, inputs }); navigate(scenarioHref(made.uid, search)); setDialog(null); return made; }} />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <NameDialog copy={dialogCopy('rename', scenario)} initial={scenario.name} testId="captable-scenario-rename-dialog"
          onClose={() => setDialog(null)} onSave={async (name) => { const out = await capTableScenariosApi.update(uid, { name, inputs: scenario.inputs }); done(); return out; }} />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog copy={dialogCopy('delete', scenario)} tone="danger" testId="captable-scenario-delete-dialog"
          onClose={() => setDialog(null)} onGo={async () => { const out = await capTableScenariosApi.remove(uid); navigate(`${SCENARIOS_PATH}${tabSearch(search)}`); return out; }} />
      ) : null}
      {dialog?.kind === 'attach' ? (
        <ConfirmDialog copy={dialogCopy('attach', scenario)} testId="captable-scenario-attach-dialog"
          onClose={() => setDialog(null)} onGo={async () => { const out = await capTableScenariosApi.update(uid, { name: scenario.name, inputs: attachRead(scenario.inputs, dialog.read) }); done(); return out; }} />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── compare (CT7, CT8)

function useCompareRuns(projectId, scenarios) {
  const exits = useMemo(() => compareExits(scenarios), [scenarios]);
  const key = JSON.stringify(scenarios.map((s) => s.uid));
  const [runs, setRuns] = useState([]);
  useEffect(() => {
    let alive = true;
    setRuns(scenarios.map(() => ({ status: 'loading', result: null })));
    scenarios.forEach((s, k) => {
      const req = runRequest(s, exits);
      const call = req.kind === 'today' ? capTableScenariosApi.simulate(projectId, req.body).then((d) => d.result) : capTableScenariosApi.simulateModel(req.inputs);
      call.then((result) => { if (alive) setRuns((r) => r.map((x, j) => (j === k ? { status: result?.errors ? 'error' : 'ready', result: result?.errors ? null : result } : x))); })
        .catch(() => { if (alive) setRuns((r) => r.map((x, j) => (j === k ? { status: 'error', result: null } : x))); });
    });
    return () => { alive = false; };
  // The uids name the runs; `scenarios` itself is a fresh array each read.
  }, [projectId, key]);
  return { runs, exits };
}

/** CT23c: the compare table one scenario per card, and that scenario's exit waterfall as a table. */
function PhoneCompare({ rows, cols, exits, todayError, assumptions }) {
  const cards = swipeCards(rows, cols);
  const [at, setAt] = useState(0);
  const track = useRef(null);
  const here = Math.min(at, Math.max(0, cards.length - 1));
  const go = (k) => {
    const n = Math.max(0, Math.min(cards.length - 1, k));
    setAt(n);
    const el = track.current;
    if (el && typeof el.scrollTo === 'function' && el.clientWidth) el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  };
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el?.clientWidth) setAt(Math.round(el.scrollLeft / el.clientWidth));
  };
  const table = exitTable(cols[here], exits);
  const pager = cards.length > 1 ? (
    <span className="flex items-center gap-1">
      <button type="button" className={BTN} onClick={() => go(here - 1)} disabled={here === 0} aria-label="Previous scenario" data-testid="captable-compare-prev">‹</button>
      <button type="button" className={BTN} onClick={() => go(here + 1)} disabled={here === cards.length - 1} aria-label="Next scenario" data-testid="captable-compare-next">›</button>
    </span>
  ) : null;
  return (
    <>
      <Block title="Scenarios compared" tags={<><Tag kind="record" /><Tag kind="modelled" /></>} testId="captable-compare-swipe-block" aside={pager}
        foot="A share reads Today, from the record, then after the scenario's last round, Modelled.">
        {todayError ? <Unreadable what="Today, from the record" claim="The scenarios still draw." /> : null}
        <div ref={track} onScroll={onScroll} className="-mx-4 flex snap-x snap-mandatory overflow-x-auto" aria-roledescription="carousel" aria-label="Scenarios compared" data-testid="captable-compare-swipe">
          {cards.map((c, k) => (
            <section key={`${c.name}-${k}`} className="w-full shrink-0 snap-start px-4" aria-roledescription="slide" aria-label={`${c.name}, ${k + 1} of ${cards.length}`} aria-current={k === here ? 'true' : undefined} data-testid="captable-compare-card">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>{c.name}</h3>
                <span className={`${MONO} text-[11.5px] ${MUTED}`} data-testid="captable-compare-card-meta">{c.meta}</span>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {c.rows.map((r) => (
                  <li key={r.label} className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-2 dark:border-gray-700" data-testid="captable-compare-card-row">
                    <span className={`text-[12.5px] ${r.bold ? `font-bold ${INK}` : `pl-3 ${MUTED}`}`}>{r.label}</span>
                    <span className={`${MONO} text-[12.5px] font-bold ${INK}`}>{r.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Block>
      <Block title={`Exit waterfall · ${cols[here]?.name || 'Scenario'}`} tags={<Tag kind="modelled" />} testId="captable-compare-exit-table-block"
        foot={`Assumptions: ${assumptions.join(' ')}`}>
        {exits.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-compare-no-exits">None of these scenarios sets an exit value, so no waterfall is drawn.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" data-testid="captable-compare-exit-table">
                <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{table.head.map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.exit} className="border-b border-axal-ground last:border-b-0 dark:border-gray-700" data-testid="captable-compare-exit-row">
                      {r.cells.map((v, i) => <td key={i} className={`${TD} ${MONO} ${i === 0 ? 'font-bold' : ''}`}>{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Block>
    </>
  );
}

function CompareBody({ projectId, scenarios, today, search, writes, onAttached }) {
  const { runs, exits } = useCompareRuns(projectId, scenarios);
  const [attaching, setAttaching] = useState(null);
  const phone = usePhoneWidth();
  const todayResult = today.status === 'ready' && today.data?.today?.available ? today.data.today.result : null;
  const cols = scenarios.map((s, k) => ({ name: s.is_variant ? s.name : 'Cap table · model', short: shortName(s.is_variant ? s.name : 'Model'), fromToday: fromToday(s), result: runs[k]?.result || null, status: runs[k]?.status || 'loading' }));
  const rows = compareRows(todayResult, cols, todayPrice(today, true));
  const panels = founderPanels(cols);
  const exitsDrawn = exitPanels(cols, exits);
  const assumptions = today.status === 'ready' && Array.isArray(today.data?.assumptions) ? today.data.assumptions : ASSUMPTIONS_FALLBACK;
  const first = scenarios[0];
  const firstRead = runs[0]?.status === 'ready' ? roundReadBack(runs[0].result) : null;
  const head = ['', todayResult ? '┊ Today · on record' : '┊ Today · nothing recorded', ...cols.map((c) => c.name)];
  const readBack = (
    <>
      {first && firstRead ? (
        <EadwynBand read={{ ...firstRead, title: `Read the round back · ${cols[0].name}` }} attached={!!attachedRead(first.inputs, 'round')}
          canAttach={writes && !!first.is_variant} onAttach={() => setAttaching(firstRead)} testId="captable-ead-compare" />
      ) : null}
      {attaching ? (
        <ConfirmDialog copy={dialogCopy('attach', first)} testId="captable-compare-attach-dialog" onClose={() => setAttaching(null)}
          onGo={async () => { const out = await capTableScenariosApi.update(first.uid, { name: first.name, inputs: attachRead(first.inputs, attaching) }); setAttaching(null); onAttached(); return out; }} />
      ) : null}
    </>
  );
  if (phone) {
    return (
      <>
        <PhoneCompare rows={rows} cols={cols} exits={exits} todayError={today.status === 'error'} assumptions={assumptions} />
        {readBack}
      </>
    );
  }
  return (
    <>
      <Block title="Scenarios compared" tags={<><Tag kind="record" /><Tag kind="modelled" /></>} testId="captable-compare-table-block"
        aside={<Link className={`${LINK} text-[12px]`} to={`${SCENARIOS_PATH}${search}`} data-testid="captable-compare-change">Change the selection</Link>}
        foot={`The Today column is the record. The ${cols.length === 1 ? 'scenario column is' : `${cols.length} scenario columns are`} Modelled.${exits.length ? ` Each is run at the same exits: ${exits.map(dollars).join(', ')}.` : ''}`}>
        {today.status === 'error' ? <Unreadable what="Today, from the record" claim="The scenarios still draw." /> : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-testid="captable-compare-table">
            <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{head.map((c, i) => <th key={`${c}-${i}`} className={`${TH} ${i === 1 ? 'border-l border-dotted border-axal-muted' : ''}`}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-axal-ground last:border-b-0 dark:border-gray-700" data-testid="captable-compare-row">
                  <td className={`${TD} ${r.bold ? 'font-bold' : 'pl-6'}`}>{r.label}</td>
                  {r.cells.map((v, i) => <td key={i} className={`${TD} ${MONO} ${i === 0 ? `border-l border-dotted border-axal-muted ${MUTED}` : ''}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      <ChartBlock title="Founder ownership" testId="captable-compare-founders"
        alt={panels.map((p) => `${p.name}: ${p.series.map((s) => `${s.label} from ${s.values[0] ?? 'not recorded'}% to ${s.values[s.values.length - 1] ?? 'not recorded'}%`).join(', ')}`).join('. ')}
        legend={[...new Map(panels.flatMap((p) => p.series).map((s) => [s.label, { label: s.label, tone: s.tone, mark: 'line' }])).values(), { label: 'Today · on record (dotted point)', tone: 'dotted' }]}
        table={{ head: ['Scenario · founder', 'Points'], rows: panels.flatMap((p) => p.series.map((s) => [`${p.name} · ${s.label}`, s.values.map((v, i) => `${p.labels[i]} ${v == null ? 'not recorded' : `${v}%`}`).join(' → ')])) }}>
        {panels.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`}>The scenarios are still being worked out.</p>
          : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="captable-compare-panels">
              {panels.map((p) => (
                <div key={p.name} className="flex min-w-0 flex-col gap-1" data-testid="captable-compare-panel">
                  <span className={`text-[12px] font-bold ${INK}`}>{p.name}</span>
                  <WeekLines series={p.series} labels={p.labels} currentIndex={-1} recordIndex={p.onRecord ? 0 : null} suffix="%" height={200} />
                </div>
              ))}
            </div>
          )}
      </ChartBlock>
      <ChartBlock title="Exit waterfall" testId="captable-compare-exits"
        alt={exitsDrawn.map((e) => `At a ${dollars(e.exit)} exit: ${e.rows.map((r) => (r.by ? `${r.label}, founders ${short(r.by.founders)}` : `${r.label} not calculated`)).join('; ')}`).join('. ')}
        legend={GROUPS.slice(0, 3).map((g) => ({ label: g.label, tone: g.tone }))}
        table={{ head: ['Exit · scenario', ...GROUPS.slice(0, 3).map((g) => g.label)], rows: exitsDrawn.flatMap((e) => e.rows.map((r) => [`${dollars(e.exit)} · ${r.label}`, ...(r.by ? [r.by.founders, r.by.investors, r.by.people].map(dollars) : ['not recorded', 'not recorded', 'not recorded'])])) }}
        foot={`Assumptions: ${assumptions.join(' ')} Over each bar, F is what founders take.`}>
        {exits.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-compare-no-exits">None of these scenarios sets an exit value, so no waterfall is drawn.</p>
          : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {exitsDrawn.map((e) => (
                <div key={e.exit} className="flex min-w-0 flex-col gap-1" data-testid="captable-compare-exit">
                  <span className={`text-[12px] font-bold ${INK}`}>{dollars(e.exit)} exit</span>
                  <Columns rows={e.rows} height={200} />
                </div>
              ))}
            </div>
          )}
      </ChartBlock>
      {readBack}
    </>
  );
}

const readMany = (key) => Promise.all(JSON.parse(key).map((uid) => capTableScenariosApi.get(uid)));

export function ComparePage({ projectId, search, reload, retry }) {
  const ids = compareIds(search);
  const [own, setOwn] = useState(0);
  const read = useRead(readMany, ids.length ? JSON.stringify(ids) : null, `${reload}-${own}`);
  const today = useRead(readToday, projectId, reload);
  const { writes } = useWrites(projectId);
  const back = () => `${SCENARIOS_PATH}${tabSearch(search)}`;
  if (!ids.length) {
    return <p className={`m-0 text-[13px] ${INK}`} data-testid="captable-compare-none">No scenario is chosen to compare. <Link className={LINK} to={back()}>Tick up to {MAX_COMPARE} on Scenarios</Link>.</p>;
  }
  return (
    <div className="flex flex-col gap-3.5" data-testid="captable-compare-page">
      <Link className={`${LINK} self-start text-[12.5px]`} to={back()}>‹ All scenarios</Link>
      <ReadState read={read} what="These scenarios" claim="This is not a claim that they were deleted." onRetry={retry} testId="captable-compare">
        {read.status === 'ready' ? <CompareBody projectId={projectId} scenarios={read.data} today={today} search={tabSearch(search)} writes={writes} onAttached={() => setOwn((n) => n + 1)} /> : null}
      </ReadState>
    </div>
  );
}

/** `/scenarios/<id>`: the compare page for `compare`, else the scenario. */
export function ScenarioRoute({ id, ...rest }) {
  return id === COMPARE ? <ComparePage {...rest} /> : <ScenarioPage uid={id} {...rest} />;
}

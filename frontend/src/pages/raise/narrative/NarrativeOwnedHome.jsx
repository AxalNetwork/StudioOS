/**
 * D7103 (#7103, Raise v2 RA-14 and RA-17) — Investor narrative's own Home: the page the module owns, drawn in
 * place of the cycle's generic "at a glance" card and records table (D6049's `homes`, as Fundraising readiness
 * does), with its header action, Save version, and the dialog that action opens. Every value is from the module
 * read's `parts.narrative`; the words and states are `narrativeHomeModel.js`'s.
 */
import React, { useMemo, useReducer, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cyclesWrite } from '../../../lib/api/cycles';
import { Lightbox } from '../../../ui';
import { DataState, StateChip } from '../../../ui/Honesty.jsx';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { NarrativeHome } from './NarrativeTool';
import { NarrativeReads } from './NarrativeAdmin';
import {
  AUDIENCES, SAVE_ACTION, SAVE_FAILED, SETUP_LINE, SETUP_READER, SETUP_TITLE, NOT_RECORDED_REASON, VERSIONS_UNAVAILABLE,
  closeSaveHref, homeView, isSaveOpen, isSaveRefusal, saveBody, saveHref, saveLine, saveReducer, saveStart, saveVersionAction,
  setupActions, singleFlight, stateLine, versionRows,
} from './narrativeHomeModel';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-[36px]';
const BTN_SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 lg:min-h-[36px]';
const SELECT = 'min-h-[44px] w-full rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 lg:min-h-[36px]';
const TONE = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  attention: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

/** One state as a chip: a Value is a toned pill with its words; every other state is #5129's own chip. */
function Chip({ item }) {
  if (item.kind === 'value') {
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONE[item.tone] || TONE.muted}`} data-platform-state="value">{item.label}</span>;
  }
  return <StateChip kind={item.kind} label={item.label} title={item.reason || undefined} />;
}

/** RA-17's state line under the header. */
function StateLine({ part }) {
  const items = stateLine(part);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="narrative-state-line">
      {items.map((item) => <span key={item.key} className="inline-flex items-center gap-1"><Chip item={item} />{item.reason && item.kind !== 'value' ? <span className={`text-[11px] ${MUTED}`}>{item.reason}</span> : null}</span>)}
    </div>
  );
}

/** RA-17's Versions: a table on a desktop, one stacked row per version on a phone (no table wider than the screen). */
function VersionsCard({ part, phone }) {
  const rows = versionRows(part);
  return (
    <section className={CARD} data-testid="narrative-home-versions">
      <div className="flex items-baseline justify-between border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Versions</h2>
        <span className={`text-[12px] ${MUTED}`}>Each saved version keeps its words</span>
      </div>
      {phone ? (
        <ul className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="narrative-home-version-row">
              <span className={`text-[13.5px] font-bold ${INK}`}>{r.version}{r.current ? ' · Current' : ''}</span>
              <span className={`text-[12px] ${MUTED}`}>Saved {r.saved} · by {r.by} · from {r.basedOn}</span>
              <span className={`text-[12px] ${MUTED}`}>Used by: {r.usedBy}</span>
              <span><Chip item={r.consistency} /></span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={`border-b border-axal-hairline dark:border-gray-800 ${MUTED}`}>
                {['Version', 'Saved', 'By', 'Based on', 'Used by', 'Consistency'].map((c) => <th key={c} scope="col" className="px-4 py-2 font-bold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="narrative-home-version-row">
                  <td className={`px-4 py-2.5 font-bold ${INK}`}>{r.version}{r.current ? ' · Current' : ''}</td>
                  <td className={`px-4 py-2.5 font-mono ${INK}`}>{r.saved}</td>
                  <td className={`px-4 py-2.5 ${INK}`}>{r.by}</td>
                  <td className={`px-4 py-2.5 ${INK}`}>{r.basedOn}</td>
                  <td className={`px-4 py-2.5 ${INK}`}>{r.usedBy}</td>
                  <td className="px-4 py-2.5"><Chip item={r.consistency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** First use: one card and its set-up actions, the first the page's one primary; a reader reads one line. */
function SetupCard({ standing, search }) {
  const actions = setupActions(standing, search);
  return (
    <section className={`${CARD} flex flex-col items-start gap-2.5 p-5 lg:p-7`} data-testid="narrative-setup">
      <h2 className={`m-0 text-[18px] font-extrabold tracking-[-.015em] ${INK}`}>{actions.length ? SETUP_TITLE : SETUP_READER}</h2>
      {actions.length ? <p className={`m-0 max-w-[560px] text-[13.5px] leading-relaxed ${MUTED}`}>{SETUP_LINE}</p> : null}
      {actions.length ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {actions.map((a) => <Link key={a.key} to={a.href} className={a.primary ? BTN : BTN_SECONDARY} data-testid={`narrative-setup-${a.key}`}>{a.label}</Link>)}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Save version (RA-14): the audience the new version is for, what it creates, and one write per press. A
 * refusal keeps the dialog open with the choices as they were and the Worker's sentence; nothing else changes.
 */
export function SaveVersionDialog({ part, projectId, onClose, onSaved }) {
  const [state, dispatch] = useReducer(saveReducer, part, saveStart);
  const latest = useRef(state);
  latest.current = state;
  const write = useMemo(() => singleFlight((draft) => cyclesWrite.raise.narrativeVersion(projectId, saveBody(draft))), [projectId]);
  const press = () => {
    const before = latest.current;
    const next = saveReducer(before, { type: 'press' });
    // The ref moves with the press, so a second press in the same frame reads "saving" and starts nothing.
    latest.current = next;
    dispatch({ type: 'press' });
    if (next.status !== 'saving') return;
    write(before.draft)
      .then((res) => { dispatch({ type: 'saved', version: res?.version ?? null }); onSaved?.(res); })
      .catch((e) => {
        const refused = isSaveRefusal(e);
        dispatch({ type: refused ? 'refused' : 'failed', message: refused ? userFacingRaiseError(e, { fallback: SAVE_FAILED }) : SAVE_FAILED });
      });
  };
  const saving = state.status === 'saving';
  return (
    <Lightbox label={SAVE_ACTION} title={`${SAVE_ACTION}?`} onClose={saving ? () => {} : onClose} width={480} testId="narrative-save-dialog"
      footer={(
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={BTN} onClick={press} disabled={saving} aria-busy={saving || undefined} data-testid="narrative-save-confirm">
            {saving ? 'Saving…' : SAVE_ACTION}
          </button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={`text-[12px] font-bold ${INK}`}>Who is this version for?</span>
          <select className={SELECT} value={state.draft.audience} disabled={saving} data-testid="narrative-save-audience"
            onChange={(e) => dispatch({ type: 'edit', patch: { audience: e.target.value } })}>
            {state.draft.audience ? null : <option value="">Choose an audience</option>}
            {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <p className={`m-0 text-[13px] leading-relaxed ${INK}`} data-testid="narrative-save-line">{saveLine(state.draft, part)}</p>
        {state.error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="narrative-save-error">{state.error}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * The Home body, handed the module page's props (`search`, `phone`, `onRetry`) by the cycle's `homes` entry and
 * the module read (`data`), the venture and a re-read by the entry itself.
 */
export default function NarrativeOwnedHome({ data, projectId = null, reload, search = '', phone = false, onRetry }) {
  const location = useLocation();
  const navigate = useNavigate();
  const view = homeView(data);
  const here = location.search || search;
  // D1463 (RR07): the founder's "Who read this narrative" stays on Home in every state, never a reader's.
  const reads = !view.standing.readOnly && projectId ? <NarrativeReads projectId={projectId} /> : null;

  if (view.state === 'loading') return <div className={`${CARD} p-4`} data-testid="narrative-home-loading"><DataState state="loading" size="block" /></div>;
  if (view.state === 'unavailable') {
    return (
      <div className="flex flex-col gap-3.5">
        <div className={`${CARD} p-4`} data-testid="narrative-home-unavailable">
          <DataState state="unavailable" size="block" what="Your narrative versions" claim={VERSIONS_UNAVAILABLE} onRetry={onRetry} />
        </div>
        {reads}
      </div>
    );
  }
  if (view.state === 'not_recorded') {
    return (
      <div className={`${CARD} p-4`} data-testid="narrative-home-not-recorded">
        <DataState state="not_recorded" size="block" reason={NOT_RECORDED_REASON} />
      </div>
    );
  }
  if (view.state === 'empty') return <div className="flex flex-col gap-3.5"><SetupCard standing={view.standing} search={here} />{reads}</div>;

  const action = saveVersionAction(data, { search: here });
  const open = action && !action.disabled && isSaveOpen(here);
  const close = () => navigate(closeSaveHref(here), { replace: true });
  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="narrative-owned-home">
      <StateLine part={view.part} />
      {action?.disabled ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="narrative-save-readonly">{action.reason}</p> : null}
      {/* On a phone the bar carries no action, so Home draws it, full width (D5081 part 1). */}
      {phone && action && !action.disabled ? <Link to={saveHref(here)} className={`${BTN} w-full`} data-testid="narrative-save-phone">{SAVE_ACTION}</Link> : null}
      {phone && action?.disabled ? <button type="button" className={`${BTN} w-full`} disabled data-testid="narrative-save-phone">{SAVE_ACTION}</button> : null}
      <NarrativeHome data={data} search={here} admin={view.standing.readOnly} projectId={projectId} />
      <VersionsCard part={view.part} phone={phone} />
      {open ? (
        <SaveVersionDialog part={view.part} projectId={projectId} onClose={close}
          onSaved={() => { close(); reload?.(); }} />
      ) : null}
    </div>
  );
}

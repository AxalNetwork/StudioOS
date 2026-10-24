import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { narrativeApi } from '../../../lib/api/narrative';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import { Lightbox, Unreadable } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import {
  MOVED_NOTICE, NOT_RECORDED, NO_FIGURES_READ, PROPOSAL_NOTE, PROPOSE_FOOT, REMOVED_LINE, WITHHELD_LINE,
  coreRows, isMoved, partItems, proposalRows, saveLine, tabSearch, versionRows,
} from './narrativeModel';

/**
 * D911 (#2695) — the Positioning tab: NAR4's core positioning and "This
 * version", NAR5's proposal lightbox, and NAR18's moved notice.
 *
 * READS. The positioning (`GET …/narrative/positioning?version=`) and the
 * draft read (`GET …/narrative/positioning/draft`): Validate's segments and
 * competitors for For whom and Instead of, and Eadwyn's open proposals. Each
 * answers alone; one that fails says so where it would be drawn.
 *
 * WRITES. Every Save opens a dialog that says what it changes, and writes one
 * field through `PUT …/narrative/positioning`. Eadwyn's run writes nothing:
 * each field it proposes is Accepted or Discarded on its own, and Accept is
 * the store's write with Eadwyn as the source. There is no Accept all: the
 * one-at-a-time rule (`routes/ai_rail_proposals.ts`) stands until S1 answers.
 */

export const POSITIONING_OPTION = 'draft:narrative-positioning';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const TAG = 'rounded-full border border-axal-hairline bg-axal-ground px-2.5 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const NOT_SET = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';
const LAVENDER = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40';

const errText = (e, fallback) => String(e?.detail || e?.message || '').trim() || fallback;

/** One read, again when `key` changes or on `reload`. */
function useRead(load, key) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setRead((r) => (r.status === 'ready' ? r : { status: 'loading', data: null }));
    loader.current().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('narrative-positioning', e); if (live) setRead({ status: 'error', data: null, error: e }); },
    );
    return () => { live = false; };
  }, [key, tick]);
  return { read, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** A Save, in a dialog that says what it changes. `field` is a row; `version` null is the core. */
function SaveDialog({ field, version, clearing, onClose, onSaved, projectId }) {
  const [text, setText] = useState(clearing ? '' : field.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const clears = clearing || !text.trim();
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await narrativeApi.savePositioning(projectId, version, { kind: field.kind, position: field.position, text: clears ? null : text });
      onSaved();
    } catch (e) {
      setError(errText(e, 'That did not save. Try again.'));
      setBusy(false);
    }
  };
  return (
    <Lightbox label={`Save ${field.label}`} title={clearing ? `Use the core ${field.label.toLowerCase()}` : `${field.label}`} sub={saveLine({ label: field.label, version, clearing: clears })}
      onClose={onClose} width={560} testId="positioning-save"
      footer={<div className="flex justify-end gap-2">
        <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN} disabled={busy} onClick={save} data-testid="positioning-save-go">{clears ? 'Clear it' : 'Save'}</button>
      </div>}>
      <div className="flex flex-col gap-2 px-5 py-4">
        {clearing ? <p className={`m-0 text-[13px] ${INK}`}>{`The core reads: ${field.coreText || NOT_RECORDED}`}</p> : (
          <>
            <textarea aria-label={field.label} value={text} maxLength={field.max} rows={field.kind === 'elevator' ? 5 : 2} onChange={(e) => setText(e.target.value)}
              className="w-full rounded-[9px] border border-axal-hairline bg-white p-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="positioning-save-text" />
            <span className={`text-[11.5px] ${MUTED}`}>{`${text.length} / ${field.max}`}</span>
          </>
        )}
        {error ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="positioning-save-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** NAR5: what Eadwyn proposes, on lavender until accepted, one line at a time. */
function ProposalLightbox({ projectId, run, onClose, onDecided }) {
  const [rows, setRows] = useState(() => proposalRows(run.proposals));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const decide = async (row, decision) => {
    setBusy(row.uid); setError(null);
    try {
      await narrativeApi.decidePositioning(projectId, row.uid, decision);
      setRows((list) => list.filter((r) => r.uid !== row.uid));
      onDecided();
    } catch (e) {
      setError(errText(e, 'That did not go through. Try again.'));
    } finally { setBusy(null); }
  };
  return (
    <Lightbox label="Positioning proposal" eyebrow="Proposed by Eadwyn" title="Positioning proposal" sub={PROPOSAL_NOTE} onClose={onClose} width={640} pageBelow="lg" testId="positioning-proposal"
      footer={<div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose} data-testid="positioning-proposal-close">Close</button></div>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {rows.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="positioning-proposal-rows">
            {rows.map((r) => (
              <li key={r.uid} className={`${LAVENDER} flex flex-col gap-2 p-3`} data-testid="positioning-proposal-row">
                <span className={EYEBROW}>{r.label}</span>
                <span className={`text-[13.5px] font-semibold leading-snug ${INK}`}>{r.text}</span>
                <span className="flex gap-2">
                  <button type="button" className={BTN} disabled={busy === r.uid} onClick={() => decide(r, 'accept')} data-testid={`positioning-accept-${r.kind}-${r.position}`}>Accept</button>
                  <button type="button" className={GHOST} disabled={busy === r.uid} onClick={() => decide(r, 'discard')} data-testid={`positioning-discard-${r.kind}-${r.position}`}>Discard</button>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className={`m-0 text-[13px] ${INK}`} data-testid="positioning-proposal-done">Every line is decided.</p>}
        {error ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-400">{error}</p> : null}
        {run.read_from?.length ? (
          <div className="flex flex-col gap-1.5" data-testid="positioning-read-from">
            <span className={EYEBROW}>Read from</span>
            <span className="flex flex-wrap gap-1.5">{run.read_from.map((t) => <span key={t} className={TAG}>{t}</span>)}</span>
            <span className={`text-[12px] ${MUTED}`}>{NO_FIGURES_READ}</span>
          </div>
        ) : null}
        {run.removed > 0 ? <p className={`m-0 text-[12.5px] ${INK}`} role="status" data-testid="positioning-removed">{REMOVED_LINE}</p> : null}
        {run.withheld > 0 ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="positioning-withheld">{WITHHELD_LINE}</p> : null}
      </div>
    </Lightbox>
  );
}

function Field({ row, onEdit }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800" data-testid={`positioning-core-${row.kind}-${row.position}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={EYEBROW}>{row.label}</span>
        {row.text ? <span className={`text-[13.5px] leading-snug ${INK}`}>{row.text}</span>
          : row.add ? <span className={`text-[13px] ${MUTED}`}>Add a line</span>
            : <span className={NOT_SET}>{NOT_RECORDED}</span>}
        {row.provenance ? <span className={`text-[11.5px] ${MUTED}`}>{row.provenance}</span> : null}
      </div>
      <button type="button" className={GHOST} onClick={() => onEdit(row)} data-testid={`positioning-edit-${row.kind}-${row.position}`}>{row.text ? 'Edit' : 'Write'}</button>
    </div>
  );
}

/** For whom and Instead of: Validate's own names, then the founder's stored words. */
function FromValidate({ label, from, items }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-axal-hairline py-2.5 dark:border-gray-800" data-testid={`positioning-from-${from}`}>
      <span className={EYEBROW}>{`${label} · from Validate › ${from === 'segments' ? 'Segments' : 'Competitors'}`}</span>
      {items === null ? <span className={`text-[12.5px] ${MUTED}`}>Could not be read. That is not a claim that there are none.</span>
        : items.length ? <span className="flex flex-wrap gap-1.5">{items.map((t) => <span key={t} className={TAG}>{t}</span>)}</span>
          : <span className={NOT_SET}>{NOT_RECORDED}</span>}
    </div>
  );
}

export default function PositioningTab({ projectId, version = null }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const pos = useRead(() => narrativeApi.positioning(projectId, version), `${projectId}:${version}`);
  const draft = useRead(() => narrativeApi.positioningDraft(projectId), String(projectId));
  const [editing, setEditing] = useState(null);
  const [run, setRun] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);
  const moved = isMoved(loc.search);
  // The rail names the run while it is pressed, as every founder draft does (D771).
  useRailOption(asking ? 'draft:narrative-positioning' : null, 'Propose positioning');

  const dismissMoved = () => navigate({ pathname: loc.pathname, search: tabSearch(loc.search), hash: loc.hash }, { replace: true });
  const saved = () => { setEditing(null); pos.reload(); };
  const ask = async () => {
    setAsking(true); setAskError(null);
    try {
      setRun(await narrativeApi.proposePositioning(projectId, null, railPressHeaders(POSITIONING_OPTION)));
      draft.reload();
    } catch (e) {
      setAskError(errText(e, 'Eadwyn could not propose positioning just now. Try again.'));
    } finally { setAsking(false); }
  };
  const openProposals = partItems(draft.read.data?.proposals);
  const p = pos.read.data;

  return (
    <div className="flex flex-col gap-4" data-testid="narrative-positioning">
      {moved && (
        <div role="status" className={`${LAVENDER} flex items-center justify-between gap-3 px-3 py-2 text-[13px] ${INK}`} data-testid="positioning-moved">
          <span>{MOVED_NOTICE}</span>
          <button type="button" aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center text-[16px] leading-none" onClick={dismissMoved} data-testid="positioning-moved-dismiss">×</button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${CARD} flex flex-col gap-2 p-5`} data-testid="positioning-core">
          <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Core positioning</h2>
          {pos.read.status === 'loading' && <p className={`m-0 font-mono text-[12px] ${MUTED}`}>Reading…</p>}
          {pos.read.status === 'error' && <Unreadable what="Your positioning" claim="This is not a claim that none is written." onRetry={pos.reload} />}
          {pos.read.status === 'ready' && (
            <div className="flex flex-col">
              {coreRows(p.core).filter((r) => r.kind !== 'for_whom' && r.kind !== 'instead_of').map((r) => <Field key={`${r.kind}-${r.position}`} row={r} onEdit={(row) => setEditing({ field: row, version: null })} />)}
              <FromValidate label="For whom" from="segments" items={draft.read.status === 'ready' ? partItems(draft.read.data.segments) : draft.read.status === 'error' ? null : []} />
              {coreRows(p.core).filter((r) => r.kind === 'for_whom').map((r) => <Field key={r.kind} row={{ ...r, label: 'For whom, in your words' }} onEdit={(row) => setEditing({ field: row, version: null })} />)}
              <FromValidate label="Instead of" from="competitors" items={draft.read.status === 'ready' ? partItems(draft.read.data.competitors) : draft.read.status === 'error' ? null : []} />
              {coreRows(p.core).filter((r) => r.kind === 'instead_of').map((r) => <Field key={r.kind} row={{ ...r, label: 'Instead of, in your words' }} onEdit={(row) => setEditing({ field: row, version: null })} />)}
            </div>
          )}
          <div className="flex flex-col gap-2 pt-2">
            <button type="button" className={BTN} disabled={asking} onClick={ask} data-testid="positioning-ask">{asking ? 'Eadwyn is proposing…' : 'Ask Eadwyn to propose positioning'}</button>
            <span className={`text-[12px] ${MUTED}`}>{PROPOSE_FOOT}</span>
            {askError ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-400" data-testid="positioning-ask-error">{askError}</p> : null}
            {!run && openProposals?.length ? (
              <span className="flex flex-wrap items-center gap-2" data-testid="positioning-open-proposals">
                <span className={`text-[12.5px] ${INK}`}>{`Eadwyn proposed ${openProposals.length} ${openProposals.length === 1 ? 'line that waits' : 'lines that wait'} for you.`}</span>
                <button type="button" className={GHOST} onClick={() => setRun({ proposals: openProposals, read_from: draft.read.data.read_from, removed: 0, withheld: draft.read.data.withheld })} data-testid="positioning-review">Review</button>
              </span>
            ) : null}
          </div>
        </section>
        {version != null && pos.read.status === 'ready' && (
          <section className={`${CARD} flex flex-col gap-2 p-5`} data-testid="positioning-version">
            <span className={EYEBROW}>This version</span>
            <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{`Version ${version}`}</h2>
            <p className={`m-0 text-[12px] ${MUTED}`}>Switch on Adjust to word a field for this version without changing the core.</p>
            {versionRows(p.core, p.overrides).map((r) => (
              <label key={`${r.kind}-${r.position}`} className="flex items-start justify-between gap-3 border-t border-axal-hairline py-2 dark:border-gray-800" data-testid={`positioning-version-${r.kind}-${r.position}`}>
                <span className="flex min-w-0 flex-col">
                  <span className={`text-[12.5px] font-bold ${INK}`}>{r.label}</span>
                  <span className={`text-[11.5px] ${MUTED}`}>{r.adjusted ? 'Adjusted for this version' : 'Uses the core wording'}</span>
                </span>
                <input type="checkbox" role="switch" aria-label={`Adjust ${r.label} for this audience`} checked={r.adjusted}
                  onChange={() => setEditing({ field: r, version, clearing: r.adjusted })} data-testid={`positioning-adjust-${r.kind}-${r.position}`} />
              </label>
            ))}
          </section>
        )}
      </div>
      {editing && <SaveDialog projectId={projectId} field={editing.field} version={editing.version} clearing={Boolean(editing.clearing)} onClose={() => setEditing(null)} onSaved={saved} />}
      {run && <ProposalLightbox projectId={projectId} run={run} onClose={() => setRun(null)} onDecided={() => { pos.reload(); draft.reload(); }} />}
    </div>
  );
}

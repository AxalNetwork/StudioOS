import React, { useCallback, useEffect, useState } from 'react';
import { Card, Lightbox } from '../../../ui';
import { adminAiModelsApi } from '../../../lib/api/adminAiModels';
import { reportError } from '../../../lib/log';
import { AI_MODELS_LINE, NOTE_MAX, PLAN_LABELS, REASON_MIN, changeBody, modelGrid, reasonOk } from './aiModelsModel';
import { NOT_RECORDED } from './hqDecksModel';

/**
 * D4251 (#4251) — HQ › Decks › AI models: the elements × models grid with the
 * kill switch and the plan floor. Reads and writes
 * `/api/admin/ai/element-models` (a Super Admin on HQ only). Each row is a
 * catalogue model the grid elements offer; each cell, how many of a group's
 * elements it serves. Change… opens the one dialog: on or off, the plan
 * floor, a note, and the reason the audit keeps. A write applies on the next
 * call. The safety model cannot be switched off, and the dialog says so.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const TH = 'sticky top-0 bg-white px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:bg-gray-900 dark:text-gray-400';
const TD = 'px-2 py-2 align-top text-[13px] text-axal-ink dark:text-gray-100';
const BTN = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const SELECT = 'rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const TONE = {
  on: 'text-emerald-700 dark:text-emerald-300', off: 'text-red-700 dark:text-red-300',
  floor: 'text-amber-700 dark:text-amber-300', not_offered: 'text-axal-muted dark:text-gray-400',
};

function ChangeDialog({ row, onDone, onClose }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [planMin, setPlanMin] = useState(row.planMin);
  const [note, setNote] = useState(row.note || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const body = changeBody(row, { enabled, planMin, note, reason });
  const save = async () => {
    if (!body) return;
    setBusy(true); setError(null);
    try { await adminAiModelsApi.set(body); onDone(); }
    catch (e) { setError(e?.message || 'The change could not be saved. Nothing was changed.'); reportError('hq-ai-models:write', e); }
    finally { setBusy(false); }
  };
  return (
    <Lightbox label={`Change ${row.name}`} title={`Change ${row.name}`} width={520} onClose={() => !busy && onClose()} testId="hq-ai-models-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={save} disabled={busy || !body} data-testid="hq-ai-models-save">{busy ? 'Saving…' : 'Save change'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} disabled={row.required} onChange={(e) => setEnabled(e.target.checked)} data-testid="hq-ai-models-enabled" />
          <span>On for the plans below</span>
        </label>
        {row.required ? <p className={MUTED} data-testid="hq-ai-models-required">The safety check runs on every call, so it cannot be switched off or kept from a plan.</p> : null}
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold">Who may run it</span>
          <select className={SELECT} value={planMin} disabled={row.required || !enabled} onChange={(e) => setPlanMin(e.target.value)} data-testid="hq-ai-models-plan">
            {Object.entries(PLAN_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold">Note <span className={MUTED}>(shown here)</span></span>
          <input className={INPUT} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} data-testid="hq-ai-models-note" />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold">Reason <span className={MUTED}>(at least {REASON_MIN} characters, kept in the admin audit)</span></span>
          <textarea className={INPUT} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="hq-ai-models-reason" />
        </label>
        {!reasonOk(reason) ? <p className={MUTED}>Say why before saving.</p> : null}
        {error ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="hq-ai-models-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

export default function AiModelsTab() {
  const [reply, setReply] = useState(undefined);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(null);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    setReply(undefined);
    adminAiModelsApi.read().then((v) => { if (live) setReply(v); }, (e) => {
      if (e?.status !== 403) reportError('hq-ai-models:read', e);
      if (live) setReply(e?.status === 403 ? { refused: true } : null);
    });
    return () => { live = false; };
  }, [tick]);

  if (reply === undefined) return <Card><p className={MUTED} role="status" data-testid="hq-ai-models-reading">Reading…</p></Card>;
  if (reply === null) {
    return (
      <Card>
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="hq-ai-models-unreadable">
          <span><strong>Could not be read.</strong> The model policy did not load. That is not the same as every model being on.</span>
          <button type="button" className={BTN} onClick={retry}>Try again</button>
        </div>
      </Card>
    );
  }
  if (reply.refused) return <Card><p className={MUTED} data-testid="hq-ai-models-super-only">Only a Super Admin on HQ can see and change the model policy.</p></Card>;

  const { groups, rows } = modelGrid(reply);
  return (
    <Card data-testid="hq-ai-models">
      <p className={`${MUTED} mb-3`}>{AI_MODELS_LINE}</p>
      <div className="max-h-[36rem] overflow-auto">
        <table className="w-full" data-testid="hq-ai-models-table">
          <thead>
            <tr>
              <th className={TH}>Model</th>
              {groups.map((g) => <th key={g.group} className={TH}>{g.label}</th>)}
              <th className={TH}>State</th>
              <th className={TH}>Last changed</th>
              <th className={TH}><span className="sr-only">Change</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`hq-ai-model-${r.id}`}>
                <td className={TD}><span className="font-semibold">{r.name}</span><br /><span className={MUTED}>{r.kind}</span></td>
                {r.cells.map((c) => (
                  <td key={c.group} className={TD} title={c.names.join(', ')}>
                    {c.n ? `${c.n} of ${c.of}` : <span className={MUTED} aria-label="none">–</span>}
                  </td>
                ))}
                <td className={`${TD} font-semibold ${TONE[r.state.key] || ''}`} data-testid={`hq-ai-model-state-${r.id}`}>
                  {r.state.label}{r.note ? <><br /><span className={`${MUTED} font-normal`}>{r.note}</span></> : null}
                </td>
                <td className={TD}>{r.by || NOT_RECORDED}{r.at ? <><br /><span className={MUTED}>{r.at}</span></> : null}</td>
                <td className={TD}>
                  <button type="button" className={BTN} onClick={() => setEditing(r)} aria-label={`Change ${r.name}`} data-testid={`hq-ai-model-change-${r.id}`}>Change…</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? <ChangeDialog key={editing.id} row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); retry(); }} /> : null}
    </Card>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import FillSheet from './FillSheet.jsx';
import { FillFormTrigger, FillMark, FillTrigger } from './FillMark.jsx';
import { fillsApi } from '../lib/api/fills.js';
import { reportError } from '../lib/log.js';
import { activeSupportSession } from '../lib/supportSession.js';
import { placeValues, placedProposals, stillPlaced } from '../lib/fillForms.js';
import { NOT_FILLED_HERE, fillOffLine } from '../lib/fillScoped.js';
import useAssistMode from '../hooks/useAssistMode.js';
import { railPageHeaders } from '../lib/railPage.js';

/**
 * D1329 (#3490, part 6 of #2431) — Fill with Eadwyn on a form whose record is
 * not a venture's: an advisor's service, a partner's status report, an
 * event and its agenda, a publication, Commit's IC memo.
 *
 * One read of `GET /api/fills/sheet` per form (`record`, or `parent` for an
 * Add form). A blank field the read gives a trigger draws "Ask Eadwyn to fill
 * [field]"; the form draws "Ask". Both open the one `FillSheet`. Accept
 * places the values in the form, each "Not saved" until typed over; the
 * form's own Save writes, then `afterSave(id)` posts `POST /api/fills/record`
 * with the placed proposals, and the Worker keeps only what still equals each.
 *
 * A reader (the read's `can_fill` is false) reads the marks with no trigger
 * and no Undo (AF15). A support session reads "Ask is off in a support
 * session."; an Explorer (refused `no_profile`) reads "Ask opens once you
 * hold a venture or a profile." (AF22). A failed read is Unreadable with Try
 * again, never a form with no Ask.
 */
export function useScopedFill({ scope, record = null, parent = null, enabled = true, values = {}, onValues }) {
  const { page, form, table } = scope;
  // The rail's workspace is the switch key; the canonical form page is the
  // fallback when no rail is mounted (D765).
  const railPage = railPageHeaders()['X-Rail-Page'];
  const [aiOn] = useAssistMode(railPage ? decodeURIComponent(railPage) : page);
  const [read, setRead] = useState(enabled ? { status: 'loading', data: null } : { status: 'off', data: null });
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState({});
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) { setRead({ status: 'off', data: null }); return undefined; }
    let live = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(() => fillsApi.sheet({ page, form, record, parent }))
      .then((data) => { if (live) setRead({ status: 'ready', data }); }, (error) => {
        if (!live) return;
        if (error?.status === 403 && (error?.data?.error === 'no_profile' || error?.code === 'no_profile')) { setRead({ status: 'explorer', data: null }); return; }
        if (error?.status === 403 || error?.status === 404) { setRead({ status: 'none', data: null }); return; }
        reportError('fill-scoped:read', error);
        setRead({ status: 'unreadable', data: null });
      });
    return () => { live = false; };
  }, [page, form, record, parent, enabled, tick]);

  const fields = read.status === 'ready' && Array.isArray(read.data?.fields) ? read.data.fields : [];
  const canFill = read.status === 'ready' && read.data?.can_fill === true;
  const support = read.status === 'ready' && !canFill && !!activeSupportSession();
  const names = fields.map((f) => f.field);
  const field = (name) => fields.find((f) => f.field === name) || null;
  const place = (list) => {
    const out = placeValues(list, names);
    onValues?.(out.values);
    setPlaced((old) => ({ ...old, ...out.placed }));
  };

  /** After the form's own Save wrote row `id`: the record step. It never undoes the Save. */
  const afterSave = async (id) => {
    const uids = placedProposals(placed);
    setPlaced({});
    if (uids.length && Number.isSafeInteger(Number(id)) && Number(id) > 0) {
      try { await fillsApi.record({ page, form, record: Number(id), proposals: uids }); }
      catch (error) { reportError('fill-scoped:record', error); }
    }
    reload();
  };

  const fillable = canFill && fields.some((f) => f.trigger && blank(values[f.field]) && !stillPlaced(placed, f.field, values[f.field]));
  const sheet = open ? (
    <FillSheet page={page} form={form} record={record ? { id: record, type: table } : null} parent={parent} values={values} aiOff={!aiOn}
      onPlace={(list) => { place(list); setOpen(false); }} onClose={() => setOpen(false)} />
  ) : null;

  return {
    status: read.status, canFill, support, explorer: read.status === 'explorer', field, placed, fillable, aiOff: !aiOn,
    open: () => setOpen(true), place, afterSave, reload, sheet, notFilledHere: NOT_FILLED_HERE[form] || [],
    offLine: fillOffLine({ support, explorer: read.status === 'explorer' }),
  };
}

const blank = (v) => v == null || String(v).trim() === '';

/**
 * A field's label row with its Fill controls: the trigger while the box is
 * blank and the read gives one; the field's mark (read-only for a reader);
 * "Not saved" for a placed value until it is typed over.
 */
export function FillLabel({ fill, name, label, value, children }) {
  if (!fill || fill.status !== 'ready') return children;
  const view = fill.field(name);
  if (!view) return children;
  const placed = stillPlaced(fill.placed, name, value);
  const trigger = fill.canFill && view.trigger && blank(value) && !placed;
  const mark = !placed && view.mark && !blank(value) ? view.mark : null;
  if (!trigger && !placed && !mark) return children;
  return (
    <div className="flex min-h-8 items-center justify-between gap-2" data-testid={`fill-label-${name}`}>
      <span className="flex min-w-0 items-center gap-1">{children}
        {placed ? <FillMark mark={null} placed /> : null}
        {mark ? <FillMark mark={mark} readOnly={!fill.canFill} onUndone={fill.reload} /> : null}
      </span>
      {trigger ? <FillTrigger field={view} label={label} aiOff={fill.aiOff} onOpen={fill.open} /> : null}
    </div>
  );
}

/**
 * The form's own line: its "Ask" when a field is left to fill, the off line
 * for a support session or an Explorer, Unreadable with Try again, and what
 * the sheet never fills here.
 */
export function FillFormBar({ fill }) {
  if (!fill || fill.status === 'off' || fill.status === 'loading' || fill.status === 'none') return null;
  if (fill.status === 'unreadable') {
    return (
      <p role="status" className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400" data-testid="fill-scoped-unreadable">
        Eadwyn's suggestions could not be read. The form works as it is.
        <button type="button" className="font-semibold text-axal-violet hover:underline dark:text-violet-300" onClick={fill.reload}>Try again</button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="fill-scoped-bar">
      {fill.offLine ? <p className="m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" data-testid="fill-scoped-off">{fill.offLine}</p> : null}
      {fill.fillable ? <div><FillFormTrigger aiOff={fill.aiOff} onOpen={fill.open} /></div> : null}
      {fill.canFill && fill.notFilledHere.length ? (
        <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="fill-scoped-not-here">Not filled here: {fill.notFilledHere.join(' ')}</p>
      ) : null}
      {fill.sheet}
    </div>
  );
}

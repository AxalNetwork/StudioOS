import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from './Sheet.jsx';
import { FillGlyph } from './FillMark.jsx';
import { fillsApi } from '../lib/api/fills.js';
import { ADD_TOKENS_PATH } from '../lib/aiTokens.js';
import { reportError } from '../lib/log.js';
import {
  COST_NOT_RECORDED, NO_TOKENS, averageLine, candidateChip, errorRef, money, neverFillSentence, partialLine, pickOf, planRows,
  refusalView, sourceHolds, sourceRows, topLine,
} from '../lib/fillSheet.js';

/**
 * D1327 (#3488, part 4 of #2431) — the one Fill with Eadwyn sheet, on D1317's
 * `Sheet` at 520px (AF4–AF14, AF24; a full-height page under 640px).
 *
 *   Sources (AF4)   each source with a checkbox: connectors and modules first,
 *                   "No AI tokens"; Eadwyn last, "for what's left", with the
 *                   member's own average. A connector not connected says so.
 *   Preview (AF5)   a real table: Field · Now · Will fill · Source · Cost ·
 *                   Accept, each checkbox labelled by its field. A typed value
 *                   is "Yours · kept" and never taken by Accept all; "Use
 *                   [source] instead" takes one field at a time (AF6). Two
 *                   sources on one field open "2 sources", in AF6's order.
 *                   "Not filled here" lists each never-fill field.
 *   The run         `POST /api/ai/rail/run` (D1326) when Eadwyn is ticked and
 *                   a field is left for it: Running (AF9), Partial (AF10),
 *                   Refused (AF11), Out of tokens (AF12). Sources' values stay
 *                   offered whatever the run says.
 *   Empty (AF13), Error (AF14).
 *
 * NOTHING IS WRITTEN HERE. Accept hands the chosen values to the form
 * (`onPlace`), which marks them "Not saved"; the form's own Save writes, then
 * `POST /api/fills/record`. Closing the sheet returns focus to the trigger
 * (D1317's contract). No model name or option key is drawn.
 *
 * D1329 (#3490): `project` is null for a record that is not a venture's (an
 * advisor's service, a partner's report, an event, a publication, an IC
 * memo); the read and the run then name the record, or `parent` for an Add
 * form under an engagement or an event (`services/fills/scopes.ts`).
 *
 * D1328 (#3489, AF23): below 640px Sources is a bottom sheet (`phone="sheet"`)
 * and Preview a full-height page, its footer (Accept all) fixed below the
 * scrolling table; every control there is at least 44px.
 */
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const EYEBROW = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[44px]';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800 dark:text-gray-100 max-sm:min-h-[44px]';
const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';
const NOTE = 'rounded-[10px] border px-3 py-2.5 text-[12.5px]';
const NOTE_TONE = {
  info: 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
};
const LAVENDER = 'bg-axal-lavender dark:bg-violet-950/40';

const blank = (v) => v == null || String(v).trim() === '';

export default function FillSheet({ page, form, project = null, record = null, parent = null, title = 'this form', values = {}, aiOff = false, onPlace, onClose, turnOnHref = null }) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null, ref: null });
  const [step, setStep] = useState('sources');
  const [ticked, setTicked] = useState(new Set());
  const [run, setRun] = useState(null);
  const [chosen, setChosen] = useState({});
  const [accept, setAccept] = useState({});
  const [details, setDetails] = useState(false);

  const load = useCallback(async () => {
    setRead({ status: 'loading', data: null, error: null, ref: null });
    try {
      const data = await fillsApi.sheet({ page, form, project, record: record?.id ?? null, parent });
      setRead({ status: 'ready', data, error: null, ref: null });
      const rows = sourceRows(data);
      setTicked(new Set(rows.filter((r) => r.tickable && (r.kind !== 'eadwyn' || !aiOff)).map((r) => r.key)));
    } catch (e) {
      reportError('fill-sheet:read', e);
      setRead({ status: 'error', data: null, error: typeof e?.message === 'string' ? e.message : '', ref: errorRef() });
    }
  }, [page, form, project, record?.id, parent, aiOff]);
  useEffect(() => { load(); }, [load]);

  const data = read.data;
  const sources = useMemo(() => (data ? sourceRows(data) : []), [data]);
  const fields = data?.fields || [];
  const fillable = fields.filter((f) => !f.never_fill);
  const nothingToFill = data && fillable.every((f) => !blank(Object.prototype.hasOwnProperty.call(values, f.field) ? values[f.field] : f.value));
  const sourcesHoldNothing = sources.filter((s) => s.kind !== 'eadwyn').every((s) => s.state !== 'ok' || !s.holds);
  const done = run?.status === 'done' ? run : null;
  const rows = useMemo(() => (data ? planRows(data, { values, ticked, run: done }) : []), [data, values, ticked, done]);

  const toggle = (key) => setTicked((t) => { const n = new Set(t); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const preview = async ({ sourcesOnly = false } = {}) => {
    setStep('preview'); setRun(null); setChosen({}); setAccept({});
    const useEadwyn = !sourcesOnly && ticked.has('eadwyn') && !aiOff;
    if (sourcesOnly) setTicked((t) => { const n = new Set(t); n.delete('eadwyn'); return n; });
    const left = planRows(data, { values, ticked }).filter((r) => !r.kept && !r.candidates.length && !(r.choices || []).length);
    const forEadwyn = left.filter((r) => fields.find((f) => f.field === r.field)?.offered_to_eadwyn);
    if (!useEadwyn || !forEadwyn.length) return;
    setRun({ status: 'running' });
    try {
      const events = await fillsApi.run({
        page, option: `form:${form}`,
        // D1329: a venture's form names its venture; a record that is not a venture's names itself, or its parent.
        ...(project != null ? { project } : {}),
        ...(record?.id ? { record: { type: record.type || fields[0]?.table, id: record.id } } : parent != null ? { parent } : {}),
        input: { values },
      });
      const end = events.find((e) => e.event === 'done')?.data || null;
      if (!end) { setRun({ status: 'refused', view: refusalView(null) }); return; }
      if (end.refusal) { setRun({ status: 'refused', view: refusalView(end.refusal, { charged: end.charged_microusd }) }); return; }
      if ((end.dropped || []).some((d) => d.why === 'record_changed')) { setRun({ status: 'refused', view: refusalView({ code: 'record_changed' }) }); return; }
      setRun({ status: 'done', proposals: end.proposals || [], dropped: end.dropped || [], charged: end.charged_microusd ?? null });
    } catch (e) {
      reportError('fill-sheet:run', e);
      setRun({ status: 'refused', view: refusalView({ code: e?.code, message: e?.message }) });
    }
  };

  const running = run?.status === 'running';
  const accepted = (r) => (Object.prototype.hasOwnProperty.call(accept, r.field) ? accept[r.field] : r.accept);
  const placeable = rows.filter((r) => pickOf(r, chosen) && (!r.kept || accept[r.field]));
  const allCount = rows.filter((r) => !r.kept && pickOf(r, chosen)).length;
  const place = (which) => {
    const list = which.map((r) => { const c = pickOf(r, chosen); return { field: r.field, value: c.value, source: c.source, source_kind: c.kind, proposal_uid: c.proposal_uid ?? null }; });
    onPlace?.(list);
    onClose?.();
  };

  let body;
  let footer = null;
  if (read.status === 'loading') {
    body = <div className="flex flex-col gap-2" aria-busy="true" data-testid="fill-sheet-loading">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" />)}</div>;
  } else if (read.status === 'error') {
    body = (
      <div role="alert" className={`${NOTE} ${NOTE_TONE.bad} flex flex-col gap-2`} data-testid="fill-sheet-error">
        <span className="font-semibold">We could not read your sources. Try again.</span>
        <span className="flex flex-wrap items-center gap-3">
          <button type="button" className={GHOST} onClick={load} data-testid="fill-sheet-retry">Try again</button>
          <button type="button" className={LINK} aria-expanded={details} onClick={() => setDetails((d) => !d)}>Details</button>
          <span className={`${MONO} text-[11px]`} data-testid="fill-sheet-ref">{`ref ${read.ref}`}</span>
        </span>
        {details && read.error ? <span className="text-[12px]">{read.error}</span> : null}
      </div>
    );
  } else if (nothingToFill) {
    body = <p className={`${NOTE} ${NOTE_TONE.info} m-0`} data-testid="fill-sheet-nothing">Nothing to fill. Every field here already has a value.</p>;
  } else if (step === 'sources') {
    body = (
      <div className="flex flex-col gap-3" data-testid="fill-sheet-sources">
        <span className={EYEBROW}>Sources</span>
        {sourcesHoldNothing ? <p className={`${NOTE} ${NOTE_TONE.info} m-0`} data-testid="fill-sheet-no-source">No source has anything for this form yet.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {sources.map((s) => (
            <li key={s.key} className="flex items-start justify-between gap-3 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`fill-source-${s.key}`}>
              <label className="flex min-w-0 items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 max-sm:mt-0 max-sm:h-11 max-sm:w-11" checked={ticked.has(s.key)} disabled={!s.tickable || (s.kind === 'eadwyn' && aiOff)}
                  onChange={() => toggle(s.key)} aria-label={`Use ${s.label}`} />
                <span className="flex min-w-0 flex-col">
                  <span className={`text-[13px] font-semibold ${INK}`}>{s.kind === 'eadwyn' ? <span className="inline-flex items-center gap-1"><span className="text-axal-violet dark:text-violet-300"><FillGlyph size={12} /></span>Eadwyn</span> : s.label}</span>
                  <span className={`text-[12px] ${MUTED}`}>{sourceHolds(s)}</span>
                  {s.kind === 'eadwyn' ? <span className={`${MONO} text-[11.5px] ${MUTED}`} data-testid="fill-source-average">{aiOff ? 'AI assistance is off on this page.' : averageLine(data.quote)}</span> : null}
                </span>
              </label>
              <span className="shrink-0 text-right text-[11.5px]">
                {s.state === 'not_connected' ? <Link className={LINK} to={`/account/connectors/${encodeURIComponent(String(s.key).replace(/^connector:/, ""))}`} data-testid={`fill-source-connect-${s.key}`}>Connect</Link>
                  : s.kind === 'eadwyn' ? null : <span className={MUTED}>{NO_TOKENS}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
    footer = (
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN} onClick={() => preview()} disabled={!ticked.size} data-testid="fill-sheet-preview">Preview</button>
      </div>
    );
  } else {
    const refused = run?.status === 'refused' ? run.view : null;
    const partial = done ? partialLine(rows) : null;
    const never = fields.filter((f) => f.never_fill);
    body = (
      <div className="flex flex-col gap-3" data-testid="fill-sheet-preview-step">
        {refused ? (
          <div role="status" className={`${NOTE} ${refused.kind === 'tokens' ? NOTE_TONE.warn : NOTE_TONE.info} flex flex-col gap-2`} data-testid={`fill-sheet-refused-${refused.kind}`}>
            <span>{refused.text}</span>
            <span className="flex flex-wrap gap-2">
              {refused.kind === 'off' && turnOnHref ? <Link className={LINK} to={turnOnHref}>Turn it on</Link> : null}
              {refused.addTokens ? <Link className={BTN} to={ADD_TOKENS_PATH} data-testid="fill-sheet-add-tokens">Add tokens</Link> : null}
              {refused.kind === 'tokens' ? <button type="button" className={GHOST} onClick={() => preview({ sourcesOnly: true })} data-testid="fill-sheet-sources-only">Ask from your sources only</button> : null}
              {refused.again ? <button type="button" className={GHOST} onClick={() => preview()} data-testid="fill-sheet-again">Preview again</button> : null}
            </span>
          </div>
        ) : null}
        {running ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="fill-sheet-running">Eadwyn is checking this draft.</p> : null}
        <span className={`${MONO} text-[11.5px] ${INK}`} data-testid="fill-sheet-topline">{topLine(rows, chosen, done ? done.charged : undefined)}</span>
        {partial ? <span className={`text-[12.5px] font-semibold ${INK}`} data-testid="fill-sheet-partial">{partial}</span> : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]" data-testid="fill-sheet-table">
            <caption className="sr-only">{`What will fill ${title}`}</caption>
            <thead>
              <tr className={EYEBROW}>
                <th scope="col" className="py-1.5 pr-2">Field</th><th scope="col" className="py-1.5 pr-2">Now</th><th scope="col" className="py-1.5 pr-2">Will fill</th>
                <th scope="col" className="py-1.5 pr-2">Source</th><th scope="col" className="py-1.5 pr-2">Cost</th><th scope="col" className="py-1.5">Accept</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = pickOf(r, chosen);
                const fromEadwyn = c?.kind === 'eadwyn';
                const sourceOf = (x) => sources.find((s) => s.key === x.source);
                return (
                  <tr key={r.field} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`fill-row-${r.field}`}>
                    <th scope="row" className={`py-2 pr-2 text-left font-semibold ${INK}`}>{r.label}</th>
                    <td className={`py-2 pr-2 ${r.now ? INK : MUTED}`}>{r.now ?? 'Blank'}</td>
                    <td className="py-2 pr-2">
                      {running && !c && !r.kept ? <span className="block h-4 w-24 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-hidden="true" /> : null}
                      {r.kept && !accept[r.field] ? (
                        <span className="flex flex-col gap-1">
                          <span className={MUTED} data-testid={`fill-row-kept-${r.field}`}>Yours · kept</span>
                          {r.candidates[0] ? <button type="button" className={`${LINK} text-left text-[11.5px]`} data-testid={`fill-row-use-${r.field}`}
                            onClick={() => { setChosen((x) => ({ ...x, [r.field]: r.candidates[0].key })); setAccept((a) => ({ ...a, [r.field]: true })); }}>{`Use ${r.candidates[0].label}’s instead`}</button> : null}
                        </span>
                      ) : c ? (
                        <span className="flex flex-col gap-1">
                          {r.kept ? <span className={`${MUTED} line-through`}>{r.now}</span> : null}
                          <span className={`rounded px-1 ${LAVENDER} ${INK}`}>{c.shown}</span>
                        </span>
                      ) : !running && !(r.choices || []).length ? <span className={MUTED} data-testid={`fill-row-reason-${r.field}`}>{r.reason}</span> : null}
                      {!r.kept && (r.choices || []).length ? (
                        <select className="mt-1 max-w-[150px] rounded-[7px] border border-axal-hairline bg-white px-1.5 py-1 text-[12px] dark:border-gray-700 dark:bg-gray-900" aria-label={`${r.label}: choose a record`}
                          value={c?.kind === 'module' ? c.key : ''} onChange={(e) => { const v = e.target.value; setChosen((x) => ({ ...x, [r.field]: v || null })); setAccept((a) => ({ ...a, [r.field]: !!v })); }}
                          data-testid={`fill-row-choose-${r.field}`}>
                          <option value="">{`Choose from ${r.choices[0].label}`}</option>
                          {r.choices.map((x) => <option key={x.key} value={x.key}>{x.shown}</option>)}
                        </select>
                      ) : null}
                      {r.candidates.length > 1 && !r.kept ? (
                        <details className="mt-1" data-testid={`fill-row-conflict-${r.field}`}>
                          <summary className={`${LINK} cursor-pointer text-[11.5px]`}>{`${r.candidates.length} sources`}</summary>
                          <fieldset className="m-0 mt-1 flex flex-col gap-1 border-0 p-0">
                            <legend className="sr-only">{`Which value fills ${r.label}`}</legend>
                            {r.candidates.map((x) => (
                              <label key={x.key} className={`flex items-center gap-1.5 ${INK}`}>
                                <input type="radio" name={`fill-${r.field}`} checked={c?.key === x.key} onChange={() => setChosen((y) => ({ ...y, [r.field]: x.key }))} />
                                {`${candidateChip(x, sourceOf(x)?.as_of)}: ${x.shown}`}
                              </label>
                            ))}
                            <span className={`text-[11px] ${MUTED}`}>A connector’s fact comes before Eadwyn. A typed value comes before both.</span>
                          </fieldset>
                        </details>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">{c ? <span className="whitespace-nowrap rounded-full border border-axal-hairline px-1.5 py-0.5 text-[10.5px] font-semibold dark:border-gray-700">{candidateChip(c, sourceOf(c)?.as_of)}</span> : null}</td>
                    <td className={`py-2 pr-2 ${MONO} text-[11px] ${MUTED}`}>{c ? (fromEadwyn ? (c.ran ? `Part of 1 run · ${money(done?.charged) ?? COST_NOT_RECORDED}` : 'From an earlier run') : NO_TOKENS) : null}</td>
                    <td className="py-2">
                      {c ? <input type="checkbox" className="max-sm:h-11 max-sm:w-11" checked={!!accepted(r) && (!r.kept || !!accept[r.field])} aria-label={`Accept ${r.label}`}
                        onChange={(e) => { const v = e.target.checked; setAccept((a) => ({ ...a, [r.field]: v })); }} data-testid={`fill-row-accept-${r.field}`} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <section className="flex flex-col gap-1" data-testid="fill-sheet-never">
          <span className={EYEBROW}>Not filled here</span>
          {never.length ? never.map((f) => <span key={f.field} className={`text-[12px] ${MUTED}`}>{`${f.label}: ${neverFillSentence(f.never_fill)}`}</span>)
            : <span className={`text-[12px] ${MUTED}`}>Every field here can be filled.</span>}
        </section>
      </div>
    );
    footer = (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} data-testid="fill-sheet-discard">Discard</button>
          <button type="button" className={GHOST} disabled={running || !placeable.filter((r) => accepted(r)).length} onClick={() => place(placeable.filter((r) => accepted(r)))} data-testid="fill-sheet-accept-selected">Accept selected</button>
          <button type="button" className={BTN} disabled={running || !allCount} title={running ? 'Ready when every value is checked.' : undefined}
            onClick={() => place(rows.filter((r) => !r.kept && pickOf(r, chosen)))} data-testid="fill-sheet-accept-all">{`Accept all (${allCount})`}</button>
        </div>
        <span className={`text-[11.5px] ${MUTED}`}>{running ? 'Closing drops the result. A run that started is still charged.' : 'Nothing is saved until you press Save on the form.'}</span>
      </div>
    );
  }

  return (
    <Sheet label={`Ask Eadwyn about ${title}`} eyebrow="Ask Eadwyn" title={title} width={520} onClose={onClose} footer={footer} testId="fill-sheet"
      phone={step === 'sources' && read.status !== 'error' && !nothingToFill ? 'sheet' : 'full'}>
      <div className="flex flex-col gap-3">
        <img src="/eadwyn-ai.png" alt="" width={24} height={24} className="h-6 w-6" />
        {body}
      </div>
    </Sheet>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox';
import { DataState } from '../../ui/Honesty.jsx';
import { usePhoneWidth, useTabletWidth } from '../../ui/phone/usePhoneWidth';
import { buildRisksApi } from '../../lib/api/buildRisks.js';
import { cyclesWrite } from '../../lib/api/cycles';
import {
  EMPTY_LINE, EMPTY_TITLE, FROM_PLAN, NOT_ADDRESSED, OWNER_FIXED, RISK_STATE, SEVERITY, SEVERITY_ORDER, STATE_ORDER,
  UNAVAILABLE_LINE, UNAVAILABLE_TITLE, addBody, addForm, editBody, editForm, featureText, filterChips, headCounts,
  listView, mitigationText, ownerText, rangeText, severityOf, showFilters, stateOf,
} from './solutionDesignRisksModel.js';

/**
 * D6033 (#6033, BD25, BD32–BD34) — Solution design's Risks list, above the features table.
 *
 * Its own paged read (`GET /cycles/build/risks`, 25 a page): the module read keeps its
 * counts only (#4603 part 2). Every risk is listed, those tied to no feature too, and a
 * writer adds one (owner and feature set once) or edits one (title, severity, mitigation
 * and state, which is how a risk is closed). A failed read is Unavailable with Try again,
 * and the counts card and the features table above and below it stay drawn.
 */
const BTN = 'inline-flex min-h-[36px] items-center rounded-[9px] border border-axal-hairline px-3 text-[12.5px] font-semibold text-axal-violet-deep hover:bg-axal-lavender dark:border-gray-700 dark:text-violet-300 dark:hover:bg-violet-900/30';
const PRIMARY = 'inline-flex min-h-[40px] items-center rounded-[9px] bg-violet-700 px-3.5 text-[13px] font-bold text-white hover:bg-violet-800 disabled:opacity-60 dark:bg-violet-500 dark:text-gray-950 dark:hover:bg-violet-400';
const GHOST = 'inline-flex min-h-[40px] items-center rounded-[9px] border border-axal-hairline px-3.5 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const TAG = 'inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-[1px] text-[11.5px] font-semibold text-gray-800 dark:border-gray-700 dark:text-gray-200';
const SEV_CLASS = {
  high: 'text-red-700 dark:text-red-300', medium: 'text-amber-800 dark:text-amber-300', low: 'text-gray-700 dark:text-gray-300',
};

function Severity({ value }) {
  const s = severityOf(value);
  return <span className={`${TAG} ${SEV_CLASS[value] ?? ''}`.trim()} data-testid="risk-severity"><span aria-hidden="true">{s.glyph}</span>{s.word}</span>;
}
function State({ value }) {
  const s = stateOf(value);
  return <span className={TAG} data-testid="risk-state"><span aria-hidden="true">{s.glyph}</span>{s.word}</span>;
}

/** The module page's own rule: Build draws its desktop page from 768px (D4846 part 2, `tabletPages`). */
function AtWidth(props) {
  const tablet = useTabletWidth(true);
  const narrow = usePhoneWidth();
  return <RisksList {...props} phone={narrow && !tablet} />;
}

/** `phone` given (a test, a caller that knows) skips the width read. */
export default function SolutionDesignRisks(props) {
  return props.phone === undefined ? <AtWidth {...props} /> : <RisksList {...props} />;
}

function RisksList({ projectId, search = '', phone = false, onChanged }) {
  const [filter, setFilter] = useState({ state: '', feature: '' });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [reload, setReload] = useState(0);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  useEffect(() => {
    if (!projectId) return undefined;
    let current = true;
    setStatus('loading');
    buildRisksApi.list(projectId, { ...filter, page })
      .then((d) => { if (current) { setData(d); setStatus('ready'); } })
      .catch(() => { if (current) setStatus('unavailable'); });
    return () => { current = false; };
  }, [projectId, filter.state, filter.feature, page, reload]);

  const refresh = useCallback(() => { setReload((n) => n + 1); onChanged?.(); }, [onChanged]);
  const choose = (key, value) => { setFilter((f) => ({ ...f, [key]: value })); setPage(1); };

  if (!projectId) return null;
  const view = listView(status, data, filter);
  const head = headCounts(data?.counts);
  // A failed read still offers Add (BD33): the write is its own route.
  const canWrite = data?.can_write === true || status === 'unavailable';
  const add = canWrite ? (
    <button type="button" className={phone ? `${PRIMARY} w-full justify-center` : PRIMARY} onClick={() => setDialog({ kind: 'add' })} data-testid="risks-add">Add a risk</button>
  ) : null;

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" aria-labelledby="sd-risks-title" data-testid="solution-design-risks" data-state={view.kind}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="sd-risks-title" className="m-0 flex flex-wrap items-baseline gap-x-2 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
          Risks
          {status === 'ready' && <span className="text-[12.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="risks-recorded">· {head.recorded} recorded</span>}
        </h2>
        {status === 'ready' && head.recorded > 0 && (
          <p className="m-0 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="risks-by-severity">
            {head.bySeverity.map((s) => <span key={s.key} className="inline-flex items-center gap-1"><Severity value={s.key} /><b>{s.count}</b></span>)}
          </p>
        )}
        {!phone && add}
      </div>

      {status === 'ready' && showFilters(data?.counts) && (
        <div className="flex flex-col gap-2" data-testid="risks-filters">
          {filterChips(data.counts).map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-semibold text-axal-muted dark:text-gray-400">{group.label}</span>
              {group.options.map((o) => {
                const on = (filter[group.key] || '') === o.value;
                return (
                  <button key={o.value || 'all'} type="button" aria-pressed={on} onClick={() => choose(group.key, o.value)}
                    className={`inline-flex min-h-[32px] items-center gap-1 rounded-full border px-2.5 ${on ? 'border-violet-600 bg-violet-50 font-bold text-violet-900 dark:border-violet-400 dark:bg-violet-900/30 dark:text-violet-100' : 'border-gray-200 text-gray-800 dark:border-gray-700 dark:text-gray-200'}`}
                    data-testid={`risks-filter-${group.key}-${o.value || 'all'}`}>
                    {on ? '✓ ' : ''}{o.label} <span className="text-gray-600 dark:text-gray-400">{o.count}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view.kind === 'loading' && <DataState state="loading" size="block" />}
      {view.kind === 'unavailable' && (
        <div className="flex flex-col gap-1.5" data-testid="risks-unavailable">
          <b className="text-[13px] text-axal-ink dark:text-gray-100">{UNAVAILABLE_TITLE}</b>
          <DataState state="unavailable" size="block" claim={UNAVAILABLE_LINE} onRetry={() => setReload((n) => n + 1)} retryLabel="Try again" />
        </div>
      )}
      {view.kind === 'empty' && (
        <DataState state="none" size="block" data-testid="risks-empty">
          <span className="flex flex-col gap-0.5"><b>{EMPTY_TITLE}</b><span className="text-gray-700 dark:text-gray-300">{EMPTY_LINE}</span></span>
        </DataState>
      )}
      {view.kind === 'no-match' && <DataState state="none" size="block" data-testid="risks-no-match">No risks match these filters.</DataState>}
      {view.kind === 'rows' && (phone
        ? <RiskCards rows={view.rows} canWrite={data.can_write === true} onEdit={(row) => setDialog({ kind: 'edit', row })} />
        : <RiskTable rows={view.rows} search={search} canWrite={data.can_write === true} onEdit={(row) => setDialog({ kind: 'edit', row })} />)}

      {view.kind === 'rows' && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-axal-muted dark:text-gray-400">
          <span data-testid="risks-range">{rangeText(data)}</span>
          {data.pages > 1 && (
            <span className="flex gap-1.5">
              <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="risks-prev">Previous</button>
              <button type="button" className={BTN} disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} data-testid="risks-next">Next</button>
            </span>
          )}
          {!phone && <span>Severity and state always carry a word and a glyph.</span>}
        </div>
      )}
      {phone && add}

      {dialog?.kind === 'add' && <AddRisk projectId={projectId} choices={data?.choices} onClose={(saved) => { setDialog(null); if (saved && live.current) refresh(); }} />}
      {dialog?.kind === 'edit' && <EditRisk projectId={projectId} row={dialog.row} onClose={(saved) => { setDialog(null); if (saved && live.current) refresh(); }} />}
    </section>
  );
}

function RiskTable({ rows, search, canWrite, onEdit }) {
  const TH = 'px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[12.5px]" data-testid="risks-table">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-800">
          <th className={TH} scope="col">Risk · mitigation</th><th className={TH} scope="col">Severity</th><th className={TH} scope="col">Owner</th>
          <th className={TH} scope="col">State</th><th className={TH} scope="col">Feature</th><th className={TH} scope="col">Addressed by test</th>
          {canWrite && <th className={TH} scope="col"><span className="sr-only">Actions</span></th>}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 align-top last:border-b-0 dark:border-gray-800" data-testid={`risk-row-${r.id}`}>
              <th scope="row" className="px-2 py-2.5 text-left font-normal">
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-bold text-axal-ink dark:text-gray-100">{r.title}
                    {r.from_plan && <span className={TAG} data-testid="risk-from-plan">{FROM_PLAN}</span>}</span>
                  <span className={r.mitigation ? 'text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'} data-testid="risk-mitigation">{r.mitigation ? '' : '○ '}{mitigationText(r)}</span>
                </span>
              </th>
              <td className="px-2 py-2.5"><Severity value={r.severity} /></td>
              <td className={`px-2 py-2.5 ${r.owner ? '' : 'text-gray-600 dark:text-gray-400'}`} data-testid="risk-owner">{ownerText(r)}</td>
              <td className="px-2 py-2.5"><State value={r.state} /></td>
              <td className="px-2 py-2.5" data-testid="risk-feature">
                {r.feature ? <Link className="font-semibold text-violet-800 underline-offset-2 hover:underline dark:text-violet-300" to={`/build/solution-design/${encodeURIComponent(r.feature.id)}${search}`}>{featureText(r)} →</Link>
                  : <span className="text-gray-600 dark:text-gray-400">{featureText(r)}</span>}
              </td>
              <td className="px-2 py-2.5"><DataState state="not_recorded">{NOT_ADDRESSED}</DataState></td>
              {canWrite && <td className="px-2 py-2.5 text-right"><button type="button" className={BTN} onClick={() => onEdit(r)} aria-label={`Edit ${r.title}`} data-testid={`risk-edit-${r.id}`}>Edit</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskCards({ rows, canWrite, onEdit }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="risks-cards">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 rounded-[10px] border border-gray-200 p-3 dark:border-gray-800" data-testid={`risk-card-${r.id}`}>
          <b className="text-[14px] text-axal-ink dark:text-gray-100">{r.title}</b>
          <span className="flex flex-wrap gap-1.5"><Severity value={r.severity} /><State value={r.state} />{r.from_plan && <span className={TAG}>{FROM_PLAN}</span>}</span>
          <span className="text-[12.5px] text-gray-700 dark:text-gray-300">{ownerText(r)} · {featureText(r)}</span>
          {canWrite && <button type="button" className={`${BTN} min-h-[44px] self-start`} onClick={() => onEdit(r)} aria-label={`Edit ${r.title}`} data-testid={`risk-edit-${r.id}`}>Edit</button>}
        </li>
      ))}
    </ul>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{label}</label>
      {children}
      {hint && <span className="text-[11.5px] text-gray-600 dark:text-gray-400">{hint}</span>}
    </div>
  );
}
const INPUT = 'min-h-[40px] w-full rounded-[9px] border border-gray-300 bg-white px-2.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

function Radios({ name, options, value, onChange }) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="mb-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{name}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, word, glyph]) => (
          <label key={v} className={`inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-[9px] border px-3 text-[13px] ${value === v ? 'border-violet-600 bg-violet-50 font-bold dark:border-violet-400 dark:bg-violet-900/30' : 'border-gray-300 dark:border-gray-700'} text-gray-900 dark:text-gray-100`}>
            <input type="radio" className="sr-only" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            <span aria-hidden="true">{glyph}</span>{word}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
const severityOptions = SEVERITY_ORDER.map((k) => [k, SEVERITY[k].word, SEVERITY[k].glyph]);
const stateOptions = STATE_ORDER.map((k) => [k, RISK_STATE[k].word, RISK_STATE[k].glyph]);

function useSave(onClose) {
  const [state, setState] = useState({ busy: false, error: '' });
  const run = async (built, write) => {
    if (built.error) { setState({ busy: false, error: built.error }); return; }
    setState({ busy: true, error: '' });
    try { await write(built.body); onClose(true); }
    catch (err) { setState({ busy: false, error: err?.message || 'The risk was not saved. Your edit is kept.' }); }
  };
  return [state, run];
}

function Footer({ busy, cta, onCancel, form }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={GHOST} onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" form={form} className={PRIMARY} disabled={busy} data-testid={`${form}-submit`}>{busy ? 'Saving…' : cta}</button>
    </div>
  );
}

function AddRisk({ projectId, choices, onClose }) {
  const [form, setForm] = useState(addForm());
  const [state, run] = useSave(onClose);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = (e) => { e.preventDefault(); run(addBody(form), (body) => cyclesWrite.build.risk(projectId, body)); };
  return (
    <Lightbox label="Add a risk" title="Add a risk" phone="sheet" width={680} testId="risk-add-dialog" onClose={() => { if (!state.busy) onClose(false); }}
      footer={<Footer busy={state.busy} cta="Add risk" form="risk-add-form" onCancel={() => onClose(false)} />}>
      <form id="risk-add-form" className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <Field id="risk-add-title" label="Title"><input id="risk-add-title" className={INPUT} value={form.title} onChange={set('title')} maxLength={200} required /></Field>
        <Radios name="Severity" options={severityOptions} value={form.severity} onChange={set('severity')} />
        <Field id="risk-add-owner" label="Owner · optional" hint="Company members only. “No owner” is allowed.">
          <select id="risk-add-owner" className={INPUT} value={form.owner} onChange={set('owner')}>
            <option value="">No owner</option>
            {(choices?.owners ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field id="risk-add-feature" label="Feature · optional" hint="Adding from a feature’s record fills this in.">
          <select id="risk-add-feature" className={INPUT} value={form.feature} onChange={set('feature')}>
            <option value="">Not tied to a feature</option>
            {(choices?.features ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field id="risk-add-mitigation" label="Mitigation · optional">
          <textarea id="risk-add-mitigation" className={`${INPUT} min-h-[72px] py-2`} value={form.mitigation} onChange={set('mitigation')} maxLength={2000} placeholder="How you will reduce this risk" />
        </Field>
        <p className="m-0 text-[12px] text-gray-700 dark:text-gray-300" data-testid="risk-add-fixed">{OWNER_FIXED}</p>
        {state.error && <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="risk-add-error">{state.error}</p>}
      </form>
    </Lightbox>
  );
}

function EditRisk({ projectId, row, onClose }) {
  const [form, setForm] = useState(editForm(row));
  const [state, run] = useSave(onClose);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = (e) => { e.preventDefault(); run(editBody(form, row), (body) => buildRisksApi.update(projectId, row.id, body)); };
  return (
    <Lightbox label="Edit risk" title="Edit risk" phone="sheet" width={680} testId="risk-edit-dialog" onClose={() => { if (!state.busy) onClose(false); }}
      footer={<Footer busy={state.busy} cta="Save risk" form="risk-edit-form" onCancel={() => onClose(false)} />}>
      <form id="risk-edit-form" className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <Field id="risk-edit-title" label="Title"><input id="risk-edit-title" className={INPUT} value={form.title} onChange={set('title')} maxLength={200} required /></Field>
        <Radios name="Severity" options={severityOptions} value={form.severity} onChange={set('severity')} />
        <Radios name="State" options={stateOptions} value={form.state} onChange={set('state')} />
        <Field id="risk-edit-mitigation" label="Mitigation">
          <textarea id="risk-edit-mitigation" className={`${INPUT} min-h-[72px] py-2`} value={form.mitigation ?? ''} onChange={set('mitigation')} maxLength={2000} />
        </Field>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]" data-testid="risk-edit-readonly">
          <dt className="font-semibold text-gray-700 dark:text-gray-300">Owner</dt><dd className="m-0 text-gray-900 dark:text-gray-100">{ownerText(row)} <span className="text-gray-600 dark:text-gray-400">· read only</span></dd>
          <dt className="font-semibold text-gray-700 dark:text-gray-300">Feature</dt><dd className="m-0 text-gray-900 dark:text-gray-100">{featureText(row)} <span className="text-gray-600 dark:text-gray-400">· read only</span></dd>
        </dl>
        {state.error && <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="risk-edit-error">{state.error}</p>}
      </form>
    </Lightbox>
  );
}

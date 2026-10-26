/**
 * D1219 (#3216) — the desk's in-page dialogs: Open a closing (CP13's
 * button), Choose the route (CP5), Withdraw a line, Mark Closed, and Axal's
 * countersign (CP14). Each says what it changes before it changes it, and
 * each act is the Worker's (D1215, D1216): a refusal is drawn as its own
 * sentence. Nothing here moves money.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { closingsApi, stagedSigningApi } from '../../lib/api/closings';
import { Lightbox, Unreadable } from '../../ui';
import { BTN, INPUT } from '../account/AccountCenter';
import {
  NOT_YET, DESK_WAITS, ROUTES, ROUTE_NEEDS, ROUTE_WORD, STEP_UP_LINE, VEHICLE_ASK, moneyCents, openableDeals, paperWord, routeBody, syndicateRef,
} from './deskModel';

const refusal = (e, fallback) => (typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : fallback);

export function Err({ text, testId }) {
  return text ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={testId}>{text}</p> : null;
}

export const NotYet = ({ children, testId }) => (
  <span className="inline-flex w-fit items-center rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400" data-testid={testId} title={children || undefined}>{NOT_YET}</span>
);

function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { const out = await fn(); return out ?? true; } catch (e) { setError(refusal(e, fallback)); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

function useLoad(run, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    run().then((data) => { if (live) setState({ status: 'ok', data }); }, () => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

const Foot = ({ children }) => <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">{children}</div>;

/** CP13's "Open a closing": a deal without an open closing, its round label and deadline. */
export function OpenClosingDialog({ dealId = null, onClose, onOpened }) {
  const read = useLoad(() => Promise.all([api.listDeals(), closingsApi.list()]), []);
  const [form, setForm] = useState({ deal: dealId ? String(dealId) : '', round: '', deadline: '' });
  const act = useAct();
  const deals = read.status === 'ok' ? openableDeals(read.data[0], read.data[1]?.closings) : [];
  const submit = async (e) => {
    e.preventDefault();
    if (!form.deal) { act.setError('Choose the deal this closing is for.'); return; }
    const body = { deal_id: Number(form.deal), round_label: form.round.trim() || undefined, deadline: form.deadline || undefined };
    const out = await act.run(() => closingsApi.open(body), 'The closing could not be opened. Try again.');
    if (out) onOpened?.(Number(form.deal), out);
  };
  return (
    <Lightbox label="Open a closing" title="Open a closing" sub="Opens one closing for a deal, with a line for each live commitment that holds an amount. Nothing moves money."
      testId="closings-open-dialog" onClose={onClose} width={520}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="closings-open-form">
        {read.status === 'loading' && <div className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}
        {read.status === 'error' && <Unreadable what="The deals and closings" claim="This is not a claim that no deal can open a closing." onRetry={read.retry} />}
        {read.status === 'ok' && (deals.length === 0
          ? <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400" data-testid="closings-open-none">Every deal already has an open closing, or there is no deal yet.</p>
          : (
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Deal
              <select className={INPUT} value={form.deal} onChange={(e) => setForm((f) => ({ ...f, deal: e.target.value }))} data-testid="closings-open-deal">
                <option value="">Choose a deal</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.name}{d.instrument ? ` · ${d.instrument}` : ''}{d.deadline ? ` · deadline ${d.deadline}` : ''}</option>)}
              </select>
            </label>
          ))}
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Round label <span className="font-normal text-gray-500 dark:text-gray-400">Optional, such as Seed.</span>
          <input className={INPUT} maxLength={80} value={form.round} onChange={(e) => setForm((f) => ({ ...f, round: e.target.value }))} data-testid="closings-open-round" />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Deadline <span className="font-normal text-gray-500 dark:text-gray-400">Left empty, the deal’s own closing deadline is used, if it has one.</span>
          <input type="date" className={INPUT} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} data-testid="closings-open-deadline" />
        </label>
        <Err text={act.error} testId="closings-open-error" />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={act.busy || read.status !== 'ok' || deals.length === 0} data-testid="closings-open-submit">Open the closing</button>
        </div>
      </form>
    </Lightbox>
  );
}

/** CP5: one card per route, what each needs, and the vehicle it goes through. */
export function RouteDialog({ closing, line, envelopes, onClose, onSaved }) {
  const [route, setRoute] = useState(line.route || '');
  const [vehicle, setVehicle] = useState(line.vehicle_ref || '');
  const act = useAct();
  const syndicates = useLoad(() => (route === 'syndicate' ? api.networkFxProjectSyndicates(closing.project_id) : Promise.resolve(null)), [route, closing.project_id]);
  const paper = paperWord(envelopes);
  const save = async () => {
    const body = routeBody(route, vehicle);
    if (body.error) { act.setError(body.error); return; }
    if (await act.run(() => closingsApi.setRoute(closing.uid, line.uid, body.route, body.vehicle_ref), 'The route could not be set. Try again.')) onSaved?.();
  };
  const list = Array.isArray(syndicates.data) ? syndicates.data : Array.isArray(syndicates.data?.syndicates) ? syndicates.data.syndicates : [];
  return (
    <Lightbox label="Choose the route" title={`Choose the route for ${line.investor_name || 'this line'}`}
      sub={`${moneyCents(line.amount_cents, line.currency) || 'Amount not recorded'}${closing.instrument ? ` · ${closing.instrument}` : ''}`}
      testId="closing-route-dialog" onClose={onClose} width={720}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Capital route">
          {ROUTES.map((r) => (
            <label key={r} className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 text-[12.5px] ${route === r ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/30' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`} data-testid={`closing-route-${r}`}>
              <span className="flex items-center gap-2 font-bold"><input type="radio" name="route" checked={route === r} onChange={() => { setRoute(r); act.setError(''); if (r !== line.route) setVehicle(''); }} />{ROUTE_WORD[r]}</span>
              <span className="text-gray-600 dark:text-gray-400">{ROUTE_NEEDS[r].line}</span>
              <span className="flex items-center justify-between gap-2">Signed paper <b data-testid={`closing-route-${r}-paper`}>{paper}</b></span>
              {ROUTE_NEEDS[r].needs.map((n) => <span key={n} className="flex items-center justify-between gap-2">{n}<NotYet>{DESK_WAITS.needs}</NotYet></span>)}
            </label>
          ))}
        </div>
        {route && route !== 'direct' && (
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold">{VEHICLE_ASK[route]}
            {route === 'syndicate' ? (
              syndicates.status === 'error' ? <Unreadable what="This venture’s syndicates" claim="This is not a claim that it has none." onRetry={syndicates.retry} />
                : syndicates.status === 'loading' ? <div className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
                  : list.length === 0 ? <span className="font-normal text-gray-600 dark:text-gray-400" data-testid="closing-route-no-spv">This venture has no syndicate on StudioOS. A lead creates one first.</span>
                    : (
                      <select className={INPUT} value={vehicle} onChange={(e) => setVehicle(e.target.value)} data-testid="closing-route-vehicle">
                        <option value="">Choose the SPV</option>
                        {list.map((s) => <option key={s.id} value={syndicateRef(s.id)}>{s.name || `Syndicate ${s.id}`}</option>)}
                      </select>
                    )
            ) : <input className={INPUT} maxLength={120} value={vehicle} onChange={(e) => setVehicle(e.target.value)} data-testid="closing-route-vehicle" />}
          </label>
        )}
        <Err text={act.error} testId="closing-route-error" />
      </div>
      <Foot>
        <span className="mr-auto text-[12px] text-gray-600 dark:text-gray-400">The founder and the investor see the route you set.</span>
        <button type="button" className={BTN.ghost} onClick={onClose}>Back</button>
        <button type="button" className={BTN.primary} disabled={act.busy || !route} onClick={save} data-testid="closing-route-save">Set the route</button>
      </Foot>
    </Lightbox>
  );
}

/** Withdraw one line: it no longer closes in this round. */
export function WithdrawLineDialog({ closing, line, onClose, onDone }) {
  const act = useAct();
  const go = async () => { if (await act.run(() => closingsApi.withdrawLine(closing.uid, line.uid), 'The line could not be withdrawn. Try again.')) onDone?.(); };
  return (
    <Lightbox label="Withdraw this line" title={`Withdraw ${line.investor_name || 'this line'}?`} sub="The line no longer closes in this round and counts in no total. Its evidence and its history stay on record."
      testId="closing-withdraw-dialog" onClose={onClose} width={460}>
      <div className="px-5 py-4"><Err text={act.error} testId="closing-withdraw-error" /></div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>Keep the line</button>
        <button type="button" className={BTN.danger} disabled={act.busy} onClick={go} data-testid="closing-withdraw-confirm">Withdraw the line</button>
      </Foot>
    </Lightbox>
  );
}

/** Mark Closed: nothing on the closing changes afterwards, and reporting duties start. */
export function CompleteDialog({ closing, onClose, onDone }) {
  const act = useAct();
  const go = async () => { if (await act.run(() => closingsApi.complete(closing.uid), 'The closing could not be closed. Try again.')) onDone?.(); };
  return (
    <Lightbox label="Mark the closing Closed" title="Mark the closing Closed?" sub="After this, nothing on the closing changes. Its reporting duties start from the signed papers."
      testId="closing-complete-dialog" onClose={onClose} width={460}>
      <div className="px-5 py-4"><Err text={act.error} testId="closing-complete-error" /></div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} disabled={act.busy} onClick={go} data-testid="closing-complete-confirm">Mark Closed</button>
      </Foot>
    </Lightbox>
  );
}

/**
 * CP14's countersign, a Super Admin's act (D1216): releases Axal's stage to
 * the caller, after a fresh step-up the request helper asks for. The signing
 * link is shown to that Super Admin alone and never logged.
 */
export function CountersignDialog({ envelope, onClose, onDone }) {
  const act = useAct();
  const [token, setToken] = useState('');
  const go = async () => {
    const out = await act.run(() => stagedSigningApi.countersign(envelope.uid), 'The countersign could not be released. Try again.');
    if (out && typeof out.token === 'string' && out.token) { setToken(out.token); onDone?.(); }
  };
  return (
    <Lightbox label="Countersign for Axal" title={`Countersign ${envelope.title || 'this paper'} for Axal?`}
      sub="Releases Axal’s stage to you. You sign it as Axal, last, and the envelope is complete when you do."
      testId="closing-countersign-dialog" onClose={onClose} width={480}>
      <div className="flex flex-col gap-2 px-5 py-4 text-[12.5px]">
        <p className="m-0 text-gray-600 dark:text-gray-400">{STEP_UP_LINE}.</p>
        {token && <a className={BTN.link} href={`/esign/${encodeURIComponent(token)}`} data-testid="closing-countersign-open">Open the envelope to sign</a>}
        <Err text={act.error} testId="closing-countersign-error" />
      </div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>{token ? 'Done' : 'Cancel'}</button>
        {!token && <button type="button" className={BTN.primary} disabled={act.busy} onClick={go} data-testid="closing-countersign-confirm">Release Axal’s stage to me</button>}
      </Foot>
    </Lightbox>
  );
}

/**
 * D804 (#2241) — the Licences page's Requests tab (canvas board L5),
 * `/admin/my-licence/requests`.
 *
 * The five requests an Administrator sends HQ (D799): renewal, a change of
 * terms (the sheet), seats (the sheet on its Seats chip), a delegate, and
 * notice of non-renewal. A kind this licence does not offer is drawn disabled
 * with the Worker's reason. The renewal timeline runs Today → Notice deadline
 * → Renewal; the deadline is the renewal date less D797's
 * `non_renewal_notice_days`, "Not recorded" until the licence's terms carry it.
 * "Your requests" lists each with HQ's response time, its status and HQ's
 * answer inline. Everything goes through D799's module; nothing changes until
 * HQ answers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import { reportError } from '../../../lib/log';
import RequestChangeSheet from './RequestChangeSheet';
import { NOT_RECORDED, renewalTimeline, requestRows } from './licenceTabsModel';

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const STATUS_TONE = {
  Open: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Answered: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Past response time': 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
};

/** The five buttons, in the canvas's order, and the kind each sends. */
export const REQUEST_BUTTONS = [
  { id: 'renewal', t: 'Request renewal', kind: 'renewal' },
  { id: 'change', t: 'Request a change', kind: 'terms_change' },
  { id: 'seats', t: 'Request seats', kind: 'seat_increase' },
  { id: 'delegate', t: 'Request a delegate', kind: 'delegate' },
  { id: 'non_renewal', t: 'Give notice of non-renewal', kind: 'non_renewal' },
];

/** The renewal, delegate and notice requests, which need no sheet: the body each sends. */
export function simpleRequest(id, { email, name } = {}) {
  if (id === 'renewal') return { ok: true, body: { kind: 'renewal', subject: 'Renewal', request: {} } };
  if (id === 'non_renewal') return { ok: true, body: { kind: 'non_renewal', subject: 'Notice of non-renewal', request: {} } };
  if (id === 'delegate') {
    const e = String(email ?? '').trim();
    if (!e) return { ok: false, message: 'Give the email address the delegate signs in with.' };
    const n = String(name ?? '').trim();
    return { ok: true, body: { kind: 'delegate', subject: `Delegate · ${n || e}`, request: { email: e, ...(n ? { name: n } : {}) } } };
  }
  return { ok: false, message: 'Unknown request.' };
}

function SimpleRequest({ id, onSent, onCancel, raise }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const words = {
    renewal: 'Ask HQ to renew this licence on its terms. HQ answers in the bell.',
    non_renewal: 'Tell HQ this licence is not to renew. The notice is dated the day HQ records it, and it is checked against your notice period.',
    delegate: 'Ask HQ to add a delegate administrator. HQ grants the role; this only asks.',
  }[id];
  async function send(e) {
    e.preventDefault();
    const built = simpleRequest(id, { email, name });
    if (!built.ok) { setErr(built.message); return; }
    setBusy(true); setErr('');
    try { onSent(await raise(built.body)); } catch (e2) { reportError('licence_request_failed', e2); setErr(e2?.message || 'The request could not be sent.'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={send} className={`${CARD} space-y-2`} data-testid={`request-form-${id}`}>
      <p className="text-sm text-gray-700 dark:text-gray-300">{words}</p>
      {id === 'delegate' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-600 dark:text-gray-400">Email<input className={`${INPUT} mt-0.5`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="text-xs text-gray-600 dark:text-gray-400">Name (optional)<input className={`${INPUT} mt-0.5`} value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
      )}
      {err && <p className="text-[11px] text-red-600" role="alert">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Send request</button>
        <button type="button" className={BTN} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The tab, given D799's list and `/mine`. Separate from the loader so a test can draw it. */
export function RequestsView({ list, mine, today, initialChange = null, raise = licenceRequestsApi.raise, onReload }) {
  const [form, setForm] = useState(null);
  const [sheet, setSheet] = useState(initialChange !== null ? { prefillTerm: initialChange || null, startChip: null } : null);
  const [sent, setSent] = useState('');
  const licence = mine?.licence || null;
  const hidden = new Map((list?.kinds_hidden || []).map((h) => [h.kind, h.reason]));
  const timeline = renewalTimeline(licence?.renews_on, mine?.terms?.non_renewal_notice_days ?? null, today);
  const rows = requestRows(list?.items, list?.response_hours || {});
  const done = (row) => { setForm(null); setSheet(null); setSent(`Sent to HQ${row?.due_at ? `. HQ answers by ${String(row.due_at).slice(0, 10)}` : ''}.`); onReload?.(); };

  return (
    <div className="space-y-4" data-testid="requests-tab">
      <div className="flex flex-wrap gap-2" data-testid="request-buttons">
        {REQUEST_BUTTONS.map((b) => (
          <button key={b.id} type="button" className={BTN} disabled={hidden.has(b.kind)} title={hidden.get(b.kind) || undefined}
            onClick={() => {
              setSent('');
              if (b.id === 'change') { setForm(null); setSheet({ prefillTerm: null, startChip: 'territory' }); }
              else if (b.id === 'seats') { setForm(null); setSheet({ prefillTerm: null, startChip: 'seats' }); }
              else { setSheet(null); setForm(b.id); }
            }}>
            {b.t}
          </button>
        ))}
      </div>
      {sent && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{sent}</p>}
      {form && <SimpleRequest id={form} raise={raise} onSent={done} onCancel={() => setForm(null)} />}

      <section className={CARD} data-testid="renewal-timeline">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Renewal timeline</h3>
        <ol className="flex flex-wrap items-start gap-3">
          {timeline.map((p, i) => (
            <li key={p.t} className="flex items-center gap-3">
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{p.t}</span>
                <span className={p.d === NOT_RECORDED ? 'text-xs italic text-gray-400' : 'text-xs text-gray-600 dark:text-gray-400'}>{p.d}</span>
              </span>
              {i < timeline.length - 1 && <span className="h-px w-10 bg-gray-300 dark:bg-gray-700" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </section>

      <section className={CARD} data-testid="your-requests">
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Your requests</h3>
        {!rows.length ? <p className="text-sm text-gray-500">You have sent HQ no request yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  {['Kind', 'Sent', 'HQ response time', 'Status', "HQ's answer"].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-t border-gray-100 align-top dark:border-gray-800">
                    <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{r.k}</td>
                    <td className="px-2 py-2 text-gray-600 dark:text-gray-400">{r.w}</td>
                    <td className="px-2 py-2 text-gray-600 dark:text-gray-400">{r.rt}</td>
                    <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.st] || STATUS_TONE.Open}`}>{r.st}</span></td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{r.a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RequestChangeSheet
        open={!!sheet}
        prefillTerm={sheet?.prefillTerm || null}
        startChip={sheet?.startChip || null}
        licence={licence}
        sections={mine?.sections || null}
        terms={mine?.terms || null}
        requestable={list?.requestable_terms || []}
        seatTypes={list?.seat_types || []}
        responseHours={list?.response_hours || {}}
        onClose={() => setSheet(null)}
        onSent={done}
        api={{ raise }}
      />
    </div>
  );
}

export default function RequestsTab() {
  const [list, setList] = useState(undefined);
  const [mine, setMine] = useState(null);
  const [params] = useSearchParams();
  const change = params.has('change') ? params.get('change') : null;
  const load = useCallback(() => {
    licenceRequestsApi.list()
      .then(setList)
      .catch((e) => { reportError('licence_requests_list_failed', e); setList(null); });
    // `/mine` gives the licence the sheet and the timeline read; unread, they say "Not recorded".
    api.myLicence().then(setMine).catch(() => setMine(null));
  }, []);
  useEffect(load, [load]);
  if (list === undefined) return <p className="text-sm text-gray-500">Loading…</p>;
  if (list === null) return <p className="text-sm text-red-600">Your requests could not be read. Nothing here is a statement that you have sent none.</p>;
  return <RequestsView list={list} mine={mine} today={new Date().toISOString()} initialChange={change} onReload={load} />;
}

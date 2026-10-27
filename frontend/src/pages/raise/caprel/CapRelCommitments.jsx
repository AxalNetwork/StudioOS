import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { Unreadable } from '../../../ui';
import { ProRataPanel } from '../RoundClosesPanel';
import { Dialog, Footer, useWrite } from './CapRelPipeline';
import { CLOSING, amountText, centsText, tabHref } from './capRelModel';
import { CLOSE_STATES, commitmentBar, commitmentRows, roundBody, sourceGaps } from './capRelTabsModel';

/**
 * D1193 (#3127, CRL9, CRL10) — Commitments: committed against the target
 * with what is not counted, every commitment with its status and source
 * (D1190's one read across the typed pipeline, round calls, deal rooms and the
 * founder's Mercury matches), the closes, pro-rata, and the two dialogs:
 * Round settings and New close.
 *
 * WHAT COUNTS is the read's: Received, Signed, Wired, Confirmed and Pending.
 * Indicated, Soft and "Status not recorded" are listed and never counted; a
 * missing amount reads "Not recorded", never $0. Commitments become signed
 * only in the closing room; this tab shows them and signs nothing.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200';
const BTN_S = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-2.5 text-[12px] font-semibold text-axal-ink no-underline hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const H3 = `m-0 text-[14px] font-extrabold ${INK}`;
/** The counted statuses solid, the listed ones hatched, as the canvas draws them. */
const SEG = {
  received: 'bg-emerald-500 dark:bg-emerald-400', signed: 'bg-axal-violet dark:bg-violet-400', wired: 'bg-sky-500 dark:bg-sky-400',
  confirmed: 'bg-indigo-500 dark:bg-indigo-400', pending: 'bg-amber-400 dark:bg-amber-300',
  indicated: 'bg-[repeating-linear-gradient(45deg,#a78bfa_0_3px,transparent_3px_6px)] dark:bg-[repeating-linear-gradient(45deg,#7c3aed_0_3px,transparent_3px_6px)]',
  soft: 'bg-[repeating-linear-gradient(45deg,#9ca3af_0_3px,transparent_3px_6px)] dark:bg-[repeating-linear-gradient(45deg,#4b5563_0_3px,transparent_3px_6px)]',
};
const STATUS_TONE = {
  counted: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  listed: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  not_recorded: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
};

function useRead(fn, deps) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    Promise.resolve().then(fn)
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...read, reload: () => setN((x) => x + 1) };
}

/** Round settings (CRL10): name, target, currency, close date and notes; the change shows in Activity. */
export function RoundSettingsDialog({ projectId, onClose, onDone }) {
  const [f, setF] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => api.raiseRound(projectId))
      .then((d) => { const r = d?.round || {}; if (alive) setF({ name: r.name || '', target: r.target_amount ?? '', currency: r.currency || 'USD', close_date: r.close_date || '', notes: r.notes || '' }); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [projectId]);
  const w = useWrite(() => { onDone?.(); onClose(); });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === 'currency' ? e.target.value.toUpperCase() : e.target.value }));
  const out = f ? roundBody(projectId, f) : null;
  return (
    <Dialog label="Round settings" testId="caprel-round-dialog" onClose={onClose} title="Round settings"
      sub="The round’s name, target, currency and close date. Changes show in Activity."
      footer={<Footer testId="caprel-round" busy={w.busy} error={w.error || out?.error || ''} onClose={onClose} cta="Save round" disabled={!f || !!out?.error}
        onGo={() => w.run(() => api.raiseRoundSave(out.body), 'The round could not be saved')} />}>
      {failed ? <Unreadable what="The round" claim="Saving here would set it from blank." /> : null}
      {f ? (
        <div className="flex flex-col gap-3">
          <label className={LABEL}>Round name<input className={FIELD} value={f.name} onChange={set('name')} data-testid="caprel-round-name" /></label>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <label className={LABEL}>Target<input className={`${FIELD} font-mono`} inputMode="decimal" value={f.target} onChange={set('target')} data-testid="caprel-round-target" /></label>
            <label className={LABEL}>Currency<input className={`${FIELD} font-mono`} maxLength={3} value={f.currency} onChange={set('currency')} data-testid="caprel-round-currency" /></label>
          </div>
          <label className={LABEL}>Close date<input className={FIELD} type="date" value={f.close_date} onChange={set('close_date')} /></label>
          <label className={LABEL}>Notes<textarea className={FIELD} rows={2} value={f.notes} onChange={set('notes')} /></label>
          <p className={`m-0 text-[12px] ${MUTED}`}>One currency per venture: a commitment in another currency is listed and never added in. Instrument and terms are set in the Call for Capital and the closing room.</p>
        </div>
      ) : (!failed ? <div className="h-32 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" /> : null)}
    </Dialog>
  );
}

/** New close (CRL10): a close groups the commitments that sign together. */
export function NewCloseDialog({ projectId, onClose, onDone }) {
  const [f, setF] = useState({ name: '', target_date: '', state: 'planned' });
  const w = useWrite(() => { onDone?.(); onClose(); });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog label="New close" testId="caprel-close-dialog" onClose={onClose} title="New close"
      sub={f.name.trim() ? `${f.name.trim()} is added to the round as ${CLOSE_STATES.find((s) => s.value === f.state)?.label}${f.target_date ? `, targeting ${f.target_date}` : ''}.` : 'A close groups the commitments that sign together.'}
      footer={<Footer testId="caprel-close" busy={w.busy} error={w.error} onClose={onClose} cta="Add close" disabled={!f.name.trim()}
        onGo={() => w.run(() => api.raiseCloseCreate({ project_id: projectId, name: f.name.trim(), state: f.state, target_date: f.target_date || undefined }), 'The close could not be added')} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>Name<input className={FIELD} value={f.name} onChange={set('name')} data-testid="caprel-close-name" /></label>
        <label className={LABEL}>Target date<input className={FIELD} type="date" value={f.target_date} onChange={set('target_date')} /></label>
        <label className={LABEL}>State
          <select className={FIELD} value={f.state} onChange={set('state')} data-testid="caprel-close-state">{CLOSE_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </label>
      </div>
    </Dialog>
  );
}

/** Change a close's state: the dialog says what changes. */
function CloseStateDialog({ close, onClose, onDone }) {
  const [state, setState] = useState(close.state || 'planned');
  const w = useWrite(() => { onDone?.(); onClose(); });
  const label = (v) => CLOSE_STATES.find((s) => s.value === v)?.label || v;
  return (
    <Dialog label="Change close" testId="caprel-close-state-dialog" onClose={onClose} title={close.name}
      sub={`The close changes from ${label(close.state)} to ${label(state)}.${state === 'closed' && !close.closed_date ? ' Its closed date is today.' : ''}`}
      footer={<Footer testId="caprel-close-state" busy={w.busy} error={w.error} onClose={onClose} cta="Save" disabled={state === close.state}
        onGo={() => w.run(() => api.raiseCloseUpdate(close.id, { state }), 'The close could not be changed')} />}>
      <select className={FIELD} value={state} onChange={(e) => setState(e.target.value)}>{CLOSE_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
    </Dialog>
  );
}

function Bar({ read }) {
  const b = commitmentBar(read);
  const all = [...b.counted, ...b.listed];
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="caprel-commit-bar">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className={`${H3} mr-auto`}>Committed against the target</h3>
        <span className={`font-mono text-[13px] font-bold ${INK}`} data-testid="caprel-commit-total">{b.total}{b.target ? ` of ${b.target}` : ''}{b.percent != null ? ` · ${b.percent}%` : ''}</span>
      </div>
      {read.round_reason ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="caprel-commit-no-round">{read.round_reason}</p> : null}
      <div className="flex h-3 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="img" aria-label={`${b.total} counted${b.target ? ` of ${b.target}` : ''}`}>
        {b.target ? all.map((s) => <div key={s.status} className={SEG[s.status]} style={{ width: `${s.share}%` }} title={`${s.label} ${s.text}`} />) : null}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11.5px]" data-testid="caprel-commit-legend">
        {all.map((s) => (
          <li key={s.status} className={`inline-flex items-center gap-1.5 ${s.counted ? INK : MUTED}`}>
            <span className={`h-2.5 w-2.5 rounded-sm ${SEG[s.status]}`} aria-hidden="true" />{s.label} {s.text}{s.counted ? '' : ' · not counted'}
          </li>
        ))}
        {!all.length ? <li className={MUTED}>No commitment with an amount is recorded.</li> : null}
      </ul>
      {b.noStatus ? (
        <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-300" data-testid="caprel-commit-no-status">
          Status not recorded: {b.noStatus} {b.noStatus === 1 ? 'investor is' : 'investors are'} not counted until you set how sure {b.noStatus === 1 ? 'it is' : 'they are'}.
        </p>
      ) : null}
      {read.totals?.partial ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert">A source could not be read, so the total may be short. See below.</p> : null}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>{read.basis}</p>
    </section>
  );
}

function Every({ read }) {
  const [f, setF] = useState({ q: '', status: '' });
  const rows = useMemo(() => commitmentRows(read, f), [read, f]);
  const statuses = Object.entries(read.words?.status || {});
  return (
    <section className={`${CARD} flex min-w-0 flex-col`} data-testid="caprel-commit-every">
      <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h3 className={`${H3} mr-auto`}>Every commitment</h3>
        <input className={`${FIELD} w-44`} placeholder="Search investors" aria-label="Search investors" value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} data-testid="caprel-commit-search" />
        <select className={`${FIELD} w-auto`} aria-label="Status" value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))} data-testid="caprel-commit-status">
          <option value="">Any status</option>{statuses.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-[12.5px]">
          <thead><tr className={`border-b border-axal-hairline text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED} dark:border-gray-800`}>
            {['Investor', 'Amount', 'Status', 'Source', 'Date', ''].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid="caprel-commit-row">
                <td className={`px-3 py-2 font-bold ${INK}`}>{r.investor}</td>
                <td className={`px-3 py-2 font-mono ${r.amount === 'Not recorded' ? MUTED : INK}`}>{r.amount}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[r.counted ? 'counted' : r.status === 'not_recorded' ? 'not_recorded' : 'listed']}`}>{r.status_label}</span>
                  {r.why ? <div className={`mt-1 text-[11.5px] ${MUTED}`}>{r.why}</div> : null}
                </td>
                <td className={`px-3 py-2 ${INK}`}>{r.source_label}</td>
                <td className={`px-3 py-2 font-mono ${r.on ? INK : MUTED}`}>{r.on || '—'}</td>
                <td className="px-3 py-2 text-right">{r.status === 'not_recorded' || r.status === 'soft' ? <span className={`text-[12px] ${MUTED}`}>Set status on Pipeline</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="caprel-commit-none">{(read.investors || []).length ? 'No commitment matches.' : 'No commitment is recorded yet.'}</p> : null}
      </div>
      <p className={`m-0 border-t border-axal-hairline px-4 py-2 text-[11.5px] ${MUTED} dark:border-gray-800`}>Close or tranche, and route: not recorded on a commitment until a closing exists.</p>
    </section>
  );
}

function Closes({ projectId }) {
  const read = useRead(() => api.raiseCloses(projectId), [projectId]);
  const [dialog, setDialog] = useState(null);
  const closes = read.data?.closes || [];
  const money = (v) => amountText(v) || 'Not recorded';
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="caprel-commit-closes">
      <div className="flex items-center gap-2"><h3 className={`${H3} mr-auto`}>Closes and tranches</h3>
        <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'new' })} disabled={read.data && !read.data.round} data-testid="caprel-close-new">New close</button>
      </div>
      {read.status === 'unreadable' ? <Unreadable what="The closes" claim="This is not a claim that there are none." onRetry={read.reload} /> : null}
      {read.data && !read.data.round ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Set up the round first in Round settings; closes are tranches of it.</p> : null}
      {closes.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 dark:border-gray-800" data-testid="caprel-close">
          <div className="mr-auto min-w-0">
            <div className={`text-[13px] font-bold ${INK}`}>{c.name}</div>
            <div className={`font-mono text-[11.5px] ${MUTED}`}>
              {c.closed_date ? `Closed ${c.closed_date}` : c.target_date ? `Target ${c.target_date}` : 'No date set'} · Wired {money(c.wired)} · Signed {money(c.signed)} · Soft {money(c.soft)}, not counted
            </div>
          </div>
          <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'state', c })} data-testid="caprel-close-change">{CLOSE_STATES.find((s) => s.value === c.state)?.label || c.state}</button>
        </div>
      ))}
      {read.data?.round && !closes.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No close yet.</p> : null}
      {dialog?.kind === 'new' ? <NewCloseDialog projectId={projectId} onClose={() => setDialog(null)} onDone={read.reload} /> : null}
      {dialog?.kind === 'state' ? <CloseStateDialog close={dialog.c} onClose={() => setDialog(null)} onDone={read.reload} /> : null}
    </section>
  );
}

function Mercury({ read }) {
  const m = read.sources?.mercury;
  const lines = (read.investors || []).flatMap((inv) => (inv.lines || []).filter((l) => l.source === 'connector').map((l) => ({ ...l, investor: inv.name })));
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="caprel-commit-mercury">
      <h3 className={H3}>From Mercury</h3>
      {m && m.state !== 'ok' ? <p className={`m-0 text-[12.5px] ${MUTED}`}>{m.reason}</p> : null}
      {lines.map((l) => (
        <div key={`${l.investor}:${l.key}`} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 dark:border-gray-800">
          <div className="mr-auto"><div className={`font-mono text-[12.5px] font-bold ${INK}`}>Credit {l.cents == null ? 'amount not recorded' : centsText(l.cents, l.currency)} · {l.on || 'date not recorded'}</div><div className={`text-[12px] ${MUTED}`}>Matched to {l.investor} · Received</div></div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">Matched</span>
        </div>
      ))}
      {(!m || m.state === 'ok') && !lines.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No Mercury credit is matched to an investor in this round.</p> : null}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>A credit is matched to an investor on Overview’s Mercury card. Only the founder reads their own Mercury.</p>
    </section>
  );
}

export default function CapRelCommitments({ projectId, search = '' }) {
  const read = useRead(() => capitalRelationshipsApi.commitments(projectId), [projectId]);
  const [dialog, setDialog] = useState(null);
  const [err, setErr] = useState('');
  const gaps = read.data ? sourceGaps(read.data).filter((g) => g.key !== 'mercury') : [];
  return (
    <div className="flex flex-col gap-4" data-testid="caprel-commitments">
      <div className="flex flex-wrap items-center gap-2">
        <p className={`m-0 mr-auto text-[13px] ${INK}`}><Link to={tabHref(CLOSING, search)} className="font-semibold underline" data-testid="caprel-closing-door">Open the closing room</Link> for the paper, the lines and what is received.</p>
        <button type="button" className={BTN_S} onClick={() => setDialog('round')} data-testid="caprel-round-open">Round settings</button>
      </div>
      {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="caprel-commitments-error">{err}</p> : null}
      {read.status === 'unreadable' ? <Unreadable what="The commitments" claim="This is not a claim that nobody committed." onRetry={read.reload} /> : null}
      {read.status === 'loading' && !read.data ? <div className="h-40 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" data-testid="caprel-commitments-loading" /> : null}
      {read.data ? (
        <>
          <Bar read={read.data} />
          {gaps.map((g) => <p key={g.key} className={`m-0 text-[12.5px] ${g.state === 'unreadable' ? 'text-red-700 dark:text-red-300' : MUTED}`} data-testid="caprel-commit-gap">{g.reason}</p>)}
          <Every read={read.data} />
        </>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Closes projectId={projectId} />
        {read.data ? <Mercury read={read.data} /> : <div />}
      </div>
      <section className={`${CARD} p-4`}><ProRataPanel projectId={projectId} onError={setErr} /></section>
      <p className={`m-0 rounded-xl border border-violet-200 bg-axal-lavender px-4 py-2.5 text-[12.5px] ${INK} dark:border-violet-900 dark:bg-violet-950/30`}>
        Commitments become signed only in the closing room. This tab shows them; it does not sign them.
      </p>
      {dialog === 'round' ? <RoundSettingsDialog projectId={projectId} onClose={() => setDialog(null)} onDone={read.reload} /> : null}
    </div>
  );
}

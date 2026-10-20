/**
 * D804 (#2241) — the Licences page's Contract tab (canvas board L3),
 * `/admin/my-licence/contract`.
 *
 * READ FROM D798 ALONE (`licenceAccountApi.contract`): the contract in force
 * and the one sent and waiting, shown together as the Summary card shows them;
 * the stored body, never re-rendered, with its section index from its own
 * headings and every merge field the licence has not filled drawn
 * "[not filled]"; "Download PDF"; "Sign" only when the Worker gave this caller
 * a `sign_url`; the earlier versions, read-only. With nothing sent yet it is
 * the "Waiting for HQ" card.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileSignature, Loader2 } from 'lucide-react';
import { licenceAccountApi } from '../../../lib/api/licenceAccount';
import { reportError } from '../../../lib/log';
import { NOT_RECORDED, bodyBlocks, contractSteps, contractSummary, day, sectionIndex } from './licenceTabsModel';

const CARD = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const BTN_PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetches one contract's PDF and saves it; called only from its button. */
export async function downloadContractPdf(uid, { api = licenceAccountApi, save = saveBlob } = {}) {
  const { blob, filename } = await api.contractPdfBlob(uid);
  save(blob, filename || `contract-${uid}.pdf`);
}

function PdfButton({ uid, label = 'Download PDF' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <span className="inline-flex flex-col">
      <button type="button" className={BTN} disabled={busy}
        onClick={async () => {
          setBusy(true); setErr('');
          try { await downloadContractPdf(uid); } catch (e) { reportError('licence_contract_pdf_failed', e); setErr(e?.message || 'The PDF could not be downloaded.'); } finally { setBusy(false); }
        }}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {label}
      </button>
      {err && <span className="mt-1 text-[11px] text-red-600" role="alert">{err}</span>}
    </span>
  );
}

function Steps({ contract }) {
  const steps = contractSteps(contract);
  return (
    <ol className="flex flex-wrap items-center gap-2" data-testid="contract-steps">
      {steps.map((s, i) => (
        <li key={s.t} className="flex items-center gap-2 text-xs">
          <span className={`h-2.5 w-2.5 rounded-full ${s.reached ? 'bg-slate-700 dark:bg-slate-300' : 'bg-gray-300 dark:bg-gray-700'}`} aria-hidden="true" />
          <span className="font-semibold text-gray-800 dark:text-gray-200">{s.t}</span>
          <span className={s.d === NOT_RECORDED ? 'italic text-gray-400' : 'text-gray-500 dark:text-gray-400'}>{s.d}</span>
          {i < steps.length - 1 && <span className="h-px w-6 bg-gray-300 dark:bg-gray-700" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function Body({ contract }) {
  const index = sectionIndex(contract.body_md);
  return (
    <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
      {index.length > 0 && (
        <nav className="hidden lg:block" aria-label="Contract sections" data-testid="contract-index">
          <ul className="sticky top-4 space-y-1 text-xs">
            {index.map((x) => (
              <li key={x.id}><a href={`#${x.id}`} className="block rounded px-2 py-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">§{x.n} {x.t}</a></li>
            ))}
          </ul>
        </nav>
      )}
      <article className="min-w-0 space-y-3 text-sm leading-relaxed text-gray-800 dark:text-gray-200" data-testid="contract-body">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{contract.template_title} · v{contract.template_version}</div>
        {bodyBlocks(contract.body_md).map((b, i) => {
          if (b.kind === 'title') return <h3 key={i} className="text-base font-bold">{b.text}</h3>;
          if (b.kind === 'heading') return <h4 key={i} id={b.id} className="scroll-mt-4 pt-2 font-semibold">{b.n}. {b.text}</h4>;
          return (
            <p key={i} className="whitespace-pre-line">
              {b.runs.map((r, j) => (r.gap
                ? <mark key={j} title={r.gap} className="rounded bg-amber-100 px-1 text-[12px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">[not filled]</mark>
                : <React.Fragment key={j}>{r.text}</React.Fragment>))}
            </p>
          );
        })}
      </article>
    </div>
  );
}

/** The tab, given D798's answer. Separate from the loader so a test can draw it. */
export function ContractView({ answer }) {
  if (answer?.available === false) {
    return <div className={CARD}><p className="text-sm text-gray-600 dark:text-gray-400">{answer.reason}</p></div>;
  }
  const shown = answer?.pending || answer?.in_force;
  if (!shown) {
    return (
      <div className={CARD} data-testid="contract-waiting">
        <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-gray-500">Waiting for HQ</div>
        <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">No contract has been sent yet</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">HQ drafts the licence agreement and sends it here for your signature. Nothing to do until then.</p>
        {answer?.sign_reason && <p className="mt-2 text-xs text-gray-500">{answer.sign_reason}</p>}
      </div>
    );
  }
  const summary = contractSummary(answer);
  return (
    <div className="space-y-4" data-testid="contract-tab">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Steps contract={shown} />
            <ul className="space-y-0.5 text-sm text-gray-700 dark:text-gray-300" data-testid="contract-summary">
              {summary.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <PdfButton uid={shown.uid} />
            {answer.sign_url
              ? <a href={answer.sign_url} className={BTN_PRIMARY} data-testid="contract-sign"><FileSignature size={12} /> Sign</a>
              : answer.sign_reason && <span className="self-center text-xs text-gray-500 dark:text-gray-400" data-testid="contract-sign-reason">{answer.sign_reason}</span>}
          </div>
        </div>
      </section>
      <section className={CARD}><Body contract={shown} /></section>
      {answer.pending && answer.in_force && (
        <section className={CARD} data-testid="contract-in-force">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">In force: v{answer.in_force.template_version}, signed {day(answer.in_force.signed_at) || NOT_RECORDED}</span>
            <PdfButton uid={answer.in_force.uid} />
          </div>
        </section>
      )}
      {(answer.earlier || []).length > 0 && (
        <section className={CARD} data-testid="contract-earlier">
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Earlier versions</h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {answer.earlier.map((c) => (
              <li key={c.uid} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-gray-700 dark:text-gray-300">v{c.template_version}{c.superseded_at ? `, superseded ${day(c.superseded_at)}` : ''}</span>
                <span className="flex items-center gap-2 text-xs text-gray-500">Read-only <PdfButton uid={c.uid} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function ContractTab() {
  const [answer, setAnswer] = useState(undefined);
  const load = useCallback(() => {
    licenceAccountApi.contract()
      .then(setAnswer)
      .catch((e) => { reportError('licence_contract_load_failed', e); setAnswer(null); });
  }, []);
  useEffect(load, [load]);
  if (answer === undefined) return <p className="text-sm text-gray-500">Loading…</p>;
  if (answer === null) return <p className="text-sm text-red-600">Your contract could not be read. Nothing here is a statement that you have none.</p>;
  return <ContractView answer={answer} />;
}

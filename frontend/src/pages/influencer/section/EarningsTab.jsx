import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  earningTiles, methodNamed, milestoneView, payoutBody, payoutGate, payoutHistory, readinessRows, taxFormAction, termsView, weeklyByCurrency, money,
} from './influencerSectionModel';
import { BODY, BlockUnreadable, Eyebrow, FIELD, Figure, INK, Loading, MUTED, MoneyLines, Panel, SECONDARY } from './InfluencerParts';

/**
 * D4289 P7 (#4296), IN4 and IN4p — Earnings at `/influencer/earnings`: the
 * commission tiles one line per currency (never summed), the commission by
 * week per currency, the bonuses, the payout checklist in the Worker's words
 * (`GET /api/influencer/me/payout-readiness`), the tax form, the terms, and
 * Request payout — off until the identity check, the tax form and a payout
 * method are all done and the Worker's checklist is ready.
 *
 * The board's per-invoice ledger is drawn as the commission per week and per
 * currency: no read on `main` returns invoice lines without the commission
 * row's other columns, and this page carries none of them.
 */
export default function EarningsTab({ analytics, readiness, payouts, tiers, membership, accent, reads, onChanged, onRetry }) {
  if (!analytics || analytics.status === 'loading' || !readiness || readiness.status === 'loading') return <Loading />;
  const a = analytics.status === 'ok' ? analytics.data : null;
  return (
    <div className="flex flex-col gap-4" data-testid="influencer-earnings">
      {analytics.status === 'error'
        ? <BlockUnreadable what="Your commission" onRetry={onRetry} />
        : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="earning-tiles">
            {earningTiles(a.commission).map((t) => (
              <Panel key={t.key} testId={`tile-${t.key}`}>
                <Eyebrow>{t.label}</Eyebrow>
                <div className="mt-1"><MoneyLines m={t} big /></div>
              </Panel>
            ))}
          </div>
        )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {a && <WeeklyLedger commission={a.commission} />}
          {a && <Bonuses bonuses={a.bonuses} />}
        </div>
        <div className="flex flex-col gap-4">
          {readiness.status === 'error'
            ? <BlockUnreadable what="Your payout checklist" onRetry={onRetry} />
            : <PayoutCard readiness={readiness.data} payouts={payouts} accent={accent} reads={reads} onChanged={onChanged} />}
          <Panel title="Your terms" testId="earnings-terms">
            <dl className="grid grid-cols-2 gap-2">
              {termsView(membership, tiers?.status === 'ok' ? tiers.data?.tiers : null).map((r) => (
                <div key={r.k}><dt><Eyebrow>{r.k}</Eyebrow></dt><dd className={`text-sm ${BODY}`}>{r.v}</dd></div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function WeeklyLedger({ commission }) {
  const series = weeklyByCurrency(commission);
  return (
    <Panel title="Commission by week" sub="One line per week and currency. No member names." testId="earnings-ledger">
      {commission && commission.available === false && <Figure f={{ state: commission.reason === 'not_recorded' ? 'not_recorded' : 'unreadable', source: commission.source }} />}
      {commission && commission.available !== false && !series.length && <span className={`text-sm ${MUTED}`}>None yet</span>}
      {series.map((s) => (
        <div key={s.currency} role="table" className="mb-3 w-full text-sm" data-testid={`ledger-${s.currency}`}>
          <div role="row" className={`grid grid-cols-2 border-b border-[#ececf1] pb-1 text-xs font-semibold dark:border-gray-700 ${MUTED}`}>
            <span role="columnheader">Week of</span><span role="columnheader" className="text-right">Earned · {s.currency}</span>
          </div>
          {s.weeks.filter((w) => w.cents !== 0).map((w) => (
            <div role="row" key={w.week} className="grid grid-cols-2 py-1">
              <span role="cell" className={`font-mono text-xs ${BODY}`}>{w.week}</span>
              <span role="cell" className={`text-right font-mono text-xs font-semibold ${INK}`}>{money(w.cents, s.currency)}</span>
            </div>
          ))}
        </div>
      ))}
      <p className={`text-[11px] ${MUTED}`}>A refund reverses its commission. Pending commission becomes payable after 30 days.</p>
    </Panel>
  );
}

function Bonuses({ bonuses }) {
  const v = milestoneView(bonuses);
  return (
    <Panel title="Bonuses" sub="For paid members you brought in, all time." testId="earnings-bonuses">
      {v.state !== 'ok' ? <Figure f={v} /> : (
        <ul className="flex flex-col gap-1.5">
          {v.earned.map((b) => (
            <li key={b.milestone} className="flex items-center gap-2 text-sm">
              <Check size={13} className="text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
              <span className={INK}>{b.text}</span>
              <span className={`font-mono text-xs ${MUTED}`}>{b.amount}{b.at ? ` · earned ${b.at}` : ''}</span>
            </li>
          ))}
          {v.next && <li className={`text-sm ${BODY}`}>{v.next}</li>}
          {!v.earned.length && !v.next && <li className={`text-sm ${MUTED}`}>None yet</li>}
        </ul>
      )}
    </Panel>
  );
}

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

function PayoutCard({ readiness, payouts, accent, reads, onChanged }) {
  const rows = readinessRows(readiness);
  const [draft, setDraft] = useState({ method: 'wire', label: '', last4: '' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [formType, setFormType] = useState('w8ben');
  const enabled = payoutGate(readiness, draft);
  const methodItem = (readiness?.items || []).find((i) => i.key === 'payout_method');
  const taxItem = (readiness?.items || []).find((i) => i.key === 'tax_form');
  const termsItem = (readiness?.items || []).find((i) => i.key === 'terms');
  const run = async (fn, ok) => {
    setBusy(true); setSaid(null);
    try { await fn(); if (ok) setSaid(ok); onChanged?.(); } catch (e) { setSaid(e?.message || 'That did not go through. Nothing was changed; try again.'); } finally { setBusy(false); }
  };
  const history = payouts?.status === 'ok' ? payoutHistory(payouts.data) : [];
  return (
    <Panel title="Payout" sub={readiness?.minimum_cents ? `Monthly, from ${money(readiness.minimum_cents, readiness.currency)}.` : undefined} testId="earnings-payout">
      <Eyebrow>Before you can be paid</Eyebrow>
      <ul className="mt-1 flex flex-col gap-1.5" data-testid="payout-checklist">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-sm" data-testid={`check-${r.key}`} data-ready={r.ready ? 'yes' : 'no'}>
            {r.ready
              ? <Check size={14} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-label="Done" />
              : <X size={14} className="mt-0.5 shrink-0 text-[#6b6577] dark:text-gray-400" aria-label="Not done" />}
            <span><b className={INK}>{r.label}</b> <span className={BODY}>· {r.line}</span></span>
          </li>
        ))}
      </ul>

      {taxItem && taxFormAction(taxItem) === 'upload' && (
        <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="payout-tax-upload">
          <label className={`text-xs font-semibold ${MUTED}`}>Form
            <select className={FIELD} value={formType} onChange={(e) => setFormType(e.target.value)}>
              <option value="w9">W-9 (US persons)</option>
              <option value="w8ben">W-8BEN (everyone else)</option>
            </select>
          </label>
          <label className={SECONDARY}>
            Upload the form
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) run(async () => reads.submitTaxForm({ form_type: formType, file: await readFile(f) }), 'Sent to HQ for review.'); }} />
          </label>
        </div>
      )}
      {termsItem && !termsItem.ready && (
        <div className="mt-3"><button type="button" className={SECONDARY} disabled={busy} onClick={() => run(() => reads.acceptTerms(termsItem.version), 'Accepted.')} data-testid="payout-accept-terms">Accept the current terms</button></div>
      )}

      {methodItem && !methodItem.ready && (
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="payout-method-form">
          <label className={`text-xs font-semibold ${MUTED}`}>How
            <select className={FIELD} value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
              <option value="wire">Bank wire</option><option value="stripe">Stripe</option><option value="crypto">Crypto</option>
            </select>
          </label>
          <label className={`text-xs font-semibold ${MUTED}`}>Account name
            <input className={FIELD} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </label>
          <label className={`text-xs font-semibold ${MUTED}`}>Last four
            <input className={FIELD} value={draft.last4} maxLength={4} onChange={(e) => setDraft({ ...draft, last4: e.target.value })} />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!enabled || busy} onClick={() => run(() => reads.requestPayout(payoutBody(readiness, draft)), 'Payout requested.')}
          className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${accent.button}`} data-testid="payout-request">
          Request payout
        </button>
        {methodItem?.ready && <span className={`text-xs ${MUTED}`}>{methodItem.line}</span>}
        {!enabled && <span className={`text-xs ${MUTED}`} data-testid="payout-off">{methodItem && !methodItem.ready && !methodNamed(draft) ? 'Name a payout method, and finish the checklist above.' : 'Finish the checklist above first.'}</span>}
      </div>
      {said && <p className={`mt-2 text-xs ${BODY}`} role="status">{said}</p>}

      <div className="mt-4">
        <Eyebrow>History</Eyebrow>
        {payouts?.status === 'error' && <span className="text-xs text-red-700 dark:text-red-300">Unreadable</span>}
        {payouts?.status === 'ok' && !history.length && <span className={`block text-xs ${MUTED}`}>No payout yet</span>}
        {history.map((p) => (
          <div key={p.key} className="flex justify-between py-0.5 text-xs">
            <span className={`font-mono ${BODY}`}>{p.date}</span>
            <span className={`font-mono font-semibold ${INK}`}>{p.amount} · {p.status}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

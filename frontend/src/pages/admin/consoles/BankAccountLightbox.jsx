import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bankAccountsApi } from '../../../lib/api/bankAccounts';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { Pill, Unreadable, usePhoneWidth } from '../../../ui';
import {
  BASE, accountHistory, balanceCell, instructionFacts, kindWord, lineState, noticePreview,
  PHONE_BELOW_SM, paymentsLine, seriesOf, shortName, signedAmount, sparkPath, dayOf,
} from './bankAccountsModel';
import { amber, btnCls, muted, primaryCls } from './BankAccountDialogs';
import Sheet from '../../../ui/Sheet.jsx';

/**
 * D1185 (#3114) — one account, the canvas's board BNK2, as a centred
 * lightbox over Accounts at `/admin/platform/bank-accounts/account/:uid`.
 *
 * What it draws comes from the registry read Accounts already holds (the
 * instructions, the payments, D1184's notice preview and Mercury facts) and
 * three reads of its own, each its own block that fails alone: the balance
 * series (D1183), the account's latest Mercury lines, and its rows of
 * History (D1182). A savings account has no notice preview and no series
 * (BNK2s). Nothing here changes the account: Reveal, Relabel, Change payments
 * and Retire open Accounts' dialogs.
 */

const SEC = 'flex flex-col gap-2 border-t border-[#ecebf0] px-5 py-4 dark:border-gray-800';
const EYE = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';

/** One read of the lightbox's own, keyed by `key`: { status: 'loading' | 'ready' | 'unreadable', data }. */
function useRead(fn, key) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const latest = useRef(fn);
  latest.current = fn;
  const run = useCallback(async () => {
    setState({ status: 'loading', data: null });
    try { setState({ status: 'ready', data: await latest.current() }); } catch { setState({ status: 'unreadable', data: null }); }
  }, [key]);
  useEffect(() => { run(); }, [run]);
  return [state, run];
}

function Block({ title, testId, children }) {
  return (
    <section className={SEC} aria-label={title} data-testid={testId}>
      <h3 className={EYE}>{title}</h3>
      {children}
    </section>
  );
}

function Spark({ points }) {
  const p = sparkPath(points);
  if (!p) return <p className={`text-[12px] ${muted}`} data-testid="bank-account-spark-none">Not recorded: fewer than two daily balances are stored for 90 days.</p>;
  const label = `End-of-day current balance from ${dayOf(p.first) || p.first} to ${dayOf(p.last) || p.last}.${p.gaps ? ` ${p.gaps} ${p.gaps === 1 ? 'gap' : 'gaps'} where no balance is recorded.` : ''}`;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${p.w} ${p.h}`} className="h-16 w-full" data-testid="bank-account-spark">
      <title>{label}</title>
      <path d={p.d} fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-600 dark:text-violet-300" />
    </svg>
  );
}

export function AccountLightbox({ account: a, onClose, revealed, onReveal, onHide, onRelabel, onPayments, onRetire }) {
  const active = a.status === 'active';
  const savings = a.account_kind === 'savings';
  const mercuryUid = a.mercury?.account_uid || null;
  const [series, retrySeries] = useRead(() => (mercuryUid && !savings ? adminMercuryApi.balances({ account: mercuryUid, range: '90d' }) : Promise.resolve(null)), `${mercuryUid}:${savings}`);
  const [lines, retryLines] = useRead(() => (mercuryUid ? adminMercuryApi.transactions({ account: mercuryUid }) : Promise.resolve(null)), `${mercuryUid}`);
  const [history, retryHistory] = useRead(() => bankAccountsApi.history({ entity: a.entity_key, q: a.account_last4 }), a.uid);
  const current = balanceCell(a, 'current');
  const available = balanceCell(a, 'available');
  const preview = noticePreview(a);
  const seriesPoints = seriesOf(series.data, mercuryUid);
  const phone = usePhoneWidth(PHONE_BELOW_SM);

  return (
    <Sheet label={`Account ${a.label} ${a.account_masked}`} eyebrow={`Account · ${shortName(a.entity_key)}`} title={`${a.label} ${a.account_masked}`}
      width={640} size="tall" onClose={onClose} testId="bank-account-lightbox"
      footer={phone && active ? (
        // D1187 (BNK12b, BNK12d): on a phone the account is a full-height sheet whose bar holds Reveal, or Hide now while shown.
        <div className="flex gap-2" data-testid="bank-account-phone-bar">
          {revealed
            ? <button type="button" className={`${btnCls} flex-1`} onClick={onHide} data-testid="bank-account-phone-hide">Hide now</button>
            : <button type="button" className={`${primaryCls} flex-1`} onClick={onReveal} data-testid="bank-account-phone-reveal">Reveal full number…</button>}
          <button type="button" className={btnCls} onClick={onClose}>Close</button>
        </div>
      ) : <div className="flex justify-end"><button type="button" className={btnCls} onClick={onClose}>Close</button></div>}>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3" data-testid="bank-account-lightbox-head">
        <Pill tone="neutral">{kindWord(a.account_kind)}</Pill>
        <Pill tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Retired'}</Pill>
        {active && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={btnCls} onClick={onReveal}>Reveal full number…</button>
            <button type="button" className={btnCls} onClick={onRelabel}>Relabel</button>
            {!savings && <button type="button" className={btnCls} onClick={onPayments}>Change payments</button>}
            <button type="button" className={btnCls} onClick={onRetire}>Retire…</button>
          </span>
        )}
      </div>
      {!active && a.retired_reason && <p className={`px-5 pb-3 text-[12.5px] ${muted}`}>{`Retired ${dayOf(a.retired_at) || ''}: ‘${a.retired_reason}’`.replace(' :', ':')}</p>}

      {revealed && (
        <section className={SEC} data-testid="bank-account-lightbox-revealed">
          <h3 className={EYE}>After the reveal</h3>
          <p className="font-mono text-[22px] font-bold tracking-[.05em] text-axal-ink dark:text-gray-100" data-testid="bank-account-revealed">{revealed.number}</p>
          <p className={`text-[12.5px] ${muted}`}>Shown for 30 seconds. It is not kept on this device.</p>
          {revealed.reason && <p className={`text-[12px] ${muted}`}>{`Reason recorded at ${revealed.at}: ‘${revealed.reason}’`}</p>}
          <div><button type="button" className={btnCls} onClick={onHide}>Hide now</button></div>
        </section>
      )}

      <Block title="Payment instructions" testId="bank-account-instructions">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {instructionFacts(a).map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className={`text-[11.5px] ${muted}`}>{k}</dt>
              <dd className={v === 'Not recorded' ? `text-[12.5px] ${muted}` : 'text-[12.5px] font-semibold text-axal-ink dark:text-gray-100'}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className={`text-[12px] ${muted}`}>These never change. To change them, retire this account and add another.</p>
      </Block>

      <Block title="Payments it takes" testId="bank-account-payments">
        <p className="text-[12.5px] text-gray-700 dark:text-gray-300">{paymentsLine(a)}</p>
      </Block>

      {!savings && (
        <Block title="How a notice prints it" testId="bank-account-notice">
          {preview.kind === 'items' ? preview.items.map((it) => (
            <div key={it.purpose} className="rounded-lg border border-[#ecebf0] bg-[#faf9fc] px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
              <p className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{it.purpose}</p>
              {it.ok ? (
                <>
                  {it.rows.map(([k, v]) => (
                    <p key={k} className="flex gap-2 text-[12.5px]"><span className={`w-24 flex-none ${muted}`}>{k}</span><span className={MONO}>{v}</span></p>
                  ))}
                  {it.warning && <p className={`mt-1 text-[12.5px] font-semibold ${amber}`}>{it.warning}</p>}
                </>
              ) : <p className={`text-[12.5px] ${amber}`}>{it.line}</p>}
            </div>
          )) : <p className={`text-[12.5px] ${muted}`}>{preview.line}</p>}
        </Block>
      )}

      <Block title="In Mercury" testId="bank-account-in-mercury">
        {[['Current', current], ['Available', available]].map(([k, cell]) => (
          <p key={k} className="flex justify-between gap-3 text-[13px]">
            <span>{k}</span>
            <span className={cell.tone === 'figure' ? MONO : `text-[12.5px] ${muted}`} title={cell.tip}>{cell.text}{cell.tip ? `: ${cell.tip}` : ''}</span>
          </p>
        ))}
        {current.sub && <p className={`font-mono text-[11.5px] ${muted}`}>{current.sub}</p>}
        {!savings && mercuryUid && (
          series.status === 'unreadable'
            ? <Unreadable what="The balance over 90 days" onRetry={retrySeries} />
            : series.status === 'ready' ? <Spark points={seriesPoints} /> : <p className={`text-[12px] ${muted}`}>Reading the balance over 90 days…</p>
        )}
      </Block>

      <Block title="Latest lines" testId="bank-account-lines">
        {!mercuryUid ? <p className={`text-[12.5px] ${muted}`}>No Mercury account is matched to this one, so no line is read.</p>
          : lines.status === 'unreadable' ? <Unreadable what="The latest lines" onRetry={retryLines} />
            : lines.status === 'loading' ? <p className={`text-[12px] ${muted}`}>Reading the latest lines…</p>
              : (lines.data?.items || []).length === 0 ? <p className={`text-[12.5px] ${muted}`}>No line is stored for this account.</p>
                : (lines.data.items || []).slice(0, 5).map((t) => {
                  const st = lineState(t);
                  return (
                    <div key={t.uid} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]" data-testid="bank-account-line">
                      <span className="min-w-0">
                        <span className="font-semibold text-axal-ink dark:text-gray-100">{t.counterparty_name || 'No counterparty recorded'}</span>
                        <span className={`ml-2 font-mono text-[11.5px] ${muted}`}>{dayOf(t.created_on) || 'Date not recorded'}</span>
                      </span>
                      <span className="flex items-center gap-2"><span className={MONO}>{signedAmount(t.amount_cents)}</span><Pill tone={st.tone}>{st.text}</Pill></span>
                    </div>
                  );
                })}
        <Link className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300" to="/admin/fund-admin/banking">All transactions in Fund admin › Banking →</Link>
      </Block>

      <Block title="History of this account" testId="bank-account-history">
        {history.status === 'unreadable' ? <Unreadable what="This account’s history" onRetry={retryHistory} />
          : history.status === 'loading' ? <p className={`text-[12px] ${muted}`}>Reading the history…</p>
            : (() => {
              const rows = accountHistory(history.data?.rows, a.uid);
              if (!rows.length) return <p className={`text-[12.5px] ${muted}`}>No reveal or change is recorded for this account in the latest history.</p>;
              return rows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 text-[12.5px]" data-testid="bank-account-history-row">
                  <span className="min-w-0"><span className="font-semibold">{r.by}</span>{r.detail ? ` · ${r.detail}` : ''}<span className={`block font-mono text-[11.5px] ${muted}`}>{r.when}</span></span>
                  <Pill tone={r.event === 'Reveal' ? 'info' : 'neutral'}>{r.event}</Pill>
                </div>
              ));
            })()}
        <Link className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300" to={`${BASE}/history`}>See all in History →</Link>
      </Block>
    </Sheet>
  );
}

/** The lightbox for an address whose account the registry does not hold. */
export function MissingAccount({ onClose }) {
  return (
    <Sheet label="No such account" title="No such account" width={460} onClose={onClose} testId="bank-account-missing"
      footer={<div className="flex justify-end"><button type="button" className={btnCls} onClick={onClose}>Close</button></div>}>
      <p className={`px-5 py-4 text-[12.5px] ${muted}`}>The registry holds no account at this address. It may have been typed wrong; the list on Accounts is complete.</p>
    </Sheet>
  );
}

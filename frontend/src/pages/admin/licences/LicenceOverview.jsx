/**
 * D4819 (#4819), Build part 3 — a licence's Overview (Licences v2 boards L03
 * and L04): seven separate facts (Licence, Agreement, Commercial, Access,
 * Branch, Billing, Requests) and a Sources card, plus the strip of items that
 * need HQ. Never one badge and never a health score: each fact reads its own
 * store and says its own state, with a word and a shape, never colour alone.
 *
 * The reads are the ones the licence's own sections already make (contract,
 * deployment, requests, fee invoices, administrators). `useOverviewReads` makes
 * them once for the identity header and the Overview together, so the two
 * never disagree, and each one that fails is offered again on its own.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleSlash, Clock, EyeOff, Loader2, Minus, RefreshCw,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { adminDeploymentAttemptsApi } from '../../../lib/api/adminDeploymentAttempts';
import { licenceFeeInvoicesApi } from '../../../lib/api/licenceFeeInvoices';
import { licenceLedgerApi } from '../../../lib/api/licenceLedger';
import { reportError } from '../../../lib/log';
import { attentionItems, overviewFacts, sourcesOf } from '../licenceOverviewModel';

/** Each Overview read, by its key in `OVERVIEW_READS`. */
const READERS = {
  contract: (l) => api.licenceContract(l.uid),
  // No branch, no provisioning to read: the Branch fact says so from the licence read.
  deployment: (l) => (l.deployment ? adminDeploymentAttemptsApi.deployment(l.uid) : Promise.resolve(null)),
  requests: (l) => licenceLedgerApi.requests(l.uid, { limit: 1 }),
  invoices: (l) => licenceFeeInvoicesApi.list(l.uid),
  admins: (l) => api.licenceAdmins(l.uid),
};

/**
 * The Overview's reads, re-made whenever the licence is read again (after an
 * action), each `undefined` until it answers and `false` if it failed. A
 * value already on screen stays there while the same licence is re-read.
 */
export function useOverviewReads(licence) {
  const [reads, setReads] = useState({});
  const uidRef = useRef(null);
  const readOne = useCallback((key, l) => {
    Promise.resolve().then(() => READERS[key](l)).then(
      (data) => setReads((r) => (uidRef.current === l.uid ? { ...r, [key]: data } : r)),
      (e) => { reportError('licence_overview_read_failed', e); setReads((r) => (uidRef.current === l.uid ? { ...r, [key]: false } : r)); },
    );
  }, []);
  useEffect(() => {
    if (!licence?.uid) return;
    if (uidRef.current !== licence.uid) { uidRef.current = licence.uid; setReads({}); }
    for (const key of Object.keys(READERS)) readOne(key, licence);
  }, [licence, readOne]);
  const retry = useCallback((key) => {
    if (!licence?.uid || !READERS[key]) return;
    setReads((r) => ({ ...r, [key]: undefined }));
    readOne(key, licence);
  }, [licence, readOne]);
  return { reads, retry };
}

/* ------------------------------------------------------------------ *
 * A state, with a word and a shape                                    *
 * ------------------------------------------------------------------ */

const STATE_LOOK = {
  ok: [CheckCircle2, 'text-green-700 dark:text-green-300'],
  attention: [Clock, 'text-amber-800 dark:text-amber-300'],
  problem: [AlertTriangle, 'text-red-700 dark:text-red-300'],
  neutral: [Circle, 'text-gray-900 dark:text-gray-100'],
  none: [Minus, 'text-gray-600 dark:text-gray-400'],
  not_recorded: [CircleDashed, 'italic text-gray-500 dark:text-gray-400'],
  unavailable: [CircleSlash, 'text-red-700 dark:text-red-300'],
  not_instrumented: [EyeOff, 'italic text-gray-500 dark:text-gray-400'],
  reading: [Loader2, 'text-gray-500 dark:text-gray-400'],
  due: [Clock, 'text-amber-800 dark:text-amber-300'],
  overdue: [AlertTriangle, 'text-red-700 dark:text-red-300'],
  value: [Circle, 'text-gray-900 dark:text-gray-100'],
};

/** A fact's state: its icon (a shape per state) and its words. The state is also on `data-state` for tests. */
export function FactState({ state, children, testId }) {
  const [Icon, cls] = STATE_LOOK[state] || STATE_LOOK.neutral;
  return (
    <span className={`inline-flex items-start gap-1.5 font-semibold ${cls}`} data-state={state} data-testid={testId}>
      <Icon size={13} aria-hidden="true" className={`mt-[3px] shrink-0 ${state === 'reading' ? 'animate-spin' : ''}`} />
      <span>{children}</span>
    </span>
  );
}

export function TryAgain({ onClick, what }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-indigo-300"
      aria-label={what ? `Try reading ${what} again` : 'Try again'}
    >
      <RefreshCw size={11} aria-hidden="true" /> Try again
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Needs HQ (L04)                                                      *
 * ------------------------------------------------------------------ */

/** The strip under the header: what needs HQ, and which facts could not be read. Nothing is drawn while all is clear. */
export function AttentionStrip({ licence, facts }) {
  const { items, unknown } = attentionItems(licence, facts);
  if (!items.length && !unknown.length) return null;
  const n = items.length;
  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      role="status" data-testid="licence-attention"
    >
      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div>
        {n > 0 && (
          <>
            <b>{n} {n === 1 ? 'item needs' : 'items need'} HQ</b>
            {' · '}
            {items.map((i) => i.text).join(' · ')}
          </>
        )}
        {unknown.length > 0 && (
          <span className="block text-[12px]" data-testid="licence-attention-unknown">
            {n > 0 ? 'Also not known: ' : 'Whether anything needs HQ is not fully known: '}
            {unknown.join(', ')} could not be read.
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview (L03, L04)                                                 *
 * ------------------------------------------------------------------ */

/**
 * Where each fact's detail lives: the tab it opens. Licence has none: the header holds it.
 * D4819 part 12 (#5923): Requests opens Operations › Requests and compliance (L12), Billing opens Operations › Billing (L13).
 */
const FACT_TAB = { agreement: 'contract', commercial: 'terms', access: 'admins', branch: 'deploy', billing: 'fee-invoices', requests: 'notices' };
// Phone first: identity and status sit in the header; then the agreement and requests, as #4819's responsive notes ask.
const PHONE_ORDER = { licence: 'order-1', agreement: 'order-2', requests: 'order-3' };

export default function LicenceOverview({ licence, reads, retry, readAt, onOpenTab }) {
  const facts = overviewFacts(licence, reads);
  const sources = sourcesOf(licence, readAt);
  return (
    <div data-testid="licence-overview">
      <h3 className="sr-only">Overview</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {facts.map((f) => (
          <section
            key={f.key} aria-labelledby={`licence-fact-${f.key}`} data-testid={`licence-fact-${f.key}`}
            className={`flex min-w-0 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 ${PHONE_ORDER[f.key] || 'order-4'} sm:order-none`}
          >
            <h4 id={`licence-fact-${f.key}`} className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">{f.label}</h4>
            <div className="text-sm"><FactState state={f.state} testId={`licence-fact-${f.key}-state`}>{f.word}</FactState></div>
            {f.detail && <p className="text-[12px] leading-snug text-gray-600 dark:text-gray-400">{f.detail}</p>}
            {f.note && <p className="text-[11px] italic leading-snug text-gray-500 dark:text-gray-400">{f.note}</p>}
            <div className="mt-auto flex flex-wrap gap-3 pt-1">
              {f.retry && (
                <TryAgain what={f.label.toLowerCase()} onClick={() => retry(f.retry)} />
              )}
              {FACT_TAB[f.key] && (
                <button
                  type="button" onClick={() => onOpenTab?.(FACT_TAB[f.key])} data-testid={`licence-fact-${f.key}-open`}
                  className="text-[11px] font-medium text-gray-600 underline hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  Open {f.label.toLowerCase()}
                </button>
              )}
            </div>
          </section>
        ))}
        <section
          aria-labelledby="licence-fact-sources" data-testid="licence-sources"
          className="order-5 flex min-w-0 flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950 sm:order-none"
        >
          <h4 id="licence-fact-sources" className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">Sources</h4>
          <dl className="space-y-1 text-[12px]">
            {sources.map((s) => (
              <div key={s.key}>
                <dt className="text-gray-500 dark:text-gray-400">{s.label}</dt>
                <dd><FactState state={s.state || 'neutral'}>{s.text}</FactState></dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
            The branch line is the branch’s answer to HQ’s last push. HQ does not read what a branch holds on its own yet.
          </p>
        </section>
      </div>
    </div>
  );
}

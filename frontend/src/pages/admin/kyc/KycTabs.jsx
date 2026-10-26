/**
 * D1228 (#2384) — KYC & KYB's tab bodies (KYC1, KYC6, KYC9, KYC10) and one
 * person's case (KYC3), under the page header `ConsolePages.KycPage` draws.
 * People keeps D648's queue and its Review, so every decision stays reachable;
 * the rest say "Not read here yet" with their reason (`kycModel.WAITS`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Unrecorded } from '../../../ui';
import { KycSensitiveFields } from '../../../components/hqReview/SensitiveField';
import { CONSOLE_LOADING, ConsoleUnreadable } from '../consoles/shared';
import { NOT_YET, WAITS, decidable, personFacts, statusWord } from './kycModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export function KycWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`kyc-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

function Section({ title, testId, children }) {
  return (
    <section className={box} data-testid={testId}>
      <h2 className="m-0 text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** KYC3 — one person's case, from the record read. Decisions stay on People's Review (part 5 moves them here). */
export function KycPersonCase({ id }) {
  const [state, setState] = useState({ kind: 'loading', record: null });
  const load = useCallback(async () => {
    setState({ kind: 'loading', record: null });
    try {
      setState({ kind: 'ok', record: await api.kycAdminGet(id) });
    } catch (e) {
      reportError('KycPersonCase:record', e);
      setState({ kind: e?.status === 404 ? 'missing' : 'unreadable', record: null });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const back = <Link to="/admin/kyc" className="w-fit text-[13px] font-semibold text-violet-700 underline dark:text-violet-300" data-testid="kyc-case-back">‹ People</Link>;
  if (state.kind === 'loading') return <div className="flex flex-col gap-3">{back}<div className="py-10 text-center text-gray-600">{CONSOLE_LOADING}</div></div>;
  if (state.kind === 'missing') return <div className="flex flex-col gap-3" data-testid="kyc-case-missing">{back}<p className="m-0 text-sm">No account has this id.</p></div>;
  if (state.kind === 'unreadable') return <div className="flex flex-col gap-3">{back}<ConsoleUnreadable what="This person’s check" onRetry={load} /></div>;
  return <KycPersonView record={state.record} back={back} />;
}

/** The case drawn from one record; split out so it renders without a read. */
export function KycPersonView({ record: r, back = null }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-case">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[20px] font-extrabold">{r.name || 'Name not recorded'}</h2>
        <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[12px] font-bold" data-testid="kyc-case-status">{statusWord(r.kyc_status)}</span>
      </div>
      {r.rejection_reason && (
        <p className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="kyc-case-rejected">Earlier rejection: {r.rejection_reason}</p>
      )}
      <Section title="Identity" testId="kyc-case-facts">
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          {personFacts(r).map(([k, v]) => (
            <div key={k} className="flex flex-col"><dt className="text-[11px] uppercase text-gray-500">{k}</dt><dd className="m-0">{v ?? <Unrecorded reason={`${k} is not in the record.`} />}</dd></div>
          ))}
        </dl>
        {r.kyc_data?.masked && <KycSensitiveFields masked={r.kyc_data.masked} onShow={(field) => api.kycAdminShowField(r.id, field)} />}
      </Section>
      <Section title="Documents" testId="kyc-case-documents"><KycWait id="documents" /></Section>
      <Section title="Checks and sanctions" testId="kyc-case-checks"><KycWait id="checks" /><KycWait id="sanctions" /></Section>
      <Section title="History, assignment and notes" testId="kyc-case-history"><KycWait id="history" /><KycWait id="assignment" /></Section>
      <Section title="Decision" testId="kyc-case-decision">
        {decidable(r.kyc_status)
          ? <p className="m-0 text-[13px]">This check can be approved or rejected from <Link to="/admin/kyc" className="font-semibold underline">People</Link>’s Review.</p>
          : <p className="m-0 text-[13px]">This check is {statusWord(r.kyc_status)}; no decision is open on it.</p>}
        <KycWait id="decide" />
        <KycWait id="hq" />
      </Section>
    </div>
  );
}

/** The body under the header for one view of `kycModel.viewOf`. */
export function KycTabBody({ view, people }) {
  if (view.person) return <KycPersonCase id={view.person} />;
  if (view.tab === 'businesses') return <Section title="Businesses" testId="kyc-businesses"><KycWait id="businesses" /></Section>;
  if (view.tab === 'renewals') return <Section title="Renewals" testId="kyc-renewals"><KycWait id="renewals" /></Section>;
  if (view.tab === 'audit') return <Section title="Audit" testId="kyc-audit"><KycWait id="audit" /></Section>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-people">
      <Section title="Figures" testId="kyc-people-figures"><KycWait id="figures" /></Section>
      {people}
      <Section title="What the queue does not carry yet" testId="kyc-people-waits"><KycWait id="queue" /><KycWait id="statuses" /></Section>
    </div>
  );
}

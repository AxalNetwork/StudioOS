/**
 * D5051 (#5051, part 1) — the licence's Agreement section beyond the territory licence agreement (L33 of the
 * Licences and Contracts v2 addendum, #5303): the Axal VC package agreement, the licensed program agreements,
 * the package readiness card ("Legal readiness: 2 of 3 programs in force"), what needs HQ legally, and the
 * legal history (D5052 §6).
 *
 * Two reads, each its own block state: the agreement versions (`GET /api/admin/licence-agreements/licences/:uid`,
 * D5048) and the legal readiness (`GET /api/admin/licence-agreement-policies/licences/:uid`, D5052). A failed
 * read says Unreadable with Try again and never reads as none, executed or in force; a policy nobody froze is
 * Not recorded. Every row opens the one canonical record in Contracts (`lib/licenceLegalReadiness.js`); nothing
 * here creates, copies or sends a document.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminLicenceAgreementsApi } from '../../../lib/api/adminLicenceAgreements.js';
import { adminLicenceAgreementPoliciesApi } from '../../../lib/api/adminLicenceAgreementPolicies.js';
import { reportError } from '../../../lib/log';
import { ReasonDialog } from '../grants/GrantDialogs';
import { Lightbox, usePhoneWidth } from '../../../ui';
import {
  DOC_STATE_WORD, SIGNAL_WORD, gateWord, historyLine, legalSignals, packageReadiness, programsReadiness, strategyWord,
} from '../../../lib/licenceLegalReadiness.js';

const CARD = 'rounded-[12px] border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';
const GHOST = 'rounded-md border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

const TONE = {
  executed: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  awaiting_signature: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  prepared: 'border-dashed border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300',
  not_prepared: 'border-dashed border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  replacement_required: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  unreadable: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
};
const MARK = { executed: '●', awaiting_signature: '➤', prepared: '○', not_prepared: '○', replacement_required: '!', unreadable: '!', not_recorded: '—', not_required: '—', not_applicable: '—', paused: '‖', ended: '×' };

/** A state always has a word and a shape (the addendum's accessibility note). */
export function StatePill({ state, label, testId }) {
  return (
    <span data-testid={testId} data-state={state}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${TONE[state] || 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
      <span aria-hidden="true">{MARK[state] || '○'}</span>{label || DOC_STATE_WORD[state] || state}
    </span>
  );
}

export function useBlockRead(load, deps, what) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    load().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError(`${what}`, e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, useCallback(() => setTick((t) => t + 1), [])];
}

export function ReadFailed({ text, onRetry, testId }) {
  return (
    <div role="alert" className={ALERT} data-testid={testId}>
      <span><b>Unreadable.</b> {text}</span>
      <button type="button" className={GHOST} onClick={onRetry}>Try again</button>
    </div>
  );
}

function AgreementAction({ document, licenceUid, packageOfferUid, onChanged }) {
  const [stage, setStage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [failure, setFailure] = useState(null);
  const row = document.inFlightRow || document.row;
  const reviewable = row && ['draft', 'ready'].includes(row.status);
  const preparable = document.kind !== 'program_schedule' && (document.state === 'not_prepared'
    || (document.state === 'replacement_required' && !document.inFlightRow));
  if (!reviewable && !preparable) return null;

  async function review() {
    setStage('review');
    setFailure(null);
    setPreview(null);
    try {
      setPreview(await adminLicenceAgreementsApi.preview(row.uid));
    } catch (error) {
      reportError('licence_agreement_preview_failed', error);
      setFailure('The agreement preview could not be read.');
    }
  }

  async function prepare(reason) {
    const { items } = await adminLicenceAgreementsApi.templates();
    const template = items.find((item) => item.kinds.includes(document.kind)
      && (document.package_key ? item.package_key === document.package_key : item.program_key === document.program_key));
    if (!template?.authored) throw new Error(template?.refusal || 'No template is available for this agreement.');
    return adminLicenceAgreementsApi.draft(licenceUid, {
      agreement_kind: document.kind,
      program_key: document.kind.startsWith('program_') ? document.program_key : undefined,
      package_key: document.package_key,
      addendum_key: document.kind === 'package_addendum' ? document.slot_key.split(':').at(-1) : undefined,
      package_offer_uid: document.package_key ? packageOfferUid : undefined,
      template_slug: template.slug,
      reason,
    });
  }

  function changed() {
    setStage(null);
    onChanged();
  }

  return (
    <>
      <button type="button" className={GHOST} onClick={reviewable ? review : () => setStage('prepare')}>
        {reviewable ? 'Review agreement' : 'Prepare agreement'}
      </button>
      {stage === 'prepare' && (
        <ReasonDialog title="Prepare agreement" button="Prepare" run={prepare}
          onClose={() => setStage(null)} onDone={changed} testId="licence-agreement-prepare" />
      )}
      {stage === 'review' && (
        <Lightbox title="Review agreement" label="Review agreement" onClose={() => setStage(null)} width={740}
          footer={preview?.readiness?.ready && preview.body_matches === true ? (
            <button type="button" className={GHOST} onClick={() => setStage('send')}>Send agreement</button>
          ) : null}>
          {failure && <p role="alert">{failure}</p>}
          {!failure && !preview && <p role="status">Reading agreement…</p>}
          {preview && (
            <>
              <h3 className={H2}>{preview.title || 'Agreement preview'}</h3>
              {preview.body_matches !== true && <p role="alert">The stored text could not be verified.</p>}
              {preview.readiness?.counsel_review?.required && <p>{preview.readiness.counsel_review.reason}</p>}
              {!!preview.readiness?.missing_signatory_fields?.length && <p>Missing signatory fields · {preview.readiness.missing_signatory_fields.join(', ')}</p>}
              {!!preview.readiness?.unresolved_fields?.length && <p>Unresolved fields · {preview.readiness.unresolved_fields.join(', ')}</p>}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{preview.body_md}</pre>
            </>
          )}
        </Lightbox>
      )}
      {stage === 'send' && (
        <ReasonDialog title="Send agreement for signature" button="Send for signature"
          run={(reason) => adminLicenceAgreementsApi.send(row.uid, { revision: preview.revision, reason })}
          onClose={() => setStage('review')} onDone={changed} testId="licence-agreement-send" />
      )}
    </>
  );
}

function PackageAgreement({ pkg, legalRead, retry, action }) {
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="licence-package-agreement">
      <span className={EYE}>2 · Axal VC package agreement</span>
      {legalRead.status === 'error' ? <ReadFailed text="The package this licence holds could not be read. That is not the same as none." onRetry={retry} testId="licence-package-unreadable" /> : null}
      {legalRead.status === 'loading' && !legalRead.data ? <span className={SUB}>Reading…</span> : null}
      {legalRead.data && !pkg.recorded ? (
        <div data-testid="licence-package-none">
          <StatePill state="not_recorded" label="No Axal VC package recorded" />
          <p className={`mt-1.5 ${SUB}`}>No package offer has been accepted for this licence, so its programs are standalone grants. No package never means no programs.</p>
        </div>
      ) : null}
      {legalRead.data && pkg.recorded ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className={H2} data-testid="licence-package-name">{pkg.name} Package Agreement</h2>
              <p className={SUB}>
                {pkg.name} · policy v{pkg.policyVersion} · strategy: {strategyWord(pkg.strategy)} · {gateWord(pkg.gate)}
                {pkg.behindLatest ? ` · v${pkg.latestVersion} is the latest; this licence keeps the version it froze` : ''}
              </p>
            </div>
            {pkg.master ? (
              <span className="flex flex-wrap items-center gap-2">
                <StatePill state={pkg.master.state} testId="licence-package-master-state" />
                {pkg.master.row ? <Link className={LINK} to={pkg.master.href} data-testid="licence-package-master-link">Open in Contracts ›</Link> : null}
                {action({ ...pkg.master, kind: 'package_master', package_key: pkg.key })}
              </span>
            ) : <StatePill state="not_applicable" label={pkg.strategy === 'none' ? 'No agreement required' : 'No master agreement · per program'} testId="licence-package-master-state" />}
          </div>
          {pkg.master ? (
            <p className={SUB}>
              {pkg.master.row ? `${pkg.master.version || ''}${pkg.master.effective ? ` · effective ${pkg.master.effective}` : ''}`.replace(/^ · /, '') : 'No version of the master agreement exists yet.'}
              {' '}Prepare, review and send it from its record; a send is a separate step a person takes with a reason.
            </p>
          ) : (
            <p className={SUB}>{pkg.strategy === 'none'
              ? 'This package’s policy requires no agreement.'
              : 'Under a per-program strategy each program carries its own agreement below.'}</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function ProgramAgreements({ programs, legalRead, agreementsRead, retryLegal, retryAgreements, licenceUid, action }) {
  const phone = usePhoneWidth();
  const rows = programs.filter((p) => p.status !== 'not_granted');
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2`} data-testid="licence-program-agreements">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>3 · Licensed program agreements</h2>
        <Link className={LINK} to={`/admin/licences/programs/studio/${encodeURIComponent(licenceUid)}`}>Open Program access</Link>
      </div>
      {legalRead.status === 'error' ? <ReadFailed text="Which agreements each program needs could not be read." onRetry={retryLegal} testId="licence-programs-unreadable" /> : null}
      {agreementsRead.status === 'error' ? <ReadFailed text="The agreement versions could not be read, so versions, dates and fields are not shown." onRetry={retryAgreements} testId="licence-versions-unreadable" /> : null}
      {legalRead.status === 'loading' && !legalRead.data ? <span className={SUB}>Reading…</span> : null}
      {legalRead.data && !rows.length ? <p className={`m-0 ${SUB}`} data-testid="licence-programs-none">No programs are granted to this licence. That is not the same as Not recorded.</p> : null}
      {legalRead.data && rows.length ? (phone ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.flatMap((p) => (p.documents.length ? p.documents : [null]).map((d, i) => (
            <li key={`${p.programKey}-${i}`} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`licence-program-card-${p.programKey}`}>
              <b className="text-[13px] text-axal-ink dark:text-gray-100">{p.name}{d ? ` · ${d.kindWord}` : ''}</b>
              <span className="flex flex-wrap items-center gap-2">
                <StatePill state={d ? d.state : p.agreementState} />
                {d && (d.row || d.executed_agreement_uid || d.in_flight_agreement_uid) ? <Link className={LINK} to={d.href}>Open in Contracts ›</Link> : null}
                {d && action({ ...d, program_key: p.programKey })}
              </span>
            </li>
          )))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={EYE}>{['Program', 'Required?', 'Type', 'Status', 'Effective', 'Version', ''].map((h, i) => <th key={h || i} scope="col" className="py-1.5 pr-3 font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.flatMap((p) => {
                const docs = p.documents.length ? p.documents : [null];
                return docs.map((d, i) => (
                  <tr key={`${p.programKey}-${i}`} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`licence-program-row-${p.programKey}${d ? `-${d.kind}` : ''}`}>
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {i === 0 ? <><b className="block text-axal-ink dark:text-gray-100">{p.name}</b><span className={SUB}>{p.grantWord}</span></> : null}
                    </th>
                    <td className="py-2 pr-3">{i === 0 ? p.required : ''}{i === 0 && !p.policyRecorded ? <span className={`block ${SUB}`}>Agreement policy not recorded{d ? '; the schedule rule applies' : ''}</span> : null}</td>
                    <td className="py-2 pr-3">{d ? d.kindWord : '—'}{d && !d.gating ? <span className={`block ${SUB}`}>optional</span> : null}</td>
                    <td className="py-2 pr-3"><StatePill state={d ? d.state : p.agreementState} testId={`licence-program-state-${p.programKey}${d ? `-${d.kind}` : ''}`} />
                      {d?.signedOnGrant ? <span className={`block ${SUB}`}>Signed on the grant; no canonical version on file</span> : null}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{d?.effective || '—'}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{d?.version || '—'}</td>
                    <td className="py-2">
                      {d && (d.row || d.executed_agreement_uid || d.in_flight_agreement_uid) ? <Link className={LINK} to={d.href} data-testid={`licence-program-link-${p.programKey}-${d.kind}`}>Open in Contracts ›</Link>
                        : d && d.kind === 'program_schedule' && d.state === 'not_prepared'
                          ? <Link className={LINK} to={`/admin/licences/programs/studio/${encodeURIComponent(licenceUid)}`}>Send from Program access</Link>
                          : null}
                      {d && d.kind !== 'package_master' && action({ ...d, program_key: p.programKey })}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )) : null}
      <p className={`m-0 ${SUB}`}>One canonical agreement: each row opens the same record in Contracts. Licences never shows a second copy.</p>
    </section>
  );
}

function Readiness({ pkg, legalRead }) {
  if (!legalRead.data || !pkg.recorded) return null;
  return (
    <section className={`${CARD} flex max-w-[620px] flex-col gap-2`} data-testid="licence-package-readiness">
      <h2 className={H2}>Package readiness · {pkg.name} v{pkg.policyVersion}</h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-axal-ink dark:text-gray-100">
        <li className="flex flex-wrap items-center justify-between gap-2"><span><span aria-hidden="true" className="mr-1.5 text-emerald-600">✓</span>Offer accepted</span><span className={SUB}>{pkg.acceptedOn || 'Not recorded'}</span></li>
        <li className="flex flex-wrap items-center justify-between gap-2" data-testid="licence-readiness-master">
          <span><span aria-hidden="true" className={`mr-1.5 ${pkg.master && pkg.master.state !== 'executed' ? 'text-amber-600' : 'text-emerald-600'}`}>{pkg.master && pkg.master.state !== 'executed' ? '◷' : '✓'}</span>Package agreement</span>
          <span className={SUB}>{pkg.master ? pkg.master.word : pkg.strategy === 'none' ? 'Not required' : 'Not applicable · per program'}</span>
        </li>
        {pkg.items.map((it) => (
          <li key={it.programKey} className="flex flex-wrap items-center justify-between gap-2" data-testid={`licence-readiness-${it.programKey}`}>
            <span><span aria-hidden="true" className={`mr-1.5 ${it.inForce ? 'text-emerald-600' : 'text-amber-600'}`}>{it.inForce ? '✓' : '◷'}</span>{it.name}{it.label ? ` ${it.label.toLowerCase()}` : ''}</span>
            <span className={SUB}>{it.word}{it.state && !it.inForce && it.state === 'executed' ? ' · not in force yet' : ''}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between rounded-[9px] bg-axal-ground px-3 py-2 text-[13px] font-bold text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="licence-readiness-summary">
        <span>Legal readiness</span><span>{pkg.inForce} of {pkg.total} programs in force</span>
      </div>
      {pkg.standalone.length ? <p className={`m-0 ${SUB}`}>{pkg.standalone.join(', ')} {pkg.standalone.length === 1 ? 'is a standalone extra' : 'are standalone extras'}, outside this package.</p> : null}
    </section>
  );
}

function NeedsHq({ signals, legalRead, agreementsRead }) {
  const unread = legalRead.status === 'error';
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="licence-legal-needs-hq">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>Needs HQ · legal</h2>
        <span className={SUB}>{unread ? 'Unreadable' : legalRead.data ? `${signals.length} ${signals.length === 1 ? 'item' : 'items'}` : 'Reading…'}</span>
      </div>
      {unread ? <p className={`m-0 ${SUB}`} data-testid="licence-legal-needs-unreadable">Legal readiness could not be read, so what needs HQ is unknown, not none.</p> : null}
      {legalRead.data && !signals.length ? <p className={`m-0 ${SUB}`} data-testid="licence-legal-needs-none">Nothing legal needs HQ on this licence{agreementsRead.status === 'error' ? ' that the readiness read shows; the versions could not be read' : ''}.</p> : null}
      {signals.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {signals.map((s, i) => (
            <li key={`${s.kind}-${i}`} className="flex flex-wrap items-start justify-between gap-2 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`licence-legal-signal-${s.kind}`}>
              <span><span className={`block ${EYE}`}>{SIGNAL_WORD[s.kind]}</span><b>{s.title}</b><span className={`block ${SUB}`}>{s.detail}</span></span>
              <Link className={LINK} to={s.href}>{s.action} ›</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LegalHistory({ licenceUid }) {
  const [open, setOpen] = useState(false);
  const [read, retry] = useBlockRead(() => (open ? adminLicenceAgreementPoliciesApi.history(licenceUid) : Promise.resolve(null)), [licenceUid, open], 'licence_legal_history_failed');
  const lines = (read.data?.items || []).slice().reverse().map(historyLine);
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="licence-legal-history">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>Legal history</h2>
        <button type="button" className={GHOST} aria-expanded={open} onClick={() => setOpen((x) => !x)} data-testid="licence-legal-history-toggle">{open ? 'Hide' : 'Show'} history</button>
      </div>
      {open && read.status === 'error' ? <ReadFailed text="The legal history could not be read." onRetry={retry} testId="licence-legal-history-unreadable" /> : null}
      {open && read.status === 'loading' ? <span className={SUB}>Reading…</span> : null}
      {open && read.data && !lines.length ? <span className={SUB}>No agreement or policy event is recorded for this licence.</span> : null}
      {open && lines.length ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {lines.map((h) => (
            <li key={h.key} className="text-[12.5px] text-axal-ink dark:text-gray-100">
              <span className={`block ${EYE}`}>{h.when} · {h.by}</span>{h.what}{h.reason ? <span className={`block ${SUB}`}>{h.reason}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {!open ? <span className={SUB}>Each agreement’s lifecycle, policy versions and the legal gate’s answers, oldest first, with who and why.</span> : null}
    </section>
  );
}

export default function LicenceAgreements({ licence }) {
  const uid = licence.uid;
  const [agreementsRead, retryAgreements] = useBlockRead(() => adminLicenceAgreementsApi.forLicence(uid), [uid], 'licence_agreements_load_failed');
  const [legalRead, retryLegal] = useBlockRead(() => adminLicenceAgreementPoliciesApi.forLicence(uid), [uid], 'licence_legal_readiness_load_failed');
  const ctx = { licenceUid: uid, agreements: agreementsRead.data };
  const legal = legalRead.data;
  const programs = useMemo(() => programsReadiness(legal, ctx), [legal, agreementsRead.data, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const pkg = useMemo(() => (legal ? packageReadiness(legal, ctx) : { recorded: false }), [legal, agreementsRead.data, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const signals = useMemo(() => (legal ? legalSignals(legal, ctx) : []), [legal, agreementsRead.data, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const action = (document) => agreementsRead.status === 'ready' ? (
    <AgreementAction key={document.inFlightRow?.uid ?? document.row?.uid ?? document.slot_key ?? document.kind} document={document} licenceUid={uid}
      packageOfferUid={legal?.holdings?.find((h) => h.scope_kind === 'package' && h.scope_key === document.package_key && h.current)?.package_offer_uid}
      onChanged={() => { retryAgreements(); retryLegal(); }} />
  ) : null;
  return (
    <div className="mt-5 flex flex-col gap-4" data-testid="licence-agreements">
      <NeedsHq signals={signals} legalRead={legalRead} agreementsRead={agreementsRead} />
      <PackageAgreement pkg={pkg} legalRead={legalRead} retry={retryLegal} action={action} />
      <ProgramAgreements programs={programs} legalRead={legalRead} agreementsRead={agreementsRead} retryLegal={retryLegal} retryAgreements={retryAgreements} licenceUid={uid} action={action} />
      <Readiness pkg={pkg} legalRead={legalRead} />
      <LegalHistory licenceUid={uid} />
    </div>
  );
}

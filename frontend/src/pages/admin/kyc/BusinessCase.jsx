/**
 * D1234 (#3242) — one business's case (KYC7, KYC7b), from part 3's read
 * (`GET /api/kyc/businesses/:id`). Every block says what it is: read,
 * Not recorded with its reason, or Unreadable; a block never draws a zero it
 * did not read. Masked values open through `SensitiveField`, whose route logs
 * the showing; documents open in `KycViewer`, inside the page.
 *
 * The decisions are `businessModel.actionsOf`, each a dialog in
 * `BusinessDialogs.jsx` carrying the case's `review_token`; a case that
 * changed while it was open asks for a fresh read. Due diligence is read
 * only here: it is decided on its own page.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { kybApi } from '../../../lib/api/kyb.js';
import { businessDocumentBlob } from '../../../lib/api/kycPeople.js';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Unrecorded } from '../../../ui';
import SensitiveField, { SensitiveLine } from '../../../components/hqReview/SensitiveField';
import { CONSOLE_LOADING, ConsoleUnreadable } from '../consoles/shared';
import { personHref, statusWord } from './kycModel';
import { BusinessStatus } from './KycBusinesses';
import { ApproveBusiness, DismissImport, LinkAccount, RejectBusiness, RequestDocuments } from './BusinessDialogs';
import KycViewer from './KycViewer';
import {
  BUSINESSES, actionsOf, approveBlocker, blockOf, dayWord, docKindWord, eventWord, kindWord, ownerRows, waitingFor,
} from './businessModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800';
const GO = 'rounded-lg bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400';
const BAD = 'rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950';

function Section({ title, testId, aside = null, children }) {
  return (
    <section className={box} data-testid={testId}>
      <div className="flex items-center gap-2"><h2 className="m-0 text-[15px] font-bold">{title}</h2>{aside && <div className="ml-auto">{aside}</div>}</div>
      {children}
    </section>
  );
}

/** A block's three states; `children(value)` draws a read one. */
function Block({ block, what, testId, children }) {
  if (block.state === 'unreadable') return <p className="m-0 text-[13px]" data-testid={`${testId}-unreadable`}>{what} could not be read. Read the case again.</p>;
  if (block.state === 'missing') return <p className="m-0 text-[13px]" data-testid={`${testId}-missing`}><Unrecorded reason={block.reason} /> <span className={MUTED}>· {block.reason}</span></p>;
  return children(block.value);
}

/** KYC7 — reads the case and draws it. */
export function KycBusinessCase({ id, nowIso }) {
  const me = useAuth()?.user || null;
  const [s, setS] = useState({ kind: 'loading', data: null });
  const load = useCallback(async () => {
    setS((x) => ({ kind: x.data ? 'ok' : 'loading', data: x.data }));
    try { setS({ kind: 'ok', data: await kybApi.get(id) }); } catch (e) {
      reportError('KycBusinessCase:read', e);
      setS({ kind: e?.status === 404 ? 'missing' : 'unreadable', data: null });
    }
  }, [id]);
  useEffect(() => { setS({ kind: 'loading', data: null }); load(); }, [load]);

  const back = <Link to={BUSINESSES} className={`w-fit text-[13px] ${LINK}`} data-testid="kyb-case-back">‹ Businesses</Link>;
  if (s.kind === 'loading') return <div className="flex flex-col gap-3">{back}<div className="py-10 text-center text-gray-600 dark:text-gray-300">{CONSOLE_LOADING}</div></div>;
  if (s.kind === 'missing') return <div className="flex flex-col gap-3" data-testid="kyb-case-missing">{back}<p className="m-0 text-sm">No business case has this id in this studio.</p></div>;
  if (s.kind === 'unreadable') return <div className="flex flex-col gap-3" data-testid="kyb-case-unreadable">{back}<ConsoleUnreadable what="This business’s check" onRetry={load} /></div>;
  return <KycBusinessView c={s.data} onChanged={load} me={me} back={back} nowIso={nowIso} />;
}

function DecisionBar({ c, owners, open }) {
  const acts = actionsOf(c);
  const has = (a) => acts.includes(a);
  const blocker = has('approve') ? approveBlocker(c, owners) : null;
  const line = c.can_review === false ? 'You can read this case. Licensed studios are decided by the Super Admin.'
    : c.status === 'dismissed' ? 'This import was dismissed; no decision is open on it.'
      : blocker || (has('approve') ? 'Approving satisfies Entity verification (KYB) for 24 months.'
        : `This check is ${c.status === 'approved' ? 'approved' : statusWord(c.status)}.`);
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-white/95 p-3 sm:static dark:border-gray-800 dark:bg-gray-900/95" data-testid="kyb-decision-bar">
      <p className={`m-0 mr-auto text-[12.5px] ${MUTED}`} data-testid="kyb-decision-line">{line}</p>
      {has('link') && <button type="button" className={BTN} onClick={() => open('link')} data-testid="kyb-act-link">Link to an account…</button>}
      {has('dismiss') && <button type="button" className={BTN} onClick={() => open('dismiss')} data-testid="kyb-act-dismiss">Dismiss import…</button>}
      {has('documents') && <button type="button" className={BTN} onClick={() => open('documents')} data-testid="kyb-act-documents">Ask for documents…</button>}
      {has('reject') && <button type="button" className={BAD} onClick={() => open('reject')} data-testid="kyb-act-reject">Reject…</button>}
      {has('approve') && <button type="button" className={GO} onClick={() => open('approve')} disabled={!!blocker} data-testid="kyb-act-approve">Approve…</button>}
    </div>
  );
}

function Owners({ c, owners, onRetry }) {
  if (owners.state === 'unreadable') return <ConsoleUnreadable what="The owners" onRetry={onRetry} />;
  if (owners.state === 'missing') return <p className="m-0 text-[13px]" data-testid="kyb-owners-missing"><Unrecorded reason={owners.reason} /> <span className={MUTED}>· {owners.reason}</span></p>;
  if (!owners.value.length) return <p className="m-0 text-[13px]" data-testid="kyb-owners-none">No owner is recorded.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]" data-testid="kyb-owners-table">
          <thead><tr className={`border-b border-axal-hairline text-left text-[11px] uppercase dark:border-gray-800 ${MUTED}`}>
            <th className="py-1.5 pr-3">Owner</th><th className="py-1.5 pr-3">Share</th><th className="py-1.5 pr-3">Nationality</th>
            <th className="py-1.5 pr-3">Date of birth</th><th className="py-1.5 pr-3">Identity check</th><th className="py-1.5">Sanctions</th>
          </tr></thead>
          <tbody>
            {owners.value.map((o) => (
              <tr key={o.index} className="border-b border-axal-hairline align-top last:border-b-0 dark:border-gray-800" data-testid={`kyb-owner-${o.index}`}>
                <td className="py-2 pr-3 font-semibold">{o.name}</td>
                <td className="py-2 pr-3 font-mono">{o.share}</td>
                <td className="py-2 pr-3">{o.nationality}</td>
                <td className="py-2 pr-3"><SensitiveField label="" masked={o.dob} nrReason="Not recorded." onShow={() => kybApi.sensitive(c.uid, 'owner_dob', o.index)} /></td>
                <td className="py-2 pr-3" data-testid={`kyb-owner-kyc-${o.index}`}>
                  {o.userId ? <Link to={personHref(o.userId)} className={LINK}>{o.kyc ? statusWord(o.kyc) : 'Not started'}</Link>
                    : <span className={o.relevant ? 'font-semibold text-amber-700 dark:text-amber-300' : MUTED}>{o.kycReason || 'No account is linked.'}</span>}
                </td>
                <td className="py-2">{o.sanctions.state === 'ok' ? String(o.sanctions.value) : o.sanctions.state === 'missing' ? <span className={MUTED}>{o.sanctions.reason}</span> : <span className={MUTED}>Could not be read</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`m-0 text-[12.5px] ${owners.unchecked.length ? 'font-semibold text-amber-700 dark:text-amber-300' : MUTED}`} data-testid="kyb-owners-summary">
        {owners.unchecked.length
          ? `${owners.unchecked.length} of ${owners.relevantCount} ${owners.relevantCount === 1 ? 'owner' : 'owners'} of 25% or more ${owners.unchecked.length === 1 ? 'has' : 'have'} no approved identity check.`
          : owners.relevantCount ? `Every owner of 25% or more has an approved identity check.` : 'No owner holds 25% or more.'}
        {` Recorded shares add to ${owners.total}%.`}
      </p>
    </>
  );
}

/** The case drawn from its read; split out so it renders without one. */
export function KycBusinessView({ c, onChanged = () => {}, me = null, back = null, nowIso }) {
  const [dialog, setDialog] = useState(null);
  const [doc, setDoc] = useState(null);
  const open = (kind) => setDialog(kind);
  const done = () => { setDialog(null); onChanged(); };
  const stale = () => { setDialog(null); onChanged(); };
  const owners = ownerRows(c.owners);
  const docs = blockOf(c.documents);
  const history = blockOf(c.history);
  const directors = blockOf(c.directors);
  const registry = blockOf(c.registry);
  const diligence = blockOf(c.due_diligence);
  const entity = c.entity || {};
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const waiting = ['in_review', 'not_started', 'needs_info'].includes(c.status) ? waitingFor(c.submitted_at, now) : null;
  const fetchDoc = useMemo(() => (doc ? () => businessDocumentBlob(c.uid, doc.id) : null), [c.uid, doc]);
  const shut = { onClose: () => setDialog(null), onDone: done, onStale: stale };
  const requested = Array.isArray(c.requested_documents) ? c.requested_documents : [];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyb-case">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[20px] font-extrabold" data-testid="kyb-case-name">{c.entity_name || 'Name not recorded'}</h2>
        <span className={`text-[13px] ${MUTED}`}>{kindWord(c.kind)}{c.entity_type ? ` · ${c.entity_type}` : ''}{c.jurisdiction ? ` · ${c.jurisdiction}` : ''}</span>
        <BusinessStatus status={c.status} testId="kyb-case-status" />
        {waiting && <span className={`text-[12.5px] ${MUTED}`} data-testid="kyb-case-waiting">Waiting {waiting}</span>}
        {c.high_risk_country ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="kyb-case-high-risk">High-risk country</span> : null}
      </div>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="kyb-case-owner">
        {c.linked_user_id ? <>Belongs to <Link to={personHref(c.linked_user_id)} className={LINK}>account {c.linked_user_id}</Link></>
          : c.kind === 'imported_partner' ? 'Imported, not linked to an account yet.' : 'No account is linked.'}
      </p>

      <DecisionBar c={c} owners={owners} open={open} />
      {c.decision_reason && (
        <p className={`m-0 rounded-lg border p-3 text-[13px] ${c.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200' : 'border-axal-hairline bg-gray-50 dark:border-gray-800 dark:bg-gray-950'}`} data-testid="kyb-case-reason">
          {c.status === 'rejected' ? 'Rejected: ' : c.status === 'needs_info' ? 'Asked: ' : 'Last note: '}{c.decision_reason}
        </p>
      )}
      {c.unchecked_owner_reason && <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="kyb-case-unchecked-reason">Approved with an owner unchecked: {c.unchecked_owner_reason}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="The entity" testId="kyb-case-entity">
            <SensitiveLine />
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              <SensitiveField label="Registration number" masked={c.registration_number || null} nrReason="Not recorded." onShow={() => kybApi.sensitive(c.uid, 'registration_number')} />
              <SensitiveField label="Registered address" masked={entity.registered_address || null} nrReason="Not recorded." onShow={() => kybApi.sensitive(c.uid, 'address')} />
            </div>
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              {[['Tax ID', entity.tax_id], ['Signing authority', [entity.signing_authority_name, entity.signing_authority_title].filter(Boolean).join(', ') || null],
                ['Submitted', dayWord(c.submitted_at)], ['Expires', dayWord(c.expires_at)]].map(([k, v]) => (
                <div key={k} className="flex flex-col"><dt className="text-[11px] uppercase text-gray-500 dark:text-gray-400">{k}</dt><dd className="m-0">{v ?? <Unrecorded reason={`${k} is not recorded.`} />}</dd></div>
              ))}
            </dl>
          </Section>

          <Section title="Owners" testId="kyb-case-owners" aside={<span className={`text-[12px] ${MUTED}`}>{c.owners_disclosed ? 'Disclosed' : 'Not disclosed'}</span>}>
            <Owners c={c} owners={owners} onRetry={onChanged} />
          </Section>

          <Section title="Directors" testId="kyb-case-directors">
            <Block block={directors} what="The directors" testId="kyb-directors">
              {(v) => (v.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                  {v.map((d, i) => <li key={i} data-testid="kyb-director">{d.name || 'Name not recorded'}{d.title ? <span className={MUTED}> · {d.title}</span> : null}</li>)}
                </ul>
              ) : <p className="m-0 text-[13px]">No director is recorded.</p>)}
            </Block>
          </Section>

          <Section title="Documents" testId="kyb-case-documents">
            <p className={`m-0 text-[12.5px] ${MUTED}`}>Every view is recorded. Documents open here, never in a new tab.</p>
            <Block block={docs} what="The documents" testId="kyb-docs">
              {(v) => (v.length ? (
                <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
                  {v.map((d) => (
                    <li key={d.uid} className="flex items-center gap-3 py-2" data-testid={`kyb-doc-${d.uid}`}>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">{docKindWord(d.kind)}</span>
                        <span className={`text-[12px] ${MUTED}`}>{[d.content_type, dayWord(d.created_at)].filter(Boolean).join(' · ') || 'Details not recorded'}</span>
                      </div>
                      <button type="button" className={BTN} onClick={() => setDoc({ id: d.uid, key: d.uid, title: docKindWord(d.kind) })} data-testid={`kyb-doc-view-${d.uid}`}>View</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 text-[13px]" data-testid="kyb-docs-none">No document is on file for this case.</p>)}
            </Block>
            {requested.length ? <p className="m-0 text-[12.5px]" data-testid="kyb-docs-requested">Asked for: {requested.map((r) => docKindWord(r?.kind)).join(', ')}.</p> : null}
          </Section>

          <Section title="History" testId="kyb-case-history" aside={<span className={`text-[12px] ${MUTED}`}>Newest first</span>}>
            <Block block={history} what="The history" testId="kyb-history">
              {(v) => (v.length ? (
                <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
                  {v.map((e, i) => (
                    <li key={i} className="flex flex-col sm:flex-row sm:gap-3" data-testid="kyb-history-row">
                      <span className={`w-32 flex-none font-mono text-[12px] ${MUTED}`}>{dayWord(e.created_at) || 'Not recorded'}</span>
                      <span>{eventWord(e.action)}<span className={MUTED}> · {e.actor_name || 'an admin'}</span></span>
                    </li>
                  ))}
                </ol>
              ) : <p className="m-0 text-[13px]" data-testid="kyb-history-none">No event is recorded on this case.</p>)}
            </Block>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Registry" testId="kyb-case-registry">
            <Block block={registry} what="The registry check" testId="kyb-registry">
              {(v) => (
                <p className="m-0 text-[13px]" data-testid="kyb-registry-ok">
                  {v.matches ? 'The registry record matches.' : 'The registry record does not match.'}{' '}
                  {v.good_standing == null ? 'Good standing not recorded.' : v.good_standing ? 'Active, in good standing.' : 'Not in good standing.'}
                </p>
              )}
            </Block>
          </Section>
          <Section title="Due diligence" testId="kyb-case-diligence" aside={<span className={`text-[12px] ${MUTED}`}>Read only</span>}>
            <Block block={diligence} what="Due diligence" testId="kyb-diligence">
              {(v) => (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                  {v.map((d) => (
                    <li key={d.uid} data-testid="kyb-diligence-row">
                      <Link to={`/admin/due-diligence/${encodeURIComponent(d.uid)}`} className={LINK}>{d.uid}</Link>
                      <span className={MUTED}> · {d.kyb_section_status ? `Entity section ${d.kyb_section_status}` : 'No entity section'}{Number.isFinite(Number(d.items)) && d.kyb_section_status ? ` · ${d.waiting ?? 0} of ${d.items} waiting` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <p className={`m-0 text-[12px] ${MUTED}`}>Decided on the due-diligence page, not here.</p>
          </Section>
          <Section title="Sanctions" testId="kyb-case-sanctions">
            <p className="m-0 text-[13px]">{dayWord(c.sanctions_last_checked_at) ? `Last checked ${dayWord(c.sanctions_last_checked_at)}.` : <><Unrecorded reason="No sanctions check is recorded for this business." /> <span className={MUTED}>· No sanctions check is recorded for this business.</span></>}</p>
          </Section>
        </div>
      </div>

      {dialog === 'approve' && <ApproveBusiness c={c} owners={owners} {...shut} />}
      {dialog === 'reject' && <RejectBusiness c={c} {...shut} />}
      {dialog === 'documents' && <RequestDocuments c={c} {...shut} />}
      {dialog === 'dismiss' && <DismissImport c={c} {...shut} />}
      {dialog === 'link' && <LinkAccount c={c} {...shut} />}
      {doc && <KycViewer doc={doc} viewer={me?.name || null} fetchDoc={fetchDoc} rejectedOn={c.status === 'rejected' ? dayWord(c.reviewed_at) : null} onClose={() => setDoc(null)} nowIso={nowIso} />}
    </div>
  );
}

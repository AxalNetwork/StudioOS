/**
 * D1233 (#3241) — one person's case, complete (KYC3, KYC3b, KYC13b, KYC15c):
 * the earlier rejection on top, the submitted values masked with Show (each
 * showing logged, D634), the documents opening in the viewer inside the page,
 * the seven automatic checks, sanctions and exposure, the history, the
 * assignment, HQ's notes, and the case's own decision bar.
 *
 * Two reads: the record (`GET /api/kyc/admin/:userId`, with part 2's
 * screening and HQ blocks) and the case beside it (`/admin/:userId/case`).
 * Only the record can blank the page; a failed case read leaves each of its
 * blocks Unreadable with Try again. Each read is logged by the Worker.
 *
 * DECISIONS are the bar's: Approve, Reject, Ask for information, the
 * re-check and Send to HQ, each a dialog in the page (`KycDialogs.jsx`). A
 * case with HQ, or one whose HQ state could not be read, offers the studio no
 * verdict, as the Worker refuses it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, kycPeopleApi } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Unrecorded } from '../../../ui';
import { KycSensitiveFields } from '../../../components/hqReview/SensitiveField';
import { CONSOLE_LOADING, ConsoleUnreadable } from '../consoles/shared';
import { StatusPill } from '../consoles/KycConsole';
import { statusWord } from './kycModel';
import {
  NOTE_MAX, actionsFor, checkRows, checkSummary, consentLine, dayLabel, documentRows, eventLine, hqView, pepLine,
  resultLine, roleWord, screeningView, submittedFacts, timeLabel, unlockLine,
} from './peopleModel';
import { ApproveDialog, AssignDialog, HqDialog, InfoDialog, MatchDialog, RecheckDialog, RejectDialog, ScreenDialog } from './KycDialogs';
import KycViewer from './KycViewer';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
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

function CaseUnreadable({ what, onRetry }) {
  return <ConsoleUnreadable what={what} onRetry={onRetry} />;
}

/** KYC3 — the record and the case, read side by side. */
export function KycPersonCase({ id, me: meProp, nowIso }) {
  const auth = useAuth();
  const me = meProp || auth?.user || null;
  const [rec, setRec] = useState({ kind: 'loading', data: null });
  const [cas, setCas] = useState({ kind: 'loading', data: null });
  const loadRecord = useCallback(async () => {
    setRec((r) => ({ kind: r.data ? 'ok' : 'loading', data: r.data }));
    try { setRec({ kind: 'ok', data: await api.kycAdminGet(id) }); } catch (e) {
      reportError('KycPersonCase:record', e);
      setRec({ kind: e?.status === 404 ? 'missing' : 'unreadable', data: null });
    }
  }, [id]);
  const loadCase = useCallback(async () => {
    try { setCas({ kind: 'ok', data: await kycPeopleApi.caseOf(id) }); } catch (e) {
      reportError('KycPersonCase:case', e);
      setCas({ kind: 'failed', data: null });
    }
  }, [id]);
  useEffect(() => { setRec({ kind: 'loading', data: null }); setCas({ kind: 'loading', data: null }); loadRecord(); loadCase(); }, [loadRecord, loadCase]);
  const reload = useCallback(() => { loadRecord(); loadCase(); }, [loadRecord, loadCase]);

  const back = <Link to="/admin/kyc" className="w-fit text-[13px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200" data-testid="kyc-case-back">‹ People</Link>;
  if (rec.kind === 'loading') return <div className="flex flex-col gap-3">{back}<div className="py-10 text-center text-gray-600 dark:text-gray-300">{CONSOLE_LOADING}</div></div>;
  if (rec.kind === 'missing') return <div className="flex flex-col gap-3" data-testid="kyc-case-missing">{back}<p className="m-0 text-sm">No account has this id.</p></div>;
  if (rec.kind === 'unreadable') return <div className="flex flex-col gap-3">{back}<ConsoleUnreadable what="This person’s check" onRetry={loadRecord} /></div>;
  return <KycPersonView record={rec.data} caseData={cas.data} caseState={cas.kind} onRetryCase={loadCase} onChanged={reload} me={me} back={back} nowIso={nowIso} />;
}

/** The decision bar (KYC3; sticky at the foot on a phone, KYC15c). */
function DecisionBar({ record, open }) {
  const { list, held } = actionsFor(record.kyc_status, record.hq);
  const has = (a) => list.includes(a);
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-white/95 p-3 sm:static dark:border-gray-800 dark:bg-gray-900/95" data-testid="kyc-decision-bar">
      <p className={`m-0 mr-auto text-[12.5px] ${MUTED}`} data-testid="kyc-decision-line">{held || (has('approve') ? unlockLine(record.role)
        : has('recheck') ? `This check is ${statusWord(record.kyc_status)}. A re-check asks them to verify again.`
          : `This check is ${statusWord(record.kyc_status)}; no decision is open on it.`)}</p>
      {has('hq') && <button type="button" className={BTN} onClick={() => open('hq')} data-testid="kyc-act-hq">Send to HQ…</button>}
      {has('recheck') && <button type="button" className={BTN} onClick={() => open('recheck')} data-testid="kyc-act-recheck">Ask for a re-check…</button>}
      {has('info') && <button type="button" className={BTN} onClick={() => open('info')} data-testid="kyc-act-info">Ask for information</button>}
      {has('reject') && <button type="button" className={BAD} onClick={() => open('reject')} data-testid="kyc-act-reject">Reject…</button>}
      {has('approve') && <button type="button" className={GO} onClick={() => open('approve')} data-testid="kyc-act-approve">Approve…</button>}
    </div>
  );
}

function Screening({ record, open }) {
  const sv = screeningView(record.screening);
  const pep = pepLine(record.kyc_data);
  const consent = consentLine(record.kyc_data);
  const tone = sv.state === 'clear' ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : sv.state === 'match' ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
  return (
    <Section title="Sanctions and exposure" testId="kyc-case-sanctions" aside={<button type="button" className={BTN} onClick={() => open('screen')} data-testid="kyc-act-screen">Screen again</button>}>
      <div className={`flex flex-col gap-1 rounded-lg border p-3 ${tone}`} data-testid={`kyc-screening-${sv.state}`}>
        <span className="text-[13px] font-bold">{sv.title}</span>
        <span className="text-[12.5px]">{sv.line}</span>
        {sv.notes && <span className="text-[12.5px]">Review: {sv.notes}</span>}
        {sv.reviewable && <button type="button" className={`${BTN} mt-1 w-fit`} onClick={() => open('match')} data-testid="kyc-act-match">Review match…</button>}
      </div>
      {pep.text ? <p className={`m-0 text-[13px] ${pep.pep ? 'font-semibold' : ''}`} data-testid="kyc-pep">{pep.text}</p> : <p className="m-0 text-[13px]"><Unrecorded reason="The submission carries no answer on political exposure." /> (political exposure)</p>}
      {consent && <p className={`m-0 text-[13px] ${MUTED}`}>{consent}</p>}
    </Section>
  );
}

/** The case drawn from its record and its case read; split out so it renders without a read. */
export function KycPersonView({ record: r, caseData = null, caseState = 'ok', onRetryCase = () => {}, onChanged = () => {}, me = null, back = null, nowIso }) {
  const [dialog, setDialog] = useState(null);
  const [doc, setDoc] = useState(null);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState({ kind: 'idle', msg: '' });
  const open = (kind) => setDialog(kind);
  const done = () => { setDialog(null); onChanged(); };
  const checks = checkRows(r.kyc_data);
  const summary = checkSummary(checks);
  const hq = hqView(r.hq);
  const docs = caseState === 'ok' ? documentRows(caseData?.documents, r.kyc_data) : null;
  const assignee = caseState === 'ok' ? caseData?.assignee : null;

  const saveNote = async () => {
    const body = note.trim();
    if (!body || noteState.kind === 'saving') return;
    setNoteState({ kind: 'saving', msg: '' });
    try { await kycPeopleApi.addNote(r.id, body); setNote(''); setNoteState({ kind: 'idle', msg: 'Saved. Only admins read it.' }); onChanged(); } catch (e) {
      reportError('KycPersonView:note', e);
      setNoteState({ kind: 'failed', msg: e?.message || 'The note could not be saved. Try again.' });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-case">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[20px] font-extrabold">{r.name || 'Name not recorded'}</h2>
        {roleWord(r.role) && <span className={`text-[13px] ${MUTED}`}>{roleWord(r.role)}</span>}
        <StatusPill status={r.kyc_status} testId="kyc-case-status" />
        <span className={`text-[12.5px] ${MUTED}`} data-testid="kyc-case-assignee">
          {caseState === 'ok' ? <>Assigned: {assignee ? (assignee.name || 'an admin') : 'no one'}</> : caseState === 'failed' ? 'Assignment could not be read' : 'Reading the assignment…'}
          {caseState === 'ok' && <> · <button type="button" className="font-semibold underline hover:text-gray-900 dark:hover:text-gray-100" onClick={() => open('assign')} data-testid="kyc-act-assign">{assignee ? 'Reassign' : 'Assign'}</button></>}
        </span>
      </div>

      <DecisionBar record={r} open={open} />
      {hq.withHq && (
        <p className="m-0 rounded-lg border border-violet-200 bg-violet-50 p-3 text-[13px] text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200" data-testid="kyc-case-hq">
          {hq.line} {hq.reasons.length ? `Why: ${hq.reasons.join('; ')}.` : ''}
        </p>
      )}
      {r.rejection_reason && (
        <p className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="kyc-case-rejected">Earlier rejection: {r.rejection_reason}</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="What they submitted" testId="kyc-case-facts">
            <p className={`m-0 text-[12.5px] ${MUTED}`}>Showing a value is recorded under your name.</p>
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              {submittedFacts(r).map(([k, v]) => (
                <div key={k} className="flex flex-col"><dt className="text-[11px] uppercase text-gray-500 dark:text-gray-400">{k}</dt><dd className="m-0">{v ?? <Unrecorded reason={`${k} is not in the record.`} />}</dd></div>
              ))}
            </dl>
            {r.kyc_data?.masked && <KycSensitiveFields masked={r.kyc_data.masked} onShow={(field) => api.kycAdminShowField(r.id, field)} />}
          </Section>

          <Section title="Documents" testId="kyc-case-documents">
            <p className={`m-0 text-[12.5px] ${MUTED}`}>Every view is recorded. Documents open here, never in a new tab.</p>
            {caseState === 'failed' ? <CaseUnreadable what="The documents" onRetry={onRetryCase} />
              : !docs ? <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>
                : !docs.length ? <p className="m-0 text-[13px]" data-testid="kyc-docs-none">No document is on file for this case.</p>
                  : (
                    <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
                      {docs.map((d) => (
                        <li key={d.key} className="flex items-center gap-3 py-2" data-testid={`kyc-doc-${d.key}`}>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="font-semibold">{d.title}</span>
                            <span className={`text-[12px] ${MUTED}`}>{d.removed ? `Deleted on ${d.removed}` : d.meta}</span>
                          </div>
                          <button type="button" className={BTN} onClick={() => setDoc(d)} data-testid={`kyc-doc-view-${d.key}`}>View</button>
                        </li>
                      ))}
                    </ul>
                  )}
          </Section>

          <Section title="Automatic checks" testId="kyc-case-checks" aside={r.kyc_data?.provider_result?.ref_id ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{r.kyc_data.provider_result.ref_id}</span> : null}>
            {summary == null ? <p className="m-0 text-[13px]"><Unrecorded reason="The submission carries no provider result." /></p> : (
              <>
                <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0 text-[13px] sm:grid-cols-2">
                  {checks.map((c) => (
                    <li key={c.key} className="flex items-center justify-between gap-2" data-testid={`kyc-check-${c.key}`}>
                      <span>{c.label}</span>
                      <span className={c.passed == null ? MUTED : c.passed ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-red-700 dark:text-red-300'}>{c.passed == null ? 'Not recorded' : c.passed ? 'Passed' : 'Failed'}</span>
                    </li>
                  ))}
                </ul>
                <p className="m-0 text-[12.5px]" data-testid="kyc-check-summary">{summary}{resultLine(r.kyc_data?.provider_result?.result) ? ` · ${resultLine(r.kyc_data.provider_result.result)}` : ''}</p>
              </>
            )}
          </Section>

          <Screening record={r} open={open} />

          <Section title="History" testId="kyc-case-history" aside={<span className={`text-[12px] ${MUTED}`}>Newest first</span>}>
            {caseState === 'failed' ? <CaseUnreadable what="The history" onRetry={onRetryCase} />
              : caseState !== 'ok' ? <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>
                : !(caseData?.events || []).length ? <p className="m-0 text-[13px]" data-testid="kyc-history-none">No event is recorded on this case. The history began with migration 614, so an older decision has none.</p>
                  : (
                    <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
                      {caseData.events.map((e) => {
                        const l = eventLine(e);
                        return (
                          <li key={e.id} className="flex flex-col sm:flex-row sm:gap-3" data-testid="kyc-history-row">
                            <span className={`w-44 flex-none font-mono text-[12px] ${MUTED}`}>{l.when}</span>
                            <span>{l.what}{l.note ? <span className={MUTED}> · {l.note}</span> : null}</span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Notes for admins" testId="kyc-case-notes">
            {caseState === 'failed' ? <CaseUnreadable what="The notes" onRetry={onRetryCase} /> : (
              <>
                {(caseData?.notes || []).map((n) => (
                  <div key={n.id} className="flex flex-col text-[13px]" data-testid="kyc-note">
                    <span className={`text-[12px] ${MUTED}`}>{n.author?.name || 'An admin'} · {timeLabel(n.at) || 'time not recorded'}</span>
                    <span className="whitespace-pre-wrap">{n.body}</span>
                  </div>
                ))}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={NOTE_MAX} placeholder="Add a note only admins see"
                  className="w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-900" data-testid="kyc-note-text" />
                <div className="flex items-center gap-2">
                  <button type="button" className={BTN} disabled={!note.trim() || noteState.kind === 'saving'} onClick={saveNote} data-testid="kyc-note-save">{noteState.kind === 'saving' ? 'Saving…' : 'Save note'}</button>
                  {noteState.msg && <span className={`text-[12px] ${noteState.kind === 'failed' ? 'text-red-700 dark:text-red-300' : MUTED}`} role={noteState.kind === 'failed' ? 'alert' : undefined}>{noteState.msg}</span>}
                </div>
                <p className={`m-0 text-[12px] ${MUTED}`}>The member never reads a note.</p>
              </>
            )}
          </Section>
          <Section title="Submitted" testId="kyc-case-dates">
            <p className="m-0 text-[13px]">{dayLabel(r.submitted_at) ? `Submitted ${timeLabel(r.submitted_at)}` : <Unrecorded reason="No submission time is recorded." />}</p>
            {r.reviewed_at && <p className={`m-0 text-[13px] ${MUTED}`}>Last reviewed {timeLabel(r.reviewed_at)}</p>}
          </Section>
        </div>
      </div>

      {dialog === 'approve' && <ApproveDialog record={r} screening={r.screening} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'reject' && <RejectDialog record={r} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'info' && <InfoDialog record={r} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'recheck' && <RecheckDialog record={r} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'hq' && <HqDialog record={r} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'match' && <MatchDialog record={r} screening={r.screening} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'screen' && <ScreenDialog record={r} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'assign' && <AssignDialog people={[r]} me={me} onClose={() => setDialog(null)} onDone={done} />}
      {doc && <KycViewer userId={r.id} doc={doc} viewer={me?.name || null} rejectedOn={r.kyc_status === 'rejected' ? dayLabel(r.reviewed_at) : null} onClose={() => setDoc(null)} nowIso={nowIso} />}
    </div>
  );
}

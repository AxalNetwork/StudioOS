/**
 * D1153 (#3058, part 5 of #2421) — the working tabs, drawn to the canvas on
 * today's reads: Diligence (DL7, DL7n), Documents and data room (DL8a–c, DL9),
 * Terms (DL10) and Commitment and closing (DL11–DL13). The words and the
 * rules come from `dealWorkModel.js`; this file only draws them.
 *
 * Each card reads alone: one that fails says Unreadable with Try again and
 * leaves the rest of the tab standing. Every change opens an in-page dialog
 * that says what it changes, and its refusal stays inside the dialog.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionPrimary, actionGhost, actionDanger } from '../../ui';
import { api, dd } from '../../lib/api';
import { ddLifecycleApi } from '../../lib/api/ddLifecycle';
import { ddDeskApi } from '../../lib/api/ddDesk';
import { dealWorkroomApi } from '../../lib/api/dealWorkroom';
import { reportError } from '../../lib/log';
import { safeExternalUrl } from '../../lib/url';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import DealReferencesTab from '../../components/deals/DealReferencesTab';
import DealPaperRow from './DealPaper';
import DealSyndicates from '../../components/deals/DealSyndicates';
import FromMercury from '../investor/FromMercury';
import { ProofDoor, useProofTargets } from '../investor/ProofOfFunds';
import { ownDealTarget, showsProof } from '../investor/proofOfFundsModel';
import { tabHref } from '../dealPageModel';
import { CARD, EYE, SUB, H3, BTN_S, BTN_P } from './DealFrame';
import { Slot } from './DealOverview';
import SharedRoomFiles from './SharedRoomFiles.jsx';
import InvestorCapTablePanel from '../raise/captable/InvestorCapTablePanel';
import { LINK_LINE, composeBody } from '../duediligence/ddCaseModel';
import { DealDeckCard } from './DealDeck';
import {
  ASK_MAX, CAP_TABLE_SLOT, LEGAL_SLOT, NOTE_READERS, QUESTIONS_SLOT, ROUTES, ROUTE_NOTE, SYNDICATES_LINE, WITHDRAW_MAX,
  preferenceLine, termsPreference, caseCard, caseDoors, caseForDeal, closedReason, icStep, myCommitment, openFlagRows, sectionProgress, templateChoices, paperRows, proposedTerms, requestRows, roomListing, roomStateOf, roundLines, withdrawError,
} from './dealWorkModel';

const FIELD = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink focus:border-axal-violet focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PILL = {
  done: 'border-axal-positive/40 bg-axal-positive/10 text-axal-positive dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  wait: 'border-axal-amber/40 bg-axal-amber/10 text-axal-amber-deep dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  off: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  now: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300',
};
const Pill = ({ tone = 'off', children }) => <span className={`inline-flex items-center rounded-axal-pill border px-2 py-0.5 text-[11.5px] font-bold ${PILL[tone]}`}>{children}</span>;
const Bar = ({ pct }) => (
  <span className="block h-1.5 w-full overflow-hidden rounded-axal-pill bg-axal-ground dark:bg-gray-800">
    <span className="block h-full rounded-axal-pill bg-axal-violet dark:bg-violet-400" style={{ width: `${pct}%` }} />
  </span>
);
const Reading = () => <p className={`m-0 ${SUB}`} aria-live="polite">Reading…</p>;
const Card = ({ title, eye, children, testId, meta }) => (
  <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid={testId}>
    {eye && <span className={EYE}>{eye}</span>}
    {title && <div className="flex items-baseline justify-between gap-3"><h3 className={H3}>{title}</h3>{meta}</div>}
    {children}
  </section>
);
const Err = ({ text }) => (text ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{text}</p> : null);

/** A read with its own state: loading, ready or unreadable. */
function useRead(load, deps) {
  const [read, setRead] = useState({ status: 'loading' });
  // D4633: each read carries a serial. An answer from a superseded read (the
  // deal changed, or a retry started) lands nowhere, and none lands after unmount.
  const serial = useRef(0);
  useEffect(() => () => { serial.current += 1; }, []);
  const run = ({ keepReady = false } = {}) => {
    const mine = ++serial.current;
    setRead((read) => keepReady && read.status === 'ready' ? read : { status: 'loading' });
    load().then((data) => { if (serial.current === mine) setRead({ status: 'ready', data }); })
      .catch((e) => { reportError('DealWork:read', e); if (serial.current === mine) setRead({ status: 'unreadable', error: e }); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  return [read, run];
}

/** Ask, then act: the dialog every change on these tabs opens first. */
function ConfirmDialog({ title, sub, act, danger = false, onConfirm, onClose, testId, check, children, done, initialFocus, lockWhileBusy = false }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const go = async () => {
    const bad = check?.();
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try { const r = await onConfirm(); if (done) setResult(done(r)); else onClose(true); } catch (e) { setErr(e?.message || 'That did not save. Nothing was changed. Try again.'); } finally { setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} sub={sub} initialFocus={initialFocus}
      onClose={() => { if (!lockWhileBusy || !busy) onClose(Boolean(result)); }} testId={testId}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {result
            ? <button type="button" className={actionPrimary} onClick={() => onClose(true)} data-testid={`${testId}-done`}>Done</button>
            : (<>
              <button type="button" className={actionGhost} disabled={lockWhileBusy && busy} onClick={() => onClose(false)}>Back</button>
              <button type="button" className={danger ? actionDanger : actionPrimary} disabled={busy} onClick={go} data-testid={`${testId}-confirm`}>{act}</button>
            </>)}
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {result || children}
        <Err text={err} />
      </div>
    </Lightbox>
  );
}

// ---------------------------------------------------------------- DL7 Diligence

export function DealDiligence({ deal, userId }) {
  const [list, reloadList] = useRead(() => dd.listCases({ subject_type: 'project', subject_id: deal.project_id }), [deal.project_id]);
  const found = caseForDeal(list, deal.project_id);
  const uid = found.state === 'ready' ? found.row.uid : null;
  const [caseRead, loadDetail] = useRead(async () => uid ? { uid, userId, data: await dd.getCase(uid) } : null, [uid, userId]);
  const [opening, setOpening] = useState(false);
  const result = caseRead.data;
  const data = result && result.uid === uid && result.userId === userId ? result.data : null;
  const card = found.state === 'ready' ? caseCard(found.row, data, userId) : null;
  const flagList = data ? openFlagRows(data) : null;
  const progress = data ? sectionProgress(data) : [];
  const ic = found.state === 'ready' ? icStep(found.row, data) : null;
  const doors = found.state === 'ready' ? caseDoors(found.row, data) : [];
  const [sending, setSending] = useState(false);
  return (
    <div className="grid gap-3.5 md:grid-cols-2" data-testid="deal-diligence">
      {found.state === 'loading' && <Card title="Diligence case"><Reading /></Card>}
      {found.state === 'unreadable' && <Unreadable what="Your diligence cases" claim="That is not a claim that no case exists." onRetry={reloadList} />}
      {found.state === 'none' && (
        <section className={`${CARD} flex flex-col items-start gap-2 p-5 md:col-span-2`} data-testid="deal-dd-none">
          <span aria-hidden="true" className="text-[18px] text-axal-muted dark:text-gray-400">○</span>
          <h3 className={H3}>No diligence case on this company yet.</h3>
          <p className={`m-0 ${SUB}`}>A case holds the checklist, the requests to the founder and the risk band.</p>
          <button type="button" className={BTN_S} onClick={() => setOpening(true)} data-testid="deal-dd-open">Open a diligence case</button>
        </section>
      )}
      {card && (
        <Card eye="Diligence case" title={card.title} testId="deal-dd-case">
          <div className="flex flex-wrap gap-1.5"><Pill tone="wait">{card.stage}</Pill><Pill tone="off">{card.risk}</Pill></div>
          <p className="m-0 font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100">{card.items.line}</p>
          {card.items.pct != null && <Bar pct={card.items.pct} />}
          {!flagList?.rows && <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="deal-dd-flags-line">{card.flags}</p>}
          {flagList?.rows && (
            <div className="flex flex-col gap-1.5" data-testid="deal-dd-flags">
              <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="deal-dd-flags-line">{flagList.line}</p>
              {flagList.rows.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {flagList.rows.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-center gap-1.5 border-t border-axal-hairline pt-1.5 text-[13px] dark:border-gray-700" data-testid="deal-dd-flag">
                      <Pill tone="wait">{f.severity}</Pill>
                      <span className="font-bold text-axal-ink dark:text-gray-100">{f.title}</span>
                      <span className={SUB}>{f.section} · {f.state}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{card.opened}</p>
          {caseRead.status === 'unreadable' && <Unreadable what="The case’s sections and requests" onRetry={loadDetail} />}
          {card.yours?.map((s) => <p key={s.title} className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Your section: {s.title} <Pill tone="now">{s.status}</Pill></p>)}
          {ic && (
            <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid="deal-dd-ic">
              <span className={EYE}>Investment committee</span>
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="deal-dd-ic-line">{ic.text}</p>
              {ic.state === 'ready' && <button type="button" className={`${BTN_P} w-fit`} onClick={() => setSending(true)} data-testid="deal-dd-ic-open">Send to IC</button>}
              {ic.state === 'decide' && <Link to={ic.href} className={`${BTN_S} w-fit`} data-testid="deal-dd-ic-decide">Record the decision</Link>}
              {ic.state === 'sent' && <Link to={ic.href} className={`${BTN_S} w-fit`} data-testid="deal-dd-ic-commit">Open the Commit zone</Link>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link to={card.href} className={`${BTN_S} w-fit`} data-testid="deal-dd-door">Open the case</Link>
            {doors.map((d) => <Link key={d.key} to={d.href} className={`${BTN_S} w-fit`} data-testid={`deal-dd-door-${d.key}`}>{d.label}</Link>)}
          </div>
          <p className={`m-0 ${SUB}`}>The case lives on its own page.</p>
        </Card>
      )}
      {card && progress.length > 0 && (
        <Card title="Progress by section" testId="deal-dd-sections">
          {progress.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 border-t border-axal-hairline pt-2 first:border-t-0 first:pt-0 dark:border-gray-700" data-testid="deal-dd-section">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{p.title}</span>
                <span className={SUB}>{p.line} · {p.verdict}</span>
              </div>
              {p.pct != null && <Bar pct={p.pct} />}
            </div>
          ))}
        </Card>
      )}
      {card && <FounderRequests key={`${uid}:${userId}`} row={found.row} userId={userId} data={data}
        unreadable={caseRead.status === 'unreadable'} reload={loadDetail} />}
      <div className="md:col-span-1"><DealReferencesTab dealId={deal.id} /></div>
      <Slot slot={QUESTIONS_SLOT} testId="deal-dd-questions" />
      {opening && <OpenCaseDialog deal={deal} onClose={(changed) => { setOpening(false); if (changed) reloadList(); }} />}
      {sending && uid && (
        <ConfirmDialog testId="deal-dd-ic-dialog" title={`Send ${card?.title || 'this case'} to IC?`}
          sub="A new IC record is opened with this case, its decision and its memo attached. The case can be sent once."
          act="Send to IC"
          onConfirm={() => ddLifecycleApi.sendToIc(uid)}
          done={() => (
            <div className="flex flex-col gap-2" data-testid="deal-dd-ic-sent">
              <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">The case is with IC.</p>
              <Link to="/deals/commit" className={`${BTN_S} w-fit`} data-testid="deal-dd-ic-sent-commit">Open the Commit zone</Link>
            </div>
          )}
          onClose={(changed) => { setSending(false); if (changed) loadDetail(); }} />
      )}
    </div>
  );
}

/**
 * D6180: opening a case. The template depths come from `GET /dd/templates`;
 * when more than one is offered the investor picks one, Standard first. A
 * failed read of the templates still opens at Standard, and says so.
 */
function OpenCaseDialog({ deal, onClose }) {
  const [tpl] = useRead(() => ddDeskApi.templates(), []);
  const choices = templateChoices(tpl);
  const [depth, setDepth] = useState('standard');
  const offered = choices.length > 1;
  const chosen = offered && choices.some((c) => c.depth === depth) ? depth : (choices[0]?.depth || 'standard');
  const word = (choices.find((c) => c.depth === chosen)?.label || 'Standard').toLowerCase();
  return (
    <ConfirmDialog testId="deal-dd-open-dialog" title={`Open a diligence case on ${deal.project_name || 'this company'}?`}
      sub={`A case is yours: it holds the ${word} checklist, the requests you send the founder and the risk band. The founder sees a request only when you send one.`}
      act="Open the case"
      onConfirm={() => dd.openCase({ subject_type: 'project', subject_id: deal.project_id, subject_label: deal.project_name || `Deal #${deal.id}`, template_depth: chosen })}
      onClose={onClose}>
      {tpl.status === 'loading' && <Reading />}
      {tpl.status === 'unreadable' && <p className={`m-0 ${SUB}`} data-testid="deal-dd-templates-unreadable">The templates could not be read, so the case opens at Standard.</p>}
      {offered && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="deal-dd-templates">
          <legend className="mb-1 text-[13px] font-bold text-axal-ink dark:text-gray-100">Checklist depth</legend>
          {choices.map((c) => (
            <label key={c.depth} className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="radio" name="dd-depth" value={c.depth} checked={chosen === c.depth} onChange={() => setDepth(c.depth)} data-testid={`deal-dd-depth-${c.depth}`} />
              <span className="font-bold">{c.label}</span>
              <span className={SUB}>{c.line}</span>
            </label>
          ))}
        </fieldset>
      )}
    </ConfirmDialog>
  );
}

function FounderRequests({ row, userId, data, unreadable, reload }) {
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const current = data?.case ?? row;
  const viewer = Number(userId);
  const owner = viewer > 0 && viewer === Number(current.owner_user_id);
  const lead = viewer > 0 && viewer === Number(current.lead_user_id);
  const allowed = owner || lead;
  const requests = data && allowed ? requestRows(data) : [];
  const active = requests.find((r) => r.id === dialog?.id);
  const close = (message) => {
    setDialog(null);
    if (message) {
      setNotice(message);
      reload({ keepReady: true });
    }
  };
  const action = (kind, id) => {
    setNotice('');
    setDialog({ kind, id });
  };
  return (
    <Card title="Requests to the founder" testId="deal-dd-requests"
      meta={data && allowed ? <span className="text-right font-mono text-[12px] font-bold text-axal-amber-deep dark:text-amber-300">{requests.filter((r) => r.tone === 'wait').length} waiting</span> : null}>
      {!data && (unreadable ? <Unreadable what="The requests" claim="That is not a claim that none was sent." onRetry={reload} /> : <Reading />)}
      {data && !allowed && <p className={`m-0 ${SUB}`}>The case owner and lead can open the requests.</p>}
      {data && allowed && (
        <>
          <button type="button" className={`${BTN_S} w-fit`} onClick={() => action('new')} data-testid="deal-dd-request-new">New request</button>
          {requests.length === 0 && <p className={`m-0 ${SUB}`}>No requests have been sent to the founder on this case.</p>}
          {requests.map((r) => (
            <div key={r.id} className="grid min-w-0 gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
                <Pill tone={r.tone}>{r.state}</Pill>
              </div>
              {owner && r.tone === 'wait' && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={BTN_S} onClick={() => action('remind', r.id)} data-testid={`deal-dd-request-${r.id}-remind`}>Remind</button>
                  <button type="button" className={BTN_S} onClick={() => action('withdraw', r.id)} data-testid={`deal-dd-request-${r.id}-withdraw`}>Withdraw</button>
                </div>
              )}
              {r.answer && <button type="button" className={`${BTN_S} w-fit`} onClick={() => action('answer', r.id)} data-testid={`deal-dd-request-${r.id}-answer`}>Open the answer</button>}
            </div>
          ))}
          <p role="status" className={`m-0 ${SUB}`}>{notice}</p>
          {dialog?.kind === 'new' && <NewFounderRequest uid={row.uid} close={close} />}
          {active?.tone === 'wait' && owner && dialog.kind === 'remind' && (
            <ConfirmDialog testId="deal-dd-remind-dialog" title={`Remind the founder · ${active.title}`}
              sub="The founder gets a reminder by notification and email. You can send one reminder a day."
              act="Send reminder" lockWhileBusy onConfirm={() => dd.remindRequest(row.uid, active.id)}
              onClose={(changed) => close(changed ? 'Reminder sent.' : '')} />
          )}
          {active?.tone === 'wait' && owner && dialog.kind === 'withdraw' && <WithdrawFounderRequest uid={row.uid} request={active} close={close} />}
          {active?.answer && dialog.kind === 'answer' && <FounderAnswer uid={row.uid} request={active} onClose={() => close()} />}
        </>
      )}
    </Card>
  );
}

function NewFounderRequest({ uid, close }) {
  const [form, setForm] = useState({ title: '', details: '', due: '' });
  const titleField = useRef(null);
  const today = new Date().toISOString().slice(0, 10);
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return (
    <ConfirmDialog testId="deal-dd-new-request-dialog" title="New request"
      sub="The founder will see this in their diligence requests."
      act="Send request" lockWhileBusy initialFocus={titleField} check={() => composeBody(form, today).error}
      onConfirm={() => dd.createRequest(uid, composeBody(form, today).body)}
      onClose={(changed) => close(changed ? 'Request sent.' : '')}>
      <label className={SUB}>Title
        <input ref={titleField} className={FIELD} maxLength={200} value={form.title} onChange={set('title')} data-testid="deal-dd-request-title" />
      </label>
      <label className={SUB}>Details (optional)
        <textarea className={FIELD} rows={3} maxLength={4000} value={form.details} onChange={set('details')} data-testid="deal-dd-request-details" />
      </label>
      <label className={SUB}>Due date (optional)
        <input type="date" className={FIELD} min={today} value={form.due} onChange={set('due')} data-testid="deal-dd-request-due" />
      </label>
    </ConfirmDialog>
  );
}

function WithdrawFounderRequest({ uid, request, close }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog testId="deal-dd-withdraw-dialog" title={`Withdraw request · ${request.title}`}
      sub="The founder will no longer see this request. Files already sent stay on the case."
      act="Withdraw request" danger lockWhileBusy onConfirm={() => dd.withdrawRequest(uid, request.id, reason.trim() || undefined)}
      onClose={(changed) => close(changed ? 'Request withdrawn.' : '')}>
      <label className={SUB}>Reason (optional)
        <textarea className={FIELD} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="deal-dd-request-withdraw-reason" />
      </label>
    </ConfirmDialog>
  );
}

function FounderAnswer({ uid, request, onClose }) {
  const { note, url, files } = request.answer;
  const link = safeExternalUrl(url);
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');
  const download = async (file) => {
    setOpening(file.id);
    setError('');
    try {
      const result = await dd.documentLink(uid, 'request_file', file.id);
      if (!/^\/api\/dd\/documents\/dl\/[a-f0-9]{64}$/.test(result?.url)) throw new Error('The file did not open. Try again.');
      window.location.assign(result.url);
    } catch (e) {
      setError(e?.message || 'The file did not open. Try again.');
    } finally {
      setOpening(null);
    }
  };
  return (
    <Lightbox label={`Answer to ${request.title}`} title={request.title} sub={request.state} onClose={onClose} testId="deal-dd-answer-dialog">
      <div className="grid min-w-0 gap-3 px-5 py-4">
        {note && <p className="m-0 whitespace-pre-wrap break-words text-[13px] text-axal-ink dark:text-gray-100">{note}</p>}
        {link && <a className={`${BTN_S} w-fit`} href={link} target="_blank" rel="noopener noreferrer">Open the founder’s link</a>}
        {!note && !link && <p className={`m-0 ${SUB}`}>No written response was recorded.</p>}
        <h3 className={H3}>Files</h3>
        {files === null && <p className={`m-0 ${SUB}`}>Unreadable. The case could not load the files for this answer.</p>}
        {files?.length === 0 && <p className={`m-0 ${SUB}`}>No files attached.</p>}
        {files?.length > 0 && (
          <>
            <ul className="m-0 grid list-none gap-2 p-0">
              {files.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-[13px] text-axal-ink dark:text-gray-100">{file.name}</span>
                  <button type="button" aria-label={`Download ${file.name}`} className={BTN_S} onClick={() => download(file)}
                    disabled={opening !== null} data-testid={`deal-dd-answer-file-${file.id}`}>{opening === file.id ? 'Opening…' : 'Download'}</button>
                </li>
              ))}
            </ul>
            <p className={`m-0 ${SUB}`}>{LINK_LINE}</p>
            <Err text={error} />
          </>
        )}
      </div>
    </Lightbox>
  );
}

// ---------------------------------------------------------------- DL8, DL9 Documents and data room

export function DealDocuments({ deal }) {
  const [access, reloadAccess] = useRead(() => dealWorkroomApi.roomAccess(deal.id), [deal.id]);
  const projectUid = access.status === 'ready' && access.data?.granted ? access.data.project_uid : null;
  const [room, setRoom] = useState({ status: 'loading' });
  const loadRoom = () => {
    if (!projectUid) return;
    setRoom({ status: 'loading' });
    dealWorkroomApi.sharedRoom(projectUid).then((data) => setRoom({ status: 'ready', data })).catch((e) => { reportError('DealWork:room', e); setRoom({ status: 'unreadable' }); });
  };
  useEffect(loadRoom, [projectUid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [paper, reloadPaper] = useRead(() => api.esignList({ deal_id: deal.id }), [deal.id]);
  const st = roomStateOf(access, room);
  const listing = room.status === 'ready' ? roomListing(room.data) : null;
  const [dialog, setDialog] = useState(null); // 'ask' | 'nda'
  const [message, setMessage] = useState('');
  const [dl, setDl] = useState({}); // uid → { busy, err }
  const download = async (f) => {
    setDl((m) => ({ ...m, [f.uid]: { busy: true } }));
    try {
      const r = await api.dataRoomDownload(projectUid, f.uid);
      setDl((m) => ({ ...m, [f.uid]: {} }));
      if (r?.url && typeof window !== 'undefined') window.location.assign(r.url);
    } catch (e) { setDl((m) => ({ ...m, [f.uid]: { err: e?.message || 'The file did not open. Try again.' } })); }
  };
  const tone = { not_opened: 'off', behind_nda: 'wait', nda_pending: 'wait', nda_on_file: 'done', open: 'done' }[st.state];
  // D4815 DX10 (#5907): each state's label, so no two read alike.
  const pill = { not_opened: 'Not opened to you', behind_nda: 'NDA required', nda_pending: 'Waiting for signatures', nda_on_file: 'Open to you', open: 'Open to you' }[st.state];
  return (
    <div className="flex flex-col gap-3.5" data-testid="deal-documents">
      {st.state === 'loading' && <Card><Reading /></Card>}
      {/* D4815 DX10 (#5907) E: access that could not be confirmed is its own card, with Try again and never Ask
          for access. A room that could not be read after access was confirmed keeps the shared Unreadable. */}
      {st.state === 'unreadable' && access.status === 'unreadable' && (
        <section role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 p-4`} data-testid="deal-room-state-unreadable">
          <Pill tone="off">Unreadable</Pill>
          <p className="m-0 flex-1 text-[14px] font-bold text-axal-ink dark:text-gray-100">{st.line}</p>
          <button type="button" className={BTN_S} onClick={reloadAccess} data-testid="deal-room-retry">Try again</button>
          <span className={`${SUB} w-full`}>That is not a claim that the room is closed to you.</span>
        </section>
      )}
      {st.state === 'unreadable' && access.status !== 'unreadable' && <Unreadable what={st.what} claim="That is not a claim that the room is closed to you." onRetry={loadRoom} />}
      {tone && (
        <section className={`${CARD} flex flex-wrap items-center gap-2.5 p-4`} data-testid={`deal-room-state-${st.state}`}>
          <Pill tone={tone}>{pill}</Pill>
          <p className="m-0 flex-1 text-[14px] font-bold text-axal-ink dark:text-gray-100">{st.line}</p>
          {st.state === 'not_opened' && st.canAsk && <button type="button" className={BTN_S} onClick={() => setDialog('ask')} data-testid="deal-room-ask">Ask for access</button>}
          {st.state === 'behind_nda' && st.canSign && <button type="button" className={BTN_S} onClick={() => setDialog('nda')} data-testid="deal-room-nda">Sign NDA</button>}
          {st.state === 'nda_pending' && st.sub && <span className={`${SUB} w-full`} data-testid="deal-room-nda-pending">{st.sub}</span>}
        </section>
      )}
      {listing && <SharedRoomFiles key={projectUid} projectUid={projectUid} listing={listing} rawFiles={room.data?.files || []} withheld={st.withheld || 0} onDownload={download} downloads={dl} />}
      <div className="grid gap-3.5 md:grid-cols-2">
        <Card title="Deal paper" testId="deal-paper">
          <p className={`m-0 ${SUB}`}>The envelopes on this deal that you are party to.</p>
          {paper.status === 'loading' && <Reading />}
          {paper.status === 'unreadable' && <Unreadable what="The deal paper" claim="That is not a claim that nothing was sent." onRetry={reloadPaper} />}
          {paper.status === 'ready' && paperRows(paper.data?.envelopes).length === 0 && <p className={`m-0 ${SUB}`}>No envelope on this deal has been sent to you yet.</p>}
          {/* D6184 (#6184): each envelope with its signed count, Download once fully signed, and how to sign. */}
          {paper.status === 'ready' && paperRows(paper.data?.envelopes).map((p) => <DealPaperRow key={p.id} row={p} />)}
        </Card>
        {/* D6165 (#6165): the deck the venture granted you, in place of the old grey slot. */}
        <DealDeckCard dealId={deal.id} testId="deal-docs-deck" />
      </div>
      {dialog === 'ask' && (
        <ConfirmDialog testId="deal-room-ask-dialog" title={`Ask ${deal.project_name || 'the founder'} for data room access?`}
          sub="The founder decides. You’ll get a notice either way." act="Ask"
          check={() => (message.length > ASK_MAX ? `Keep the message to ${ASK_MAX.toLocaleString('en-US')} characters.` : null)}
          onConfirm={() => dealWorkroomApi.requestRoomAccess(deal.id, message.trim())}
          onClose={(changed) => { setDialog(null); if (changed) reloadAccess(); }}>
          <label className="flex flex-col gap-1.5">
            <span className={EYE}>Message · optional</span>
            <textarea rows={3} value={message} maxLength={ASK_MAX} onChange={(e) => setMessage(e.target.value)} className={FIELD} placeholder="Write a message…" />
          </label>
        </ConfirmDialog>
      )}
      {dialog === 'nda' && (
        <ConfirmDialog testId="deal-room-nda-dialog" title={`Sign the NDA with ${deal.project_name || 'the founder'}?`}
          sub="A three-way NDA between you, the founder and Axal VC. It unlocks the founder’s NDA files once every party has signed." act="Send it for signature"
          onConfirm={() => api.trustIntroRequest(access.data.founder_user_id)}
          done={(r) => (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">
                {r?.status === 'already_active' ? 'An NDA with this founder is already on file.' : 'The NDA is out for signature. The founder and Axal VC get their links by email.'}
              </p>
              {r?.signing_url && <a href={r.signing_url} className={`${BTN_P} w-fit`}>Review and sign</a>}
            </div>
          )}
          onClose={(changed) => { setDialog(null); if (changed) { reloadAccess(); loadRoom(); } }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- DL10 Terms

export function DealTerms({ deal, investor }) {
  const rows = proposedTerms(deal);
  // D6195: the investor's own route preference, read from their commitment under the firm selected now.
  const firmId = useActiveCompany()?.company?.id ?? null;
  const [mineRead, reloadMine] = useRead(() => (investor ? api.dealCommitments(deal.id) : Promise.resolve([])), [deal.id, firmId, investor]);
  const pref = termsPreference(myCommitment(mineRead.status === 'ready' ? { status: 'ready', dealId: deal.id, items: Array.isArray(mineRead.data) ? mineRead.data : [] } : mineRead, deal.currency || 'USD', deal.id));
  return (
    <div className="grid gap-3.5 md:grid-cols-2" data-testid="deal-terms">
      <Card title="Proposed terms" testId="deal-terms-proposed">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid={`deal-term-${r.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <span className="flex flex-col"><span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.label}</span><span className="text-[11.5px] text-axal-muted dark:text-gray-400">{r.source}</span></span>
            <span className={`font-mono text-[12.5px] font-bold ${r.missing ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{r.value}</span>
          </div>
        ))}
      </Card>
      <div className="flex flex-col gap-3.5">
        <Slot slot={LEGAL_SLOT} testId="deal-terms-legal" />
        <p className={`m-0 ${SUB}`}>Your line and review-and-sign are in the closing room. <Link to={tabHref(deal.id, 'closing')} className="font-bold text-axal-violet-deep underline dark:text-violet-300">Open the closing room</Link></p>
        {/* D1027 (#2864): the investor's read-only Cap table panel (CT15), at the level the founder shares. */}
        {investor
          ? <InvestorCapTablePanel projectId={deal.project_id} venture={deal.project_name} testId="deal-terms-captable" />
          : <Slot slot={CAP_TABLE_SLOT} testId="deal-terms-captable" />}
      </div>
      {investor && (
        <section className="flex flex-col gap-2.5 md:col-span-2" data-testid="deal-terms-routes">
          <h3 className={H3}>How you invest</h3>
          <div className="grid gap-2.5 md:grid-cols-3">
            {ROUTES.map((r) => {
              const chosen = pref.key === r.key;
              return (
                <div key={r.key} className={`${CARD} flex flex-col gap-1 p-3.5 ${chosen ? 'border-2 border-axal-violet dark:border-violet-400' : ''}`} data-testid={`deal-terms-route-${r.key}`} data-chosen={chosen ? 'true' : undefined}>
                  <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{r.title}</span>
                  <span className={SUB}>{r.line}</span>
                  {chosen && <span className="text-[11.5px] font-bold uppercase tracking-wide text-axal-violet-deep dark:text-violet-300">✓ Your preference</span>}
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-1" data-testid="deal-terms-preference" data-state={pref.state}>
            {pref.state === 'loading' && <Reading />}
            {pref.state === 'ready' && <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">Your preference: {pref.line}</p>}
            {(pref.state === 'none' || pref.state === 'unreadable') && <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{pref.line}</p>}
            {pref.state === 'unreadable' && <button type="button" className={`${BTN_S} w-fit`} onClick={() => reloadMine()}>Try again</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{ROUTE_NOTE}</p>
            <Link to={tabHref(deal.id, 'closing')} className={BTN_S}>Continue to signing</Link>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- DL11–DL13 Commitment and closing

export function DealCommitment({ deal, user, onChangeAmount, onShare }) {
  const currency = deal.currency || 'USD';
  // D752 (#1891): an investor on HQ shares a proof of funds from their own commitment.
  const own = useProofTargets({ enabled: showsProof(user) });
  const [mine, setMine] = useState({ status: 'loading' });
  // D4633: the read is for this deal under the firm selected now. A switch of
  // either reads again; an answer for an earlier deal or firm lands nowhere.
  const firmId = useActiveCompany()?.company?.id ?? null;
  const mineSerial = useRef(0);
  useEffect(() => () => { mineSerial.current += 1; }, []);
  const loadMine = () => {
    const serial = ++mineSerial.current;
    const dealId = deal.id;
    setMine({ status: 'loading' });
    api.dealCommitments(dealId).then((d) => { if (mineSerial.current === serial) setMine({ status: 'ready', dealId, items: Array.isArray(d) ? d : [] }); })
      .catch((e) => { reportError('DealWork:commitments', e); if (mineSerial.current === serial) setMine({ status: 'unreadable', dealId }); });
  };
  useEffect(loadMine, [deal.id, firmId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [round, reloadRound] = useRead(() => dealWorkroomApi.round(deal.id), [deal.id]);
  const c = myCommitment(mine, currency, deal.id);
  const r = roundLines(round, deal);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="grid gap-3.5 md:grid-cols-2" data-testid="deal-commitment">
      <Card title="Your commitment" testId="deal-my-commitment">
        {c.state === 'loading' && <Reading />}
        {c.state === 'unreadable' && <Unreadable what="Your commitment" claim="That is not a claim that you have none." onRetry={loadMine} />}
        {c.state === 'none' && (
          <>
            <p className={`m-0 ${SUB}`}>You have not committed to this deal. Committing records your intent; no money moves.</p>
            {/* D6191: Commit is offered only on an open deal; otherwise the tab says why. */}
            {deal.status === 'active'
              ? <button type="button" className={`${BTN_P} w-fit`} onClick={() => onChangeAmount?.(null)} data-testid="deal-commit-open">Commit</button>
              : <p className={`m-0 ${SUB}`} data-testid="deal-commit-closed">{closedReason(deal)}</p>}
          </>
        )}
        {c.state === 'ready' && (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[22px] font-bold text-axal-ink dark:text-gray-100" data-testid="deal-my-amount">{c.amount}</span>
              <Pill tone={c.confirmed ? 'done' : 'wait'}>{c.status}</Pill>
              <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{c.recorded}</span>
            </div>
            {c.firm && <p className={`m-0 ${SUB}`} data-testid="deal-my-firm">{c.firm}</p>}
            {/* D6195: the route preference, a preference only; Change amount (while Pending) changes it too. */}
            <div className="flex flex-col gap-0.5" data-testid="deal-my-route-preference">
              <span className={EYE}>How you would like to invest</span>
              <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{preferenceLine(c.preference)}</p>
              <span className={SUB}>{ROUTE_NOTE}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className={EYE}>Your note</span>
              <p className="m-0 whitespace-pre-line text-[13px] text-axal-ink dark:text-gray-100">{c.note || 'No note recorded.'}</p>
              {c.note && <span className={SUB}>{NOTE_READERS}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {!c.confirmed && deal.status === 'active' && <button type="button" className={BTN_S} onClick={() => onChangeAmount?.(c.row)} data-testid="deal-change-amount">Change amount</button>}
              <button type="button" className={`${BTN_S} text-axal-destructive dark:text-red-300`} onClick={() => setWithdrawing(true)} data-testid="deal-withdraw">Withdraw</button>
            </div>
            {c.confirmed && <p className={`m-0 ${SUB}`}>A confirmed commitment changes only by withdrawing it and committing again.</p>}
            {!c.confirmed && deal.status !== 'active' && <p className={`m-0 ${SUB}`} data-testid="deal-commit-closed">{closedReason(deal)}</p>}
            {own.status === 'ready' && <ProofDoor target={ownDealTarget(own.read, c.row, user)} onShare={(t) => onShare?.(t, own.read)} />}
          </>
        )}
        {c.history?.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700">
            <span className={EYE}>Earlier</span>
            {c.history.map((h) => <span key={h.uid} className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{h.line}</span>)}
          </div>
        )}
      </Card>
      <div data-testid="deal-mercury"><FromMercury section="commit" /></div>
      <section className="flex flex-col gap-2 rounded-axal-lg border border-dashed border-axal-muted bg-axal-ground p-4 md:col-span-2 dark:border-gray-600 dark:bg-gray-800/60" data-testid="deal-closing-slot">
        <span className={EYE}>Closing room</span>
        <h3 className={H3}>Closing</h3>
        <p className={`m-0 ${SUB}`}>Paper, signing, the route, payment, the receipt, the cap table and reporting are in the closing room. A wire matched from your Mercury is accepted there, and reads Sent until the receiving side confirms it.</p>
        <Link to={tabHref(deal.id, 'closing')} className={`${BTN_S} w-fit`} data-testid="deal-closing-door">Open the closing room</Link>
      </section>
      <Card title="The round" testId="deal-round">
        {r.state === 'loading' && <Reading />}
        {r.state === 'unreadable' && <Unreadable what="The round" claim="That is not a claim that nobody has committed." onRetry={reloadRound} />}
        {r.state === 'ready' && (
          <>
            <p className="m-0 font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="deal-round-total">{r.confirmed}</p>
            {r.pct != null && <Bar pct={r.pct} />}
            {r.pending && <p className={`m-0 ${SUB}`}>{r.pending}</p>}
            <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="deal-round-count">{r.investors}</p>
            <p className={`m-0 ${SUB}`}>{r.privacy}</p>
          </>
        )}
      </Card>
      <section className="flex flex-col gap-2 md:col-span-2" data-testid="deal-syndicates">
        <p className={`m-0 ${SUB}`}>{SYNDICATES_LINE}</p>
        <DealSyndicates projectId={deal.project_id} user={user} />
      </section>
      {withdrawing && c.state === 'ready' && (
        <ConfirmDialog testId="deal-withdraw-dialog" title={`Withdraw your ${c.amount} commitment?`} danger act="Withdraw"
          sub="Your commitment stops counting toward the round. Your reason is kept with the withdrawal in the studio’s record."
          check={() => withdrawError(reason)}
          onConfirm={() => dealWorkroomApi.withdraw(deal.id, c.uid, reason.trim())}
          onClose={(changed) => { setWithdrawing(false); setReason(''); if (changed) { loadMine(); reloadRound(); } }}>
          <label className="flex flex-col gap-1.5">
            <span className={EYE}>Reason · required</span>
            <textarea rows={3} value={reason} maxLength={WITHDRAW_MAX} onChange={(e) => setReason(e.target.value)} className={FIELD} placeholder="Write a reason…" data-testid="deal-withdraw-reason" />
            <span className={SUB}>{reason.length} / {WITHDRAW_MAX}</span>
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

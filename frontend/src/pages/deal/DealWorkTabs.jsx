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
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionPrimary, actionGhost, actionDanger } from '../../ui';
import { api, dd } from '../../lib/api';
import { dealWorkroomApi } from '../../lib/api/dealWorkroom';
import { reportError } from '../../lib/log';
import DealReferencesTab from '../../components/deals/DealReferencesTab';
import DealSyndicates from '../../components/deals/DealSyndicates';
import FromMercury from '../investor/FromMercury';
import { tabHref } from '../dealPageModel';
import { CARD, EYE, SUB, H3, BTN_S, BTN_P } from './DealFrame';
import { Slot } from './DealOverview';
import InvestorCapTablePanel from '../raise/captable/InvestorCapTablePanel';
import { DECK_SLOT } from './dealFrameModel';
import {
  ASK_MAX, CAP_TABLE_SLOT, LEGAL_SLOT, NOTE_READERS, QUESTIONS_SLOT, ROUTES, ROUTE_NOTE, SYNDICATES_LINE, WITHDRAW_MAX,
  caseCard, caseForDeal, myCommitment, paperRows, proposedTerms, requestRows, roomListing, roomStateOf, roundLines, withdrawError,
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
  const run = () => {
    setRead({ status: 'loading' });
    load().then((data) => setRead({ status: 'ready', data })).catch((e) => { reportError('DealWork:read', e); setRead({ status: 'unreadable', error: e }); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  return [read, run];
}

/** Ask, then act: the dialog every change on these tabs opens first. */
function ConfirmDialog({ title, sub, act, danger = false, onConfirm, onClose, testId, check, children, done }) {
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
    <Lightbox label={title} title={title} sub={sub} onClose={() => onClose(Boolean(result))} testId={testId}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {result
            ? <button type="button" className={actionPrimary} onClick={() => onClose(true)} data-testid={`${testId}-done`}>Done</button>
            : (<>
              <button type="button" className={actionGhost} onClick={() => onClose(false)}>Back</button>
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
  const [list, reloadList] = useRead(() => dd.listCases({ subject_type: 'project' }), [deal.project_id]);
  const found = caseForDeal(list, deal.project_id);
  const uid = found.state === 'ready' ? found.row.uid : null;
  const [detail, setDetail] = useState({ status: 'idle' });
  const loadDetail = () => {
    if (!uid) return;
    setDetail({ status: 'loading' });
    dd.getCase(uid).then((data) => setDetail({ status: 'ready', data })).catch((e) => { reportError('DealWork:case', e); setDetail({ status: 'unreadable' }); });
  };
  useEffect(loadDetail, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [opening, setOpening] = useState(false);
  const data = detail.status === 'ready' ? detail.data : null;
  const card = found.state === 'ready' ? caseCard(found.row, data, userId) : null;
  // A section reviewer who neither opened nor leads the case gets no requests from the Worker (owner material).
  const owns = found.state === 'ready' && [found.row.owner_user_id, found.row.lead_user_id].some((u) => Number(u) === Number(userId));
  const requests = data ? requestRows(data) : [];
  return (
    <div className="grid gap-3.5 md:grid-cols-2" data-testid="deal-diligence">
      {found.state === 'loading' && <Card title="Diligence case"><Reading /></Card>}
      {found.state === 'unreadable' && <Unreadable what="Your diligence cases" claim="That is not a claim that no case exists." onRetry={reloadList} />}
      {(found.state === 'none' || found.state === 'not_in_read') && (
        <section className={`${CARD} flex flex-col items-start gap-2 p-5 md:col-span-2`} data-testid="deal-dd-none">
          <span aria-hidden="true" className="text-[18px] text-axal-muted dark:text-gray-400">○</span>
          <h3 className={H3}>No diligence case on this company yet.</h3>
          <p className={`m-0 ${SUB}`}>{found.line || 'A case holds the checklist, the requests to the founder and the risk band.'}</p>
          <button type="button" className={BTN_S} onClick={() => setOpening(true)} data-testid="deal-dd-open">Open a diligence case</button>
        </section>
      )}
      {card && (
        <Card eye="Diligence case" title={card.title} testId="deal-dd-case">
          <div className="flex flex-wrap gap-1.5"><Pill tone="wait">{card.stage}</Pill><Pill tone="off">{card.risk}</Pill></div>
          <p className="m-0 font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100">{card.items.line}</p>
          {card.items.pct != null && <Bar pct={card.items.pct} />}
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{card.flags}</p>
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{card.opened}</p>
          {detail.status === 'unreadable' && <Unreadable what="The case’s sections and requests" onRetry={loadDetail} />}
          {card.yours?.map((s) => <p key={s.title} className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Your section: {s.title} <Pill tone="now">{s.status}</Pill></p>)}
          <Link to={card.href} className={`${BTN_S} w-fit`} data-testid="deal-dd-door">Open the case</Link>
          <p className={`m-0 ${SUB}`}>The case lives on its own page.</p>
        </Card>
      )}
      {card && (
        <Card title="Requests to the founder" testId="deal-dd-requests"
          meta={data ? <span className="font-mono text-[12px] font-bold text-axal-amber-deep dark:text-amber-300">{requests.filter((r) => r.tone === 'wait').length} waiting</span> : null}>
          {detail.status === 'loading' && <Reading />}
          {detail.status === 'unreadable' && <Unreadable what="The requests" claim="That is not a claim that none was sent." onRetry={loadDetail} />}
          {data && !owns && <p className={`m-0 ${SUB}`}>The requests are the case owner’s: you review a section of this case.</p>}
          {data && owns && requests.length === 0 && <p className={`m-0 ${SUB}`}>No requests have been sent to the founder on this case.</p>}
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
              <Pill tone={r.tone}>{r.state}</Pill>
            </div>
          ))}
        </Card>
      )}
      <div className="md:col-span-1"><DealReferencesTab dealId={deal.id} /></div>
      <Slot slot={QUESTIONS_SLOT} testId="deal-dd-questions" />
      {opening && (
        <ConfirmDialog testId="deal-dd-open-dialog" title={`Open a diligence case on ${deal.project_name || 'this company'}?`}
          sub="A case is yours: it holds the standard checklist, the requests you send the founder and the risk band. The founder sees a request only when you send one."
          act="Open the case"
          onConfirm={() => dd.openCase({ subject_type: 'project', subject_id: deal.project_id, subject_label: deal.project_name || `Deal #${deal.id}`, template_depth: 'standard' })}
          onClose={(changed) => { setOpening(false); if (changed) reloadList(); }} />
      )}
    </div>
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
  const [folder, setFolder] = useState('');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState(null); // 'ask' | 'nda'
  const [message, setMessage] = useState('');
  const [dl, setDl] = useState({}); // uid → { busy, err }
  const files = useMemo(() => (listing?.files || []).filter((f) => (!folder || f.folder_uid === folder) && (!q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()))), [listing, folder, q]);
  const download = async (f) => {
    setDl((m) => ({ ...m, [f.uid]: { busy: true } }));
    try {
      const r = await api.dataRoomDownload(projectUid, f.uid);
      setDl((m) => ({ ...m, [f.uid]: {} }));
      if (r?.url && typeof window !== 'undefined') window.location.assign(r.url);
    } catch (e) { setDl((m) => ({ ...m, [f.uid]: { err: e?.message || 'The file did not open. Try again.' } })); }
  };
  const tone = { not_opened: 'off', behind_nda: 'wait', nda_on_file: 'done', open: 'done' }[st.state];
  return (
    <div className="flex flex-col gap-3.5" data-testid="deal-documents">
      {st.state === 'loading' && <Card><Reading /></Card>}
      {st.state === 'unreadable' && <Unreadable what={st.what} claim="That is not a claim that the room is closed to you." onRetry={access.status === 'unreadable' ? reloadAccess : loadRoom} />}
      {tone && (
        <section className={`${CARD} flex flex-wrap items-center gap-2.5 p-4`} data-testid={`deal-room-state-${st.state}`}>
          <Pill tone={tone}>{st.state === 'not_opened' ? 'Not opened to you' : st.state === 'behind_nda' ? 'Behind an NDA' : 'Open to you'}</Pill>
          <p className="m-0 flex-1 text-[14px] font-bold text-axal-ink dark:text-gray-100">{st.line}</p>
          {st.state === 'not_opened' && st.canAsk && <button type="button" className={BTN_S} onClick={() => setDialog('ask')} data-testid="deal-room-ask">Ask for access</button>}
          {st.state === 'behind_nda' && st.canSign && <button type="button" className={BTN_S} onClick={() => setDialog('nda')} data-testid="deal-room-nda">Sign the NDA</button>}
          {st.state === 'behind_nda' && st.ndaPending && <span className={SUB}>The NDA is out for signature. The files open once every party has signed.</span>}
        </section>
      )}
      {listing && (
        <div className="grid gap-3.5 md:grid-cols-[240px_minmax(0,1fr)]">
          <Card eye="Folders" testId="deal-room-folders">
            <button type="button" onClick={() => setFolder('')} className={`flex items-center justify-between rounded-axal-sm px-2 py-1.5 text-left text-[13px] ${folder === '' ? 'bg-axal-lavender font-extrabold text-axal-violet-deep dark:bg-violet-950 dark:text-violet-300' : 'font-semibold text-axal-ink dark:text-gray-100'}`}>
              <span>All files</span><span className="font-mono text-[12px]">{listing.files.length}</span>
            </button>
            {listing.folders.map((f) => (
              <button key={f.uid} type="button" onClick={() => setFolder(f.uid)} className={`flex items-center justify-between rounded-axal-sm px-2 py-1.5 text-left text-[13px] ${folder === f.uid ? 'bg-axal-lavender font-extrabold text-axal-violet-deep dark:bg-violet-950 dark:text-violet-300' : 'font-semibold text-axal-ink dark:text-gray-100'}`}>
                <span>{f.name}</span><span className="font-mono text-[12px]">{f.count}</span>
              </button>
            ))}
            {st.withheld > 0 && (
              <p className="m-0 border-t border-axal-hairline px-2 pt-2 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="deal-room-withheld">
                {st.withheld} file{st.withheld === 1 ? ' needs' : 's need'} your NDA
                <span className={`block font-normal ${SUB}`}>Their names show once you sign.</span>
              </p>
            )}
          </Card>
          <Card title={`Files · ${files.length}`} testId="deal-room-files">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" aria-label="Search files" className={FIELD} />
            {files.length === 0 && <p className={`m-0 ${SUB}`}>{listing.files.length === 0 ? 'No file here is open to you yet.' : 'No file matches.'}</p>}
            {files.map((f) => (
              <div key={f.uid} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid="deal-room-file">
                <span className="min-w-0 flex-1 text-[13px] font-bold text-axal-ink dark:text-gray-100">{f.name}</span>
                <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{f.size} · {f.added}</span>
                <button type="button" className="text-[12.5px] font-bold text-axal-violet-deep underline dark:text-violet-300" disabled={dl[f.uid]?.busy} onClick={() => download(f)}>Open</button>
                <Err text={dl[f.uid]?.err} />
              </div>
            ))}
            <p className={`m-0 ${SUB}`}>Each download is a one-time link and is logged. The founder sees who opened what.</p>
          </Card>
        </div>
      )}
      <div className="grid gap-3.5 md:grid-cols-2">
        <Card title="Deal paper" testId="deal-paper">
          <p className={`m-0 ${SUB}`}>The envelopes on this deal that you are party to.</p>
          {paper.status === 'loading' && <Reading />}
          {paper.status === 'unreadable' && <Unreadable what="The deal paper" claim="That is not a claim that nothing was sent." onRetry={reloadPaper} />}
          {paper.status === 'ready' && paperRows(paper.data?.envelopes).length === 0 && <p className={`m-0 ${SUB}`}>No envelope on this deal has been sent to you yet.</p>}
          {paper.status === 'ready' && paperRows(paper.data?.envelopes).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{p.title}</span><Pill tone={p.tone}>{p.state}</Pill>
            </div>
          ))}
        </Card>
        <Slot slot={DECK_SLOT} testId="deal-docs-deck" />
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
            {ROUTES.map((r) => (
              <div key={r.key} className={`${CARD} flex flex-col gap-1 p-3.5`}>
                <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{r.title}</span>
                <span className={SUB}>{r.line}</span>
              </div>
            ))}
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

export function DealCommitment({ deal, user, onChangeAmount }) {
  const currency = deal.currency || 'USD';
  const [mine, setMine] = useState({ status: 'loading' });
  const loadMine = () => {
    setMine({ status: 'loading' });
    api.dealCommitments(deal.id).then((d) => setMine({ status: 'ready', items: Array.isArray(d) ? d : [] }))
      .catch((e) => { reportError('DealWork:commitments', e); setMine({ status: 'unreadable' }); });
  };
  useEffect(loadMine, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [round, reloadRound] = useRead(() => dealWorkroomApi.round(deal.id), [deal.id]);
  const c = myCommitment(mine, currency);
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
            <button type="button" className={`${BTN_P} w-fit`} onClick={onChangeAmount} data-testid="deal-commit-open">Commit</button>
          </>
        )}
        {c.state === 'ready' && (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[22px] font-bold text-axal-ink dark:text-gray-100" data-testid="deal-my-amount">{c.amount}</span>
              <Pill tone={c.confirmed ? 'done' : 'wait'}>{c.status}</Pill>
              <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{c.recorded}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className={EYE}>Your note</span>
              <p className="m-0 whitespace-pre-line text-[13px] text-axal-ink dark:text-gray-100">{c.note || 'No note recorded.'}</p>
              {c.note && <span className={SUB}>{NOTE_READERS}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {!c.confirmed && <button type="button" className={BTN_S} onClick={onChangeAmount} data-testid="deal-change-amount">Change amount</button>}
              <button type="button" className={`${BTN_S} text-axal-destructive dark:text-red-300`} onClick={() => setWithdrawing(true)} data-testid="deal-withdraw">Withdraw</button>
            </div>
            {c.confirmed && <p className={`m-0 ${SUB}`}>A confirmed commitment changes only by withdrawing it and committing again.</p>}
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

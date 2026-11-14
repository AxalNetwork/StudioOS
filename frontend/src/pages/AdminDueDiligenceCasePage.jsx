/**
 * One Due diligence case (DDL3–DDL11, D1251 #3266), mounted at both
 * `/admin/due-diligence/:uid/:tab?` and `/due-diligence/:uid/:tab?`. Each tab
 * is its own address (D1244); the bare case address, which emails and
 * notices carry, opens Overview. A section reviewer's read (`case.scoped`)
 * draws RT's four tabs. Every control is one the case read's `allowed`
 * returns; every change is an in-page dialog, and what changed is said on the
 * page when it closes — no browser pop-up and no toast.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { dd } from '../lib/api';
import { ddDeskApi } from '../lib/api/ddDesk.js';
import { ddLifecycleApi } from '../lib/api/ddLifecycle.js';
import { reportError } from '../lib/log';
import { useAuth } from '../hooks/useAuthSync';
import AdminBoardFrame from './admin/AdminBoardFrame';
import { DdCaseTabs } from './duediligence/DdTabs';
import { viewOf } from './duediligence/ddModel';
import { ITEM_STATUS_WORD, WHO, caseRefusal, headerFacts, may, tabOpen, tabsFor } from './duediligence/ddCaseModel.js';
import DdReviewerPanel from './duediligence/DdReviewer';
import { ActivityTab, ChecklistTab, FlagsTab, OverviewTab, Who } from './duediligence/DdCaseWork.jsx';
import { CrossChecksTab, DocumentsTab, RequestsTab, SignOffTab, TeamTab } from './duediligence/DdCaseDeal.jsx';
import {
  AssignDialog, BulkDialog, ComposeDialog, ConfirmDialog, DecisionDialog, FlagDialog, NotifyFounderDialog, RaiseFlagDialog,
  ReportDialog, RequestDueDialog, VerdictDialog, WidenDialog, WithdrawDialog,
} from './duediligence/DdCaseDialogs.jsx';
import { ArchiveDialog, ChangeLeadDialog, TargetDateDialog } from './duediligence/DdListDialogs.jsx';
import { Note, Refusal, btnCls, muted, primaryCls } from './duediligence/DdUi.jsx';

/** The open dialog, by name; `props` are what the tab handed it. */
function CaseDialog({ uid, data, me, dialog, close, done }) {
  const { name, props = {} } = dialog;
  const cs = data.case;
  const row = { uid, subject_label: cs.subject_label, lead_name: cs.lead_name, target_ic_date: cs.target_ic_date, decision: cs.decision };
  const common = { uid, onClose: close, onDone: (line) => { props.after?.(); done(line); } };
  switch (name) {
    case 'verdict': {
      const s = props.section;
      const ndaOnFile = (data.attachments || []).some((a) => Number(a.section_id) === Number(s.id)) || Boolean(s.reviewer_signed_nda_at);
      return <VerdictDialog {...common} section={s} ndaOnFile={ndaOnFile} />;
    }
    case 'raise': return <RaiseFlagDialog {...common} data={data} sectionId={props.sectionId} itemId={props.itemId} />;
    case 'flag': return <FlagDialog {...common} data={data} flag={props.flag} />;
    case 'decide': return <DecisionDialog {...common} data={data} />;
    case 'archive': return <ArchiveDialog row={row} onClose={close} onDone={done} />;
    case 'lead': return <ChangeLeadDialog row={row} me={me} onClose={close} onDone={done} />;
    case 'target': return <TargetDateDialog row={row} onClose={close} onDone={done} />;
    case 'notify': return <NotifyFounderDialog {...common} subject={cs.subject_label} />;
    case 'report':
      // Generate report: the Worker assembles it from the recorded sections and findings; no model writes it.
      return <ReportDialog {...common} generate={async () => { const r = await dd.generateReport(uid); return r; }} />;
    case 'widen': return <WidenDialog {...common} depth={cs.template_depth} />;
    case 'compose': return <ComposeDialog {...common} data={data} />;
    case 'assign': return <AssignDialog {...common} data={data} sectionId={props.sectionId} />;
    case 'bulk': return <BulkDialog {...common} data={data} kind={props.kind} itemIds={props.itemIds} />;
    case 'req-due': return <RequestDueDialog {...common} req={props.req} />;
    case 'req-withdraw': return <WithdrawDialog {...common} req={props.req} />;
    case 'req-review':
      return <ConfirmDialog {...common} title={`Mark “${props.req.title}” reviewed`} testId="dd-req-review" action="Mark reviewed"
        lines={['The request is closed out. The subject sees it as reviewed.']} run={() => dd.reviewRequest(uid, props.req.id)}
        fallback="The request could not be marked reviewed." done={`“${props.req.title}” is reviewed.`} />;
    case 'req-remind':
      return <ConfirmDialog {...common} title={`Remind the subject · ${props.req.title}`} testId="dd-req-remind" action="Send reminder"
        lines={['The subject is reminded in the bell and by email. One reminder a day at most.']} run={() => dd.remindRequest(uid, props.req.id)}
        fallback="The reminder could not be sent." done="The reminder is sent." />;
    case 'resend':
      return <ConfirmDialog {...common} title={`Resend the invitation to ${props.row.name}`} testId="dd-resend" action="Resend invitation"
        lines={[`${props.row.name} is sent a new link to ${props.row.section}, in the bell and by email. It works for 14 days.`]}
        run={() => ddDeskApi.assign(uid, props.row.sectionId, props.row.userId, props.row.role === 'Observer' ? 'observer' : 'reviewer')}
        fallback="The invitation could not be sent." done={`A new invitation is sent to ${props.row.name}.`} />;
    case 'remove':
      return <ConfirmDialog {...common} title={`Remove ${props.row.name} from ${props.row.section}`} testId="dd-remove" action="Remove" danger
        lines={[`${props.row.name} can no longer open this section. What they recorded stays on the case.`]}
        run={() => ddDeskApi.removeReviewer(uid, props.row.sectionId, props.row.userId)}
        fallback="They could not be removed." done={`${props.row.name} is removed from ${props.row.section}.`} />;
    case 'item':
      return <ConfirmDialog {...common} title={`Mark “${props.item.title}” ${ITEM_STATUS_WORD[props.status]}`} testId="dd-item-status" action={`Mark ${ITEM_STATUS_WORD[props.status]}`}
        lines={[props.status === 'pending' ? 'The item goes back to Pending and counts as not worked.' : 'The section’s progress and the case’s score are worked out again.', 'The change is recorded in the case’s activity.']}
        run={() => dd.updateItem(uid, props.item.id, { status: props.status })} fallback="The item could not be changed." done={`“${props.item.title}” is ${ITEM_STATUS_WORD[props.status]}.`} />;
    case 'memo':
      return <ConfirmDialog {...common} title="Save the memo" testId="dd-memo-confirm" action="Save memo"
        lines={['The four parts replace the memo saved on the case. It is kept encrypted, and the deal team reads it; section reviewers never do.']}
        run={() => ddLifecycleApi.saveMemo(uid, props.draft)} fallback="The memo could not be saved." done="The memo is saved." />;
    case 'ic':
      return <ConfirmDialog {...common} title="Send the case to IC" testId="dd-ic" action="Send to IC"
        lines={['A new IC record is opened with this case, its decision and its memo attached.', 'The case can be sent once.']}
        run={() => ddLifecycleApi.sendToIc(uid)} fallback="The case could not be sent to IC." done="The case is with IC." />;
    case 'scan':
      return <ConfirmDialog {...common} title="Run the external scan" testId="dd-scan" action="Run scan"
        lines={['Each connector is queried for the subject. What it finds is raised as a flag on its section.', 'High and Critical findings are sent to the case owner.']}
        run={() => dd.scan(uid)} fallback="The scan could not be queued." done="The scan is queued; its results appear here as each source answers." />;
    default: return null;
  }
}

function AdminDueDiligenceCasePageBody() {
  const { uid } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const auth = useAuth();
  // Task #83 — mounted at both /admin/due-diligence/:uid and /due-diligence/:uid.
  const base = location.pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';
  // D1244 (#2385): each tab is its own address; the bare case address is Overview.
  const { caseTab } = viewOf(location.pathname);
  const inv = searchParams.get('inv');
  const focusSection = searchParams.get('section');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [inviteState, setInviteState] = useState(null);
  const [version, setVersion] = useState(0);
  const sectionRefs = useRef({});
  const inviteConsumedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await dd.getCase(uid);
      setData(r);
      setFailed(null);
    } catch (e) {
      reportError('AdminDueDiligenceCasePage:get', e);
      setFailed(e?.status === 404 ? 'missing' : caseRefusal(e, 'The case could not be read.'));
    } finally { setLoading(false); }
  }, [uid]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  // Consume the magic-link invite jti once: the Worker records the acceptance
  // and answers the section this reviewer was invited to.
  useEffect(() => {
    if (!inv || inviteConsumedRef.current) return;
    inviteConsumedRef.current = true;
    (async () => {
      try {
        const r = await dd.acceptInvite(uid, inv);
        setInviteState({ ok: true, sectionId: r.section_id });
        const next = new URLSearchParams(searchParams);
        next.delete('inv');
        if (r.section_id) next.set('section', String(r.section_id));
        setSearchParams(next, { replace: true });
        load();
      } catch (e) {
        setInviteState({ ok: false, text: caseRefusal(e, 'This invitation has expired or was withdrawn. Ask the case lead for a new one.') });
      }
    })();
  }, [inv, uid, searchParams, setSearchParams, load]);

  // Bring the focused section into view once the case is read.
  useEffect(() => {
    if (!focusSection || !data || caseTab !== 'overview') return;
    sectionRefs.current[focusSection]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [focusSection, data, caseTab]);

  // Read again while a source is queued or running.
  const scanning = Boolean(data && (data.sources || []).some((s) => s.status === 'queued' || s.status === 'running'));
  useEffect(() => {
    if (!scanning) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [scanning, load]);

  const open = (name, props) => { setNotice(null); setDialog({ name, props }); };
  const done = (line) => { setDialog(null); setNotice(line); setVersion((v) => v + 1); load(); };

  if (loading) return <p className={`py-20 text-center text-[13px] ${muted}`}>Reading the case…</p>;
  if (!data) {
    return (
      <div className="flex flex-col items-center gap-2 py-20" data-testid="dd-case-unreadable">
        <p className="m-0 text-[13px]">{failed === 'missing' ? 'This case does not exist, or you are not on it.' : failed}</p>
        {failed !== 'missing' ? <button type="button" className={btnCls} onClick={() => { setLoading(true); load(); }}>Try again</button> : null}
        <Link to={base} className="text-[13px] font-semibold text-violet-700 underline dark:text-violet-300">All cases</Link>
      </div>
    );
  }

  const cs = data.case;
  const facts = headerFacts(cs);
  const tabs = tabsFor(data);
  const tabProps = { uid, data, open, onChanged: load, onRetry: load, version };
  const body = !tabOpen(data, caseTab) ? (
    <Note testId="dd-tab-deal-team">This tab is the deal team’s. <Link to={`${base}/${uid}`} className="font-semibold underline">Open Overview</Link></Note>
  ) : {
    overview: <OverviewTab {...tabProps} focusSection={focusSection || inviteState?.sectionId} sectionRefs={sectionRefs} />,
    checklist: <ChecklistTab {...tabProps} />,
    flags: <FlagsTab {...tabProps} />,
    requests: <RequestsTab {...tabProps} />,
    documents: <DocumentsTab {...tabProps} />,
    'cross-checks': <CrossChecksTab {...tabProps} scanning={scanning} />,
    team: <TeamTab {...tabProps} />,
    'sign-off': <SignOffTab {...tabProps} />,
    activity: <ActivityTab {...tabProps} />,
  }[caseTab];

  return (
    <div>
      <Link to={base} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
        <ArrowLeft size={14} aria-hidden="true" /> All cases
      </Link>

      {inviteState && !inviteState.ok ? <div className="mb-4"><Refusal text={inviteState.text} testId="dd-invite-refused" /></div> : null}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4" data-testid="dd-case-header">
        <div className="min-w-0">
          <h1 className="m-0 text-[24px] font-bold text-gray-900 dark:text-gray-100">{cs.subject_label}</h1>
          <p className={`m-0 mt-1 text-[13px] ${muted}`} data-testid="dd-case-facts">
            {facts.type} · {facts.template} · {facts.stage} · <span className="font-mono">{cs.uid}</span>
          </p>
          <p className={`m-0 mt-0.5 text-[13px] ${muted}`}>
            Lead {facts.lead} · Opened {facts.opened} · Target IC <span className={facts.targetPast ? 'font-semibold text-amber-800 dark:text-amber-200' : ''}>{facts.target}{facts.targetSub ? ` (${facts.targetSub})` : ''}</span>
            {may(data, 'update') ? <> · <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => open('target')} data-testid="dd-target-open">Change date</button></> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {may(data, 'decide') && !cs.decision ? <button type="button" className={primaryCls} onClick={() => open('decide')} data-testid="dd-header-decide">Record decision</button> : null}
          {cs.status === 'archived' ? <Who text={WHO.archived} testId="dd-who-archived" /> : null}
          <button type="button" className={btnCls} onClick={load} aria-label="Read the case again"><RefreshCw size={14} aria-hidden="true" /></button>
        </div>
      </header>

      {notice ? <div className="mb-4" role="status"><Note testId="dd-case-notice">{notice}</Note></div> : null}

      {/* D1252 (#3267, DDL12b): a section reviewer's banner and steps; nothing for the deal team. */}
      <DdReviewerPanel data={data} uid={uid} base={base} onChanged={load} />

      <DdCaseTabs uid={uid} active={caseTab} tabs={tabs} />

      {body}

      {dialog ? <CaseDialog uid={uid} data={data} me={auth?.user} dialog={dialog} close={() => setDialog(null)} done={done} /> : null}
    </div>
  );
}

// D774 (#2100): S11 drew no rail. The board's page, in the Admin boards' frame.
export default function AdminDueDiligenceCasePage() {
  return (
    <AdminBoardFrame workspace="Due diligence" note="Eadwyn reads this case, its sources and its findings. A verdict is recorded only when you record it." data-testid="admin-board-due-diligence">
      <AdminDueDiligenceCasePageBody />
    </AdminBoardFrame>
  );
}

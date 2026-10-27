// D953 (#2371) — the five program pages whose board is "Programs" itself:
// Perks (PG10), Learning (PG12), Referral partners (PG7), Investor cohort
// access (PG11) and AI-native Venture (PG13). This file is the routed page at
// each of their addresses and tab sub-paths (`guard(['admin'])` in App.jsx);
// its default export is one `AdminBoardFrame` named "Programs", and the page
// the address names sits in `ProgramBody` inside it. AI-native Venture is one
// page, with no tab strip.
//
// D963 (#2796, part 10) completes Referral partners (Overview, How it runs,
// Queue, Activity, and its dialogs), Investor cohort access (Overview and
// Activity, Give access and End access) and AI-native Venture (its tiles and
// playbook, and the Super Admin's Edit and Publish), on parts 1, 5 and 6's
// reads. Each header's status pill is part 1's registry's.
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import ActivityTab from './ActivityTab';
import PlaybookEditor, { useProgramDetail } from './PlaybookEditor';
import ProgramFrame from './ProgramFrame';
import { LearningTabs, PartnersTabs, PerksTabs } from './ProgramTabs';
import { LearningOverview, LearningPeople } from './LearningPages';
import { PerksOverview, PerksQueue } from './PerksPages';
import { InvitePartner, PartnersOverview, PartnersQueue, useQueueCount } from './ReferralPartners';
import { ApproveDialog, EndTermsDialog, RuleDialog, SendDialog, TermsDialog } from './ReferralTermsDialogs';
import { EndAccessDialog, GiveAccessDialog, InvestorOverview, useInvestorReads } from './InvestorCohorts';
import { InvestorTabs } from './ProgramTabs';
import { SUB, Tile } from './parts';
import { STATUS_WORD } from './catalogueModel';
import { totalOf } from './programPagesModel';
import { useLearningReads, usePerksReads } from './useProgramReads';
import { AI_NATIVE_FOOT, INVESTOR_BANNER, NOT_RUNNING_YET, isReady, routeFor } from './programsModel';

// D962 (#2795): How it runs reads part 1's playbook store, and Activity part 1's activity read.
function Perks({ tab, superAdmin }) {
  const reads = usePerksReads(tab);
  const detail = useProgramDetail('perks', tab === 'how');
  const n = totalOf(reads.inReview);
  const queue = n !== null ? { text: n.toLocaleString('en-US'), amber: n > 0, title: 'Listings in review' } : null;
  return (
    <ProgramFrame program="perks" superAdmin={superAdmin} tabs={<PerksTabs queue={queue} />}>
      {tab === 'overview' ? <PerksOverview reads={reads} superAdmin={superAdmin} /> : null}
      {tab === 'how' ? <PlaybookEditor program="perks" superAdmin={superAdmin} detail={detail} testId="programs-perks-how" /> : null}
      {tab === 'queue' ? <PerksQueue reads={reads} /> : null}
      {tab === 'activity' ? <ActivityTab program="perks" testId="programs-perks-activity" /> : null}
    </ProgramFrame>
  );
}

function Learning({ tab, superAdmin }) {
  const [programUid, setProgramUid] = useState(null);
  const reads = useLearningReads(tab, programUid);
  const detail = useProgramDetail('learning', tab === 'how');
  return (
    <ProgramFrame program="learning" superAdmin={superAdmin} tabs={<LearningTabs />}>
      {tab === 'overview' ? <LearningOverview reads={reads} superAdmin={superAdmin} /> : null}
      {tab === 'how' ? <PlaybookEditor program="learning" superAdmin={superAdmin} detail={detail} testId="programs-learning-how" /> : null}
      {tab === 'people' ? <LearningPeople reads={reads} programUid={programUid} onPick={setProgramUid} /> : null}
      {tab === 'activity' ? <ActivityTab program="learning" testId="programs-learning-activity" /> : null}
    </ProgramFrame>
  );
}

/** D963: the header's status from part 1's registry, in the canvas's words; null until it answers. */
const registryStatus = (detail) => (isReady(detail.read) ? STATUS_WORD[detail.read.data?.program?.status] || null : null);

/** A page's reload counter and its open dialog. */
function useDesk() {
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const reload = () => setTick((t) => t + 1);
  return { tick, reload, dialog, setDialog, close: () => setDialog(null) };
}

function ReferralPartners({ tab, superAdmin }) {
  const detail = useProgramDetail('referral-partners');
  const desk = useDesk();
  const queue = useQueueCount(desk.tick);
  const open = { reload: desk.reload, dialog: desk.setDialog };
  const d = desk.dialog;
  const changed = () => desk.reload();
  return (
    <ProgramFrame program="referral-partners" superAdmin={superAdmin} status={registryStatus(detail)} tabs={<PartnersTabs queue={queue} />}
      actions={<InvitePartner className={`${actionPrimary} w-full sm:w-auto`} />}>
      {tab === 'overview' ? <PartnersOverview superAdmin={superAdmin} tick={desk.tick} open={open} /> : null}
      {tab === 'how' ? <PlaybookEditor program="referral-partners" superAdmin={superAdmin} detail={detail} testId="programs-partners-how" /> : null}
      {tab === 'queue' ? <PartnersQueue superAdmin={superAdmin} tick={desk.tick} open={open} /> : null}
      {tab === 'activity' ? <ActivityTab program="referral-partners" testId="programs-partners-activity" /> : null}
      {d?.kind === 'terms' ? <TermsDialog partner={d.partner} superAdmin={superAdmin} onClose={desk.close} onChanged={changed} onOpen={(kind, terms) => desk.setDialog({ kind, terms, partner: d.partner })} /> : null}
      {d?.kind === 'approve' ? <ApproveDialog terms={d.terms || null} partner={d.partner || null} onClose={desk.close} onChanged={changed} /> : null}
      {d?.kind === 'send' ? <SendDialog terms={d.terms || null} partner={d.partner || null} onClose={desk.close} onChanged={changed} /> : null}
      {d?.kind === 'end' ? <EndTermsDialog partner={d.partner} onClose={desk.close} onChanged={changed} /> : null}
      {d?.kind === 'rule' ? <RuleDialog rule={d.rule} onClose={desk.close} onChanged={changed} /> : null}
    </ProgramFrame>
  );
}

const BANNER = <p role="note" className="m-0 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="programs-investor-banner">{INVESTOR_BANNER}</p>;

function InvestorCohorts({ tab, superAdmin }) {
  const detail = useProgramDetail('investor-cohorts');
  const desk = useDesk();
  const reads = useInvestorReads(desk.tick);
  const status = registryStatus(detail);
  const open = { reload: desk.reload, dialog: desk.setDialog, banner: BANNER };
  const d = desk.dialog;
  return (
    <ProgramFrame program="investor-cohorts" superAdmin={superAdmin} status={status} tabs={<InvestorTabs />}
      actions={<button type="button" onClick={() => desk.setDialog({ kind: 'give' })} className={`${actionPrimary} w-full sm:w-auto`} data-testid="programs-investor-give">Give access</button>}>
      {tab === 'overview' ? (
        <InvestorOverview reads={reads} running={status === 'Live'} tick={desk.tick} open={open}
          how={<PlaybookEditor program="investor-cohorts" superAdmin={superAdmin} detail={detail} testId="programs-investor-how" />} />
      ) : null}
      {tab === 'activity' ? <ActivityTab program="investor-cohorts" testId="programs-investor-activity" /> : null}
      {d?.kind === 'give' ? <GiveAccessDialog reads={reads} onClose={desk.close} onGiven={desk.reload} /> : null}
      {d?.kind === 'end' ? <EndAccessDialog grant={d.grant} onClose={desk.close} onEnded={desk.reload} /> : null}
    </ProgramFrame>
  );
}

/** PG13's four tiles: the program has not run, so each reads "Not running yet", never 0. */
const AI_TILES = ['Founders', 'Cohorts', 'Applications', 'Studios offered'].map((label) => ({
  key: label.toLowerCase().replace(/ /g, '-'), label, state: 'placeholder', word: NOT_RUNNING_YET, reason: 'This program has not run.',
}));

/**
 * AI-native Venture (PG13, PG13s). How it runs is part 1's playbook store:
 * an Admin reads what HQ published, with the lock and "Set by HQ", and an
 * unset section reads "Not set"; a Super Admin edits the draft and publishes
 * it. Offer to studios waits for #2376 and part 3, so it is not drawn.
 */
function AiNativeVenture({ superAdmin }) {
  const detail = useProgramDetail('ai-native-venture');
  return (
    <ProgramFrame program="ai-native-venture" superAdmin={superAdmin} status={registryStatus(detail)}>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="programs-ai-native-tiles">
        {AI_TILES.map((t) => <Tile key={t.key} t={t} />)}
      </div>
      <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{superAdmin ? 'How it runs · draft' : 'How it runs'}</h2>
      <PlaybookEditor program="ai-native-venture" superAdmin={superAdmin} detail={detail} testId="programs-ai-native-how" />
      {superAdmin ? null : <p className={`m-0 ${SUB}`} data-testid="programs-ai-native-foot">{AI_NATIVE_FOOT}</p>}
    </ProgramFrame>
  );
}

function ProgramBody() {
  const { pathname } = useLocation();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const { program, tab } = routeFor(pathname);
  if (program === 'perks') return <Perks tab={tab} superAdmin={superAdmin} />;
  if (program === 'learning') return <Learning tab={tab} superAdmin={superAdmin} />;
  if (program === 'referral-partners') return <ReferralPartners tab={tab} superAdmin={superAdmin} />;
  if (program === 'investor-cohorts') return <InvestorCohorts tab={tab} superAdmin={superAdmin} />;
  if (program === 'ai-native-venture') return <AiNativeVenture superAdmin={superAdmin} />;
  return null;
}

// D953 (#2371): the five pages whose board is Programs, in the Admin boards' frame.
export default function ProgramPage() {
  return (
    <AdminBoardFrame workspace="Programs" note="Eadwyn reads the program figures on this page. Nothing changes until you act." data-testid="admin-board-program">
      <ProgramBody />
    </AdminBoardFrame>
  );
}

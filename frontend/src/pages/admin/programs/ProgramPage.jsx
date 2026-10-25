// D953 (#2371) — the five program pages whose board is "Programs" itself:
// Perks (PG10), Learning (PG12), Referral partners (PG7), Investor cohort
// access (PG11) and AI-native Venture (PG13). This file is the routed page at
// each of their addresses and tab sub-paths (`guard(['admin'])` in App.jsx);
// its default export is one `AdminBoardFrame` named "Programs", and the page
// the address names sits in `ProgramBody` inside it. Investor cohort access
// and AI-native Venture are one page each, with no tab strip.
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
import { InvitePartner, PartnersOverview } from './ReferralPartners';
import { HowItRuns, SUB } from './parts';
import { useLearningReads, usePerksReads } from './useProgramReads';
import { totalOf } from './programPagesModel';
import {
  AI_NATIVE_WAITS, HOW_IT_RUNS, INVESTOR_BANNER, INVESTOR_UNDECIDED, routeFor,
} from './programsModel';

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

function ReferralPartners({ tab, superAdmin }) {
  return (
    <ProgramFrame program="referral-partners" superAdmin={superAdmin} tabs={<PartnersTabs />}
      actions={<InvitePartner className={`${actionPrimary} w-full sm:w-auto`} />}>
      {tab === 'overview' ? <PartnersOverview superAdmin={superAdmin} /> : null}
      {tab === 'how' ? <HowItRuns sections={HOW_IT_RUNS['referral-partners']} superAdmin={superAdmin} testId="programs-partners-how" /> : null}
    </ProgramFrame>
  );
}

function InvestorCohorts({ superAdmin }) {
  return (
    <ProgramFrame program="investor-cohorts" superAdmin={superAdmin}>
      <p role="note" className="m-0 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="programs-investor-banner">{INVESTOR_BANNER}</p>
      <HowItRuns sections={HOW_IT_RUNS['investor-cohorts']} superAdmin={superAdmin} testId="programs-investor-how" />
      <p className={`m-0 ${SUB}`} data-testid="programs-investor-undecided">{INVESTOR_UNDECIDED}</p>
    </ProgramFrame>
  );
}

function AiNativeVenture({ superAdmin }) {
  return (
    <ProgramFrame program="ai-native-venture" superAdmin={superAdmin}>
      <p className={`m-0 ${SUB}`} data-testid="programs-ai-native-waits">{AI_NATIVE_WAITS}</p>
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
  if (program === 'investor-cohorts') return <InvestorCohorts superAdmin={superAdmin} />;
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

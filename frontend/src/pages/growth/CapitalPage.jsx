// Growth · Capital — a fundraising & investor-matching workspace. Modules:
// Investor Introductions, VC Firms, Angel Investors, Family Offices, Grants.
// Each raise opens a detail panel with the round brief, matched investors,
// warm-intro paths, and diligence status.
import React from 'react';
import { Banknote, MapPin, Target, TrendingUp, Calendar } from 'lucide-react';
import {
  GrowthResourceView, RowCard, Chip, Section, Field, MatchBadge, BulletList, money,
} from './kit';
import { CAPITAL_MODULES, CAPITAL_TARGETS } from '../../data/growth';

const MODULE_LABEL = Object.fromEntries(CAPITAL_MODULES.map((m) => [m.id, m.name]));

export default function CapitalPage() {
  const activeRaises = CAPITAL_TARGETS.filter((t) => t.stage !== 'Closed').length;
  const totalTarget = CAPITAL_TARGETS.reduce((a, t) => a + (t.targetAmount || 0), 0);
  const meetings = CAPITAL_TARGETS.reduce((a, t) => a + (t.meetings || 0), 0);
  const avgProb = Math.round(
    CAPITAL_TARGETS.reduce((a, t) => a + (t.fundingProbability || 0), 0) / (CAPITAL_TARGETS.length || 1),
  );

  const stats = [
    { label: 'Active raises', value: activeRaises, hint: 'Being matched' },
    { label: 'Target amount', value: money(totalTarget), hint: 'Across raises' },
    { label: 'Investor meetings', value: meetings, hint: 'Booked to date' },
    { label: 'Avg funding odds', value: `${avgProb}%`, hint: 'Across raises' },
  ];

  return (
    <GrowthResourceView
      stats={stats}
      modules={CAPITAL_MODULES}
      records={CAPITAL_TARGETS}
      searchKeys={['company', 'round', 'sectorFocus', 'raiseType']}
      searchPlaceholder="Search raises, rounds, sectors…"
      emptyText="No raises match your filters."
      renderRow={(t, onOpen) => (
        <RowCard key={t.id} onClick={onOpen}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                <Banknote size={14} className="text-gray-400" /> {t.company}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {t.round} · {t.raiseType} · {money(t.targetAmount)}
              </div>
            </div>
            <MatchBadge score={t.investorFit} label="Fit" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="violet">{t.stage}</Chip>
            <Chip>{t.sectorFocus}</Chip>
            <Chip><MapPin size={10} /> {t.geography}</Chip>
            <Chip tone="blue"><TrendingUp size={10} /> {t.fundingProbability}% odds</Chip>
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Ticket {t.ticketSize} · {t.interestLevel} interest · {t.closeLikelihood}
          </div>
        </RowCard>
      )}
      renderDetail={renderDetail}
    />
  );
}

function renderDetail(t) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="violet">{MODULE_LABEL[t.module]}</Chip>
        <Chip>{t.stage}</Chip>
        <MatchBadge score={t.investorFit} label="Investor fit" />
      </div>

      <Section title="Round brief">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Raise type">{t.raiseType}</Field>
          <Field label="Round">{t.round}</Field>
          <Field label="Target amount">{money(t.targetAmount)}</Field>
          <Field label="Ticket size">{t.ticketSize}</Field>
          <Field label="Stage">{t.stage}</Field>
          <Field label="Sector focus">{t.sectorFocus}</Field>
          <Field label="Geography">{t.geography}</Field>
          {t.grantDeadline && (
            <Field label="Grant deadline">
              <span className="inline-flex items-center gap-1"><Calendar size={12} /> {t.grantDeadline}</span>
            </Field>
          )}
        </div>
      </Section>

      <Section title="Progress">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Meetings">{t.meetings}</Field>
          <Field label="Follow-ups">{t.followUps}</Field>
          <Field label="Interest level">{t.interestLevel}</Field>
          <Field label="Diligence status">{t.diligenceStatus}</Field>
          <Field label="Term discussions">{t.termDiscussions}</Field>
          <Field label="Funding probability">{t.fundingProbability}%</Field>
          <Field label="Close likelihood">{t.closeLikelihood}</Field>
        </div>
      </Section>

      <Section title="Warm intro paths"><BulletList items={t.warmIntroPaths} tone="emerald" /></Section>

      {t.matchedInvestors && t.matchedInvestors.length > 0 && (
        <Section title="Matched investors">
          <div className="space-y-2">
            {t.matchedInvestors.map((inv, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
                <span className="text-sm text-gray-800 dark:text-gray-200 inline-flex items-center gap-1.5">
                  <Target size={12} className="text-gray-400" /> {inv.name}
                </span>
                <MatchBadge score={inv.match} label="Match" />
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
renderDetail.subtitle = (t) => `${t.round} · ${money(t.targetAmount)}`;

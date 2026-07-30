// Growth · Customers — a sales-introduction & market-access workspace. Modules:
// Customer Introductions, Sales Opportunities, Enterprise Introductions, Channel
// Partners. Each target opens a detail panel with the account brief, buying
// committee, sales pipeline, and next steps.
import React from 'react';
import { Building2, MapPin, TrendingUp, Handshake } from 'lucide-react';
import {
  GrowthResourceView, RowCard, Chip, Section, Field, PipelineStrip, BulletList, money,
} from './kit';
import { CUSTOMER_MODULES, CUSTOMER_TARGETS, CUSTOMER_PIPELINE } from '../../data/growth';

const MODULE_LABEL = Object.fromEntries(CUSTOMER_MODULES.map((m) => [m.id, m.name]));

export default function CustomersPage() {
  const targets = CUSTOMER_TARGETS.length;
  const intros = CUSTOMER_TARGETS.reduce((a, t) => a + (t.warmIntroductions || 0), 0);
  const pipelineValue = CUSTOMER_TARGETS.reduce((a, t) => a + (t.revenuePotential || 0), 0);
  const avgProb = Math.round(
    CUSTOMER_TARGETS.reduce((a, t) => a + (t.conversionProbability || 0), 0) / (targets || 1),
  );

  const stats = [
    { label: 'Target accounts', value: targets, hint: 'Being matched' },
    { label: 'Warm introductions', value: intros, hint: 'Paths available' },
    { label: 'Pipeline potential', value: money(pipelineValue), hint: 'Revenue potential' },
    { label: 'Avg conversion', value: `${avgProb}%`, hint: 'Across targets' },
  ];

  return (
    <GrowthResourceView
      stats={stats}
      modules={CUSTOMER_MODULES}
      records={CUSTOMER_TARGETS}
      searchKeys={['company', 'customerTarget', 'industry', 'icp']}
      searchPlaceholder="Search accounts, industries, ICP…"
      emptyText="No customer targets match your filters."
      renderRow={(t, onOpen) => (
        <RowCard key={t.id} onClick={onOpen}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                <Building2 size={14} className="text-gray-400" /> {t.company}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{t.customerTarget}</div>
            </div>
            <Chip tone="violet">{t.salesStage}</Chip>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip>{t.industry}</Chip>
            <Chip><MapPin size={10} /> {t.geography}</Chip>
            <Chip tone="amber">{t.accountTier}</Chip>
            <Chip tone="blue"><TrendingUp size={10} /> {money(t.revenuePotential)}</Chip>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Handshake size={12} /> {t.warmIntroductions} warm intro{t.warmIntroductions === 1 ? '' : 's'} · {t.conversionProbability}% likely
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
        <Chip tone="amber">{t.accountTier}</Chip>
        <Chip tone="blue">{t.conversionProbability}% conversion</Chip>
      </div>

      <Section title="Account brief">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Customer target">{t.customerTarget}</Field>
          <Field label="ICP">{t.icp}</Field>
          <Field label="Industry">{t.industry}</Field>
          <Field label="Geography">{t.geography}</Field>
          <Field label="Account tier">{t.accountTier}</Field>
          <Field label="Revenue potential">{money(t.revenuePotential)}</Field>
        </div>
      </Section>

      <Section title="Sales pipeline">
        <PipelineStrip stages={CUSTOMER_PIPELINE} active={t.salesStage} />
        <div className="grid grid-cols-2 gap-4 mt-3">
          <Field label="Opportunity stage">{t.opportunityStage}</Field>
          <Field label="Conversion probability">{t.conversionProbability}%</Field>
          <Field label="Channel motion">{t.channelMotion}</Field>
          <Field label="Partner source">{t.partnerSource}</Field>
        </div>
      </Section>

      <Section title="Buying committee">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Decision makers"><BulletList items={t.decisionMakers} tone="violet" /></Field>
          <Field label="Mutual connections">{t.mutualConnections}</Field>
          <Field label="Warm introductions">{t.warmIntroductions}</Field>
        </div>
      </Section>

      <Section title="Meeting history"><BulletList items={t.meetingHistory} tone="blue" /></Section>

      <Section title="Next steps">
        <p className="text-sm text-gray-700 dark:text-gray-300">{t.nextSteps}</p>
      </Section>
    </>
  );
}
renderDetail.subtitle = (t) => `${t.industry} · ${t.geography}`;

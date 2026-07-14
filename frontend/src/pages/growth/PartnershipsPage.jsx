// Growth · Partnerships — a strategic, technology, reseller, and distribution
// partnership-matching workspace. Modules: Strategic Partners, Technology
// Partners, Resellers, Distribution. Each partner opens a detail panel with the
// partnership brief, pipeline stage, key fields, benefits, and next steps.
import React from 'react';
import { Handshake, MapPin, TrendingUp, Building2 } from 'lucide-react';
import {
  GrowthResourceView, RowCard, Chip, Section, Field, MatchBadge, PipelineStrip, BulletList, money,
} from './kit';
import { PARTNERSHIP_MODULES, PARTNERSHIPS, PARTNERSHIP_PIPELINE } from '../../data/growth';

const MODULE_LABEL = Object.fromEntries(PARTNERSHIP_MODULES.map((m) => [m.id, m.name]));

export default function PartnershipsPage() {
  const active = PARTNERSHIPS.filter((p) => p.stage === 'Active').length;
  const total = PARTNERSHIPS.length;
  const pipelineValue = PARTNERSHIPS.reduce((a, p) => a + (p.pipelineValue || 0), 0);
  const deals = PARTNERSHIPS.reduce((a, p) => a + (p.dealsInfluenced || 0), 0);

  const stats = [
    { label: 'Total partners', value: total, hint: 'Across all modules' },
    { label: 'Active partnerships', value: active, hint: 'Live & co-selling' },
    { label: 'Pipeline influenced', value: money(pipelineValue), hint: 'Partner-sourced value' },
    { label: 'Deals influenced', value: deals, hint: 'Across partners' },
  ];

  return (
    <GrowthResourceView
      stats={stats}
      modules={PARTNERSHIP_MODULES}
      records={PARTNERSHIPS}
      searchKeys={['name', 'type', 'markets', 'region', 'description']}
      searchPlaceholder="Search partners, types, markets…"
      emptyText="No partnerships match your filters."
      renderRow={(p, onOpen) => (
        <RowCard key={p.id} onClick={onOpen}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                <Building2 size={14} className="text-gray-400" /> {p.name}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{p.type}</div>
            </div>
            <Chip tone="violet">{p.stage}</Chip>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-1">{p.description}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip>{MODULE_LABEL[p.module]}</Chip>
            <Chip><MapPin size={10} /> {p.region}</Chip>
            <MatchBadge score={p.fitScore} label="Fit" />
            <Chip tone="blue"><TrendingUp size={10} /> {money(p.pipelineValue)}</Chip>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Handshake size={12} /> {p.dealsInfluenced} deal{p.dealsInfluenced === 1 ? '' : 's'} influenced · {p.partnerType}
          </div>
        </RowCard>
      )}
      renderDetail={renderDetail}
    />
  );
}

function renderDetail(p) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="violet">{MODULE_LABEL[p.module]}</Chip>
        <Chip>{p.partnerType}</Chip>
        <MatchBadge score={p.fitScore} label="Fit" />
      </div>

      <Section title="Partner brief">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Partner">{p.name}</Field>
          <Field label="Type">{p.type}</Field>
          <Field label="Region">{p.region}</Field>
          <Field label="Markets">{p.markets}</Field>
          <Field label="Partnership value">{p.valueSummary}</Field>
          <Field label="Description">{p.description}</Field>
        </div>
      </Section>

      <Section title="Partnership pipeline">
        <PipelineStrip stages={PARTNERSHIP_PIPELINE} active={p.stage} />
        <div className="grid grid-cols-2 gap-4 mt-3">
          <Field label="Status">{p.status}</Field>
          <Field label="Deals influenced">{p.dealsInfluenced}</Field>
          <Field label="Pipeline value">{money(p.pipelineValue)}</Field>
          <Field label="Point of contact">{p.pointOfContact}</Field>
          <Field label="Partner since">{p.since}</Field>
          <Field label="Last touch">{p.lastTouch}</Field>
        </div>
      </Section>

      {(p.integration || p.apiCoverage || p.channel || p.territory || p.marginTier || p.reachEstimate) && (
        <Section title="Partnership details">
          <div className="grid grid-cols-2 gap-4">
            {p.integration && <Field label="Integration">{p.integration}</Field>}
            {p.apiCoverage && <Field label="API coverage">{p.apiCoverage}</Field>}
            {p.channel && <Field label="Channel">{p.channel}</Field>}
            {p.territory && <Field label="Territory">{p.territory}</Field>}
            {p.marginTier && <Field label="Margin tier">{p.marginTier}</Field>}
            {p.reachEstimate && <Field label="Reach">{p.reachEstimate}</Field>}
          </div>
        </Section>
      )}

      {p.benefits && p.benefits.length > 0 && (
        <Section title="Benefits"><BulletList items={p.benefits} tone="emerald" /></Section>
      )}

      {p.nextSteps && p.nextSteps.length > 0 && (
        <Section title="Next steps"><BulletList items={p.nextSteps} tone="blue" /></Section>
      )}
    </>
  );
}
renderDetail.subtitle = (p) => `${MODULE_LABEL[p.module]} · ${p.region}`;

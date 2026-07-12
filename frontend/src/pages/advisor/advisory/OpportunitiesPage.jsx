import React, { useMemo, useState } from 'react';
import { Building2, Target, Calendar, DollarSign } from 'lucide-react';
import {
  OPPORTUNITIES, OPPORTUNITY_STAGES, money, formatRelativeDay, formatDay,
} from '../../../data/advisor/advisory';
import {
  SubTabs, StatCard, SlideOver, Section, Field, StatusBadge, BulletList, Checklist,
  AiSample, RowCard, EmptyState, Chip,
} from './kit';

// Opportunities — the advisory pipeline. Stages are sub-tabs (Leads, Discovery
// Calls, Proposals, Won, Lost); each opportunity opens a detail panel whose
// content adapts to the stage.

export default function OpportunitiesPage() {
  const [stage, setStage] = useState('leads');
  const [selectedId, setSelectedId] = useState(null);

  const byStage = useMemo(() => {
    const map = {};
    for (const s of OPPORTUNITY_STAGES) map[s.id] = [];
    for (const o of OPPORTUNITIES) (map[o.stage] || (map[o.stage] = [])).push(o);
    return map;
  }, []);

  const stats = useMemo(() => {
    const open = OPPORTUNITIES.filter((o) => ['leads', 'discovery', 'proposals'].includes(o.stage));
    const openValue = open.reduce((a, o) => a + (o.value || 0), 0);
    const won = byStage.won || [];
    const lost = byStage.lost || [];
    const decided = won.length + lost.length;
    const winRate = decided ? Math.round((won.length / decided) * 100) : 0;
    const wonValue = won.reduce((a, o) => a + (o.value || 0), 0);
    return { openCount: open.length, openValue, winRate, wonValue };
  }, [byStage]);

  const tabs = OPPORTUNITY_STAGES.map((s) => ({ id: s.id, label: `${s.label} (${(byStage[s.id] || []).length})` }));
  const list = byStage[stage] || [];
  const selected = list.find((o) => o.id === selectedId) || OPPORTUNITIES.find((o) => o.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Open opportunities" value={stats.openCount} hint="Leads · Discovery · Proposals" />
        <StatCard label="Open pipeline value" value={money(stats.openValue)} hint="Weighted by list price" />
        <StatCard label="Win rate" value={`${stats.winRate}%`} hint="Won of decided" />
        <StatCard label="Won value" value={money(stats.wonValue)} hint="Closed-won this view" />
      </div>

      <SubTabs tabs={tabs} value={stage} onChange={(v) => { setStage(v); }} />

      {list.length === 0 ? (
        <EmptyState>No opportunities in this stage.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((o) => (
            <RowCard key={o.id} onClick={() => setSelectedId(o.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                    <Building2 size={14} className="text-gray-400" /> {o.company}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {o.contact} · {o.role}
                  </div>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">{o.service}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="violet"><DollarSign size={10} /> {money(o.value)}</Chip>
                <Chip><Target size={10} /> Qual. {o.qualificationScore}</Chip>
                <Chip>{o.industry}</Chip>
              </div>
            </RowCard>
          ))}
        </div>
      )}

      <OpportunityDetail opp={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function OpportunityDetail({ opp, onClose }) {
  if (!opp) return <SlideOver open={false} onClose={onClose} />;
  return (
    <SlideOver open onClose={onClose} title={opp.company} subtitle={`${opp.contact} · ${opp.role}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={opp.status} />
        <Chip tone="violet"><DollarSign size={10} /> {money(opp.value)}</Chip>
        <Chip><Target size={10} /> Qualification {opp.qualificationScore}</Chip>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Service interest">{opp.service}</Field>
        <Field label="Industry">{opp.industry}</Field>
        <Field label="Source">{opp.source}</Field>
        <Field label="Created">{formatRelativeDay(opp.createdDate)}</Field>
      </div>

      {opp.notes && (
        <Section title="Notes">
          <p className="text-sm text-gray-700 dark:text-gray-300">{opp.notes}</p>
        </Section>
      )}

      {opp.discovery && <DiscoveryBlock d={opp.discovery} />}
      {opp.proposal && <ProposalBlock p={opp.proposal} />}
      {opp.won && <WonBlock w={opp.won} />}
      {opp.lost && <LostBlock l={opp.lost} />}
    </SlideOver>
  );
}

function DiscoveryBlock({ d }) {
  return (
    <>
      <Section title="Discovery call">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Scheduled"><span className="inline-flex items-center gap-1"><Calendar size={12} /> {formatDay(d.schedule)} · {formatRelativeDay(d.schedule)}</span></Field>
          <Field label="Budget">{d.budget}</Field>
          <Field label="Timeline">{d.timeline}</Field>
          <Field label="Participants">{d.participants.join(', ')}</Field>
        </div>
      </Section>
      <Section title="Company context">
        <p className="text-sm text-gray-700 dark:text-gray-300">{d.companyContext}</p>
      </Section>
      <Section title="Challenges"><BulletList items={d.challenges} tone="rose" /></Section>
      <Section title="Goals"><BulletList items={d.goals} tone="emerald" /></Section>
      <Section title="Needs assessment">
        <p className="text-sm text-gray-700 dark:text-gray-300">{d.needsAssessment}</p>
      </Section>
      <Section title="AI summary"><AiSample>{d.aiSummary}</AiSample></Section>
      <Section title="Next steps"><BulletList items={d.nextSteps} tone="violet" /></Section>
    </>
  );
}

function ProposalBlock({ p }) {
  const total = (p.pricing || []).reduce((a, r) => a + (r.amount || 0), 0);
  return (
    <>
      <Section title="Proposal">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Version">{p.version}</Field>
          <Field label="Approval"><StatusBadge status={p.approvalStatus} /></Field>
          <Field label="Sent">{formatRelativeDay(p.sentDate)}</Field>
          <Field label="Total"><span className="font-semibold">{money(total)}</span></Field>
        </div>
      </Section>
      <Section title="Scope"><p className="text-sm text-gray-700 dark:text-gray-300">{p.scope}</p></Section>
      <Section title="Services"><BulletList items={p.services} tone="violet" /></Section>
      <Section title="Deliverables"><BulletList items={p.deliverables} tone="emerald" /></Section>
      <Section title="Pricing">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {p.pricing.map((r, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 text-sm">
              <span className="text-gray-700 dark:text-gray-300">{r.item}</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{money(r.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between p-2.5 text-sm bg-gray-50 dark:bg-gray-900/50">
            <span className="font-semibold text-gray-900 dark:text-gray-100">Total</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{money(total)}</span>
          </div>
        </div>
      </Section>
    </>
  );
}

function WonBlock({ w }) {
  return (
    <>
      <Section title="Won">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Closed">{formatRelativeDay(w.closedDate)}</Field>
          <Field label="Onboarding"><StatusBadge status={w.onboardingStatus} /></Field>
          <Field label="Engagement">{w.engagementId}</Field>
          <Field label="Contract">{w.contractId}</Field>
        </div>
      </Section>
      <Section title="Onboarding checklist"><Checklist items={w.onboardingSteps} /></Section>
    </>
  );
}

function LostBlock({ l }) {
  return (
    <Section title="Lost">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Reason"><StatusBadge status={l.reason} /></Field>
        <Field label="Lost to">{l.competitor || '—'}</Field>
        <Field label="Closed">{formatRelativeDay(l.closedDate)}</Field>
        <Field label="Follow-up">{formatDay(l.followUpDate)}</Field>
      </div>
      <div className="mt-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">{l.detail}</p>
      </div>
    </Section>
  );
}

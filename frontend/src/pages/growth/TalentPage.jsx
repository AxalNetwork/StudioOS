// Growth · Talent — a hiring & resource-matching workspace. Modules: Executive
// Search, Hiring Support, Candidate Network, Recruiters. Each search opens a
// detail panel with the full hiring brief, pipeline, and AI-scored candidates.
import React from 'react';
import { Users, MapPin, Clock, Building2, Briefcase } from 'lucide-react';
import {
  GrowthResourceView, RowCard, Chip, Section, Field, MatchBadge, PipelineStrip, BulletList,
} from './kit';
import { TALENT_MODULES, TALENT_SEARCHES, TALENT_PIPELINE } from '../../data/growth';

const MODULE_LABEL = Object.fromEntries(TALENT_MODULES.map((m) => [m.id, m.name]));

export default function TalentPage() {
  const open = TALENT_SEARCHES.filter((s) => s.placementStatus !== 'Placed').length;
  const shortlisted = TALENT_SEARCHES.reduce((a, s) => a + (s.shortlist || 0), 0);
  const inPipeline = TALENT_SEARCHES.reduce((a, s) => a + (s.pipelineCount || 0), 0);
  const intros = TALENT_SEARCHES.reduce((a, s) => a + (s.introductions || 0), 0);

  const stats = [
    { label: 'Active searches', value: open, hint: 'Roles being matched' },
    { label: 'In pipeline', value: inPipeline, hint: 'Candidates across searches' },
    { label: 'Shortlisted', value: shortlisted, hint: 'Advanced to shortlist' },
    { label: 'Introductions', value: intros, hint: 'Warm intros made' },
  ];

  return (
    <GrowthResourceView
      stats={stats}
      modules={TALENT_MODULES}
      records={TALENT_SEARCHES}
      searchKeys={['company', 'role', 'hiringNeed', 'function']}
      searchPlaceholder="Search roles, companies, needs…"
      emptyText="No talent searches match your filters."
      renderRow={(s, onOpen) => (
        <RowCard key={s.id} onClick={onOpen}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                <Briefcase size={14} className="text-gray-400" /> {s.role}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1.5">
                <Building2 size={12} /> {s.company}
              </div>
            </div>
            <Chip tone="violet">{s.stage}</Chip>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-1">{s.hiringNeed}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip>{s.seniority}</Chip>
            <Chip><MapPin size={10} /> {s.location}</Chip>
            <Chip><Clock size={10} /> {s.timeline}</Chip>
            <Chip tone="blue"><Users size={10} /> {s.pipelineCount} in pipeline</Chip>
          </div>
        </RowCard>
      )}
      renderDetail={renderDetail}
    />
  );
}

function renderDetail(s) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="violet">{MODULE_LABEL[s.module]}</Chip>
        <Chip>{s.placementStatus}</Chip>
        <Chip tone="blue">{s.marketAvailability}</Chip>
      </div>

      <Section title="Hiring brief">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company">{s.company}</Field>
          <Field label="Role">{s.role}</Field>
          <Field label="Seniority">{s.seniority}</Field>
          <Field label="Function">{s.function}</Field>
          <Field label="Location">{s.location}</Field>
          <Field label="Compensation">{s.compRange}</Field>
          <Field label="Timeline">{s.timeline}</Field>
          <Field label="Hiring need">{s.hiringNeed}</Field>
        </div>
      </Section>

      <Section title="Search pipeline">
        <PipelineStrip stages={TALENT_PIPELINE} active={s.stage} />
        <div className="grid grid-cols-3 gap-4 mt-3">
          <Field label="In pipeline">{s.pipelineCount}</Field>
          <Field label="Shortlist">{s.shortlist}</Field>
          <Field label="Introductions">{s.introductions}</Field>
          <Field label="Interviews">{s.interviews}</Field>
          <Field label="Outcome">{s.outcome}</Field>
          <Field label="Placement">{s.placementStatus}</Field>
        </div>
      </Section>

      <Section title="Team">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Recruiter">{s.recruiter}</Field>
          <Field label="Hiring manager">{s.hiringManager}</Field>
          <Field label="Market availability">{s.marketAvailability}</Field>
          <Field label="Feedback">{s.feedback}</Field>
        </div>
      </Section>

      {s.candidates && s.candidates.length > 0 && (
        <Section title="Candidate matches">
          <div className="space-y-2.5">
            {s.candidates.map((c, i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                  <MatchBadge score={c.fitScore} label="Fit" />
                </div>
                <div className="mt-2"><BulletList items={c.strengths} tone="emerald" /></div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Recommendation: </span>{c.recommendation}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
renderDetail.subtitle = (s) => `${s.company} · ${s.role}`;

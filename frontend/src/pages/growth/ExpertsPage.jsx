// Growth · Experts — a mentor/advisor discovery workspace. Modules: Subject
// Matter Experts, Advisors, Mentors, Coaches. Each expert opens a detail panel
// with their background, match strength, engagement terms, and references.
import React from 'react';
import { MapPin, Globe, Clock, Star } from 'lucide-react';
import {
  GrowthResourceView, RowCard, Avatar, Chip, Section, Field, MatchBadge, BulletList,
} from './kit';
import { EXPERT_MODULES, EXPERTS } from '../../data/growth';

const MODULE_LABEL = Object.fromEntries(EXPERT_MODULES.map((m) => [m.id, m.name]));

export default function ExpertsPage() {
  const total = EXPERTS.length;
  const available = EXPERTS.filter((e) => e.availability && !/unavailable/i.test(e.availability)).length;
  const avgFit = Math.round(EXPERTS.reduce((a, e) => a + (e.fitScore || 0), 0) / (total || 1));
  const sessions = EXPERTS.reduce((a, e) => a + (e.sessionHistory?.length || 0), 0);

  const stats = [
    { label: 'Experts matched', value: total, hint: 'In discovery pool' },
    { label: 'Available now', value: available, hint: 'Open to engage' },
    { label: 'Avg fit score', value: avgFit, hint: 'Across matches' },
    { label: 'Sessions logged', value: sessions, hint: 'Engagement history' },
  ];

  return (
    <GrowthResourceView
      stats={stats}
      modules={EXPERT_MODULES}
      records={EXPERTS}
      searchKeys={['name', 'expertiseArea', 'industryFocus', 'background']}
      searchPlaceholder="Search experts, expertise, industries…"
      emptyText="No experts match your filters."
      renderRow={(e, onOpen) => (
        <RowCard key={e.id} onClick={onOpen}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={e.name} size={40} />
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{e.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{e.expertiseArea}</div>
              </div>
            </div>
            <MatchBadge score={e.fitScore} label="Fit" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="violet">{MODULE_LABEL[e.module]}</Chip>
            <Chip>{e.industryFocus}</Chip>
            <Chip><Clock size={10} /> {e.availability}</Chip>
            <Chip><MapPin size={10} /> {e.geography}</Chip>
          </div>
        </RowCard>
      )}
      renderDetail={renderDetail}
    />
  );
}

function renderDetail(e) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar name={e.name} size={48} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="violet">{MODULE_LABEL[e.module]}</Chip>
            <MatchBadge score={e.fitScore} label="Fit" />
          </div>
        </div>
      </div>

      <Section title="Profile">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expertise area">{e.expertiseArea}</Field>
          <Field label="Industry focus">{e.industryFocus}</Field>
          <Field label="Experience level">{e.experienceLevel}</Field>
          <Field label="Match strength">{e.matchStrength}</Field>
          <Field label="Availability">{e.availability}</Field>
          <Field label="Intro path">{e.introPath}</Field>
          <Field label="Rate">{e.rate}</Field>
          <Field label="Engagement type">{e.engagementType}</Field>
          <Field label="Language"><span className="inline-flex items-center gap-1"><Globe size={12} /> {e.language}</span></Field>
          <Field label="Geography"><span className="inline-flex items-center gap-1"><MapPin size={12} /> {e.geography}</span></Field>
        </div>
      </Section>

      <Section title="Background">
        <p className="text-sm text-gray-700 dark:text-gray-300">{e.background}</p>
      </Section>

      <Section title="Session history"><BulletList items={e.sessionHistory} tone="blue" /></Section>

      <Section title="Outcome">
        <p className="text-sm text-gray-700 dark:text-gray-300">{e.outcome}</p>
      </Section>

      {e.notes && (
        <Section title="Notes">
          <p className="text-sm text-gray-700 dark:text-gray-300">{e.notes}</p>
        </Section>
      )}

      {e.references && e.references.length > 0 && (
        <Section title="References">
          <div className="flex flex-wrap gap-2">
            {e.references.map((r, i) => (
              <Chip key={i}><Star size={10} /> {r}</Chip>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
renderDetail.subtitle = (e) => e.expertiseArea;

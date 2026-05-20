/**
 * Task #4 (ID) — Public roadmap data file.
 *
 * Items are grouped by column (`soon` = this quarter, `next` = next
 * quarter, `later` = beyond). Each item carries an `id` that the
 * `/api/public/roadmap/votes` endpoint persists votes against — keep
 * ids stable across releases so vote counts aren't reset.
 *
 * Audience tags: founder | investor | partner | mentor | all
 */
export const ROADMAP_ITEMS = [
  // Soon — this quarter
  {
    id: 'studio-os-mobile',
    column: 'soon',
    title: 'Native mobile app (iOS + Android)',
    audience: 'all',
    status: 'In development',
    body: 'Built on Expo, ships with push notifications, fingerprint sign-in, and full DD case access on the go.',
  },
  {
    id: 'lp-reporting-v2',
    column: 'soon',
    title: 'LP reporting templates v2',
    audience: 'investor',
    status: 'In development',
    body: 'Quarterly LP reports with portfolio company highlights, capital deployed, and waterfall projections.',
  },
  {
    id: 'partner-marketplace-2way',
    column: 'soon',
    title: 'Two-way partner marketplace',
    audience: 'partner',
    status: 'Design review',
    body: 'Partners can publish service offerings and respond to founder needs in one workspace.',
  },
  // Next — next quarter
  {
    id: 'ai-cap-table-modeler',
    column: 'next',
    title: 'AI cap-table scenario modeler',
    audience: 'founder',
    status: 'Planned',
    body: 'Natural-language prompts ("model a $2M SAFE at $10M cap") that produce a fully dilutive scenario.',
  },
  {
    id: 'mentor-quality-score',
    column: 'next',
    title: 'Mentor quality score',
    audience: 'mentor',
    status: 'Planned',
    body: 'Founder-rated and outcome-tracked score to surface top mentors in the matching algorithm.',
  },
  {
    id: 'multi-language-fr-ca',
    column: 'next',
    title: 'French (Canada) localization',
    audience: 'all',
    status: 'Planned',
    body: 'Full UI translation + locale-aware date/currency formatting for the Quebec founder community.',
  },
  // Later — beyond
  {
    id: 'fund-admin-export',
    column: 'later',
    title: 'Fund admin export pack',
    audience: 'investor',
    status: 'Researching',
    body: 'One-click export to common fund administrators (Standish, Carta Fund Admin, Aduro).',
  },
  {
    id: 'studio-cohort-mode',
    column: 'later',
    title: 'Studio cohort mode',
    audience: 'founder',
    status: 'Researching',
    body: 'Accelerator-style cohorts: shared milestones, demo-day pipeline, and group office hours.',
  },
];

export const COLUMN_LABELS = {
  soon: { title: 'Soon', subtitle: 'Shipping this quarter' },
  next: { title: 'Next', subtitle: 'Planned for next quarter' },
  later: { title: 'Later', subtitle: 'On the horizon' },
};

export const AUDIENCE_LABELS = {
  founder: { label: 'Founder', color: 'bg-blue-100 text-blue-700' },
  investor: { label: 'Investor', color: 'bg-purple-100 text-purple-700' },
  partner: { label: 'Partner', color: 'bg-emerald-100 text-emerald-700' },
  mentor: { label: 'Mentor', color: 'bg-amber-100 text-amber-700' },
  all: { label: 'Everyone', color: 'bg-gray-100 text-gray-700' },
};

// Advisor Advisory — deterministic mock data for the Advisory workspace
// (Opportunities, Clients, Engagements, Delivery, Contracts). This is
// placeholder data only: there is no backend behind it yet, so it is modelled
// here and structured to be swapped for a live API later. Everything is
// deterministic — the demo "today" is fixed at 2026-07-11 and no value depends
// on Date.now / Math.random / a zero-argument new Date(). Dates are plain ISO
// strings. Any "AI summary" fields are clearly labelled sample output in the UI.

export const TODAY = '2026-07-11';
const TODAY_MS = new Date(TODAY).getTime();
const DAY = 86400000;

// Deterministic date helpers -----------------------------------------------
export function daysAgo(n) {
  return new Date(TODAY_MS - n * DAY).toISOString().slice(0, 10);
}
export function daysFromNow(n) {
  return new Date(TODAY_MS + n * DAY).toISOString().slice(0, 10);
}
export function formatDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  // Render in UTC so a date-only ISO string (parsed as UTC midnight) shows the
  // same calendar day everywhere — the demo "today" contract is timezone-stable.
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function formatRelativeDay(iso) {
  if (!iso) return '—';
  const diff = Math.round((new Date(iso).getTime() - TODAY_MS) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${-diff}d ago`;
  return `in ${diff}d`;
}
export function money(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}K`;
  return `$${v.toLocaleString()}`;
}
export function pct(v) {
  return v == null ? '—' : `${Math.round(v)}%`;
}

// ---------------------------------------------------------------------------
// Opportunities — the advisory pipeline. `stage` is one of the STAGE ids; each
// record carries the fields relevant to its stage (discovery call context,
// proposal builder, won handoff, lost reason). Records open a detail panel.
// ---------------------------------------------------------------------------
export const OPPORTUNITY_STAGES = [
  { id: 'leads', label: 'Leads', tone: 'gray' },
  { id: 'discovery', label: 'Discovery Calls', tone: 'blue' },
  { id: 'proposals', label: 'Proposals', tone: 'amber' },
  { id: 'won', label: 'Won', tone: 'emerald' },
  { id: 'lost', label: 'Lost', tone: 'rose' },
];

export const OPPORTUNITIES = [
  {
    id: 'opp-1', company: 'Northwind Labs', contact: 'Dara Okafor', role: 'Co-founder & CEO',
    stage: 'leads', service: 'GTM strategy sprint', value: 45000, source: 'Warm intro — portfolio founder',
    status: 'New', qualificationScore: 72, industry: 'AI infrastructure',
    createdDate: daysAgo(3),
    notes: 'Referred by an existing client. Scaling from design partners to self-serve; wants help sequencing the first paid GTM motion.',
  },
  {
    id: 'opp-2', company: 'Cadence Health', contact: 'Priya Nair', role: 'VP Product',
    stage: 'leads', service: 'Product strategy advisory', value: 30000, source: 'Inbound — website',
    status: 'Awaiting reply', qualificationScore: 58, industry: 'Digital health',
    createdDate: daysAgo(6),
    notes: 'Inbound form fill. Needs to confirm budget authority before booking a discovery call.',
  },
  {
    id: 'opp-3', company: 'Lumen Robotics', contact: 'Marco Diaz', role: 'Founder',
    stage: 'discovery', service: 'Fundraising readiness', value: 60000, source: 'Event — Climate Summit',
    status: 'Call scheduled', qualificationScore: 81, industry: 'Climate hardware',
    createdDate: daysAgo(10),
    discovery: {
      schedule: daysFromNow(2), participants: ['Marco Diaz (Founder)', 'You'],
      companyContext: 'Series A climate-hardware startup, $1.2M ARR, raising a $12M Series B in Q4.',
      challenges: ['Deck tells an engineering story, not a market story', 'No clear metrics narrative for scale-up', 'Thin investor pipeline'],
      goals: ['Close $12M Series B by December', 'Build a repeatable investor process'],
      needsAssessment: 'Strong technical team, needs positioning + fundraising operating cadence.',
      budget: '$50K–$70K', timeline: '10–12 weeks',
      aiSummary: 'Founder is technical and metrics-light; highest-leverage work is reframing the narrative around market pull and standing up a weekly fundraising cadence. Fit is strong given prior climate-hardware raises.',
      nextSteps: ['Send pre-call questionnaire', 'Review current deck', 'Draft engagement outline'],
    },
  },
  {
    id: 'opp-4', company: 'Harbor Analytics', contact: 'Elena Fischer', role: 'CEO',
    stage: 'discovery', service: 'Enterprise sales advisory', value: 48000, source: 'Referral — advisor network',
    status: 'Needs assessment done', qualificationScore: 76, industry: 'Data analytics',
    createdDate: daysAgo(14),
    discovery: {
      schedule: daysAgo(2), participants: ['Elena Fischer (CEO)', 'Tom Reyes (Head of Sales)', 'You'],
      companyContext: 'Post-seed analytics platform moving upmarket into mid-market enterprise.',
      challenges: ['Founder-led sales not scaling', 'No sales playbook', 'Long, unpredictable cycles'],
      goals: ['Hire and ramp first two AEs', 'Codify a repeatable enterprise motion'],
      needsAssessment: 'Ready for a fractional sales-leadership engagement; strong product-market signal.',
      budget: '$40K–$55K', timeline: '3-month retainer',
      aiSummary: 'Clear fit for a fractional enterprise-sales engagement. Priority is a lightweight playbook plus interview support for the first AE hires. Timeline is realistic.',
      nextSteps: ['Draft retainer proposal', 'Share enterprise-sales playbook sample'],
    },
  },
  {
    id: 'opp-5', company: 'Beacon Fintech', contact: 'James Whitfield', role: 'COO',
    stage: 'proposals', service: 'Advisory board seat + quarterly reviews', value: 72000, source: 'Referral — existing client',
    status: 'Proposal sent', qualificationScore: 88, industry: 'FinTech',
    createdDate: daysAgo(21),
    proposal: {
      version: 'v2', approvalStatus: 'Awaiting signature', sentDate: daysAgo(4),
      scope: 'Quarterly advisory board participation plus monthly strategy reviews with the leadership team.',
      services: ['Advisory board seat', 'Monthly strategy review', 'On-call founder support'],
      deliverables: ['Quarterly board pack review', 'Monthly action memo', 'Ad-hoc intros'],
      pricing: [
        { item: 'Advisory board seat (annual)', amount: 48000 },
        { item: 'Monthly strategy reviews (12)', amount: 24000 },
      ],
    },
  },
  {
    id: 'opp-6', company: 'Vertex Mobility', contact: 'Sofia Klein', role: 'Founder & CEO',
    stage: 'proposals', service: 'Fundraising sprint', value: 55000, source: 'Warm intro — investor',
    status: 'In review', qualificationScore: 79, industry: 'Mobility',
    createdDate: daysAgo(18),
    proposal: {
      version: 'v1', approvalStatus: 'Under review', sentDate: daysAgo(6),
      scope: 'Eight-week fundraising sprint: narrative, materials, and investor process.',
      services: ['Narrative & positioning', 'Deck rebuild', 'Investor pipeline build', 'Pitch coaching'],
      deliverables: ['Rewritten deck', 'Data room checklist', 'Weekly pipeline tracker'],
      pricing: [
        { item: 'Fundraising sprint (8 weeks)', amount: 55000 },
      ],
    },
  },
  {
    id: 'opp-7', company: 'Meridian SaaS', contact: 'Aisha Bello', role: 'CEO',
    stage: 'won', service: 'GTM advisory retainer', value: 90000, source: 'Referral — existing client',
    status: 'Closed won', qualificationScore: 92, industry: 'B2B SaaS',
    createdDate: daysAgo(40),
    won: {
      closedDate: daysAgo(9), engagementId: 'eng-ret-1', contractId: 'con-agr-1',
      onboardingStatus: 'Kickoff complete',
      onboardingSteps: [
        { label: 'Contract signed', done: true },
        { label: 'Kickoff workshop', done: true },
        { label: 'Access to metrics granted', done: true },
        { label: 'First monthly review scheduled', done: false },
      ],
    },
  },
  {
    id: 'opp-8', company: 'Atlas Commerce', contact: 'Ryan Cole', role: 'Founder',
    stage: 'won', service: 'Product strategy project', value: 38000, source: 'Inbound — referral',
    status: 'Closed won', qualificationScore: 85, industry: 'E-commerce',
    createdDate: daysAgo(33),
    won: {
      closedDate: daysAgo(15), engagementId: 'eng-proj-1', contractId: 'con-sow-1',
      onboardingStatus: 'In progress',
      onboardingSteps: [
        { label: 'SOW signed', done: true },
        { label: 'Discovery interviews scheduled', done: true },
        { label: 'Project plan approved', done: false },
      ],
    },
  },
  {
    id: 'opp-9', company: 'Orbit Media', contact: 'Nadia Rahman', role: 'CEO',
    stage: 'lost', service: 'GTM advisory', value: 42000, source: 'Inbound — website',
    status: 'Closed lost', qualificationScore: 44, industry: 'Media tech',
    createdDate: daysAgo(28),
    lost: {
      closedDate: daysAgo(7), reason: 'Budget', competitor: 'In-house hire',
      detail: 'Chose to hire a full-time head of growth instead of an advisory engagement.',
      followUpDate: daysFromNow(120),
    },
  },
  {
    id: 'opp-10', company: 'Quantic Bio', contact: 'David Osei', role: 'Co-founder',
    stage: 'lost', service: 'Fundraising readiness', value: 50000, source: 'Event — Bio Summit',
    status: 'Closed lost', qualificationScore: 39, industry: 'Biotech',
    createdDate: daysAgo(35),
    lost: {
      closedDate: daysAgo(12), reason: 'Timing', competitor: null,
      detail: 'Paused fundraising for two quarters after a large grant came through.',
      followUpDate: daysFromNow(150),
    },
  },
];

// ---------------------------------------------------------------------------
// Clients — account records. `segment` is active | past | strategic. Each
// carries a company profile, engagement history/timeline, and a health
// scorecard for the detail panel.
// ---------------------------------------------------------------------------
export const CLIENT_SEGMENTS = [
  { id: 'active', label: 'Active' },
  { id: 'strategic', label: 'Strategic' },
  { id: 'past', label: 'Past' },
];

export const CLIENTS = [
  {
    id: 'cli-meridian', name: 'Meridian SaaS', segment: 'strategic', status: 'Active',
    lifetimeValue: 210000, annualRevenue: 90000, since: daysAgo(210), primaryContact: 'Aisha Bello',
    profile: {
      industry: 'B2B SaaS', businessModel: 'Subscription (per-seat)', stage: 'Series A',
      products: ['Workflow automation platform', 'Analytics add-on'],
      markets: ['North America', 'UK'], funding: 'Series A — $14M', revenue: '$6.5M ARR',
      challenges: ['Scaling GTM beyond founder-led sales', 'Improving net revenue retention'],
      goals: ['Reach $10M ARR', 'Launch mid-market motion'],
    },
    history: [
      { date: daysAgo(210), type: 'engagement', label: 'First engagement — GTM diagnostic' },
      { date: daysAgo(150), type: 'contract', label: 'Signed 12-month advisory retainer' },
      { date: daysAgo(120), type: 'meeting', label: 'Quarterly strategy review Q1' },
      { date: daysAgo(60), type: 'deliverable', label: 'Delivered mid-market GTM playbook' },
      { date: daysAgo(30), type: 'milestone', label: 'Hit $6.5M ARR milestone' },
      { date: daysAgo(9), type: 'renewal', label: 'Renewed retainer for a second year' },
    ],
    health: {
      engagementScore: 88, satisfaction: 92, goalProgress: 70, responsiveness: 'High',
      renewalProbability: 90, expansion: ['Board advisory seat', 'Sales-team workshop series'],
    },
  },
  {
    id: 'cli-beacon', name: 'Beacon Fintech', segment: 'active', status: 'Active',
    lifetimeValue: 96000, annualRevenue: 72000, since: daysAgo(95), primaryContact: 'James Whitfield',
    profile: {
      industry: 'FinTech', businessModel: 'Transaction fees + SaaS', stage: 'Series B',
      products: ['SMB payments platform', 'Working-capital product'],
      markets: ['North America'], funding: 'Series B — $40M', revenue: '$18M ARR',
      challenges: ['Regulatory expansion into new states', 'Margin pressure on payments'],
      goals: ['Launch lending product', 'Improve unit economics'],
    },
    history: [
      { date: daysAgo(95), type: 'engagement', label: 'First engagement — strategy review' },
      { date: daysAgo(80), type: 'meeting', label: 'Leadership offsite facilitation' },
      { date: daysAgo(30), type: 'deliverable', label: 'Delivered lending go-to-market memo' },
      { date: daysAgo(4), type: 'contract', label: 'Advisory board proposal sent' },
    ],
    health: {
      engagementScore: 74, satisfaction: 80, goalProgress: 55, responsiveness: 'Medium',
      renewalProbability: 68, expansion: ['Advisory board seat'],
    },
  },
  {
    id: 'cli-atlas', name: 'Atlas Commerce', segment: 'active', status: 'Onboarding',
    lifetimeValue: 38000, annualRevenue: 38000, since: daysAgo(15), primaryContact: 'Ryan Cole',
    profile: {
      industry: 'E-commerce', businessModel: 'Marketplace take-rate', stage: 'Seed',
      products: ['Curated commerce marketplace'],
      markets: ['North America'], funding: 'Seed — $3.5M', revenue: '$1.1M GMV/mo',
      challenges: ['Retention of first-time buyers', 'Unclear product roadmap priorities'],
      goals: ['Define 2-quarter roadmap', 'Improve repeat-purchase rate'],
    },
    history: [
      { date: daysAgo(15), type: 'engagement', label: 'Product strategy project — kickoff' },
      { date: daysAgo(15), type: 'contract', label: 'SOW signed' },
      { date: daysAgo(8), type: 'meeting', label: 'Discovery interviews with team' },
    ],
    health: {
      engagementScore: 66, satisfaction: 78, goalProgress: 20, responsiveness: 'High',
      renewalProbability: 55, expansion: ['Ongoing advisory retainer'],
    },
  },
  {
    id: 'cli-summit', name: 'Summit Logistics', segment: 'past', status: 'Completed',
    lifetimeValue: 64000, annualRevenue: 0, since: daysAgo(420), primaryContact: 'Grace Lin',
    profile: {
      industry: 'Logistics tech', businessModel: 'SaaS + usage', stage: 'Series A',
      products: ['Fleet-routing platform'],
      markets: ['North America', 'EU'], funding: 'Series A — $11M', revenue: '$5M ARR',
      challenges: ['Churn in enterprise segment (resolved)'],
      goals: ['Reduce churn (achieved)'],
    },
    history: [
      { date: daysAgo(420), type: 'engagement', label: 'First engagement — retention project' },
      { date: daysAgo(300), type: 'deliverable', label: 'Delivered churn-reduction playbook' },
      { date: daysAgo(240), type: 'milestone', label: 'Enterprise churn down 40%' },
      { date: daysAgo(210), type: 'renewal', label: 'Engagement completed — no renewal' },
    ],
    health: {
      engagementScore: 42, satisfaction: 85, goalProgress: 100, responsiveness: 'Low',
      renewalProbability: 25, expansion: ['Re-engage on international expansion'],
    },
  },
  {
    id: 'cli-lumen', name: 'Lumen Robotics', segment: 'strategic', status: 'Active',
    lifetimeValue: 120000, annualRevenue: 60000, since: daysAgo(140), primaryContact: 'Marco Diaz',
    profile: {
      industry: 'Climate hardware', businessModel: 'Hardware + service contracts', stage: 'Series A',
      products: ['Autonomous field robots', 'Fleet-management software'],
      markets: ['North America'], funding: 'Series A — $18M', revenue: '$1.2M ARR',
      challenges: ['Series B narrative', 'Metrics storytelling'],
      goals: ['Close $12M Series B', 'Build investor process'],
    },
    history: [
      { date: daysAgo(140), type: 'engagement', label: 'First engagement — board advisory' },
      { date: daysAgo(90), type: 'meeting', label: 'Board meeting preparation' },
      { date: daysAgo(45), type: 'deliverable', label: 'Delivered Series B narrative draft' },
      { date: daysAgo(10), type: 'meeting', label: 'Fundraising readiness discovery' },
    ],
    health: {
      engagementScore: 81, satisfaction: 88, goalProgress: 45, responsiveness: 'High',
      renewalProbability: 82, expansion: ['Fundraising sprint', 'CFO search support'],
    },
  },
];

// ---------------------------------------------------------------------------
// Engagements — active delivery, grouped by the five delivery models. Each
// record carries the fields relevant to its model and opens a detail panel.
// ---------------------------------------------------------------------------
export const ENGAGEMENT_MODELS = [
  { id: 'projects', label: 'Projects' },
  { id: 'retainers', label: 'Retainers' },
  { id: 'boards', label: 'Advisory Boards' },
  { id: 'fractional', label: 'Fractional Roles' },
  { id: 'workshops', label: 'Workshops' },
];

export const ENGAGEMENTS = {
  projects: [
    {
      id: 'eng-proj-1', client: 'Atlas Commerce', title: 'Product strategy project',
      status: 'In progress', progress: 25, start: daysAgo(15), end: daysFromNow(60),
      objectives: ['Define 2-quarter product roadmap', 'Prioritize retention initiatives'],
      scope: 'Discovery interviews, roadmap workshop, and a prioritized backlog with rationale.',
      tasks: [
        { label: 'Stakeholder interviews', done: true },
        { label: 'Customer journey mapping', done: true },
        { label: 'Roadmap workshop', done: false },
        { label: 'Prioritized backlog', done: false },
      ],
      milestones: [
        { label: 'Discovery complete', date: daysAgo(2), done: true },
        { label: 'Draft roadmap', date: daysFromNow(20), done: false },
        { label: 'Final roadmap delivered', date: daysFromNow(55), done: false },
      ],
      deliverables: ['Discovery findings deck', 'Prioritized product roadmap'],
    },
    {
      id: 'eng-proj-2', client: 'Lumen Robotics', title: 'Series B narrative',
      status: 'In progress', progress: 60, start: daysAgo(45), end: daysFromNow(15),
      objectives: ['Rebuild the fundraising narrative', 'Prepare the investor data room'],
      scope: 'Narrative rewrite, deck rebuild, and data-room checklist for the Series B.',
      tasks: [
        { label: 'Narrative workshop', done: true },
        { label: 'Deck rebuild v1', done: true },
        { label: 'Metrics appendix', done: false },
        { label: 'Data-room checklist', done: false },
      ],
      milestones: [
        { label: 'Narrative approved', date: daysAgo(20), done: true },
        { label: 'Deck v2 ready', date: daysFromNow(5), done: false },
      ],
      deliverables: ['Series B deck', 'Data-room checklist'],
    },
  ],
  retainers: [
    {
      id: 'eng-ret-1', client: 'Meridian SaaS', title: 'GTM advisory retainer',
      status: 'Active', monthlyFee: 7500, hoursPerMonth: 20, hoursUsed: 14, capacity: 20,
      renewal: daysFromNow(300), start: daysAgo(9),
      scope: 'Ongoing GTM strategy advisory, monthly reviews, and on-call founder support.',
      services: ['Monthly strategy review', 'GTM playbook iteration', 'On-call support'],
    },
    {
      id: 'eng-ret-2', client: 'Harbor Analytics', title: 'Fractional sales advisory',
      status: 'Proposed', monthlyFee: 6000, hoursPerMonth: 16, hoursUsed: 0, capacity: 16,
      renewal: null, start: daysFromNow(7),
      scope: 'Fractional sales leadership: playbook, hiring support, and pipeline reviews.',
      services: ['Sales playbook', 'AE hiring support', 'Weekly pipeline review'],
    },
  ],
  boards: [
    {
      id: 'eng-board-1', client: 'Lumen Robotics', title: 'Advisory board seat',
      status: 'Active', membership: 'Advisory board member', cadence: 'Quarterly',
      start: daysAgo(140), nextMeeting: daysFromNow(25),
      meetings: [
        { date: daysAgo(90), agenda: 'Series B strategy', decisions: ['Target $12M raise', 'Prioritize climate-focused funds'] },
        { date: daysAgo(10), agenda: 'Fundraising readiness', decisions: ['Rebuild deck before outreach'] },
      ],
      recommendations: ['Reframe narrative around market pull', 'Stand up a weekly fundraising cadence'],
      materials: ['Q1 board pack', 'Series B narrative draft'],
    },
  ],
  fractional: [
    {
      id: 'eng-frac-1', client: 'Harbor Analytics', title: 'Fractional Head of Sales',
      status: 'Proposed', roleDefinition: 'Interim enterprise-sales leadership',
      timeAllocation: '2 days/week', reporting: 'Reports to CEO', start: daysFromNow(7),
      responsibilities: ['Build enterprise sales playbook', 'Hire and ramp two AEs', 'Run weekly pipeline'],
      performance: [
        { label: 'Playbook shipped', target: 'Week 3', status: 'Pending' },
        { label: 'First AE hired', target: 'Week 6', status: 'Pending' },
      ],
    },
  ],
  workshops: [
    {
      id: 'eng-work-1', client: 'Beacon Fintech', title: 'Leadership strategy offsite',
      status: 'Completed', workshopType: 'Executive offsite', date: daysAgo(80),
      participants: 8, duration: '1 day',
      agenda: ['Vision alignment', 'FY priorities', 'Org design'],
      outcomes: ['Agreed FY priorities', 'New org structure drafted'],
      feedback: { rating: 4.7, note: 'Highly rated — clear alignment on priorities.' },
    },
    {
      id: 'eng-work-2', client: 'Meridian SaaS', title: 'Mid-market GTM workshop',
      status: 'Scheduled', workshopType: 'Team workshop', date: daysFromNow(12),
      participants: 12, duration: 'Half day',
      agenda: ['ICP definition', 'Sales motion design', 'Messaging'],
      outcomes: [],
      feedback: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Delivery — Sessions (meetings/notes) and Deliverables (artifacts).
// ---------------------------------------------------------------------------
export const SESSIONS = [
  {
    id: 'ses-1', client: 'Meridian SaaS', title: 'Monthly strategy review',
    date: daysAgo(6), duration: '60 min', attendees: ['Aisha Bello (CEO)', 'You'],
    recording: 'Available',
    aiSummary: 'Reviewed pipeline health and NRR trends; agreed to prioritize the mid-market motion and defer the partnerships track to next quarter.',
    notes: 'NRR up to 112%. Founder wants to move faster on mid-market. Concern about sales-team bandwidth.',
    decisions: ['Prioritize mid-market GTM', 'Defer partnerships to Q3'],
    actionItems: [
      { label: 'Share mid-market playbook', owner: 'You', due: daysFromNow(3), done: false },
      { label: 'Draft AE hiring plan', owner: 'Aisha', due: daysFromNow(10), done: false },
    ],
    followUps: ['Book mid-market GTM workshop'],
  },
  {
    id: 'ses-2', client: 'Lumen Robotics', title: 'Fundraising readiness discovery',
    date: daysAgo(10), duration: '45 min', attendees: ['Marco Diaz (Founder)', 'You'],
    recording: 'Available',
    aiSummary: 'Deck currently tells an engineering story; the highest-leverage change is reframing around market pull and building a weekly investor cadence.',
    notes: 'Strong technical team, metrics-light narrative. Needs a repeatable investor process.',
    decisions: ['Rebuild deck before investor outreach'],
    actionItems: [
      { label: 'Draft Series B narrative', owner: 'You', due: daysAgo(2), done: true },
      { label: 'Send pre-call questionnaire', owner: 'You', due: daysAgo(4), done: true },
    ],
    followUps: ['Schedule deck review'],
  },
  {
    id: 'ses-3', client: 'Atlas Commerce', title: 'Discovery interviews debrief',
    date: daysAgo(8), duration: '90 min', attendees: ['Ryan Cole (Founder)', 'Product team', 'You'],
    recording: 'Processing',
    aiSummary: 'Retention issues concentrate on first-time buyers; roadmap should prioritize onboarding and repeat-purchase incentives over new categories.',
    notes: 'Team is stretched. Roadmap lacks clear prioritization criteria.',
    decisions: ['Prioritize onboarding + repeat-purchase work'],
    actionItems: [
      { label: 'Synthesize interview findings', owner: 'You', due: daysFromNow(2), done: false },
    ],
    followUps: ['Run roadmap workshop'],
  },
  {
    id: 'ses-4', client: 'Beacon Fintech', title: 'Lending GTM working session',
    date: daysAgo(30), duration: '75 min', attendees: ['James Whitfield (COO)', 'You'],
    recording: 'Available',
    aiSummary: 'Lending launch hinges on a compliant, staged rollout; recommend a single-state pilot before multi-state expansion.',
    notes: 'Regulatory complexity is the gating factor. Strong appetite from existing SMB base.',
    decisions: ['Pilot lending in one state first'],
    actionItems: [
      { label: 'Deliver lending GTM memo', owner: 'You', due: daysAgo(28), done: true },
    ],
    followUps: ['Advisory board proposal'],
  },
];

export const DELIVERABLE_TYPES = [
  { id: 'reports', label: 'Reports' },
  { id: 'decks', label: 'Strategy Decks' },
  { id: 'models', label: 'Financial Models' },
  { id: 'research', label: 'Research' },
  { id: 'templates', label: 'Templates' },
  { id: 'playbooks', label: 'Playbooks' },
];

export const DELIVERABLES = [
  { id: 'del-1', name: 'Mid-market GTM playbook', type: 'playbooks', client: 'Meridian SaaS', status: 'Delivered', date: daysAgo(60), version: 'v1.2' },
  { id: 'del-2', name: 'Series B narrative deck', type: 'decks', client: 'Lumen Robotics', status: 'In review', date: daysAgo(45), version: 'v2' },
  { id: 'del-3', name: 'Lending go-to-market memo', type: 'reports', client: 'Beacon Fintech', status: 'Delivered', date: daysAgo(30), version: 'v1' },
  { id: 'del-4', name: 'Discovery findings deck', type: 'decks', client: 'Atlas Commerce', status: 'Draft', date: daysAgo(3), version: 'v0.3' },
  { id: 'del-5', name: 'Churn-reduction playbook', type: 'playbooks', client: 'Summit Logistics', status: 'Delivered', date: daysAgo(300), version: 'v1' },
  { id: 'del-6', name: 'Series B financial model', type: 'models', client: 'Lumen Robotics', status: 'In progress', date: daysAgo(20), version: 'v1' },
  { id: 'del-7', name: 'ICP research brief', type: 'research', client: 'Meridian SaaS', status: 'Delivered', date: daysAgo(70), version: 'v1' },
  { id: 'del-8', name: 'Board pack template', type: 'templates', client: 'Lumen Robotics', status: 'Delivered', date: daysAgo(88), version: 'v1' },
  { id: 'del-9', name: 'Enterprise sales playbook', type: 'playbooks', client: 'Harbor Analytics', status: 'Draft', date: daysAgo(1), version: 'v0.1' },
];

// ---------------------------------------------------------------------------
// Contracts — commercial documents. `docType` groups them; each has a status.
// ---------------------------------------------------------------------------
export const CONTRACT_TYPES = [
  { id: 'proposal', label: 'Proposals' },
  { id: 'sow', label: 'Statements of Work' },
  { id: 'agreement', label: 'Advisory Agreements' },
  { id: 'nda', label: 'NDAs' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'renewal', label: 'Renewals' },
];

export const CONTRACTS = [
  { id: 'con-prop-1', docType: 'proposal', title: 'Advisory board proposal', client: 'Beacon Fintech', value: 72000, status: 'Awaiting signature', created: daysAgo(4), effective: null, expires: null },
  { id: 'con-prop-2', docType: 'proposal', title: 'Fundraising sprint proposal', client: 'Vertex Mobility', value: 55000, status: 'Under review', created: daysAgo(6), effective: null, expires: null },
  { id: 'con-sow-1', docType: 'sow', title: 'Product strategy project SOW', client: 'Atlas Commerce', value: 38000, status: 'Signed', created: daysAgo(16), effective: daysAgo(15), expires: daysFromNow(60) },
  { id: 'con-sow-2', docType: 'sow', title: 'Series B narrative SOW', client: 'Lumen Robotics', value: 45000, status: 'Signed', created: daysAgo(46), effective: daysAgo(45), expires: daysFromNow(15) },
  { id: 'con-agr-1', docType: 'agreement', title: 'GTM advisory retainer agreement', client: 'Meridian SaaS', value: 90000, status: 'Active', created: daysAgo(11), effective: daysAgo(9), expires: daysFromNow(356) },
  { id: 'con-agr-2', docType: 'agreement', title: 'Board advisory agreement', client: 'Lumen Robotics', value: 60000, status: 'Active', created: daysAgo(142), effective: daysAgo(140), expires: daysFromNow(225) },
  { id: 'con-nda-1', docType: 'nda', title: 'Mutual NDA', client: 'Harbor Analytics', value: null, status: 'Signed', created: daysAgo(14), effective: daysAgo(14), expires: daysFromNow(716) },
  { id: 'con-nda-2', docType: 'nda', title: 'Mutual NDA', client: 'Vertex Mobility', value: null, status: 'Awaiting signature', created: daysAgo(6), effective: null, expires: null },
  { id: 'con-inv-1', docType: 'invoice', title: 'Invoice #2041 — March retainer', client: 'Meridian SaaS', value: 7500, status: 'Paid', created: daysAgo(38), effective: daysAgo(38), expires: null },
  { id: 'con-inv-2', docType: 'invoice', title: 'Invoice #2052 — Project milestone 1', client: 'Atlas Commerce', value: 12000, status: 'Sent', created: daysAgo(5), effective: null, expires: daysFromNow(25) },
  { id: 'con-inv-3', docType: 'invoice', title: 'Invoice #2048 — Board Q1', client: 'Lumen Robotics', value: 15000, status: 'Overdue', created: daysAgo(50), effective: null, expires: daysAgo(20) },
  { id: 'con-ren-1', docType: 'renewal', title: 'Retainer renewal — Year 2', client: 'Meridian SaaS', value: 90000, status: 'Signed', created: daysAgo(12), effective: daysAgo(9), expires: daysFromNow(356) },
  { id: 'con-ren-2', docType: 'renewal', title: 'Board seat renewal', client: 'Lumen Robotics', value: 60000, status: 'Upcoming', created: daysAgo(2), effective: null, expires: daysFromNow(225) },
];

// Lookup helpers ------------------------------------------------------------
export function opportunityById(id) {
  return OPPORTUNITIES.find((o) => o.id === id) || null;
}
export function clientById(id) {
  return CLIENTS.find((c) => c.id === id) || null;
}

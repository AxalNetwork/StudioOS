// Mock/placeholder data for the Growth section (Talent, Customers, Capital,
// Experts). Growth is a market-matching / resource-discovery surface shared by
// the Advisor and Partner profiles, so this data is deliberately role-neutral.
//
// This is a UI shell only — everything here is sample data. The shapes are kept
// flat and predictable so each array can later be replaced by a real API
// response without touching the page components. When wiring real data, swap
// these named exports for fetched data of the same shape.

// ---------------------------------------------------------------------------
// TALENT — hiring & team-building. Modules: Executive Search, Hiring Support,
// Candidate Network, Recruiters.
// ---------------------------------------------------------------------------
export const TALENT_MODULES = [
  { id: 'exec-search', name: 'Executive Search', desc: 'Senior leadership recruiting' },
  { id: 'hiring-support', name: 'Hiring Support', desc: 'Team-building beyond execs' },
  { id: 'candidate-network', name: 'Candidate Network', desc: 'Private talent database' },
  { id: 'recruiters', name: 'Recruiters', desc: 'Recruiting partners & agencies' },
];

export const TALENT_PIPELINE = [
  'Talent Need', 'Role Definition', 'Sourcing', 'Screening', 'Interviews', 'Offer', 'Hired',
];

export const TALENT_SEARCHES = [
  {
    id: 't1', module: 'exec-search', company: 'Neural AI', hiringNeed: 'VP Sales to unlock enterprise growth',
    role: 'VP Sales', seniority: 'VP / Executive', function: 'Go-to-market', location: 'San Francisco, CA (Hybrid)',
    compRange: '$220K–$280K + 0.4% equity', timeline: '8–10 weeks', stage: 'Interviews',
    pipelineCount: 14, shortlist: 3, introductions: 6, interviews: 4, feedback: 'Strong on enterprise motion; validating team-scaling.',
    outcome: 'In progress', placementStatus: 'Interviewing', recruiter: 'Bardwell Executive', hiringManager: 'Priya Nair (CEO)',
    marketAvailability: 'Tight — passive candidates only',
    candidates: [
      { name: 'Alex Martin', fitScore: 92, strengths: ['Scaled a SaaS company', 'Enterprise sales experience', 'Previous exit'], recommendation: 'Strong VP Sales candidate' },
      { name: 'Dana Cole', fitScore: 84, strengths: ['Built SDR org from 2→40', 'Vertical SaaS depth'], recommendation: 'Solid backup; less enterprise logo experience' },
      { name: 'Marcus Reid', fitScore: 78, strengths: ['Ex-founder', 'Great network'], recommendation: 'High variance — culture fit call needed' },
    ],
  },
  {
    id: 't2', module: 'exec-search', company: 'Vertex Robotics', hiringNeed: 'Founding CTO for hardware+software team',
    role: 'CTO', seniority: 'C-level', function: 'Engineering', location: 'Boston, MA (On-site)',
    compRange: '$260K–$320K + 1.5% equity', timeline: '10–14 weeks', stage: 'Sourcing',
    pipelineCount: 9, shortlist: 0, introductions: 2, interviews: 0, feedback: '—',
    outcome: 'In progress', placementStatus: 'Sourcing', recruiter: 'In-house', hiringManager: 'Sam Okafor (CEO)',
    marketAvailability: 'Very scarce — deep-tech leaders',
    candidates: [
      { name: 'Dr. Lena Wu', fitScore: 88, strengths: ['Robotics PhD', 'Shipped 3 hardware products', 'Team of 60'], recommendation: 'Top target — begin outreach' },
    ],
  },
  {
    id: 't3', module: 'hiring-support', company: 'Loop Health', hiringNeed: 'Scale product & design team (5 roles)',
    role: 'Senior Product Manager', seniority: 'Senior IC', function: 'Product', location: 'Remote (US)',
    compRange: '$150K–$180K', timeline: '6 weeks', stage: 'Screening',
    pipelineCount: 32, shortlist: 6, introductions: 0, interviews: 5, feedback: 'Two strong finalists in final loop.',
    outcome: 'In progress', placementStatus: 'Screening', recruiter: 'TalentForge', hiringManager: 'Ivy Chen (CPO)',
    marketAvailability: 'Healthy — many active candidates',
    candidates: [
      { name: 'Priya Shah', fitScore: 90, strengths: ['Health-tech PM', '0→1 launches'], recommendation: 'Advance to final loop' },
      { name: 'Tom Alvarez', fitScore: 81, strengths: ['Marketplace PM', 'Analytics depth'], recommendation: 'Advance' },
    ],
  },
  {
    id: 't4', module: 'candidate-network', company: 'Platform pool', hiringNeed: 'Warm bench for portfolio hiring',
    role: 'Engineers · Operators · Designers', seniority: 'Mixed', function: 'Cross-functional', location: 'Global',
    compRange: 'Varies', timeline: 'Ongoing', stage: 'Role Definition',
    pipelineCount: 480, shortlist: 24, introductions: 12, interviews: 0, feedback: 'Refreshed quarterly; tagged by skills & availability.',
    outcome: 'Active pool', placementStatus: 'Standing bench', recruiter: 'Internal', hiringManager: '—',
    marketAvailability: 'On-demand from private database',
    candidates: [],
  },
];

// ---------------------------------------------------------------------------
// CUSTOMERS — customer growth & sales. Modules: Customer Introductions, Sales
// Opportunities, Enterprise Introductions, Channel Partners.
// ---------------------------------------------------------------------------
export const CUSTOMER_MODULES = [
  { id: 'customer-intros', name: 'Customer Introductions', desc: 'Turn relationships into pipeline' },
  { id: 'sales-opps', name: 'Sales Opportunities', desc: 'Track deals to close' },
  { id: 'enterprise-intros', name: 'Enterprise Introductions', desc: 'Access large organizations' },
  { id: 'channel-partners', name: 'Channel Partners', desc: 'Scale distribution' },
];

export const CUSTOMER_PIPELINE = [
  'Target Account', 'Contacted', 'Meeting', 'Proposal', 'Negotiation', 'Closed Won',
];

export const CUSTOMER_TARGETS = [
  {
    id: 'c1', module: 'enterprise-intros', company: 'Acme Financial', customerTarget: 'Acme Financial — Innovation team',
    icp: 'Regulated enterprise, 5K+ employees', industry: 'Financial Services', geography: 'New York, US', accountTier: 'Tier 1 (Strategic)',
    warmIntroductions: 2, salesStage: 'Meeting', opportunityStage: 'Discovery',
    decisionMakers: ['Head of Innovation', 'VP Data Platform', 'Procurement Lead'], mutualConnections: 4,
    meetingHistory: ['Intro call — needs mapped', 'Technical deep-dive scheduled'], nextSteps: 'Send security questionnaire + ROI model',
    conversionProbability: 45, partnerSource: 'Advisor network', channelMotion: 'Direct + warm intro', revenuePotential: 240000,
  },
  {
    id: 'c2', module: 'sales-opps', company: 'BrightRetail', customerTarget: 'BrightRetail — Store Ops',
    icp: 'Mid-market retail, 500–2K employees', industry: 'Retail', geography: 'Chicago, US', accountTier: 'Tier 2',
    warmIntroductions: 1, salesStage: 'Proposal', opportunityStage: 'Proposal sent',
    decisionMakers: ['COO', 'Director of Store Ops'], mutualConnections: 2,
    meetingHistory: ['Discovery', 'Solution demo', 'Pricing review'], nextSteps: 'Negotiate annual vs multi-year terms',
    conversionProbability: 65, partnerSource: 'Channel partner', channelMotion: 'Co-sell', revenuePotential: 90000,
  },
  {
    id: 'c3', module: 'customer-intros', company: 'Northwind Logistics', customerTarget: 'Northwind — Fleet digitization',
    icp: 'Logistics, 1K+ employees', industry: 'Transportation', geography: 'Dallas, US', accountTier: 'Tier 2',
    warmIntroductions: 3, salesStage: 'Contacted', opportunityStage: 'Qualifying',
    decisionMakers: ['VP Operations', 'IT Director'], mutualConnections: 5,
    meetingHistory: ['Warm intro made'], nextSteps: 'Book discovery call with VP Operations',
    conversionProbability: 30, partnerSource: 'Mutual connection', channelMotion: 'Referral', revenuePotential: 120000,
  },
  {
    id: 'c4', module: 'channel-partners', company: 'CloudBridge (Reseller)', customerTarget: 'CloudBridge distribution deal',
    icp: 'Regional VAR with mid-market base', industry: 'IT Services', geography: 'EMEA', accountTier: 'Tier 1 (Channel)',
    warmIntroductions: 1, salesStage: 'Negotiation', opportunityStage: 'Partnership terms',
    decisionMakers: ['Channel Director', 'Head of Partnerships'], mutualConnections: 1,
    meetingHistory: ['Partner fit call', 'Enablement plan review'], nextSteps: 'Finalize revenue-share agreement',
    conversionProbability: 70, partnerSource: 'Platform marketplace', channelMotion: 'Reseller', revenuePotential: 320000,
  },
];

// ---------------------------------------------------------------------------
// CAPITAL — fundraising & financial resources. Modules: Investor Introductions,
// VC Firms, Angel Investors, Family Offices, Grants.
// ---------------------------------------------------------------------------
export const CAPITAL_MODULES = [
  { id: 'investor-intros', name: 'Investor Introductions', desc: 'Match founders to investors' },
  { id: 'vc-firms', name: 'VC Firms', desc: 'Venture investor database' },
  { id: 'angels', name: 'Angel Investors', desc: 'Individual investor network' },
  { id: 'family-offices', name: 'Family Offices', desc: 'Private capital relationships' },
  { id: 'grants', name: 'Grants', desc: 'Non-dilutive capital' },
];

export const CAPITAL_TARGETS = [
  {
    id: 'k1', module: 'investor-intros', company: 'AI Security Co', raiseType: 'Equity', round: 'Series A',
    targetAmount: 12000000, stage: 'Raising', ticketSize: '$2M–$5M', geography: 'US / West Coast',
    sectorFocus: 'Cybersecurity · AI', investorFit: 94, warmIntroPaths: ['Advisor → Cyber VC partner', 'Portfolio founder → Enterprise SaaS VC'],
    meetings: 12, followUps: 5, interestLevel: 'High', diligenceStatus: 'Data room shared', termDiscussions: 'Two term sheets expected',
    grantDeadline: null, fundingProbability: 72, closeLikelihood: 'Likely (this quarter)',
    matchedInvestors: [
      { name: 'Cyber VC', match: 94 }, { name: 'Enterprise SaaS VC', match: 89 }, { name: 'AI Specialists Fund', match: 86 },
    ],
  },
  {
    id: 'k2', module: 'vc-firms', company: 'GreenGrid', raiseType: 'Equity', round: 'Seed',
    targetAmount: 3500000, stage: 'Building pipeline', ticketSize: '$500K–$1.5M', geography: 'Europe',
    sectorFocus: 'Climate · Energy', investorFit: 81, warmIntroPaths: ['Advisor → Climate fund GP'],
    meetings: 4, followUps: 2, interestLevel: 'Medium', diligenceStatus: 'Intro deck sent', termDiscussions: 'None yet',
    grantDeadline: null, fundingProbability: 40, closeLikelihood: 'Early — nurturing',
    matchedInvestors: [{ name: 'Climate Ventures', match: 85 }, { name: 'Energy Seed Fund', match: 79 }],
  },
  {
    id: 'k3', module: 'angels', company: 'Loop Health', raiseType: 'SAFE', round: 'Pre-seed extension',
    targetAmount: 750000, stage: 'Raising', ticketSize: '$25K–$100K', geography: 'US',
    sectorFocus: 'Health-tech', investorFit: 88, warmIntroPaths: ['Advisor → 3 health-tech angels', 'Syndicate lead intro'],
    meetings: 8, followUps: 3, interestLevel: 'High', diligenceStatus: 'Rolling', termDiscussions: 'SAFE cap agreed',
    grantDeadline: null, fundingProbability: 68, closeLikelihood: 'Likely',
    matchedInvestors: [{ name: 'HealthAngels Syndicate', match: 90 }, { name: 'Dr. Sarah Lee (angel)', match: 84 }],
  },
  {
    id: 'k4', module: 'grants', company: 'Vertex Robotics', raiseType: 'Non-dilutive', round: 'Grant',
    targetAmount: 500000, stage: 'Applying', ticketSize: 'Up to $500K', geography: 'US (Federal)',
    sectorFocus: 'Deep-tech · Robotics', investorFit: 76, warmIntroPaths: ['Program officer intro via advisor'],
    meetings: 1, followUps: 1, interestLevel: 'Medium', diligenceStatus: 'Eligibility confirmed', termDiscussions: 'N/A',
    grantDeadline: '2026-09-15', fundingProbability: 50, closeLikelihood: 'Deadline-driven',
    matchedInvestors: [{ name: 'SBIR Phase II', match: 82 }, { name: 'State Innovation Grant', match: 71 }],
  },
];

// ---------------------------------------------------------------------------
// EXPERTS — subject-matter expertise & mentorship. Modules: Subject Matter
// Experts, Advisors, Mentors, Coaches.
// ---------------------------------------------------------------------------
export const EXPERT_MODULES = [
  { id: 'sme', name: 'Subject Matter Experts', desc: 'Domain specialists' },
  { id: 'advisors', name: 'Advisors', desc: 'Experienced operators' },
  { id: 'mentors', name: 'Mentors', desc: 'Founder & team support' },
  { id: 'coaches', name: 'Coaches', desc: 'Leadership development' },
];

export const EXPERTS = [
  {
    id: 'e1', module: 'sme', name: 'Dr. Sarah Lee', expertiseArea: 'Healthcare Regulatory & Compliance',
    background: 'Former FDA reviewer; advised 20+ health-tech startups', industryFocus: 'Health-tech · Medical devices',
    experienceLevel: '20+ years', availability: '2 sessions / month', introPath: 'Advisor → direct',
    sessionHistory: ['Regulatory pathway review', 'FDA submission prep'], matchStrength: 95, engagementType: 'Advisory sessions',
    outcome: 'Cleared regulatory blocker for Loop Health', notes: 'Best for pre-submission strategy.',
    references: ['Loop Health (CPO)', 'MedFlow (CEO)'], fitScore: 95, rate: '$450 / hr', language: 'English', geography: 'Boston, US',
  },
  {
    id: 'e2', module: 'advisors', name: 'Marcus Bell', expertiseArea: 'Enterprise GTM & Sales',
    background: 'Ex-VP Sales at two unicorns; scaled ARR $5M→$120M', industryFocus: 'B2B SaaS',
    experienceLevel: '15+ years', availability: 'Monthly retainer', introPath: 'Platform match',
    sessionHistory: ['GTM strategy sprint', 'Sales org design'], matchStrength: 91, engagementType: 'Ongoing advisor',
    outcome: 'Rebuilt Neural AI sales motion', notes: 'Takes equity-based engagements.',
    references: ['Neural AI (CEO)'], fitScore: 91, rate: '0.25% equity + $2K/mo', language: 'English', geography: 'Austin, US',
  },
  {
    id: 'e3', module: 'mentors', name: 'Ana Ruiz', expertiseArea: 'First-time Founder Coaching',
    background: 'Two-time founder (1 exit); mentors early-stage teams', industryFocus: 'Consumer · Marketplace',
    experienceLevel: '12 years', availability: 'Weekly office hours', introPath: 'Mentorship program',
    sessionHistory: ['Fundraising narrative', 'Co-founder dynamics'], matchStrength: 87, engagementType: 'Mentorship program',
    outcome: 'Guided 3 teams through pre-seed', notes: 'Great with founder wellbeing.',
    references: ['GreenGrid (CEO)'], fitScore: 87, rate: 'Pro bono (program)', language: 'English · Spanish', geography: 'Remote',
  },
  {
    id: 'e4', module: 'coaches', name: 'David Kim', expertiseArea: 'Executive Leadership Coaching',
    background: 'ICF-certified; coaches C-suite at growth-stage startups', industryFocus: 'Cross-industry',
    experienceLevel: '18 years', availability: 'Bi-weekly', introPath: 'Advisor → intro',
    sessionHistory: ['CEO 1:1 cadence', 'Leadership team offsite'], matchStrength: 83, engagementType: 'Coaching engagement',
    outcome: 'Improved exec team alignment scores', notes: 'Structured 6-month programs.',
    references: ['Vertex Robotics (CEO)'], fitScore: 83, rate: '$350 / session', language: 'English · Korean', geography: 'Seattle, US',
  },
];

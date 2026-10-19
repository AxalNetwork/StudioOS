// D773 (#2099), PR 1 — every option the operating partner's boards offer that
// runs a model, for the rail (D720 §11) and for D764 PR 3 (#2089). The shape
// and the rule are `advisor.js`'s; `page` is the canvas's name from
// profiles["Operating Partner"], so Delivery's `board` zone is "Engagements",
// `status-reports` is "Reporting", and Research's `markets` is "Market".
//
// An option that runs no model (a CSV export, a manual write, the status
// report's "Compose from the record", which the Worker builds in SQL) is not
// listed: the rail does not offer it.

const INTERVIEW = 'components/advisor/PersonalAdvisor.jsx';
const draft = (page, route, key, label, kind, file, surface) =>
  ({ page, route, key, label, kind, handler: 'draft', source: { file, marker: `surface="${surface}"` } });

export const PARTNER_RAIL_OPTIONS = [
  // Home — the Eadwyn interview, then the firm's brief in `PartnerHomeP2`.
  { page: 'Home', route: '/studio', key: 'answer:interview', label: 'Answer the interview', kind: 'chat', handler: 'form',
    source: { file: INTERVIEW, marker: 'api.advisor.toolAuto(' } },
  { page: 'Home', route: '/studio', key: 'explain:question', label: 'Explain this question', kind: 'chat', handler: 'form',
    source: { file: INTERVIEW, marker: 'onExplain={() => openTutor(' } },
  { page: 'Home', route: '/studio', key: 'transcribe:voice-answer', label: 'Record a voice answer', kind: 'speech', handler: 'transcribe',
    source: { file: INTERVIEW, marker: 'api.advisor.transcribe(' } },
  draft('Home', '/studio', 'draft:operating-brief', "Compose today's brief", 'plan', 'pages/partner/PartnerHomeP2.jsx', 'home/brief'),

  // Pipeline
  draft('Leads', '/pipeline/leads', 'draft:proposal', 'Draft the proposal', 'write', 'pages/partner/pipeline/LeadsZone.jsx', 'pipeline/leads'),
  draft('Proposals', '/pipeline/proposals', 'draft:win-loss-read', 'Read the book', 'synth', 'pages/partner/pipeline/ProposalsZone.jsx', 'pipeline/proposals'),
  draft('Negotiations', '/pipeline/negotiations', 'draft:counter', 'Draft the counter', 'legal', 'pages/partner/pipeline/NegotiationsZone.jsx', 'pipeline/negotiations'),
  draft('Retainers', '/pipeline/retainers', 'draft:renewal-risk', 'Read the book', 'numbers', 'pages/partner/pipeline/RetainersZone.jsx', 'pipeline/retainers'),
  draft('Analytics', '/pipeline/analytics', 'draft:quarter-narrative', 'Narrate the quarter', 'numbers', 'pages/partner/pipeline/AnalyticsZone.jsx', 'pipeline/analytics'),

  // Delivery
  draft('Engagements', '/delivery/board', 'draft:board-read', 'Read the board', 'plan', 'pages/partner/delivery/BoardZone.jsx', 'delivery/board'),
  draft('Deliverables', '/delivery/deliverables', 'draft:chases', 'Draft the chases', 'write', 'pages/partner/delivery/DeliverablesZone.jsx', 'delivery/deliverables'),
  draft('Capacity', '/delivery/capacity', 'draft:capacity-findings', 'Read the roster', 'plan', 'pages/partner/delivery/CapacityZone.jsx', 'delivery/capacity'),
  draft('Reporting', '/delivery/status-reports', 'draft:weekly-reports', 'Draft the batch', 'write', 'pages/partner/delivery/StatusReportsZone.jsx', 'delivery/status-reports'),
  draft('Health', '/delivery/health', 'draft:renewal-risk', 'Read the book', 'synth', 'pages/partner/delivery/HealthZone.jsx', 'delivery/health'),

  // Offers
  draft('Catalog', '/offers/catalog', 'draft:catalog-read', 'Read the catalog', 'write', 'pages/ServiceCatalogPage.jsx', 'offers/catalog'),
  draft('Perk deals', '/offers/perk-deals', 'draft:expiry-consequences', 'Read the expiries', 'reason', 'pages/PerksPage.jsx', 'offers/perk-deals'),
  draft('Visibility', '/offers/visibility', 'draft:attribution-read', 'Read the attribution', 'numbers', 'pages/partner/offers/VisibilityZone.jsx', 'offers/visibility'),
  draft('Proof', '/offers/proof', 'draft:consent-requests', 'Draft the requests', 'write', 'pages/partner/offers/ProofZone.jsx', 'offers/proof'),
  draft('Audience fit', '/offers/audience-fit', 'draft:pass-reasons', 'Draft the passes', 'match', 'pages/partner/offers/AudienceFitZone.jsx', 'offers/audience-fit'),

  // Network
  draft('Relationships', '/network/relationships', 'draft:orphan-reassignment', 'Draft the reassignment', 'match', 'pages/RelationshipsPage.jsx', 'network/relationships'),
  draft('Introductions', '/network/introductions', 'suggest:paths', 'Suggest paths', 'match', 'pages/IntroductionsPanel.jsx', 'network/introductions'),
  draft('Organizations', '/network/organizations', 'draft:single-contact-exposure', 'Draft the exposure', 'synth', 'pages/partner/OrganizationsZone.jsx', 'network/organizations'),

  // Research — the same components the advisor's Research reads.
  { page: 'Ask', route: '/research/ask', key: 'ask:library', label: 'Ask', kind: 'research', handler: 'form',
    source: { file: 'pages/research/AskZone.jsx', marker: 'api.research.ask(' } },
  draft('Ask', '/research/ask', 'draft:session-brief', 'Draft the brief', 'synth', 'pages/research/AskZone.jsx', 'research/ask'),
  draft('Client prep', '/research/client-prep', 'draft:checkpoint-brief', 'Draft the brief', 'synth', 'pages/research/ClientPrepZone.jsx', 'research/client-prep'),
  { page: 'Library', route: '/research/library', key: 'upload:document', label: 'Add to library', kind: 'search', handler: 'upload',
    source: { file: 'pages/research/LibraryZone.jsx', marker: 'type="file"' } },
  { page: 'Library', route: '/research/library', key: 'reindex:document', label: 'Re-index', kind: 'search', handler: 'form',
    source: { file: 'pages/research/LibraryZone.jsx', marker: 'api.research.reindex(' } },
  draft('Library', '/research/library', 'draft:index-gaps', 'Draft the gaps', 'synth', 'pages/research/LibraryZone.jsx', 'research/library'),
];

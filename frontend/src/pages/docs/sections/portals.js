export default {
  id: 'portals',
  title: 'Portal Experiences',
  icon: 'LayoutDashboard',
  subsections: [
    {
      id: 'portfolio-health',
      title: 'Investor Portfolio Health',
      overview:
        "Portfolio Health gives investors a one-screen read on every company they’ve backed: traffic-light status, this month’s metrics, upcoming capital calls, and a watchlist of follow-on candidates.",
      howto: [
        'Open Investor Portal → Portfolio Health.',
        'Filter by sector, stage, or status.',
        'Click any company for the deep view: metrics, updates, cap table snapshot.',
      ],
      tips: [
        'Status is computed from metric trend lines — yellow means a metric slipped this month, not the whole company.',
        'Use the Watchlist to flag companies you want to add to in the next round.',
      ],
      pitfalls: [
        'Reading the green light as “all clear” can miss a slow burn — open the deep view monthly.',
        'A red light without a recent update may mean stale data, not a failing company; check the last-updated stamp.',
      ],
      related: [
        { label: 'Funds, Reserves, Waterfall', href: '#capital/funds' },
        { label: 'Investor billing & tiers', href: '#account/investor-billing' },
      ],
    },
    {
      id: 'partner',
      title: 'Partner Portal',
      overview:
        "The Partner Portal is the home for service providers: your service catalog, current engagements, the Needs Board with active RFPs, demand insights, and your office-hours schedule.",
      howto: [
        'Open Partner Portal from the sidebar (default landing page for partner accounts).',
        'Manage your service listings under My Service Catalogue.',
        'Respond to RFPs from the Needs Board.',
        'Publish open slots under My Office Hours.',
      ],
      tips: [
        'Demand Insights tells you which service categories founders want most — a great signal for pricing or new offerings.',
        'Fast response time is the biggest differentiator on the Needs Board.',
      ],
      pitfalls: [
        'Listing services without sample work or reviews leaves you below partners who do — fill the profile out fully.',
        'Ignoring Needs Board RFPs for more than 24 hours costs you most of the deal flow.',
      ],
      related: [
        { label: 'Marketplace', href: '#network/marketplace' },
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
        { label: 'Partner deal engine', href: '#partnerships/deal-engine' },
      ],
    },
    {
      id: 'advisor',
      title: 'Advisor Engagements',
      overview:
        "Advisors get a focused portal for booked sessions, mentee notes, and feedback after each meeting. Reflections are private to you and the studio team unless you share them.",
      howto: [
        'Open Advisors → My Engagements.',
        'See upcoming sessions with prep notes from each mentee.',
        'After each session, capture a short reflection.',
      ],
      tips: [
        'Patterns across mentees are gold — the studio team uses them to identify systemic gaps in the program.',
        'Time-block your office hours so mentees can find slots without a back-and-forth.',
      ],
      pitfalls: [
        'Skipping the reflection means the next session starts cold — even one sentence helps.',
        'Publishing too many slots and then cancelling hurts your match score; publish what you can keep.',
      ],
      related: [
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
      ],
    },
  ],
};

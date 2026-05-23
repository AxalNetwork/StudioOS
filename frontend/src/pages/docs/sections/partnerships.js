export default {
  id: 'partnerships',
  title: 'Partnerships',
  icon: 'Network',
  subsections: [
    {
      id: 'overview',
      title: 'Partnerships overview',
      overview:
        "Partnerships covers two distinct tracks: the partner deal engine (a structured pipeline for partner-sourced opportunities) and partner onboarding (joining the studio as a service provider). Both share a single dashboard so partners and admins can see deal status and onboarding progress side by side.",
      howto: [
        'Open Partnerships from the sidebar to land on the dashboard.',
        'Use the Pipeline tab for active partner-sourced deals.',
        'Use the Onboarding tab when you (or a new partner) is joining the studio.',
      ],
      tips: [
        'Partner-sourced deals carry the partner’s tag through the lifecycle — useful for reporting later.',
        'Onboarding milestones unlock the Marketplace listing once complete.',
      ],
      pitfalls: [
        'Skipping the deal-source field hides which partners are driving pipeline — fill it on every deal.',
        'Onboarding without a published service catalogue leaves the partner invisible to founders.',
      ],
      related: [
        { label: 'Partner deal engine', href: '#partnerships/deal-engine' },
        { label: 'Partner onboarding', href: '#partnerships/onboarding' },
        { label: 'Partner Portal', href: '#portals/partner' },
      ],
    },
    {
      id: 'deal-engine',
      title: 'Partner deal engine',
      overview:
        "The deal engine is a stage-based pipeline (sourced → vetted → in-diligence → committed → closed) for opportunities partners bring into the studio. Partners earn credit on the Network Effects board for sourced deals that close, with optional revenue share.",
      howto: [
        'Open Partnerships → Pipeline.',
        'Click "Source a deal" and capture company, contact, and source notes.',
        'Move the deal across stages as it progresses; admins approve stage changes that gate compensation.',
        'On close, the deal logs against your partner profile and on the Network Effects leaderboard.',
      ],
      tips: [
        'Add a one-paragraph rationale on every sourced deal — admins use it to prioritise diligence.',
        'Tag the deal with the relevant sector so it routes to the right reviewer faster.',
      ],
      pitfalls: [
        'Sourcing the same deal twice (once per partner) is detected and credited to the earliest source.',
        'Moving a deal to "committed" without a signed term sheet rolls back when admins audit the stage.',
      ],
      related: [
        { label: 'Partner Portal', href: '#portals/partner' },
        { label: 'Partner counters', href: '#partnerships/counters' },
      ],
    },
    {
      id: 'onboarding',
      title: 'Partner onboarding',
      overview:
        "Partner onboarding is a guided flow for new service providers: company profile, service catalogue, references, KYC, and an admin verification step. A chatbot walks you through each step and surfaces examples from comparable partners.",
      howto: [
        'Receive an invite from an admin, or apply via the public partner-application page.',
        'Complete company profile, services, and pricing.',
        'Upload references; the chatbot can suggest categories and pricing bands based on similar partners.',
        'Pass KYC and admin verification — the Marketplace listing goes live once verified.',
      ],
      tips: [
        'Three references is the sweet spot — more is fine but doesn’t move verification faster.',
        'Use the chatbot’s pricing-band suggestion as a starting point, then adjust to your positioning.',
      ],
      pitfalls: [
        'Listing services without sample work or case studies hurts conversion — add at least one per category.',
        'Skipping KYC blocks the listing from going live even after admin verification.',
      ],
      related: [
        { label: 'Partner deal engine', href: '#partnerships/deal-engine' },
        { label: 'KYC', href: '#legal/kyc' },
      ],
    },
    {
      id: 'co-marketing',
      title: 'Co-marketing requests',
      overview:
        "Co-marketing requests let founders and partners formally propose joint announcements — case studies, blog posts, webinars, or social pushes — with scope, deadline, and amplification plan agreed up front. Both sides see the same request and status in one place.",
      howto: [
        'Open the partner card from the Marketplace or the partner directory.',
        'Click "Propose co-marketing" and describe the format, scope, deadline, and what each side will amplify.',
        'The partner reviews and either accepts, edits, or rejects with a reason.',
        'Once accepted, both sides track delivery and publication date in the same engagement view.',
      ],
      tips: [
        'A short proposal with a clear ask outperforms a long one — partners triage many requests.',
        'Capture the agreed publish date in the engagement so both sides can amplify on launch.',
      ],
      pitfalls: [
        'Sending a co-marketing request without a draft outline forces the partner to do the framing work — attach one if you can.',
        'Skipping the amplification plan often means the piece ships without the audience reach both sides expected.',
      ],
      related: [
        { label: 'Partners & Co-marketing', href: '#network/partners' },
        { label: 'Marketplace', href: '#network/marketplace' },
      ],
    },
    {
      id: 'counters',
      title: 'Partner & admin counters',
      overview:
        "Counters are the operational metrics partners and admins see in the Partnerships dashboard: sourced deals, accepted deals, in-diligence count, win rate, average days-to-close, and revenue share earned to date.",
      howto: [
        'Open Partnerships → Dashboard.',
        'Filter the counters by date range, sector, or partner.',
        'Drill into any counter to see the underlying deals.',
      ],
      tips: [
        'Win rate matters more than raw sourced count — quality over quantity.',
        'Days-to-close benchmarks your sourcing against the rest of the partner network.',
      ],
      pitfalls: [
        'Counters lag a few minutes behind stage changes — reload if you just moved a deal.',
        'Revenue share is only credited when the deal stage hits "closed"; earlier stages are forecasts, not entitlements.',
      ],
      related: [
        { label: 'Partner deal engine', href: '#partnerships/deal-engine' },
        { label: 'Network Effects', href: '#network/effects' },
      ],
    },
  ],
};

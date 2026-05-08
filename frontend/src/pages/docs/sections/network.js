export default {
  id: 'network',
  title: 'Network',
  icon: 'Network',
  subsections: [
    {
      id: 'marketplace',
      title: 'Marketplace',
      overview:
        "The Marketplace is where founders find vetted service providers (legal, accounting, design, GTM, engineering) and where partners list their services. Browse by category, see ratings, and book directly.",
      howto: [
        'Open Marketplace from the Network sidebar.',
        'Browse by category or search by keyword.',
        'Open a partner card to see services, pricing, and past engagement reviews.',
        'Click "Engage" to start a conversation and scope the work.',
      ],
      tips: [
        'Read past reviews — they’re the best signal of fit.',
        'Get a quote in writing before starting; engagements track scope and price.',
      ],
      related: [
        { label: 'Partners & Co-marketing', href: '#network/partners' },
        { label: 'Public Directory', href: '#network/directory' },
      ],
    },
    {
      id: 'partners',
      title: 'Partners & Co-marketing',
      overview:
        "Partners are the studio’s vetted service providers. The Co-marketing space lets founders and partners run joint announcements (case studies, blog posts, webinars) that benefit both audiences.",
      howto: [
        'Partners — list services in the Marketplace and publish office hours.',
        'Founders — propose a co-marketing piece via the Partner card.',
        'Both sides agree on scope, deadline, and amplification plan.',
      ],
      tips: [
        'Case studies are the highest-leverage co-marketing — they help the partner sell and build founder credibility.',
        'Set the publish date in advance so both sides can amplify on launch.',
      ],
      related: [
        { label: 'Marketplace', href: '#network/marketplace' },
      ],
    },
    {
      id: 'directory',
      title: 'Public Directory',
      overview:
        "The Public Directory is the opt-in, public-facing list of founders, partners, and mentors. Each entry has a public profile page (/u/<slug>) you can share. You control whether you appear in Settings → Privacy.",
      howto: [
        'Open Settings → Privacy and toggle "Show me in the Public Directory".',
        'Set your public profile slug in Settings → Profile.',
        'Visit /u/<your-slug> to see how the world will see you.',
      ],
      tips: [
        'Visibility is real-time — toggling off removes you from the directory immediately.',
        'Email and personal contact details are never published, only your name, role, bio, and (optionally) social links.',
      ],
      related: [
        { label: 'Settings → Privacy', href: '#account/privacy' },
        { label: 'Settings → Profile', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'refer-earn',
      title: 'Refer & Earn',
      overview:
        "Refer & Earn rewards you for bringing new founders, investors, and partners into the platform. Each successful referral earns commission (varies by tier and role) tracked in your account.",
      howto: [
        'Open Refer & Earn from the sidebar.',
        'Copy your unique referral link.',
        'Share via LinkedIn, email, or any other channel.',
        'Earnings appear in your Payouts tab once the referral converts.',
      ],
      tips: [
        'Personal intros convert ~10x better than generic share links — write a sentence or two.',
        'Earnings vest based on the referred user staying active; check the terms in Refer & Earn for the schedule.',
      ],
      related: [
        { label: 'Network Effects', href: '#network/effects' },
      ],
    },
    {
      id: 'effects',
      title: 'Network Effects',
      overview:
        "Network Effects shows you the strength of your network: introductions made, intros received, value delivered, and the second-degree reach you’ve unlocked. It’s the leaderboard for being a great network member.",
      howto: [
        'Open Network Effects from the sidebar.',
        'See your introductions made, accepted, and reciprocated.',
        'View your second-degree reach — who you can reach via one intro.',
      ],
      tips: [
        'The best way to climb the leaderboard is to make great intros — quality, not quantity.',
        'Track value delivered (deals closed, hires made) so the studio can recognize top connectors.',
      ],
      related: [
        { label: 'Refer & Earn', href: '#network/refer-earn' },
      ],
    },
  ],
};

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
      pitfalls: [
        'Starting work before the engagement is scoped and accepted leaves you without payment protection.',
        'Picking on price alone — the cheapest legal or accounting work is rarely the cheapest in the long run.',
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
      pitfalls: [
        'Co-marketing without a written scope leads to drift and missed deadlines — capture it in the engagement.',
        'Forgetting to credit both sides on launch hurts the relationship more than the post helps.',
      ],
      related: [
        { label: 'Marketplace', href: '#network/marketplace' },
        { label: 'Partnerships overview', href: '#partnerships/overview' },
      ],
    },
    {
      id: 'directory',
      title: 'Public Directory',
      overview:
        "The Public Directory is the opt-in, public-facing list of founders, partners, and advisors. Each entry has a public profile page (/u/<slug>) you can share. You control whether you appear in Settings → Privacy.",
      howto: [
        'Open Settings → Privacy and toggle "Show me in the Public Directory".',
        'Set your public profile slug in Settings → Profile.',
        'Visit /u/<your-slug> to see how the world will see you.',
      ],
      tips: [
        'Visibility is real-time — toggling off removes you from the directory immediately.',
        'Email and personal contact details are never published, only your name, role, bio, and (optionally) social links.',
      ],
      pitfalls: [
        'Picking a slug that conflicts with a brand can be reclaimed by the brand owner — pick something you control.',
        'Going public before your profile is filled in leaves a sparse listing that hurts more than it helps.',
      ],
      related: [
        { label: 'Settings → Privacy', href: '#account/privacy' },
        { label: 'Settings → Profile', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'articles',
      title: 'Articles (write, submit, read)',
      overview:
        "Trusted members — founders, investors, partners, advisors — can write industry insights and how-tos for the public news feed. Drafts auto-save as you type, submissions go through a quick review by the studio team, and you get notified at every step.",
      howto: [
        'Open the Articles page from the sidebar.',
        'Click "New draft", give it a title and subtitle, pick a sector, and write in the markdown editor with live preview.',
        'Drag-and-drop a cover image (jpg, png, or webp, up to 5 MB).',
        'When you\'re ready, click "Submit for review" — the studio team gets notified and you\'ll see comments or an approval inside the same view.',
        'Read published articles on the public news feed at axal.vc/news.',
      ],
      tips: [
        'Drafts save as you type — close the tab any time and your work will be waiting.',
        'You can submit up to three articles per week; quality lands faster than volume.',
        'Articles by trusted authors (KYC + signed partner deals + a clean 90 days) get prioritised in the queue.',
      ],
      pitfalls: [
        'Including personal details (emails, phone numbers, tax IDs) in an article will block submission until they are removed — the privacy check is strict.',
        'Once published, articles cache on the public site for up to 60 days; small typo fixes are immediate, but reorganising headings can take time to propagate.',
      ],
      related: [
        { label: 'Public Directory', href: '#network/directory' },
      ],
    },
    {
      id: 'relationships',
      title: 'Relationships',
      overview:
        "Relationships is your private rolodex inside the platform — the people you've met through the studio, the introductions you've made and received, and the notes you keep on each contact. It complements the Network Effects leaderboard with a working view of who you actually know.",
      howto: [
        'Open Relationships from the sidebar.',
        'Browse contacts by name, role, or last interaction.',
        'Add private notes on any contact — only you see them.',
        'Use the "Request intro" action to ask a mutual contact for a warm introduction.',
      ],
      tips: [
        'Tag contacts you intend to follow up with — the page lets you filter by tag.',
        'A short note after every meeting compounds quickly; future-you will thank present-you.',
      ],
      pitfalls: [
        'Private notes are not part of your data export today; treat them as platform-local memory.',
        'Asking for an intro without context lands at the bottom of the mutual\'s queue — a one-liner reason raises the response rate dramatically.',
      ],
      related: [
        { label: 'Network Effects', href: '#network/effects' },
        { label: 'Matches', href: '#network/matches' },
      ],
    },
    {
      id: 'matches',
      title: 'Matches (co-founders & advisors)',
      overview:
        "Matches is one page that surfaces the platform's suggestions across co-founders, advisors, and partner introductions. The algorithm uses your persona, sector, time commitment, and recent activity — you stay in control of who you reach out to.",
      howto: [
        'Open Matches from the Network sidebar.',
        'Browse the three tabs — Co-founders, Advisors, and Partners — each shows ranked suggestions.',
        'Like, pass, or open a profile from the card.',
        'A chat unlocks when both sides like each other (co-founders) or when an advisor accepts (advisors).',
      ],
      tips: [
        'Update your profile and persona regularly — matches improve with every change.',
        'Pass on a suggestion to remove it from future rankings; it won\'t resurface.',
      ],
      pitfalls: [
        'Reaching out outside the platform skips the chemistry signal both sides see — keep first contact in-app for better matches later.',
        'A long list of "likes" with no follow-through looks the same to the algorithm as a low signal — act on what you like.',
      ],
      related: [
        { label: 'Co-founder Match', href: '#validate-grow/cofounder-match' },
        { label: 'Advisors & booking sessions', href: '#validate-grow/advisors' },
      ],
    },
    {
      id: 'refer-earn',
      title: 'Refer & Earn',
      overview:
        "Refer & Earn rewards you for bringing new founders, investors, and partners into the platform. Each successful referral earns commission (varies by tier and role) tracked in your account. It lives in the Referrals workspace, alongside the Payouts tab where you collect what you earn.",
      howto: [
        'Open Referrals from the sidebar (the Refer & Earn tab is shown by default).',
        'Copy your unique referral link.',
        'Share via LinkedIn, email, or any other channel.',
        'Earnings appear in the Payouts tab of the same workspace once the referral converts.',
      ],
      tips: [
        'Personal intros convert ~10x better than generic share links — write a sentence or two.',
        'Earnings vest based on the referred user staying active; check the terms in the Refer & Earn tab for the schedule.',
      ],
      pitfalls: [
        'Referring yourself with an alternate email is detected and forfeits earnings.',
        'Sharing in spammy channels can get your link blacklisted by referees’ employers.',
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
      pitfalls: [
        'Mass-introducing without checking both sides want the intro hurts your score and your reputation.',
        'Refusing to log accepted intros leaves your second-degree reach under-counted.',
      ],
      related: [
        { label: 'Refer & Earn', href: '#network/refer-earn' },
      ],
    },
  ],
};

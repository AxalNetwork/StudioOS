export default {
  id: 'validate-grow',
  title: 'Validate & Grow',
  icon: 'TrendingUp',
  subsections: [
    {
      id: 'scoring',
      title: 'Scoring',
      overview:
        "Scoring runs your project through a 100-point algorithm covering Market, Team, Product, Capital, Strategic Fit, and Distribution. Tier 1 (≥85) is fast-tracked, Tier 2 (70–84) gets conditional next steps, and below 70 means more validation is needed before re-submitting.",
      howto: [
        'Open Scoring from your project menu.',
        'Confirm or update the inputs (TAM, team experience, MVP cost, etc.).',
        'Click "Run scoring" — results appear in seconds with per-dimension breakdowns.',
        'Review the lowest-scoring dimensions and use them to focus your next iteration.',
      ],
      tips: [
        'Re-score after major milestones — first revenue, key hire, signed LOI — to track momentum.',
        'The dimension explanations call out what you’re missing so you know what to improve.',
      ],
      related: [
        { label: 'Market Intelligence', href: '#validate-grow/market-intel' },
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
    {
      id: 'mentors',
      title: 'Mentors & booking sessions',
      overview:
        "Mentors are domain experts (operators, ex-founders, functional leaders) you can book time with. Browse the directory, filter by expertise, and book a 30- or 60-minute session that lands on both calendars.",
      howto: [
        'Open Mentors from the Network sidebar group.',
        'Filter by expertise, sector, or availability.',
        'Click a mentor to view their bio and open slots, then pick a time and book.',
        'You’ll get a calendar invite with a join link; the mentor gets the same.',
      ],
      tips: [
        'Send a one-paragraph context note when you book — mentors prepare better with a clear ask.',
        'Capture the mentor’s feedback in your Decision Journal so you don’t lose it.',
      ],
      related: [
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
        { label: 'Settings → Integrations (calendar)', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'office-hours',
      title: 'Office Hours',
      overview:
        "Office Hours are recurring open slots that mentors and partners publish. Drop in for a 15-minute conversation without the formality of a full mentor booking — great for quick questions or a second opinion.",
      howto: [
        'Open Office Hours and pick a host with availability this week.',
        'Choose a 15-minute slot and confirm.',
        'Show up with one specific question — the format rewards crisp asks.',
      ],
      tips: [
        'Slots fill fast on Mondays — book on Friday for the following week.',
        'Recurring problems? Convert to a full mentor booking instead.',
      ],
      related: [
        { label: 'Mentors', href: '#validate-grow/mentors' },
        { label: 'Partners & Co-marketing', href: '#network/partners' },
      ],
    },
    {
      id: 'cofounder-match',
      title: 'Co-founder Match',
      overview:
        "Co-founder Match introduces solo founders to candidates with complementary skills, time availability, and chemistry signals. Profiles are private until both sides opt in to a conversation.",
      howto: [
        'Open Co-founder Match and complete your profile (skills, time commitment, location, motivations).',
        'Review match suggestions, like or pass on each.',
        'When two people both like each other a chat unlocks.',
        'When you’re ready to commit, run the Cofounder Agreement flow.',
      ],
      tips: [
        'Be honest about time commitment — mismatch here causes more breakups than equity.',
        'Try a paid trial project together before signing the agreement.',
      ],
      related: [
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
      ],
    },
    {
      id: 'market-intel',
      title: 'Market Intelligence',
      overview:
        "Market Intelligence aggregates sector signals, funding activity, competitive moves, and studio benchmarks for the spaces you care about. It’s a daily-readable feed you can filter by sector and signal type.",
      howto: [
        'Open Market Intel from the sidebar.',
        'Pick the sectors you want to track.',
        'Save signals to your Watchlist for follow-up; star the most important ones.',
      ],
      tips: [
        'Read the Friday digest if you only have time for one read per week.',
        'The conviction picks list highlights ideas the studio team is actively interested in.',
      ],
      related: [
        { label: 'Watchlist & Decision Journal', href: '#capital/investors' },
      ],
    },
  ],
};

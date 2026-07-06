export default {
  id: 'validate-grow',
  title: 'Validate & Grow',
  icon: 'TrendingUp',
  subsections: [
    {
      id: 'scoring',
      title: 'Scoring',
      overview:
        "Scoring runs your startup through a 100-point algorithm covering Market, Team, Product, Capital, Strategic Fit, and Distribution. Tier 1 (≥85) is fast-tracked, Tier 2 (70–84) gets conditional next steps, and below 70 means more validation is needed before re-submitting.",
      howto: [
        'Open Scoring from your startup menu.',
        'Confirm or update the inputs (TAM, team experience, MVP cost, etc.).',
        'Click "Run scoring" — results appear in seconds with per-dimension breakdowns.',
        'Review the lowest-scoring dimensions and use them to focus your next iteration.',
      ],
      tips: [
        'Re-score after major milestones — first revenue, key hire, signed LOI — to track momentum.',
        'The dimension explanations call out what you’re missing so you know what to improve.',
      ],
      pitfalls: [
        'Tweaking inputs to chase a higher number instead of improving the underlying business is wasted effort — every score is signed and admins can see the input history.',
        'A high Market score on a thin Team score still triggers studio review; balance matters more than peaks.',
      ],
      related: [
        { label: 'Scoring anti-cheat', href: '#validate-grow/scoring-integrity' },
        { label: 'Market Intelligence', href: '#validate-grow/market-intel' },
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
    {
      id: 'scoring-integrity',
      title: 'Scoring integrity & anti-cheat',
      overview:
        "Every score is signed and time-stamped. The studio team can see when you re-scored, which inputs changed, and whether the change reflects real-world progress. Repeated input flips without supporting evidence flag the startup for manual review.",
      howto: [
        'Re-score after a milestone, not before — back up changes with discovery notes, metrics, or signed contracts.',
        'Use the Decision Journal to record why an input changed; it shows up next to the score history.',
        'If a re-score is rejected by the studio team, you’ll see a banner with the reason and a link to fix it.',
      ],
      tips: [
        'Stable, slowly improving scores read better to investors than spiky ones.',
        'Scoring is one of many studio signals — milestones and metrics matter more for tier upgrades.',
      ],
      pitfalls: [
        'Coordinating multiple accounts to inflate one startup breaches the terms of service and is detectable.',
        'Backdating inputs (“we had this all along”) without supporting evidence is treated as a re-score, not a correction.',
      ],
      related: [
        { label: 'Scoring', href: '#validate-grow/scoring' },
        { label: 'Trust Center', href: '#validate-grow/trust-center' },
      ],
    },
    {
      id: 'trust-center',
      title: 'Trust Center',
      overview:
        "The Trust Center is the central place where founders, investors, partners, and admins see and manage trust signals: identity verification status, founder/company badges, references, and the documents that back each badge. Each role sees the tabs relevant to them.",
      howto: [
        'Open Trust Center from the sidebar.',
        'Founders — review badges on your profile, upload supporting documents, and request verification.',
        'Investors and partners — review a founder’s trust score and badges before opening a dealroom.',
        'Admins — approve or revoke badges and resolve disputes.',
      ],
      tips: [
        'Trust badges follow you across startups — you only have to verify once.',
        'A higher trust score speeds up dealroom invites and reduces the diligence ask.',
      ],
      pitfalls: [
        'Uploading low-resolution scans of supporting documents is the top cause of slow verification.',
        'Revoked badges are visible to investors who saw them previously — keep your supporting docs current.',
      ],
      related: [
        { label: 'Due Diligence', href: '#validate-grow/due-diligence' },
        { label: 'NDA flows', href: '#legal/nda' },
      ],
    },
    {
      id: 'due-diligence',
      title: 'Due Diligence',
      overview:
        "Due Diligence (DD) is the structured workflow investors, partners, advisors, and admins use to review a deal before committing. Founders never read a DD report on themselves; they upload requested documents and respond to questions raised in the DD checklist.",
      howto: [
        'Founders — open Due Diligence on your startup to see open requests and upload requested docs.',
        'Reviewers — open Due Diligence from the deal record; sign the NDA, then walk the checklist (financials, legal, team, IP, market).',
        'Mark each checklist item with a verdict (pass / conditional / fail / not applicable) and notes.',
        'Generate the DD report when the checklist is complete; it downloads as an encrypted PDF.',
      ],
      tips: [
        'Front-load the documents the checklist asks for — every missing doc adds a week.',
        'Use the comment thread on each checklist item to keep the conversation in one place.',
      ],
      pitfalls: [
        'Skipping the NDA before the first checklist verdict is blocked — sign first or the verdict won’t save.',
        'Rotating reviewers mid-DD without re-syncing notes loses context; keep the same lead reviewer where possible.',
      ],
      related: [
        { label: 'Trust Center', href: '#validate-grow/trust-center' },
        { label: 'NDA flows', href: '#legal/nda' },
      ],
    },
    {
      id: 'advisors',
      title: 'Advisors & booking sessions',
      overview:
        "Advisors are domain experts (operators, ex-founders, functional leaders) you can book time with. Browse the directory, filter by expertise, and book a 30- or 60-minute session that lands on both calendars.",
      howto: [
        'Open Advisors from the Network sidebar group.',
        'Filter by expertise, sector, or availability.',
        'Click an advisor to view their bio and open slots, then pick a time and book.',
        'You’ll get a calendar invite with a join link; the advisor gets the same.',
      ],
      tips: [
        'Send a one-paragraph context note when you book — advisors prepare better with a clear ask.',
        'Capture the advisor’s feedback in your Decision Journal so you don’t lose it.',
      ],
      pitfalls: [
        'Booking without a calendar connected forces a manual ICS download — connect a calendar first.',
        'No-shows count against your match score; cancel at least 24 hours ahead if you can’t make it.',
      ],
      related: [
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
        { label: 'Calendar (Google / Microsoft)', href: '#integrations/calendar' },
      ],
    },
    {
      id: 'office-hours',
      title: 'Office Hours',
      overview:
        "Office Hours are recurring open slots that advisors and partners publish. Drop in for a 15-minute conversation without the formality of a full advisor booking — great for quick questions or a second opinion.",
      howto: [
        'Open Office Hours and pick a host with availability this week.',
        'Choose a 15-minute slot and confirm.',
        'Show up with one specific question — the format rewards crisp asks.',
      ],
      tips: [
        'Slots fill fast on Mondays — book on Friday for the following week.',
        'Recurring problems? Convert to a full advisor booking instead.',
      ],
      pitfalls: [
        'Showing up with five questions in a 15-minute slot wastes everyone’s time — book a full session if you need depth.',
        'Booking back-to-back slots with the same host is rate-limited; spread them across hosts.',
      ],
      related: [
        { label: 'Advisors', href: '#validate-grow/advisors' },
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
        'Try a paid trial startup together before signing the agreement.',
      ],
      pitfalls: [
        'Picking a co-founder for technical skills you can hire is a common, expensive mistake.',
        'Skipping the trial-startup step locks two people into vesting that’s hard to unwind.',
      ],
      related: [
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
      ],
    },
    {
      id: 'expert-profiles',
      title: 'Expert profiles',
      overview:
        "Every advisor and operating expert has a public profile page showing their background, areas of expertise, languages, time zone, and open booking slots. Profiles are the entry point for booking sessions and for partner introductions.",
      howto: [
        'Open Advisors from the Network sidebar and click any name to land on the expert\'s profile.',
        'Read the bio, expertise tags, and recent engagement signals (sessions completed, average rating).',
        'Pick an open slot from the calendar on the right to book directly.',
        'Use the "Share profile" link to send the page to a co-founder for a second opinion before booking.',
      ],
      tips: [
        'Profiles with multiple languages list them in the header — useful for non-English founders.',
        'Booking from the profile page automatically pre-fills the introductory context from your own profile.',
      ],
      pitfalls: [
        'Expertise tags are self-reported — read the bio for nuance before booking, especially on niche topics.',
        'A blank availability calendar usually means the expert is fully booked this week — check back later or open Office Hours instead.',
      ],
      related: [
        { label: 'Advisors & booking sessions', href: '#validate-grow/advisors' },
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
      ],
    },
    {
      id: 'wellbeing',
      title: 'Founder wellbeing',
      overview:
        "The Wellbeing tracker is a private, encrypted check-in (mood, sleep, stress, support) you can fill in weekly. Only you see the entries; the studio team sees aggregated, anonymized trends across the cohort.",
      howto: [
        'Open Wellbeing from the founder support group in the sidebar.',
        'Take the 60-second weekly check-in.',
        'Review your trend chart over the past 12 weeks.',
        'If you flag distress, the platform offers a private link to schedule with the studio’s mental-health partner.',
      ],
      tips: [
        'Set a weekly reminder — the value comes from a continuous trend, not single entries.',
        'Use the “share with advisor” option only with people you trust to hold the data.',
      ],
      pitfalls: [
        'Treating the check-in as a performance metric defeats it; honest entries beat optimistic ones.',
        'The mental-health partner is the right resource for crisis support — don’t rely on chat or community channels.',
      ],
      related: [
        { label: 'Advisors', href: '#validate-grow/advisors' },
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
      pitfalls: [
        'Tracking too many sectors makes the feed noisy — pick three to start.',
        'Conviction picks are studio-internal signals, not investment recommendations.',
      ],
      related: [
        { label: 'Watchlist & Decision Journal', href: '#capital/investors' },
      ],
    },
  ],
};

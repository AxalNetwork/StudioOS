export default {
  id: 'spin-out-lab',
  title: 'Spin-Out Lab',
  icon: 'Rocket',
  subsections: [
    {
      id: 'overview',
      title: 'Overview & how unlocks work',
      overview:
        "The Spin-Out Lab is a 28-day, week-by-week sprint that takes you from a hypothesis to an incorporated, funded company. The sidebar collapses to a focused Lab view that only shows the features you need this week; new tools unlock as you complete milestones.",
      howto: [
        'Enter the lab from Studio → Spin-Out Lab.',
        'Complete each week’s required milestones to unlock the next week.',
        'The lab returns you to Studio once Week 4 is complete.',
      ],
      tips: [
        'Milestones are visible in the Lab sidebar; click any to see what’s required.',
        'You can re-enter the lab if you want to redo a week — it picks up where you left off.',
      ],
      pitfalls: [
        'Skipping milestones to unlock later weeks isn’t supported — every milestone gates the next.',
        'Lab content is yours to keep, but cancelling the lab mid-week pauses unlocks until you re-enter.',
      ],
      related: [
        { label: 'Choosing your path', href: '#getting-started/choosing-path' },
        { label: 'Graduating from the lab', href: '#spin-out-lab/graduating' },
      ],
    },
    {
      id: 'week-1',
      title: 'Week 1 — Idea & Problem Validation',
      overview:
        "Week 1 sharpens the problem you’re solving and tests whether real customers feel the pain you think they do. You’ll log discovery interviews, capture hypotheses, and watch the validation signals slider move as evidence accumulates.",
      howto: [
        'Open Customer Discovery and log at least 5 interviews (interviewee, role, pains, hypotheses tested).',
        'Watch the signals panel — it derives a confidence score from the interviews you log.',
        'Capture the top 3 confirmed pain hypotheses in the startup brief before unlocking Week 2.',
      ],
      tips: [
        'Quality of interviews matters more than count — short, real conversations beat long surveys.',
        'Use the question prompts in Customer Discovery if you’re not sure what to ask.',
      ],
      pitfalls: [
        'Logging your own assumptions instead of customer quotes inflates the confidence score and misleads later weeks.',
        'Interviewing only friends-and-family produces sympathetic “yeses” that don’t survive Week 3 validation.',
      ],
      related: [
        { label: 'Customer Discovery', href: '#build/customer-discovery' },
        { label: 'Roadmap', href: '#build/roadmap' },
      ],
    },
    {
      id: 'week-2',
      title: 'Week 2 — Solution Design & Roadmap',
      overview:
        "Week 2 turns validated pain into a buildable solution. You’ll lock the value proposition, draft a 90-day roadmap with OKRs, and start the Brand Builder so the product has a real identity from day one.",
      howto: [
        'Write the value proposition statement in the startup brief.',
        'Open Roadmap, set this quarter’s OKRs, and break them into key results.',
        'Run Brand Builder to generate a name shortlist, palette, and logo concepts.',
      ],
      tips: [
        'Keep the OKR count low — 1 objective with 3 key results is plenty for a sprint.',
        'You can re-run brand variations until you’re happy; nothing is locked.',
      ],
      pitfalls: [
        'Picking a name before checking domain and trademark availability burns days of momentum later.',
        'Over-scoping the roadmap creates a checklist no one can finish — cut to one objective.',
      ],
      related: [
        { label: 'Roadmap', href: '#build/roadmap' },
        { label: 'Brand Builder', href: '#build/brand-builder' },
      ],
    },
    {
      id: 'week-3',
      title: 'Week 3 — Validation & Co-founder',
      overview:
        "Week 3 puts the solution in front of more buyers and (if you’re solo) finds you a co-founder. You’ll send a beta sign-up form, collect waitlist signal, and search the Co-founder Match pool for complementary skills.",
      howto: [
        'Publish a Beta Signup link from the startup page; share it with discovery contacts.',
        'Open Co-founder Match, set what you’re looking for (skills, time commitment, location), and review matches.',
        'Open conversations with up to 3 candidates; capture notes on each in the Decision Journal.',
      ],
      tips: [
        'Don’t propose equity in the first conversation — focus on chemistry and complementary skills.',
        'When you’re ready to commit, run the Cofounder Agreement flow (legal section) to lock equity and vesting.',
      ],
      pitfalls: [
        'Picking a co-founder for skills you can hire instead — if it’s not a partner relationship, hire it.',
        'Skipping the NDA step before deep co-founder conversations leaves IP exposed.',
      ],
      related: [
        { label: 'Co-founder Match', href: '#validate-grow/cofounder-match' },
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
      ],
    },
    {
      id: 'week-4',
      title: 'Week 4 — Incorporation & Capital',
      overview:
        "Week 4 turns your startup into a real company. You’ll incorporate, set up the cap table with founder vesting, file 83(b) elections, and prepare your fundraise materials for a first SAFE round.",
      howto: [
        'Run the Incorporation wizard and pick a jurisdiction (Delaware C-Corp by default).',
        'Set the founder cap table with a 4-year vest and 1-year cliff.',
        'File the 83(b) election within 30 days of stock issuance — the tracker reminds you.',
        'Open Capital and assemble the SAFE round (valuation cap, MFN, raise target).',
      ],
      tips: [
        'The compliance calendar auto-seeds standard events for your jurisdiction the moment you incorporate.',
        'Templates are starting points — your spin-out includes partner attorney review before signing.',
      ],
      pitfalls: [
        'Missing the 30-day 83(b) window is a permanent tax mistake — set the reminder the day shares are granted.',
        'Setting the valuation cap without comparable data can leave money or dilution on the table; talk to the studio team first.',
      ],
      related: [
        { label: 'Incorporation', href: '#legal/incorporation' },
        { label: 'Capital', href: '#capital/fundraise' },
        { label: 'Section 83(b)', href: '#legal/section-83b' },
      ],
    },
    {
      id: 'graduating',
      title: 'Graduating from the lab',
      overview:
        "Once Week 4 is complete, the lab marks you as incorporated and returns you to Studio. All the work you did in the lab — discovery, roadmap, brand, cap table, legal docs — stays attached to your startup.",
      howto: [
        'Confirm incorporation completes successfully (check the cap table populates).',
        'The sidebar auto-restores to the full Founder view on next page load.',
        'Your startup moves to "Active" status in the studio pipeline.',
      ],
      tips: [
        'You retain access to all lab content — nothing gets archived.',
        'Schedule a Demo Day session via Advisor Match to pressure-test your pitch before going to investors.',
      ],
      pitfalls: [
        'Graduation does not start fundraising for you — head to Capital and assemble the round when you’re ready.',
        'If the cap table didn’t populate after incorporation, contact support before issuing more shares.',
      ],
      related: [
        { label: 'Studio', href: '#getting-started/choosing-path' },
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
  ],
};

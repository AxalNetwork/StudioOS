export default {
  id: 'getting-started',
  title: 'Getting Started',
  icon: 'Compass',
  subsections: [
    {
      id: 'what-is-studioos',
      title: 'What is StudioOS',
      overview:
        "StudioOS is the operating system Axal VC uses to take a startup from a rough idea to an incorporated, funded company. You'll find every tool you need — discovery, roadmap, brand, deck, cap table, capital, legal, and the network — under one roof, organized by what you're trying to do this week.",
      howto: [
        'Sign in and pick the role that fits you (Founder, Investor, Partner, or Mentor).',
        'Use the left sidebar groups to find features by phase: Build, Validate & Grow, Capital & Finance, Legal, Network.',
        'Open the Quick Search at the top of the sidebar (or press Ctrl/Cmd-K) to jump anywhere in the app.',
      ],
      tips: [
        'You can change your role view later in Settings → Profile if you wear more than one hat.',
        'The dashboard widgets re-order based on the role and tier you’re on, so your first-screen experience is tailored.',
      ],
      pitfalls: [
        'Bookmarking a deep link before signing in lands you on the login page; sign in first, then re-open the link.',
        'If the sidebar looks shorter than expected, you may be in a “View as” mode — exit it from the violet bar at the top.',
      ],
      related: [
        { label: 'Account roles explained', href: '#getting-started/roles' },
        { label: 'Onboarding walkthrough', href: '#getting-started/onboarding' },
      ],
    },
    {
      id: 'choosing-path',
      title: 'Choosing your path: Spin-Out Lab vs. Existing Company',
      overview:
        "If you're starting from a hypothesis or a partner-supplied idea, the 30-day Spin-Out Lab walks you through validation, design, and incorporation in four guided weeks. If you already have a company and just want to use the tooling (cap table, fundraising, partner network, mentors), pick the Existing Company path instead.",
      howto: [
        'On first sign-in, the Onboarding wizard asks where you are in your journey.',
        'Pick "Spin-Out Lab" to enter the 4-week sprint with a locked, week-by-week feature tree.',
        'Pick "Existing Company" to land on the standard Founder Portal with full sidebar access.',
        'You can re-enter the lab any time from Founder Portal → Spin-Out Lab.',
      ],
      tips: [
        'The lab gates features per week to keep you focused; the standard portal is open-ended.',
        'You can graduate the lab early by completing each week’s milestones — the system auto-exits when Week 4 is done.',
      ],
      pitfalls: [
        'Starting the lab with an already-incorporated company can confuse the cap-table seeding step — pick the Existing Company path instead.',
        'Switching paths mid-flight preserves your data but the sidebar will reshape; finish the current week before changing.',
      ],
      related: [
        { label: 'Spin-Out Lab overview', href: '#spin-out-lab/overview' },
        { label: 'Founder Portal', href: '#portals/founder' },
      ],
    },
    {
      id: 'roles',
      title: 'Account roles explained',
      overview:
        "Every account has one of five roles: Founder, Investor, Partner (service provider), Mentor, or Admin. Your role decides which sidebar groups you see, which dashboards open by default, and which features are gated to you.",
      howto: [
        'Founder — applying or running a startup; full access to Build, Validate & Grow, and Capital tools.',
        'Investor — limited partner or co-investor; sees the Investor Portal, Pipeline, and Portfolio Health.',
        'Partner — service provider; lists services in the Marketplace, responds to Needs Board RFPs, runs Office Hours.',
        'Mentor — domain expert; books office-hour slots, takes mentee engagements, writes reflections.',
        'Admin — studio operator; sees everything plus the Admin Console and a “View as” role switcher.',
      ],
      tips: [
        'A role change requires admin approval today — open a support ticket if you need one.',
        'Admins can impersonate any user from the Admin Console for support and debugging.',
      ],
      pitfalls: [
        'Multi-role accounts default to a single primary role; switching roles can hide data you expect to see.',
        'Investor accounts cannot create projects — only Founder and Admin roles can.',
      ],
      related: [
        { label: 'Settings → Profile', href: '#account/settings-overview' },
        { label: 'Founder Portal', href: '#portals/founder' },
      ],
    },
    {
      id: 'personas',
      title: 'Personas (New Founder, Existing Company, Investor, Mentor)',
      overview:
        "Personas are tighter slices of a role that tune your dashboard, the Personal Advisor’s opening questions, and which “quick action” cards appear first. Founders pick between New Founder (idea stage) and Existing Company; Investors and Mentors each have one persona today.",
      howto: [
        'During onboarding, pick the persona that matches what you’re doing this quarter.',
        'Re-open Settings → Profile → Re-run onboarding to switch personas later.',
        'Your persona is what the Personal Advisor uses to pick its opening question bank.',
      ],
      tips: [
        'Persona is independent of subscription tier — switching personas does not change your billing.',
        'New Founder persona unlocks Spin-Out Lab nudges; Existing Company hides them.',
      ],
      pitfalls: [
        'If the Advisor opens with the wrong question set, your persona is the likely cause — switch in Settings.',
        'Switching personas does not retroactively change quick-action history; only the next session is affected.',
      ],
      related: [
        { label: 'Personal Advisor', href: '#getting-started/personal-advisor' },
        { label: 'Onboarding walkthrough', href: '#getting-started/onboarding' },
      ],
    },
    {
      id: 'onboarding',
      title: 'Onboarding walkthrough',
      overview:
        "Onboarding takes 4–8 questions tailored to your role. Your answers seed your dashboard, scoring inputs (founders), commitment terms (investors), or service catalog entries (partners). You can skip optional steps and return later.",
      howto: [
        'Pick your persona — the wizard branches based on the answer.',
        'Answer the 4–8 role-specific questions (industry, stage, goals, time commitment).',
        'Confirm your timezone and preferred locale.',
        'Land on your role’s dashboard with personalized cards and a “Next steps” checklist.',
      ],
      tips: [
        'You can re-run onboarding any time from Settings → Profile → Re-run onboarding.',
        'Onboarding answers also drive the Mentor Match and Partner Match algorithms.',
      ],
      pitfalls: [
        'Skipping the timezone step makes calendar invites land in UTC — set it before booking your first session.',
        'Partial onboarding leaves your dashboard generic; finish the wizard for the personalized layout.',
      ],
      related: [
        { label: 'Inviting your team', href: '#getting-started/invite-team' },
        { label: 'Settings overview', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'invite-team',
      title: 'Inviting your team',
      overview:
        "Bring co-founders, advisors, and team members into your project so they can collaborate on the cap table, roadmap, and customer discovery.",
      howto: [
        'Open Projects, choose your project, and go to the Members tab.',
        'Click "Invite member", enter their email, and pick their role on the project.',
        'They receive an email invite valid for 7 days; accepting it creates their account if they don’t have one yet.',
      ],
      tips: [
        'Co-founder invites should use the Cofounder Match → Cofounder Agreement flow rather than a plain invite — it captures equity split and vesting at the same time.',
        'Advisor invites can be limited to read-only access to the deck, financial model, and metrics.',
      ],
      pitfalls: [
        'Invites expire after 7 days — re-send if it’s been longer.',
        'Adding a co-founder via plain invite skips the equity-split capture; back-fill it on the cap table or via the Cofounder Agreement.',
      ],
      related: [
        { label: 'Co-founder Match', href: '#validate-grow/cofounder-match' },
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
      ],
    },
    {
      id: 'personal-advisor',
      title: 'Personal Advisor',
      overview:
        "The Personal Advisor is a chat-style helper on your dashboard that asks the right next question for your persona, links you to the matching tool, and drops you straight into the docs page that explains it. It does not give legal, tax, or investment advice.",
      howto: [
        'Open your dashboard — the Advisor sits where the persona tile used to be.',
        'Pick one of the suggested questions, or type your own.',
        'Follow the “Open this tool” or “Read more” links the Advisor surfaces.',
      ],
      tips: [
        'The Advisor’s opening questions change with your persona — switch in Settings to see a different bank.',
        'Use the Advisor as a roadmap: the suggested questions are usually the next thing worth doing.',
      ],
      pitfalls: [
        'The Advisor is a guide, not a decision-maker — always cross-check legal and tax steps with the partner attorney or your accountant.',
        'It does not see your private project data; it suggests features based on persona, not on your numbers.',
      ],
      related: [
        { label: 'Personas', href: '#getting-started/personas' },
        { label: 'Onboarding walkthrough', href: '#getting-started/onboarding' },
      ],
    },
  ],
};

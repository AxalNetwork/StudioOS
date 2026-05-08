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
      related: [
        { label: 'Settings → Profile', href: '#account/settings-overview' },
        { label: 'Founder Portal', href: '#portals/founder' },
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
      related: [
        { label: 'Co-founder Match', href: '#validate-grow/cofounder-match' },
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
      ],
    },
  ],
};

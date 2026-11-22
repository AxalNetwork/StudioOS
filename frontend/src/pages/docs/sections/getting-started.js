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
        'Sign in and pick the role that fits you (Founder, Investor, Partner, or Advisor).',
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
        "If you're starting from a hypothesis or a partner-supplied idea, the 28-day Spin-Out Lab walks you through validation, design, and incorporation in four guided weeks. If you already have a company and just want to use the tooling (cap table, fundraising, partner network, advisors), pick the Existing Company path instead.",
      howto: [
        'On first sign-in, the Onboarding wizard asks where you are in your journey.',
        'Pick "Spin-Out Lab" to enter the 4-week sprint with a locked, week-by-week feature tree.',
        'Pick "Existing Company" to land in Studio with full founder tooling.',
        'You can re-enter the lab any time from Studio → Spin-Out Lab.',
      ],
      tips: [
        'The lab gates features per week to keep you focused; Studio is open-ended.',
        'You can graduate the lab early by completing each week’s milestones — the system auto-exits when Week 4 is done.',
      ],
      pitfalls: [
        'Starting the lab with an already-incorporated company can confuse the cap-table seeding step — pick the Existing Company path instead.',
        'Switching paths mid-flight preserves your data but the sidebar will reshape; finish the current week before changing.',
      ],
      related: [
        { label: 'Spin-Out Lab overview', href: '#spin-out-lab/overview' },
        { label: 'Spin-Out Lab', href: '#spin-out-lab/overview' },
      ],
    },
    {
      id: 'roles',
      title: 'Account roles explained',
      overview:
        "Every account holds one role. Registration offers four: Founder, Investor (limited partners included), Operating Partner and Advisor. A new account is an Explorer until the Axal team has reviewed the membership and the agreement is signed; the team then gives the account its role. Admin is a staff-only role for the Axal team: it cannot be chosen at registration. Your role decides which sidebar groups you see, which dashboard opens and which features are open to you.",
      howto: [
        'Founder — runs a venture; the founder workspace (Validate, Build, Raise and Grow) opens once the membership agreement is signed.',
        'Investor — a limited partner or co-investor; sees the investor workspace and portfolio.',
        'Operating Partner — a service provider or operator; lists services and responds to member needs.',
        'Advisor — a domain expert; the advisor profile is chosen after the account exists and confirmed before you can subscribe.',
        'Explorer — every new account until its membership is reviewed and the agreement is signed.',
        'Admin (staff only) — the Axal team; sees the admin pages. Not offered at registration.',
      ],
      tips: [
        'A role change is made by the Axal team: open a support ticket if you need one.',
      ],
      pitfalls: [
        'Investor accounts cannot create startups — only Founder and Admin roles can.',
      ],
      related: [
        { label: 'Onboarding walkthrough', href: '#getting-started/onboarding' },
        { label: 'Settings', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'personas',
      title: 'Personas (New Founder, Existing Company, Investor, Advisor)',
      overview:
        "Personas are tighter slices of a role that tune your dashboard, the Personal Advisor’s opening questions, and which “quick action” cards appear first. Founders pick between New Founder (idea stage) and Existing Company; Investors have six segments: LP — Individual, LP — Institutional, GP — External Fund, Angel / Scout, Corporate VC, and Sovereign / Family Office. Advisors can choose Operator / Advisor; Service Provider maps to Operating Partner, and Academic / Lab and Press / Analyst map to Explorer. A segment does not change your account profile.",
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
        "We create your account when you request your signup link. Confirm your email to sign in. The Axal team reviews your membership and sends an agreement to sign. After you sign it, the team enables your workspace. Until then the account is an Explorer, and no review time is promised.",
      howto: [
        'Account created — request your signup link on /register; the account exists from that moment.',
        'Email confirmed — open the link in the email to confirm your address and sign in.',
        'Membership reviewed and agreement sent — the Axal team reviews your membership and sends a membership agreement to sign.',
        'Agreement signed — sign the membership agreement the team sent you.',
        'Workspace enabled — once it is signed, the team gives your account its role and your workspace opens.',
      ],
      tips: [
        'After you sign in, a short chat asks which describes your interest (founder, investor, operator or service partner) so the team can match the right agreement.',
      ],
      pitfalls: [
        'Signing in before the agreement is signed shows the Explorer view: your role’s workspace is not open yet.',
      ],
      related: [
        { label: 'Account roles explained', href: '#getting-started/roles' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'invite-team',
      title: 'Inviting your team',
      overview:
        "Bring co-founders, advisors, and team members into your startup so they can collaborate on the cap table, roadmap, and customer discovery.",
      howto: [
        'Open Startups, choose your startup, and go to the Members tab.',
        'Click "Invite member", enter their email, and pick their role on the startup.',
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
      id: 'help-and-shortcuts',
      title: 'Getting help & keyboard shortcuts',
      overview:
        "Need a hand? Open Eadwyn in the product to ask questions and reach the right workflow. Eadwyn does not receive blanket access to private startup records: the context available depends on the connected surface, your current company, permissions and any records explicitly shared. Ctrl/Cmd-K opens the navigation search.",
      howto: [
        'Open Eadwyn from the supported product surface and check which company, record or connected source is currently in scope.',
        'For tracked support, use Help → Your tickets; do not include private records or security vulnerabilities in ordinary tickets.',
        'Press Ctrl/Cmd-K to open the command palette from any page.',
        'Start typing — results group by pages, recent activity, doc anchors, and quick actions; Enter jumps to the highlighted result, Esc closes the palette.',
      ],
      tips: [
        'The palette remembers your recent activity for five minutes, so the latest thing you touched is usually one or two keystrokes away.',
        'Press "?" anywhere outside an input field to open the keyboard-shortcuts overlay without reaching for the mouse.',
      ],
      pitfalls: [
        'The palette searches documentation by title and content — niche features are easier to find by their docs anchor than by guessing the page name.',
        'Eadwyn can help with supported workflows, but an action that changes a record still follows that surface’s authorization and review controls.',
      ],
      related: [
        { label: 'Notifications', href: '#account/notifications' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'pricing-demo',
      title: 'Pricing & demo',
      overview:
        "Anyone — including visitors who haven't signed up yet — can compare subscription tiers and book a demo. These pages live on the public site and link straight into sign-up when a visitor is ready.",
      howto: [
        'Open /pricing?for=founder to compare Free, Validate + Build and Raise + Grow. The prices and AI inclusions come from the live catalogue.',
        'Open /demo to book a walkthrough with the studio team.',
        'Share any of these links externally — they require no account.',
      ],
      tips: [
        'If a feature is missing, request it from the demo form and we will consider it.',
        'Pricing changes show on this page first; bookmark it if you want to track tier-by-tier inclusions over time.',
      ],
      pitfalls: [
        'Deep-links into in-app features still require sign-in — bookmark the relevant /docs anchor instead if you want a public-friendly reference.',
        'Demo bookings land on the studio calendar in UTC — make sure you check your local time before confirming.',
      ],
      related: [
        { label: 'Subscription tiers (founders)', href: '#account/tiers' },
        { label: 'Investor billing & tiers', href: '#account/investor-billing' },
      ],
    },
    {
      id: 'personal-advisor',
      title: 'Eadwyn — AI assistant',
      overview:
        "Eadwyn helps navigate supported Axal VC tasks and offers contextual assistance. Its available data depends on the specific surface, active company, connected permissions and the records shared with it; it is not a general grant to read every startup or private note. It does not give legal, tax or investment advice.",
      howto: [
        'Open Eadwyn in the available product surface and confirm the company or data context before sharing anything.',
        'Choose a suggested task or ask a question; inspect what Eadwyn proposes before acting on a record.',
        'Use the links to the relevant product page or Help guide and review any requested write or external action on its own confirmation screen.',
      ],
      tips: [
        'Assistant access and connected accounts can be inspected and revoked from the applicable account and connector controls.',
        'Use Account → Usage → AI tokens to check the allowance or balance for billable AI tasks.',
      ],
      pitfalls: [
        'Eadwyn is not an independent decision-maker; verify important outputs with a qualified professional.',
        'Do not assume Eadwyn can see all private data or none: access is surface- and permission-specific; always review the current scope.',
      ],
      related: [
        { label: 'Personas', href: '#getting-started/personas' },
        { label: 'Onboarding walkthrough', href: '#getting-started/onboarding' },
      ],
    },
  ],
};

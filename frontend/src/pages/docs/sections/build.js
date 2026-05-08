export default {
  id: 'build',
  title: 'Build',
  icon: 'Hammer',
  subsections: [
    {
      id: 'projects',
      title: 'Projects',
      overview:
        "Projects are the home for everything about a single venture: brief, members, roadmap, discovery interviews, deck, financial model, cap table, and the activity log. Founders typically have one active project at a time; admins see all projects in the studio.",
      howto: [
        'Open Projects from the sidebar to see your list.',
        'Click "New project" (founders) or open an existing card.',
        'Use the project tabs to navigate between Brief, Members, Roadmap, Discovery, Deck, Financials, Cap Table, and Activity.',
      ],
      tips: [
        'The Brief is the single-page summary investors and admins read first — keep it sharp.',
        'Activity is a read-only audit log; use it to catch up after a few days away.',
      ],
      related: [
        { label: 'Roadmap', href: '#build/roadmap' },
        { label: 'Customer Discovery', href: '#build/customer-discovery' },
      ],
    },
    {
      id: 'customer-discovery',
      title: 'Customer Discovery',
      overview:
        "Customer Discovery is where you log interviews with potential users, capture pains and hypotheses, and watch a confidence signal evolve as evidence accumulates. It’s the Week 1 backbone of the Spin-Out Lab.",
      howto: [
        'Open the Discovery tab on your project.',
        'Click "Log interview", fill in interviewee name, role, date, notes, and tag pains and hypotheses.',
        'Repeat for every conversation — the signals panel updates automatically.',
      ],
      tips: [
        'Tag pains consistently across interviews so the rollup can group them.',
        'Voice memos transcribed externally can be pasted into Notes — there’s no length limit.',
      ],
      related: [
        { label: 'Roadmap', href: '#build/roadmap' },
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
    {
      id: 'roadmap',
      title: 'Roadmap (OKRs & Kanban)',
      overview:
        "The Roadmap combines quarterly OKRs with a tactical Kanban board so you can connect strategy to weekly execution. Set the Objective for the quarter, define 2–4 Key Results, then break each KR into tasks on the Kanban.",
      howto: [
        'Pick the quarter at the top of the Roadmap page.',
        'Add the Objective for the quarter (1 sentence).',
        'Define 2–4 Key Results — measurable, time-bound outcomes.',
        'Drag tasks across Backlog → Doing → Done as you work.',
      ],
      tips: [
        'Re-grade your KRs every Friday — green/yellow/red is enough; perfection is the enemy.',
        'Tasks closed on the Kanban roll up into the project Activity log automatically.',
      ],
      related: [
        { label: 'Metrics', href: '#capital/metrics' },
        { label: 'Customer Discovery', href: '#build/customer-discovery' },
      ],
    },
    {
      id: 'brand-builder',
      title: 'Brand Builder',
      overview:
        "Brand Builder generates a name shortlist, color palette, type pairings, and logo concepts based on your project brief. You can iterate on each piece independently and download the final kit as assets.",
      howto: [
        'Open the Brand tab on your project.',
        'Confirm or refine the input prompt (industry, vibe, audience).',
        'Generate a round of name + palette + logo options; favorite the ones you like.',
        'Iterate on logos until you’re happy, then download the kit (PNG + SVG).',
      ],
      tips: [
        'Run 2–3 rounds before settling — the first round is rarely the best.',
        'Buy your domain before you tell anyone the name.',
      ],
      related: [
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
    {
      id: 'pitch-deck',
      title: 'Pitch Deck',
      overview:
        "The Pitch Deck builder assembles a 10–12 slide investor deck from your project brief, financials, and discovery interviews. Each slide is editable; you can rearrange, hide, and re-style.",
      howto: [
        'Open Pitch Deck on your project.',
        'Click "Generate" to seed a draft from your brief and financials.',
        'Edit slide-by-slide; rearrange via drag-and-drop.',
        'Use "Print preview" to check page breaks before exporting to PDF.',
      ],
      tips: [
        'Keep one core idea per slide — investors skim, they don’t read.',
        'The Financials and Roadmap slides pull live from those modules; update them once and the deck refreshes.',
      ],
      related: [
        { label: 'Brand Builder', href: '#build/brand-builder' },
        { label: 'Capital', href: '#capital/fundraise' },
      ],
    },
  ],
};

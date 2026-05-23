// Section id stays "build" so existing AC-2 doc_anchors and PageExplainer
// docPaths keep resolving; the user-facing title is "Core" per the new
// information architecture.
export default {
  id: 'build',
  title: 'Core',
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
      pitfalls: [
        'Creating multiple projects for variations of the same idea fragments your discovery data — use one project and pivot in place.',
        'Removing yourself as a project member can lock you out; transfer ownership first.',
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
      pitfalls: [
        'Inventing tags per interview defeats the rollup — pick a small vocabulary and re-use it.',
        'Recording assumptions as quotes inflates the confidence score; quote what people actually said.',
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
      pitfalls: [
        'Defining KRs as activities (“build feature X”) instead of outcomes (“X paying users”) makes them useless for grading.',
        'Carrying yesterday’s tasks into Doing every morning hides real blockers — keep WIP small.',
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
      pitfalls: [
        'Skipping the trademark/domain check before announcing the name is the most common rebrand trigger.',
        'Picking a clever name that doesn’t spell well over the phone hurts every sales call later.',
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
      pitfalls: [
        'Editing live slides during an investor meeting causes layout pop — export to PDF and present the static copy.',
        'Hidden slides still count for page numbering; un-hide before export if numbering matters.',
      ],
      related: [
        { label: 'Brand Builder', href: '#build/brand-builder' },
        { label: 'Capital', href: '#capital/fundraise' },
      ],
    },
    {
      id: 'deck-share-viewer',
      title: 'Sharing your pitch deck via a link',
      overview:
        "Generate a single-link share URL for your deck — no sign-in required for the recipient. The viewer renders the deck in a clean, distraction-free reading mode with keyboard navigation and fullscreen support, and you can revoke the link at any time.",
      howto: [
        'Open Pitch Deck on your project and click "Share".',
        'Copy the generated link and send it to the investor or reviewer.',
        'They open the link in any browser — no account needed.',
        'Revoke the link from the same dialog when you no longer want it active.',
      ],
      tips: [
        'In the viewer, arrow keys, Space, j/k, Page Up/Page Down, Home and End all navigate slides.',
        'Press "f" to enter fullscreen; keyboard shortcuts keep working in fullscreen on every browser.',
        'Revoking a link is instant — the next attempt to open it shows a clear "link no longer valid" message.',
      ],
      pitfalls: [
        'Sharing the link before exporting hides any live edits you make later from anyone holding the link — use a stable version, not a work-in-progress.',
        'Generating multiple links for the same deck and forgetting which is which makes revocation messy — keep the dialog open and label your shares.',
      ],
      related: [
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
    {
      id: 'financial-model',
      title: 'Financial Model Builder',
      overview:
        "The Financial Model Builder lets you assemble a 36-month projection (revenue lines, headcount, OpEx, runway) without spreadsheets. The model wires into your Pitch Deck and Metrics dashboards so investors see the same numbers you do.",
      howto: [
        'Open Financials on your project.',
        'Add revenue lines (subscription, transaction, services) and assumptions (price, conversion, churn).',
        'Add headcount roles with hire month and burdened cost.',
        'Review the cash, runway, and ARR charts; export to CSV for your accountant.',
      ],
      tips: [
        'Build a base, an upside, and a downside scenario — investors always ask.',
        'Tie hires to revenue triggers (e.g. hire AE #2 at $50k MRR) instead of fixed dates.',
      ],
      pitfalls: [
        'Forgetting payroll taxes and benefits understates burn by 25–35%.',
        'Modelling churn as zero collapses to a flattering hockey stick that investors discount on sight.',
      ],
      related: [
        { label: 'Metrics', href: '#capital/metrics' },
        { label: 'Pitch Deck', href: '#build/pitch-deck' },
      ],
    },
  ],
};

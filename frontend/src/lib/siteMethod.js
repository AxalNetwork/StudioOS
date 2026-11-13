/**
 * The Methodology page's words (D678, #1552), the owner's copy from the
 * METHODOLOGY view of `design/canvases/integrated/Axal VC Website.dc.html`
 * (its logic script's `mStages4`, `mDims3`, `mLoop5`, `mLinks`, `mDisc5`,
 * `mRecord4`, `mUsers` and `mRoles4`).
 *
 * This is copy, not data: the page states a method. It holds no figure, no
 * person and no date, so nothing here waits on a live read.
 */

/** The four stages: the hero's strip and the "Four stages" section. */
export const METHOD_STAGES = [
  { n: '01', t: 'Validate', s: 'Turn an opportunity into evidence.', q: '“Is this worth building?”',
    items: ['Problem discovery', 'Customer research', 'Ideal customer profile', 'Market intelligence', 'Demand and urgency signals', 'Experiments and validation', 'Venture thesis refinement'] },
  { n: '02', t: 'Build', s: 'Turn evidence into a company.', q: '“Can this become a real company?”',
    items: ['Solution design', 'Prototype or MVP', 'Product roadmap', 'Founding team', 'Company creation', 'Operating systems', 'Initial business model'],
    note: 'Company creation covers the formation infrastructure: entity, founder stock, vesting, governance, and the IP plan.' },
  { n: '03', t: 'Raise', s: 'Turn readiness into resources.', q: '“What does this venture need to move forward?”',
    items: ['Fundraising readiness', 'Investor narrative', 'Pitch deck', 'Data room', 'Cap table', 'Use of funds', 'Capital relationships'] },
  { n: '04', t: 'Grow', s: 'Turn capital and capability into momentum.', q: '“How does this venture become larger and more enduring?”',
    items: ['Product improvement', 'Distribution', 'Revenue and traction', 'Team expansion', 'Partner network', 'Market expansion', 'Durable company-building'] },
];

/** Reach, Depth, Momentum. */
export const METHOD_DIMENSIONS = [
  { t: 'Reach', d: 'The network, market access, partners, advisors, investors, and relationships surrounding the venture.' },
  { t: 'Depth', d: 'The evidence, product, team, company structure, operating systems, and foundations beneath the venture.' },
  { t: 'Momentum', d: 'The capital, distribution, traction, learning, and growth generated over time.' },
];

/** The central operating loop. */
export const METHOD_LOOP = [
  { n: '01', t: 'Hypothesis', d: 'Make the assumption explicit.' },
  { n: '02', t: 'Sprint', d: 'Turn the assumption into a focused piece of work.' },
  { n: '03', t: 'Evidence', d: 'Record what was observed, tested, or created.' },
  { n: '04', t: 'Decision', d: 'Decide whether the evidence changes the path.' },
  { n: '05', t: 'Next Commitment', d: 'Choose the next level of time, capital, and participation.' },
];

/** How the stages feed each other. */
export const METHOD_LINKS = [
  { f: 'Validate', to: 'Build', d: 'Validate creates evidence for Build.' },
  { f: 'Build', to: 'Raise', d: 'Build creates assets and readiness for Raise.' },
  { f: 'Raise', to: 'Grow', d: 'Raise provides resources for Grow.' },
  { f: 'Grow', to: 'Validate', d: 'Grow generates new evidence that feeds back into the next Validate cycle.' },
];

/** Five disciplines. One operating system. */
export const METHOD_DISCIPLINES = [
  { t: 'Lean', r: 'Determines what to learn' },
  { t: 'Design Sprints', r: 'Accelerate discovery' },
  { t: 'Agile', r: 'Governs execution' },
  { t: 'Kanban', r: 'Makes the work visible' },
  { t: 'Decision points', r: 'Govern commitment' },
];

/**
 * The seven blueprints. `alt` is the canvas's own text, word for word, and `w` × `h` the file's
 * own size, so the page holds its place while the image loads;
 * `methodology_intelligence_d678.test.mjs` holds each one to it.
 */
export const METHOD_FIGURES = {
  system: {
    img: 'method-system', w: 1000, h: 429,
    alt: 'Axal VC Venture Creation System blueprint showing the four connected stages Validate, Build, Raise, and Grow, supported by the dimensions Reach, Depth, and Momentum.',
    caption: 'Fig. 01 — The Axal VC Venture Creation System',
  },
  loop: {
    img: 'method-loop', w: 1000, h: 429,
    alt: 'Core loop blueprint: Hypothesis, Sprint, Evidence, Gate as the decision point, and Next Commitment arranged around the venture core.',
    caption: 'Fig. 02 — Core loop blueprint. The gate is the decision point',
  },
  lean: {
    img: 'method-lean', w: 1000, h: 429,
    alt: 'Lean Startup blueprint: a hypothesis-driven learning system from prioritised assumptions to refined hypothesis.',
    caption: 'Fig. 03 — Lean. Determines what to learn',
  },
  sprint: {
    img: 'method-design-sprint', w: 1000, h: 429,
    alt: 'Design Sprint blueprint: understand, define, ideate, prototype, test, and decide toward a validated direction.',
    caption: 'Fig. 04 — Design Sprints. Accelerate discovery',
  },
  agile: {
    img: 'method-agile', w: 1100, h: 471,
    alt: 'Agile execution blueprint: repeated sprints of objective, build, review, and improve.',
    caption: 'Fig. 05 — Agile. Governs execution',
  },
  kanban: {
    img: 'method-kanban', w: 1100, h: 471,
    alt: 'Kanban operating blueprint: work streams moving through hypothesis, test, evidence, and decision lanes.',
    caption: 'Fig. 06 — Kanban. Makes the work visible',
  },
  lab: {
    img: 'method-lab-28', w: 1100, h: 471,
    alt: '28-day Spin-Out Lab blueprint: a day-by-day path from Day 1 to Day 28, from idea to organization.',
    caption: 'Fig. 07 — The 28-day Spin-Out Lab blueprint',
  },
};

/** The four disciplines' blueprints, two by two, in the canvas's order. */
export const DISCIPLINE_FIGURES = ['lean', 'sprint', 'agile', 'kanban'];

/** The Lab's four weeks. `tone` is the week's bar colour on the canvas. */
export const LAB_WEEKS = [
  { n: 'Week 1', t: 'Validate', tone: '#c4b5fd',
    items: ['Problem definition', 'Customer discovery', 'ICP', 'Market context', 'Initial evidence'] },
  { n: 'Week 2', t: 'Build', tone: '#a78bfa',
    items: ['Solution definition', 'MVP scope', 'Prototype', 'Founding team', 'Company formation: entity, founder stock, vesting, 83(b)', '90-day roadmap'] },
  { n: 'Week 3', t: 'Raise', tone: '#8b5cf6',
    items: ['Readiness assessment', 'Pitch deck', 'Data room', 'Cap table', 'Use of funds', 'Investor preparation'] },
  { n: 'Week 4', t: 'Grow', tone: '#7c3aed',
    items: ['Distribution', 'Partner network', 'Operating plan', 'Growth priorities', 'Next capital and execution commitments'] },
];

/** What the shared record connects. */
export const METHOD_RECORD = [
  { t: 'Evidence', q: 'What has been observed, tested, verified, or learned?', from: 'Produced in Validate' },
  { t: 'Assets', q: 'What has been created and can now be used?', from: 'Produced in Build' },
  { t: 'Decisions', q: 'What has changed because of the work?', from: 'Made at every stage boundary' },
  { t: 'Capital readiness', q: 'What can the record now support: investor exposure, further resources, or a new level of commitment?', from: 'Assessed before Raise and Grow' },
];

/** Who uses the one venture record. */
export const METHOD_USERS = [
  { t: 'Founders', d: 'use it to build and decide.' },
  { t: 'Partners', d: 'use it to contribute.' },
  { t: 'Advisors', d: 'use it to close specific gaps.' },
  { t: 'Investors', d: 'use it to evaluate the company’s formation and progress.' },
];

/** The partner roles. `icon` picks one of the canvas's four drawn marks. */
export const METHOD_ROLES = [
  { t: 'Founders', d: 'Bring the thesis, conviction, and responsibility to build.', icon: 'seed' },
  { t: 'Investors', d: 'Bring capital, judgment, and a longer view.', icon: 'horizon' },
  { t: 'Advisors', d: 'Bring experience where a specific gap needs to be closed.', icon: 'bridge' },
  { t: 'Operating partners', d: 'Bring capabilities, relationships, and execution.', icon: 'grid' },
];

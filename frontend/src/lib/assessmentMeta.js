// Task #2 — Shared metadata + helpers for the gamified-assessment player UI.
// Pure module (no JSX). Provides the human labels/poles for value spectrums and
// the 8 canonical skill axes, the founder-track archetype copy, a lucide icon
// resolver for badges/archetypes, and the client-side XP/level curve (mirrors
// cloudflare-worker/src/services/assessmentScoring.ts::levelForXp so the hub can
// render a level bar without a dedicated endpoint).
import {
  Compass, Rocket, Ruler, Zap, Flag, Award, Medal, Sparkles, Trophy, Star,
  Mic, Network, Ticket, Target, Handshake, TrendingUp, Users, ClipboardCheck,
} from 'lucide-react';

// Value spectrums are bipolar (−2..+2). `low` = negative pole, `high` = positive
// pole. Mirrors the founder spectrums measured by migration 108's seed.
export const VALUE_SPECTRUMS = {
  founder_mission_vs_profit: { label: 'Mission vs Profit', low: 'Profit-first', high: 'Mission-first' },
  founder_speed_vs_quality: { label: 'Speed vs Quality', low: 'Quality-first', high: 'Speed-first' },
  founder_risk_appetite: { label: 'Risk Appetite', low: 'Risk-averse', high: 'Risk-seeking' },
  founder_growth_vs_sustain: { label: 'Growth vs Sustainability', low: 'Sustainable', high: 'Hyper-growth' },
  founder_autonomy_vs_structure: { label: 'Autonomy vs Structure', low: 'Process & structure', high: 'Autonomy & flex' },
};

// 8 canonical skill axes (0..5). Labels + order mirror the worker's RADAR_AXES.
export const SKILL_AXES = {
  product: 'Product',
  engineering: 'Engineering',
  design: 'Design',
  gtm_sales: 'GTM / Sales',
  marketing_brand: 'Marketing / Brand',
  finance_ops: 'Finance / Ops',
  legal_compliance: 'Legal / Compliance',
  capital_network: 'Capital / Network',
};
// Short labels keep the radar legible on mobile + inside the export card.
export const SKILL_AXES_SHORT = {
  product: 'Product',
  engineering: 'Eng',
  design: 'Design',
  gtm_sales: 'GTM',
  marketing_brand: 'Brand',
  finance_ops: 'Finance',
  legal_compliance: 'Legal',
  capital_network: 'Capital',
};
export const SKILL_AXIS_ORDER = Object.keys(SKILL_AXES);

// Role-track archetype copy keyed by slug. Static display metadata — not user
// data. Classified by nearest-centroid over builder / visionary / connector /
// operator (cloudflare-worker/src/services/archetypeScoring.ts) from the
// conversational bank in services/advisor/banks/fitShared.ts.
//
// `summary` is the compact /studio blurb. `description` is the full card.
// `matching` is who they pair with and why (same-track + cross-licence).
// `complements` are the chip labels derived from that matching set.
export const ARCHETYPES = {
  fo_missionary: {
    label: 'The Missionary', tagline: 'Mission first, built to last.',
    lean: 'Visionary + Connector',
    summary: 'Anchored to the why. Builds for durability and trust, not the fastest round.',
    description: 'The Missionary starts from purpose and stays there. They convert people with a why that outlasts a feature, hire for belief as much as skill, and will take the slower, more sustainable path if it keeps the work honest. Users and teammates trust them because the story does not change with the weather. In a room they pull toward meaning, long-range impact, and the kind of craft that still matters in five years. They are at their best in categories where trust compounds and feedback cycles are long. They need a counterpart who will force commercial urgency and a breakout tempo when conviction starts to look like delay.',
    icon: 'compass', accent: '#0ea5e9',
    strengths: [
      'Anchors the team to a durable why',
      'Earns deep trust from users, hires, and backers',
      'Persistent through long feedback cycles',
      'Converts people with mission, not just product',
      'Protects the work from short-term drift',
    ],
    blindSpots: [
      'May trade speed for conviction',
      'Slow to pivot when the mission is challenged',
      'Under-weights commercial urgency',
      'Can over-filter talent for belief instead of skill',
      'May resist a raise or a cut that would buy time',
    ],
    complements: ['The Rocketeer', 'The Maverick', 'Thesis-Driven Backer', 'Sage Guide', 'Systems Builder'],
    matching: [
      { label: 'The Rocketeer', why: 'Supplies speed, capital theatre, and commercial urgency when the mission starts to stall.' },
      { label: 'The Maverick', why: 'Makes the independent, unpopular call the Missionary will not take against the creed.' },
      { label: 'Thesis-Driven Backer', why: 'A patient investor who leads on conviction and will hold through the long cycle this founder needs.' },
      { label: 'Sage Guide', why: 'Gives altitude and judgment at the hard moments without asking the founder to abandon the why.' },
      { label: 'Systems Builder', why: 'Installs machinery so the mission still runs when the founder is not in the room.' },
    ],
  },
  fo_rocketeer: {
    label: 'The Rocketeer', tagline: 'Fast, bold, built to break out.',
    lean: 'Builder + Visionary',
    summary: 'High speed, high risk, hyper-growth. Raises big and moves first.',
    description: 'The Rocketeer is built to break out. They move before the market, tell a magnetic story for capital and talent, and are comfortable with the kind of bet that looks reckless until it works. Shipping is a weapon: they would rather be in market with a scarred v1 than perfect in private. They thrive in winner-take-most windows where timing is the strategy. The cost is foundation: process, quality, and burn discipline lag the story. They pair best with people who will install the floor under the rocket without asking it to sit on the pad.',
    icon: 'rocket', accent: '#f97316',
    strengths: [
      'Moves before the market does',
      'Comfortable with bold, high-stakes bets',
      'Magnetic case for capital and talent',
      'Turns a window of timing into a company',
      'Keeps energy high when the work is chaotic',
    ],
    blindSpots: [
      'May scale before foundations are ready',
      'Accumulates quality and process debt',
      'Burn discipline under pressure',
      'Can over-index on narrative versus evidence',
      'Leaves owners and cadence as an afterthought',
    ],
    complements: ['The Architect', 'The Missionary', 'Hands-On Partner', 'Growth Catalyst', 'Accountability Anchor'],
    matching: [
      { label: 'The Architect', why: 'Puts craft, structure, and a quality bar under the speed so the company does not break on the way up.' },
      { label: 'The Missionary', why: 'Holds the why when growth outruns meaning, and slows the room just enough to stay honest.' },
      { label: 'Hands-On Partner', why: 'An investor who will get into product, GTM, and hiring at the pace this founder actually runs.' },
      { label: 'Growth Catalyst', why: 'Turns early traction into a repeatable growth motion instead of a sequence of heroics.' },
      { label: 'Accountability Anchor', why: 'Keeps commitments visible when speed would otherwise let them slip.' },
    ],
  },
  fo_architect: {
    label: 'The Architect', tagline: 'Craft, structure, and durable systems.',
    lean: 'Builder + Operator',
    summary: 'Quality-first and risk-aware. Builds process and technical foundations that last.',
    description: 'The Architect builds so the company still works when they are not in the room. They are quality-first, risk-aware, and allergic to heroics as a operating system. Deep technical foundations, named owners, and a compounding quality bar are how they create value. They earn trust from operators, later-stage capital, and anyone who has lived through a messy scale-up. The risk is over-engineering: shipping late, under-weighting distribution, and designing for a future the market has not proven. They need a counterpart who will force contact with customers and a tempo that learns in public.',
    icon: 'ruler', accent: '#8b5cf6',
    strengths: [
      'Deep technical foundations that scale',
      'Designs process the team can trust',
      'A quality bar that compounds',
      'Installs systems that outlast the founder',
      'Low-drama execution under load',
    ],
    blindSpots: [
      'May over-engineer before market proof',
      'Slower to ship and learn in public',
      'Under-weights distribution and hype',
      'Can treat process as the product',
      'May screen out messy, high-upside bets',
    ],
    complements: ['The Rocketeer', 'The Maverick', 'Disciplined Allocator', 'Systems Builder', 'Craft Master'],
    matching: [
      { label: 'The Rocketeer', why: 'Forces distribution, timing, and a breakout tempo the Architect will not self-impose.' },
      { label: 'The Maverick', why: 'Cuts through over-design with instinct when the market will not wait for the perfect system.' },
      { label: 'Disciplined Allocator', why: 'Process-led capital that respects craft, pacing, and a diligence bar this founder already lives.' },
      { label: 'Systems Builder', why: 'A partner who installs company-scale machinery instead of leaving the Architect as the system.' },
      { label: 'Craft Master', why: 'Raises the quality bar from outside and teaches the craft without taking the keys.' },
    ],
  },
  fo_maverick: {
    label: 'The Maverick', tagline: 'Independent, instinctive, unafraid.',
    lean: 'Builder + Visionary',
    summary: 'High autonomy and risk appetite. Fast, instinct-led, and allergic to playbooks.',
    description: 'The Maverick thrives where there is no playbook. They make the call when the room disagrees, move on instinct, and would rather invent the path than inherit one. Contrarian bets, independent building, and a high risk appetite are the signature. They are often first to a weird, true insight. Alignment is the tax: they under-communicate, resist structure as the team grows, and can let instinct outrun evidence. They pair with people who will translate the bet into a system and a network without asking the Maverick to become a committee.',
    icon: 'zap', accent: '#eab308',
    strengths: [
      'Thrives where there is no playbook',
      'Fast, instinct-led decision making',
      'Unafraid of contrarian bets',
      'Builds the first version with their own hands',
      'Holds the line when consensus is wrong',
    ],
    blindSpots: [
      'May resist structure as the team grows',
      'Instinct can outrun the evidence',
      'Keeping others aligned and informed',
      'Under-uses the network until it is too late',
      'Can treat process as an insult rather than a tool',
    ],
    complements: ['The Architect', 'The Missionary', 'Network Amplifier', 'Embedded Operator', 'Hands-On Coach'],
    matching: [
      { label: 'The Architect', why: 'Turns instinct into structure so the company can grow without the Maverick in every decision.' },
      { label: 'The Missionary', why: 'Adds people, purpose, and a why that keeps a contrarian bet from becoming a private crusade.' },
      { label: 'Network Amplifier', why: 'Opens the doors and compounds the reputation this founder will not stop to build.' },
      { label: 'Embedded Operator', why: 'Delivers in the trenches beside them without demanding a playbook first.' },
      { label: 'Hands-On Coach', why: 'Installs a relationship cadence and a second brain the Maverick will not create alone.' },
    ],
  },

  // Investor — classified from the same four traits as founders.
  inv_thesis_backer: {
    label: 'Thesis-Driven Backer', tagline: 'Conviction before the crowd.',
    lean: 'Visionary + Operator',
    summary: 'Invests against a sharp thesis with rigor and patience; leads on conviction.',
    description: 'The Thesis-Driven Backer writes the map before they walk the room. They lead rounds from a differentiated thesis, hold through long cycles, and would rather be early and lonely than late and crowded. Diligence is in service of the idea, not a substitute for it. Founders get a partner who already believes the category will matter. The failure mode is over-fitting: dismissing signal that sits outside the memo, moving slowly on opportunistic deals, and letting the thesis become a filter that screens out outliers. They match with people who bring deal flow, founder empathy, and sleeves-up help they will not personally deliver at scale.',
    icon: 'target', accent: '#0ea5e9',
    strengths: [
      'A sharp, differentiated thesis',
      'Conviction to lead before consensus',
      'Patient through long holding periods',
      'Writes the memo before chasing the room',
      'Holds price and pacing against hype',
    ],
    blindSpots: [
      'May dismiss signals outside the thesis',
      'Slower on opportunistic deals',
      'Can over-index on the memo versus the founder',
      'Network and aftercare can lag the idea',
      'May miss category-adjacent outliers',
    ],
    complements: ['Network Amplifier', 'Hands-On Partner', 'The Missionary', 'Sage Guide', 'The Architect'],
    matching: [
      { label: 'Network Amplifier', why: 'Brings the rooms, introductions, and reputation the thesis will not generate on its own.' },
      { label: 'Hands-On Partner', why: 'Gets into the work with founders so the backer can stay at thesis altitude without going cold.' },
      { label: 'The Missionary', why: 'A founder whose durable why matches conviction-led, long-cycle capital.' },
      { label: 'Sage Guide', why: 'Adds judgment at the hard moments without asking the thesis to become tactics.' },
      { label: 'The Architect', why: 'A builder who will actually compound the category the thesis is written for.' },
    ],
  },
  inv_network_amplifier: {
    label: 'Network Amplifier', tagline: 'Opens doors, compounds relationships.',
    lean: 'Connector',
    summary: 'Creates value through people — introductions, reputation, and reach.',
    description: 'The Network Amplifier’s edge is the graph. They open doors founders cannot open alone, read rooms quickly, and compound reputation so the next introduction is easier than the last. After the cheque, their value is access: customers, talent, follow-on capital, and the social proof that makes a round feel real. They are the reason a company gets in the room. Diligence depth and process can stay thin if the relationship is doing all the work, and value can stall at introductions. They pair with rigorous allocators and sleeves-up partners who turn access into a company.',
    icon: 'network', accent: '#8b5cf6',
    strengths: [
      'Opens doors founders cannot open alone',
      'Compounds reputation and reach',
      'Reads people and rooms quickly',
      'Turns one relationship into a chain of useful ones',
      'Makes a round feel socially real',
    ],
    blindSpots: [
      'Lighter on diligence depth',
      'Value can stay introductions-deep',
      'May over-weight who is in the room versus the work',
      'Follow-through after the intro can slip',
      'Process and pacing are not the native language',
    ],
    complements: ['Disciplined Allocator', 'Hands-On Partner', 'The Maverick', 'Strategic Connector', 'The Rocketeer'],
    matching: [
      { label: 'Disciplined Allocator', why: 'Puts process, price, and diligence under the access so the cheque is still a good cheque.' },
      { label: 'Hands-On Partner', why: 'Turns introductions into product, GTM, and operating help after the door is open.' },
      { label: 'The Maverick', why: 'A founder who will not build the network themselves and needs doors more than a playbook.' },
      { label: 'Strategic Connector', why: 'A partner who maps people to a plan, not just a calendar of intros.' },
      { label: 'The Rocketeer', why: 'A breakout founder who can actually use the rooms this investor can open.' },
    ],
  },
  inv_hands_on_partner: {
    label: 'Hands-On Partner', tagline: 'Rolls up sleeves beside the founder.',
    lean: 'Builder + Connector',
    summary: 'Gets into product, GTM, and operations with the founder, not just the board pack.',
    description: 'The Hands-On Partner treats the investment as a working relationship. They sit in product reviews, help hire, debug GTM, and earn trust by shipping next to the founder instead of advising from altitude. Practical instincts across building and people are the edge — founders take the cheque because the help is real. The cost is bandwidth and boundaries: they can crowd autonomy, and depth caps how many companies they can truly serve. They match with thesis-led and network-led partners who cover the altitude and the graph they cannot live in every week.',
    icon: 'handshake', accent: '#f97316',
    strengths: [
      'Works beside founders on real problems',
      'Practical product and GTM instincts',
      'Earns trust through delivery',
      'Unblocks hiring, craft, and go-to-market in the week',
      'Translates board intent into work on the ground',
    ],
    blindSpots: [
      'Can crowd a founder’s autonomy',
      'Depth limits portfolio breadth',
      'May stay in the work past the point of usefulness',
      'Thesis and pacing can take a back seat to the current fire',
      'Hard to scale the model without cloning themselves',
    ],
    complements: ['Thesis-Driven Backer', 'Network Amplifier', 'The Rocketeer', 'Embedded Operator', 'Hands-On Coach'],
    matching: [
      { label: 'Thesis-Driven Backer', why: 'Holds the long-range thesis so this partner can live in the week without losing the plot.' },
      { label: 'Network Amplifier', why: 'Covers the rooms and reputation this partner will not stop building to do the work.' },
      { label: 'The Rocketeer', why: 'A founder moving fast enough that sleeves-up help is the difference between breakout and stall.' },
      { label: 'Embedded Operator', why: 'A delivery partner who can stay in the trenches when the investor has to rotate.' },
      { label: 'Hands-On Coach', why: 'Keeps the founder’s development on a cadence so the partner is not also the therapist.' },
    ],
  },
  inv_disciplined_allocator: {
    label: 'Disciplined Allocator', tagline: 'Rigorous, patient, process-led.',
    lean: 'Operator',
    summary: 'Deploys with process and diligence. Steady through hype, strict on price and pacing.',
    description: 'The Disciplined Allocator runs investing as a system. Checklists, pacing, price discipline, and repeatable diligence are how they avoid being the last money into a story. They are steady through hype cycles and trusted by LPs who want process they can audit. Founders who care about a clean, adult process find them a relief. The risk is speed and outliers: they can miss hot rounds, screen out weird founders, and let process become a substitute for taste. They pair with amplifiers who bring proprietary access and partners who will still do the work after the IC memo is filed.',
    icon: 'clipboard-check', accent: '#10b981',
    strengths: [
      'Rigorous, repeatable diligence',
      'Steady through hype cycles',
      'Discipline on price and pacing',
      'A process LPs and founders can actually trust',
      'Does not confuse excitement with a decision',
    ],
    blindSpots: [
      'May move too slowly in hot rounds',
      'Process can screen out outliers',
      'Can under-weight founder magic that will not fit a memo',
      'Aftercare and network may be thinner than the IC',
      'Risk of being the well-run fund that misses the decade',
    ],
    complements: ['Network Amplifier', 'Hands-On Partner', 'The Architect', 'Accountability Anchor', 'Systems Builder'],
    matching: [
      { label: 'Network Amplifier', why: 'Feeds proprietary access into a process that would otherwise only see consensus deals.' },
      { label: 'Hands-On Partner', why: 'Stays with the company after allocation, where this investor’s native language is the memo.' },
      { label: 'The Architect', why: 'A founder who already lives quality, systems, and pacing — the cleanest fit for process-led capital.' },
      { label: 'Accountability Anchor', why: 'Keeps portfolio commitments honest the same way this allocator keeps IC honest.' },
      { label: 'Systems Builder', why: 'Installs operating machinery in the company so diligence findings actually get fixed.' },
    ],
  },

  // Partner / operator.
  pt_strategic_connector: {
    label: 'Strategic Connector', tagline: 'Aligns the right people to the plan.',
    lean: 'Connector + Visionary',
    summary: 'Bridges strategy and network so the right people move the company forward.',
    description: 'The Strategic Connector is a broker of alignment. They map the plan, then map the people, and they are trusted across organizations because they make other people more effective. Strategy without a room is a slide; a room without a plan is noise — they refuse both. Their impact is leverage: one well-placed introduction or coalition can move a company further than a month of doing. Delivery is the gap. They need embedded operators and systems builders who will execute what the coalition just agreed, and founders who already know where they are going.',
    icon: 'network', accent: '#0ea5e9',
    strengths: [
      'Maps the right people to the plan',
      'Bridges strategy and network',
      'Trusted broker across organizations',
      'Turns a stalled room into a decision',
      'Builds coalitions that outlast a single intro',
    ],
    blindSpots: [
      'Lighter on hands-on delivery',
      'Impact depends on others executing',
      'Can over-index on alignment versus shipping',
      'May leave the last mile to someone who was never named',
      'Strategy can stay a conversation',
    ],
    complements: ['Embedded Operator', 'Systems Builder', 'Network Amplifier', 'The Missionary', 'Thesis-Driven Backer'],
    matching: [
      { label: 'Embedded Operator', why: 'Delivers the work the coalition just agreed so alignment does not die in the meeting notes.' },
      { label: 'Systems Builder', why: 'Turns a one-off alignment into machinery that does not need the connector in every room.' },
      { label: 'Network Amplifier', why: 'Expands the graph this connector is already using as a strategic instrument.' },
      { label: 'The Missionary', why: 'A founder with a clear why — the connector then finds the people who will carry it.' },
      { label: 'Thesis-Driven Backer', why: 'A conviction-led investor whose map this connector can staff with the right rooms.' },
    ],
  },
  pt_embedded_operator: {
    label: 'Embedded Operator', tagline: 'In the trenches, delivering.',
    lean: 'Builder + Operator',
    summary: 'Hands-on execution with real operational depth. Outcomes, not advice.',
    description: 'The Embedded Operator gets in the work. They take a function — product, ops, GTM, finance — and make it produce, with credibility earned by doing rather than framing. Founders keep them because the dashboard moves. They are the partner you want in a messy middle: hiring gaps, broken processes, a launch that has to land this month. The risk is going heads-down on the wrong hill, and scaling through hours instead of systems. They pair with connectors who keep the big picture staffed and catalysts who will not let delivery become the whole company.',
    icon: 'ruler', accent: '#f97316',
    strengths: [
      'Delivers outcomes, not just advice',
      'Deep functional expertise on tap',
      'Credibility earned in the trenches',
      'Closes the gap between plan and this week’s work',
      'Calm in operational mess',
    ],
    blindSpots: [
      'Can go heads-down on the big picture',
      'Scales through hours, not systems',
      'May become the function instead of building it',
      'Less energized by rooms and narrative',
      'Can over-own work the team should keep',
    ],
    complements: ['Strategic Connector', 'Growth Catalyst', 'Hands-On Partner', 'The Maverick', 'The Architect'],
    matching: [
      { label: 'Strategic Connector', why: 'Keeps the people and the plan in view while this operator lives in delivery.' },
      { label: 'Growth Catalyst', why: 'Turns the operator’s wins into a growth motion instead of a string of closed tickets.' },
      { label: 'Hands-On Partner', why: 'An investor who understands trench work and will not demote it to a board slide.' },
      { label: 'The Maverick', why: 'A founder who needs someone to land the work without first demanding a playbook.' },
      { label: 'The Architect', why: 'A quality-first founder who will actually keep the systems this operator installs.' },
    ],
  },
  pt_growth_catalyst: {
    label: 'Growth Catalyst', tagline: 'Turns momentum into scale.',
    lean: 'Builder + Visionary + Connector',
    summary: 'Blends people, product, and vision to turn early traction into a growth motion.',
    description: 'The Growth Catalyst is allergic to a one-off win. They take a spark of traction and install the motion — channel, narrative, team energy, a goal people can feel — so the next month is not a reinvention. They blend building, people, and vision, and they are the partner you want when something is working and nobody has professionalized it yet. The failure mode is pushing scale before fit, and leaving process as someone else’s problem. They need a systems builder under them and an embedded operator beside them, plus a founder who can actually use speed.',
    icon: 'trending-up', accent: '#8b5cf6',
    strengths: [
      'Turns early traction into momentum',
      'Blends people, product, and vision',
      'Energizes teams around a goal',
      'Installs a growth motion, not a one-off campaign',
      'Reads the moment when a company is ready to push',
    ],
    blindSpots: [
      'May push scale before fit is proven',
      'Lighter on durable process',
      'Can confuse energy with a system',
      'Quality and cadence may lag the story',
      'May leave too early, before the motion is owned',
    ],
    complements: ['Systems Builder', 'Embedded Operator', 'The Rocketeer', 'Network Amplifier', 'Hands-On Partner'],
    matching: [
      { label: 'Systems Builder', why: 'Puts durable machinery under the growth motion so it does not depend on this partner’s energy.' },
      { label: 'Embedded Operator', why: 'Lands the operational work behind each push so scale is not just a slide.' },
      { label: 'The Rocketeer', why: 'A founder already built for breakout — the catalyst professionalizes the push.' },
      { label: 'Network Amplifier', why: 'Opens channels and rooms that turn a growth motion into actual distribution.' },
      { label: 'Hands-On Partner', why: 'Capital that will sit in the growth work rather than only celebrating the chart.' },
    ],
  },
  pt_systems_builder: {
    label: 'Systems Builder', tagline: 'Puts durable machinery in place.',
    lean: 'Builder + Operator',
    summary: 'Installs process and systems that outlast the engagement.',
    description: 'The Systems Builder leaves machinery. Checklists, cadences, owners, tooling, and a way of working that still runs after they roll off — that is the product. They turn chaos into something a new hire can execute on week one. Low-drama, durable, slightly allergic to improvisation-as-culture. Companies keep them because the second year is cheaper than the first. The risk is building for a company that does not exist yet, and draining the improvisation a seed team still needs. They pair with catalysts and connectors who keep the system pointed at a living plan, and with architects who will not let the machinery rot.',
    icon: 'ruler', accent: '#10b981',
    strengths: [
      'Installs machinery that outlasts the engagement',
      'Turns chaos into repeatable process',
      'Low-drama, durable execution',
      'Makes the company less dependent on heroes',
      'Leaves owners, cadence, and tooling behind',
    ],
    blindSpots: [
      'Systems can outpace present needs',
      'Less energized by improvisation',
      'May over-process a team that still needs to search',
      'Can under-weight narrative and people-work',
      'Risk of a beautiful system nobody loves enough to run',
    ],
    complements: ['Growth Catalyst', 'Strategic Connector', 'The Architect', 'Disciplined Allocator', 'Accountability Anchor'],
    matching: [
      { label: 'Growth Catalyst', why: 'Keeps the system aimed at momentum so process does not become the product.' },
      { label: 'Strategic Connector', why: 'Staffs the plan with the right people; this builder then makes the plan executable.' },
      { label: 'The Architect', why: 'A founder who already wants durable foundations and will keep what gets installed.' },
      { label: 'Disciplined Allocator', why: 'Capital that diligences operations and will fund the unglamorous work of making them real.' },
      { label: 'Accountability Anchor', why: 'Holds the cadence after the builder rolls off, so the machinery stays honest.' },
    ],
  },

  // Advisor / coach.
  mt_sage_guide: {
    label: 'Sage Guide', tagline: 'Wisdom and perspective when it counts.',
    lean: 'Visionary + Connector',
    summary: 'Leads with long-range perspective, judgment, and empathy at the hard moments.',
    description: 'The Sage Guide is hired for the moment that does not fit a playbook: a board fight, a pivot, a founder who cannot see the decade from the week. They lead with perspective, judgment shaped by real cycles, and empathy that earns candor. Hours of doing are not the product — a reframe that changes the next six months is. Founders leave the session seeing a bigger board. Tactics and week-to-week cadence are the gap. They pair with coaches who will sit beside the person, and anchors who will turn the insight into commitments that survive until next Tuesday.',
    icon: 'compass', accent: '#0ea5e9',
    strengths: [
      'Long-range perspective under pressure',
      'Judgment shaped by real cycles',
      'Empathy that earns candor',
      'Reframes the problem when the room is stuck',
      'Holds the decade in view during a bad week',
    ],
    blindSpots: [
      'Advice can stay high-altitude',
      'Lighter on week-to-week tactics',
      'May under-specify the next action',
      'Can be scarce when the founder needs a session, not a parable',
      'Follow-through depends on someone else installing cadence',
    ],
    complements: ['Hands-On Coach', 'Accountability Anchor', 'The Missionary', 'Thesis-Driven Backer', 'Strategic Connector'],
    matching: [
      { label: 'Hands-On Coach', why: 'Turns the reframe into session-by-session work beside the person.' },
      { label: 'Accountability Anchor', why: 'Makes the insight a commitment with a date, not a conversation that evaporates.' },
      { label: 'The Missionary', why: 'A founder whose long cycle and durable why match high-altitude guidance.' },
      { label: 'Thesis-Driven Backer', why: 'Conviction-led capital that already thinks in years — the Guide then staffs the hard moments.' },
      { label: 'Strategic Connector', why: 'Puts the right people around a perspective so it does not stay private to the founder.' },
    ],
  },
  mt_hands_on_coach: {
    label: 'Hands-On Coach', tagline: 'Beside you, session by session.',
    lean: 'Builder + Connector',
    summary: 'Practical, relationship-led coaching with a steady cadence, not a distant advisory seat.',
    description: 'The Hands-On Coach does the work in relationship. They meet the person where they are, keep a cadence, and help with the actual problem of the week — hiring, a hard conversation, a product bind — rather than a generic framework. Trust is the product, rebuilt every session. Founders stay because it feels like a thinking partner who also shows up. The risk is softening hard truths to protect the bond, and going deep with a few people instead of carrying a broad playbook. They pair with a Sage for altitude and a Craft Master when the issue is skill, not will.',
    icon: 'users', accent: '#f97316',
    strengths: [
      'Practical help, session by session',
      'Steady, relationship-led cadence',
      'Meets founders where they are',
      'Makes development feel like work, not a lecture',
      'Earns enough trust to hear the real problem',
    ],
    blindSpots: [
      'May soften hard truths',
      'Depth over breadth of playbooks',
      'Can become extra executive capacity instead of a coach',
      'May under-use structure when the person needs a spine',
      'Hard to scale without thinning the relationship',
    ],
    complements: ['Sage Guide', 'Craft Master', 'The Maverick', 'Hands-On Partner', 'The Rocketeer'],
    matching: [
      { label: 'Sage Guide', why: 'Lifts the work out of the week when the founder needs a decade-scale reframe.' },
      { label: 'Craft Master', why: 'Teaches the actual skill when the bottleneck is craft, not confidence or cadence.' },
      { label: 'The Maverick', why: 'A founder who will not self-install a thinking partner and needs someone beside them.' },
      { label: 'Hands-On Partner', why: 'Capital that already lives in the work — the coach then owns the founder’s development.' },
      { label: 'The Rocketeer', why: 'Keeps a high-speed founder human and honest without asking them to slow the company to a workshop.' },
    ],
  },
  mt_accountability_anchor: {
    label: 'Accountability Anchor', tagline: 'Keeps commitments honest.',
    lean: 'Operator + Connector',
    summary: 'Structured, dependable follow-through. Turns intentions into a cadence people can see.',
    description: 'The Accountability Anchor is the spine. They make commitments visible, name owners and dates, and come back next session to ask what actually happened. Structure is care: founders who live in intention-without-follow-through get a partner who will not collude with the drift. They are dependable in a way that changes culture. In a crisis the same structure can feel rigid, and open-ended exploration is not the native move. They pair with Sages who reopen the question, and Craft Masters who raise the bar on the work being tracked.',
    icon: 'clipboard-check', accent: '#10b981',
    strengths: [
      'Keeps commitments visible and honest',
      'Dependable, structured follow-through',
      'Turns intentions into cadence',
      'Changes culture by refusing to collude with drift',
      'Makes progress inspectable without theatrics',
    ],
    blindSpots: [
      'Structure can feel rigid in a crisis',
      'Lighter on open-ended exploration',
      'May track the wrong commitments with great discipline',
      'Can under-weight relationship when the person needs warmth first',
      'Risk of becoming the process instead of the partner',
    ],
    complements: ['Sage Guide', 'Craft Master', 'The Rocketeer', 'Disciplined Allocator', 'Systems Builder'],
    matching: [
      { label: 'Sage Guide', why: 'Reopens the question when the cadence is honest but aimed at the wrong north star.' },
      { label: 'Craft Master', why: 'Raises the quality of the work being tracked so accountability is not empty throughput.' },
      { label: 'The Rocketeer', why: 'A high-speed founder whose commitments otherwise slip in the name of momentum.' },
      { label: 'Disciplined Allocator', why: 'Capital that already believes process is care — the Anchor then holds the portfolio company to it.' },
      { label: 'Systems Builder', why: 'Installs the machinery; the Anchor keeps it honest after the builder has left.' },
    ],
  },
  mt_craft_master: {
    label: 'Craft Master', tagline: 'Deep expertise, generously shared.',
    lean: 'Builder + Operator',
    summary: 'Teaches from earned, hands-on mastery. Raises the quality bar by doing, not telling.',
    description: 'The Craft Master has done the work at a level the room can feel. They teach by demonstrating — in the code, the model, the brand, the close — and they raise the team’s quality bar because they will not pretend a B is an A. Founders keep them for a specific craft they cannot hire yet. Generosity is the posture; narrowness is the risk. They can default to their own playbook, over-weight the domain they mastered, and miss a problem that is actually about people or strategy. They pair with Sages for perspective and Anchors so the new bar survives the week.',
    icon: 'star', accent: '#8b5cf6',
    strengths: [
      'Deep, earned mastery of the craft',
      'Teaches by doing, not telling',
      'Raises the team’s quality bar',
      'Shortens the path from amateur to competent',
      'Gives the company a standard it can copy',
    ],
    blindSpots: [
      'Expertise can narrow the lens',
      'May default to their own playbook',
      'Can over-weight craft versus distribution or people',
      'May stay in the work instead of transferring it',
      'Less useful when the problem is not the domain they mastered',
    ],
    complements: ['Sage Guide', 'Accountability Anchor', 'The Architect', 'Embedded Operator', 'Hands-On Coach'],
    matching: [
      { label: 'Sage Guide', why: 'Widens the lens when craft is excellent and the company is still pointed at the wrong problem.' },
      { label: 'Accountability Anchor', why: 'Makes the new quality bar a commitment, not a masterclass that fades.' },
      { label: 'The Architect', why: 'A founder who already lives quality and will institutionalize what the Master demonstrates.' },
      { label: 'Embedded Operator', why: 'Stays in the function after the lesson so the craft actually ships.' },
      { label: 'Hands-On Coach', why: 'Holds the person through the identity shift of raising their own standard.' },
    ],
  },
};

const ICONS = {
  compass: Compass, rocket: Rocket, ruler: Ruler, zap: Zap, flag: Flag,
  award: Award, medal: Medal, trophy: Trophy, star: Star, sparkles: Sparkles,
  // Task #7 — event-participation badge icons.
  mic: Mic, network: Network, ticket: Ticket,
  // Task #45 — role archetype icons.
  target: Target, handshake: Handshake, 'trending-up': TrendingUp,
  users: Users, 'clipboard-check': ClipboardCheck,
};
export function iconFor(name) {
  return ICONS[String(name || '').toLowerCase()] || Sparkles;
}

export function humanize(slug) {
  return String(slug || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function valueLabel(slug) { return VALUE_SPECTRUMS[slug]?.label || humanize(slug); }
export function skillLabel(slug) { return SKILL_AXES[slug] || humanize(slug); }
export function archetypeMeta(slug) { return ARCHETYPES[slug] || null; }

// Pixel-art sprites in `frontend/public/archetypes/`.
//   {slug}.png     male
//   {slug}_f.png   female
// Only known ARCHETYPES keys resolve — unknown or unsafe slugs return null
// so a bad slug cannot become a path. `variant` is 'm' | 'f'.
export function archetypeIllustration(slug, variant = 'm') {
  const key = String(slug || '').trim();
  if (!ARCHETYPES[key]) return null;
  const female = variant === 'f' || variant === 'female';
  return female ? `/archetypes/${key}_f.png` : `/archetypes/${key}.png`;
}

// Cinematic 21:9 banners for the full archetype page (not the compact /studio
// preview, which stays on the pixel sprites above).
//   /archetypes/banners/{slug}.webp     male
//   /archetypes/banners/{slug}_f.webp   female
export function archetypeBanner(slug, variant = 'm') {
  const key = String(slug || '').trim();
  if (!ARCHETYPES[key]) return null;
  const female = variant === 'f' || variant === 'female';
  return female ? `/archetypes/banners/${key}_f.webp` : `/archetypes/banners/${key}.webp`;
}

export function archetypeLicenceTitle(audience = 'founder') {
  if (audience === 'investor') return 'Investor archetype';
  if (audience === 'advisor') return 'Advisor archetype';
  if (audience === 'partner') return 'Partner/Operator archetype';
  return 'Founder archetype';
}

export function archetypeAudienceFromRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'investor') return 'investor';
  if (r === 'advisor' || r === 'mentor') return 'advisor';
  if (r === 'partner') return 'partner';
  return 'founder';
}

// ── XP / level curve (mirrors assessmentScoring.ts::levelForXp) ──────────────
export function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1;
}
// XP threshold to REACH a given level L: 100 * (L-1)^2.
export function xpForLevel(level) {
  const l = Math.max(1, Number(level) || 1);
  return 100 * (l - 1) * (l - 1);
}
// Progress within the current level.
export function levelProgress(xp) {
  const x = Math.max(0, Number(xp) || 0);
  const level = levelForXp(x);
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = Math.max(1, next - cur);
  const into = x - cur;
  return {
    level, xp: x,
    intoLevel: into, levelSpan: span,
    toNext: Math.max(0, next - x),
    pct: Math.max(0, Math.min(100, Math.round((into / span) * 100))),
  };
}

// Build radar rows for the 8 skill axes from a skillVector object {slug:level}.
export function skillRadarData(skillVector = {}, { short = false } = {}) {
  return SKILL_AXIS_ORDER.map((slug) => ({
    slug,
    axis: short ? SKILL_AXES_SHORT[slug] : SKILL_AXES[slug],
    value: Math.max(0, Math.min(5, Number(skillVector?.[slug]) || 0)),
  }));
}

// Top-N entries of a vector as [{slug,label,value}].
export function topValues(valueVector = {}, n = 3) {
  return Object.entries(valueVector || {})
    .map(([slug, v]) => ({ slug, label: valueLabel(slug), value: Number(v) || 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, n);
}
export function topSkills(skillVector = {}, n = 3) {
  return Object.entries(skillVector || {})
    .map(([slug, v]) => ({ slug, label: skillLabel(slug), value: Number(v) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// A spectrum's signed value → the leaning pole label (for the trading card).
export function spectrumLean(slug, value) {
  const meta = VALUE_SPECTRUMS[slug] || {};
  const v = Number(value) || 0;
  if (v > 0.2) return meta.high || 'High';
  if (v < -0.2) return meta.low || 'Low';
  return 'Balanced';
}

/**
 * Task #2 (AR) + Task #5 (CH) — New Founder Spin-Out Lab bank.
 *
 * Drives the 4-week Spin-Out Lab onboarding plus extended deep-dives
 * surfaced once each week unlocks. Question IDs added pre-Task-#5 are
 * preserved verbatim so the writeRouter doesn't break; new questions
 * use the `founder.lab.<topic>.<n>` namespace and route to existing
 * pages or to /spinout-lab as a default.
 *
 * Mirror of `frontend/src/lib/advisor/banks/newFounder.js` (legacy,
 * client-side optimistic only). The server is the source of truth —
 * the chat client consumes the manifest served by `/api/advisor/manifest`.
 */
import type { Question } from '../questionBank';

const SECTORS = ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'];
const STAGES = ['Idea', 'Prototype', 'Pre-seed', 'Seed', 'Series A', 'Later'];

// Helper: build a small block of week-gated lab deep-dive questions
// in one call so the file stays readable. Each takes a sub-topic
// label and emits a {prompt, importance, mi_section?} bundle.
function lab(week: number, section: string, page: string, anchor: string,
             rows: Array<{ id: string; prompt: string; kind?: Question['input_kind'];
                          imp?: Question['importance']; mi?: Question['mi_section'];
                          followups?: string[]; sent?: boolean; talc?: boolean;
                          opts?: string[]; skip?: boolean; ev?: boolean }>): Question[] {
  return rows.map(r => ({
    id: r.id,
    persona: 'founder',
    section,
    prompt: r.prompt,
    input_kind: r.kind ?? 'long',
    options: r.opts,
    importance: r.imp ?? 'normal',
    page_target: page,
    doc_anchor: anchor,
    unlock_required: { week },
    validate: r.kind === 'select' ? 'select'
            : r.kind === 'number' ? 'number'
            : r.kind === 'short'  ? 'short'
            : 'long',
    skip_allowed: r.skip ?? true,
    requires_evidence: r.ev,
    followups: r.followups,
    mi_section: r.mi,
    sentiment_eligible: r.sent,
    talc_eligible: r.talc,
  }));
}

export const NEW_FOUNDER_SPINOUT_BANK: Question[] = [
  // ---- WEEK 1 — Project + Customer Discovery -------------------------
  { id: 'founder.project.name', persona: 'founder', section: 'BUILD',
    prompt: 'What is your startup called?',
    hint: 'Working name; rename any time on the project page.',
    input_kind: 'short', importance: 'critical',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'short', followups: ['founder.project.pitch'] },
  { id: 'founder.project.pitch', persona: 'founder', section: 'BUILD',
    prompt: 'Give me a one-paragraph pitch — what do you do, for whom?',
    input_kind: 'long', importance: 'critical',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'long', followups: ['founder.project.sector'] },
  { id: 'founder.project.sector', persona: 'founder', section: 'BUILD',
    prompt: 'Which sector are you in?',
    input_kind: 'select', options: SECTORS, importance: 'high',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'select', mi_section: 'sector_heat', followups: ['founder.project.stage'] },
  { id: 'founder.project.stage', persona: 'founder', section: 'BUILD',
    prompt: 'What stage are you at?',
    input_kind: 'select', options: STAGES, importance: 'high',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'select', mi_section: 'capital_velocity' },

  { id: 'founder.discovery.interview1.name', persona: 'founder', section: 'BUILD',
    prompt: 'Pick 3 prospective customers to interview. Who is the first one?',
    input_kind: 'short', importance: 'critical',
    unlock_required: { milestones: ['project_created'] },
    page_target: '/build/discovery', doc_anchor: 'build/customer-discovery',
    followups: ['founder.discovery.interview1.pains'],
    validate: 'short' },
  { id: 'founder.discovery.interview1.pains', persona: 'founder', section: 'BUILD',
    prompt: "What pain are you testing with them?",
    input_kind: 'long', importance: 'high',
    unlock_required: { milestones: ['project_created'] },
    page_target: '/build/discovery', doc_anchor: 'build/customer-discovery',
    validate: 'long' },
  { id: 'founder.discovery.interview2.name', persona: 'founder', section: 'BUILD',
    prompt: 'Second interviewee?',
    input_kind: 'short', importance: 'critical',
    unlock_required: { milestones: ['customer_interview_logged_1'] },
    page_target: '/build/discovery', doc_anchor: 'build/customer-discovery',
    followups: ['founder.discovery.interview2.pains'],
    validate: 'short' },
  { id: 'founder.discovery.interview2.pains', persona: 'founder', section: 'BUILD',
    prompt: "And the pain you're testing with them?",
    input_kind: 'long', importance: 'high',
    unlock_required: { milestones: ['customer_interview_logged_1'] },
    page_target: '/build/discovery', doc_anchor: 'build/customer-discovery',
    validate: 'long' },
  { id: 'founder.discovery.interview3.name', persona: 'founder', section: 'BUILD',
    prompt: 'Third interviewee?',
    input_kind: 'short', importance: 'critical',
    unlock_required: { milestones: ['customer_interview_logged_2'] },
    page_target: '/build/discovery', doc_anchor: 'build/customer-discovery',
    followups: ['founder.discovery.interview3.pains'],
    validate: 'short' },
  { id: 'founder.discovery.interview3.pains', persona: 'founder', section: 'BUILD',
    prompt: "And the pain you're testing with them?",
    input_kind: 'long', importance: 'high',
    unlock_required: { milestones: ['customer_interview_logged_2'] },
    page_target: '/build/discovery', doc_anchor: 'build/customer-discovery',
    validate: 'long' },

  // ---- WEEK 2 — Roadmap + Brand + Deck (gated by Week-1 milestones) --
  { id: 'founder.okrs.q1_objective1', persona: 'founder', section: 'BUILD',
    prompt: 'Set three objectives for this quarter. What is the first?',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 2, milestones: ['customer_interview_logged_3'] },
    page_target: '/build/roadmap', doc_anchor: 'build/roadmap',
    validate: 'long' },
  { id: 'founder.okrs.q1_objective2', persona: 'founder', section: 'BUILD',
    prompt: 'Second objective for this quarter?',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 2, milestones: ['customer_interview_logged_3'] },
    page_target: '/build/roadmap', doc_anchor: 'build/roadmap',
    validate: 'long' },
  { id: 'founder.okrs.q1_objective3', persona: 'founder', section: 'BUILD',
    prompt: 'Third objective for this quarter?',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 2, milestones: ['customer_interview_logged_3'] },
    page_target: '/build/roadmap', doc_anchor: 'build/roadmap',
    validate: 'long' },
  { id: 'founder.brand.tagline', persona: 'founder', section: 'BUILD',
    prompt: 'Give me a one-line tagline for the landing page.',
    input_kind: 'short', importance: 'normal',
    unlock_required: { week: 2 },
    page_target: '/build/brand', doc_anchor: 'build/brand-builder',
    validate: 'short' },
  { id: 'founder.brand.theme_color', persona: 'founder', section: 'BUILD',
    prompt: 'Pick a brand color (hex, e.g. #7c3aed).',
    input_kind: 'short', importance: 'low',
    unlock_required: { week: 2 },
    page_target: '/build/brand', doc_anchor: 'build/brand-builder',
    validate: 'hex_color', skip_allowed: true },
  { id: 'founder.deck.problem', persona: 'founder', section: 'BUILD',
    prompt: 'Your deck — in one sentence, what problem are you solving?',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 2, milestones: ['brand_basics_filled'] },
    page_target: '/build/deck', doc_anchor: 'build/pitch-deck',
    validate: 'long' },
  { id: 'founder.deck.market', persona: 'founder', section: 'BUILD',
    prompt: 'And the market — who are the customers, and roughly how many?',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 2, milestones: ['brand_basics_filled'] },
    page_target: '/build/deck', doc_anchor: 'build/pitch-deck',
    validate: 'long' },
  // Task #14 — deck-autofill fields. Same routing target (/build/deck)
  // so progress lands inline with the rest of the deck prep rail.
  // Mirror of the founder.project.* additions in existingFounder.ts;
  // writeRouter routes each id to its column on projects (migration 069).
  { id: 'founder.project.tagline', persona: 'founder', section: 'BUILD',
    prompt: 'A one-line tagline — the line you would put on a billboard. (Used on the title slide of every deck template.)',
    input_kind: 'short', importance: 'high',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'short' },
  { id: 'founder.project.vision', persona: 'founder', section: 'BUILD',
    prompt: 'One-paragraph vision — where the company is in 10 years if everything goes right.',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'long' },
  { id: 'founder.project.contact_email', persona: 'founder', section: 'BUILD',
    prompt: 'Best contact email for inbound from investors. Renders on the closing slide of every deck.',
    input_kind: 'short', importance: 'high',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'short' },
  { id: 'founder.project.logo_url', persona: 'founder', section: 'BUILD',
    prompt: 'Public HTTPS URL to your logo. (Used on title + closing slides.) Skip if you do not have one yet.',
    input_kind: 'short', importance: 'low',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'short', skip_allowed: true },
  { id: 'founder.project.som_usd', persona: 'founder', section: 'BUILD',
    prompt: 'Serviceable Obtainable Market (USD) — the slice you realistically capture in 3 years.',
    input_kind: 'number', importance: 'normal',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'number', skip_allowed: true, requires_evidence: true },
  { id: 'founder.project.cac_usd', persona: 'founder', section: 'BUILD',
    prompt: 'Blended CAC (USD). Used on the business-model slide of every deck.',
    input_kind: 'number', importance: 'normal',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'number', skip_allowed: true, requires_evidence: true },
  { id: 'founder.project.gross_margin_pct', persona: 'founder', section: 'BUILD',
    prompt: 'Gross margin %. Used on the business-model + unit-economics slides.',
    input_kind: 'number', importance: 'normal',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'number', skip_allowed: true, requires_evidence: true },
  { id: 'founder.project.traction_summary', persona: 'founder', section: 'BUILD',
    prompt: 'Short summary of your traction so far (3-4 sentences). Used as the body of the Traction slide.',
    input_kind: 'long', importance: 'normal',
    unlock_required: { week: 2 },
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'long', skip_allowed: true },

  // ---- WEEK 3 — Network (advisors / co-founders / scoring) ------------
  { id: 'founder.team.cofounders', persona: 'founder', section: 'NETWORK',
    prompt: 'Are you solo, or do you have co-founders? (comma-separated names; type "solo" if none)',
    input_kind: 'short', importance: 'normal',
    unlock_required: { week: 3 },
    page_target: '/cofounder-match', doc_anchor: 'getting-started/invite-team',
    validate: 'short', skip_allowed: true },
  { id: 'founder.advisors.needs', persona: 'founder', section: 'NETWORK',
    prompt: 'What expertise do you most need from an advisor right now? (comma-separated)',
    input_kind: 'short', importance: 'high',
    unlock_required: { week: 3 },
    page_target: '/advisors', doc_anchor: 'portals/advisor',
    validate: 'csv' },

  // ---- WEEK 4 — Incorporation + Capital ------------------------------
  { id: 'founder.captable.entity', persona: 'founder', section: 'LEGAL',
    prompt: 'Are you ready to incorporate? If so, what entity (e.g. Delaware C-Corp)?',
    input_kind: 'short', importance: 'critical',
    unlock_required: { week: 4 },
    page_target: '/legal/incorporation', doc_anchor: 'legal/incorporation',
    validate: 'short' },
  { id: 'founder.captable.ownership', persona: 'founder', section: 'CAPITAL',
    prompt: 'Roughly, who will own the company at incorporation? (e.g. "Founders 90%, ESOP 10%")',
    input_kind: 'long', importance: 'high',
    unlock_required: { week: 4, milestones: ['incorporation_completed'] },
    page_target: '/build/captable', doc_anchor: 'capital/cap-table',
    validate: 'long' },

  // =====================================================================
  // Task #5 (CH) — Lab deep-dives. Week-gated extras, batched by week.
  // Each block targets the same page so progress lands in one rail.
  // =====================================================================

  // ---- Week 1 deep dives — Discovery quality + ICP signal -----------
  ...lab(1, 'BUILD', '/build/discovery', 'build/customer-discovery', [
    { id: 'founder.lab.discovery.icp_v1', prompt: "In one sentence, who is your initial ICP today? (job title + company stage)", kind: 'short', imp: 'high', mi: 'fit' },
    { id: 'founder.lab.discovery.icp_buyer_vs_user', prompt: 'Is the person feeling the pain the same person who would write a check? If not, who is each?', mi: 'fit' },
    { id: 'founder.lab.discovery.willingness_to_pay', prompt: 'On the discovery calls, did anyone explicitly say they would pay? Quote them if so.', mi: 'sentiment', sent: true },
    { id: 'founder.lab.discovery.alternatives', prompt: 'What are interviewees doing today instead of your solution? (incumbents, hacks, do-nothing)', mi: 'demand_supply' },
    { id: 'founder.lab.discovery.deal_breaker', prompt: 'What single objection killed the most calls? How will you address it next iteration?' },
    { id: 'founder.lab.discovery.signal_score', prompt: 'On a 1-10 scale, how strong is your "this pain is real, urgent, and willing-to-pay" signal so far?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], imp: 'high', mi: 'sentiment', sent: true },
    { id: 'founder.lab.discovery.pivot_signal', prompt: "If you HAD to pivot the wedge today, what's your second-best target customer?", mi: 'demand_supply' },
    { id: 'founder.lab.discovery.followup_scheduled', prompt: 'How many of your three interviewees agreed to a follow-up conversation? (0-3)', kind: 'select', opts: ['0','1','2','3'], mi: 'sentiment', sent: true },
  ]),

  // ---- Week 2 deep dives — Validation + Vision + Deck depth ---------
  ...lab(2, 'BUILD', '/build/deck', 'build/pitch-deck', [
    { id: 'founder.lab.deck.solution', prompt: 'In one sentence — what is the solution and why is it 10x better than the alternative?', imp: 'high' },
    { id: 'founder.lab.deck.why_now', prompt: "What's the inflection (regulation, tech, behaviour) that makes NOW the moment for this?", imp: 'high', mi: 'sector_heat' },
    { id: 'founder.lab.deck.business_model', prompt: 'How will you make money? (pricing model + ACV ballpark)', imp: 'high', mi: 'capital_velocity' },
    { id: 'founder.lab.deck.go_to_market', prompt: 'How do customers find you? (top 1-2 acquisition channels)', mi: 'demand_supply' },
    { id: 'founder.lab.deck.moat', prompt: "What's your unfair advantage / moat — and how does it compound over time?" },
    { id: 'founder.lab.deck.team_slide', prompt: "Why is THIS team the right team to win? (credibility / unique insight / depth)" },
    { id: 'founder.lab.deck.ask', prompt: "What are you asking from your first round investors? (amount, milestones it buys)", mi: 'capital_velocity', ev: true },
    { id: 'founder.lab.deck.competition_map', prompt: 'List the 3 closest competitors and how you differentiate from each.', mi: 'sector_heat' },
    { id: 'founder.lab.deck.demo_link', prompt: 'Drop a link to your latest demo / prototype / Loom (or "none yet").', kind: 'short', skip: true },
  ]),
  ...lab(2, 'BUILD', '/build/roadmap', 'build/roadmap', [
    { id: 'founder.lab.roadmap.kr_for_obj1', prompt: 'For your first OKR — what is the one number / proof point that says you won?', imp: 'high' },
    { id: 'founder.lab.roadmap.kr_for_obj2', prompt: 'And the proof point for OKR #2?' },
    { id: 'founder.lab.roadmap.kr_for_obj3', prompt: 'And OKR #3?' },
    { id: 'founder.lab.roadmap.weekly_cadence', prompt: 'What weekly ritual will you use to track progress? (standup, written update, etc.)' },
  ]),

  // ---- Week 3 deep dives — Network, advisor matching, co-founder fit -
  ...lab(3, 'NETWORK', '/advisors', 'portals/advisor', [
    { id: 'founder.lab.advisors.priority1', prompt: 'Of all the advisor needs you listed, which ONE would unblock you most this month?', imp: 'high' },
    { id: 'founder.lab.advisors.intro_target', prompt: 'Name one specific person whose intro you want — even if they feel out of reach.', mi: 'partner_pulse' },
    { id: 'founder.lab.advisors.warm_path', prompt: 'Who in your network might be able to make that intro? (name + 1 line of context)' },
    { id: 'founder.lab.advisors.cadence', prompt: 'How often do you want to meet with advisors once matched? (weekly / biweekly / monthly / ad-hoc)', kind: 'select', opts: ['Weekly','Biweekly','Monthly','Ad-hoc'], mi: 'partner_pulse' },
    { id: 'founder.lab.advisors.style', prompt: 'Tactical operator vs strategic counsellor — which advisor style do you need most right now?', kind: 'select', opts: ['Tactical operator','Strategic counsellor','Mix'] },
  ]),
  ...lab(3, 'NETWORK', '/cofounder-match', 'getting-started/invite-team', [
    { id: 'founder.lab.team.cofounder_gap', prompt: 'If you could clone yourself with one different skill set, what would it be? (e.g. "I am product, I need GTM")', imp: 'high', mi: 'fit' },
    { id: 'founder.lab.team.dealbreakers', prompt: 'What are your 2-3 non-negotiables in a co-founder? (values, working hours, comp expectations)' },
    { id: 'founder.lab.team.equity_philosophy', prompt: 'Are you open to splitting equity equally with a future co-founder, or do you want a clear majority? Why?' },
    { id: 'founder.lab.team.first_5_hires', prompt: 'After founders, what are the first 5 hires you would make in order? (1 line each)' },
    { id: 'founder.lab.team.remote_or_office', prompt: 'How will the team work — fully remote, hybrid, or in-person? Why does that fit the work?', kind: 'select', opts: ['Fully remote','Hybrid','In-person','Undecided'] },
  ]),

  // ---- Week 4 deep dives — Incorporation, IP, capital structure -----
  ...lab(4, 'LEGAL', '/legal/incorporation', 'legal/incorporation', [
    { id: 'founder.lab.legal.state', prompt: 'Which state / jurisdiction will you incorporate in? Why?', kind: 'short', mi: 'sentiment_geo' },
    { id: 'founder.lab.legal.83b_planned', prompt: 'Will you (or have you) filed an 83(b) election within 30 days of equity grant? (Yes / No / Not applicable)', kind: 'select', opts: ['Yes','No','Not applicable'], imp: 'high' },
    { id: 'founder.lab.legal.ip_assignment', prompt: 'Have all founders signed IP assignment agreements? (Yes / No / In progress)', kind: 'select', opts: ['Yes','No','In progress'], imp: 'high' },
    { id: 'founder.lab.legal.prior_employer_ip', prompt: 'Any prior-employer IP / non-compete / moonlighting concerns we should flag now?' },
    { id: 'founder.lab.legal.advisor_seats', prompt: 'How many advisor seats do you intend to grant in the first year? (0-5)', kind: 'select', opts: ['0','1','2','3','4','5'] },
  ]),
  ...lab(4, 'CAPITAL', '/capital/fundraise', 'capital/fundraise', [
    { id: 'founder.lab.capital.first_raise_target', prompt: 'What is the size of your first planned raise (USD)? Even a rough order of magnitude is fine.', kind: 'number', imp: 'high', mi: 'capital_velocity', ev: true },
    { id: 'founder.lab.capital.runway_target_months', prompt: 'How many months of runway should that raise buy you, at planned spend?', kind: 'number', mi: 'capital_velocity' },
    { id: 'founder.lab.capital.instrument', prompt: 'SAFE, priced round, or convertible note? Why?', kind: 'select', opts: ['SAFE','Priced round','Convertible note','Undecided'], mi: 'capital_velocity' },
    { id: 'founder.lab.capital.target_investors', prompt: 'List 3 specific funds / angels you want on your cap table. (one per line)' },
    { id: 'founder.lab.capital.warm_intros', prompt: 'For each of those, do you have a warm path? (yes / partial / no)' },
    { id: 'founder.lab.capital.lead_investor', prompt: "Are you optimising for a lead investor, party round, or 'just close fast'?", kind: 'select', opts: ['Lead investor','Party round','Close fast','Open to either'] },
  ]),

  // ---- Cross-week — Founder wellbeing + sentiment surveys -----------
  ...lab(2, 'WELLBEING', '/wellbeing', 'support/wellbeing', [
    { id: 'founder.lab.wellbeing.energy', prompt: 'On a 1-10, how is your energy this week?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'founder.lab.wellbeing.support', prompt: 'Who is your go-to person when you need to vent — and have you talked to them this week?' },
    { id: 'founder.lab.wellbeing.biggest_blocker', prompt: 'What is the single biggest thing weighing on you right now?' },
    { id: 'founder.lab.wellbeing.sleep_hours', prompt: 'Average sleep per night this past week (hours).', kind: 'number', mi: 'sentiment', sent: true },
    { id: 'founder.lab.wellbeing.exercise_freq', prompt: 'Times you exercised this past week.', kind: 'select', opts: ['0','1-2','3-4','5+'], mi: 'sentiment', sent: true },
    { id: 'founder.lab.wellbeing.cofounder_pulse', prompt: 'If you have co-founders — when did you last have a 1:1 retro with them?', kind: 'short' },
    { id: 'founder.lab.wellbeing.scary_question', prompt: "What's the question you've been avoiding asking yourself?" },
  ]),

  // ---- Week 3 deep dive extras — vision, validation rigour ---------
  ...lab(3, 'BUILD', '/build/metrics', 'capital/metrics', [
    { id: 'founder.lab.metrics.first_north_star', prompt: 'What is your single north-star metric for the next 90 days?', imp: 'high', mi: 'demand_supply' },
    { id: 'founder.lab.metrics.weekly_target', prompt: 'And the weekly numerical target for that metric?', kind: 'short', mi: 'demand_supply' },
    { id: 'founder.lab.metrics.tracking_tool', prompt: 'Where will you track it (spreadsheet, dashboard tool, manual log)?', kind: 'short' },
    { id: 'founder.lab.metrics.signal_v_noise', prompt: 'How will you tell signal from noise in week-over-week movement?' },
  ]),

  // ---- Week 4 deep dive extras — operating cadence + first hires ---
  ...lab(4, 'OPS', '/settings', 'getting-started/personas', [
    { id: 'founder.lab.ops.weekly_review', prompt: 'What weekly review will you run with yourself once incorporated?' },
    { id: 'founder.lab.ops.first_hire_role', prompt: 'First hire after incorporation — what role and why?', followups: ['founder.lab.ops.first_hire_when'] },
    { id: 'founder.lab.ops.first_hire_when', prompt: 'And when do you plan to make that hire?', kind: 'short' },
    { id: 'founder.lab.ops.first_hire_comp', prompt: 'Comp band for that first hire (cash + equity).', kind: 'short', skip: true, ev: true },
    { id: 'founder.lab.ops.budget_template', prompt: 'Have you set up a basic monthly budget? (Yes / In progress / Not yet)', kind: 'select', opts: ['Yes','In progress','Not yet'] },
    { id: 'founder.lab.ops.bank_setup', prompt: 'Business bank account opened? Which bank?', kind: 'short', skip: true },
    { id: 'founder.lab.ops.payroll_provider', prompt: 'Payroll provider planned (Gusto, Rippling, Deel, none yet)?', kind: 'select', opts: ['Gusto','Rippling','Deel','Other','None yet'] },
    { id: 'founder.lab.ops.accounting_provider', prompt: 'Accounting / bookkeeping provider planned?', kind: 'short', skip: true },
    { id: 'founder.lab.ops.governance_doc', prompt: 'Will you draft a lightweight founder agreement (working norms, equity, dispute)? When?', kind: 'short' },
    { id: 'founder.lab.ops.communication_norm', prompt: 'How will the team communicate — Slack? Discord? Email-first? Set the norm now.', kind: 'select', opts: ['Slack','Discord','Email','Microsoft Teams','Other'] },
  ]),
];

export default NEW_FOUNDER_SPINOUT_BANK;

/**
 * Task #10 (AC-1) — Minimal seed question bank.
 *
 * AC-2 will replace this with the full per-persona, multi-page banks.
 * For AC-1 we ship just enough questions per persona to exercise the
 * write-router round trip (start → answer → next).
 *
 * Each Question is a SOURCE-OF-TRUTH record:
 *   - id              — opaque key persisted in advisor_answers; never reuse
 *   - persona         — 'founder' | 'investor' | 'mentor' | 'partner' | 'unknown'
 *   - prompt          — the natural-language question shown to the user
 *   - hint            — short helper text under the input
 *   - input_kind      — 'short' | 'long' | 'number' | 'select' | 'multi'
 *   - options         — required when input_kind ∈ {select, multi}
 *   - skip_allowed    — if false the UI suppresses the Skip button
 *   - sensitive       — if true never echo back to LLM in /explain prompts
 */

export type Persona = 'founder' | 'investor' | 'mentor' | 'partner' | 'admin' | 'unknown';

export interface Question {
  id: string;
  persona: Persona;
  prompt: string;
  hint?: string;
  input_kind: 'short' | 'long' | 'number' | 'select' | 'multi';
  options?: string[];
  skip_allowed?: boolean;
  sensitive?: boolean;
}

// ----- Role detector (asked when users.role is null) ----------------------
export const ROLE_DETECTOR: Question[] = [
  {
    id: 'role_detect.primary',
    persona: 'unknown',
    prompt: "Welcome to Axal. Which best describes how you'll use StudioOS?",
    hint: 'You can change this any time in Settings.',
    input_kind: 'select',
    options: ['I am building a startup', 'I invest in startups', 'I mentor founders', 'I partner with the studio'],
    skip_allowed: false,
  },
  {
    id: 'role_detect.organization',
    persona: 'unknown',
    prompt: 'What firm or organization are you with? (Type "Independent" if none.)',
    input_kind: 'short',
    skip_allowed: true,
  },
  {
    id: 'role_detect.headline',
    persona: 'unknown',
    prompt: 'In one line, what are you working on or known for right now?',
    input_kind: 'short',
    skip_allowed: true,
  },
];

// Map the role-detector primary answer → users.role enum value.
export function mapRoleAnswer(answerText: string): Persona | null {
  const t = answerText.toLowerCase();
  if (t.includes('build')) return 'founder';
  if (t.includes('invest')) return 'investor';
  if (t.includes('mentor')) return 'mentor';
  if (t.includes('partner')) return 'partner';
  return null;
}

// ----- Per-persona seed banks --------------------------------------------
const FOUNDER_BANK: Question[] = [
  { id: 'founder.project.name',     persona: 'founder', prompt: 'What is your startup called?',                           input_kind: 'short' },
  { id: 'founder.project.pitch',    persona: 'founder', prompt: 'Give me a one-paragraph pitch — what do you do, for whom?', input_kind: 'long' },
  { id: 'founder.project.sector',   persona: 'founder', prompt: 'Which sector are you in?', input_kind: 'select',
    options: ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'] },
  { id: 'founder.project.stage',    persona: 'founder', prompt: 'What stage are you at?', input_kind: 'select',
    options: ['Idea', 'Prototype', 'Pre-seed', 'Seed', 'Series A', 'Later'] },
  { id: 'founder.project.traction', persona: 'founder', prompt: 'Briefly — what traction do you have so far? (users, revenue, LOIs, etc.)', input_kind: 'long', skip_allowed: true },

  // ----- AC-2 New Founder additions ---------------------------------
  // The router persists every id below into a real domain table so a
  // founder finishing the bank ends up with a populated project, ≥3
  // discovery interviews, ≥3 OKRs, brand basics, a deck-draft seed,
  // and the Spin-Out-Lab week-1 review milestone.
  { id: 'founder.discovery.interview1.name',  persona: 'founder', prompt: 'Pick 3 customers to interview. Who is the first one?', input_kind: 'short' },
  { id: 'founder.discovery.interview1.pains', persona: 'founder', prompt: 'What pain are you testing with them?', input_kind: 'long' },
  { id: 'founder.discovery.interview2.name',  persona: 'founder', prompt: 'Second interviewee?', input_kind: 'short' },
  { id: 'founder.discovery.interview2.pains', persona: 'founder', prompt: 'And the pain you’re testing with them?', input_kind: 'long' },
  { id: 'founder.discovery.interview3.name',  persona: 'founder', prompt: 'Third interviewee?', input_kind: 'short' },
  { id: 'founder.discovery.interview3.pains', persona: 'founder', prompt: 'And the pain you’re testing with them?', input_kind: 'long' },
  { id: 'founder.okrs.q1_objective1', persona: 'founder', prompt: 'Set three objectives for this quarter. What is the first?', input_kind: 'long' },
  { id: 'founder.okrs.q1_objective2', persona: 'founder', prompt: 'Second objective for this quarter?', input_kind: 'long' },
  { id: 'founder.okrs.q1_objective3', persona: 'founder', prompt: 'Third objective for this quarter?', input_kind: 'long' },
  { id: 'founder.brand.tagline',     persona: 'founder', prompt: 'Give me a one-line tagline for the landing page.', input_kind: 'short' },
  { id: 'founder.brand.theme_color', persona: 'founder', prompt: 'Pick a brand color (hex, e.g. #7c3aed).',          input_kind: 'short' },
  { id: 'founder.deck.problem', persona: 'founder', prompt: 'In one sentence, what problem are you solving?', input_kind: 'long' },
  { id: 'founder.deck.market',  persona: 'founder', prompt: 'Who are the customers, and roughly how many?',  input_kind: 'long' },
  // Spin-Out Lab Week-1 milestones are emitted as side-effects of
  // the three discovery interview answers (router writes
  // `customer_interview_logged_{1,2,3}`); no standalone Q is needed.

  // Existing-founder additions — recorded as noops by the router but
  // recognised by questionById() so the chat client can render them
  // without unknown_question errors.
  { id: 'founder.team.cofounders',          persona: 'founder', prompt: 'Solo or co-founders? (comma-separated names)', input_kind: 'short', skip_allowed: true },
  { id: 'founder.captable.entity',          persona: 'founder', prompt: 'Are you incorporated? If yes, what entity?',  input_kind: 'short' },
  { id: 'founder.captable.ownership',       persona: 'founder', prompt: 'Roughly, who owns the company today?',         input_kind: 'long' },
  { id: 'founder.financials.runway_months', persona: 'founder', prompt: 'How many months of runway do you have?',       input_kind: 'number' },
  { id: 'founder.financials.monthly_burn_usd', persona: 'founder', prompt: 'Monthly burn (USD).',                       input_kind: 'number' },
  { id: 'founder.financials.mrr_usd',       persona: 'founder', prompt: 'Monthly recurring revenue (USD). 0 if none.',  input_kind: 'number' },
  { id: 'founder.pipeline.top_deals',       persona: 'founder', prompt: 'Your top 3 sales deals or design partners in flight?', input_kind: 'long' },
  { id: 'founder.compliance.status',        persona: 'founder', prompt: 'Compliance — anything overdue?',               input_kind: 'long' },
  { id: 'founder.capital.raise_active',     persona: 'founder', prompt: 'Are you actively raising right now?',          input_kind: 'select', options: ['Yes', 'No', 'Soon'] },
  { id: 'founder.capital.raise_target_usd', persona: 'founder', prompt: 'How much are you raising (USD)?',              input_kind: 'number', skip_allowed: true },
  { id: 'founder.mentors.needs',            persona: 'founder', prompt: 'What expertise do you most need from a mentor right now?', input_kind: 'short' },
];

const INVESTOR_BANK: Question[] = [
  { id: 'investor.profile.investor_type', persona: 'investor', prompt: 'Which best describes your investing capacity?', input_kind: 'select',
    options: ['Angel', 'Family Office', 'Micro VC', 'Traditional VC', 'Corporate Venture', 'Syndicate Lead'] },
  { id: 'investor.profile.sectors', persona: 'investor', prompt: 'Which sectors are you actively investing in? (comma-separated)', input_kind: 'short',
    hint: 'e.g. AI, Climate, Fintech' },
  { id: 'investor.profile.stages', persona: 'investor', prompt: 'Which stages do you write checks at? (comma-separated)', input_kind: 'short',
    hint: 'e.g. Pre-seed, Seed, Series A' },
  { id: 'investor.profile.ticket_band', persona: 'investor', prompt: 'What ticket size do you typically write?', input_kind: 'select',
    options: ['<$25k', '$25k–$100k', '$100k–$500k', '$500k–$2M', '$2M+'] },
  { id: 'investor.profile.thesis',  persona: 'investor', prompt: 'Tell me your investment thesis in 2-4 sentences.', input_kind: 'long', skip_allowed: true },

  // ----- AC-2 additions (recorded as noops; surfaced by chat UI) -----
  { id: 'investor.pipeline.deal_volume',     persona: 'investor', prompt: 'How many deals do you actively look at per quarter?', input_kind: 'select',
    options: ['<5', '5–20', '20–50', '50+'] },
  { id: 'investor.coinvest.preferences',     persona: 'investor', prompt: 'Lead, follow, or both? Co-invest preferences?', input_kind: 'long' },
  { id: 'investor.watchlist.seed_companies', persona: 'investor', prompt: 'Any companies you’re already tracking? (comma-separated)', input_kind: 'short', skip_allowed: true },
];

// Mentor bank — column names match the live D1 mentors schema as used
// by routes/mentors.ts (display_name / bio / sectors_json /
// expertise_json / hourly_rate_usd / linkedin_url). Earlier drafts
// referenced `headline` / `capacity_per_week` / `hourly_rate` which do
// not exist in the production schema.
const MENTOR_BANK: Question[] = [
  { id: 'mentor.profile.display_name',   persona: 'mentor', prompt: 'What name should we display on your mentor profile?', input_kind: 'short' },
  { id: 'mentor.profile.bio',            persona: 'mentor', prompt: 'A short bio (2-3 sentences) — what should founders know about you?', input_kind: 'long' },
  { id: 'mentor.profile.sectors',        persona: 'mentor', prompt: 'Which sectors do you cover? (comma-separated)', input_kind: 'short' },
  { id: 'mentor.profile.expertise',      persona: 'mentor', prompt: 'Which functional areas of expertise do you offer? (comma-separated)', input_kind: 'short' },
  { id: 'mentor.profile.hourly_rate_usd', persona: 'mentor', prompt: 'Your hourly rate in USD (0 if pro-bono).', input_kind: 'number', skip_allowed: true },
  { id: 'mentor.profile.linkedin_url',   persona: 'mentor', prompt: 'Share your LinkedIn URL so founders can vet you.', input_kind: 'short', skip_allowed: true },

  // ----- AC-2 additions (recorded as noops; surfaced by chat UI) -----
  { id: 'mentor.topics.willing',         persona: 'mentor', prompt: 'Which topics are you happy to take on? (comma-separated)', input_kind: 'short' },
  { id: 'mentor.topics.unwilling',       persona: 'mentor', prompt: 'Anything you would rather not advise on?',                input_kind: 'short', skip_allowed: true },
  { id: 'mentor.calendar.weekly_hours',  persona: 'mentor', prompt: 'Roughly how many hours per week can you offer founders?', input_kind: 'select', options: ['<1', '1-2', '3-5', '5+'] },
];

// Partners are profiled in the dedicated partner-onboarding wizard
// (Task #9, X-2). Inside the advisor we only ask non-binding ambient
// questions so partners aren't double-prompted.
const PARTNER_BANK: Question[] = [
  { id: 'partner.profile.focus',    persona: 'partner', prompt: 'What slice of the studio do you want to focus on this quarter?', input_kind: 'long', skip_allowed: true },
  // ----- AC-2 additions (recorded as noops; surfaced by chat UI) -----
  { id: 'partner.firm.name',          persona: 'partner', prompt: 'Which firm or organization are you with?',                  input_kind: 'short' },
  { id: 'partner.role.kind',          persona: 'partner', prompt: 'Which role best describes your partnership with the studio?', input_kind: 'select', options: ['Investor', 'Service Provider', 'Mentor / Advisor', 'Strategic Partner', 'Other'] },
  { id: 'partner.services.offered',   persona: 'partner', prompt: 'What do you bring to portfolio companies? (comma-separated)', input_kind: 'short' },
  { id: 'partner.deals.interest',     persona: 'partner', prompt: 'What kinds of deals or projects most interest you?',         input_kind: 'long' },
  { id: 'partner.conflicts.list',     persona: 'partner', prompt: 'Any conflicts of interest we should know about?',            input_kind: 'long', skip_allowed: true },
  { id: 'partner.dealflow.channels',  persona: 'partner', prompt: 'Where does your deal flow come from today? (comma-separated)', input_kind: 'short' },
];

const ADMIN_BANK: Question[] = [
  { id: 'admin.preferences.digest_freq', persona: 'admin', prompt: 'How often do you want the daily-digest summary?', input_kind: 'select',
    options: ['Daily', 'Weekly', 'Off'] },
];

const PERSONA_BANK: Record<Persona, Question[]> = {
  founder:  FOUNDER_BANK,
  investor: INVESTOR_BANK,
  mentor:   MENTOR_BANK,
  partner:  PARTNER_BANK,
  admin:    ADMIN_BANK,
  unknown:  [],
};

export function bankFor(persona: Persona): Question[] {
  return PERSONA_BANK[persona] || [];
}

export function questionById(id: string): Question | null {
  for (const persona of Object.keys(PERSONA_BANK) as Persona[]) {
    const hit = PERSONA_BANK[persona].find(q => q.id === id);
    if (hit) return hit;
  }
  return ROLE_DETECTOR.find(q => q.id === id) || null;
}

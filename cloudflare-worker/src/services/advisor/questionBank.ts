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
];

const MENTOR_BANK: Question[] = [
  { id: 'mentor.profile.headline',  persona: 'mentor', prompt: 'Give me a one-line headline for your mentor profile.', input_kind: 'short' },
  { id: 'mentor.profile.bio',       persona: 'mentor', prompt: 'A short bio (2-3 sentences) — what should founders know about you?', input_kind: 'long' },
  { id: 'mentor.profile.sectors',   persona: 'mentor', prompt: 'Which sectors do you cover? (comma-separated)', input_kind: 'short' },
  { id: 'mentor.profile.capacity',  persona: 'mentor', prompt: 'How many office-hours sessions can you take per week?', input_kind: 'number' },
  { id: 'mentor.profile.hourly_rate', persona: 'mentor', prompt: 'Your hourly rate in USD (0 if pro-bono).', input_kind: 'number', skip_allowed: true },
];

// Partners are profiled in the dedicated partner-onboarding wizard
// (Task #9, X-2). Inside the advisor we only ask non-binding ambient
// questions so partners aren't double-prompted.
const PARTNER_BANK: Question[] = [
  { id: 'partner.profile.focus',    persona: 'partner', prompt: 'What slice of the studio do you want to focus on this quarter?', input_kind: 'long', skip_allowed: true },
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

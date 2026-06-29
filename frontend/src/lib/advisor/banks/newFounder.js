/**
 * Task #11 (AC-2) — New Founder question bank.
 *
 * Drives a Spin-Out-Lab-style onboarding: by the time the founder
 * finishes the bank, the AC-1 write-router (cloudflare-worker/src/
 * services/advisor/writeRouter.ts) has populated:
 *   - a Project row (name, pitch, sector, stage, traction)
 *   - 3 discovery_interviews rows
 *   - 3 roadmap_okrs rows (Q1 objectives)
 *   - landing_pages basics (tagline + theme color)
 *   - a pitch_decks seed (problem + market slides)
 *   - the spinout_lab_milestones row for week 1 ("project_created"
 *     fires automatically on the first project rename; the deck and
 *     brand prompts mirror Week-1 Spin-Out Lab tasks).
 *
 * Question shape per task spec:
 *   { id, label, type, explainer, doc_anchor, page_target,
 *     tier_required?, validate, followups? }
 *
 * `followups?` is a function `(answer) => string[]` returning the
 * IDs of questions to surface next; the chat client (AC-3) consumes
 * it to interleave context-sensitive nudges.
 */
import { all, required, minChars, maxChars, oneOf } from '../validators';

const SECTORS = ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'];
const STAGES = ['Idea', 'Prototype', 'Pre-seed', 'Seed', 'Series A', 'Later'];

export const NEW_FOUNDER_BANK = [
  // --- About you & idea -------------------------------------------------
  {
    id: 'founder.project.name',
    label: 'What is your startup called?',
    type: 'short',
    explainer: 'Your working name. You can rename it any time from the project page.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, minChars(2), maxChars(80)),
  },
  {
    id: 'founder.project.pitch',
    label: 'Give me a one-paragraph pitch — what do you do, for whom?',
    type: 'long',
    explainer: 'Two-to-four sentences. Aim for the “problem → solution → who it’s for” arc.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, minChars(40), maxChars(800)),
  },
  {
    id: 'founder.project.sector',
    label: 'Which sector are you in?',
    type: 'select',
    options: SECTORS,
    explainer: 'Used to match you with sector-relevant investors and mentors.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, oneOf(SECTORS)),
  },
  {
    id: 'founder.project.stage',
    label: 'What stage are you at?',
    type: 'select',
    options: STAGES,
    explainer: 'Stage drives the dashboards and the milestones we surface.',
    doc_anchor: 'spin-out-lab/overview',
    page_target: '/projects',
    validate: all(required, oneOf(STAGES)),
  },
  {
    id: 'founder.project.traction',
    label: 'Briefly — what traction do you have so far? (users, revenue, LOIs, etc.)',
    type: 'long',
    explainer: 'Even a “none yet” is useful — it tells us to focus on discovery first.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: maxChars(800),
  },

  // --- Customer discovery (≥3 interviews) ------------------------------
  {
    id: 'founder.discovery.interview1.name',
    label: 'Pick 3 prospective customers to interview. Who is the first one?',
    type: 'short',
    explainer: 'A name is enough — even a friend-of-friend. We just need a real human.',
    doc_anchor: 'build/customer-discovery',
    page_target: '/build/discovery',
    validate: all(required, minChars(2), maxChars(120)),
    followups: () => ['founder.discovery.interview1.pains'],
  },
  {
    id: 'founder.discovery.interview1.pains',
    label: 'What pain are you testing with them? (one or two sentences)',
    type: 'long',
    explainer: 'Saved as the interview’s pains/notes — open the Discovery page to record the conversation itself.',
    doc_anchor: 'build/customer-discovery',
    page_target: '/build/discovery',
    validate: all(required, minChars(15)),
  },
  {
    id: 'founder.discovery.interview2.name',
    label: 'Second interviewee?',
    type: 'short',
    explainer: 'A second real human in your target segment — even a warm intro counts.',
    doc_anchor: 'build/customer-discovery',
    page_target: '/build/discovery',
    validate: all(required, minChars(2), maxChars(120)),
    followups: () => ['founder.discovery.interview2.pains'],
  },
  {
    id: 'founder.discovery.interview2.pains',
    label: 'And the pain you’re testing with them?',
    type: 'long',
    explainer: 'One or two sentences — saved as the second interview’s pains/notes.',
    doc_anchor: 'build/customer-discovery',
    page_target: '/build/discovery',
    validate: all(required, minChars(15)),
  },
  {
    id: 'founder.discovery.interview3.name',
    label: 'Third interviewee?',
    type: 'short',
    explainer: 'Three is the magic minimum to start spotting patterns — pick the third name.',
    doc_anchor: 'build/customer-discovery',
    page_target: '/build/discovery',
    validate: all(required, minChars(2), maxChars(120)),
    followups: () => ['founder.discovery.interview3.pains'],
  },
  {
    id: 'founder.discovery.interview3.pains',
    label: 'And the pain you’re testing with them?',
    type: 'long',
    explainer: 'Same shape as the others — a sentence or two on the hypothesis you’re probing.',
    doc_anchor: 'build/customer-discovery',
    page_target: '/build/discovery',
    validate: all(required, minChars(15)),
  },

  // --- Roadmap (≥3 OKRs) ------------------------------------------------
  {
    id: 'founder.okrs.q1_objective1',
    label: 'Set three objectives for this quarter. What is the first?',
    type: 'long',
    explainer: 'One sentence — “Validate <X> with <Y> by <date>” works well.',
    doc_anchor: 'build/roadmap',
    page_target: '/build/roadmap',
    validate: all(required, minChars(10), maxChars(280)),
  },
  {
    id: 'founder.okrs.q1_objective2',
    label: 'Second objective for this quarter?',
    type: 'long',
    explainer: 'Lands as a second OKR row in the “Now” column of your roadmap.',
    doc_anchor: 'build/roadmap',
    page_target: '/build/roadmap',
    validate: all(required, minChars(10), maxChars(280)),
  },
  {
    id: 'founder.okrs.q1_objective3',
    label: 'Third objective for this quarter?',
    type: 'long',
    explainer: 'Lands as a third OKR row — three is the recommended quarterly cap.',
    doc_anchor: 'build/roadmap',
    page_target: '/build/roadmap',
    validate: all(required, minChars(10), maxChars(280)),
  },

  // --- Team -------------------------------------------------------------
  {
    id: 'founder.team.cofounders',
    label: 'Are you solo, or do you have co-founders? (comma-separated names)',
    type: 'short',
    explainer: 'We’ll use this in the deck and surface co-founder matching if you’re solo.',
    doc_anchor: 'getting-started/invite-team',
    page_target: '/network',
    validate: maxChars(280),
  },

  // --- Brand ------------------------------------------------------------
  {
    id: 'founder.brand.tagline',
    label: 'Give me a one-line tagline for the landing page.',
    type: 'short',
    explainer: 'Saved into your auto-generated landing page. You can refine on the Brand Builder.',
    doc_anchor: 'build/brand-builder',
    page_target: '/build/brand',
    validate: all(required, minChars(6), maxChars(140)),
  },
  {
    id: 'founder.brand.theme_color',
    label: 'Pick a brand color (hex, e.g. #7c3aed).',
    type: 'short',
    explainer: 'Drives the landing page primary color. Editable later.',
    doc_anchor: 'build/brand-builder',
    page_target: '/build/brand',
    validate: (v) => {
      const s = String(v ?? '').trim();
      if (!s) return { ok: false, error: 'Required.' };
      return /^#[0-9a-fA-F]{6}$/.test(s)
        ? { ok: true }
        : { ok: false, error: 'Use a 6-digit hex like #7c3aed.' };
    },
  },

  // --- Deck -------------------------------------------------------------
  {
    id: 'founder.deck.problem',
    label: 'Your deck — in one sentence, what problem are you solving?',
    type: 'long',
    explainer: 'Seeds the Problem slide of your pitch deck draft.',
    doc_anchor: 'build/pitch-deck',
    page_target: '/build/deck',
    validate: all(required, minChars(15), maxChars(400)),
  },
  {
    id: 'founder.deck.market',
    label: 'And the market — who are the customers, and roughly how many?',
    type: 'long',
    explainer: 'Seeds the Market slide. Rough estimates are fine.',
    doc_anchor: 'build/pitch-deck',
    page_target: '/build/deck',
    validate: all(required, minChars(15), maxChars(400)),
  },

  // Spin-Out Lab Week-1 progression is logged automatically as a
  // side-effect of the three discovery interviews above (router emits
  // `customer_interview_logged_{1,2,3}` milestones). No standalone
  // "anything blocking?" question is needed here — that prompt lives
  // on the lab page itself.
];

export default NEW_FOUNDER_BANK;

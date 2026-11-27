/**
 * Epic 1 — persona router. Classifies a new user's first message + email
 * domain into one of the canonical personas with a confidence score and a
 * persona-specific 3-5 question follow-up bank.
 *
 * Strategy: cheap email-domain heuristic + a Clef decision.
 * - Domain hits jump confidence by 0.25 (capped at 0.95).
 * - When the decision is refused or unreadable we fall back to a
 *   heuristic-only label with a low confidence score so the caller surfaces a
 *   disambiguation.
 *
 * D1478 §3937 (ON3): the decision is clef-flash through `run()`, so it is
 * quoted, held, guarded and charged like every other run, and recorded on
 * `/onboarding/persona`. It replaces a direct `ai.run` of
 * `@cf/meta/llama-3.1-8b-instruct`, which Cloudflare deprecated on
 * 2026-05-30. Clef returns a probability for every persona, so the
 * alternatives are the model's own ranking rather than prose it wrote.
 */
import type { Env } from '../src/types';
import { PERSONAS, PERSONA_BY_ID, type Persona, type PersonaId } from '../src/personas';
import { run } from '../src/services/aiRouter';
import { AI_SURFACE } from '../src/services/aiSurfaces';

export interface PersonaClassifyInput {
  first_message: string;
  email: string;
}

export interface PersonaClassifyOutput {
  persona_id: PersonaId | null;
  confidence: number;          // 0–1
  alternatives: Array<{ persona_id: PersonaId; confidence: number }>;
  follow_up_questions: Persona['follow_up_questions'];
  needs_disambiguation: boolean;
  rationale: string;
}

const CONFIDENCE_THRESHOLD = 0.6;

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).toLowerCase();
}

/** Pure email-domain heuristic. Returns scored matches sorted desc. */
function domainHeuristic(email: string): Array<{ persona_id: PersonaId; score: number }> {
  const domain = emailDomain(email);
  if (!domain) return [];
  const hits: Array<{ persona_id: PersonaId; score: number }> = [];
  for (const p of PERSONAS) {
    for (const hint of p.email_domain_hints) {
      if (domain === hint || domain.endsWith('.' + hint) || domain.includes(hint)) {
        hits.push({ persona_id: p.id, score: 0.25 });
        break;
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** The decision model ON3 names: hot-path, 24,576 tokens, probabilities per option. */
export const PERSONA_MODEL = '@cf/cloudflare/clef-flash';

/** The one question asked: which persona, from the canonical list, each with its short description. */
export const PERSONA_QUESTION = {
  persona: {
    type: 'choice' as const,
    instructions: 'Which kind of Axal venture studio member wrote this first message?',
    criteria: Object.fromEntries(PERSONAS.map((p) => [p.id, `${p.label}: ${p.short_description}`.slice(0, 100)])),
  },
};

/** What Clef reads: the email domain (never the full address) and the first message. */
const STATE = (i: PersonaClassifyInput) => `Email domain: ${emailDomain(i.email) || 'unknown'}
First message: ${i.first_message.slice(0, 1000)}`;

function clamp01(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** `userId` is who the run is charged to; without one, only the email-domain heuristic runs. */
export async function classifyPersona(env: Env, input: PersonaClassifyInput, userId?: number | null): Promise<PersonaClassifyOutput> {
  const heuristics = domainHeuristic(input.email);

  let aiPersonaId: PersonaId | null = null;
  let aiConfidence = 0;
  let aiAlternatives: Array<{ persona_id: PersonaId; confidence: number }> = [];
  let rationale = '';

  if (userId) {
    const res = await run(env, {
      task: 'module_decision',
      model: PERSONA_MODEL,
      userId,
      surface: AI_SURFACE.onboardingPersona,
      specialist: { operation: 'decision', questions: PERSONA_QUESTION },
      text: STATE(input),
    });
    if (res.ok) {
      try {
        const answer = (JSON.parse(res.output ?? '') as any)?.persona;
        if (answer && typeof answer.choice === 'string' && answer.choice in PERSONA_BY_ID) {
          aiPersonaId = answer.choice as PersonaId;
          const probs = (answer.probabilities ?? {}) as Record<string, number>;
          aiConfidence = clamp01(probs[aiPersonaId] ?? answer.confidence);
          aiAlternatives = Object.entries(probs)
            .filter(([id]) => id !== aiPersonaId && id in PERSONA_BY_ID)
            .map(([id, p]) => ({ persona_id: id as PersonaId, confidence: clamp01(p) }))
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 3);
          rationale = `Decided by clef-flash from the first message${heuristics.length ? ' and the email domain' : ''}.`;
        }
      } catch { /* an unreadable answer falls back to the heuristic below */ }
    }
  }

  // Boost AI confidence when the email-domain heuristic agrees.
  if (aiPersonaId) {
    const boost = heuristics.find((h) => h.persona_id === aiPersonaId);
    if (boost) aiConfidence = clamp01(aiConfidence + boost.score);
  }

  // Pure-heuristic fallback when AI returned nothing usable.
  if (!aiPersonaId && heuristics.length > 0) {
    aiPersonaId = heuristics[0].persona_id;
    aiConfidence = heuristics[0].score;
    rationale = 'Heuristic match on email domain.';
  }

  const persona = aiPersonaId ? PERSONA_BY_ID[aiPersonaId] : null;
  const followUps = persona ? persona.follow_up_questions : [];
  const needsDisambiguation = !aiPersonaId || aiConfidence < CONFIDENCE_THRESHOLD;

  return {
    persona_id: aiPersonaId,
    confidence: Math.min(0.95, aiConfidence),
    alternatives: aiAlternatives,
    follow_up_questions: followUps,
    needs_disambiguation: needsDisambiguation,
    rationale,
  };
}

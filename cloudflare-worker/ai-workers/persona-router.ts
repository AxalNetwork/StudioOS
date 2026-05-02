/**
 * Epic 1 — persona router. Classifies a new user's first message + email
 * domain into one of the canonical personas with a confidence score and a
 * persona-specific 3-5 question follow-up bank.
 *
 * Strategy: cheap email-domain heuristic + Llama 3.1 8B reasoning.
 * - Domain hits jump confidence by 0.25 (capped at 0.95).
 * - If model JSON is unparseable we fall back to a heuristic-only label
 *   with a low confidence score so the caller surfaces a disambiguation.
 */
import type { Env } from '../src/types';
import { PERSONAS, PERSONA_BY_ID, type Persona, type PersonaId } from '../src/personas';

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

const SYSTEM_PROMPT = `You classify a new user of the Axal venture studio into ONE of the personas below based on their first message and email. Output strict JSON only — no prose, no code fences.

Personas:
${PERSONAS.map((p) => `- ${p.id}: ${p.label} — ${p.short_description}`).join('\n')}

Output schema:
{"persona_id": "<one of the ids above>", "confidence": <number 0..1>, "alternatives": [{"persona_id": "<id>", "confidence": <number>}], "rationale": "<one short sentence>"}`;

const USER_PROMPT = (i: PersonaClassifyInput) => `Email: ${i.email}
First message: ${i.first_message.slice(0, 1000)}`;

function safeParse(text: string): Partial<PersonaClassifyOutput> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

function clamp01(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export async function classifyPersona(env: Env, input: PersonaClassifyInput): Promise<PersonaClassifyOutput> {
  const heuristics = domainHeuristic(input.email);

  let aiPersonaId: PersonaId | null = null;
  let aiConfidence = 0;
  let aiAlternatives: Array<{ persona_id: PersonaId; confidence: number }> = [];
  let rationale = '';

  try {
    const ai = (env as unknown as { AI?: { run: (m: string, p: unknown) => Promise<{ response?: string }> } }).AI;
    if (ai) {
      const out = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT(input) },
        ],
        max_tokens: 400,
      });
      const parsed = safeParse(out?.response ?? '');
      const id = parsed.persona_id;
      if (typeof id === 'string' && id in PERSONA_BY_ID) {
        aiPersonaId = id as PersonaId;
        aiConfidence = clamp01(parsed.confidence);
      }
      if (Array.isArray(parsed.alternatives)) {
        aiAlternatives = parsed.alternatives
          .filter((a) => a && typeof a.persona_id === 'string' && a.persona_id in PERSONA_BY_ID)
          .map((a) => ({ persona_id: a.persona_id as PersonaId, confidence: clamp01(a.confidence) }))
          .slice(0, 3);
      }
      rationale = typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 240) : '';
    }
  } catch (e) {
    console.error('[persona-router] AI error', e);
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

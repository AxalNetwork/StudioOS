/**
 * D1557 (#3804, deck v2 C9) — the investor critic: the red flags an investor
 * would raise on this deck, each with a severity, for `routes/deck_critic.ts`.
 * Pure: the route reads the deck, the stage plan, the claims and the norms,
 * runs the model and answers; this file says what is a finding.
 *
 * TWO KINDS OF FINDING.
 *   - Rule findings, free and always (no model): A23's stage rules
 *     (`stagePlan`'s warnings), every "Not backed" figure on its card, and a
 *     market card with no recorded source. They never depend on a run.
 *   - The critic's own findings: one run under `deck:critic`, as the investor
 *     the deck is for (`PERSONAS`), read from the cards' words and figures.
 *
 * SEVERITIES: `deal_breaker`, `will_be_asked`, `polish`.
 *
 * THE FAMILY RULE (dk-auto AUTO-5): the critic never shares a model family
 * with the writer, so it cannot mark its own work. `familyOf` reads a model
 * id's family; `criticModelFor` picks the first candidate of another family;
 * none, or a writer that cannot be read, means no critic run.
 *
 * BENCHMARKS (owner decision S): a finding may cite a stage norm only when
 * the venture recorded one (`citableNorms`); otherwise the answer says "No
 * stage benchmark recorded" and the run is told to cite none.
 */
import type { Warning } from '../narrative/arcs';
import { untrustedBlock, withUntrustedRule } from '../ai/untrusted';

export const SEVERITIES = ['deal_breaker', 'will_be_asked', 'polish'] as const;
export type Severity = typeof SEVERITIES[number];
export const SEVERITY_LABEL: Record<Severity, string> = { deal_breaker: 'Deal-breaker', will_be_asked: 'Will be asked', polish: 'Polish' };

export const CRITIC_OPTION = 'deck:critic';
export const FINDINGS_MAX = 12;
export const FINDING_MAX = 240;

/** Who reads the deck, by its investor type (the deck's audience). */
export const PERSONAS: Record<string, string> = {
  angel: 'an angel investor who backs people and a clear story, and asks what you have done so far',
  pre_seed_fund: 'a pre-seed fund partner who reads the problem, the team and the first signal of demand',
  seed_fund: 'a seed fund partner who reads traction, the market and why this team wins it',
  series_a_fund: 'a Series A partner who reads growth, unit economics and how far the market runs',
  strategic: 'a corporate strategic investor who reads fit with their business and the partnership case',
  grant: 'a grant reviewer who reads impact, feasibility and how the money will be spent',
  other: 'an experienced early-stage investor',
};
export const personaOf = (investorType: string | null | undefined) => PERSONAS[String(investorType ?? '')] ?? PERSONAS.other;

export type Finding = {
  key: string; source: 'rule' | 'critic'; severity: Severity; code: string;
  card_uid: string | null; card_index: number | null; message: string; action: string | null;
};

// ─────────────────────────────────────────────────────────── the family rule

/** A model id's family: `@cf/<org>/…` → org, `anthropic/…` or `claude…` → anthropic; null when unreadable. */
export function familyOf(model: string | null | undefined): string | null {
  const id = String(model ?? '').trim().toLowerCase();
  if (!id) return null;
  const cf = /^@cf\/([^/]+)\//.exec(id);
  if (cf) return cf[1];
  if (/^(anthropic\/|claude)/.test(id)) return 'anthropic';
  const org = /^([a-z0-9._-]+)\//.exec(id);
  return org ? org[1] : null;
}

/** The first candidate whose family differs from the writer's; null when none, or the writer is unknown. */
export function criticModelFor(candidates: readonly string[], writer: string | null | undefined): string | null {
  const w = familyOf(writer);
  if (!w) return null;
  return candidates.find((m) => { const f = familyOf(m); return f !== null && f !== w; }) ?? null;
}

/** Whether an answer may be shown under the family rule: its model's family is known and is not the writer's. */
export function otherFamily(answered: string | null | undefined, writer: string | null | undefined): boolean {
  const a = familyOf(answered);
  const w = familyOf(writer);
  return a !== null && w !== null && a !== w;
}

// ─────────────────────────────────────────────────────────── the cards

export type CriticCard = { uid: string | null; index: number; kind: string | null; title: string; text: string[]; figures: string[] };

/** What the critic reads of each card: its title, its words, and its figures as label and value. */
export function criticCards(slides: unknown, kindOf: (slide: any) => string | null): CriticCard[] {
  const list = Array.isArray(slides) ? slides : [];
  return list.slice(0, 40).map((s: any, index) => {
    const blocks = Array.isArray(s?.blocks) ? s.blocks : [];
    return {
      uid: typeof s?.uid === 'string' ? s.uid : null,
      index,
      kind: kindOf(s),
      title: String(s?.title ?? '').trim().slice(0, 120),
      text: blocks.filter((b: any) => b?.kind === 'text' && typeof b.text === 'string' && b.text.trim()).map((b: any) => String(b.text).slice(0, 1200)),
      figures: blocks.filter((b: any) => b?.kind === 'metric').map((b: any) => `${String(b.label ?? '').trim()}: ${b.value == null || b.value === '' ? 'Not recorded' : String(b.value)}`),
    };
  });
}

const cardRef = (cards: CriticCard[], index: number | null) => {
  const c = index == null ? null : cards[index] ?? null;
  return { card_uid: c?.uid ?? null, card_index: c ? c.index : null };
};

// ─────────────────────────────────────────────────────────── rule findings

const RULE_SEVERITY: Record<string, Severity> = { missing_card: 'deal_breaker', missing_proof: 'will_be_asked' };

/**
 * The free findings: the stage plan's missing cards and missing proof (an
 * unchecked proof is not a finding: the run cannot say it is missing), a
 * market card with no recorded source, and each "Not backed" figure.
 */
export function ruleFindings(input: {
  cards: CriticCard[];
  warnings: readonly Warning[];
  order: ReadonlyArray<{ card: string; in_deck: number | null; proof: string }>;
  notBacked: ReadonlyArray<{ uid: string; slide: number | null; label: string }>;
}): Finding[] {
  const out: Finding[] = [];
  const market = input.order.find((r) => r.card === 'market' && r.in_deck !== null && r.proof === 'missing') ?? null;
  for (const w of input.warnings) {
    const severity = RULE_SEVERITY[w.code];
    if (!severity) continue;
    if (market && w.card === 'market' && w.code === 'missing_proof') continue;
    const at = input.order.find((r) => r.card === w.card)?.in_deck ?? null;
    out.push({ key: `rule:${w.code}:${w.card}`, source: 'rule', severity, code: w.code, ...cardRef(input.cards, at), message: w.message, action: w.action });
  }
  if (market) {
    out.push({ key: 'rule:market_unsourced', source: 'rule', severity: 'will_be_asked', code: 'market_unsourced', ...cardRef(input.cards, market.in_deck), message: 'Market size has no source', action: 'Add a source' });
  }
  for (const c of input.notBacked) {
    const at = c.slide != null && c.slide >= 0 && c.slide < input.cards.length ? c.slide : null;
    out.push({ key: `rule:not_backed:${c.uid}`, source: 'rule', severity: 'will_be_asked', code: 'not_backed', ...cardRef(input.cards, at), message: `${c.label} is not backed by a record`, action: 'Go to card' });
  }
  return out;
}

// ─────────────────────────────────────────────────────────── the critic run

export const CRITIC_SYSTEM = withUntrustedRule([
  'You read an investor pitch deck before a first meeting and name the red flags you would raise.',
  'Each finding names one card by its uid, a severity (deal_breaker, will_be_asked or polish) and what you would say, in one sentence.',
  'Never state a number that is not on the card or in the benchmarks given. Never promise or predict a return.',
  'Return only JSON.',
].join(' '));

/** What the critic is asked: the persona, the stage, the cards as data, what the rules already found, the benchmarks. */
export function criticMessage(o: { persona: string; stageLabel: string; cards: CriticCard[]; already: Finding[]; benchmarks: string[] | null }): string {
  const data = o.cards.map((c) => ({ uid: c.uid ?? String(c.index), title: c.title, text: c.text, figures: c.figures }));
  return [
    `You are ${o.persona}. This is a ${o.stageLabel} deck.`,
    `Cards:\n${untrustedBlock('deck_import', JSON.stringify(data))}`,
    o.already.length ? `Already found, do not repeat: ${JSON.stringify(o.already.map((f) => f.message))}.` : '',
    o.benchmarks?.length
      ? `Stage benchmarks the founder recorded, each with its source (you may cite these and only these):\n${untrustedBlock('record_text', JSON.stringify(o.benchmarks))}`
      : 'No stage benchmark is recorded for this stage: do not cite any benchmark or typical figure.',
    `Return at most ${FINDINGS_MAX} findings: {"findings":[{"card":"<card uid>","severity":"deal_breaker|will_be_asked|polish","finding":"..."}]}.`,
  ].filter(Boolean).join('\n');
}

const DIGITS = /\p{Nd}+(?:[.,]\p{Nd}+)*/gu;
const runs = (t: string) => (String(t).match(DIGITS) ?? []).map((r) => r.replace(/[^\p{Nd}]/gu, ''));

/**
 * The critic's findings that may be shown: a known severity, a card of the
 * deck, words within the limit, and no number that is not on that card or in
 * a cited benchmark. Each that fails is counted, never shown.
 */
export function criticFindings(raw: unknown, cards: CriticCard[], benchmarks: string[] | null): { findings: Finding[]; dropped: number } {
  const list = Array.isArray((raw as any)?.findings) ? (raw as any).findings : [];
  const findings: Finding[] = [];
  let dropped = 0;
  const cited = (benchmarks ?? []).join('\n');
  for (const f of list.slice(0, FINDINGS_MAX * 2)) {
    const severity = String(f?.severity ?? '') as Severity;
    const message = typeof f?.finding === 'string' ? f.finding.replace(/\s+/g, ' ').trim() : '';
    const card = cards.find((c) => (c.uid ?? String(c.index)) === String(f?.card ?? ''));
    if (!(SEVERITIES as readonly string[]).includes(severity) || !message || message.length > FINDING_MAX || !card) { dropped += 1; continue; }
    const held = new Set(runs([card.title, ...card.text, ...card.figures, cited].join('\n')));
    if (runs(message).some((r) => !held.has(r))) { dropped += 1; continue; }
    if (findings.length >= FINDINGS_MAX) { dropped += 1; continue; }
    findings.push({ key: `critic:${findings.length}`, source: 'critic', severity, code: 'critic', card_uid: card.uid, card_index: card.index, message, action: 'Go to card' });
  }
  return { findings, dropped };
}

/** Findings in the order a reader acts on them: deal-breakers first, then by card. */
export const ordered = (findings: Finding[]) => [...findings].sort((a, b) =>
  SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (a.card_index ?? 99) - (b.card_index ?? 99));

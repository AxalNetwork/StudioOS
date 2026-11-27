/**
 * D8827 (#8827, D5963) — Eadwyn's proposals on Compare with Axal: a summary of what Axal changed from the version an
 * extension is based on to Axal's newest, and one way forward per conflicting part. The model proposes; this file
 * decides what may be shown. Pure: no binding, no fetch.
 *
 * - **What the model reads:** the three sides of `threeWay()` (Axal's base version, the company's side, Axal's newest)
 *   for the seven parts, each part's flags, and the tools of Axal's newest. Every skill text is framed as untrusted
 *   data (`ai/untrusted.ts`): a step that says "ignore your instructions" is a step, never an instruction.
 * - **What it may propose:** per conflicting part, `mine` (keep yours), `axal` (take Axal vN) or `edit` (a value
 *   written for the part, only for Name, Purpose, Steps and Tools, as the rebase sheet allows, D4538 part 9). These
 *   are exactly the choices `POST /skills/:uid/rebase` takes, so an accepted proposal is a rebase choice and nothing
 *   else (D8827).
 * - **The tool rule (D5963):** Eadwyn never proposes a tool outside the base. The base of an accepted proposal is
 *   Axal's newest version, the version the rebase builds on, so a proposal whose tools are not all Axal vN's, or
 *   whose words name a tool none of Axal's versions here carry, is withheld with its reason and never shown.
 * - **What it writes:** nothing. The route stores nothing; the page holds the answer until it is accepted or discarded.
 */
import type { OutputKind, Tag } from './skills';
import { NAME_MAX, PURPOSE_MAX, STEP_MAX, STEPS_MAX } from './skills';
import { untrustedBlock, withUntrustedRule, withoutUnrecordedLinks } from '../ai/untrusted';

/** The rail page and option a proposal run is logged under (D765). The page is a company's Team › Skills. */
export const PROPOSALS_PAGE = 'Company · Team · Skills · Compare';
export const PROPOSALS_OPTION = 'propose:skill-conflicts';
export const PROPOSALS_MAX_TOKENS = 1200;

export const PROPOSAL_PARTS = ['name', 'purpose', 'steps', 'tools', 'output_kind', 'tags', 'roles'] as const;
export type ProposalPart = typeof PROPOSAL_PARTS[number];
export const PART_LABELS: Record<ProposalPart, string> = {
  name: 'Name', purpose: 'Purpose', steps: 'Steps', tools: 'Tools', output_kind: 'Output', tags: 'Skill tags', roles: 'Roles',
};
/** The parts the rebase sheet writes by hand (D4538 part 9); Output, Skill tags and Roles are only kept or taken. */
export const EDITABLE_PARTS: readonly ProposalPart[] = ['name', 'purpose', 'steps', 'tools'];
export const CHOICES = ['mine', 'axal', 'edit'] as const;
export type Choice = typeof CHOICES[number];

const SUMMARY_MAX = 300;
const WHY_MAX = 400;

export type ProposalSide = { name: string; purpose: string; steps: string[]; tools: string[]; output_kind: OutputKind; tags: Tag[]; roles: string[] };
export type PartFlags = { field: ProposalPart; company_changed: boolean; base_changed: boolean; conflict: boolean };

/** What one run reads: the versions it compares and the Worker's own flags. */
export type ProposalFacts = {
  from: number;
  to: number;
  company: { side: 'version' | 'draft'; version: number | null };
  base: ProposalSide;
  mine: ProposalSide;
  newest: ProposalSide;
  fields: PartFlags[];
};

export type SummaryLine = { part: ProposalPart; text: string };
export type Proposal = { part: ProposalPart; choice: Choice; value?: string | string[]; why: string };
export type Withheld = { part: ProposalPart; code: 'tool_not_in_base' | 'proposal_invalid'; message: string; tool?: string };
export type ProposalAnswer = {
  summary: SummaryLine[];
  /** Parts Axal changed from vB to vN, in the comparison's order; a part here with no summary line was not described. */
  changed: ProposalPart[];
  /** Parts Axal did not change. Decided here, never by the model. */
  unchanged: ProposalPart[];
  proposals: Proposal[];
  /** Conflicting parts Eadwyn proposed nothing for. */
  missing: ProposalPart[];
  withheld: Withheld[];
};

/** A part as the model reads it: text, or a list of lines. */
function partText(p: ProposalSide, f: ProposalPart): string | string[] {
  if (f === 'tags') return p.tags.map((t) => `${t.slug} (${t.level})`);
  if (f === 'steps' || f === 'tools' || f === 'roles') return [...p[f]];
  return String(p[f] ?? '');
}

/** Every skill text the model is given, for the link check on its answer. */
function recordedText(facts: ProposalFacts): string[] {
  return [facts.base, facts.mine, facts.newest].flatMap((s) => PROPOSAL_PARTS.flatMap((f) => {
    const v = partText(s, f);
    return Array.isArray(v) ? v : [v];
  }));
}

/** The instructions and the three sides, each side's text framed as untrusted data. */
export function proposalMessages(facts: ProposalFacts): { systemPrompt: string; messages: Array<{ role: 'user'; content: string }> } {
  const conflicts = facts.fields.filter((f) => f.conflict).map((f) => f.field);
  const changed = facts.fields.filter((f) => f.base_changed).map((f) => f.field);
  const side = (s: ProposalSide) => Object.fromEntries(PROPOSAL_PARTS.map((f) => [f, partText(s, f)]));
  const systemPrompt = withUntrustedRule([
    `You compare three versions of one skill: Axal's v${facts.from} (the base a company extended), the company's version, and Axal's newest, v${facts.to}.`,
    'You only propose. The company\'s editor accepts or discards each proposal; nothing is saved by you.',
    'Answer with JSON only: {"summary":[{"part":<part>,"text":<one sentence>}],"proposals":[{"part":<part>,"choice":"mine"|"axal"|"edit","value":<only for edit>,"why":<one or two sentences>}]}.',
    `"summary" has one sentence for each part Axal changed from v${facts.from} to v${facts.to}: ${changed.join(', ') || 'none'}. Say what changed, in plain words.`,
    `"proposals" has one entry for each conflicting part: ${conflicts.join(', ') || 'none'}. "mine" keeps the company's version of the part, "axal" takes Axal v${facts.to}'s, "edit" writes a new value that combines them.`,
    `Use "edit" only for name (a string), purpose (a string), steps (a list of strings) or tools (a list of tool names). For output_kind, tags and roles choose "mine" or "axal".`,
    `Tools: the result may use only tools of Axal v${facts.to}: ${facts.newest.tools.join(', ') || 'none'}. Never name or propose any other tool.`,
    'Use only part names from this list: name, purpose, steps, tools, output_kind, tags, roles.',
  ].join('\n'));
  const content = [
    `Parts and what changed, as the platform computed them: ${JSON.stringify(facts.fields)}`,
    `Axal v${facts.from}, the base:`, untrustedBlock('record_text', JSON.stringify(side(facts.base))),
    `The company's ${facts.company.side === 'draft' ? 'draft' : `published v${facts.company.version ?? '?'}`}:`, untrustedBlock('record_text', JSON.stringify(side(facts.mine))),
    `Axal v${facts.to}, the newest:`, untrustedBlock('record_text', JSON.stringify(side(facts.newest))),
  ].join('\n');
  return { systemPrompt, messages: [{ role: 'user', content }] };
}

/** The first JSON object in the output, or null. */
function parseObject(output: unknown): Record<string, unknown> | null {
  const text = String(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** Every token in a text shaped like a tool name (`crm.read`), lower-cased. Two letters each side, so "e.g." is none. */
export function toolsNamedIn(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/\b[a-z][a-z0-9_]+\.[a-z][a-z0-9_]+\b/g) ?? []))];
}

const isPart = (v: unknown): v is ProposalPart => typeof v === 'string' && (PROPOSAL_PARTS as readonly string[]).includes(v);
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.length <= max ? t : null;
};

/** An edit's value as the rebase route takes it, or null when it is not one. */
function editValue(part: ProposalPart, raw: unknown): string | string[] | null {
  if (part === 'name') return clean(raw, NAME_MAX);
  if (part === 'purpose') return clean(raw, PURPOSE_MAX);
  if (part === 'steps') {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > STEPS_MAX) return null;
    const steps = raw.map((s) => clean(s, STEP_MAX));
    return steps.every((s): s is string => s !== null) ? steps : null;
  }
  if (part === 'tools') {
    if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) return null;
    return [...new Set((raw as string[]).map((t) => t.trim()))];
  }
  return null;
}

/**
 * Check the model's answer against the comparison. Null when it is not an answer at all (no JSON object, or neither
 * list); otherwise what may be shown, with every proposal that breaks a rule withheld and named.
 */
export function readProposals(output: unknown, facts: ProposalFacts): ProposalAnswer | null {
  const obj = parseObject(output);
  if (!obj || (!Array.isArray(obj.summary) && !Array.isArray(obj.proposals))) return null;
  const flags = new Map(facts.fields.map((f) => [f.field, f]));
  const records = recordedText(facts);
  const newestTools = new Set(facts.newest.tools);
  // Words may name the tools Axal's versions here carry (to say what Axal added or dropped); no other tool.
  const known = new Set([...facts.base.tools, ...facts.newest.tools]);
  const stranger = (text: string) => toolsNamedIn(text).find((t) => !known.has(t)) ?? null;
  const words = (raw: unknown, max: number) => {
    const t = clean(raw, max);
    return t ? withoutUnrecordedLinks(t, records) || null : null;
  };

  const changed = PROPOSAL_PARTS.filter((f) => flags.get(f)?.base_changed);
  const lines = new Map<ProposalPart, string>();
  for (const raw of Array.isArray(obj.summary) ? obj.summary : []) {
    const part = (raw as any)?.part;
    // A line for a part Axal did not change is dropped below: only `changed` parts are read out.
    if (!isPart(part) || lines.has(part)) continue;
    const text = words((raw as any)?.text, SUMMARY_MAX);
    if (text && !stranger(text)) lines.set(part, text);
  }

  const conflicts = PROPOSAL_PARTS.filter((f) => flags.get(f)?.conflict);
  const seen = new Set<ProposalPart>();
  const proposals: Proposal[] = [];
  const withheld: Withheld[] = [];
  const invalid = (part: ProposalPart) => withheld.push({
    part, code: 'proposal_invalid', message: `Eadwyn’s proposal for ${PART_LABELS[part]} could not be checked against the comparison, so it is not shown.`,
  });
  const outside = (part: ProposalPart, tool: string) => withheld.push({
    part, code: 'tool_not_in_base', tool,
    message: `Eadwyn’s proposal for ${PART_LABELS[part]} named ${tool}, which is not a tool of Axal v${facts.to}, so it is not shown.`,
  });
  for (const raw of Array.isArray(obj.proposals) ? obj.proposals : []) {
    const part = (raw as any)?.part;
    if (!isPart(part) || !flags.get(part)?.conflict || seen.has(part)) continue;
    seen.add(part);
    const choice = (raw as any)?.choice;
    const why = words((raw as any)?.why, WHY_MAX);
    if (!(CHOICES as readonly unknown[]).includes(choice) || !why) { invalid(part); continue; }
    let value: string | string[] | undefined;
    if (choice === 'edit') {
      const v = EDITABLE_PARTS.includes(part) ? editValue(part, (raw as any)?.value) : null;
      if (v === null) { invalid(part); continue; }
      value = v;
    }
    // D5963: the draft a rebase makes uses Axal vN's tools or fewer. Whatever this choice keeps must be among them.
    if (part === 'tools') {
      const kept = choice === 'mine' ? facts.mine.tools : choice === 'axal' ? facts.newest.tools : (value as string[]);
      const bad = kept.find((t) => !newestTools.has(t));
      if (bad) { outside(part, bad); continue; }
    }
    const named = stranger(why) ?? (Array.isArray(value) ? value.map((v) => stranger(v)).find(Boolean) : typeof value === 'string' ? stranger(value) : null);
    if (named) { outside(part, named); continue; }
    proposals.push({ part, choice: choice as Choice, ...(value !== undefined ? { value } : {}), why });
  }

  return {
    summary: changed.filter((f) => lines.has(f)).map((f) => ({ part: f, text: lines.get(f)! })),
    changed,
    unchanged: PROPOSAL_PARTS.filter((f) => !flags.get(f)?.base_changed),
    proposals: PROPOSAL_PARTS.flatMap((f) => proposals.filter((p) => p.part === f)),
    missing: conflicts.filter((f) => !seen.has(f)),
    withheld,
  };
}

/**
 * D1496 (#3840) — a scope's rule book for one role: a closed shape, checked
 * here, with a floor that no edit can lower.
 *
 *   { mission, works_in, reads, may_propose, may_do_automatically,
 *     always_asks_human, escalates_when, kpis, tone }
 *
 * THE FLOOR, IN CODE. `always_asks_human` always holds every key of
 * `ALWAYS_ASKS_FLOOR`, and `may_do_automatically` is empty (owner Q1 = A for
 * parts 1 to 3). A rule book that breaks either is `rule_floor`; anything
 * else malformed is `invalid_rules`. The floor is checked first, so an edit
 * that both drops `send_email` and misspells a module is told about the floor.
 *
 * EASY TO EXTEND. Each section is one entry of `SECTIONS`: its checker and,
 * for a list, the vocabulary it draws from. #3742 E4 adds `duties` and
 * `hands_off_to` as two more optional entries; a key with no entry is refused.
 *
 * Pure: no binding.
 */
import { ALWAYS_ASKS_FLOOR, ASK_KEYS, MODULES, READ_KEYS, optionKeys, optionsIn, type Rules } from './catalogue';

export type RuleCheck = { ok: true; rules: Rules } | { ok: false; code: 'rule_floor' | 'invalid_rules'; section: string; message: string };

const TEXT_MAX = 500;
const LINE_MAX = 200;
const LIST_MAX = 20;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type Section = { required: boolean; check: (v: unknown) => string | null; list?: boolean };

const text = (max: number) => (v: unknown) =>
  typeof v !== 'string' || !v.trim() ? 'must be a sentence'
    : v.length > max ? `must be at most ${max} characters`
      : CONTROL.test(v) ? 'must not hold control characters' : null;

const keys = (vocab: () => ReadonlySet<string>) => (v: unknown) => {
  if (!Array.isArray(v)) return 'must be a list';
  if (v.length > 64) return 'is too long';
  const known = vocab();
  for (const k of v) if (typeof k !== 'string' || !known.has(k)) return `names an unknown key: ${String(k).slice(0, 64)}`;
  return new Set(v).size === v.length ? null : 'names a key twice';
};

const lines = (v: unknown) => {
  if (!Array.isArray(v)) return 'must be a list';
  if (v.length > LIST_MAX) return `holds at most ${LIST_MAX} lines`;
  for (const l of v) { const e = text(LINE_MAX)(l); if (e) return `has a line that ${e}`; }
  return null;
};

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));
const READ_SET = new Set<string>(READ_KEYS);
const ASK_SET = new Set<string>(ASK_KEYS);
let optionSet: Set<string> | null = null;
const OPTIONS = () => (optionSet ??= optionKeys());

export const SECTIONS: Record<keyof Rules, Section> = {
  mission: { required: true, check: text(TEXT_MAX) },
  works_in: { required: true, list: true, check: (v) => keys(() => MODULE_KEYS)(v) ?? ((v as unknown[]).length ? null : 'must name at least one module') },
  reads: { required: true, list: true, check: keys(() => READ_SET) },
  may_propose: { required: true, list: true, check: keys(OPTIONS) },
  may_do_automatically: { required: true, list: true, check: (v) => (Array.isArray(v) ? null : 'must be a list') },
  always_asks_human: { required: true, list: true, check: keys(() => ASK_SET) },
  escalates_when: { required: true, list: true, check: lines },
  kpis: { required: true, list: true, check: lines },
  tone: { required: true, check: text(LINE_MAX) },
};
/** The sections a list diff covers, in the shape's order. */
export const LIST_SECTIONS = (Object.keys(SECTIONS) as (keyof Rules)[]).filter((k) => SECTIONS[k].list);

/** The floor alone, on anything shaped enough to read: null when it holds. */
export function floorBreach(rules: any): string | null {
  const auto = rules?.may_do_automatically;
  if (Array.isArray(auto) && auto.length) return 'may_do_automatically';
  const asks = rules?.always_asks_human;
  if (Array.isArray(asks) && ALWAYS_ASKS_FLOOR.some((k) => !asks.includes(k))) return 'always_asks_human';
  return null;
}

/** Validate a whole rule book. The answer's `rules` is a fresh object holding only the known sections. */
export function checkRules(input: unknown): RuleCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid_rules', section: '', message: 'The rule book must be an object.' };
  }
  const r = input as Record<string, unknown>;
  const breach = floorBreach(r);
  if (breach === 'may_do_automatically') {
    return { ok: false, code: 'rule_floor', section: breach, message: 'An agent may not do anything automatically: every output is a proposal a person decides.' };
  }
  if (breach) {
    return { ok: false, code: 'rule_floor', section: breach, message: `An agent always asks a person before: ${ALWAYS_ASKS_FLOOR.join(', ')}.` };
  }
  for (const k of Object.keys(r)) {
    if (!(k in SECTIONS)) return { ok: false, code: 'invalid_rules', section: k.slice(0, 64), message: `${k.slice(0, 64)} is not a section of a rule book.` };
  }
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(SECTIONS)) {
    if (!(k in r)) {
      if (s.required) return { ok: false, code: 'invalid_rules', section: k, message: `${k} is missing.` };
      continue;
    }
    const e = s.check(r[k]);
    if (e) return { ok: false, code: 'invalid_rules', section: k, message: `${k} ${e}.` };
    out[k] = Array.isArray(r[k]) ? [...(r[k] as unknown[])].map((x) => (typeof x === 'string' ? x.trim() : x)) : String(r[k]).trim();
  }
  // Every option it may propose is offered in a module it works in.
  const reachable = new Set((out.works_in as string[]).flatMap(optionsIn));
  const stray = (out.may_propose as string[]).find((o) => !reachable.has(o));
  if (stray) return { ok: false, code: 'invalid_rules', section: 'may_propose', message: `${stray} is not offered in any module this role works in.` };
  return { ok: true, rules: out as Rules };
}

export type SectionDiff = { section: string; added: string[]; removed: string[] };

/** What a scope's rule book changed from the catalogue's default, section by section. Unchanged sections are left out. */
export function diffRules(from: Rules, to: Rules): SectionDiff[] {
  const out: SectionDiff[] = [];
  for (const k of Object.keys(SECTIONS) as (keyof Rules)[]) {
    const a = from[k]; const b = to[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      const added = b.filter((x) => !a.includes(x));
      const removed = a.filter((x) => !b.includes(x));
      if (added.length || removed.length) out.push({ section: k, added, removed });
    } else if (a !== b) {
      out.push({ section: k, added: [String(b)], removed: [String(a)] });
    }
  }
  return out;
}

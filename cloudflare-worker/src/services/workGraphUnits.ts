/**
 * D5582 part 1 (#5582, WorkGraph P1 under the #5577 epic) — the structured units of a document, a pitch deck, an
 * offer and a legal instrument, and the `SourceRef` that names where each one's content is canonical. Pure: it
 * reads nothing. Each adapter takes content an existing reader already returned (`getDeckRow` for a deck version,
 * `legalTemplateStore` for a template version, the quote's own row for an offer term, the envelope row for signed
 * evidence), so WorkGraph never opens a second read path or a competing store (D5579 §1-2).
 *
 * A UNIT is the smallest thing two writers can edit independently:
 *   pitch deck       one AREA of one card, as D1577's co-editing already defines it: a block by its `id`, or the
 *                    card's title (`__title`), on the card's stable uid (D1500). Unit id `<card uid>/<area>`. A
 *                    block with no `id` is the card's `__layout` unit, so an edit to it overlaps the whole card's
 *                    layout rather than silently merging.
 *   legal template   one CLAUSE: a markdown heading and the text up to the next heading of the same or a higher
 *                    level. Its id is the clause number when the heading carries one (`7.2`), else a slug of the
 *                    heading; the text before the first heading is `__preamble`.
 *   document         one SECTION, cut exactly as a template clause.
 *   offer            one TERM of a quote version: `price_cents`, `change_summary`, `note`.
 *   signed evidence  no editable unit at all (D5579 `IMMUTABLE_KINDS`).
 *
 * Each unit carries `value` (what is compared, as stable JSON) and `text` (the human-readable text the sensitive-
 * term check and the guarded text merge read), and `sensitive`: the categories that force a person's review
 * (D5582 §3). A unit is sensitive by its kind (a price, a metric, a chart, a table) or by its words.
 */
import { stable, AREA_TITLE } from './decks/coedit';
import { assignCardUids } from './decks/cardUids';
import { canonicalJson } from './decks/cardBlobs';
import { sha256Hex, type AssetKind, type SourceRef } from './workGraphContracts';

export const SENSITIVE_CATEGORIES = [
  'money', 'equity', 'signature', 'liability', 'legal_entity', 'jurisdiction', 'investor_claim',
] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

export interface Unit {
  /** Stable within its asset: `<card uid>/<area>`, a clause number or slug, a term name. */
  id: string;
  kind: 'card_area' | 'card_layout' | 'clause' | 'section' | 'term';
  /** Stable JSON of what the unit holds: compared for equality, hashed into the candidate digest. */
  value: string;
  /** Readable text, or '' for a unit with none (an image, a chart). */
  text: string;
  /** Whether the guarded three-way text merge may combine two edits of this unit (D5582 §2). */
  textMergeable: boolean;
  sensitive: SensitiveCategory[];
}

export interface UnitDocument {
  kind: Extract<AssetKind, 'pitch_deck' | 'legal_template' | 'document' | 'offer' | 'legal_signed'>;
  source: SourceRef;
  /** In document order. */
  units: Unit[];
}

// ---------------------------------------------------------------------------------------------------------------
// Sensitive terms. The patterns err toward review: a false positive costs a person one look, a false negative
// lets a changed price, party or claim through without one.
// ---------------------------------------------------------------------------------------------------------------

const PATTERNS: [SensitiveCategory, RegExp][] = [
  ['money', /[$€£¥]\s?\d|\b\d[\d,.]*\s?(?:usd|eur|gbp|cad|chf|k|m|bn|million|billion)\b|\b(?:price|fee|fees|payment|salary|compensation|valuation|amount|consideration|purchase price|cents?)\b/i],
  ['equity', /\b(?:equity|shares?|stock|options?|warrants?|safe|convertible|vesting|cap table|dilution|ownership|pro[- ]rata|preferred|common stock)\b|\d+(?:\.\d+)?\s?%/i],
  ['signature', /\b(?:sign(?:ed|ature|atory|atories)?|execut(?:e|ed|ion)|countersign|witness(?:ed)?|e-?sign)\b/i],
  ['liability', /\b(?:liabilit(?:y|ies)|indemni(?:fy|fies|fication|ty)|warrant(?:y|ies)|damages|limitation of liability|hold harmless|penalt(?:y|ies)|guarantee[sd]?)\b/i],
  ['legal_entity', /\b(?:inc|llc|ltd|limited|plc|gmbh|s\.?a\.?s?|b\.?v\.?|corp(?:oration)?|lp|llp)\b\.?|\b(?:company number|registered (?:office|number))\b/i],
  ['jurisdiction', /\b(?:governing law|jurisdiction|venue|courts? of|arbitration|laws of|construed in accordance)\b/i],
  ['investor_claim', /\b(?:revenue|arr|mrr|growth|traction|customers?|users?|retention|churn|margin|profit|return(?:s)?|irr|multiple|projection|forecast|guaranteed)\b/i],
];

/** The sensitive categories a text touches. */
export function sensitiveIn(text: string): SensitiveCategory[] {
  if (!text) return [];
  return PATTERNS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

// ---------------------------------------------------------------------------------------------------------------
// Pitch deck: card areas.
// ---------------------------------------------------------------------------------------------------------------

/** Deck blocks whose content is a figure: a changed metric, chart or table is a claim to an investor. */
const CLAIM_BLOCKS = new Set(['metric', 'chart', 'table']);
/** Deck blocks whose text a three-way line merge may combine: plain text only. */
const TEXT_BLOCKS = new Set(['text']);

function blockText(block: any): string {
  if (!block || typeof block !== 'object') return '';
  const parts: string[] = [];
  for (const k of ['text', 'label', 'caption', 'value', 'title', 'alt']) if (typeof block[k] === 'string') parts.push(block[k]);
  if (Array.isArray(block.items)) for (const it of block.items) if (typeof it === 'string') parts.push(it);
  return parts.join('\n');
}

export interface DeckVersionRow {
  /** `pitch_decks.id` of the version. */
  id: number;
  version: number;
  /** `pitch_decks.content_hash` where written, else null: the source revision falls back to the version number. */
  content_hash?: string | null;
  /** The hydrated cards, as `getDeckRow` returns them. */
  slides: unknown[];
}

/** A deck version's units. Cards keep D1500's uids; areas follow D1577. */
export function deckUnits(row: DeckVersionRow): UnitDocument {
  const units: Unit[] = [];
  for (const card of assignCardUids(Array.isArray(row.slides) ? (row.slides as any[]) : [])) {
    const title = typeof card.title === 'string' ? card.title : '';
    units.push({
      id: `${card.uid}/${AREA_TITLE}`, kind: 'card_area', value: stable(title), text: title, textMergeable: true,
      sensitive: sensitiveIn(title),
    });
    const blocks: any[] = Array.isArray(card.blocks) ? card.blocks : [];
    const loose: any[] = [];
    for (const b of blocks) {
      if (b && (typeof b.id === 'string' || typeof b.id === 'number') && String(b.id).length) {
        const text = blockText(b);
        units.push({
          id: `${card.uid}/${String(b.id)}`, kind: 'card_area', value: stable(b), text,
          textMergeable: TEXT_BLOCKS.has(b.kind),
          sensitive: uniq([...(CLAIM_BLOCKS.has(b.kind) ? ['investor_claim' as const] : []), ...sensitiveIn(text)]),
        });
      } else {
        loose.push(b);
      }
    }
    // Everything on the card that is not an addressed area: layout, theme, loose blocks, notes. One unit, so an
    // edit there overlaps any other edit there and is never merged field by field.
    const { title: _t, blocks: _b, uid: _u, ...rest } = card as any;
    const layoutText = loose.map(blockText).join('\n');
    units.push({
      id: `${card.uid}/__layout`, kind: 'card_layout', value: stable({ ...rest, loose }), text: layoutText,
      textMergeable: false,
      sensitive: uniq([...(loose.some((b) => CLAIM_BLOCKS.has(b?.kind)) ? ['investor_claim' as const] : []), ...sensitiveIn(layoutText)]),
    });
  }
  return {
    kind: 'pitch_deck',
    source: { store: 'd1_record', locator: 'pitch_decks', id: String(row.id), revision: row.content_hash || `v${row.version}` },
    units,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Legal templates and documents: clauses and sections.
// ---------------------------------------------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const NUMBERED = /^((?:\d+\.)*\d+)\.?\s+/;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clause';
}

/**
 * Split markdown into clauses: a heading opens one, and it runs to the next heading of the same or a higher level
 * (a deeper heading is its own clause). The text before the first heading is `__preamble`. Ids are unique: a
 * repeated heading gets `-2`, `-3`.
 */
export function clausesOf(markdown: string, unitKind: 'clause' | 'section'): Unit[] {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: { id: string; lines: string[] }[] = [];
  const used = new Set<string>();
  let cur: { id: string; lines: string[] } = { id: '__preamble', lines: [] };
  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) {
      if (cur.id !== '__preamble' || cur.lines.some((l) => l.trim())) out.push(cur);
      const title = h[2];
      const num = NUMBERED.exec(title);
      let id = num ? num[1] : slug(title);
      if (used.has(id)) { let n = 2; while (used.has(`${id}-${n}`)) n += 1; id = `${id}-${n}`; }
      used.add(id);
      cur = { id, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.id !== '__preamble' || cur.lines.some((l) => l.trim())) out.push(cur);
  return out.map(({ id, lines: ls }) => {
    const text = ls.join('\n');
    return { id, kind: unitKind, value: stable(text), text, textMergeable: true, sensitive: sensitiveIn(text) };
  });
}

export interface LegalTemplateVersionRow {
  /** `legal_template_versions.template_id` and `version`: the row is unique on the pair. */
  template_id: number;
  version: number;
  body_md: string;
}

/** A legal template version's clauses. The canonical row is `legal_template_versions` (D5579 §2). */
export function legalTemplateUnits(row: LegalTemplateVersionRow): UnitDocument {
  return {
    kind: 'legal_template',
    source: { store: 'd1_record', locator: 'legal_template_versions', id: `${row.template_id}:${row.version}`, revision: String(row.version) },
    units: clausesOf(row.body_md, 'clause'),
  };
}

/** A document's sections, read from the domain table the caller names (for example `documents`). */
export function documentUnits(table: string, id: string, revision: string, markdown: string): UnitDocument {
  return { kind: 'document', source: { store: 'd1_record', locator: table, id, revision }, units: clausesOf(markdown, 'section') };
}

// ---------------------------------------------------------------------------------------------------------------
// Offers: the terms of a quote version.
// ---------------------------------------------------------------------------------------------------------------

export interface QuoteVersionRow {
  /** `quote_versions.id`, unique on (`quote_id`, `version`). */
  id: number;
  quote_id: number;
  version: number;
  change_summary: string;
  note: string | null;
  price_cents: number | null;
}

/** A quote version's terms. The price is money whatever its words; no term is text-merged (an offer is a figure). */
export function quoteUnits(row: QuoteVersionRow): UnitDocument {
  const term = (id: string, v: unknown, text: string, extra: SensitiveCategory[] = []): Unit => ({
    id, kind: 'term', value: stable(v ?? null), text, textMergeable: false, sensitive: uniq([...extra, ...sensitiveIn(text)]),
  });
  return {
    kind: 'offer',
    source: { store: 'd1_record', locator: 'quote_versions', id: String(row.id), revision: String(row.version) },
    units: [
      term('price_cents', row.price_cents, row.price_cents == null ? '' : String(row.price_cents), ['money']),
      term('change_summary', row.change_summary, row.change_summary ?? ''),
      term('note', row.note, row.note ?? ''),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Signed evidence: no units.
// ---------------------------------------------------------------------------------------------------------------

export interface SignedEnvelopeRow {
  envelope_uuid: string;
  /** `esign_envelopes.body_sha256`: the signed body's digest. */
  body_sha256: string;
}

/** A signed envelope is evidence. It names its source and has no editable unit (D5579 `IMMUTABLE_KINDS`). */
export function signedEnvelopeUnits(row: SignedEnvelopeRow): UnitDocument {
  return { kind: 'legal_signed', source: { store: 'esign_envelope', locator: 'esign', id: row.envelope_uuid, revision: row.body_sha256 }, units: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// The candidate digest.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The digest of a set of units, in order: what a ChangeSet proposes and what a ReviewDecision approves. Any change
 * to any unit's value, or to their order, changes it, so an approval of the old units is stale (D5579 `stale_approval`).
 */
export async function unitsDigest(units: Unit[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJson(units.map((u) => [u.id, u.value]))));
}

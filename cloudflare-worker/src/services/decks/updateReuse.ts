/**
 * D1584 (#3831, deck builder v2 F5) — investor-update reuse.
 *
 *   deriveFromUpdate   the deck's figures refreshed from the latest investor
 *                      update the venture sent: a PROPOSAL, one entry per
 *                      metric tile whose slot the update reports, with the
 *                      tile's words now, the update's words, and the binding
 *                      Accept would write. Nothing is saved here.
 *   changesSince       what changed between the version an investor's link
 *                      froze (vN) and the deck's current version: the figures
 *                      whose words differ, and the cards added or removed.
 *
 * WHICH TILES. An update carries D654's five figures (`METRIC_KEYS`): MRR,
 * Growth, Customers, Burn and Runway. Each maps to the one deck slot that
 * holds the same figure (`UPDATE_SLOTS`). Only a metric tile bound to one of
 * those slots is proposed: a typed tile, a chart series or free text is not
 * touched, because the update says nothing about it.
 *
 * NEVER A ZERO. A figure the update did not record ("Not recorded", value
 * null) is listed in `not_in_update` with the update's reason. The tile keeps
 * what it shows; it is never proposed as 0 or as blank.
 *
 * SOURCE AND GRADE. A refreshed tile keeps a source and a grade on its face
 * (plan §0 row 10). The update names where each figure came from (`stripe`
 * for Stripe's snapshot, else what the founder typed in Revenue and traction),
 * so its grade is `sourceAndGrade`'s: Measured for a connector, Stated for a
 * typed figure. The record is the update (`portfolio_updates:<uid>`), dated
 * by the figure's own as of.
 *
 * Pure: no SQL, no model. The route reads the rows and calls these.
 */
import { sourceAndGrade } from './sources';
import { valueText } from './newDeck';

/** D654's update figures → the deck slot that holds the same figure. */
export const UPDATE_SLOTS = Object.freeze({
  mrr: 'grow.mrr',
  growth: 'grow.mercury_growth',
  customers: 'grow.paying_customers',
  burn: 'grow.net_burn',
  runway: 'grow.runway',
} as const);

/** An update's unit → the deck's unit, so the words read as the build writes them. */
const UNIT: Record<string, 'usd' | 'percent' | 'count' | 'months'> = { usd: 'usd', pct: 'percent', count: 'count', months: 'months' };

/** Connected tools whose figures an update carries with their own name. */
const CONNECTORS = new Set(['stripe', 'mercury']);

export type UpdateFigure = { key: string; label: string; value: number | null; unit: string; source: string | null; as_of: string | null; reason: string | null };
export type LatestUpdate = { uid: string; title: string; sent_at: string | null; period_start: string | null; period_end: string | null; figures: UpdateFigure[] };

export type Proposal = {
  card: number;                 // 0-based place in the version
  block_id: string;
  label: string;
  source_key: string;
  was: string | null;           // the tile's words now; null when it shows nothing
  now: string;                  // the update's words
  source: 'Connector' | 'Typed';
  binding: { source_key: string; record_ref: string; as_of: string | null; grade: string; snapshot_hash: string };
};

export type Derived = {
  proposals: Proposal[];
  unchanged: number;                                                            // tiles the update reports with the same words
  not_in_update: Array<{ card: number; block_id: string; label: string; reason: string }>;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const blocksOf = (card: any): any[] => (Array.isArray(card?.blocks) ? card.blocks : []);

/** The update's figure for a slot, keyed by the deck slot. */
function bySlot(update: LatestUpdate): Map<string, UpdateFigure> {
  const out = new Map<string, UpdateFigure>();
  for (const f of update.figures) {
    const slot = (UPDATE_SLOTS as Record<string, string>)[f.key];
    if (slot) out.set(slot, f);
  }
  return out;
}

/** The words a figure of the update prints as on a tile, or null when the update did not record it. */
export function updateText(f: UpdateFigure): string | null {
  if (f.value == null || !Number.isFinite(f.value)) return null;
  return valueText({ value: f.value, unit: UNIT[f.unit] ?? 'count', of: null } as any);
}

/** Every bound metric tile of a version that the latest update reports, as a proposal. */
export function deriveFromUpdate(slides: unknown, update: LatestUpdate): Derived {
  const figures = bySlot(update);
  const out: Derived = { proposals: [], unchanged: 0, not_in_update: [] };
  const cards = Array.isArray(slides) ? slides : [];
  cards.forEach((card, i) => {
    for (const b of blocksOf(card)) {
      if (b?.kind !== 'metric' || typeof b.id !== 'string') continue;
      const key = str(b.binding?.source_key);
      const f = key ? figures.get(key) : undefined;
      if (!f) continue;
      const label = str(b.label) || f.label;
      const now = updateText(f);
      if (now == null) {
        out.not_in_update.push({ card: i, block_id: b.id, label, reason: f.reason || 'Not recorded in the latest update' });
        continue;
      }
      const was = str(b.value) || null;
      if (was === now) { out.unchanged += 1; continue; }
      const origin = CONNECTORS.has(str(f.source).toLowerCase()) ? 'connector' : 'typed';
      const { source, grade } = sourceAndGrade(origin);
      out.proposals.push({
        card: i, block_id: b.id, label, source_key: key, was, now,
        source: source as Proposal['source'],
        binding: { source_key: key, record_ref: `portfolio_updates:${update.uid}`, as_of: f.as_of, grade, snapshot_hash: `update:${update.uid}:${f.key}` },
      });
    }
  });
  return out;
}

/** A version's figures that carry words, keyed by where they sit: "<block id>" on a card, or the label. */
function wordsOf(slides: unknown): Map<string, { label: string; value: string | null }> {
  const out = new Map<string, { label: string; value: string | null }>();
  for (const card of Array.isArray(slides) ? slides : []) {
    for (const b of blocksOf(card)) {
      if (b?.kind !== 'metric' || typeof b.id !== 'string') continue;
      const label = str(b.label) || b.id;
      const key = `${str(b.binding?.source_key) || label}`;
      if (!out.has(key)) out.set(key, { label, value: str(b.value) || null });
    }
  }
  return out;
}

export type Changes = {
  figures: Array<{ label: string; was: string | null; now: string | null }>;
  cards: { before: number; after: number };
};

/**
 * What an investor who saw `before` has not seen in `after`: every metric tile
 * whose words differ (matched by its slot, else its label), one added or
 * removed tile included as null on the missing side, and the card counts.
 */
export function changesSince(before: unknown, after: unknown): Changes {
  const a = wordsOf(before);
  const b = wordsOf(after);
  const figures: Changes['figures'] = [];
  for (const [k, was] of a) {
    const now = b.get(k);
    if (!now) figures.push({ label: was.label, was: was.value, now: null });
    else if (now.value !== was.value) figures.push({ label: now.label, was: was.value, now: now.value });
  }
  for (const [k, now] of b) if (!a.has(k)) figures.push({ label: now.label, was: null, now: now.value });
  const count = (s: unknown) => (Array.isArray(s) ? s.length : 0);
  return { figures, cards: { before: count(before), after: count(after) } };
}

/**
 * D1604 (#3716, plan §3) — "Generate from my data": the one-click run's words
 * and derivations, pure. No React, no network.
 *
 * The run itself is main's: the brief from `GET /api/decks/new/context`
 * (#3877's `inferred` when the read carries it, else `fast_path`), the quote
 * (`POST /api/decks/new/quote`), the build (`POST /api/decks/generate`), and
 * the proposal kept with `POST /api/decks/proposals/:id/keep-slides`. What
 * this file adds on the client, through those routes only (§3.4):
 *
 *   the missing-data cut   a card whose only content is a "Not recorded on
 *                          StudioOS yet: …" line is unticked by default and
 *                          listed under "Left out · add data to include",
 *                          with the module that records it. Keep-slides takes
 *                          the ticked list, so a placeholder card never
 *                          reaches Present, share or export. A card that is
 *                          only partly empty keeps its "Not recorded" tile,
 *                          never a 0.
 *   the theme              the base version's theme when it has one; else the
 *                          brand kit's when the venture has one; else Neutral
 *                          light. The pick is part of the proposal: nothing is
 *                          written before Accept.
 *   the ready line         "Ready to present: 10 cards, 2 left out."
 *   the images plan        `GET /api/decks/:id/images/plan` on the saved
 *                          version: the cards an illustration helps, offered
 *                          after Accept with one quote per card, summed.
 */
import { AUDIENCE_LABELS, THEME_LABELS } from './editorModel';
import { aiTokens } from './newDeckModel';
import { HOLD } from './deckV2Model';
import { CONTRAST_MIN, overlayContrast } from './imageContrast.js';

export const ONE_CLICK_TITLE = 'Generate from my data';
/** The studio home's Start from line under "Build a standard deck now". */
export const FAST_LINE = 'One click, from your records';
export const FAST_UNREAD = 'Your venture\'s brief could not be read, so the one-click cannot build yet. Use New deck, or reload.';
export const ONE_CLICK_LINE = 'One press builds a deck from your records and connectors. You review it before anything is saved.';
export const REVIEW_TITLE = 'Your deck';
export const PROPOSED = 'Proposed';
export const LEFT_OUT = 'Left out · add data to include';
export const ACCEPT_ALL_PRESENT = 'Accept all and present';
export const ACCEPT_LINE = 'Accept saves the ticked cards as the new current version. Your earlier versions stay as they are.';
export const NOTHING_TICKED = 'Tick at least one card to accept.';
export const SAVED_LINE = (v) => `Saved as v${v}. It is now the current version.`;
export const THEME_FAILED = 'The cards were saved, but the theme could not be written. Set it in the editor under ⋯ › Theme.';
export const KIT_UNREAD = 'Your brand kit could not be read, so the deck keeps Neutral light. Change it here or later in the editor.';
export const LIVE_LATER = 'Live progress per card';

/** The Worker's own words for a card with nothing recorded (`services/decks/newDeck.ts` `missingLine`). */
export const MISSING_PREFIX = 'Not recorded on StudioOS yet:';

const str = (v) => (v == null ? '' : String(v).trim());
const pad2 = (n) => String(n).padStart(2, '0');

/** The rest of a slide's content, once the heading and its sentence are set aside: what records put there. */
function recordedContent(blocks) {
  return blocks.some((b) => (b?.kind === 'metric' && str(b.value))
    || b?.kind === 'chart' || b?.kind === 'graphic' || b?.kind === 'image' || b?.kind === 'video'
    || (b?.kind === 'text' && b.binding && str(b.text)));
}

/**
 * What a slot the card names is missing, with where to record it: from the
 * card's read-only `auto` fields left empty (`source: 'placeholder'`), each
 * matched to its source item for the module and the link.
 */
function gapsOf(slide, items) {
  const fields = Array.isArray(slide?.fields) ? slide.fields : [];
  const seen = new Set();
  const out = [];
  for (const f of fields) {
    if (f?.source !== 'placeholder') continue;
    const key = f.binding?.source_key || f.key || null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const it = (items || []).find((x) => x?.source_key === key) || null;
    out.push({ key, label: it?.label || str(f.label) || key, module: it?.module || null, href: typeof it?.href === 'string' && it.href.startsWith('/') ? it.href : null });
  }
  return out;
}

/**
 * Each card of a proposal as the review draws it: its number, title and
 * blocks, whether its only content is the not-recorded line (`emptyOnly`),
 * whether some figure on it is not recorded (`partial`), and the gaps with
 * the module that records each.
 */
export function reviewCards(proposal, items = []) {
  const slides = Array.isArray(proposal?.slides) ? proposal.slides : [];
  return slides.map((s, i) => {
    const blocks = Array.isArray(s?.blocks) ? s.blocks : [];
    const line = blocks.find((b) => b?.kind === 'text' && str(b.text).startsWith(MISSING_PREFIX)) || null;
    const emptyMetric = blocks.some((b) => b?.kind === 'metric' && !str(b.value));
    const emptyOnly = Boolean(line) && !recordedContent(blocks);
    return {
      index: i, n: pad2(i + 1), title: str(s?.title) || `Card ${i + 1}`, slide: s,
      emptyOnly, partial: !emptyOnly && (Boolean(line) || emptyMetric),
      gaps: gapsOf(s, items),
    };
  });
}

/** The cards ticked before anyone touches the review: every card, less those with nothing recorded, plus any already kept. */
export function defaultTicks(cards, proposal = null) {
  const kept = new Set(Array.isArray(proposal?.kept) ? proposal.kept : []);
  return new Set(cards.filter((c) => !c.emptyOnly || kept.has(c.index)).map((c) => c.index));
}

/**
 * Keep-slides' body for Accept: the ticked cards, in the proposal's order,
 * saved as the new version in the same press. Null when nothing is ticked.
 * Keep-slides adds to what the proposal already kept, so the ticks start
 * from that (`defaultTicks`).
 */
export function acceptBody(ticked) {
  const indexes = [...ticked].filter(Number.isInteger).sort((a, b) => a - b);
  return indexes.length ? { indexes, save: true } : null;
}

/** The cards left out, as the review lists them: the unticked ones, each with what would bring it back. */
export const leftOut = (cards, ticked) => cards.filter((c) => !ticked.has(c.index));

/** "Ready to present: 10 cards, 2 left out." */
export function readyLine(kept, left) {
  const k = `${kept} card${kept === 1 ? '' : 's'}`;
  return `Ready to present: ${k}${left ? `, ${left} left out` : ''}.`;
}

/**
 * The theme the proposal carries, decided before anything is saved:
 *   - the base version's theme, kept as it is (nothing to write);
 *   - else the venture's brand kit, "Brand · from your brand kit" (written on Accept);
 *   - else Neutral light, which a card with no theme draws already.
 * `kit` is the brand-kit read: `{ status, data }`. While it reads, null.
 */
export function themePick(baseTheme, kit) {
  if (baseTheme?.kind) return { theme: baseTheme, from: 'version', line: `Theme: ${THEME_LABELS[baseTheme.kind] || baseTheme.kind} · as on your current version` };
  if (!kit || kit.status === 'loading' || kit.status === 'idle') return null;
  if (kit.status === 'ok' && kit.data?.kit) return { theme: { kind: 'brand', background: null }, from: 'kit', line: 'Theme: Brand · from your brand kit' };
  return { theme: { kind: 'neutral_light', background: null }, from: kit.status === 'error' ? 'unread' : 'none', line: 'Theme: Neutral light' };
}

/** The theme choices the review's Change offers: the three kinds main renders. */
export const THEME_CHOICES = Object.freeze(Object.keys(THEME_LABELS));

/** Whether Accept must write the theme after saving: only a pick that differs from what the saved version carries. */
export function themeToWrite(chosen, baseTheme) {
  if (!chosen?.kind) return null;
  if ((baseTheme?.kind || null) === chosen.kind) return null;
  // A version with no theme draws Neutral light, so choosing it writes nothing.
  if (!baseTheme?.kind && chosen.kind === 'neutral_light') return null;
  return { kind: chosen.kind, background: chosen.background ?? null };
}

/** The audience's own label, or null: the brief names only what the read gave. */
export const audienceLabel = (id, ctx = null) => (ctx?.audiences || []).find((a) => a?.id === id)?.label || AUDIENCE_LABELS[id] || null;

/** "Building 12 cards from your records." The synchronous build has no per-card progress on main (§3.3). */
export function buildingLine(cards) {
  return cards ? `Building ${cards} card${cards === 1 ? '' : 's'} from your records.` : 'Building your deck from your records.';
}

/** "12 s so far": the elapsed time, whole seconds. */
export function elapsedLine(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  return `${s} s so far`;
}

// ─────────────────────────────────────────────────────────── connectors

const PROVIDERS = { stripe: 'Stripe', mercury: 'Mercury', github: 'GitHub', carta: 'Carta', hubspot: 'HubSpot', posthog: 'PostHog', linear: 'Linear' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * #3877's `freshness` on the context read, as the pre-run line draws it:
 * "Stripe · as of 12 Oct · Sync now". A read without the field draws nothing
 * (the client never guesses which connector is stale). `uid` is the
 * connector's, from the sync path the Worker names; a path that is not
 * `/api/connectors/<uid>/sync` offers no Sync now.
 */
export function freshnessRows(ctx) {
  const list = Array.isArray(ctx?.freshness) ? ctx.freshness : [];
  return list.filter((f) => f && f.provider).map((f) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(f.as_of));
    const asOf = m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
    const uid = /^\/api\/connectors\/([^/?#]+)\/sync$/.exec(str(f.sync?.path))?.[1] || null;
    const name = PROVIDERS[f.provider] || f.provider.charAt(0).toUpperCase() + f.provider.slice(1);
    return { provider: f.provider, name, asOf, stale: Boolean(f.stale), uid: uid ? decodeURIComponent(uid) : null,
      line: `${name} · ${asOf ? `as of ${asOf}` : 'never synced'}${f.stale ? ' · out of date' : ''}` };
  });
}

// ─────────────────────────────────────────────────────────── images

/** The overlay a card background keeps: the lightest that reads at 4.5:1 in the default ink (the Worker's rule). */
export function readableOverlay() {
  return ['light', 'strong'].find((o) => overlayContrast(o) >= CONTRAST_MIN) || 'strong';
}

/**
 * The images plan as the saved deck's offer draws it: none when the Worker
 * cannot draw (its own reason) or no card needs a picture.
 */
export function imagesOffer(plan) {
  if (!plan) return null;
  if (plan.capability && plan.capability.available === false) return { off: true, line: str(plan.capability.reason) || 'Image generation is not available here.' };
  const cards = Array.isArray(plan.cards) ? plan.cards : [];
  if (!cards.length) return null;
  return { off: false, cards, line: `Add pictures to ${cards.length} card${cards.length === 1 ? '' : 's'}` };
}

/** What one card's picture asks the image route: one card background in the deck's art direction. */
export function imageAsk(card, direction) {
  return {
    use: 'card', description: str(card.description), style: card.style, palette: card.palette, aspect: '16:9', count: 1,
    card: card.index, points: [], colours: Array.isArray(direction?.colours) ? direction.colours : [],
  };
}

/**
 * The summed hold of one quote per card: "Holds up to $0.0090 · you pay what
 * it uses". Null when any quote is missing or says AI is off: a partial sum
 * is never shown as the price.
 */
export function imagesHold(quotes) {
  if (!Array.isArray(quotes) || !quotes.length || quotes.some((q) => !q || q.ai !== true || !Number.isFinite(Number(q.total_microusd)))) return null;
  return HOLD(aiTokens(quotes.reduce((s, q) => s + Number(q.total_microusd), 0)));
}

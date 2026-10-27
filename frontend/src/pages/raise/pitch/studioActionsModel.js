/**
 * D898 group E (#2676) — the four actions that lived only in the old template
 * builder, now the studio's own. Their words and derivations are kept pure so
 * the tests read them without a browser.
 *
 *   Fill from project   `POST /api/decks/:id/autofill` (the Decks tab). The
 *                       fill is a proposal beside the current version, kept
 *                       card by card at New deck's step 4 (`?proposal=`).
 *   Recommended         `GET /api/decks/recommend` (New deck's Start from).
 *   Spin-Out readiness  `POST /api/projects/:id/spinout-deck?preview=1` (the
 *                       Decks tab, Spin-Out decks only). A read: no file is built.
 *   Branding            `GET /api/decks/methods` for the plan and the watermark,
 *                       `PUT /api/decks/brand/watermark` to change it.
 */

import { deckReadinessState } from '../../../lib/deckReadiness.js';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { refusalOf } from './newDeckModel.js';

export const SPINOUT_METHOD = 'axal_spinout_demoday';

/** A Spin-Out deck carries the Spin-Out template, on the deck or on any card. */
export function isSpinoutDeck(deck) {
  if (!deck) return false;
  if (deck.method_id === SPINOUT_METHOD) return true;
  let slides = deck.slides;
  if (typeof slides === 'string') { try { slides = JSON.parse(slides); } catch { slides = []; } }
  return Array.isArray(slides) && slides.some((s) => s?.method_id === SPINOUT_METHOD);
}

// ─────────────────────────────────────────────────── Fill from project

export const FILL_TITLE = 'Fill from project';
export const FILL_SENTENCE = 'Eadwyn fills this deck\'s template again from your records, as a proposal beside the current version. Nothing changes until you keep cards and save.';
export const FILL_NO_TEMPLATE = 'This deck has no template to fill. Start a new deck from a template first.';
export const FILL_PLAN = 'This deck\'s template is on a paid plan. Upgrade to fill it again.';
export const FILL_FAILED = 'The fill did not run. Nothing changed.';

/**
 * A refused fill, as a sentence and, where there is one, the place that fixes
 * it. The template's plan (`PAYWALL_PREMIUM_METHOD`) is not the token balance:
 * any other 402 is New deck's own refusal, with its Add tokens link.
 */
export function fillRefusal(e, newPath) {
  const data = e?.data && typeof e.data === 'object' ? e.data : {};
  const code = e?.code || data.code || data.error || null;
  if (e?.status === 409 || code === 'no_method_id') return { message: FILL_NO_TEMPLATE, link: { href: newPath, text: 'New deck ›' }, topUp: null };
  if (e?.status === 402 && (code === 'PAYWALL_PREMIUM_METHOD' || code === 'paywall')) return { message: FILL_PLAN, link: { href: '/pricing', text: 'Plans ›' }, topUp: null };
  const r = refusalOf(e) || {};
  return { message: e?.message ? `${FILL_FAILED} ${e.message}` : FILL_FAILED, link: r.link || null, topUp: r.topUp || null };
}

/** Where a fill's proposal is reviewed: New deck's step 4, on this venture. */
export function proposalHref(newPath, q, proposalId) {
  return `${newPath}${q}${q ? '&' : '?'}proposal=${encodeURIComponent(proposalId)}`;
}

// ─────────────────────────────────────────────────── Recommended

const STAGE_WORDS = {
  idea: 'idea', pre_seed: 'pre-seed', seed: 'seed', series_a: 'Series A', series_b: 'Series B',
  growth: 'growth', partnership: 'partnership', sales: 'sales',
};

/**
 * Why a template is recommended, from the recommend read. A stage nobody
 * recorded says so; the Worker's `unknown` stage is never shown as a stage.
 */
export function recommendReason(rec) {
  if (!rec?.method_id) return null;
  const stage = STAGE_WORDS[rec.stage] || null;
  const sector = String(rec.sector || '').trim();
  if (rec.source === 'override') return `HQ's default template for ${sector} at ${stage || 'this stage'}.`;
  if (rec.source === 'sector') return `Fits a ${sector} venture at ${stage || 'this stage'}.`;
  if (!stage) return 'Your venture\'s stage is not recorded, so this is the plainest template.';
  return `The usual template at ${stage}.`;
}

/** The Start from options, the recommended template marked and first among the templates. */
export function markRecommended(options = [], rec) {
  const id = rec?.method_id;
  if (!id || !options.some((o) => o.kind === 'template' && o.id === id)) return options;
  const reason = recommendReason(rec);
  const marked = options.map((o) => (o.kind === 'template' && o.id === id ? { ...o, recommended: true, reason } : o));
  const firstTemplate = marked.findIndex((o) => o.kind === 'template');
  const at = marked.findIndex((o) => o.recommended);
  if (at <= firstTemplate) return marked;
  const next = marked.slice();
  const [hit] = next.splice(at, 1);
  next.splice(firstTemplate, 0, hit);
  return next;
}

// ─────────────────────────────────────────────────── Spin-Out readiness

export const READINESS_TITLE = 'Spin-Out deck readiness';
export const READINESS_FAILED = 'Readiness could not be read.';

/** The preview read as the panel draws it; the `draft` flag decides, never the gaps alone. */
export function readinessView(r) {
  const preview = r ? {
    gaps: Array.isArray(r.gaps) ? r.gaps.filter((g) => typeof g === 'string' && g.trim()) : [],
    draft: Boolean(r.draft),
    programDay: Number.isFinite(r.program_day) ? r.program_day : null,
  } : null;
  const state = deckReadinessState({ previewLoading: false, deckPreview: preview });
  if (state === 'hidden') return { state };
  const day = preview.programDay == null ? `Program day: ${NOT_RECORDED}.` : `Spin-Out Lab · Day ${preview.programDay} of 28.`;
  if (state === 'gaps') {
    const n = preview.gaps.length;
    return { state, title: `${n} section${n === 1 ? '' : 's'} still empty`, line: `${day} An export is marked as a draft until these are filled.`, gaps: preview.gaps };
  }
  if (state === 'draft') return { state, title: 'All sections filled', line: `${day} Exports are marked as a draft until the 28-day program ends.`, gaps: [] };
  return { state, title: 'Deck is ready', line: `${day} Every section is filled; an export is final.`, gaps: [] };
}

// ─────────────────────────────────────────────────── Branding

export const BRANDING_TITLE = 'Branding';
export const BRANDING_FAILED = 'Your plan and watermark could not be read.';
export const WATERMARK_PLAN = 'The Studio plan adds your own watermark to exports.';
export const WATERMARK_BAD = 'Use a public https:// address.';

/** The plan, footer and watermark lines, from the methods read. */
export function brandingView(m) {
  if (!m) return null;
  const tier = String(m.user_tier || '').trim();
  const url = String(m.watermark_url || '').trim();
  return {
    plan: tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : NOT_RECORDED,
    footer: m.can_remove_footer ? 'The Axal VC footer is off on your exports.' : 'Your exports carry the Axal VC footer.',
    canWatermark: Boolean(m.can_upload_watermark),
    watermark: url || null,
  };
}

/** The address the save would send, or null when it is not one the Worker accepts. */
export function watermarkInput(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && v.length <= 1000 ? v : null;
  } catch { return null; }
}

/** What the watermark dialog says it changes. */
export function watermarkSentence(next, current) {
  if (!next) return 'Your exports stop carrying a watermark, on every venture. This is one line on this venture\'s activity.';
  return `${current ? 'Your watermark changes' : 'Your exports carry this watermark'} on every venture: ${next}. This is one line on this venture's activity.`;
}

/**
 * D4297 (#4297, D4289 P8) — the public side of the Influencer program, its
 * words and its arithmetic: the /influencers tier table, the application
 * sheet's steps and body, where an applicant stands, and the @handle page's
 * offer and disclosure. Pure: no React, no request.
 *
 * NO RATE AND NO PRICE IS TYPED HERE. The tier rates and durations come from
 * `GET /api/influencer/tiers` (HQ's settings, D4289 §1.7), plan prices from
 * `GET /api/public/plans-and-packs` (`lib/planPrices.js`), and bonus and payout
 * amounts from each influencer's own terms, which this page never reads. A
 * tier the settings leave to terms reads "Set per agreement"; a read that
 * failed says so, never a zero.
 *
 * THE DISCLOSURE goes wherever a handle or an offer is drawn: the Worker's
 * sentence when it sent one, otherwise the same sentence built here.
 */
import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };
export const SET_PER_AGREEMENT = 'Set per agreement';
export const TIERS_UNREAD = 'The tiers could not be read just now. That is not the same as having none.';

/** The Worker's sentence (services/influencerHandles.ts DISCLOSURE), for a page that has a name but no sentence. */
export const disclosureFor = (name) => `${String(name || '').trim() || 'This influencer'} earns a commission when you subscribe. Axal memberships are software, not an investment.`;
/** What every handle or offer on the site carries: the Worker's sentence, or the same one built from the name. */
export const disclosureOf = (d) => (typeof d?.disclosure === 'string' && d.disclosure.trim() ? d.disclosure : disclosureFor(d?.name));

/** Who each tier is for (in8). Words only; the rate and duration are read. */
export const TIER_FOR = Object.freeze({
  affiliate_creator: 'Anyone admitted',
  verified_influencer: 'An audience HQ has checked',
  strategic_creator: 'By invitation',
  strategic_partner: 'Organisations, by agreement',
});

const nf = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** "20%", from basis points; "Set per agreement" when the settings leave it to terms. */
export const rateWord = (bps) => (isNum(bps) ? `${nf(Number(bps) / 100)}%` : SET_PER_AGREEMENT);
/** "12 invoices"; "Set per agreement" when left to terms. */
export const durationWord = (n) => (isNum(n) ? `${nf(n)} ${Number(n) === 1 ? 'invoice' : 'invoices'}` : SET_PER_AGREEMENT);

/** The tier table's rows, in the order the Worker sent them. */
export function tierRows(tiers) {
  return (Array.isArray(tiers) ? tiers : []).map((t) => ({
    tier: t.tier,
    label: t.label || NOT_RECORDED,
    rate: rateWord(t.percentage_bps),
    duration: durationWord(t.duration_invoices),
    who: TIER_FOR[t.tier] || NOT_RECORDED,
  }));
}

/**
 * The hero's "20–30%" and "12 invoices", from the tiers that state one; null
 * when no tier states it, so the page says it in words instead.
 */
export function rateRange(tiers) {
  const r = (Array.isArray(tiers) ? tiers : []).map((t) => t?.percentage_bps).filter(isNum).map(Number);
  if (!r.length) return null;
  const lo = Math.min(...r), hi = Math.max(...r);
  return lo === hi ? rateWord(lo) : `${nf(lo / 100)}–${nf(hi / 100)}%`;
}
export function commonDuration(tiers) {
  const d = [...new Set((Array.isArray(tiers) ? tiers : []).map((t) => t?.duration_invoices).filter(isNum).map(Number))];
  return d.length === 1 ? durationWord(d[0]) : null;
}

/** The milestones that pay a one-time bonus (services/influencerCommission.ts BONUS_MILESTONES); each amount is the influencer's terms'. */
export const BONUS_MILESTONES = Object.freeze([10, 25, 50, 100]);

/* ------------------------------------------------------------------ *
 * Where the applicant stands (in9r, in10)
 * ------------------------------------------------------------------ */

/** A day in the page's words: "20 Oct 2026"; nothing reads "Not recorded". */
export function dayWord(iso) {
  if (!iso) return NOT_RECORDED;
  const s = String(iso);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(' ', 'T') + (s.length <= 19 && !s.endsWith('Z') ? 'Z' : ''));
  if (Number.isNaN(d.getTime())) return NOT_RECORDED;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * `GET /api/influencer/me` as one state:
 *   admitted   a live membership (active or paused), with its tier;
 *   review     an application with HQ;
 *   more       HQ asked for more, with its question;
 *   declined   declined, and held until `reapply_after`;
 *   none       nothing open: apply (a decline past its wait, a withdrawal or an ended membership included).
 */
export function standing(me) {
  const m = me?.membership;
  if (m && m.status !== 'ended') return { kind: 'admitted', tier: m.tier_label || NOT_RECORDED, paused: m.status === 'paused', handle: m.handle || null };
  const a = me?.application;
  if (a?.status === 'applied') return { kind: 'review', sent: dayWord(a.updated_at || a.created_at) };
  if (a?.status === 'more_requested') return { kind: 'more', question: a.reason || NOT_RECORDED, answers: a.answers || null };
  if (a?.status === 'declined' && me?.reapply_after) return { kind: 'declined', reason: a.reason || NOT_RECORDED, after: dayWord(me.reapply_after) };
  return { kind: 'none' };
}

/* ------------------------------------------------------------------ *
 * The application sheet (in9)
 * ------------------------------------------------------------------ */

export const CHANNEL_KINDS = Object.freeze([
  ['youtube', 'YouTube'], ['newsletter', 'Newsletter'], ['podcast', 'Podcast'], ['linkedin', 'LinkedIn'], ['x', 'X'],
  ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['blog', 'Blog'], ['community', 'Community'], ['other', 'Other'],
]);
export const REGIONS = Object.freeze(['Europe', 'North America', 'Latin America', 'Asia-Pacific', 'Middle East', 'Africa']);
export const TOPICS = Object.freeze(['Startups', 'Fundraising', 'Product', 'Angel investing', 'Venture capital', 'AI']);
/** The three rules, each a box the applicant ticks; the keys are the Worker's CONSENT_RULES. */
export const RULES = Object.freeze([
  ['disclosure', 'I label every post about Axal as a paid partnership, with #ad.'],
  ['no_deal_promotion', 'I never promote a specific deal, fund or investment return.'],
  ['no_self_referral', 'I don’t use my own handle to sign up myself or my company.'],
]);
export const STEPS = Object.freeze(['Where you publish', 'Your audience', 'The terms']);
export const WHY_MAX = 2000;
export const CHANNELS_MAX = 10;

export const emptyChannel = () => ({ kind: 'youtube', url: '', audience: '' });
export const emptyForm = () => ({ channels: [emptyChannel()], regions: [], topics: [], why: '', consent: {} });

/** A form from HQ's earlier copy of the answers, so "Add the details" starts from what was sent. */
export function formFrom(answers) {
  if (!answers || typeof answers !== 'object') return emptyForm();
  const ch = Array.isArray(answers.channels) && answers.channels.length
    ? answers.channels.map((c) => ({ kind: String(c?.kind || 'other'), url: String(c?.url || ''), audience: c?.audience == null ? '' : String(c.audience) }))
    : [emptyChannel()];
  return {
    channels: ch,
    regions: Array.isArray(answers.regions) ? answers.regions.map(String) : [],
    topics: Array.isArray(answers.topics) ? answers.topics.map(String) : [],
    why: typeof answers.why === 'string' ? answers.why : '',
    consent: {},
  };
}

const httpUrl = (v) => {
  try { const u = new URL(String(v || '').trim()); return /^https?:$/.test(u.protocol); } catch { return false; }
};

/** What is missing on a step, as the sentence the sheet shows; null when the step is complete. */
export function stepError(step, form) {
  if (step === 0) {
    const ch = form.channels || [];
    if (!ch.length || ch.length > CHANNELS_MAX) return `Add from 1 to ${CHANNELS_MAX} channels.`;
    if (ch.some((c) => !httpUrl(c.url))) return 'Give each channel its link, starting with https://.';
    if (ch.some((c) => String(c.audience).trim() !== '' && !(Number.isSafeInteger(Number(c.audience)) && Number(c.audience) >= 0))) return 'An audience size is a whole number, or left empty.';
    return null;
  }
  if (step === 1) {
    if (!form.regions?.length) return 'Choose where your audience is.';
    if (!form.topics?.length) return 'Choose the topics you cover.';
    const why = String(form.why || '').trim();
    if (!why) return 'Say why Axal.';
    if (why.length > WHY_MAX) return `Keep it under ${WHY_MAX.toLocaleString('en-US')} characters.`;
    return null;
  }
  if (step === 2) return RULES.every(([k]) => form.consent?.[k] === true) ? null : 'Tick every rule first.';
  return null;
}

/** The body `POST /api/influencer/apply` takes, with the terms version the applicant read. */
export function applyBody(form, consentVersion) {
  return {
    channels: form.channels.map((c) => ({
      kind: c.kind, url: String(c.url).trim(),
      ...(String(c.audience).trim() === '' ? {} : { audience: Number(c.audience) }),
    })),
    regions: form.regions, topics: form.topics, why: String(form.why).trim(),
    consent_version: consentVersion,
    consent: Object.fromEntries(RULES.map(([k]) => [k, form.consent?.[k] === true])),
  };
}

/** Where a signed-out visitor's Apply goes: register for the program, then back to the sheet. */
export const APPLY_PATH = '/influencers?apply=1';
export const REGISTER_TO_APPLY = `/register?program=influencer&next=${encodeURIComponent(APPLY_PATH)}`;
/** P7's Influencer section (#4296). */
export const SECTION_PATH = '/influencer';

/* ------------------------------------------------------------------ *
 * The @handle page (in7)
 * ------------------------------------------------------------------ */

/** The offer's lines, in P4's words; null when there is none. */
export function offerLines(offer) {
  if (!offer || typeof offer !== 'object') return null;
  const plans = Array.isArray(offer.plans) ? offer.plans.join(', ') : (offer.plans || NOT_RECORDED);
  return {
    discount: offer.discount || NOT_RECORDED,
    plans,
    who: offer.who_for || NOT_RECORDED,
    ends: offer.ends_at === 'No end date' ? 'No end date' : (offer.ends_at ? `Ends ${dayWord(offer.ends_at)}` : NOT_RECORDED),
  };
}

/** The four plans the handle page shows, each with the licence key its price is read under. */
export const HANDLE_PLANS = Object.freeze([
  { key: 'founder:growth', name: 'Founder', line: 'Validate and Build, with the studio beside you.' },
  { key: 'investor:professional', name: 'Investor Pro', line: 'Deal flow, diligence and the portfolio, in one place.' },
  { key: 'advisor', name: 'Advisor', line: 'A profile founders find, and sessions that run themselves.' },
  { key: 'partner', name: 'Operating Partner', line: 'Listed in the directory, matched to the work.' },
]);

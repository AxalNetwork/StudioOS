/**
 * D7119 part 2 (#7119, canvas `Wellness Member Home`, WLM-04, WLM-05, WLM-05B, WLM-05C): Recommendations and the
 * member's own choices, as pure rules. Suggestions come only from what the member chose, plus the topics they
 * ticked on a reflection when, and only when, they allowed it (`/api/wellbeing/preferences`,
 * `/api/wellbeing/recommendations`). Nothing they wrote, no answer and no booking is ever used.
 */
import { formatMinor, majorToMinor, toMajorString } from '../../lib/money';

/** The price limit is kept in US cents (the Worker compares it with each service's own cents). */
export const PRICE_LIMIT_CURRENCY = 'USD';

export const FORMAT_WORDS = Object.freeze({ one_to_one: '1:1 sessions', group: 'Group sessions' });
export const SOURCE_WORDS = Object.freeze({ day: 'Today’s reflections', week: 'Weekly reflections', month: 'Monthly reflections', earlier: 'Earlier check-ins' });
export const SOURCES = Object.freeze(['day', 'week', 'month', 'earlier']);

/** The editable copy of the member's choices. */
export function prefsDraft(p) {
  return {
    support_types: [...(p?.support_types || [])],
    formats: [...(p?.formats || [])],
    languages: (p?.languages || []).join(', '),
    price: p?.price_max_cents == null ? '' : (toMajorString(p.price_max_cents, PRICE_LIMIT_CURRENCY) || '').replace(/\.00$/, ''),
    suggestions: p?.suggestions !== false,
    topic_consent: !!p?.topic_consent,
    topic_sources: [...(p?.topic_sources || [])],
  };
}

export const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The PUT body: only what changed, with `base_revision`, or `{ problem }` for a value the Worker would refuse, or
 * null when nothing changed. Languages are written as codes (en, fr); a blank price is no limit.
 */
export function prefsBody(draft, p) {
  const out = {};
  if (!sameSet(draft.support_types, p.support_types || [])) out.support_types = [...draft.support_types];
  if (!sameSet(draft.formats, p.formats || [])) out.formats = [...draft.formats];
  const langs = draft.languages.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (langs.some((l) => !/^[a-z]{2,3}$/.test(l)) || langs.length > 10) return { problem: 'Write languages as up to 10 short codes, such as en, fr.' };
  if (!sameSet(langs, (p.languages || []).map((l) => l.toLowerCase()))) out.languages = [...new Set(langs)];
  const priceText = String(draft.price).trim();
  let cents = null;
  if (priceText !== '') {
    cents = Number(priceText) > 0 ? majorToMinor(priceText, PRICE_LIMIT_CURRENCY) : null;
    if (cents == null || cents <= 0) return { problem: 'A price limit is a positive amount, or blank for no limit.' };
  }
  if (cents !== (p.price_max_cents ?? null)) out.price_max_cents = cents;
  if (draft.suggestions !== (p.suggestions !== false)) out.suggestions = draft.suggestions;
  if (draft.topic_consent && !draft.topic_sources.length) return { problem: 'Choose which of your reflections the topics may come from.' };
  if (draft.topic_consent !== !!p.topic_consent) out.topic_consent = draft.topic_consent;
  if (draft.topic_consent && !sameSet(draft.topic_sources, p.topic_sources || [])) out.topic_sources = [...draft.topic_sources];
  if (!Object.keys(out).length) return null;
  return { ...out, base_revision: Number(p.revision) || 0 };
}

/** "From what you chose: Coaching · Nutrition. Spiritual guidance is off." */
export function chosenLine(p) {
  const opts = p?.support_type_options || [];
  const chosen = opts.filter((o) => (p.support_types || []).includes(o.key)).map((o) => o.label);
  if (!chosen.length) return 'You haven’t chosen any interests yet. Suggestions use only what you choose.';
  const spiritual = opts.find((o) => o.key === 'spiritual');
  const off = spiritual && !(p.support_types || []).includes('spiritual') ? ` ${spiritual.label} is off.` : '';
  return `From what you chose: ${chosen.join(' · ')}.${off}`;
}

/** Money in the service's currency; null when not a positive amount. */
export function money(cents, currency = 'USD') {
  const n = Number(cents);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return formatMinor(n, String(currency || 'USD').toUpperCase(), { locale: 'en-US', trimWhole: true });
}

/**
 * A card's facts in words. An expert: kinds of support, 1:1, languages, time zones, the lowest active price and
 * whether they offer times. A group session: kind, group, language, when, seats and "Free".
 */
export function cardFacts(item) {
  if (item.kind === 'session') {
    const when = item.starts_at ? item.starts_at.replace('T', ' ').slice(0, 16) + ' UTC' : null;
    return {
      title: item.title,
      kind: item.support_type?.label || null,
      byline: item.facilitator?.name ? `Facilitated by ${item.facilitator.name}` : null,
      facts: [['Format', 'Group'], ['Language', item.language || null], ['When', when], ['Price', 'Free']],
      next: item.state === 'full' ? 'Full · no seats left' : item.state === 'open' ? `${item.seats_left} ${item.seats_left === 1 ? 'seat' : 'seats'} left` : 'Not open for seats',
      available: !!item.available,
    };
  }
  const prices = (item.services || []).map((s) => s.price_cents).filter((n) => Number.isFinite(Number(n)));
  const min = prices.length ? Math.min(...prices) : null;
  const svc = (item.services || []).find((s) => s.price_cents === min);
  return {
    title: item.name,
    kind: (item.support_types || []).map((t) => t.label).join(' · ') || null,
    byline: item.headline || null,
    facts: [
      ['Format', '1:1'],
      ['Language', (item.languages || []).join(', ') || null],
      ['Time zone', (item.timezones || []).join(', ') || null],
      ['Price', min == null ? null : min === 0 ? 'Free' : `From ${money(min, svc?.currency)}`],
    ],
    next: item.available ? 'Offers times to book' : 'No open times right now',
    available: !!item.available,
  };
}

/** "Not shown: 1 dismissed, 2 outside your languages." — or null. */
export function excludedLine(x) {
  if (!x) return null;
  const parts = [];
  if (x.dismissed) parts.push(`${x.dismissed} dismissed`);
  if (x.language) parts.push(`${x.language} outside your languages`);
  if (x.price) parts.push(`${x.price} over your price limit`);
  if (x.format) parts.push(`${x.format} in a format you didn’t choose`);
  return parts.length ? `Not shown: ${parts.join(', ')}.` : null;
}

/** The section's state from the read. Unreadable is never "no match". */
export function sectionState(read) {
  if (!read || read.state === 'loading') return 'loading';
  if (read.state !== 'ok') return 'unreadable';
  const s = read.value?.state;
  return ['off', 'choose_interests', 'no_match', 'ok'].includes(s) ? s : 'unreadable';
}

const codeOf = (e) => e?.data?.error || e?.data?.code || null;
export function prefsRefusal(e) {
  switch (codeOf(e)) {
    case 'preferences_changed': return 'Your choices were changed somewhere else. Reload them before saving again.';
    case 'topic_sources_required': return 'Choose which of your reflections the topics may come from.';
    case 'invalid_languages': return 'Write languages as up to 10 short codes, such as en, fr.';
    case 'invalid_price_max': return 'A price limit is a positive amount, or blank for no limit.';
    default: return 'Your choices weren’t saved. Nothing changed; try again.';
  }
}
export const isPrefsChanged = (e) => codeOf(e) === 'preferences_changed';

export const RESOURCES_APART = 'General resources are listed separately and are the same for everyone. Nothing there is chosen from your reflections.';

import { SITE_NAME, ogImageKeys, ogImageUrl } from './ogRegistry.js';

const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const clip = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
const location = new Map([['virtual', 'Online'], ['online', 'Online'], ['in_person', 'In person'], ['hybrid', 'Hybrid']]);

function eventWhen(startsAt, timezone) {
  if (!startsAt) return '';
  const stamp = String(startsAt).replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(stamp) ? stamp : stamp + 'Z');
  if (!Number.isFinite(date.getTime())) return '';
  const format = (zone) => new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, dateStyle: 'medium', timeStyle: 'short',
  }).format(date) + ` ${zone}`;
  try { return format(timezone || 'UTC'); } catch { return format('UTC'); }
}

/** D3724 gap 12. Only fields allowed on a public event's share card. */
export function eventSocialCard(event) {
  const name = clip(oneLine(event.title), 70 - SITE_NAME.length - 3);
  const head = [eventWhen(event.starts_at, event.timezone), location.get(oneLine(event.location_kind).toLowerCase())].filter(Boolean).join(' · ');
  const description = clip([head, oneLine(event.summary)].filter(Boolean).join('. '), 200);
  const cover = typeof event.cover_url === 'string' ? event.cover_url.trim() : '';
  const hasCover = /^https:\/\/[^\s"'<>]+$/i.test(cover);
  const fallback = ['event', 'content'].find((key) => ogImageKeys().includes(key)) || 'default';
  return {
    title: name ? `${name} — ${SITE_NAME}` : '',
    description,
    image: hasCover ? cover : ogImageUrl(fallback),
    imageIsCard: !hasCover,
    imageAlt: name,
    type: /** @type {const} */ ('website'),
  };
}

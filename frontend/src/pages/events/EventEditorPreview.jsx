import React from 'react';
import { eventTimeFields } from '../../../../cloudflare-worker/src/services/eventTimes.ts';
import { eventSocialCard } from '../../lib/eventSocialCard.js';
import { eventTimePayload } from './eventTimeModel.js';
import { CARD, EventLine } from './MyEventsCard';

const heading = 'm-0 text-xs font-bold text-axal-muted dark:text-gray-400';

function coverStyle(rect) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return null;
  return {
    width: `${100 / rect.w}%`,
    height: `${100 / rect.h}%`,
    left: `${-100 * rect.x / rect.w}%`,
    top: `${-100 * rect.y / rect.h}%`,
  };
}

function Cover({ src, alt, crop, social = false }) {
  const style = coverStyle(crop);
  return (
    <div className={`relative overflow-hidden bg-axal-ground dark:bg-gray-800 ${social ? 'aspect-[1.91]' : 'aspect-video'}`}>
      <img src={src} alt={alt} style={style || undefined}
        className={style ? 'absolute max-w-none' : 'h-full w-full object-cover'} />
    </div>
  );
}

export default function EventEditorPreview({ form, saved }) {
  const time = eventTimePayload(form, saved);
  let starts = null;
  try {
    if (time.starts_at) starts = eventTimeFields({ starts_at: time.starts_at, timezone: time.timezone }).starts_at;
  } catch { /* Incomplete or invalid wall times have no preview date. */ }
  const event = { ...form, starts_at: starts };
  const social = eventSocialCard(event);
  const title = event.title.trim() || '[Event title]';
  const summary = event.summary.trim();

  return (
    <aside aria-label="Preview" className="min-w-0 space-y-3 lg:sticky lg:top-4" data-testid="event-editor-preview">
      <h2 className={heading}>Preview · in My events</h2>
      <div className={`${CARD} overflow-hidden`} data-testid="event-preview-my-events">
        <Cover src={social.image} alt={social.imageIsCard ? '' : form.cover_alt}
          crop={social.imageIsCard ? null : form.cover_crops?.card} />
        <div className="p-3"><EventLine event={{ ...event, title }} sub={summary || null} /></div>
      </div>
      <h2 className={heading}>Preview · social card 1.91:1</h2>
      <div className={`${CARD} relative overflow-hidden`} data-testid="event-preview-social">
        <Cover social src={social.image} alt={social.imageIsCard ? '' : form.cover_alt}
          crop={social.imageIsCard ? null : form.cover_crops?.social} />
        <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black via-black/75 to-transparent px-3 pb-3 pt-6">
          <p className="m-0 line-clamp-2 break-words text-sm font-bold text-white">{social.title || title}</p>
          <p className="m-0 line-clamp-3 break-words text-xs text-gray-100">{social.description || 'Date and format'}</p>
        </div>
      </div>
    </aside>
  );
}

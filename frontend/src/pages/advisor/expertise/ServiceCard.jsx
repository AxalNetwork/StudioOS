import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { Pill, ghostButtonClass } from './kit';
import {
  SERVICE_PUBLICATION, SESSIONS_PATH, publicationOf, servicePrice, servicePublicationAction,
} from './expertiseModel';

/**
 * D4824 (#4824, EX-06) — one service, as a card: title, kind and duration, the
 * price with its currency written out (or "No price set", never a zero), the
 * publication state the Worker stores, and the card's four actions.
 *
 * WHAT THE CARD DOES NOT SAY. It never says "Bookable": a service is not booked;
 * a founder books a session type through its booking link, which Practice ›
 * Sessions owns (#4832, the owner's answer on #4824). The card links there and
 * edits nothing of it. Published means "on your public profile", and nothing
 * more.
 *
 * Every action is at least 44px tall on a phone; from `sm` up they are the
 * page's usual compact buttons.
 */
const ACTION = `${ghostButtonClass} inline-flex min-h-[44px] items-center sm:min-h-[32px]`;

export default function ServiceCard({
  row, wide, editing, confirming, busy, previewPath, buttonRef, onEdit, onPublication, onAskRemove, children,
}) {
  const state = publicationOf(row);
  const meta = SERVICE_PUBLICATION[state];
  const action = servicePublicationAction(row);
  const price = servicePrice(row.price_cents, row.currency);
  const kind = { fixed: 'Fixed', package: 'Package', retainer: 'Retainer' }[row.kind] || row.kind;
  const canPreview = state === 'published' && !!previewPath;
  return (
    <Card padding="md" className={`flex min-w-0 flex-col gap-2 ${wide ? 'md:col-span-2 xl:col-span-3' : ''}`}
      data-testid={`advisor-service-card-${row.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 break-words text-[13.5px] font-extrabold">{row.title}</h3>
          <div className="mt-0.5 text-[11.5px] text-axal-faint">
            {[kind, row.duration_note].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span title={meta.hint} data-testid={`advisor-service-publication-${row.id}`}>
          <Pill tone={meta.tone}>{meta.label}</Pill>
        </span>
      </div>
      <div className="text-[15px] font-extrabold tabular-nums" data-testid={`advisor-service-price-${row.id}`}>
        {price ?? <span className="font-semibold text-axal-faint">— No price set</span>}
      </div>
      {row.scope && <p className="m-0 text-[12px] leading-relaxed text-axal-muted">{row.scope}</p>}
      <p className="m-0 text-[11.5px] text-axal-faint" data-testid={`advisor-service-booking-${row.id}`}>
        {meta.hint}{' '}Booking:{' '}
        <Link to={SESSIONS_PATH} className="font-semibold text-emerald-700 underline dark:text-emerald-300">a session type in Practice › Sessions</Link>
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <button type="button" className={ACTION} onClick={onEdit}
          ref={(n) => buttonRef('edit', n)}
          aria-expanded={editing} aria-label={`${editing ? 'Close' : 'Edit'} ${row.title}`}
          data-testid={`advisor-service-edit-${row.id}`}>
          {editing ? 'Close' : 'Edit'}
        </button>
        <button type="button" className={ACTION} onClick={() => onPublication(action, state)}
          disabled={busy} aria-label={`${action.label}: ${row.title}`}
          data-testid={`advisor-service-state-${row.id}`}>
          {action.label}
        </button>
        {canPreview ? (
          <Link to={previewPath} className={ACTION} aria-label={`Preview ${row.title} on your public profile`}
            data-testid={`advisor-service-preview-${row.id}`}>
            Preview
          </Link>
        ) : (
          <button type="button" className={ACTION} disabled data-testid={`advisor-service-preview-${row.id}`}
            title={state === 'published' ? 'Save your profile first: there is no public page yet' : 'Only a Published service is on your public profile'}>
            Preview
          </button>
        )}
        <button type="button" className={ACTION} onClick={onAskRemove}
          ref={(n) => buttonRef('remove', n)}
          aria-expanded={confirming}
          aria-label={`Remove ${row.title}`} data-testid={`advisor-service-remove-${row.id}`}>
          Remove…
        </button>
      </div>
      {children}
    </Card>
  );
}

/**
 * D246 — S1b, "Operating posture": what the admin bank has on record.
 *
 * Four cards, one per bank section, reading `GET /api/advisor/admin-posture`.
 * The header count is questions recorded over the bank's size, both sent by
 * the server from the ledger — never a count of the values on screen, because
 * a recorded answer whose store holds nothing still counts as answered.
 *
 * Three field states, and they are different claims: a recorded answer shows
 * the admin's own words; a skipped one says it was skipped in the chat; an
 * unanswered one reads "Not recorded" and points back at the chat. A failed
 * read is one Unreadable with a retry, never eleven "Not recorded" rows.
 * Nothing is scored.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import { UNAVAILABLE } from './adminStudioOverview';

/** The canvas's four cards. `chip` is the field shown beside the title. */
export const POSTURE_CARDS = [
  {
    section: 'OVERSIGHT',
    title: 'Oversight',
    chip: 'admin.oversight.risk_tolerance',
  },
  { section: 'OPERATIONS', title: 'Operations' },
  { section: 'GOVERNANCE', title: 'Governance' },
  { section: 'PREFS', title: 'Preferences', quiet: true, link: { to: '/account', label: 'Settings' } },
];

export const CHAT_ANCHOR = 'studio-chat';

function toChat(e) {
  const el = typeof document !== 'undefined' ? document.getElementById(CHAT_ANCHOR) : null;
  if (el) {
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function FieldValue({ field }) {
  if (field.state === 'recorded') {
    return field.value
      ? <span className="font-semibold text-axal-ink" data-state="recorded">{field.value}</span>
      : (
        <span data-state="recorded">
          <Unrecorded reason={field.value_reason}>Answered, value not stored</Unrecorded>
        </span>
      );
  }
  if (field.state === 'skipped') {
    return (
      <span data-state="skipped" className="italic text-gray-500 dark:text-gray-400">
        Skipped in the chat
        {' · '}
        <a href={`#${CHAT_ANCHOR}`} onClick={toChat} className="not-italic underline underline-offset-2">
          Continue in the chat ↑
        </a>
      </span>
    );
  }
  return (
    <span data-state="not_recorded">
      <Unrecorded reason="The chat has not asked or been answered on this yet." />
      {' · '}
      <a href={`#${CHAT_ANCHOR}`} onClick={toChat} className="text-[12px] underline underline-offset-2">
        Continue in the chat ↑
      </a>
    </span>
  );
}

/** Presentational: `posture` is null (reading), UNAVAILABLE, or the payload. */
export function StudioPostureView({ posture, onRetry }) {
  if (posture === null) {
    return <p className="mt-2 text-[12px] text-axal-muted">Reading the operating posture…</p>;
  }
  if (posture === UNAVAILABLE || !posture || posture.available === false) {
    return (
      <div className="mt-2" data-testid="studio-posture-unreadable">
        <Unreadable
          what="The operating posture"
          claim={(posture && posture !== UNAVAILABLE && posture.reason)
            || 'This is not a claim that none of it is recorded.'}
          onRetry={onRetry}
        />
      </div>
    );
  }
  const fields = Array.isArray(posture.fields) ? posture.fields : [];
  return (
    <>
      <p className="mt-1 text-[12.5px] text-axal-muted" data-testid="studio-posture-count">
        {posture.recorded} of {posture.bank_size} admin-bank questions recorded
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.45fr_1fr_1fr_.85fr]">
        {POSTURE_CARDS.map((card) => {
          const rows = fields.filter((f) => f.section === card.section);
          const chip = card.chip ? rows.find((f) => f.id === card.chip) : null;
          const listed = chip ? rows.filter((f) => f.id !== card.chip) : rows;
          return (
            <Card key={card.section} data-testid={`studio-posture-${card.section.toLowerCase()}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className={`text-[13.5px] font-extrabold tracking-tight ${card.quiet ? 'text-axal-muted' : 'text-axal-ink'}`}>
                  {card.title}
                </h3>
                {chip && chip.state === 'recorded' && chip.value ? (
                  <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink">
                    {chip.value}
                  </span>
                ) : null}
              </div>
              <dl className="mt-2 space-y-1.5 text-[12.5px]">
                {chip && !(chip.state === 'recorded' && chip.value) ? (
                  <div>
                    <dt className="text-axal-muted">{chip.label}</dt>
                    <dd><FieldValue field={chip} /></dd>
                  </div>
                ) : null}
                {listed.map((f) => (
                  <div key={f.id}>
                    <dt className="text-axal-muted">{f.label}</dt>
                    <dd><FieldValue field={f} /></dd>
                  </div>
                ))}
              </dl>
              {card.link ? (
                <Link to={card.link.to} className="mt-2 inline-block text-[12px] font-semibold underline underline-offset-2">
                  {card.link.label} →
                </Link>
              ) : null}
            </Card>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-axal-muted">
        The count is the bank's questions answered in the chat, not the values shown here. Nothing is scored:
        a posture is a choice stated, not a rating of it.
      </p>
    </>
  );
}

export default function StudioPosture() {
  const [posture, setPosture] = useState(null);
  const load = useCallback(() => {
    let cancelled = false;
    setPosture(null);
    api.adminPosture().then(
      (p) => { if (!cancelled) setPosture(p); },
      (e) => {
        reportError('admin-studio:posture', e);
        if (!cancelled) setPosture(UNAVAILABLE);
      },
    );
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);
  return (
    <section className="mt-6" data-testid="studio-posture">
      <h2 className="text-[15px] font-extrabold tracking-tight text-axal-ink">Operating posture</h2>
      <StudioPostureView posture={posture} onRetry={load} />
    </section>
  );
}

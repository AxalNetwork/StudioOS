/**
 * D246 — S1b, "Operating posture": what the admin bank has on record.
 *
 * Four cards, one per bank section, reading `GET /api/advisor/admin-posture`.
 * The header count is questions recorded over the bank's size, both sent by
 * the server from the ledger — never a count of the values on screen, because
 * a recorded answer whose store holds nothing still counts as answered.
 *
 * Two field states are listed, and they are different claims: a recorded
 * answer shows the admin's own words; a skipped one says it was skipped in the
 * chat. A failed read is one Unreadable with a retry, never eleven "Not
 * recorded" rows. Nothing is scored.
 *
 * D8728 (#8728) — the posture is no longer its own section above the
 * decisions. It sits inside Setup (`StudioSetup.jsx`), which shows the count
 * and the one Resume setup action; an unanswered question is no longer a row
 * of its own here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import { STUDIO_CHAT_ANCHOR } from '../../components/advisor/interviewCompleteRow';
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

// D324 — one definition, beside the component that renders the anchor.
export const CHAT_ANCHOR = STUDIO_CHAT_ANCHOR;

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
  // D8728: a skipped answer says so; Resume setup is the one way back to the chat.
  return <span data-state="skipped" className="italic text-gray-500 dark:text-gray-400">Skipped in the chat</span>;
}

/** D8728: only what the chat has answered or skipped is listed; the rest is the Setup row's count. */
export const answered = (f) => f.state === 'recorded' || f.state === 'skipped';

/**
 * Presentational: `posture` is null (reading), UNAVAILABLE, or the payload.
 *
 * D8728: the cards list what the chat has answered or skipped, nothing else.
 * With nothing answered there are no cards at all — the Setup row's count
 * ("0 of 11 admin-bank questions recorded") already says so, once, where
 * eleven "Not recorded · Continue in the chat ↑" rows used to.
 */
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
  const fields = (Array.isArray(posture.fields) ? posture.fields : []).filter(answered);
  if (!fields.length) return null;
  return (
    <div data-testid="studio-posture">
      <h3 className="mt-4 text-[13.5px] font-extrabold tracking-tight text-axal-ink">Operating posture</h3>
      <div className="mt-2 grid gap-3 lg:grid-cols-[1.45fr_1fr_1fr_.85fr]">
        {POSTURE_CARDS.map((card) => {
          const rows = fields.filter((f) => f.section === card.section);
          if (!rows.length) return null;
          const chip = card.chip ? rows.find((f) => f.id === card.chip) : null;
          const listed = chip ? rows.filter((f) => f.id !== card.chip) : rows;
          return (
            <Card key={card.section} data-testid={`studio-posture-${card.section.toLowerCase()}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h4 className={`text-[13.5px] font-extrabold tracking-tight ${card.quiet ? 'text-axal-muted' : 'text-axal-ink'}`}>
                  {card.title}
                </h4>
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
    </div>
  );
}

/**
 * The Setup row's figures from the posture, both sent by the server from the
 * ledger: `{ recorded, bankSize, remaining }`, or null when they were not read.
 */
export function setupCount(posture) {
  if (!posture || posture === UNAVAILABLE || posture.available === false) return null;
  const recorded = Number(posture.recorded);
  const bankSize = Number(posture.bank_size);
  if (!Number.isInteger(recorded) || !Number.isInteger(bankSize) || bankSize < 1 || recorded < 0) return null;
  return { recorded, bankSize, remaining: Math.max(0, bankSize - recorded) };
}

/** `GET /api/advisor/admin-posture`: null while reading, UNAVAILABLE on failure, else the payload. */
export function usePosture() {
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
  return [posture, load];
}

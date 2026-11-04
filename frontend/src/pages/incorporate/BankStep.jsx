import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal.js';
import { BANK_LINES, BANK_TITLE, bankStepOf, mercuryOpenUrl } from './incorporateModel.js';

/**
 * #4356 (D4356) — Incorporate's "Open a bank account" step, with Mercury.
 *
 * Drawn from INC3b's status timeline (its last stop, "bank") as a row after
 * Filed, and from INC4's Done next steps (bank, cap table, 83(b)) as a card.
 * It names Mercury and links out to its account opening: the owner's referral
 * link when configured (`VITE_MERCURY_REFERRAL_URL`), else Mercury's public
 * site. It is done only when the founder's own Mercury is connected and active
 * (`GET /api/mercury/personal/status`); until then it offers Connect Mercury,
 * the existing connector page. A failed read says so and is never done.
 *
 * `status` and `configured` are for tests: a fixed status read, and the config value.
 */
const CONFIGURED = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MERCURY_REFERRAL_URL) || '';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';

export function useMercuryStatus(fixed) {
  const [status, setStatus] = useState(fixed);
  useEffect(() => {
    if (fixed !== undefined) { setStatus(fixed); return undefined; }
    let alive = true;
    mercuryPersonalApi.status().then((r) => { if (alive) setStatus(r); }).catch(() => { if (alive) setStatus('unread'); });
    return () => { alive = false; };
  }, [fixed]);
  return status;
}

function Actions({ step, openUrl }) {
  if (step.done) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <a href={openUrl} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="bank-open-mercury">Open a Mercury account ↗</a>
      <Link to="/account/connectors/mercury" className={LINK} data-testid="bank-connect-mercury">{step.kind === 'attention' ? 'Reconnect Mercury' : 'Connect Mercury'}</Link>
    </span>
  );
}

export default function BankStep({ variant = 'card', status: fixed, configured = CONFIGURED }) {
  const status = useMercuryStatus(fixed);
  const step = bankStepOf(status);
  const openUrl = mercuryOpenUrl(configured);
  if (variant === 'row') {
    return (
      <div className="flex items-start gap-3" data-testid="timeline-bank" data-done={step.done ? 'true' : 'false'} data-kind={step.kind}>
        <span aria-label={step.done ? 'Done' : 'Waiting'} role="img"
          className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${step.done ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
          {step.done ? '✓' : '…'}
        </span>
        <span className="flex flex-col gap-1">
          <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{BANK_TITLE}</b>
          <span className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="bank-line">{step.line}</span>
          {step.kind === 'todo' ? <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{BANK_LINES.connect}</span> : null}
          <Actions step={step} openUrl={openUrl} />
        </span>
      </div>
    );
  }
  return (
    <section className={`flex flex-col gap-1.5 rounded-axal-lg border bg-white px-4 py-3 dark:bg-gray-900 ${step.done ? 'border-emerald-300 dark:border-emerald-800' : 'border-axal-hairline dark:border-gray-700'}`}
      data-testid="done-bank" data-done={step.done ? 'true' : 'false'} data-kind={step.kind}>
      <b className="text-[14px] text-axal-ink dark:text-gray-100">{step.done ? '✓ ' : ''}{BANK_TITLE}</b>
      <span className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="bank-line">{step.line}</span>
      {step.kind === 'todo' ? <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{BANK_LINES.connect}</span> : null}
      <Actions step={step} openUrl={openUrl} />
    </section>
  );
}

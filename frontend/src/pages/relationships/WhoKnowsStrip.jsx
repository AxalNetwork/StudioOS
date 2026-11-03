import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { relationshipsApi } from '../../lib/api/relationships.js';
import { reportError } from '../../lib/log';
import { applyRank } from '../../lib/rankByFit';
import RankByFit from '../../ui/RankByFit.jsx';
import Sheet from '../../ui/Sheet.jsx';
import {
  ASK_SENDS, CONTEXT_HELP, CONTEXT_LABEL, DRAFT_LATER, NOTE_MAX, REASON_HELP, REASON_LABEL, SENT_LINE, SENT_TITLE, STRIP_EMPTY, STRIP_MAX, STRIP_TITLE, STRIP_UNREAD,
  askReady, stripLine, stripRows,
} from './relationshipsModel';

/**
 * D1357 (#3572, RI2, RI3) — "Who knows them" on a record: up to three
 * teammates who chose to share that they know this investor, someone at this
 * company or someone at this fund (`GET /api/relationships/who-knows`, D1356),
 * each with how they know them and "Ask … for an introduction". No contact
 * detail. A teammate who did not share never appears, and nothing hints at
 * them: no count, no locked or blurred row. "Rank by fit" (#3938 NE1) reorders
 * the same rows.
 *
 * `query` is one of `{ person }` (a LinkedIn URL or an email), `{ company }`
 * or `{ fund }`; `subject` is how the line names them ("Alex Example",
 * "someone at Halyard Security").
 *
 * The ask (RI3) is the shared right Sheet: the reason (required; the teammate
 * reads it), the context for the person (optional; only the two of them read
 * it), and "Axal sends your request to … only". Eadwyn's "Draft from this
 * record" waits for part 8b and is drawn greyed.
 */
const CARD = 'rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] px-3 text-[12px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const AVATAR = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-axal-violet dark:bg-violet-950/60 dark:text-violet-300';
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function WhoKnowsStrip({ query, subject, testId = 'who-knows' }) {
  const key = JSON.stringify(query || {});
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [ranked, setRanked] = useState(null);
  const [asking, setAsking] = useState(null);

  const load = useCallback(() => {
    let live = true;
    setRead({ status: 'loading', data: null }); setRanked(null);
    relationshipsApi.whoKnows(query)
      .then((data) => { if (live) setRead({ status: 'ok', data }); })
      .catch((e) => { if (live) setRead({ status: 'error', data: null }); reportError('relationships:who-knows', e); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => load(), [load]);

  const people = read.data?.people || [];
  const order = useMemo(() => (ranked ? applyRank(people, (p) => p.ref, ranked) : { list: people, lineFor: () => null }), [people, ranked]);
  const rows = stripRows(order.list);

  return (
    <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="flex flex-col gap-0.5">
        <h3 id={`${testId}-title`} className={`m-0 text-[14px] font-extrabold ${INK}`}>{STRIP_TITLE}</h3>
        <span className={MUTED}>{stripLine(subject)}</span>
      </div>
      {read.status === 'loading' ? <div className="h-10 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" /> : null}
      {read.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-error`}>
          <span className={MUTED}>{STRIP_UNREAD}</span>
          <button type="button" className={GHOST} onClick={load}>Try again</button>
        </div>
      ) : null}
      {read.status === 'ok' && !rows.length ? <p className={`m-0 ${MUTED}`} data-testid={`${testId}-empty`}>{STRIP_EMPTY}</p> : null}
      {rows.length ? (
        <>
          {people.length > 1 ? (
            <RankByFit run={(q) => relationshipsApi.whoKnowsRank(query, q)} onRanked={setRanked} ranked={ranked ? order.ranked ?? null : null}
              total={Math.min(people.length, STRIP_MAX)} testid={`${testId}-rank`} />
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3" data-testid={`${testId}-row-${i}`}>
                <span className={AVATAR} aria-hidden="true">{initials(r.teammate)}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`text-[13px] font-bold ${INK}`}>{r.knows}</span>
                  {r.detail ? <span className={MUTED}>{r.detail}</span> : null}
                  {order.lineFor(order.list[i]) ? <span className={`${MUTED} italic`}>{order.lineFor(order.list[i])}</span> : null}
                </span>
                <button type="button" className={GHOST} onClick={() => setAsking(r)} data-testid={`${testId}-ask-${i}`}>{r.ask}</button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {asking ? <AskIntroSheet row={asking} onClose={() => setAsking(null)} testId={`${testId}-sheet`} /> : null}
    </section>
  );
}

/** RI3: the ask, then its sent state. Nothing reaches the person. */
export function AskIntroSheet({ row, onClose, testId = 'who-knows-sheet' }) {
  const [reason, setReason] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const send = async () => {
    if (!askReady({ reason, context })) return;
    setBusy(true); setError(null);
    try {
      const r = await relationshipsApi.requestIntro({ teammate: row.teammateId, ref: row.ref, note: reason.trim(), ...(context.trim() ? { context_note: context.trim() } : {}) });
      setSent(r?.request ?? { status: 'pending' });
    } catch (e) { setError(e?.message || 'The request could not be sent. Nothing was sent.'); reportError('relationships:request', e); }
    finally { setBusy(false); }
  };
  const footer = sent ? (
    <button type="button" className={GHOST} onClick={onClose} data-testid={`${testId}-done`}>Done</button>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={PRIMARY} disabled={busy || !askReady({ reason, context })} onClick={send} data-testid={`${testId}-send`}>Send request</button>
      <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
    </div>
  );
  return (
    <Sheet label={row.ask} title={sent ? SENT_TITLE : row.ask} sub={sent ? `To ${row.teammate}` : `${row.knows}`} onClose={onClose} width={520} footer={footer} testId={testId}>
      {sent ? (
        <div className="flex flex-col gap-2" data-testid={`${testId}-sent`}>
          <p className={`m-0 text-[13px] ${INK}`}>{SENT_LINE(row.teammate)}</p>
          <p className={`m-0 ${MUTED}`}>{ASK_SENDS(row.teammate, row.person)}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={`text-[12px] font-bold ${INK}`}>{REASON_LABEL}</span>
            <textarea className={`${FIELD} min-h-[96px]`} maxLength={NOTE_MAX} required value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testId}-reason`} />
            <span className={MUTED}>{REASON_HELP(row.teammate)}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-[12px] font-bold ${INK}`}>{CONTEXT_LABEL(row.person)}</span>
            <textarea className={`${FIELD} min-h-[72px]`} maxLength={NOTE_MAX} value={context} onChange={(e) => setContext(e.target.value)} data-testid={`${testId}-context`} />
            <span className={MUTED}>{CONTEXT_HELP(row.teammate)}</span>
          </label>
          <button type="button" className={`${GHOST} self-start`} disabled title="Eadwyn's drafts come with part 8b" data-testid={`${testId}-draft`}>{DRAFT_LATER}</button>
          <p className={`m-0 ${MUTED}`} data-testid={`${testId}-sends`}>{ASK_SENDS(row.teammate, row.person)}</p>
          {error ? <p className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{error}</p> : null}
        </div>
      )}
    </Sheet>
  );
}

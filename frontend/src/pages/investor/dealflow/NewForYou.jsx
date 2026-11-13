/**
 * D1241 (#3254, part 5 of #2423) — DLS6, New for you: every way a deal reaches
 * the investor that is not yet in the firm's flow (`GET /api/deals/flow/inbox`,
 * D1238), newest first. Nothing is added until Add to my deal flow; Pass asks
 * for its reason; Not for me hides the row for the firm, with an optional
 * reason. A way in that could not be read says so; the others still list.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { reportError } from '../../../lib/log';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { ScopeStrip } from '../../../components/scoring/scorecard/Scorecard';
import { STAGE_WORD, scoresOf, shortDayOf, stripScopes } from './flowModel';
import { roundWord } from './dealFlowModel';
import { inboxActions, inboxChip, inboxIntro, inboxLine, thesisLine, unreadSources } from './movesModel';
import { AddToFlowDialog } from './FlowControls';
import { NotForMeDialog, PassDialog } from './StageDialogs';

const BOX = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const CHIP = 'rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-200';
const BTN = 'inline-flex items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex items-center rounded-[9px] bg-violet-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const LINK = 'text-[12.5px] font-semibold text-axal-muted underline hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100';

export default function NewForYou({ onToast }) {
  const [read, setRead] = useState({ kind: 'loading' });
  const [scores, setScores] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ kind: 'loading' });
    dealFlowApi.inbox().then(
      (data) => { if (alive) setRead({ kind: 'ok', items: data?.items || [], sources: data?.sources || {} }); },
      (e) => { reportError('DealFlow:inbox', e); if (alive) setRead({ kind: 'unreadable' }); },
    );
    return () => { alive = false; };
  }, [again]);
  const ids = read.kind === 'ok' ? [...new Set(read.items.map((i) => Number(i.deal_id)))] : [];
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    setScores(null);
    if (!ids.length) return undefined;
    ventureScoresApi.batch(ids.slice(0, 200)).then((s) => { if (alive) setScores(s); }, (e) => { reportError('DealFlow:inbox-scores', e); if (alive) setScores('failed'); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (read.kind === 'loading') return <section className={BOX} aria-busy="true" data-testid="dealflow-new-loading"><p className={MUTED}>Reading…</p></section>;
  if (read.kind === 'unreadable') return <section className={BOX} data-testid="dealflow-new"><Unreadable what="New for you" claim="That is not the same as having nothing new." onRetry={() => setAgain((n) => n + 1)} /></section>;
  const drop = (k) => setRead((r) => ({ ...r, items: r.items.filter((i) => i.key !== k) }));
  const unread = unreadSources(read.sources);
  const thesis = thesisLine(read.sources);
  const asRow = (i) => ({ id: String(i.deal_id), name: i.venture || 'Name not recorded' });

  return (
    <section className={BOX} data-testid="dealflow-new">
      <h2 className="m-0 text-[15px] font-bold text-axal-ink dark:text-gray-100">New for you</h2>
      {read.items.length
        ? <p className={MUTED} data-testid="dealflow-new-intro">{inboxIntro(read.items.length)}</p>
        : <p className="m-0 text-[13px]" data-testid="dealflow-new-empty">Nothing new for you. Invitations, introductions, open syndicates and your watchlist bring ventures here.</p>}
      {unread.length > 0 && <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" role="status" data-testid="dealflow-new-unread">Unreadable: {unread.join(', ')} could not be read. The rest are listed. <button type="button" className="font-semibold underline" onClick={() => setAgain((n) => n + 1)}>Try again</button></p>}
      {thesis && <p className={MUTED} data-testid="dealflow-new-thesis">{thesis}</p>}
      <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
        {read.items.map((i) => {
          const a = inboxActions(i);
          const s = scores === 'failed' ? 'failed' : scoresOf(scores, i.deal_id);
          return (
            <li key={i.key} className="flex flex-col gap-2 py-3" data-testid={`dealflow-new-${i.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={CHIP}>{inboxChip(i)}</span>
                {shortDayOf(i.at) && <span className={MUTED}>{shortDayOf(i.at)}</span>}
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-axal-ink dark:text-gray-100">{i.venture || 'Name not recorded'}</span>
                <span className="text-[12.5px] text-axal-muted dark:text-gray-400"> · {[i.sector, roundWord(i.round_status)].filter(Boolean).join(' · ')}</span>
                {inboxLine(i) && <p className={MUTED}>{inboxLine(i)}</p>}
              </div>
              {s !== 'failed' && (s.state === 'locked' ? <ScopeStrip locked /> : s.state === 'ok' ? <ScopeStrip scopes={stripScopes(s)} /> : null)}
              <div className="flex flex-wrap items-center gap-2">
                {a.add && <button type="button" className={PRIMARY} onClick={() => setDialog({ kind: 'add', item: i })} data-testid={`dealflow-new-add-${i.key}`}>Add to my deal flow</button>}
                {a.pass && <button type="button" className={BTN} onClick={() => setDialog({ kind: 'pass', item: i })} data-testid={`dealflow-new-pass-${i.key}`}>Pass</button>}
                {a.open && <Link to={`/deals/${i.deal_id}`} className={BTN} data-testid={`dealflow-new-open-${i.key}`}>Open</Link>}
                {a.dismiss && <button type="button" className={LINK} onClick={() => setDialog({ kind: 'dismiss', item: i })} data-testid={`dealflow-new-dismiss-${i.key}`}>Not for me</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {dialog?.kind === 'add' && (
        <AddToFlowDialog row={asRow(dialog.item)} viaKey={dialog.item.key} onClose={() => setDialog(null)}
          onAdded={(row) => { setDialog(null); drop(dialog.item.key); onToast?.(`Added ${asRow(dialog.item).name} to your deal flow at ${STAGE_WORD[row?.stage] || 'its stage'}.`); }} />
      )}
      {dialog?.kind === 'pass' && (
        <PassDialog row={asRow(dialog.item)} viaKey={dialog.item.key} invited={dialog.item.source === 'invitation'} onClose={() => setDialog(null)}
          onPassed={() => { setDialog(null); drop(dialog.item.key); onToast?.(`You passed on ${asRow(dialog.item).name}. The round stays open for other investors.`); }} />
      )}
      {dialog?.kind === 'dismiss' && (
        <NotForMeDialog item={dialog.item} onClose={() => setDialog(null)}
          onDismissed={() => { setDialog(null); drop(dialog.item.key); onToast?.(`${asRow(dialog.item).name} is hidden from New for you.`); }} />
      )}
    </section>
  );
}

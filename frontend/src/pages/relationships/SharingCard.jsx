import React, { useCallback, useEffect, useState } from 'react';
import { relationshipsApi } from '../../lib/api/relationships.js';
import { reportError } from '../../lib/log';
import Lightbox from '../../ui/Lightbox';
import {
  KEEP_SHARING, NEVER_CONTACTS, NEVER_SHARED, NO_TEAMS, SHARE_LINE, SHARE_TITLE, SHARING_UNREAD, STOP_AGAIN, STOP_LINE, STOP_SHARING, TEAM_SEES,
  shareState, stopTitle, teamLine,
} from './relationshipsModel';

/**
 * D1357 (#3572, RI1, RI7) — "Let my team see who I know": one switch per team
 * the member belongs to (`GET/PUT /api/relationships/sharing`, D1356), with
 * what the team sees and what is never shared beside them. Off by default.
 * Turning a team on shares at once; turning it off asks first (RI7) and is
 * withdrawn on the team's next read. Drawn on Account › Connectors › LinkedIn
 * and on Network › Relationships.
 */
const CARD = 'rounded-[12px] border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} bg-axal-destructive text-white hover:opacity-90`;

export default function SharingCard({ testId = 'relationships-sharing' }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [justOff, setJustOff] = useState(null);

  const load = useCallback(() => {
    let live = true;
    setRead((s) => (s.status === 'ok' ? s : { status: 'loading', data: null }));
    relationshipsApi.sharing()
      .then((data) => { if (live) setRead({ status: 'ok', data }); })
      .catch((e) => { if (live) setRead({ status: 'error', data: null }); reportError('relationships:sharing', e); });
    return () => { live = false; };
  }, []);
  useEffect(() => load(), [load]);

  const set = async (team, share) => {
    setBusy(team.key); setError(null);
    try {
      const data = await relationshipsApi.setTeamSharing(team.key, share);
      setRead({ status: 'ok', data: data?.teams ? data : { ...read.data, teams: (read.data?.teams || []).map((t) => (t.key === team.key ? { ...t, shared: share } : t)) } });
      setJustOff(share ? null : team.key);
    } catch (e) { setError(e?.message || 'That could not be saved. Nothing changed.'); reportError('relationships:set-sharing', e); }
    finally { setBusy(null); setConfirm(null); }
  };

  const teams = read.data?.teams || [];
  return (
    <section className={`${CARD} flex flex-col gap-4`} aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="flex flex-col gap-1">
        <h2 id={`${testId}-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>{SHARE_TITLE}</h2>
        <p className={`m-0 ${MUTED}`}>{SHARE_LINE}</p>
      </div>
      {read.status === 'loading' ? <div className="h-16 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" /> : null}
      {read.status === 'error' ? (
        <div className="flex flex-col items-start gap-2" data-testid={`${testId}-error`}>
          <span className={`text-[13px] font-bold ${INK}`}>{SHARING_UNREAD}</span>
          <button type="button" className={GHOST} onClick={load}>Try again</button>
        </div>
      ) : null}
      {read.status === 'ok' && !teams.length ? <p className={`m-0 ${MUTED}`} data-testid={`${testId}-no-teams`}>{NO_TEAMS}</p> : null}
      {teams.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {teams.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`${testId}-team-${t.key}`}>
              <span className="flex min-w-0 flex-col">
                <span className={`text-[13.5px] font-bold ${INK}`}>{teamLine(t)}</span>
                <span className={MUTED} data-testid={`${testId}-state-${t.key}`}>{shareState(t, justOff === t.key)}</span>
              </span>
              <button type="button" role="switch" aria-checked={!!t.shared} aria-label={`Let ${t.label || 'this team'} see who I know`} disabled={busy === t.key}
                onClick={() => (t.shared ? setConfirm(t) : set(t, true))}
                className={`relative inline-flex h-7 w-12 min-w-[48px] items-center rounded-full transition ${t.shared ? 'bg-axal-violet' : 'bg-axal-hairline dark:bg-gray-700'} disabled:opacity-50`}
                data-testid={`${testId}-switch-${t.key}`}>
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${t.shared ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1" data-testid={`${testId}-sees`}>
          <span className={`text-[12px] font-bold uppercase tracking-[.04em] ${INK}`}>What your team sees</span>
          <ul className={`m-0 list-disc pl-5 ${MUTED}`}>{TEAM_SEES.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="flex flex-col gap-1" data-testid={`${testId}-never`}>
          <span className={`text-[12px] font-bold uppercase tracking-[.04em] ${INK}`}>Never shared</span>
          <ul className={`m-0 list-disc pl-5 ${MUTED}`}>{NEVER_SHARED.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      <p className={`m-0 ${MUTED}`}>{NEVER_CONTACTS}</p>

      {confirm ? (
        <Lightbox title={stopTitle(confirm.label || 'this team')} label="Stop sharing" onClose={() => setConfirm(null)} width={480} testId={`${testId}-confirm`}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(null)} data-testid={`${testId}-keep`}>{KEEP_SHARING}</button>
              <button type="button" className={DANGER} disabled={busy === confirm.key} onClick={() => set(confirm, false)} data-testid={`${testId}-stop`}>{STOP_SHARING}</button>
            </div>
          )}>
          <p className={`m-0 text-[13px] ${INK}`}>{STOP_LINE}</p>
          <p className={`m-0 mt-2 ${MUTED}`}>{STOP_AGAIN}</p>
        </Lightbox>
      ) : null}
    </section>
  );
}

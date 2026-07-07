import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Bookmark, BookmarkCheck, UserPlus, DoorOpen, Check, Loader2, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { openPaywall } from './PaywallModal';

// Task #82 — shared score badge. Thresholds 80 / 60 measure *match* quality
// (0–100). Note: PipelinePage has its own ScorePill measuring traction with
// 70/40 thresholds on a drag-drop kanban tile — deliberately NOT unified here.
export function ScorePill({ score, small }) {
  const s = Math.round(Number(score) || 0);
  const color = s >= 80
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : s >= 60
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  return (
    <span className={`${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'} font-bold rounded ${color}`}>{s}</span>
  );
}

const BTN = 'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

// Task #82 — the single scored-deal card used across the AI Matches surfaces
// (Deal Flow + Co-Investment). Every card offers three real verbs:
//   • Add to watchlist        → api.watchlistCreate({ project_id })
//   • Request intro           → api.introductionsRequest({ project_id }) [investor only]
//   • Open/join deal room     → api.dealroomJoin(deal_id) then navigate
// Intro and dealroom join both 402 WITHOUT a `required` field, so the global
// PaywallModal never auto-opens — this card surfaces the limit inline and wires
// an Upgrade CTA via openPaywall().
export default function ScoredDealCard({ item, canRequestIntro = false, rank }) {
  const p = item.project || {};
  const dealId = p.deal_id ?? item.deal_id ?? null;
  const navigate = useNavigate();

  const [wl, setWl] = useState('idle'); // idle | busy | done
  const [intro, setIntro] = useState('idle'); // idle | busy | done | quota
  const [introMsg, setIntroMsg] = useState('');
  const [introTier, setIntroTier] = useState('');
  const [room, setRoom] = useState('idle'); // idle | busy | quota
  const [roomMsg, setRoomMsg] = useState('');
  const [roomTier, setRoomTier] = useState('');
  const [err, setErr] = useState('');

  const addWatchlist = async () => {
    if (wl !== 'idle') return;
    setWl('busy'); setErr('');
    try {
      await api.watchlistCreate({ project_id: p.id });
      setWl('done');
    } catch (e) {
      setWl('idle'); setErr(e.message || 'Could not add to watchlist');
      reportError('ScoredDealCard:watchlist', e);
    }
  };

  const requestIntro = async () => {
    if (intro === 'busy' || intro === 'done') return;
    setIntro('busy'); setErr(''); setIntroMsg('');
    try {
      await api.introductionsRequest({ project_id: p.id });
      setIntro('done');
    } catch (e) {
      if (e.status === 402) {
        setIntro('quota');
        setIntroMsg((e.data && e.data.message) || 'You have used all your introductions for this quarter.');
        setIntroTier((e.data && e.data.upgrade_to) || 'professional');
      } else {
        setIntro('idle'); setErr(e.message || 'Could not request an introduction');
        reportError('ScoredDealCard:intro', e);
      }
    }
  };

  const openRoom = async () => {
    if (!dealId || room === 'busy') return;
    setRoom('busy'); setErr(''); setRoomMsg('');
    try {
      await api.dealroomJoin(dealId); // idempotent — safe whether or not already a member
      navigate('/deals');
    } catch (e) {
      if (e.status === 402) {
        setRoom('quota');
        setRoomMsg((e.data && e.data.message) || 'You have reached your deal-room limit.');
        setRoomTier((e.data && e.data.upgrade_to) || 'professional');
      } else {
        setRoom('idle'); setErr(e.message || 'Could not open the deal room');
        reportError('ScoredDealCard:dealroom', e);
      }
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">
            {rank != null && <span className="text-gray-400 font-normal mr-1">#{rank}</span>}
            {p.name}
          </h3>
          <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
            {p.sector || 'Other'} • {p.stage || '—'} • {p.status || '—'}
          </div>
        </div>
        <ScorePill score={item.score} />
      </div>

      {p.problem_statement && (
        <p className="text-xs text-gray-700 mt-2 line-clamp-2 dark:text-gray-300">{p.problem_statement}</p>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
          <Brain size={12} className="text-violet-500 flex-shrink-0 mt-0.5" />
          <span className="leading-relaxed">{item.explanation}</span>
        </div>
        {p.funding_needed != null && p.funding_needed !== '' && (
          <div className="text-xs text-gray-500 mt-2 dark:text-gray-400">
            Funding needed: ${Number(p.funding_needed).toLocaleString()}
          </div>
        )}
        <div className="text-[10px] text-gray-400 mt-2">
          {item.cached ? 'Cached' : 'Fresh'} • {item.model || 'rule-based'}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={addWatchlist}
          disabled={wl !== 'idle'}
          className={`${BTN} ${wl === 'done'
            ? 'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-900/20'
            : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'}`}
        >
          {wl === 'busy' ? <Loader2 size={12} className="animate-spin" /> : wl === 'done' ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
          {wl === 'done' ? 'Watchlisted' : wl === 'busy' ? 'Adding…' : 'Watchlist'}
        </button>

        {canRequestIntro && (
          <button
            onClick={requestIntro}
            disabled={intro === 'busy' || intro === 'done'}
            className={`${BTN} ${intro === 'done'
              ? 'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-900/20'
              : intro === 'quota'
                ? 'border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-900/20'
                : 'border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20'}`}
          >
            {intro === 'busy' ? <Loader2 size={12} className="animate-spin" /> : intro === 'done' ? <Check size={12} /> : intro === 'quota' ? <Lock size={12} /> : <UserPlus size={12} />}
            {intro === 'done' ? 'Intro requested' : intro === 'busy' ? 'Requesting…' : intro === 'quota' ? 'Intro limit reached' : 'Request intro'}
          </button>
        )}

        {dealId != null && (
          <button
            onClick={openRoom}
            disabled={room === 'busy'}
            className={`${BTN} ${room === 'quota'
              ? 'border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-900/20'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >
            {room === 'busy' ? <Loader2 size={12} className="animate-spin" /> : room === 'quota' ? <Lock size={12} /> : <DoorOpen size={12} />}
            {room === 'busy' ? 'Opening…' : room === 'quota' ? 'Room limit reached' : 'Open deal room'}
          </button>
        )}
      </div>

      {intro === 'quota' && (
        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {introMsg}{' '}
          <button onClick={() => openPaywall(introTier || 'professional', introMsg)} className="underline font-medium">Upgrade</button>
        </div>
      )}
      {room === 'quota' && (
        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {roomMsg}{' '}
          <button onClick={() => openPaywall(roomTier || 'professional', roomMsg)} className="underline font-medium">Upgrade</button>
        </div>
      )}
      {err && <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{err}</div>}
    </div>
  );
}

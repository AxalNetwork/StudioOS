/**
 * D1258 (#3281) — SC7 "Your weighting" on Deal flow's toolbar: what the
 * caller's weighting is, and Edit weighting, which opens the dialog
 * (`ScorecardDialogs.YourWeighting`). It changes the caller's sort only,
 * never a score (D1256 §3). A failed read says so; it never reads as equal.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { reportError } from '../../../lib/log';
import { YourWeighting } from './ScorecardDialogs';

export default function WeightingControl({ api = ventureScoresApi }) {
  const [s, setS] = useState({ status: 'loading', data: null });
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { setS({ status: 'ready', data: await api.weights() }); } catch (e) {
      reportError('Weighting:read', e);
      setS({ status: e?.status === 403 ? 'none' : 'unreadable', data: null });
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  if (s.status === 'none') return null;
  const word = s.status === 'loading' ? 'Reading…' : s.status === 'unreadable' ? 'Could not be read' : s.data?.weights ? 'Your own' : 'Equal';
  return (
    <span className="inline-flex items-center gap-2 text-[13px]" data-testid="scorecard-weighting-control">
      <span className="text-axal-muted dark:text-gray-400">Your weighting: <span className="font-semibold text-axal-ink dark:text-gray-100" data-testid="scorecard-weighting-word">{word}</span></span>
      {s.status === 'unreadable'
        ? <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={load}>Try again</button>
        : s.status === 'ready' ? <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => setOpen(true)} data-testid="scorecard-weighting-edit">Edit weighting</button> : null}
      {open ? <YourWeighting initial={s.data?.weights} api={api} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} /> : null}
    </span>
  );
}

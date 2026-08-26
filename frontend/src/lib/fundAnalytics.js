/**
 * Fund analytics — the client half of GET /api/funds/analytics.
 *
 * The two surfaces this feeds (/funds/performance, /funds/accounting) used to
 * render `data/fundAnalytics.js`: four funds that do not exist, with invented
 * NAV, IRR, TVPI, RVPI and DPI, under copy describing them as "LP-ready
 * returns ... suitable for quarterly reporting". Invented fiduciary figures
 * are the one thing the funds honesty rule forbids outright.
 *
 * So the contract here is deliberately blunt: a metric the schema cannot
 * support arrives as `null`, and `Unrecorded` renders it as "Not recorded"
 * carrying the server's own reason. Nothing in this module may substitute a
 * zero, a dash or an em-dash for a null — each of those reads as a measured
 * result, and "0.00x DPI" is a claim about a fund, not an absence of one.
 */
import { useCallback, useEffect, useState } from 'react';
import React from 'react';
import { api } from './api';

export const NOT_RECORDED = 'Not recorded';

/** Money arrives as integer cents and is only ever divided for display. */
export function fmtCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return NOT_RECORDED;
  const dollars = Number(cents) / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

/** A multiple, or null. Never 0.00x standing in for "we do not know". */
export function fmtMultiple(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${Number(v).toFixed(2)}x`;
}

/** A rate already expressed as a fraction (0.02 → "2.0%"), or null. */
export function fmtRate(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${(Number(v) * 100).toFixed(1)}%`;
}

/**
 * The absence of a number, said out loud. `reason` is the server's own
 * explanation from the `unavailable` map, surfaced on hover so a GP asking
 * "why is TVPI blank" gets the answer from the page rather than from support.
 */
export function Unrecorded({ reason }) {
  return React.createElement(
    'span',
    {
      className: 'text-gray-400 dark:text-gray-500 italic text-xs',
      title: reason || undefined,
    },
    NOT_RECORDED,
  );
}

/**
 * Family-wide fund analytics. One request; the caller renders loading, error
 * and empty separately because an empty fund family is a real, valid state
 * (a studio that has not raised yet) and must not look like a failure.
 */
export function useFundAnalytics() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.fundsAnalytics()
      .then((d) => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (live) setState({ data: null, loading: false, error: e?.message || 'Could not load fund analytics.' }); });
    return () => { live = false; };
  }, []);

  useEffect(() => load(), [load]);

  return {
    ...state,
    reload: load,
    items: state.data?.items || [],
    totals: state.data?.totals || null,
    unavailable: state.data?.unavailable || {},
  };
}

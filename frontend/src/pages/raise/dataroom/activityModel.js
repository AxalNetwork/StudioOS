/**
 * D1108 (#2988) — Activity's derivations (DR10, DR11, DR22c), kept pure, from
 * D1105's read `GET /api/data-room/:projectUid/activity` (`dataRoomApi.activity`).
 *
 * A LINK ISSUED IS NOT A READ, AND A REFUSAL IS NEVER AN OPEN. The log holds
 * three actions: `open_room` (the investor opened the room), `download` (a
 * one-time download link was made; whether it was followed is not recorded)
 * and `blocked` (the NDA gate refused a download). Each is its own figure and
 * its own words: no word here says a file was read or downloaded.
 *
 * ZEROS ARE REAL HERE. A day or an investor with no row is a count of the
 * venture's own log, as D1105 reads it, so it is 0, never "Not recorded". A
 * read that fails is Unreadable, never zeros.
 *
 * THE PERIOD BEFORE is D1105's `previous` totals: the read carries no daily
 * series for it, so the comparison is a sentence, not a dotted line.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const PERIODS = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
];
export const DEFAULT_PERIOD = '30';

export const ACTIONS = [
  { id: '', label: 'Every event' },
  { id: 'open_room', label: 'Opened the room' },
  { id: 'download', label: 'Link issued' },
  { id: 'blocked', label: 'Blocked by the NDA' },
];

export const LINK_NOTE = 'A link issued means a one-time download link was made. Whether it was followed is not recorded.';
export const ZERO_NOTE = 'Zeros here are real, from the log.';

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (d) => d.toISOString().slice(0, 10);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The period's query: `days` whole UTC days ending today. */
export function periodQuery(periodId, now = Date.now()) {
  const p = PERIODS.find((x) => x.id === periodId) || PERIODS.find((x) => x.id === DEFAULT_PERIOD);
  const to = new Date(now);
  const from = new Date(now - (p.days - 1) * 86400000);
  return { from: ymd(from), to: ymd(to) };
}

/** "26 Sep" from YYYY-MM-DD. */
export const shortDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${M[Number(m[2]) - 1]}` : NOT_RECORDED;
};

/** "24 Oct 2026 16:42" from a stamp; UTC, as the log stores it. */
export function stamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]} ${m[4]}:${m[5]}` : NOT_RECORDED;
}

/** Events by day: the chart spec `ui/Charts.jsx` draws, with its own table head. */
export function dailyChart(read) {
  const days = Array.isArray(read?.daily) ? read.daily : [];
  const labels = days.map((d) => shortDay(d.day));
  const series = [
    { key: 'opened', label: 'Room opens', tone: 'violet', values: days.map((d) => n(d.opened)) },
    { key: 'downloaded', label: 'Links issued', tone: 'sky', values: days.map((d) => n(d.downloaded)) },
    { key: 'blocked', label: 'Blocked by the NDA', tone: 'amber', values: days.map((d) => n(d.blocked)) },
  ];
  return {
    type: 'lines',
    labels,
    series,
    height: 240,
    currentIndex: labels.length - 1,
    table: {
      head: ['Day', 'Room opens', 'Links issued', 'Blocked'],
      rows: days.map((d, i) => [`${labels[i]}${i === days.length - 1 ? ' · so far' : ''}`, String(n(d.opened)), String(n(d.downloaded)), String(n(d.blocked))]),
    },
  };
}

/** The chart's title: "Events by day · 26 Sep to 25 Oct". */
export function chartTitle(read) {
  const p = read?.period;
  return p ? `Events by day · ${shortDay(p.from)} to ${shortDay(p.to)}` : 'Events by day';
}

/** The sentence under the chart: each figure, and the same days before. */
export function totalsLine(read) {
  const t = read?.totals || {};
  const p = read?.previous || {};
  const days = n(read?.period?.days);
  const before = days ? `in the ${days} days before` : 'in the period before';
  const part = (label, k) => `${label} ${n(t[k])} (${n(p[k])} ${before})`;
  return [part('Opened the room', 'opened'), part('Link issued', 'downloaded'), part('Blocked by the NDA', 'blocked')].join(' · ');
}

/** The chart's alt sentence. */
export function chartAlt(read) {
  const t = read?.totals || {};
  return `Events per day for ${n(read?.period?.days)} days: ${n(t.opened)} room opens, ${n(t.downloaded)} links issued and ${n(t.blocked)} blocked by the NDA.`;
}

/** Who a log row or an investor row names: a grant's name or address, else that no grant names them. */
export const readerName = (r) => r?.name || r?.email || 'Someone without access here';

/** By investor: one row per reader, the busiest first, as the read orders them. */
export function investorRows(read) {
  return (Array.isArray(read?.investors) ? read.investors : []).map((r, i) => ({
    key: r.grant_uid || `reader-${i}`,
    grantUid: r.grant_uid || null,
    who: readerName(r),
    opened: String(n(r.opened)),
    downloaded: String(n(r.downloaded)),
    blocked: String(n(r.blocked)),
    last: r.last_at ? shortDay(r.last_at) : 'No event in this period',
  }));
}

/** The words for one log row. A link issued is never "downloaded", a refusal never "opened". */
export function eventWords(row) {
  const file = row?.file?.name || 'a file no longer in the room';
  if (row?.action === 'open_room') return 'Opened the room';
  if (row?.action === 'download') return `Link issued for ${file}`;
  if (row?.action === 'blocked') return `Blocked: NDA needed for ${file}`;
  return NOT_RECORDED;
}

/** The log's rows, newest first as the read pages them. */
export function logRows(read) {
  return (Array.isArray(read?.log?.rows) ? read.log.rows : []).map((r, i) => ({
    key: `${r.at || ''}-${i}`,
    when: stamp(r.at),
    who: readerName(r.investor),
    event: eventWords(r),
    action: r.action,
  }));
}

/** "1–50 of 65", from the read's page. */
export function logCount(read) {
  const l = read?.log;
  if (!l || !Number.isFinite(Number(l.total))) return '';
  const total = Number(l.total);
  if (!total) return '0 events';
  const size = Number(l.page_size) || 50;
  const start = (Number(l.page) - 1) * size + 1;
  return `${start}–${Math.min(total, start + size - 1)} of ${total}`;
}

/** The phone's table (DR22c): the last seven days of the period, newest first. */
export function phoneDays(read) {
  const days = Array.isArray(read?.daily) ? read.daily : [];
  return days.slice(-7).reverse().map((d, i) => ({
    key: d.day,
    day: `${shortDay(d.day)}${i === 0 ? ' · so far' : ''}`,
    opened: String(n(d.opened)),
    downloaded: String(n(d.downloaded)),
    blocked: String(n(d.blocked)),
  }));
}

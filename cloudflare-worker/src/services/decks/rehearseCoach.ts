/**
 * D1580 part 2 (#3827) — `rehearse_coach`: a model's coaching on a finished
 * rehearsal, on the rail option `rehearse:coach` (the member's pick in the
 * AIRail), quoted and held before it runs.
 *
 * The model reads the transcript as untrusted text and the report's counts as
 * data, and returns at most COACH_POINTS points, each tied to a card. A point
 * is shown only when its card is in the deck, its words are within the limit,
 * and every number in it is one the report or the transcript holds: the coach
 * never invents a figure. A point that fails is counted, never shown.
 */
import { untrustedBlock, withUntrustedRule } from '../ai/untrusted';
import type { RehearsalReport } from './rehearsal';

export const COACH_OPTION = 'rehearse:coach';
export const COACH_POINTS = 6;
export const COACH_POINT_CHARS = 280;
const TRANSCRIPT_CHARS = 12_000;

export type CoachPoint = { card: number; point: string };
export type Coaching = { points: CoachPoint[]; dropped: number };

export const COACH_SYSTEM = withUntrustedRule([
  'You coach a founder who has just rehearsed their investor pitch.',
  'Each point names one card by its number and says, in one or two sentences, what to change in how it is said: pace, filler words, pauses, a note left out, a figure said wrong.',
  'Use only the numbers in the report or the transcript. Never predict a result or promise an outcome.',
  'Return only JSON.',
].join(' '));

/** What the coach is asked: the report's counts per card, and the transcript as untrusted text. */
export function coachMessage(report: RehearsalReport, transcript: string): string {
  const cards = report.cards.map((c) => ({
    card: c.card, title: c.title, time: c.time_line, over: c.over, wpm: c.wpm, fillers: c.filler_words, pauses: c.pauses,
    notes_missed: c.notes.filter((n) => !n.covered).map((n) => n.text),
  }));
  const figures = report.figures.map((f) => ({ card: f.card, said: f.said_shown, record: f.record_shown }));
  return [
    `The pitch was set to ${Math.round(report.pitch_seconds / 60)} minutes and took ${report.time_line}.`,
    `Per card: ${JSON.stringify(cards)}`,
    figures.length ? `Figures said that disagree with the record: ${JSON.stringify(figures)}` : 'Every figure said matched the record.',
    `Transcript:\n${untrustedBlock('transcript', transcript.slice(0, TRANSCRIPT_CHARS))}`,
    `Return at most ${COACH_POINTS} points: {"points":[{"card":<card number>,"point":"..."}]}.`,
  ].join('\n');
}

const DIGITS = /\p{Nd}+(?:[.,]\p{Nd}+)*/gu;
const runs = (t: string) => (String(t).match(DIGITS) ?? []).map((r) => r.replace(/[^\p{Nd}]/gu, ''));

/** The points that may be shown, and how many were dropped. */
export function coachPoints(raw: unknown, report: RehearsalReport, transcript: string): Coaching {
  const list = Array.isArray((raw as any)?.points) ? (raw as any).points : [];
  const known = new Set(runs(JSON.stringify(report) + '\n' + transcript));
  const cards = new Set(report.cards.map((c) => c.card));
  const points: CoachPoint[] = [];
  let dropped = 0;
  for (const p of list.slice(0, COACH_POINTS * 2)) {
    const card = Number(p?.card);
    const point = typeof p?.point === 'string' ? p.point.trim() : '';
    const ok = cards.has(card) && point && point.length <= COACH_POINT_CHARS && runs(point).every((r) => known.has(r)) && points.length < COACH_POINTS;
    if (ok) points.push({ card, point }); else dropped += 1;
  }
  return { points, dropped };
}

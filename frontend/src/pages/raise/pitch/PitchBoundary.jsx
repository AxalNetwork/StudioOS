import React from 'react';
import { TITLE, boundaryFor } from './pitchStudioModel';

/**
 * D905 (#2684) — PD22: the studio's boundary for the roles it is not for. An
 * Advisor, an Operating Partner or an Explorer opening `/raise/pitch` reads it
 * inside their own shell, as `hqOnly`'s notice is drawn, never a bounce.
 * Nothing from any deck is read or shown.
 */
export default function PitchBoundary({ role }) {
  const words = boundaryFor(role) || boundaryFor('exploring');
  return (
    <section className="mx-auto mt-6 flex max-w-[560px] flex-col gap-2.5 rounded-[12px] border border-axal-hairline bg-white p-6 dark:border-gray-700 dark:bg-gray-900" data-testid="pitch-studio-boundary">
      <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{TITLE}</span>
      <h1 className="m-0 text-[16px] font-extrabold leading-snug tracking-[-.02em] text-axal-ink dark:text-gray-100">{words.title}</h1>
      <p className="m-0 text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400">{words.line}</p>
    </section>
  );
}

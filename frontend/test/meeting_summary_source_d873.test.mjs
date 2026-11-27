/**
 * D873 (#2520) — a call's summary says how its text was made: the call's own
 * transcript, or speech-to-text by the model the Worker names. A summary the
 * Worker gives no source for says nothing more.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SessionSummary, { transcriptLabel } from '../src/pages/founder/SessionSummary.jsx';

const h = React.createElement;
const SUMMARY = { text: 'They reconcile by hand.', sentences: [{ text: 'They reconcile by hand.', cites: [] }], model: 'm', summarised_at: '2026-10-22 10:00:00' };
const line = (summary) => /data-testid="summary-model">([^<]*)</.exec(renderToStaticMarkup(h(SessionSummary, { summary })))[1];

test('the label: the call\'s own transcript, or speech-to-text with its model; nothing when the Worker said nothing', () => {
  // Mutation checked: the two sources swapped → both fail.
  assert.equal(transcriptLabel({ source: 'native', model: 'zoom_transcript' }), "From the call's own transcript");
  assert.equal(transcriptLabel({ source: 'speech_to_text', model: '@cf/openai/whisper-large-v3-turbo' }), 'From speech-to-text (@cf/openai/whisper-large-v3-turbo)');
  assert.equal(transcriptLabel(undefined), null);
});

test('the summary line carries it for a call, and is unchanged for anything else', () => {
  // Mutation checked: the label dropped from the line → the first assertion fails.
  assert.equal(line({ ...SUMMARY, transcript: { source: 'native', model: 'zoom_transcript' } }), "Written by m · 2026-10-22 10:00 · From the call&#x27;s own transcript");
  assert.equal(line(SUMMARY), 'Written by m · 2026-10-22 10:00');
});

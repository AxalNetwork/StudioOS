/**
 * Task #9 — Admin "Exploring users" queue: onboarding conversation summary.
 *
 * `GET /api/admin/exploring/users` derives `onboarding_summary` per row via
 * the exported pure helper `deriveOnboardingSummary(extractedJson, chatJson)`:
 *   1. `partner_profiles.extracted_data`.summary (the AI one-liner from
 *      /api/profiling/save extraction) wins when present;
 *   2. falls back to the user's own `chat_history` messages (joined,
 *      whitespace-normalised, truncated);
 *   3. null when neither yields text (user skipped the chat).
 * Raw JSON blobs must never reach the response payload — only the derived
 * summary field does (the route strips `_extracted_data`/`_chat_history`).
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_exploring.summary.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOnboardingSummary } from '../src/routes/admin_exploring.ts';

const CHAT = JSON.stringify([
  { role: 'assistant', content: 'Welcome to Axal — what brings you here?' },
  { role: 'user', content: 'I run a small robotics company in Berlin.' },
  { role: 'assistant', content: 'Great — tell me more.' },
  { role: 'user', content: 'We want to spin out our vision module as a new venture.' },
]);

test('extracted_data.summary is preferred when present', () => {
  const extracted = JSON.stringify({ summary: 'Robotics founder exploring a spin-out of their vision module.' });
  assert.equal(
    deriveOnboardingSummary(extracted, CHAT),
    'Robotics founder exploring a spin-out of their vision module.',
  );
});

test('falls back to the user chat messages when summary is missing', () => {
  const noSummary = JSON.stringify({ persona: 'founder', summary: null });
  assert.equal(
    deriveOnboardingSummary(noSummary, CHAT),
    'I run a small robotics company in Berlin. · We want to spin out our vision module as a new venture.',
  );
});

test('falls back to chat when summary is empty/whitespace', () => {
  assert.equal(
    deriveOnboardingSummary(JSON.stringify({ summary: '   ' }), CHAT),
    'I run a small robotics company in Berlin. · We want to spin out our vision module as a new venture.',
  );
});

test('assistant-only chat history yields null (no user context to show)', () => {
  const assistantOnly = JSON.stringify([{ role: 'assistant', content: 'Hello!' }]);
  assert.equal(deriveOnboardingSummary(null, assistantOnly), null);
});

test('null when neither extraction nor chat exists', () => {
  assert.equal(deriveOnboardingSummary(null, null), null);
  assert.equal(deriveOnboardingSummary(undefined, undefined), null);
  assert.equal(deriveOnboardingSummary('', ''), null);
});

test('malformed JSON in either field is safe and falls through', () => {
  assert.equal(
    deriveOnboardingSummary('{not json', CHAT),
    'I run a small robotics company in Berlin. · We want to spin out our vision module as a new venture.',
  );
  assert.equal(deriveOnboardingSummary('{not json', '[broken'), null);
  // Non-array chat history is ignored.
  assert.equal(deriveOnboardingSummary(null, JSON.stringify({ role: 'user', content: 'hi' })), null);
});

test('long summaries are whitespace-normalised and truncated with an ellipsis', () => {
  const long = 'word '.repeat(120); // 600 chars
  const out = deriveOnboardingSummary(JSON.stringify({ summary: long }), null);
  assert.ok(out);
  assert.ok(out!.length <= 280, `expected <=280 chars, got ${out!.length}`);
  assert.ok(out!.endsWith('…'));
  assert.ok(!/\s{2,}/.test(out!), 'whitespace must be collapsed');
});

test('non-string summary values are ignored (fallback still applies)', () => {
  assert.equal(
    deriveOnboardingSummary(JSON.stringify({ summary: 42 }), CHAT),
    'I run a small robotics company in Berlin. · We want to spin out our vision module as a new venture.',
  );
});
